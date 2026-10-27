import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket, type RawData } from 'ws';
import {
  MetaTranscribeService,
  type MetaTranscribeSession,
} from '../transcription/meta-transcribe.service.js';
import { StableTranscript } from '../transcription/stable-transcript.js';
import {
  closeCode,
  keepAlive,
  send,
  toBuffer,
} from '../transcription/ws.utils.js';
import { feedTranslator } from '../translation/feed-translator.js';
import { LANGUAGES } from '../translation/prompt.js';
import { SimultaneousTranslator } from '../translation/simultaneous-translator.js';
import { TranslateService } from '../translation/translate.service.js';

// The translator cannot detect the language, so there is no "auto".
const DEFAULT_SOURCE = 'en';
const DEFAULT_TARGET = 'ru';
const DRAIN_TIMEOUT_MS = 5000;

// URL: /translate-subtitles?source=en&target=ru
// In: binary PCM s16le 16 kHz mono, then {"type":"endStream"}.
// Out: {"type":"ready"}, Meta events and, with TRANSLATE_URL set,
// {"type":"translationDraft"|"translationFinal","text"}.
@WebSocketGateway({ path: '/translate-subtitles' })
export class TranslateSubtitlesGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TranslateSubtitlesGateway.name);

  constructor(
    private readonly metaTranscribe: MetaTranscribeService,
    private readonly translateService: TranslateService,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const target = params.get('target') ?? DEFAULT_TARGET;
    const source = params.get('source') ?? DEFAULT_SOURCE;
    if (!LANGUAGES[source] || !LANGUAGES[target]) {
      client.close(1008, 'Unsupported language');
      return;
    }

    const transcript = new StableTranscript();
    const translator = this.translateService.enabled
      ? new SimultaneousTranslator(
          this.translateService.translate,
          { source, target },
          {
            draft: (text) => send(client, { type: 'translationDraft', text }),
            final: (text) => send(client, { type: 'translationFinal', text }),
            error: (message) => send(client, { type: 'error', message }),
          },
        )
      : undefined;

    let session: MetaTranscribeSession;
    try {
      session = this.metaTranscribe.createSession({
        onReady: (sessionId) => send(client, { type: 'ready', sessionId }),
        onEvent: (event) => {
          send(client, event);
          if (translator) feedTranslator(event, transcript, translator);
        },
        onClose: async (code, reason) => {
          // Let the last phrase finish translating after endStream.
          await translator?.drain(DRAIN_TIMEOUT_MS);
          if (client.readyState !== WebSocket.OPEN) return;
          client.close(closeCode(code), reason);
        },
      });
    } catch (err) {
      this.logger.error((err as Error).message);
      client.close(1011, 'Subtitles are unavailable');
      return;
    }

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        session.sendAudio(toBuffer(data));
        return;
      }
      try {
        if (JSON.parse(data.toString()).type === 'endStream') session.end();
      } catch {
        // Ignore malformed control frames.
      }
    });

    client.on('close', () => {
      session.close();
      translator?.close();
    });
    keepAlive(client);
  }
}
