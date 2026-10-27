import asyncio
import base64
import binascii
import logging
import os
import re
import tempfile
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from huggingface_hub import snapshot_download
from pydantic import BaseModel, Field

MODEL_REPO = os.environ.get("MODEL_REPO", "openbmb/VoxCPM2")
# Pinned commit, so the weights never change under us.
MODEL_REVISION = os.environ["MODEL_REVISION"]

# The buffer is spoken after this much time without new text.
FLUSH_IDLE_S = 0.5
MAX_VOICE_WAV_BYTES = 2 * 1024 * 1024
MAX_VOICE_TEXT_CHARS = 2000
VOICE_ID_RE = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
# Without final punctuation the model tends to cut off the last word.
SENTENCE_END = (".", "!", "?", "…")

logger = logging.getLogger("tts")


@dataclass
class Voice:
    wav_path: Path
    text: str


class ModelState:
    model = None
    error: str | None = None


state = ModelState()
# Voice samples live only in memory and a temp dir. After a restart the
# backend gets voice_not_registered and registers the voice again.
voices: dict[str, Voice] = {}
voices_dir = Path(tempfile.mkdtemp(prefix="voices-"))
# The model is not known to be thread-safe, so one generation at a time.
gpu_lock = threading.Lock()


def load_model() -> None:
    try:
        # Cached in HF_HOME (the /models volume), downloads only once.
        model_dir = snapshot_download(MODEL_REPO, revision=MODEL_REVISION)
        from voxcpm import VoxCPM

        state.model = VoxCPM.from_pretrained(model_dir, load_denoiser=False)
        logger.info("Model %s@%s loaded", MODEL_REPO, MODEL_REVISION)
    except Exception as exc:
        logger.exception("Model failed to load")
        state.error = str(exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load in the background so /health answers 503 during the download.
    threading.Thread(target=load_model, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    if state.error is not None:
        return JSONResponse({"status": "error"}, status_code=500)
    if state.model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
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

    # voxcpm takes a file path, write it atomically.
    path = voices_dir / f"{voice_id}.wav"
    tmp = path.with_suffix(".part")
    tmp.write_bytes(wav)
    os.replace(tmp, path)
    voices[voice_id] = Voice(wav_path=path, text=sample.text)
    return Response(status_code=204)


@app.websocket("/synthesize/{voice_id}")
async def synthesize(ws: WebSocket, voice_id: str) -> None:
    await ws.accept()
    if state.model is None:
        await ws.close(code=1013)
        return
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
    segments: asyncio.Queue[str | None] = asyncio.Queue()
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
        while (text := await segments.get()) is not None:
            async for chunk in stream_speech(voice, with_sentence_end(text)):
                await ws.send_bytes(to_pcm16(chunk))
            await ws.send_json({"type": "segmentEnd"})
        return True
    except WebSocketDisconnect:
        return False
    except Exception:
        logger.exception("Synthesis failed")
        await ws.send_json({"type": "error", "code": "synthesis_failed"})
        await ws.close(code=1011)
        return False


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
                for chunk in state.model.generate_streaming(
                    text=text,
                    prompt_wav_path=str(voice.wav_path),
                    prompt_text=voice.text,
                    reference_wav_path=str(voice.wav_path),
                ):
                    if stop.is_set():
                        break
                    put(chunk)
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


def with_sentence_end(text: str) -> str:
    return text if text.endswith(SENTENCE_END) else f"{text}."


def to_pcm16(chunk: np.ndarray) -> bytes:
    return (np.clip(chunk, -1.0, 1.0) * 32767).astype("<i2").tobytes()
