import { getPref } from './prefs';

// Served next to the page from public/.
const WORKLET_URL = 'pcm-worklet.js';
// Head start before the first chunk, against network jitter.
const START_BUFFER_S = 0.12;
// Head start after the queue ran dry mid-speech.
const REFILL_BUFFER_S = 0.05;
const PLAYBACK_SAMPLE_RATE = 48000;
// Mixed under the translation when "Mix original microphone" is on.
const MIX_GAIN = 0.5;

export interface Microphone {
  stop(): void;
  stream: MediaStream;
}

// Posts mono s16le PCM chunks of `stream` at `sampleRate`.
export async function streamPcm(
  stream: MediaStream,
  sampleRate: number,
  onChunk: (chunk: ArrayBuffer) => void,
) {
  const audioContext = new AudioContext({ sampleRate });
  try {
    await audioContext.audioWorklet.addModule(WORKLET_URL);
  } catch (err) {
    audioContext.close();
    throw err;
  }
  const worklet = new AudioWorkletNode(audioContext, 'pcm-worklet', {
    numberOfOutputs: 0,
  });
  worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => onChunk(data);
  audioContext.createMediaStreamSource(stream).connect(worklet);
  return audioContext;
}

// Streams the microphone chosen in Settings as mono s16le PCM chunks.
export async function startMicrophone(
  sampleRate: number,
  onChunk: (chunk: ArrayBuffer) => void,
): Promise<Microphone> {
  const deviceId = getPref('inputMic');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId && { deviceId: { ideal: deviceId } }),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  let audioContext: AudioContext;
  try {
    audioContext = await streamPcm(stream, sampleRate, onChunk);
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    throw err;
  }

  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
  };
  return { stop, stream };
}

// Loudness of an s16le chunk, 0..1, scaled for the wave animation.
export function chunkLevel(chunk: ArrayBuffer) {
  const pcm = new Int16Array(chunk);
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 0x8000) ** 2;
  return Math.min(1, Math.sqrt(sum / (pcm.length || 1)) * 6);
}

// 16-bit mono PCM WAV with the plain 44-byte header.
export function encodeWav(chunks: ArrayBuffer[], sampleRate: number) {
  const dataBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    wav.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return wav;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  // In slices: String.fromCharCode cannot take a megabyte of arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// Length of a WAV from encodeWav, read from its header.
export function wavSeconds(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const bytesPerSecond = view.getUint32(28, true);
  return bytesPerSecond ? view.getUint32(40, true) / bytesPerSecond : 0;
}

export interface Player {
  setSampleRate(rate: number): void;
  play(data: ArrayBuffer): void;
  mix(stream: MediaStream): void;
  close(): void;
  // What the server sent as a WAV, each chunk at the moment it was scheduled
  // to play and silence in between, or null before any audio.
  recording(): Uint8Array | null;
}

export function createPlayer(
  sinkId: string | undefined,
  onLevel: (level: number) => void,
): Player {
  const audioContext = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
  if (sinkId) audioContext.setSinkId(sinkId).catch(() => {});
  let sampleRate = 48000;
  let nextTime = 0;
  const scheduled: { start: number; pcm: Int16Array }[] = [];

  return {
    setSampleRate(rate) {
      sampleRate = rate;
    },
    play(data) {
      const pcm = new Int16Array(data);
      if (pcm.length === 0) return;
      const buffer = audioContext.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      const now = audioContext.currentTime;
      if (nextTime < now) {
        nextTime = now + (nextTime === 0 ? START_BUFFER_S : REFILL_BUFFER_S);
      }
      source.start(nextTime);
      scheduled.push({ start: nextTime, pcm });
      const level = chunkLevel(data);
      setTimeout(() => onLevel(level), (nextTime - now) * 1000);
      source.addEventListener('ended', () => {
        if (audioContext.currentTime >= nextTime - 0.05) onLevel(0);
      });
      nextTime += buffer.duration;
    },
    // The raw microphone plays into the same output.
    mix(stream) {
      const gain = audioContext.createGain();
      gain.gain.value = MIX_GAIN;
      audioContext.createMediaStreamSource(stream).connect(gain);
      gain.connect(audioContext.destination);
    },
    close() {
      const left = Math.max(0, nextTime - audioContext.currentTime);
      setTimeout(() => audioContext.close(), left * 1000 + 200);
    },
    recording() {
      if (scheduled.length === 0) return null;
      const first = scheduled[0].start;
      const offsetOf = (start: number) => Math.round((start - first) * sampleRate);
      const last = scheduled[scheduled.length - 1];
      const timeline = new Int16Array(offsetOf(last.start) + last.pcm.length);
      for (const { start, pcm } of scheduled) timeline.set(pcm, offsetOf(start));
      return encodeWav([timeline.buffer], sampleRate);
    },
  };
}
