import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildMessages, type PromptInput } from './prompt.js';

const GENERATION = {
  n_predict: 512,
  temperature: 0,
  seed: 42,
  cache_prompt: true,
};
const REQUEST_TIMEOUT_MS = 30_000;

export interface TranslateRequest extends PromptInput {
  // Confirmed start of the answer that the model continues.
  prefill?: string;
  signal: AbortSignal;
  onText?(text: string): void;
}

export type TranslateFn = (request: TranslateRequest) => Promise<string>;

// Translate Gemma served by llama-server (llama.cpp).
@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);
  private readonly baseUrl?: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('TRANSLATE_URL') || undefined;
    if (!this.baseUrl) {
      this.logger.warn(
        'TRANSLATE_URL is not set, subtitles are not translated',
      );
    }
  }

  get enabled(): boolean {
    return this.baseUrl !== undefined;
  }

  // Returns prefill + continuation, so confirmed words are always kept.
  readonly translate: TranslateFn = async (request) => {
    const { text, prefill = '', source, target, onText } = request;
    if (source === target) return text;

    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ]);
    // The model's own chat template, so any model works. Thinking is off:
    // reasoning-budget does not apply to /completion, and on fragments the
    // model would otherwise reason before translating.
    const messages = buildMessages(request);
    const template = await this.post(
      '/apply-template',
      { messages, chat_template_kwargs: { enable_thinking: false } },
      signal,
    );
    const { prompt } = (await template.json()) as { prompt: string };

    const response = await this.post(
      '/completion',
      { ...GENERATION, prompt: prompt + prefill, stream: true },
      signal,
    );
    let generated = '';
    for await (const chunk of readEventStream(response)) {
      generated += chunk.content ?? '';
      onText?.(prefill + generated);
      if (chunk.stop) break;
    }
    return (prefill + generated).trim();
  };

  private async post(path: string, body: object, signal: AbortSignal) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`llama-server ${path} responded ${response.status}`);
    }
    return response;
  }
}

async function* readEventStream(response: Response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body!) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        yield JSON.parse(line.slice(6)) as { content?: string; stop?: boolean };
      }
    }
  }
}
