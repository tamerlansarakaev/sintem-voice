import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket, type RawData } from 'ws';

// https://dev.meta.ai/docs/speech-to-text
const META_REALTIME_URL = 'wss://api.meta.ai/v1/asr/realtime';
const META_TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';
// Meta is billed while the session is open, so endStream must not hang.
const END_STREAM_TIMEOUT_MS = 10_000;

// Server events from Meta: speechStart, transcript, speechEnd,
// speechComplete, audioProgress, error. Unknown types must be ignored.
export interface MetaTranscribeEvent {
  type: string;
  [key: string]: unknown;
}

export interface MetaTranscribeHandlers {
  onReady(sessionId: string): void;
  onEvent(event: MetaTranscribeEvent): void;
  onClose(code: number, reason: string): void;
}

export class MetaTranscribeSession {
  private readonly logger = new Logger(MetaTranscribeSession.name);
  private readonly socket: WebSocket;
  // Audio that arrives before Meta acknowledges the handshake.
  private pending: Buffer[] = [];
  private ready = false;
  private endRequested = false;
  private sessionId?: string;
  private endTimer?: NodeJS.Timeout;

  constructor(
    apiKey: string,
    private readonly handlers: MetaTranscribeHandlers,
  ) {
    this.socket = new WebSocket(META_REALTIME_URL);

    this.socket.on('open', () => {
      // Auth goes in the first text frame, the Authorization header is ignored.
      this.socket.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${apiKey}` },
          model: META_TRANSCRIBE_MODEL,
          audioEncoding: 'PCM_16KHZ',
          mode: 'ENDPOINTING',
          partialMode: 'CUMULATIVE',
          emitAudioProgress: false,
        }),
      );
    });

    this.socket.on('message', (data, isBinary) => {
      if (!isBinary) this.handleMessage(data);
    });

    this.socket.on('error', (err) => {
      this.logger.error(`Meta realtime socket error: ${err.message}`);
    });

    this.socket.on('close', (code, reason) => {
      clearTimeout(this.endTimer);
      this.pending = [];
      this.logger.log(
        `Meta session ${this.sessionId ?? '(no handshake)'} closed: ${code}`,
      );
      this.handlers.onClose(code, reason.toString());
    });
  }

  // Raw PCM: signed 16-bit little-endian, mono, 16 kHz. Frame size is free.
  sendAudio(chunk: Buffer): void {
    if (this.endRequested) return;
    if (!this.ready) {
      this.pending.push(chunk);
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(chunk);
  }

  // Meta flushes the remaining results and closes with 1000.
  end(): void {
    if (this.endRequested) return;
    this.endRequested = true;
    if (this.ready) this.sendEndStream();
    this.endTimer = setTimeout(() => this.close(), END_STREAM_TIMEOUT_MS);
  }

  close(): void {
    this.pending = [];
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(1000);
    }
  }

  private handleMessage(data: RawData): void {
    let message: MetaTranscribeEvent & { sessionId?: string };
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.logger.warn('Non-JSON text frame from Meta realtime');
      return;
    }

    // The handshake ack is the only frame without a `type`.
    if (!message.type) {
      if (message.sessionId && !this.ready)
        this.onHandshakeAck(message.sessionId);
      return;
    }

    this.handlers.onEvent(message);
  }

  private onHandshakeAck(sessionId: string): void {
    this.ready = true;
    this.sessionId = sessionId;
    this.logger.log(`Meta session ${sessionId} opened`);
    for (const chunk of this.pending) this.socket.send(chunk);
    this.pending = [];
    this.handlers.onReady(sessionId);
    if (this.endRequested) this.sendEndStream();
  }

  private sendEndStream(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'endStream' }));
    }
  }
}

@Injectable()
export class MetaTranscribeService {
  constructor(private readonly config: ConfigService) {}

  createSession(handlers: MetaTranscribeHandlers): MetaTranscribeSession {
    const apiKey = this.config.getOrThrow<string>('META_API_KEY');
    return new MetaTranscribeSession(apiKey, handlers);
  }
}
