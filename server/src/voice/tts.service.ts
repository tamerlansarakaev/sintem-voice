import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket } from 'ws';
import { toBuffer } from '../transcription/ws.utils.js';
import type { VoiceSample } from './voice-sample.js';

export interface TtsHandlers {
  onReady(sampleRate: number): void;
  // Mono PCM s16le at the sample rate from onReady.
  onAudio(chunk: Buffer): void;
  // Everything sent before end() is spoken.
  onDone(): void;
  onError(reason: string): void;
}

// One synthesis stream of the ml/tts service. The voice goes first and
// the service keeps it only for this stream. Text sent before the service
// is ready is queued.
export class TtsSession {
  private readonly logger = new Logger(TtsSession.name);
  private socket?: WebSocket;
  private pending: string[] = [];
  private ready = false;
  private closed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly voice: VoiceSample,
    // Language of the text, so numbers are read in it.
    private readonly language: string,
    private readonly handlers: TtsHandlers,
  ) {
    this.connect();
  }

  // One portion of text, spoken as one phrase.
  speak(text: string) {
    this.send({ type: 'text', text });
    this.send({ type: 'flush' });
  }

  // Synthesizes a phrase that is not played, so the first real one does not
  // wait for the service to wake up.
  warmUp() {
    this.send({ type: 'warmup' });
  }

  end() {
    this.send({ type: 'end' });
  }

  close() {
    this.closed = true;
    this.pending = [];
    this.socket?.close();
  }

  private connect() {
    const url = new URL('/synthesize', this.baseUrl);
    url.searchParams.set('lang', this.language);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'voice',
          wav: this.voice.wav.toString('base64'),
        }),
      );
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.handlers.onAudio(toBuffer(data));
        return;
      }
      this.handleMessage(socket, JSON.parse(data.toString()) as TtsMessage);
    });
    socket.on('error', (err) => {
      this.logger.error(`TTS socket error: ${err.message}`);
    });
    socket.on('close', (code) => {
      if (socket !== this.socket || this.closed) return;
      this.closed = true;
      this.handlers.onError(`TTS closed with ${code}`);
    });
  }

  private handleMessage(socket: WebSocket, message: TtsMessage) {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.handlers.onReady(message.sampleRate);
        for (const frame of this.pending) socket.send(frame);
        this.pending = [];
        break;
      case 'done':
        this.handlers.onDone();
        break;
      case 'error':
        this.closed = true;
        this.handlers.onError(message.code);
        break;
    }
  }

  private send(payload: object) {
    if (this.closed) return;
    const frame = JSON.stringify(payload);
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    } else {
      this.pending.push(frame);
    }
  }
}

type TtsMessage =
  | { type: 'ready'; sampleRate: number }
  | { type: 'segmentEnd' }
  | { type: 'done' }
  | { type: 'error'; code: string };

// VoxCPM2 served by ml/tts.
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly baseUrl?: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('TTS_URL') || undefined;
    if (!this.baseUrl) {
      this.logger.warn('TTS_URL is not set, voice translation is disabled');
    }
  }

  get enabled(): boolean {
    return this.baseUrl !== undefined;
  }

  createSession(
    voice: VoiceSample,
    language: string,
    handlers: TtsHandlers,
  ): TtsSession {
    if (!this.baseUrl) throw new Error('TTS_URL is not set');
    return new TtsSession(this.baseUrl, voice, language, handlers);
  }
}
