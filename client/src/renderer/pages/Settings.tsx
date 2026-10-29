import { useEffect, useState } from 'react';

import { listInputs, listVirtualOutputs } from '../lib/devices';
import { UI_LANGUAGES, useI18n, type UiLanguage } from '../lib/i18n';
import { setPref, usePref } from '../lib/prefs';
import type { StringKey } from '../lib/strings';
import { useAppState } from '../state/app-state';

// Each language by its own name.
const LANGUAGE_NAMES: Record<UiLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

type VirtualStatus = 'Ready' | 'Added' | 'NotAdded' | 'Unavailable';

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
  const { state } = useAppState();
  const inputMic = usePref('inputMic') ?? '';
  const mixOriginal = usePref('mixOriginal') ?? false;
  const added = usePref('virtualMic');
  const inputs = useDevices(listInputs, []);
  // Only needed to add a device.
  const outputs = useDevices(
    () => (added ? Promise.resolve([]) : listVirtualOutputs()),
    [added?.deviceId],
  );
  const [chosen, setChosen] = useState('');

  // A saved microphone that is not connected falls back to the default.
  const inputValue = inputs.some((device) => device.deviceId === inputMic)
    ? inputMic
    : '';

  let status: VirtualStatus;
  let hint = '';
  const device = state.virtualMic;
  if (added && device) {
    status = state.hasVoice ? 'Ready' : 'Added';
    hint = state.hasVoice ? device.label : t('settings.addedHint');
  } else if (added) {
    status = 'Unavailable';
    hint = t('settings.missingHint', { name: added.label });
  } else if (outputs.length > 0) {
    status = 'NotAdded';
  } else {
    status = 'Unavailable';
    hint = t('settings.unavailableHint');
  }

  function toggleVirtualMic() {
    if (added) {
      setPref('virtualMic', null);
      return;
    }
    const output =
      outputs.find((option) => option.deviceId === chosen) ?? outputs[0];
    if (!output) return;
    setPref('virtualMic', { deviceId: output.deviceId, label: output.label });
  }

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
          <select
            className="select"
            value={language}
            onChange={(event) => setLanguage(event.target.value as UiLanguage)}
          >
            {UI_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="card setting-card">
          <div className="setting-text">
            <h2>{t('settings.input')}</h2>
            <p className="muted">
              {t(state.recording ? 'settings.inputLocked' : 'settings.inputHint')}
            </p>
          </div>
          <select
            className="select"
            value={inputValue}
            disabled={state.recording}
            onChange={(event) => setPref('inputMic', event.target.value || null)}
          >
            <option value="">{t('settings.inputDefault')}</option>
            {inputs.map((input) => (
              <option key={input.deviceId} value={input.deviceId}>
                {input.label || input.deviceId}
              </option>
            ))}
          </select>
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
            <select
              className="select"
              hidden={outputs.length < 2}
              value={chosen || outputs[0]?.deviceId || ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              {outputs.map((output) => (
                <option key={output.deviceId} value={output.deviceId}>
                  {output.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`primary-button${added ? ' danger' : ''}`}
              disabled={(!added && outputs.length === 0) || state.recording}
              onClick={toggleVirtualMic}
            >
              {t(added ? 'settings.remove' : 'settings.add')}
            </button>
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
