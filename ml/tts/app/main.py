import asyncio
import base64
import binascii
import logging
import os
import re
from collections import deque
from collections.abc import AsyncIterator
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass

import numpy as np
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from nanovllm_voxcpm import VoxCPM
from pydantic import BaseModel, Field

MODEL_DIR = os.environ["MODEL_DIR"]
# Share of GPU memory the engine takes, counting what other processes on the
# GPU already use: they must be started first.
GPU_MEMORY_UTILIZATION = float(os.environ.get("GPU_MEMORY_UTILIZATION", "0.95"))
# Diffusion steps per generated frame. Fewer is faster at some cost in
# voice quality; generation must outpace playback or the audio stalls.
INFERENCE_TIMESTEPS = int(os.environ.get("INFERENCE_TIMESTEPS", "10"))

# The buffer is spoken after this much time without new text.
FLUSH_IDLE_S = 0.5
# Queued segments are merged into one generation up to this length; longer
# text would delay the first audio and strain the model.
MAX_MERGED_CHARS = 300
MAX_VOICE_WAV_BYTES = 2 * 1024 * 1024
MAX_VOICE_TEXT_CHARS = 2000
VOICE_ID_RE = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
# Without final punctuation the model tends to cut off the last word.
SENTENCE_END = (".", "!", "?", "…")
# A text the backend marks as continuing ends with one of these; it keeps
# them, so the voice does not fall as at the end of a sentence.
PHRASE_END = (",", ";", ":")
# After idle the first generation is about a second slower; a warmup
# segment is synthesized and dropped so the first real phrase is not.
WARMUP = object()
WARMUP_TEXT = "Hello."
# Edge silence of every segment is cut; the margin keeps soft word edges
# such as a final hissing consonant.
SILENCE_RMS = 0.01
SILENCE_FRAME_S = 0.01
SILENCE_MARGIN_S = 0.12
# Quiet after a sound goes out at once up to this length. It is often a soft
# word ending, and holding it back until the next sound plays it after a
# stall, as a stray consonant. Only longer silence waits, to be cut if the
# segment ends there.
QUIET_SENT_S = 0.6

logger = logging.getLogger("tts")


# A patch of generated audio is 0.16 s. The model stops at the end of the
# speech; this only bounds a generation that does not stop.
STEPS_PER_CHAR = 1
MIN_STEPS = 40


@dataclass
class Voice:
    latents: bytes
    text: str


class EngineState:
    pool: VoxCPM
    sample_rate: int


state = EngineState()
# Voices live only in memory. After a restart the backend gets
# voice_not_registered and registers the voice again.
voices: dict[str, Voice] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The server accepts requests only after this, and a failed load stops
    # the process, so handlers can rely on the model being there. The engine
    # batches concurrent generations; one session needs only a few slots.
    pool = VoxCPM.from_pretrained(
        MODEL_DIR,
        inference_timesteps=INFERENCE_TIMESTEPS,
        max_num_seqs=4,
        max_num_batched_tokens=4096,
        max_model_len=4096,
        gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
        devices=[0],
    )
    await pool.wait_for_ready()
    state.pool = pool
    state.sample_rate = int((await pool.get_model_info())["sample_rate"])
    logger.info("Model loaded from %s", MODEL_DIR)
    try:
        yield
    finally:
        await pool.stop()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


class VoiceSample(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_VOICE_TEXT_CHARS)
    wav: str


@app.put("/voices/{voice_id}", status_code=204)
async def register_voice(voice_id: str, sample: VoiceSample) -> Response:
    if not VOICE_ID_RE.fullmatch(voice_id):
        raise HTTPException(400, "invalid voice id")
    try:
        wav = base64.b64decode(sample.wav, validate=True)
    except binascii.Error:
        raise HTTPException(400, "wav is not base64") from None
    if len(wav) > MAX_VOICE_WAV_BYTES or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise HTTPException(400, "invalid wav")

    try:
        latents = await state.pool.encode_latents(wav, "wav")
    except Exception:
        logger.exception("Could not encode the voice sample")
        raise HTTPException(400, "invalid wav") from None
    voices[voice_id] = Voice(latents=latents, text=sample.text)
    return Response(status_code=204)


@app.websocket("/synthesize/{voice_id}")
async def synthesize(ws: WebSocket, voice_id: str) -> None:
    await ws.accept()
    voice = voices.get(voice_id)
    if voice is None:
        await ws.send_json({"type": "error", "code": "voice_not_registered"})
        await ws.close(code=1008)
        return

    await ws.send_json(
        {
            "type": "ready",
            "sampleRate": state.sample_rate,
            "encoding": "pcm_s16le",
        }
    )

    # Receiving and speaking run separately, so text keeps arriving
    # while the previous segment is being synthesized.
    segments: asyncio.Queue[str | object | None] = asyncio.Queue()
    speaker = asyncio.create_task(speak(ws, voice, segments))
    buffer: list[str] = []
    try:
        while True:
            try:
                message = await asyncio.wait_for(
                    ws.receive_json(), FLUSH_IDLE_S if buffer else None
                )
            except TimeoutError:
                message = {"type": "flush"}

            kind = message.get("type")
            if kind == "text":
                text = str(message.get("text", "")).strip()
                if text:
                    buffer.append(text)
            elif kind == "warmup":
                segments.put_nowait(WARMUP)
            elif kind in ("flush", "end"):
                if buffer:
                    segments.put_nowait(" ".join(buffer))
                    buffer = []
                if kind == "end":
                    segments.put_nowait(None)
                    if await speaker:
                        await ws.send_json({"type": "done"})
                        await ws.close()
                    return
    except WebSocketDisconnect:
        pass
    finally:
        speaker.cancel()


async def speak(ws: WebSocket, voice: Voice, segments: asyncio.Queue) -> bool:
    try:
        sample_rate = state.sample_rate
        # Segments taken from the queue but not spoken yet.
        waiting: deque[str | object | None] = deque()
        while True:
            text = waiting.popleft() if waiting else await segments.get()
            if text is None:
                break
            if text is WARMUP:
                async with aclosing(stream_speech(voice, WARMUP_TEXT)) as chunks:
                    async for _ in chunks:
                        pass
                continue
            text = merge_waiting(text, segments, waiting)
            trimmer = EdgeSilenceTrimmer(sample_rate)
            async with aclosing(stream_speech(voice, as_phrase(text))) as chunks:
                async for chunk in chunks:
                    for part in trimmer.feed(chunk):
                        await ws.send_bytes(to_pcm16(part))
            # Whatever the trimmer still holds is trailing silence.
            await ws.send_json({"type": "segmentEnd"})
        return True
    except WebSocketDisconnect:
        return False
    except Exception:
        logger.exception("Synthesis failed")
        await ws.send_json({"type": "error", "code": "synthesis_failed"})
        await ws.close(code=1011)
        return False


def merge_waiting(text: str, segments: asyncio.Queue, waiting: deque) -> str:
    # Every generation pays a fixed start-up cost. Segments that arrived
    # while the previous one was spoken are said as one generation instead,
    # up to MAX_MERGED_CHARS. Anything else stays queued in order.
    while True:
        if not waiting:
            try:
                waiting.append(segments.get_nowait())
            except asyncio.QueueEmpty:
                return text
        following = waiting[0]
        if not isinstance(following, str):
            return text
        if len(text) + 1 + len(following) > MAX_MERGED_CHARS:
            return text
        text = f"{text} {waiting.popleft()}"


async def stream_speech(voice: Voice, text: str) -> AsyncIterator[np.ndarray]:
    text = " ".join(text.split())
    # Leaving early cancels the generation and frees its slot.
    async for chunk in state.pool.generate(
        target_text=text,
        prompt_latents=voice.latents,
        prompt_text=voice.text,
        ref_audio_latents=voice.latents,
        max_generate_length=max(MIN_STEPS, len(text) * STEPS_PER_CHAR),
        temperature=1.0,
        cfg_value=2.0,
    ):
        yield np.asarray(chunk, dtype=np.float32).ravel()


class EdgeSilenceTrimmer:
    def __init__(self, sample_rate: int) -> None:
        self.frame = max(1, int(sample_rate * SILENCE_FRAME_S))
        self.margin = int(sample_rate * SILENCE_MARGIN_S)
        self.quiet_limit = int(sample_rate * QUIET_SENT_S)
        self.started = False
        # Quiet audio after the last sound beyond QUIET_SENT_S: a pause if
        # sound follows, the trailing silence if the segment ends.
        self.held = np.zeros(0, dtype=np.float32)
        # How much of the current quiet stretch has already been sent.
        self.quiet_sent = 0

    def feed(self, chunk: np.ndarray) -> list[np.ndarray]:
        audio = np.concatenate([self.held, chunk.astype(np.float32).ravel()])
        loud = self._loud_frames(audio)
        if not loud.any():
            if not self.started:
                self.held = audio[-self.margin :]
                return []
            return self._send_quiet(audio)

        first = int(np.argmax(loud)) * self.frame
        end = (len(loud) - int(np.argmax(loud[::-1]))) * self.frame
        start = 0 if self.started else max(0, first - self.margin)
        self.started = True
        self.quiet_sent = 0
        out = [audio[start:end], *self._send_quiet(audio[end:])]
        return [np.concatenate(out)]

    def _send_quiet(self, quiet: np.ndarray) -> list[np.ndarray]:
        take = max(0, self.quiet_limit - self.quiet_sent)
        out = quiet[:take]
        self.quiet_sent += len(out)
        self.held = quiet[take:]
        return [out] if len(out) else []

    def _loud_frames(self, audio: np.ndarray) -> np.ndarray:
        count = -(-len(audio) // self.frame)
        padded = np.zeros(count * self.frame, dtype=np.float32)
        padded[: len(audio)] = audio
        rms = np.sqrt((padded.reshape(count, self.frame) ** 2).mean(axis=1))
        return rms >= SILENCE_RMS


def as_phrase(text: str) -> str:
    text = text[:1].upper() + text[1:]
    return text if text.endswith(SENTENCE_END + PHRASE_END) else f"{text}."


def to_pcm16(chunk: np.ndarray) -> bytes:
    return (np.clip(chunk, -1.0, 1.0) * 32767).astype("<i2").tobytes()
