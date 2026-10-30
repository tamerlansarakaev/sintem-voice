import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  base64ToBytes,
  bytesToBase64,
  chunkLevel,
  encodeWav,
  startMicrophone,
  wavSeconds,
} from '../lib/audio';
import { useI18n, type UiLanguage } from '../lib/i18n';
import type { StringKey } from '../lib/strings';
import { goTo } from '../main/pages';
import { useAppState } from '../state/app-state';
import { useToast } from '../state/toasts';

// Records the voice sample the server clones. It is kept on this computer
// only and sent with every live translation session.
const VOICE_SAMPLE_RATE = 44100;
const MIN_SECONDS = 3;
const MAX_SECONDS = 10;
// Texts in the app's language. The exact text goes to the synthesizer
// with the sample.
const VOICE_PROMPTS: Record<UiLanguage, string[]> = {
  en: [
    'Hello! I am recording my voice for live translation.',
    'Good morning! Today I am testing live translation with my own voice.',
    'Thank you for joining the call. I will speak, and you will hear me in your language.',
    'The weather is lovely today, so after work I might take a long walk by the river.',
    'Could you send me the notes from this meeting? I would like to read them again tonight.',
  ],
  ru: [
    'Привет! Я записываю свой голос для живого перевода.',
    'Доброе утро! Сегодня я проверяю живой перевод своим голосом.',
    'Спасибо, что пришли на звонок. Я говорю, а вы слышите меня на своём языке.',
    'Сегодня отличная погода, поэтому после работы я, пожалуй, прогуляюсь вдоль реки.',
    'Пришлите, пожалуйста, заметки с этой встречи. Я хочу перечитать их вечером.',
  ],
  fr: [
    'Bonjour ! J’enregistre ma voix pour la traduction en direct.',
    'Bonjour à tous ! Aujourd’hui, je teste la traduction en direct avec ma propre voix.',
    'Merci d’avoir rejoint l’appel. Je parle, et vous m’entendez dans votre langue.',
    'Il fait très beau aujourd’hui, alors après le travail je vais sans doute me promener au bord de la rivière.',
    'Pouvez-vous m’envoyer les notes de cette réunion ? J’aimerais les relire ce soir.',
  ],
  de: [
    'Hallo! Ich nehme meine Stimme für die Live-Übersetzung auf.',
    'Guten Morgen! Heute teste ich die Live-Übersetzung mit meiner eigenen Stimme.',
    'Danke, dass Sie dabei sind. Ich spreche, und Sie hören mich in Ihrer Sprache.',
    'Heute ist so schönes Wetter, dass ich nach der Arbeit wohl einen langen Spaziergang am Fluss mache.',
    'Könnten Sie mir die Notizen von diesem Meeting schicken? Ich möchte sie heute Abend noch einmal lesen.',
  ],
  es: [
    '¡Hola! Estoy grabando mi voz para la traducción en directo.',
    '¡Buenos días! Hoy estoy probando la traducción en directo con mi propia voz.',
    'Gracias por unirte a la llamada. Yo hablo y tú me escuchas en tu idioma.',
    'Hoy hace un tiempo estupendo, así que después del trabajo quizá dé un paseo largo junto al río.',
    '¿Podrías enviarme las notas de esta reunión? Me gustaría volver a leerlas esta noche.',
  ],
};

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

interface Sample {
  wav: Uint8Array<ArrayBuffer>;
  text: string;
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
  const [promptIndex, setPromptIndex] = useState(0);
  const recording = useRef<Recording | null>(null);
  // Re-renders the recorder; the recording itself lives in the ref.
  const [mode, setMode] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [elapsed, setElapsed] = useState(0);
  // The finished recording waiting for Create voice.
  const [sample, setSample] = useState<Sample | null>(null);
  // The voice sent with every live translation session.
  const [saved, setSaved] = useState<Sample | null>(null);
  const [recordedOnce, setRecordedOnce] = useState(false);
  const [status, setStatus] = useState<Status>({ key: 'clone.statusIdle' });
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<'sample' | 'saved' | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  // Set straight on the element: the level changes with every chunk.
  const meter = useRef<HTMLDivElement>(null);

  const prompts = VOICE_PROMPTS[language];
  const text = prompts[promptIndex];
  const words = text.split(' ');
  const active = mode !== 'idle';

  useEffect(() => {
    window.voice.load().then((voice) => {
      if (!voice) return;
      setSaved({ text: voice.text, wav: base64ToBytes(voice.wav) });
      setRecordedOnce(true);
      setStatus({ key: 'clone.statusSaved' });
    });
  }, []);

  // A closed window ends the recording.
  useEffect(
    () => () => {
      stopPlayback();
      if (!recording.current) return;
      clearInterval(recording.current.timer);
      recording.current.stop();
    },
    [],
  );

  // Texts follow the app's language.
  useEffect(() => {
    if (!recording.current) choosePrompt(0);
  }, [language]);

  function setLevel(level: number) {
    meter.current?.style.setProperty('--level', String(level));
  }

  function discardSample() {
    stopPlayback();
    setSample(null);
    setElapsed(0);
    setStatus({ key: 'clone.statusIdle' });
  }

  function choosePrompt(index: number) {
    setPromptIndex(index);
    // A sample must match the text it is sent with.
    if (sample && sample.text !== prompts[index]) discardSample();
  }

  function stopPlayback() {
    const audio = player.current;
    if (!audio) return;
    player.current = null;
    audio.pause();
    URL.revokeObjectURL(audio.src);
    setPlaying(null);
  }

  // Plays the new recording or the saved voice; the same one again stops.
  function togglePlayback(which: 'sample' | 'saved') {
    const wanted = playing;
    stopPlayback();
    const wav = which === 'sample' ? sample?.wav : saved?.wav;
    if (wanted === which || !wav) return;
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.addEventListener('ended', stopPlayback);
    player.current = audio;
    setPlaying(which);
    audio.play().catch(stopPlayback);
  }

  async function startRecording() {
    const chunks: ArrayBuffer[] = [];
    setBusy(true);
    stopPlayback();
    setSample(null);
    try {
      const microphone = await startMicrophone(VOICE_SAMPLE_RATE, (chunk) => {
        if (recording.current?.paused) return;
        chunks.push(chunk);
        setLevel(chunkLevel(chunk));
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
    setLevel(0);
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
      setLevel(0);
      setMode('paused');
      setStatus({ key: 'clone.statusPaused' });
    }
  }

  async function createVoice() {
    if (!sample) return;
    setBusy(true);
    stopPlayback();
    try {
      await window.voice.save({ text: sample.text, wav: bytesToBase64(sample.wav) });
      setSaved(sample);
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
  const listenLabel = (which: 'sample' | 'saved') =>
    t(playing === which ? 'clone.stopListening' : 'clone.listen');

  return (
    <section
      className={`page voice-clone${mode === 'recording' ? ' recording' : ''}${
        mode === 'paused' ? ' paused' : ''
      }`}
      hidden={hidden}
    >
      <header className="page-header">
        <h1>{t('clone.title')}</h1>
        <p>{t('clone.subtitle')}</p>
      </header>

      <div className="clone-stage">
        <div className="card prompt-card">
          <div className="prompt-card-head">
            <span className="prompt-count">
              {t('clone.textOf', { n: promptIndex + 1, total: prompts.length })}
            </span>
            <div className="prompt-dots" role="tablist">
              {prompts.map((prompt, index) => (
                <button
                  key={prompt}
                  type="button"
                  role="tab"
                  aria-selected={index === promptIndex}
                  aria-label={t('clone.textOf', { n: index + 1, total: prompts.length })}
                  disabled={active}
                  onClick={() => choosePrompt(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="ghost-button"
              disabled={active}
              onClick={() => choosePrompt((promptIndex + 1) % prompts.length)}
            >
              <span>{t('clone.nextText')}</span>
              <svg viewBox="0 0 24 24">
                <path d="M5 12h14M14 7l5 5-5 5" />
              </svg>
            </button>
          </div>
          <blockquote className="voice-prompt" key={text}>
            {words.map((word, index) => (
              <Fragment key={index}>
                {index > 0 && ' '}
                <span className={index < read ? 'read' : undefined}>{word}</span>
              </Fragment>
            ))}
          </blockquote>
          <div className="prompt-progress">
            <div className="progress-fill" style={{ width: `${fraction * 100}%` }} />
          </div>
        </div>

        {saved && (
          <div className={`saved-voice${playing === 'saved' ? ' playing' : ''}`}>
            <button
              type="button"
              className="round-button"
              disabled={active}
              title={listenLabel('saved')}
              aria-label={listenLabel('saved')}
              onClick={() => togglePlayback('saved')}
            >
              <PlayIcon playing={playing === 'saved'} />
            </button>
            <div className="saved-voice-text">
              <span className="saved-voice-title">
                {t('clone.savedTitle')}
                <span className="saved-voice-length">
                  0:{String(Math.round(wavSeconds(saved.wav))).padStart(2, '0')}
                </span>
              </span>
              <span className="saved-voice-prompt">{saved.text}</span>
            </div>
          </div>
        )}
      </div>

      <p className="dock-status">{t(status.key, status.vars)}</p>
      <div className="dock recorder">
        <div className="recorder-time">
          <span className="rec-dot" />
          <span className="timer">
            0:{String(seconds).padStart(2, '0')} / 0:{MAX_SECONDS}
          </span>
          <div className="level-meter" ref={meter} aria-hidden="true">
            {[0.55, 0.85, 1, 0.75, 0.5].map((scale, index) => (
              <span key={index} style={{ '--scale': scale } as CSSProperties} />
            ))}
          </div>
        </div>
        <button
          type="button"
          className="round-button pause-button"
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
          className="round-button"
          hidden={active || !sample}
          title={listenLabel('sample')}
          aria-label={listenLabel('sample')}
          onClick={() => togglePlayback('sample')}
        >
          <PlayIcon playing={playing === 'sample'} />
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
      </div>
    </section>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  ) : (
    <svg className="icon-play" viewBox="0 0 24 24">
      <path d="M8 5.5v13l10.5-6.5z" />
    </svg>
  );
}
