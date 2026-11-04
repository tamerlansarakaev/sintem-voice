import { useEffect, useState } from 'react';

import logo from '../assets/logo.png';
import { CloseIcon } from '../components/icons';
import { OfflineScreen } from '../components/OfflineScreen';
import { Sidebar } from '../components/Sidebar';
import { useI18n } from '../lib/i18n';
import { Settings } from '../pages/Settings';
import { VoiceClone } from '../pages/VoiceClone';
import { VoiceTranslation } from '../pages/VoiceTranslation';
import { useAppState } from '../state/app-state';
import { useCurrentPage } from './pages';

const SPLASH_MS = 1000;
const HEALTH_INTERVAL_MS = 15_000;

function WindowControls() {
  const { t } = useI18n();
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-button"
        title={t('window.minimize')}
        aria-label={t('window.minimize')}
        onClick={() => window.windowControls.minimize()}
      >
        <svg viewBox="0 0 24 24">
          <path d="M6 12h12" />
        </svg>
      </button>
      <button
        type="button"
        className="window-button"
        title={t('window.maximize')}
        aria-label={t('window.maximize')}
        onClick={() => window.windowControls.toggleMaximize()}
      >
        <svg viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className="window-button window-close"
        title={t('window.close')}
        aria-label={t('window.close')}
        onClick={() => window.windowControls.close()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// Highlighted while the subtitles window is open.
function SubtitlesToggle() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => window.subtitles.onClosed(() => setOpen(false)), []);

  return (
    <button
      type="button"
      className="ghost-button subtitles-toggle"
      aria-pressed={open}
      onClick={() => {
        window.subtitles.open();
        setOpen(true);
      }}
    >
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M7 11h4M13.5 11H17M7 15h6.5M16 15h1" />
      </svg>
      <span>{t('subtitles.button')}</span>
    </button>
  );
}

// Stays at least SPLASH_MS while the first server check runs, then fades.
function Splash({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  const [removed, setRemoved] = useState(false);
  if (removed) return null;
  return (
    <div
      className={`splash${visible ? '' : ' hidden'}`}
      onTransitionEnd={(event) => {
        if (!visible && event.target === event.currentTarget) setRemoved(true);
      }}
    >
      <img className="logo logo-large" src={logo} alt="" />
      <div className="splash-title">Sintem Voice</div>
      <div className="splash-subtitle">{t('splash.opening')}</div>
    </div>
  );
}

export function App() {
  const page = useCurrentPage();
  const { refreshHealth } = useAppState();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const minimum = new Promise((resolve) => setTimeout(resolve, SPLASH_MS));
    Promise.all([minimum, refreshHealth()]).then(() => {
      if (!cancelled) setBooting(false);
    });
    const interval = setInterval(refreshHealth, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshHealth]);

  // Every page stays mounted so a running session survives navigation.
  return (
    <>
      <Splash visible={booting} />
      <WindowControls />
      <div className="app">
        <Sidebar current={page} />
        <main className="content">
          <div className="topbar">
            <SubtitlesToggle />
          </div>
          <VoiceTranslation hidden={page !== 'voice-translation'} />
          <VoiceClone hidden={page !== 'voice-clone'} />
          <Settings hidden={page !== 'settings'} />
        </main>
      </div>
      <OfflineScreen />
    </>
  );
}
