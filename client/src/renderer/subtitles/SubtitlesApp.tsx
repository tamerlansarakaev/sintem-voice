import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Dropdown } from '../components/Dropdown';
import { streamPcm } from '../lib/audio';
import { connect, socketUrl } from '../lib/backend';
import { useI18n } from '../lib/i18n';
import { languageOptions, type Language } from '../lib/languages';
import type { StringKey } from '../lib/strings';

const SAMPLE_RATE = 16000;
// Finished phrases kept on screen above the one in progress.
const MAX_LINES = 3;

interface Capture {
  stream: MediaStream;
  audioContext: AudioContext;
  socket: WebSocket;
}

interface Status {
  key: StringKey;
  vars?: Record<string, string | number>;
  error?: boolean;
}

type ServerEvent =
  | { type: 'ready'; translated?: boolean }
  | { type: 'transcript'; transcript: string }
  | { type: 'speechComplete'; transcript: string }
  | { type: 'translationDraft'; text: string }
  | { type: 'translationFinal'; text: string }
  | { type: 'error'; message: string };

export function SubtitlesApp() {
  const { t } = useI18n();
  const [source, setSource] = useState<Language>('en');
  const [target, setTarget] = useState<Language>('ru');
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<Status>({ key: 'live.idle' });
  const [lines, setLines] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const capture = useRef<Capture | null>(null);
  // Whether the server translates; without it the window falls back to the
  // recognised speech so it is not left empty.
  const translated = useRef(true);
  const body = useRef<HTMLDivElement>(null);

  const text = [...lines, partial].filter(Boolean);
  const hasText = text.length > 0;

  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines, partial]);

  // A window closed mid-session still stops the capture.
  useEffect(() => () => stop(), []);

  function showPartial(value: string) {
    setPartial(value);
  }

  function addLine(value: string) {
    setPartial('');
    if (value) setLines((current) => [...current, value].slice(-MAX_LINES));
  }

  // Only the translation is shown; recognised speech is used only when the
  // server does not translate.
  function handleEvent(event: ServerEvent) {
    switch (event.type) {
      case 'ready':
        translated.current = event.translated === true;
        setStatus({ key: 'live.waiting' });
        break;
      case 'transcript':
        // CUMULATIVE mode: every partial is the whole current hypothesis.
        if (!translated.current) showPartial(event.transcript);
        break;
      case 'speechComplete':
        if (!translated.current) addLine(event.transcript);
        break;
      case 'translationDraft':
        showPartial(event.text);
        break;
      case 'translationFinal':
        addLine(event.text);
        break;
      case 'error':
        setStatus({ key: 'live.error', vars: { message: event.message }, error: true });
        break;
    }
  }

  async function start() {
    setRunning(true);
    setLines([]);
    setPartial('');
    translated.current = true;
    setStatus({ key: 'live.connecting' });
    setStarting(true);
    try {
      capture.current = await startCapture();
    } catch (err) {
      setRunning(false);
      setStatus({
        key: 'live.couldNotStart',
        vars: { message: (err as Error).message },
        error: true,
      });
    } finally {
      setStarting(false);
    }
  }

  function stop() {
    if (!capture.current) return;
    const { stream, audioContext, socket } = capture.current;
    capture.current = null;
    setRunning(false);
    setStatus({ key: 'live.idle' });

    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
    // The server flushes the last phrase, then closes the socket.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'endStream' }));
    } else {
      socket.close();
    }
  }

  async function startCapture(): Promise<Capture> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    // Only the audio is needed; the video track exists because Chromium requires it.
    stream.getVideoTracks().forEach((track) => track.stop());
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack || audioTrack.readyState === 'ended') {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(t('live.permission'));
    }

    let socket: WebSocket;
    try {
      socket = await connect(
        await socketUrl('/translate-subtitles', { source, target }),
      ).opened;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      throw err;
    }
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') handleEvent(JSON.parse(event.data));
    });
    socket.addEventListener('close', (event) => {
      if (capture.current?.socket !== socket) return;
      stop();
      if (event.code !== 1000) {
        setStatus({
          key: 'live.disconnected',
          vars: { reason: event.reason || event.code },
          error: true,
        });
      }
    });

    let audioContext: AudioContext;
    try {
      // The server buffers audio until it is ready, so send right away.
      audioContext = await streamPcm(stream, SAMPLE_RATE, (chunk) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
      });
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      socket.close();
      throw err;
    }

    // The close handler ignores sockets that closed before capture was set.
    if (socket.readyState !== WebSocket.OPEN) {
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
      throw new Error('server closed the connection');
    }
    return { stream, audioContext, socket };
  }

  const options = languageOptions(t);
  const dot = status.error ? 'error' : running ? 'active' : 'idle';

  return (
    <div className="subtitles">
      <header className="subtitles-header">
        <span className="status-dot" data-state={dot} />
        <span className="subtitles-title">{t('subtitles.button')}</span>
        <span className="spacer" />
        <Dropdown
          className="compact"
          value={source}
          options={options}
          onChange={setSource}
          disabled={running}
          title={t('translation.from')}
        />
        <svg className="subtitles-arrow" viewBox="0 0 24 24">
          <path d="M5 12h14M14 7l5 5-5 5" />
        </svg>
        <Dropdown
          className="compact"
          value={target}
          options={options}
          onChange={setTarget}
          disabled={running}
          title={t('translation.to')}
        />
        <button
          type="button"
          className="icon-button"
          title={t('live.close')}
          aria-label={t('live.close')}
          onClick={() => window.windowControls.close()}
        >
          <svg viewBox="0 0 24 24">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </header>

      <div className="subtitles-body" ref={body}>
        {/* In place of the text until the first words arrive, and for errors. */}
        <p
          className={`subtitles-placeholder${status.error ? ' error' : ''}`}
          hidden={hasText && !status.error}
        >
          {t(status.key, status.vars)}
        </p>
        <div className="subtitles-text">{text.join('\n')}</div>
      </div>

      <footer className="subtitles-footer">
        <button
          type="button"
          className={`primary-button wide${running ? ' danger' : ''}`}
          disabled={starting}
          onClick={() => (capture.current ? stop() : start())}
        >
          {t(running ? 'live.stop' : 'live.start')}
        </button>
      </footer>
    </div>
  );
}
