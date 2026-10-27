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

// One synthesis stream of the ml/tts service. Text sent before the
// service is ready is queued. The service keeps voices in memory only, so
// after its restart the voice is registered again and the stream reopened.
export class TtsSession {
  private readonly logger = new Logger(TtsSession.name);
  private socket?: WebSocket;
  private pending: string[] = [];
  private ready = false;
  private reregistered = false;
  private closed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly voice: VoiceSample,
    private readonly handlers: TtsHandlers,
  ) {
    this.connect();
  }

  // One portion of text, spoken as one phrase.
  speak(text: string): void {
    this.send({ type: 'text', text });
    this.send({ type: 'flush' });
  }

  end(): void {
    this.send({ type: 'end' });
  }

  close(): void {
    this.closed = true;
    this.pending = [];
    this.socket?.close();
  }

  private connect(): void {
    const url = new URL(
      `/synthesize/${encodeURIComponent(this.voice.key)}`,
      this.baseUrl,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;

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

  private handleMessage(socket: WebSocket, message: TtsMessage): void {
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
        if (message.code === 'voice_not_registered' && !this.reregistered) {
          this.reregistered = true;
          this.reconnect();
        } else {
          this.closed = true;
          this.handlers.onError(message.code);
        }
        break;
    }
  }

  private reconnect(): void {
    // Detach the old socket so its close does not end the session.
    const old = this.socket;
    this.socket = undefined;
    old?.close();
    this.register()
      .then(() => {
        if (!this.closed) this.connect();
      })
      .catch((err: Error) => {
        this.closed = true;
        this.handlers.onError(`Voice registration failed: ${err.message}`);
      });
  }

  private async register(): Promise<void> {
    const url = new URL(
      `/voices/${encodeURIComponent(this.voice.key)}`,
      this.baseUrl,
    );
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: this.voice.text,
        wav: this.voice.wav.toString('base64'),
      }),
    });
    if (!response.ok) throw new Error(`responded ${response.status}`);
  }

  private send(payload: object): void {
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

  createSession(voice: VoiceSample, handlers: TtsHandlers): TtsSession {
    if (!this.baseUrl) throw new Error('TTS_URL is not set');
    return new TtsSession(this.baseUrl, voice, handlers);
  }
}
