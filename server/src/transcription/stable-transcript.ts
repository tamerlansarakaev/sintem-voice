import { joinText, splitWords } from '../translation/text.js';

// Meta only appends words to partials; a revised published word is ignored.
export class StableTranscript {
  private finishedTurns = '';
  private published: string[] = [];

  get stable(): string {
    return joinText(this.finishedTurns, this.published.join(' '));
  }

  addPartial(text: string): void {
    this.published.push(...splitWords(text).slice(this.published.length));
  }

  completeTurn(text: string): void {
    this.addPartial(text);
    this.finishedTurns = this.stable;
    this.published = [];
  }
}
