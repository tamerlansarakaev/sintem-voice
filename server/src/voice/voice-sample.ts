import { createHash } from 'node:crypto';

// About 11 s of 44.1 kHz mono 16-bit audio plus the header.
const MAX_WAV_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 2000;

export interface VoiceSample {
  // Derived from the audio, so the TTS reuses a voice it already has
  // and never mixes up two different samples.
  key: string;
  wav: Buffer;
  // What the user read in the sample.
  text: string;
}

// The client keeps the sample and sends it as the first message:
// {"type":"voice","text": what was read,"wav": base64 WAV}.
export function parseVoiceSample(message: {
  text?: unknown;
  wav?: unknown;
}): VoiceSample | undefined {
  const { text, wav } = message;
  if (typeof text !== 'string' || typeof wav !== 'string') return undefined;
  if (!text.trim() || text.length > MAX_TEXT_CHARS) return undefined;

  const audio = Buffer.from(wav, 'base64');
  if (!isWav(audio) || audio.length > MAX_WAV_BYTES) return undefined;

  const hash = createHash('sha256').update(audio).update(text).digest('hex');
  return { key: `voice-${hash.slice(0, 24)}`, wav: audio, text };
}

function isWav(data: Buffer): boolean {
  return (
    data.length > 44 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WAVE'
  );
}
