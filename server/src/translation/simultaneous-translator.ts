import { Logger } from '@nestjs/common';
import type { TranslateFn, TranslateRequest } from './translate.service.js';
import {
  commonPrefixLength,
  completeWords,
  findSentenceEnd,
  splitWords,
  stripSentenceEnd,
} from './text.js';

const MAX_QUEUE_CHARS = 1000;
const MAX_CONTEXT_CHARS = 500;
const ERROR_INTERVAL_MS = 5000;

export interface TranslatorEvents {
  // Replaces the previous draft of the current segment.
  draft(text: string): void;
  final(text: string): void;
  // The segment failed to translate and was dropped.
  skipped?(): void;
  error(message: string): void;
}

interface Segment {
  kind: 'draft' | 'final' | 'pause';
  text: string;
  // Source characters this segment covers, counted from the cursor.
  length: number;
}

// Sentences and pauses are translated finally, the rest as drafts whose
// words are confirmed once two drafts in a row agree.
export class SimultaneousTranslator {
  private readonly logger = new Logger(SimultaneousTranslator.name);
  private source = '';
  private cursor = 0;
  private context = '';
  private paused = false;
  private pauseTranslated = false;
  private draining = false;
  private closed = false;

  private confirmed: string[] = [];
  private previousDraft: string[] | null = null;
  private lastDraftText = '';

  private busy = false;
  private abort?: AbortController;
  private idleWaiters: (() => void)[] = [];
  private lastErrorAt = 0;

  constructor(
    private readonly translate: TranslateFn,
    private readonly languages: { source: string; target: string },
    private readonly events: TranslatorEvents,
  ) {}

  updateSource(stable: string) {
    // Stable text only grows; anything else is ignored.
    if (stable !== this.source && stable.startsWith(this.source)) {
      this.source = stable;
      this.pauseTranslated = false;
    }
    this.runNext();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.pauseTranslated = false;
    this.runNext();
  }

  // Translates what is left, then closes.
  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    this.runNext();
    await Promise.race([
      new Promise<void>((resolve) =>
        this.busy ? this.idleWaiters.push(resolve) : resolve(),
      ),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    this.close();
  }

  close() {
    this.closed = true;
    this.abort?.abort();
    this.notifyIdle();
  }

  private nextSegment(): Segment | null {
    const rest = this.source.slice(this.cursor);
    const queue = rest.trimStart();
    const offset = rest.length - queue.length;
    if (!queue) return null;

    let end = findSentenceEnd(queue);
    if (end < 0 && queue.length >= MAX_QUEUE_CHARS)
      end = queue.search(/\s\S*$/);
    if (end > 0) {
      return { kind: 'final', text: queue.slice(0, end), length: offset + end };
    }
    const pause = this.paused && !this.pauseTranslated;
    if (this.draining || pause) {
      return { kind: 'pause', text: queue.trimEnd(), length: rest.length };
    }
    if (queue !== this.lastDraftText) {
      return { kind: 'draft', text: queue, length: 0 };
    }
    return null;
  }

  private runNext() {
    if (this.busy || this.closed) return;
    const segment = this.nextSegment();
    if (!segment) {
      this.notifyIdle();
      return;
    }

    this.busy = true;
    this.abort = new AbortController();
    const request: TranslateRequest = {
      ...this.languages,
      text: segment.text,
      prefill: this.confirmed.join(' '),
      signal: this.abort.signal,
    };
    const run = {
      draft: () => this.translateDraft(request),
      pause: () => this.translatePause(segment, request),
      final: () => this.translateFinal(segment, request),
    }[segment.kind];

    run()
      .catch((err: Error) => this.handleError(segment, err))
      .finally(() => {
        this.busy = false;
        this.runNext();
      });
  }

  private async translateDraft(request: TranslateRequest): Promise<void> {
    this.lastDraftText = request.text;
    const translation = await this.translate({
      ...request,
      onText: (text) => this.confirmAgreedWords(completeWords(text)),
    });
    if (this.closed) return;
    const words = splitWords(translation);
    this.confirmAgreedWords(words);
    this.previousDraft = words;
  }

  // Not confirmed word by word: speech may resume and void the result.
  private async translatePause(segment: Segment, request: TranslateRequest) {
    this.pauseTranslated = true;
    const sourceBefore = this.source;
    const translation = await this.translate({
      ...request,
      context: this.context,
    });
    if (this.closed) return;
    const stillPaused = this.paused && this.source === sourceBefore;
    if (this.draining || stillPaused) this.finishSegment(segment, translation);
    else this.lastDraftText = '';
  }

  private async translateFinal(segment: Segment, request: TranslateRequest) {
    const translation = await this.translate({
      ...request,
      context: this.context,
    });
    if (!this.closed) this.finishSegment(segment, translation);
  }

  private confirmAgreedWords(words: string[]) {
    if (this.closed || !this.previousDraft) return;
    let agreed = commonPrefixLength(this.previousDraft, words);
    // A word ending in a comma waits for the next one: confirmed, the comma
    // makes the model continue with a clause the source may not have.
    if (agreed > 0 && /[,;:]$/.test(words[agreed - 1])) agreed--;
    if (agreed <= this.confirmed.length) return;
    // Sentence-final punctuation waits for the final translation.
    const added = words
      .slice(this.confirmed.length, agreed)
      .map(stripSentenceEnd);
    this.confirmed.push(...added);
    this.events.draft(this.confirmed.join(' '));
  }

  private finishSegment(segment: Segment, translation?: string) {
    if (translation !== undefined) this.events.final(translation);
    else this.events.skipped?.();
    this.cursor += segment.length;
    this.context = segment.text.slice(-MAX_CONTEXT_CHARS);
    this.confirmed = [];
    this.previousDraft = null;
    this.lastDraftText = '';
  }

  private handleError(segment: Segment, err: Error) {
    if (this.closed) return;
    // Skip an untranslatable segment instead of retrying it forever.
    if (segment.kind !== 'draft') this.finishSegment(segment);
    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_INTERVAL_MS) return;
    this.lastErrorAt = now;
    // Never log the speech itself.
    this.logger.warn(`${segment.kind} translation failed: ${err.message}`);
    this.events.error('Translation is unavailable');
  }

  private notifyIdle() {
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
