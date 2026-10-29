import { Fragment, useEffect, useRef, useState } from 'react';

import { bytesToBase64, encodeWav, startMicrophone } from '../lib/audio';
import { useI18n } from '../lib/i18n';
import type { StringKey } from '../lib/strings';
import { goTo } from '../main/pages';
import { useAppState } from '../state/app-state';
import { useToast } from '../state/toasts';

// Records the voice sample the server clones. It is kept on this computer
// only and sent with every live translation session.
const VOICE_SAMPLE_RATE = 44100;
const MIN_SECONDS = 3;
const MAX_SECONDS = 10;
// The exact text goes to the synthesizer with the sample.
const VOICE_PROMPTS = {
  en: [
    'Hello! I am recording my voice for live translation.',
    'Good morning! Today I am testing live translation with my own voice.',
    'Thank you for joining the call. I will speak, and you will hear me in your language.',
  ],
  ru: [
    'Привет! Я записываю свой голос для живого перевода.',
    'Доброе утро! Сегодня я проверяю живой перевод своим голосом.',
    'Спасибо, что пришли на звонок. Я говорю, а вы слышите меня на своём языке.',
  ],
};
type PromptLanguage = keyof typeof VOICE_PROMPTS;

interface Recording {
  stop(): void;
  chunks: ArrayBuffer[];
  text: string;
  paused: boolean;
  // Recorded time before the current stretch, and when it started.
  elapsed: number;
  resumedAt: number;
  timer: ReturnType<typeof setInterval>;
}

interface Status {
  key: StringKey;
  vars?: Record<string, string | number>;
}

function recordedMs(recording: Recording) {
  return (
    recording.elapsed + (recording.paused ? 0 : Date.now() - recording.resumedAt)
  );
}

export function VoiceClone({ hidden }: { hidden: boolean }) {
  const { t, language } = useI18n();
  const toast = useToast();
  const { update } = useAppState();
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>(
    language === 'ru' ? 'ru' : 'en',
  );
  const [promptIndex, setPromptIndex] = useState(0);
  const recording = useRef<Recording | null>(null);
  // Re-renders the recorder; the recording itself lives in the ref.
  const [mode, setMode] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [elapsed, setElapsed] = useState(0);
  // The finished recording waiting for Create voice.
  const [sample, setSample] = useState<{ wav: Uint8Array; text: string } | null>(null);
  const [recordedOnce, setRecordedOnce] = useState(false);
  const [status, setStatus] = useState<Status>({ key: 'clone.statusIdle' });
  const [busy, setBusy] = useState(false);

  const text = VOICE_PROMPTS[promptLanguage][promptIndex];
  const words = text.split(' ');
  const active = mode !== 'idle';

  useEffect(() => {
    window.voice.load().then((voice) => {
      if (!voice) return;
      setRecordedOnce(true);
      setStatus({ key: 'clone.statusSaved' });
    });
  }, []);

  // A closed window ends the recording.
  useEffect(
    () => () => {
      if (!recording.current) return;
      clearInterval(recording.current.timer);
      recording.current.stop();
    },
    [],
  );

  function choosePrompt(nextLanguage: PromptLanguage, nextIndex: number) {
    setPromptLanguage(nextLanguage);
    setPromptIndex(nextIndex);
    // A sample must match the text it is sent with.
    if (sample && sample.text !== VOICE_PROMPTS[nextLanguage][nextIndex]) {
      setSample(null);
      setStatus({ key: 'clone.statusIdle' });
      setElapsed(0);
    }
  }

  async function startRecording() {
    const chunks: ArrayBuffer[] = [];
    setBusy(true);
    setSample(null);
    try {
      const microphone = await startMicrophone(VOICE_SAMPLE_RATE, (chunk) => {
        if (!recording.current?.paused) chunks.push(chunk);
      });
      const current: Recording = {
        stop: microphone.stop,
        chunks,
        text,
        paused: false,
        elapsed: 0,
        resumedAt: Date.now(),
        timer: setInterval(() => {
          const ms = recordedMs(current);
          setElapsed(ms);
          if (ms >= MAX_SECONDS * 1000) finishRecording();
        }, 100),
      };
      recording.current = current;
      setElapsed(0);
      setMode('recording');
      setStatus({ key: 'clone.statusRecording' });
      update({ recording: true });
    } catch (err) {
      setStatus({ key: 'clone.couldNotRecord', vars: { message: (err as Error).message } });
    } finally {
      setBusy(false);
    }
  }

  function finishRecording() {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    clearInterval(current.timer);
    current.stop();
    setRecordedOnce(true);
    setMode('idle');
    update({ recording: false });

    const samples = current.chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
    if (samples < MIN_SECONDS * VOICE_SAMPLE_RATE) {
      setStatus({ key: 'clone.tooShort', vars: { seconds: MIN_SECONDS } });
    } else {
      setSample({ text: current.text, wav: encodeWav(current.chunks, VOICE_SAMPLE_RATE) });
      setStatus({ key: 'clone.statusDone' });
    }
  }

  function togglePause() {
    const current = recording.current;
    if (!current) return;
    if (current.paused) {
      current.paused = false;
      current.resumedAt = Date.now();
      setMode('recording');
      setStatus({ key: 'clone.statusRecording' });
    } else {
      current.elapsed += Date.now() - current.resumedAt;
      current.paused = true;
      setMode('paused');
      setStatus({ key: 'clone.statusPaused' });
    }
  }

  async function createVoice() {
    if (!sample) return;
    setBusy(true);
    try {
      await window.voice.save({ text: sample.text, wav: bytesToBase64(sample.wav) });
      setSample(null);
      setStatus({ key: 'clone.statusSaved' });
      update({ hasVoice: true });
      toast(t('clone.created'), 'success');
      goTo('voice-translation');
    } catch (err) {
      setStatus({ key: 'clone.couldNotSave', vars: { message: (err as Error).message } });
    } finally {
      setBusy(false);
    }
  }

  const fraction = Math.min(1, elapsed / (MAX_SECONDS * 1000));
  // Words light up one by one as the recording advances.
  const read = Math.round(fraction * words.length);
  const seconds = Math.min(MAX_SECONDS, Math.floor(elapsed / 1000));
  const recordLabel = t(
    active ? 'clone.stop' : recordedOnce ? 'clone.recordAgain' : 'clone.record',
  );
  const pauseLabel = t(mode === 'paused' ? 'clone.resume' : 'clone.pause');

  return (
    <section className="page" hidden={hidden}>
      <header className="page-header">
        <h1>{t('clone.title')}</h1>
        <p>{t('clone.subtitle')}</p>
      </header>
      <div className="teleprompter">
        <div className="prompt-toolbar">
          <div
            className="segmented"
            role="radiogroup"
            title={t('clone.textLanguage')}
            aria-label={t('clone.textLanguage')}
          >
            {(['en', 'ru'] as const).map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={promptLanguage === code}
                disabled={active}
                onClick={() => choosePrompt(code, 0)}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={active}
            onClick={() =>
              choosePrompt(
                promptLanguage,
                (promptIndex + 1) % VOICE_PROMPTS[promptLanguage].length,
              )
            }
          >
            <svg viewBox="0 0 24 24">
              <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v5h-5" />
            </svg>
            <span>{t('clone.newText')}</span>
          </button>
        </div>
        <blockquote className="voice-prompt">
          {words.map((word, index) => (
            <Fragment key={index}>
              {index > 0 && ' '}
              <span className={index < read ? 'read' : undefined}>{word}</span>
            </Fragment>
          ))}
        </blockquote>
        <p className="prompt-hint">{t('clone.cardHint')}</p>
      </div>

      <p className="dock-status">{t(status.key, status.vars)}</p>
      <div
        className={`dock recorder${mode === 'recording' ? ' recording' : ''}${
          mode === 'paused' ? ' paused' : ''
        }`}
      >
        <div className="recorder-time">
          <span className="rec-dot" />
          <span className="timer">
            0:{String(seconds).padStart(2, '0')} / 0:{MAX_SECONDS}
          </span>
        </div>
        <button
          type="button"
          className="round-button"
          hidden={!active}
          title={pauseLabel}
          aria-label={pauseLabel}
          onClick={togglePause}
        >
          <svg className="icon-pause" viewBox="0 0 24 24">
            <path d="M9 6v12M15 6v12" />
          </svg>
          <svg className="icon-resume" viewBox="0 0 24 24">
            <path d="M8 5.5v13l10.5-6.5z" />
          </svg>
        </button>
        <button
          type="button"
          className={`record-button${active ? ' running' : ''}`}
          title={recordLabel}
          aria-label={recordLabel}
          disabled={busy && !active}
          onClick={() => (recording.current ? finishRecording() : startRecording())}
        >
          <span className="rec-icon" />
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={active || !sample || busy}
          onClick={createVoice}
        >
          {t('clone.create')}
        </button>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
    </section>
  );
}
