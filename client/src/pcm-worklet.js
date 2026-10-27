// Runs in an AudioContext at the target rate (16 kHz for streaming), so
// Chromium has already resampled the input. Downmixes to mono and posts
// s16le PCM in chunks of CHUNK_SAMPLES (~100 ms at 16 kHz).
const CHUNK_SAMPLES = 1600;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.length = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      this.chunk[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this.length === CHUNK_SAMPLES) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(CHUNK_SAMPLES);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
