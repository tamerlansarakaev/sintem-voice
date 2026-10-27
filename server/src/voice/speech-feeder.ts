import { splitWords } from '../translation/text.js';

// Fewer words sound unnatural: the synthesizer needs a phrase.
const MIN_WORDS = 3;

// Turns the confirmed translation into portions for the synthesizer.
// Text given to the synthesizer cannot be taken back, so only confirmed
// words go there: a draft once it has MIN_WORDS new words, a finished
// segment always with its whole rest.
export class SpeechFeeder {
  // Words of the current segment already given to the synthesizer.
  private spoken = 0;

  constructor(private readonly speak: (text: string) => void) {}

  // Confirmed start of the current segment's translation.
  draft(text: string): void {
    const words = splitWords(text);
    if (words.length - this.spoken < MIN_WORDS) return;
    this.speak(words.slice(this.spoken).join(' '));
    this.spoken = words.length;
  }

  // Starts with the confirmed words, which were used as its prefill.
  final(text: string): void {
    const rest = splitWords(text).slice(this.spoken);
    this.spoken = 0;
    if (rest.length) this.speak(rest.join(' '));
  }

  skip(): void {
    this.spoken = 0;
  }
}
