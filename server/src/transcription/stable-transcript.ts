import { joinText, splitWords } from '../translation/text.js';

// Meta only appends to partials, so every word but the newest is stable.
// Published words are frozen anyway: if Meta ever revised one, the stable
// text would stop growing as a prefix and the translator would ignore it.
export class StableTranscript {
  private finishedTurns = '';
  private published: string[] = [];
  private draftWords = 0;

  get stable(): string {
    return joinText(this.finishedTurns, this.published.join(' '));
  }

  get hasDraft(): boolean {
    return this.draftWords > 0;
  }

  addPartial(text: string): void {
    const words = splitWords(text);
    this.published.push(...words.slice(this.published.length, -1));
    this.draftWords = Math.max(words.length - this.published.length, 0);
  }

  completeTurn(text: string): void {
    const rest = splitWords(text).slice(this.published.length);
    this.finishedTurns = joinText(this.stable, rest.join(' '));
    this.published = [];
    this.draftWords = 0;
  }
}
