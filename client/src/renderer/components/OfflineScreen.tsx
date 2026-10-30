import { useEffect, useRef, useState } from 'react';

import { createWave } from '../lib/canvas';
import { useI18n } from '../lib/i18n';
import { useAppState } from '../state/app-state';

export function OfflineScreen() {
  const { t } = useI18n();
  const { state, refreshHealth } = useAppState();
  const [checking, setChecking] = useState(false);
  const wave = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!wave.current) return;
    return createWave(wave.current, { lines: 5, idle: 0.35 }).destroy;
  }, []);

  async function retry() {
    setChecking(true);
    await refreshHealth();
    setChecking(false);
  }

  return (
    <div className="offline" hidden={state.online}>
      <canvas className="offline-wave" ref={wave} />
      <div className="card offline-card">
        <div className="badge-icon">
          <svg viewBox="0 0 24 24">
            <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
            <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
            <path d="M7 7.25h.01M7 16.75h.01M3 3l18 18" />
          </svg>
        </div>
        <h2>{t('offline.title')}</h2>
        <p className="muted">{t('offline.body')}</p>
        <button
          type="button"
          className="primary-button wide"
          disabled={checking}
          onClick={retry}
        >
          {t(checking ? 'offline.checking' : 'offline.retry')}
        </button>
      </div>
    </div>
  );
}
