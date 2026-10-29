import asyncio
import base64
import binascii
import logging
import os
import re
import tempfile
import threading
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

MODEL_DIR = os.environ["MODEL_DIR"]

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
# Edge silence of every segment is cut; the margin keeps soft word edges.
SILENCE_RMS = 0.01
SILENCE_FRAME_S = 0.01
SILENCE_MARGIN_S = 0.08

logger = logging.getLogger("tts")


@dataclass
class Voice:
    # The sample encoded once by the model, so a generation does not read
    # and encode the WAV again. Generation only reads it.
    prompt_cache: dict


class ModelState:
    model = None


state = ModelState()
# Voices live only in memory. After a restart the backend gets
# voice_not_registered and registers the voice again.
voices: dict[str, Voice] = {}
# The model is not known to be thread-safe, so one generation at a time.
gpu_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The server accepts requests only after this, and a failed load stops
    # the process, so handlers can rely on the model being there.
    from voxcpm import VoxCPM

    state.model = VoxCPM.from_pretrained(MODEL_DIR, load_denoiser=False)
    logger.info("Model loaded from %s", MODEL_DIR)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


class VoiceSample(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_VOICE_TEXT_CHARS)
    wav: str


@app.put("/voices/{voice_id}", status_code=204)
def register_voice(voice_id: str, sample: VoiceSample) -> Response:
    if not VOICE_ID_RE.fullmatch(voice_id):
        raise HTTPException(400, "invalid voice id")
    try:
        wav = base64.b64decode(sample.wav, validate=True)
    except binascii.Error:
        raise HTTPException(400, "wav is not base64") from None
    if len(wav) > MAX_VOICE_WAV_BYTES or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise HTTPException(400, "invalid wav")

    voices[voice_id] = Voice(prompt_cache=build_prompt_cache(wav, sample.text))
    return Response(status_code=204)


def build_prompt_cache(wav: bytes, text: str) -> dict:
    # The same sample is the continuation prompt and the reference voice,
    # as generate_streaming would use it. voxcpm reads it from a file.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as file:
        file.write(wav)
    try:
        with gpu_lock, torch.inference_mode():
            return state.model.tts_model.build_prompt_cache(
                prompt_text=text,
                prompt_wav_path=file.name,
                reference_wav_path=file.name,
            )
    except Exception:
        logger.exception("Could not encode the voice sample")
        raise HTTPException(400, "invalid wav") from None
    finally:
        os.unlink(file.name)


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
            "sampleRate": state.model.tts_model.sample_rate,
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
        sample_rate = state.model.tts_model.sample_rate
        # Segments taken from the queue but not spoken yet.
        waiting: deque[str | object | None] = deque()
        while True:
            text = waiting.popleft() if waiting else await segments.get()
            if text is None:
                break
            if text is WARMUP:
                async for _ in stream_speech(voice, WARMUP_TEXT):
                    pass
                continue
            text = merge_waiting(text, segments, waiting)
            trimmer = EdgeSilenceTrimmer(sample_rate)
            async for chunk in stream_speech(voice, with_sentence_end(text)):
                for part in trimmer.feed(chunk):
                    await ws.send_bytes(to_pcm16(part))
            for part in trimmer.finish():
                await ws.send_bytes(to_pcm16(part))
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
    loop = asyncio.get_running_loop()
    chunks: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()

    def put(item) -> None:
        if not loop.is_closed():
            loop.call_soon_threadsafe(chunks.put_nowait, item)

    def produce() -> None:
        try:
            with gpu_lock:
                # Same settings as VoxCPM.generate_streaming, which builds
                # this cache from the files on every call.
                steps = state.model.tts_model.generate_with_prompt_cache_streaming(
                    target_text=" ".join(text.split()),
                    prompt_cache=voice.prompt_cache,
                    min_len=2,
                    max_len=4096,
                    inference_timesteps=10,
                    cfg_value=2.0,
                )
                try:
                    for wav, _, _ in steps:
                        if stop.is_set():
                            break
                        put(wav.squeeze(0).cpu().numpy())
                finally:
                    steps.close()
        except Exception as exc:
            put(exc)
        finally:
            put(None)

    loop.run_in_executor(None, produce)
    try:
        while (item := await chunks.get()) is not None:
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        # Frees the GPU for others when the client is gone.
        stop.set()


class EdgeSilenceTrimmer:
    def __init__(self, sample_rate: int) -> None:
        self.frame = max(1, int(sample_rate * SILENCE_FRAME_S))
        self.margin = int(sample_rate * SILENCE_MARGIN_S)
        self.started = False
        # Quiet audio after the last sound: a pause if sound follows,
        # the trailing silence if the segment ends.
        self.held = np.zeros(0, dtype=np.float32)

    def feed(self, chunk: np.ndarray) -> list[np.ndarray]:
        audio = np.concatenate([self.held, chunk.astype(np.float32).ravel()])
        loud = self._loud_frames(audio)
        if not loud.any():
            self.held = audio if self.started else audio[-self.margin :]
            return []

        first = int(np.argmax(loud)) * self.frame
        end = (len(loud) - int(np.argmax(loud[::-1]))) * self.frame
        start = 0 if self.started else max(0, first - self.margin)
        self.started = True
        self.held = audio[end:]
        return [audio[start:end]]

    def finish(self) -> list[np.ndarray]:
        tail = self.held[: self.margin] if self.started else self.held[:0]
        self.held = self.held[:0]
        return [tail] if len(tail) else []

    def _loud_frames(self, audio: np.ndarray) -> np.ndarray:
        count = -(-len(audio) // self.frame)
        padded = np.zeros(count * self.frame, dtype=np.float32)
        padded[: len(audio)] = audio
        rms = np.sqrt((padded.reshape(count, self.frame) ** 2).mean(axis=1))
        return rms >= SILENCE_RMS


def with_sentence_end(text: str) -> str:
    return text if text.endswith(SENTENCE_END + PHRASE_END) else f"{text}."


def to_pcm16(chunk: np.ndarray) -> bytes:
    return (np.clip(chunk, -1.0, 1.0) * 32767).astype("<i2").tobytes()
