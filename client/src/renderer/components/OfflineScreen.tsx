import { useEffect, useRef, useState, type FormEvent } from 'react';

import { backendUrl } from '../lib/backend';
import { createWave } from '../lib/canvas';
import { useI18n } from '../lib/i18n';
import { setPref } from '../lib/prefs';
import { useAppState } from '../state/app-state';
import { useToast } from '../state/toasts';

export function OfflineScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { state, refreshHealth } = useAppState();
  const [address, setAddress] = useState('');
  const [checking, setChecking] = useState(false);
  const wave = useRef<HTMLCanvasElement>(null);

  // Prefilled with the address in use each time the screen appears.
  useEffect(() => {
    if (!state.online) backendUrl().then(setAddress);
  }, [state.online]);

  useEffect(() => {
    if (!wave.current) return;
    return createWave(wave.current, { lines: 5, idle: 0.35 }).destroy;
  }, []);

  async function retry() {
    setChecking(true);
    await refreshHealth();
    setChecking(false);
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(address.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      toast(t('offline.invalid'), 'error');
      return;
    }
    setPref('backendUrl', url.origin);
    retry();
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
        <form className="address-form" onSubmit={connect}>
          <label className="field-label" htmlFor="offline-address">
            {t('offline.address')}
          </label>
          <div className="address-row">
            <input
              className="input"
              id="offline-address"
              type="text"
              spellCheck={false}
              placeholder="http://localhost:3000"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button type="submit" className="secondary-button">
              {t('offline.connect')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
