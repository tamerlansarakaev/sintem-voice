import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Dropdown } from '../components/Dropdown';
import { ArrowIcon, CloseIcon } from '../components/icons';
import { capturePcm, stopStream, type PcmCapture } from '../lib/audio';
import {
  closeReason,
  connect,
  endStream,
  onServerMessage,
  sendIfOpen,
  socketUrl,
} from '../lib/backend';
import { useI18n } from '../lib/i18n';
import { counterpart, languageOptions, useLanguagePair, type Language } from '../lib/languages';
import type { StringKey } from '../lib/strings';

const SAMPLE_RATE = 16000;
// Finished phrases kept on screen above the one in progress.
const MAX_LINES = 3;

interface Capture {
  pcm: PcmCapture;
  socket: WebSocket;
}

interface Status {
  key: StringKey;
  vars?: Record<string, string | number>;
  error?: boolean;
}

type ServerEvent =
  | { type: 'ready' }
  | { type: 'translationDraft'; text: string }
  | { type: 'translationFinal'; text: string }
  | { type: 'error'; message: string };

// The app's language, unless it is the English of the audio itself.
function subtitleLanguage(language: Language): Language {
  return language === 'en' ? counterpart(language) : language;
}

export function SubtitlesApp() {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  // English audio, subtitles in the app's language.
  const { source, target, setSource, setTarget } = useLanguagePair(
    (language) => ['en', subtitleLanguage(language)],
    running,
  );
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<Status>({ key: 'live.idle' });
  const [lines, setLines] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const capture = useRef<Capture | null>(null);
  // A stopped session's last phrase is dropped once the next one starts.
  const session = useRef(0);
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

  // Only the translation is shown; recognised speech events are ignored.
  function handleEvent(event: ServerEvent) {
    switch (event.type) {
      case 'ready':
        setStatus({ key: 'live.waiting' });
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
    const id = ++session.current;
    setRunning(true);
    setLines([]);
    setPartial('');
    setStatus({ key: 'live.connecting' });
    setStarting(true);
    try {
      capture.current = await startCapture(id);
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
    const { pcm, socket } = capture.current;
    capture.current = null;
    setRunning(false);
    setStatus({ key: 'live.idle' });

    pcm.stop();
    // The server flushes the last phrase, then closes the socket.
    endStream(socket);
  }

  async function startCapture(id: number): Promise<Capture> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    // Only the audio is needed; the video track exists because Chromium requires it.
    stream.getVideoTracks().forEach((track) => track.stop());
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack || audioTrack.readyState === 'ended') {
      stopStream(stream);
      throw new Error(t('live.permission'));
    }

    let socket: WebSocket;
    try {
      socket = await connect(
        await socketUrl('/translate-subtitles', { source, target }),
      ).opened;
    } catch (err) {
      stopStream(stream);
      throw err;
    }
    onServerMessage<ServerEvent>(socket, (event) => {
      if (session.current === id) handleEvent(event);
    });
    socket.addEventListener('close', (event) => {
      if (capture.current?.socket !== socket) return;
      stop();
      const reason = closeReason(event);
      if (reason !== null) {
        setStatus({ key: 'live.disconnected', vars: { reason }, error: true });
      }
    });

    let pcm: PcmCapture;
    try {
      // The server buffers audio until it is ready, so send right away.
      pcm = await capturePcm(stream, SAMPLE_RATE, (chunk) => sendIfOpen(socket, chunk));
    } catch (err) {
      socket.close();
      throw err;
    }

    // The close handler ignores sockets that closed before capture was set.
    if (socket.readyState !== WebSocket.OPEN) {
      pcm.stop();
      throw new Error('server closed the connection');
    }
    return { pcm, socket };
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
        <ArrowIcon className="subtitles-arrow" />
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
          <CloseIcon />
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
