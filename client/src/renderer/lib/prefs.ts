import { useSyncExternalStore } from 'react';

import type { UiLanguage } from './i18n';

// Preferences shared by every window. localStorage of the page origin is
// common to all windows, so a change in one reaches the others through the
// `storage` event.
export interface Prefs {
  uiLanguage: UiLanguage;
  // deviceId of the input microphone; unset means the system default.
  inputMic: string;
  mixOriginal: boolean;
}

type Key = keyof Prefs;

const listeners = new Set<(key: Key) => void>();

export function getPref<K extends Key>(key: K): Prefs[K] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Prefs[K]);
  } catch {
    return null;
  }
}

export function setPref<K extends Key>(key: K, value: Prefs[K] | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts until the window closes.
  }
  // `storage` fires only in the other windows.
  listeners.forEach((listener) => listener(key));
}

// Calls `listener` when `key` changes in this or another window.
export function subscribePref(key: Key, listener: () => void) {
  const local = (changed: Key) => {
    if (changed === key) listener();
  };
  const remote = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  listeners.add(local);
  window.addEventListener('storage', remote);
  return () => {
    listeners.delete(local);
    window.removeEventListener('storage', remote);
  };
}

// The raw stored string keeps the snapshot stable between renders.
function readRaw(key: Key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePref<K extends Key>(key: K): Prefs[K] | null {
  const raw = useSyncExternalStore(
    (listener) => subscribePref(key, listener),
    () => readRaw(key),
  );
  return raw === null ? null : (JSON.parse(raw) as Prefs[K]);
}
