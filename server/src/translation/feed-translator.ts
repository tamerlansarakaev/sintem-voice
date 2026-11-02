import type { MetaTranscribeEvent } from '../transcription/meta-transcribe.service.js';
import type { StableTranscript } from '../transcription/stable-transcript.js';
import type { SimultaneousTranslator } from './simultaneous-translator.js';

// Feeds Meta events to the translator. speechComplete is the pause: the
// whole turn is stable by then.
export function feedTranslator(
  event: MetaTranscribeEvent,
  transcript: StableTranscript,
  translator: SimultaneousTranslator,
): void {
  switch (event.type) {
    case 'speechStart':
      translator.setPaused(false);
      break;
    case 'transcript':
      transcript.addPartial(String(event.transcript ?? ''));
      translator.updateSource(transcript.stable);
      break;
    case 'speechComplete':
      transcript.completeTurn(String(event.transcript ?? ''));
      translator.updateSource(transcript.stable);
      translator.setPaused(true);
      break;
  }
}
