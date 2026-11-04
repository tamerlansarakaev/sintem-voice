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
  sendMetaError,
  toBuffer,
} from '../transcription/ws.utils.js';
import { feedTranslator } from '../translation/feed-translator.js';
import { LANGUAGES } from '../translation/prompt.js';
import { SimultaneousTranslator } from '../translation/simultaneous-translator.js';
import { TranslateService } from '../translation/translate.service.js';
import { SpeechFeeder } from './speech-feeder.js';
import { TtsService, type TtsSession } from './tts.service.js';
import { parseVoiceSample, type VoiceSample } from './voice-sample.js';

const DEFAULT_SOURCE = 'ru';
const DEFAULT_TARGET = 'en';
const VOICE_TIMEOUT_MS = 10_000;
const DRAIN_TIMEOUT_MS = 5000;
// The rest of the speech still has to be synthesized after the stop.
const SPEECH_TIMEOUT_MS = 30_000;

interface Pipeline {
  session: MetaTranscribeSession;
  translator: SimultaneousTranslator;
  speech: TtsSession;
}

@WebSocketGateway({ path: '/translate-voice' })
export class TranslateVoiceGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TranslateVoiceGateway.name);

  constructor(
    private readonly metaTranscribe: MetaTranscribeService,
    private readonly translateService: TranslateService,
    private readonly tts: TtsService,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const source = params.get('source') ?? DEFAULT_SOURCE;
    const target = params.get('target') ?? DEFAULT_TARGET;
    if (!LANGUAGES[source] || !LANGUAGES[target]) {
      client.close(1008, 'Unsupported language');
      return;
    }
    if (!this.translateService.enabled || !this.tts.enabled) {
      client.close(1011, 'Voice translation is unavailable');
      return;
    }

    let pipeline: Pipeline | undefined;
    // Audio that arrives before the voice sample.
    const early: Buffer[] = [];
    const voiceTimer = setTimeout(() => {
      if (!pipeline) client.close(1008, 'Voice sample is required');
    }, VOICE_TIMEOUT_MS);

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        const chunk = toBuffer(data);
        if (pipeline) pipeline.session.sendAudio(chunk);
        else early.push(chunk);
        return;
      }

      let message: { type?: unknown; text?: unknown; wav?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return; // Ignore malformed control frames.
      }
      if (message.type === 'voice' && !pipeline) {
        clearTimeout(voiceTimer);
        const voice = parseVoiceSample(message);
        if (!voice) {
          client.close(1008, 'Invalid voice sample');
          return;
        }
        pipeline = this.start(client, voice, { source, target });
        for (const chunk of early.splice(0)) pipeline?.session.sendAudio(chunk);
      } else if (message.type === 'endStream') {
        pipeline?.session.end();
      }
    });

    client.on('close', () => {
      clearTimeout(voiceTimer);
      pipeline?.session.close();
      pipeline?.translator.close();
      pipeline?.speech.close();
    });
    keepAlive(client);
  }

  private start(
    client: WebSocket,
    voice: VoiceSample,
    languages: { source: string; target: string },
  ): Pipeline | undefined {
    let finished = false;
    const fail = (reason: string) => {
      if (finished) return;
      finished = true;
      // Never log the speech itself.
      this.logger.warn(`Voice translation failed: ${reason}`);
      send(client, { type: 'error', message: 'Voice translation failed' });
      client.close(1011, 'Voice translation failed');
    };
    client.on('close', () => (finished = true));

    const speech = this.tts.createSession(voice, languages.target, {
      onReady: (sampleRate) =>
        send(client, {
          type: 'audioFormat',
          sampleRate,
          encoding: 'pcm_s16le',
        }),
      onAudio: (chunk) => {
        if (client.readyState === WebSocket.OPEN) client.send(chunk);
      },
      onDone: () => {
        finished = true;
        if (client.readyState === WebSocket.OPEN) client.close(1000);
      },
      onError: fail,
    });
    speech.warmUp();
    const feeder = new SpeechFeeder((text) => speech.speak(text));

    const transcript = new StableTranscript();
    const translator = new SimultaneousTranslator(
      this.translateService.translate,
      languages,
      {
        draft: (text) => {
          send(client, { type: 'translationDraft', text });
          feeder.draft(text);
        },
        final: (text) => {
          send(client, { type: 'translationFinal', text });
          feeder.final(text);
        },
        skipped: () => feeder.skip(),
        error: (message) => send(client, { type: 'error', message }),
      },
    );

    try {
      const session = this.metaTranscribe.createSession(
        {
          onReady: (sessionId) => send(client, { type: 'ready', sessionId }),
          onEvent: (event) => {
            sendMetaError(client, event);
            feedTranslator(event, transcript, translator);
          },
          onClose: async (code, reason) => {
            // Translate and speak the last phrase after endStream.
            await translator.drain(DRAIN_TIMEOUT_MS);
            if (client.readyState !== WebSocket.OPEN) return;
            if (code !== 1000) {
              client.close(closeCode(code), reason);
              return;
            }
            speech.end();
            setTimeout(() => fail('speech timed out'), SPEECH_TIMEOUT_MS);
          },
        },
        [LANGUAGES[languages.source]],
      );
      return { session, translator, speech };
    } catch (err) {
      translator.close();
      speech.close();
      this.logger.error((err as Error).message);
      client.close(1011, 'Voice translation is unavailable');
      return undefined;
    }
  }
}
