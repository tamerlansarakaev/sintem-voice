import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket, type RawData } from 'ws';
import {
  MetaTranscribeService,
  type MetaTranscribeSession,
} from './meta-transcribe.service.js';
import { closeCode, keepAlive, send, toBuffer } from './ws.utils.js';

// In: binary PCM s16le 16 kHz mono, then {"type":"endStream"}. Out: Meta events.
@WebSocketGateway({ path: '/transcribe' })
export class TranscriptionGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TranscriptionGateway.name);

  constructor(private readonly metaTranscribe: MetaTranscribeService) {}

  handleConnection(client: WebSocket): void {
    let session: MetaTranscribeSession;
    try {
      session = this.metaTranscribe.createSession({
        onReady: (sessionId) => send(client, { type: 'ready', sessionId }),
        onEvent: (event) => send(client, event),
        onClose: (code, reason) => {
          if (client.readyState !== WebSocket.OPEN) return;
          client.close(closeCode(code), reason);
        },
      });
    } catch (err) {
      this.logger.error((err as Error).message);
      client.close(1011, 'Transcription is unavailable');
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
}
