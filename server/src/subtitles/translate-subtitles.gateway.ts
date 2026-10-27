import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket, type RawData } from 'ws';
import {
  MetaTranscribeService,
  type MetaTranscribeEvent,
  type MetaTranscribeSession,
} from '../transcription/meta-transcribe.service.js';
import {
  closeCode,
  keepAlive,
  send,
  toBuffer,
} from '../transcription/ws.utils.js';

// Live subtitles for system audio captured by the client.
// In: binary PCM s16le 16 kHz mono, then {"type":"endStream"}.
// Out: {"type":"ready"}, then Meta events (transcript, speechEnd, ...).
@WebSocketGateway({ path: '/translate-subtitles' })
export class TranslateSubtitlesGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TranslateSubtitlesGateway.name);

  constructor(private readonly metaTranscribe: MetaTranscribeService) {}

  handleConnection(client: WebSocket): void {
    let session: MetaTranscribeSession;
    try {
      session = this.metaTranscribe.createSession({
        onReady: (sessionId) => send(client, { type: 'ready', sessionId }),
        onEvent: (event) => this.handleTranscript(client, event),
        onClose: (code, reason) => {
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

    client.on('close', () => session.close());
    keepAlive(client);
  }

  // TODO: translate transcript text here before sending it to the client.
  private handleTranscript(
    client: WebSocket,
    event: MetaTranscribeEvent,
  ): void {
    send(client, event);
  }
}
