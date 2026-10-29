import { useEffect, useState } from 'react';

import { Dropdown } from '../components/Dropdown';
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
            {outputs.length >= 2 && (
              <Dropdown
                className="setting-select"
                value={chosen || outputs[0].deviceId}
                options={outputs.map((output) => ({
                  value: output.deviceId,
                  label: output.label,
                }))}
                onChange={setChosen}
                title={t('settings.virtual')}
              />
            )}
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
