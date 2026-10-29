import { useEffect, useRef, useState } from 'react';

import { Dropdown } from '../components/Dropdown';
import { chunkLevel, createPlayer, startMicrophone, type Player } from '../lib/audio';
import { connect, socketUrl, type PendingSocket } from '../lib/backend';
import { createBars, type Bars } from '../lib/canvas';
import { useI18n } from '../lib/i18n';
import { languageOptions, type Language } from '../lib/languages';
import { getPref } from '../lib/prefs';
import type { StringKey } from '../lib/strings';
import { useAppState } from '../state/app-state';
import { useToast } from '../state/toasts';

const MIC_SAMPLE_RATE = 16000;

type LiveState = 'idle' | 'connecting' | 'running' | 'finishing';

const LABELS: Record<LiveState, StringKey> = {
  idle: 'translation.start',
  connecting: 'translation.connecting',
  running: 'translation.stop',
  finishing: 'translation.finishing',
};

interface Live {
  socket: WebSocket;
  player: Player;
  stopMicrophone: (() => void) | null;
}

type ServerEvent =
  | { type: 'ready' }
  | { type: 'audioFormat'; sampleRate: number }
  | { type: 'error'; message: string };

export function VoiceTranslation({ hidden }: { hidden: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state: app, update, refreshHealth } = useAppState();
  const [source, setSource] = useState<Language>('ru');
  const [target, setTarget] = useState<Language>('en');
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [listening, setListening] = useState(false);
  const live = useRef<Live | null>(null);
  // The connection being opened, so Stop can cancel it.
  const connecting = useRef<PendingSocket | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bars = useRef<Bars | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    // The bars keep clear of the button whatever size it scales to.
    const created = createBars(canvas.current, {
      gap: () => (button.current?.offsetWidth ?? 0) + 60,
    });
    bars.current = created;
    return () => {
      created.destroy();
      bars.current = null;
    };
  }, []);

  // A closed window ends the session.
  useEffect(
    () => () => {
      live.current?.stopMicrophone?.();
      live.current?.socket.close();
      connecting.current?.socket.close();
    },
    [],
  );

  // Why Start cannot run right now, or null.
  function blocker(): StringKey | null {
    if (!app.virtualMic) return 'translation.noMic';
    if (!app.hasVoice) return 'translation.noVoice';
    if (!app.online) return 'translation.offline';
    return null;
  }

  function setControls(next: LiveState) {
    setLiveState(next);
    if (next !== 'running') {
      bars.current?.setLevel(0);
      bars.current?.setOutputLevel(0);
    }
    update({ recording: next === 'connecting' || next === 'running' });
  }

  async function startLive() {
    if (blocker()) return;
    const voice = await window.voice.load();
    if (!voice) {
      update({ hasVoice: false });
      return;
    }
    if (source === target) {
      toast(t('translation.sameLanguages'), 'error');
      return;
    }

    setListening(false);
    setControls('connecting');

    let pending: PendingSocket | undefined;
    let socket: WebSocket | undefined;
    try {
      pending = connect(await socketUrl('/translate-voice', { source, target }));
      connecting.current = pending;
      try {
        socket = await pending.opened;
      } finally {
        connecting.current = null;
      }
      const opened = socket;
      // The server keeps no voices: the sample goes first in every session.
      opened.send(JSON.stringify({ type: 'voice', ...voice }));
      const player = createPlayer(app.virtualMic?.deviceId, (level) =>
        bars.current?.setOutputLevel(level),
      );
      live.current = { socket: opened, player, stopMicrophone: null };
      setControls('running');

      opened.addEventListener('message', ({ data }) => {
        if (typeof data === 'string') handleEvent(JSON.parse(data));
        else player.play(data);
      });
      opened.addEventListener('close', (event) => finishLive(opened, event));

      const microphone = await startMicrophone(MIC_SAMPLE_RATE, (chunk) => {
        if (opened.readyState === WebSocket.OPEN) opened.send(chunk);
        bars.current?.setLevel(chunkLevel(chunk));
      });
      if (live.current?.socket !== opened) {
        microphone.stop();
        return;
      }
      live.current.stopMicrophone = microphone.stop;
      if (getPref('mixOriginal')) player.mix(microphone.stream);
    } catch (err) {
      if (live.current && live.current.socket === socket) {
        live.current.player.close();
        live.current = null;
      }
      socket?.close();
      if (!pending?.cancelled) {
        toast(t('translation.couldNotStart', { message: (err as Error).message }), 'error');
        refreshHealth();
      }
      setControls('idle');
    }
  }

  function cancelConnect() {
    if (!connecting.current) return;
    connecting.current.cancelled = true;
    connecting.current.socket.close();
  }

  // The server translates and speaks the rest, then closes the socket.
  function stopLive() {
    if (!live.current) return;
    live.current.stopMicrophone?.();
    live.current.stopMicrophone = null;
    setControls('finishing');
    if (live.current.socket.readyState === WebSocket.OPEN) {
      live.current.socket.send(JSON.stringify({ type: 'endStream' }));
    } else {
      live.current.socket.close();
    }
  }

  function finishLive(socket: WebSocket, event: CloseEvent) {
    if (live.current?.socket !== socket) return;
    live.current.stopMicrophone?.();
    // Already received speech still plays to the end.
    live.current.player.close();
    live.current = null;
    setControls('idle');
    if (event.code !== 1000) {
      toast(t('translation.disconnected', { reason: event.reason || event.code }), 'error');
      refreshHealth();
    }
  }

  function handleEvent(event: ServerEvent) {
    switch (event.type) {
      case 'ready':
        setListening(true);
        break;
      case 'audioFormat':
        live.current?.player.setSampleRate(event.sampleRate);
        break;
      case 'error':
        toast(t('translation.error', { message: event.message }), 'error');
        break;
    }
  }

  const reason = liveState === 'idle' ? blocker() : null;
  let status = '';
  if (reason) status = t(reason);
  else if (liveState === 'connecting' || liveState === 'finishing') {
    status = t(LABELS[liveState]);
  } else if (liveState === 'running') {
    status = t(listening ? 'translation.listening' : 'translation.connecting');
  }

  const options = languageOptions(t);
  const locked = liveState !== 'idle';
  const label = t(LABELS[liveState]);

  // Steps unlock in order: the next one gets its button, later ones a lock.
  const done = [Boolean(app.virtualMic), app.hasVoice];
  const current = done.indexOf(false);
  const stepState = (index: number) =>
    done[index] ? 'done' : index === current ? 'current' : 'locked';

  return (
    <section className="page" hidden={hidden}>
      <header className="page-header">
        <h1>{t('translation.title')}</h1>
        <p>{t('translation.subtitle')}</p>
      </header>
      <div className="voice-stage">
        <div className="orb" data-state={liveState}>
          <canvas className="orb-wave" ref={canvas} />
          <button
            ref={button}
            type="button"
            className="mic-button"
            title={label}
            aria-label={label}
            disabled={liveState === 'finishing' || Boolean(reason)}
            onClick={() => {
              if (connecting.current) cancelConnect();
              else if (live.current) stopLive();
              else startLive();
            }}
          >
            <svg className="icon-mic" viewBox="0 0 24 24">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
            </svg>
            <span className="icon-stop" />
          </button>
        </div>
        <p className={`dock-status${reason ? ' warning' : ''}`}>{status}</p>
      </div>

      <div className="dock lang-dock">
        <Dropdown
          className="lang-select"
          value={source}
          options={options}
          onChange={setSource}
          disabled={locked}
          title={t('translation.from')}
        />
        <button
          type="button"
          className="swap-button"
          title={t('translation.swap')}
          aria-label={t('translation.swap')}
          disabled={locked}
          onClick={() => {
            setSource(target);
            setTarget(source);
          }}
        >
          <svg viewBox="0 0 24 24">
            <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />
          </svg>
        </button>
        <Dropdown
          className="lang-select"
          value={target}
          options={options}
          onChange={setTarget}
          disabled={locked}
          title={t('translation.to')}
        />
      </div>

      <div className="lock-overlay" hidden={current < 0 || liveState !== 'idle'}>
        <div className="card lock-card">
          <div className="badge-icon">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="11" width="14" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h2>{t('unlock.title')}</h2>
          <p className="muted">{t('unlock.body')}</p>
          <ol className="steps">
            <UnlockStep
              number={1}
              state={stepState(0)}
              title={t('unlock.mic')}
              hint={t('unlock.micHint')}
              href="#settings"
              action={t('unlock.openSettings')}
            />
            <UnlockStep
              number={2}
              state={stepState(1)}
              title={t('unlock.voice')}
              hint={t('unlock.voiceHint')}
              href="#voice-clone"
              action={t('unlock.openClone')}
            />
          </ol>
        </div>
      </div>
    </section>
  );
}

interface UnlockStepProps {
  number: number;
  state: 'done' | 'current' | 'locked';
  title: string;
  hint: string;
  href: string;
  action: string;
}

function UnlockStep({ number, state, title, hint, href, action }: UnlockStepProps) {
  return (
    <li className="step" data-state={state}>
      <span className="step-mark">
        <span className="step-number">{number}</span>
        <svg className="step-check" viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <svg className="step-lock" viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="10" rx="2.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <span className="step-text">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
      <a className="primary-button small" href={href}>
        {action}
      </a>
    </li>
  );
}
