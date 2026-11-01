import asyncio
import base64
import binascii
import io
import logging
import os
import re
import wave
from collections import deque
from collections.abc import AsyncIterator
from contextlib import aclosing, asynccontextmanager, suppress
from dataclasses import dataclass

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from nanovllm_voxcpm import VoxCPM
from num2words import num2words

MODEL_DIR = os.environ["MODEL_DIR"]
# Counts memory other GPU processes already use.
GPU_MEMORY_UTILIZATION = float(os.environ.get("GPU_MEMORY_UTILIZATION", "0.75"))
# Seconds of earlier session speech each portion continues; 0 turns it off.
HISTORY_S = float(os.environ.get("TTS_HISTORY_S", "10"))
# Fewer steps: faster, lower voice quality.
INFERENCE_TIMESTEPS = int(os.environ.get("INFERENCE_TIMESTEPS", "10"))

FLUSH_IDLE_S = 0.5
MAX_MERGED_CHARS = 300
MAX_VOICE_WAV_BYTES = 2 * 1024 * 1024
# Without final punctuation the model cuts off the last word.
SENTENCE_END = (".", "!", "?", "…")
# Kept on continuing text so the voice does not fall.
PHRASE_END = (",", ";", ":")
# Synthesized and dropped: the first generation after idle is slower.
WARMUP = object()
WARMUP_TEXT = "Hello."
NOTHING = object()
# The margin keeps soft word edges when cutting edge silence.
SILENCE_RMS = 0.01
SILENCE_FRAME_S = 0.01
SILENCE_MARGIN_S = 0.12
# Quiet up to this long is sent at once: it is often a soft word ending.
QUIET_SENT_S = 0.6
# Digits are often misread, so numbers are spelled out.
PERCENT = {
    "en": "percent",
    "de": "Prozent",
    "fr": "pour cent",
    "es": "por ciento",
    "ru": "процентов",
}
NUMBER_RE = re.compile(r"(?<![\w.,])(\d{1,2}):(\d{2})(?!\d)|(?<![\w.,])\d+(?:[.,]\d+)*(?![\w])(\s*%)?")

logger = logging.getLogger("tts")


# Bounds a generation that does not stop; a step is 0.16 s.
STEPS_PER_CHAR = 1
MIN_STEPS = 40

TEMPERATURE = 0.7
FIRST_TEMPERATURE = 1.0
CFG_VALUE = 2.5


@dataclass
class Voice:
    latents: bytes


class EngineState:
    pool: VoxCPM
    sample_rate: int


state = EngineState()


@asynccontextmanager
async def lifespan(_: FastAPI):
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


@app.websocket("/synthesize")
async def synthesize(ws: WebSocket, lang: str = "") -> None:
    await ws.accept()
    try:
        voice = await receive_voice(ws)
    except WebSocketDisconnect:
        return
    if voice is None:
        await ws.send_json({"type": "error", "code": "invalid_voice"})
        await ws.close(code=1008)
        return

    await ws.send_json(
        {
            "type": "ready",
            "sampleRate": state.sample_rate,
            "encoding": "pcm_s16le",
        }
    )

    segments: asyncio.Queue[str | object | None] = asyncio.Queue()
    speaker = asyncio.create_task(speak(ws, voice, lang, segments))
    buffer: list[str] = []
    try:
        while True:
            try:
                message = await asyncio.wait_for(
                    receive_message(ws), FLUSH_IDLE_S if buffer else None
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
        with suppress(asyncio.CancelledError):
            await speaker


# The first message: {"type": "voice", "wav": base64 WAV}.
async def receive_voice(ws: WebSocket) -> Voice | None:
    message = await receive_message(ws)
    if message.get("type") != "voice" or not isinstance(message.get("wav"), str):
        return None
    try:
        wav = base64.b64decode(message["wav"], validate=True)
    except binascii.Error:
        return None
    if len(wav) > MAX_VOICE_WAV_BYTES or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return None
    try:
        return Voice(latents=await state.pool.encode_latents(wav, "wav"))
    except Exception:
        logger.exception("Could not encode the voice sample")
        return None


async def receive_message(ws: WebSocket) -> dict:
    try:
        message = await ws.receive_json()
    except (ValueError, KeyError):
        return {}
    return message if isinstance(message, dict) else {}


async def speak(
    ws: WebSocket, voice: Voice, lang: str, segments: asyncio.Queue
) -> bool:
    try:
        sample_rate = state.sample_rate
        following: str | object | None = NOTHING
        history: deque[Spoken] = deque()
        while True:
            text = await segments.get() if following is NOTHING else following
            following = NOTHING
            if text is None:
                break
            if text is WARMUP:
                # The same path as the first portion: the voice without a prompt.
                async with aclosing(
                    stream_speech(voice, WARMUP_TEXT, "", None)
                ) as chunks:
                    async for _ in chunks:
                        pass
                continue
            text, following = merge_queued(text, segments)
            text = spell_numbers(text, lang)
            # A continuation keeps its case.
            if not history:
                text = text[:1].upper() + text[1:]
            text = with_sentence_end(text)
            trimmer = EdgeSilenceTrimmer(sample_rate)
            sent: list[bytes] = []
            # The sample gives only the timbre: continuing it would carry its
            # language into the speech. Only this session's speech is continued.
            prompt_text = " ".join(h.text for h in history)
            prompt_latents = b"".join(h.latents for h in history) or None
            async with aclosing(
                stream_speech(voice, text, prompt_text, prompt_latents)
            ) as chunks:
                async for chunk in chunks:
                    for part in trimmer.feed(chunk):
                        pcm = to_pcm16(part)
                        sent.append(pcm)
                        await ws.send_bytes(pcm)
            await ws.send_json({"type": "segmentEnd"})
            await remember(history, text, b"".join(sent), sample_rate)
        return True
    except WebSocketDisconnect:
        return False
    except Exception:
        # A send to a client that has gone is not a synthesis failure.
        if WebSocketState.DISCONNECTED in (ws.client_state, ws.application_state):
            return False
        logger.exception("Synthesis failed")
        with suppress(Exception):
            await ws.send_json({"type": "error", "code": "synthesis_failed"})
            await ws.close(code=1011)
        return False


def merge_queued(text: str, segments: asyncio.Queue) -> tuple[str, object]:
    # Segments queued meanwhile are spoken as one generation.
    while True:
        try:
            following = segments.get_nowait()
        except asyncio.QueueEmpty:
            return text, NOTHING
        if not isinstance(following, str):
            return text, following
        if len(text) + 1 + len(following) > MAX_MERGED_CHARS:
            return text, following
        text = f"{text} {following}"


@dataclass
class Spoken:
    text: str
    latents: bytes
    seconds: float


async def remember(
    history: deque[Spoken], text: str, pcm: bytes, sample_rate: int
) -> None:
    if HISTORY_S <= 0 or not pcm:
        return
    latents = await state.pool.encode_latents(to_wav(pcm, sample_rate), "wav")
    history.append(Spoken(text, latents, len(pcm) / 2 / sample_rate))
    # The latest portion stays even when it alone is longer than HISTORY_S.
    while len(history) > 1 and sum(h.seconds for h in history) > HISTORY_S:
        history.popleft()


async def stream_speech(
    voice: Voice, text: str, prompt_text: str, prompt_latents: bytes | None
) -> AsyncIterator[np.ndarray]:
    text = " ".join(text.split())
    async for chunk in state.pool.generate(
        target_text=text,
        prompt_latents=prompt_latents,
        prompt_text=prompt_text,
        ref_audio_latents=voice.latents,
        max_generate_length=max(MIN_STEPS, len(text) * STEPS_PER_CHAR),
        temperature=TEMPERATURE if prompt_latents else FIRST_TEMPERATURE,
        cfg_value=CFG_VALUE,
    ):
        yield np.asarray(chunk, dtype=np.float32).ravel()


class EdgeSilenceTrimmer:
    def __init__(self, sample_rate: int) -> None:
        self.frame = max(1, int(sample_rate * SILENCE_FRAME_S))
        self.margin = int(sample_rate * SILENCE_MARGIN_S)
        self.quiet_limit = int(sample_rate * QUIET_SENT_S)
        self.started = False
        # Quiet beyond QUIET_SENT_S: a pause or the trailing silence.
        self.held = np.zeros(0, dtype=np.float32)
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


def with_sentence_end(text: str) -> str:
    return text if text.endswith(SENTENCE_END + PHRASE_END) else f"{text}."


def spell_numbers(text: str, lang: str) -> str:
    if lang not in PERCENT:
        return text

    def say(number: str) -> str:
        if lang == "en":
            number = number.replace(",", "")
        else:
            number = number.replace(".", "").replace(",", ".")
        value = float(number) if "." in number else int(number)
        return num2words(value, lang=lang)

    def replace(match: re.Match[str]) -> str:
        try:
            if match.group(1):
                return f"{say(match.group(1))} {say(match.group(2))}"
            sign = match.group(3) or ""
            words = say(match.group(0)[: len(match.group(0)) - len(sign)])
        except Exception:
            return match.group(0)
        return f"{words} {PERCENT[lang]}" if match.group(3) else words

    return NUMBER_RE.sub(replace, text)


def to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(sample_rate)
        file.writeframes(pcm)
    return buffer.getvalue()


def to_pcm16(chunk: np.ndarray) -> bytes:
    return (np.clip(chunk, -1.0, 1.0) * 32767).astype("<i2").tobytes()
