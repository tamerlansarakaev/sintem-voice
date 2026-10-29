import { useEffect, useState } from 'react';

import { Dropdown } from '../components/Dropdown';
import { listInputs, VIRTUAL_MIC_SUPPORTED } from '../lib/devices';
import { UI_LANGUAGES, useI18n, type UiLanguage } from '../lib/i18n';
import { setPref, usePref } from '../lib/prefs';
import type { StringKey } from '../lib/strings';
import { useAppState } from '../state/app-state';
import { useToast } from '../state/toasts';

// Each language by its own name.
const LANGUAGE_NAMES: Record<UiLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

type VirtualStatus = 'Ready' | 'Installed' | 'NotInstalled' | 'Unavailable';

// How long and how often to look for the device after the driver was
// copied or removed: Core Audio needs a moment to restart, and Chromium
// does not always report the change as a devicechange event.
const DEVICE_WAIT_MS = 15000;
const DEVICE_POLL_MS = 500;

// Lists of devices that follow plugging and unplugging; `deps` say when
// `list` itself changes.
function useDevices<T>(list: () => Promise<T[]>, deps: unknown[]) {
  const [devices, setDevices] = useState<T[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      list().then((found) => {
        if (!cancelled) setDevices(found);
      });
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, deps);
  return devices;
}

export function Settings({ hidden }: { hidden: boolean }) {
  const { t, language, setLanguage } = useI18n();
  const { state, refreshVirtualMic } = useAppState();
  const inputMic = usePref('inputMic') ?? '';
  const mixOriginal = usePref('mixOriginal') ?? false;
  const toast = useToast();
  const inputs = useDevices(listInputs, []);
  // Set while the driver is being installed or removed and until the
  // device list catches up.
  const [pending, setPending] = useState<'install' | 'uninstall' | null>(null);

  // A saved microphone that is not connected falls back to the default.
  const inputValue = inputs.some((device) => device.deviceId === inputMic)
    ? inputMic
    : '';

  const device = state.virtualMic;
  let status: VirtualStatus;
  let hint = '';
  if (!VIRTUAL_MIC_SUPPORTED) {
    status = 'Unavailable';
    hint = t('settings.unavailableHint');
  } else if (device) {
    status = state.hasVoice ? 'Ready' : 'Installed';
    hint = state.hasVoice ? device.label : t('settings.installedHint');
  } else {
    status = 'NotInstalled';
  }

  async function toggleVirtualMic() {
    const action = device ? 'uninstall' : 'install';
    setPending(action);
    try {
      await window.virtualMic[action]();
      const deadline = Date.now() + DEVICE_WAIT_MS;
      while (Date.now() < deadline) {
        const found = await refreshVirtualMic();
        if (Boolean(found) === (action === 'install')) break;
        await new Promise((resolve) => setTimeout(resolve, DEVICE_POLL_MS));
      }
    } catch (err) {
      // -128: the password prompt was cancelled.
      if (!(err as Error).message.includes('-128')) {
        toast(t('settings.installFailed', { message: (err as Error).message }), 'error');
      }
    } finally {
      setPending(null);
    }
  }

  let buttonLabel: StringKey = device ? 'settings.uninstall' : 'settings.install';
  if (pending === 'install') buttonLabel = 'settings.installing';
  if (pending === 'uninstall') buttonLabel = 'settings.uninstalling';

  return (
    <section className="page" hidden={hidden}>
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.subtitle')}</p>
      </header>
      <div className="page-body narrow settings">
        <div className="card setting-card">
          <div className="setting-text">
            <h2>{t('settings.language')}</h2>
            <p className="muted">{t('settings.languageHint')}</p>
          </div>
          <Dropdown
            className="setting-select"
            value={language}
            options={UI_LANGUAGES.map((code) => ({
              value: code,
              label: LANGUAGE_NAMES[code],
            }))}
            onChange={setLanguage}
            title={t('settings.language')}
          />
        </div>

        <div className="card setting-card">
          <div className="setting-text">
            <h2>{t('settings.input')}</h2>
            <p className="muted">
              {t(state.recording ? 'settings.inputLocked' : 'settings.inputHint')}
            </p>
          </div>
          <Dropdown
            className="setting-select"
            value={inputValue}
            options={[
              { value: '', label: t('settings.inputDefault') },
              ...inputs.map((input) => ({
                value: input.deviceId,
                label: input.label || input.deviceId,
              })),
            ]}
            disabled={state.recording}
            onChange={(value) => setPref('inputMic', value || null)}
            title={t('settings.input')}
          />
        </div>

        <div className="card setting-card setting-column">
          <div className="setting-row">
            <div className="setting-text">
              <h2>
                <span>{t('settings.virtual')}</span>{' '}
                <span className="pill" data-status={status.toLowerCase()}>
                  {t(`settings.status${status}` as StringKey)}
                </span>
              </h2>
              <p className="muted">{t('settings.virtualHint')}</p>
            </div>
          </div>
          <div className="setting-row">
            <p className="muted vm-hint" hidden={!hint}>
              {hint}
            </p>
            {VIRTUAL_MIC_SUPPORTED && (
              <button
                type="button"
                className={`primary-button${device ? ' danger' : ''}`}
                disabled={pending !== null || state.recording}
                onClick={toggleVirtualMic}
              >
                {t(buttonLabel)}
              </button>
            )}
          </div>
          <div className="divider" />
          <label className="setting-row switch-row">
            <span className="setting-text">
              <strong>{t('settings.mix')}</strong>
              <span className="muted">{t('settings.mixHint')}</span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={mixOriginal}
              onChange={(event) => setPref('mixOriginal', event.target.checked)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
