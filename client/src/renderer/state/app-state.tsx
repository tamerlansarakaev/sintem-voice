import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { backendUrl, checkServer } from '../lib/backend';
import { findVirtualOutput } from '../lib/devices';

// State the main window pages share. Each page owns some fields and the
// others react to them.
export interface AppState {
  online: boolean;
  hasVoice: boolean;
  // The output of the installed virtual microphone, or null.
  virtualMic: MediaDeviceInfo | null;
  // A microphone is in use; the input device cannot change.
  recording: boolean;
}

interface AppStateContext {
  state: AppState;
  update(patch: Partial<AppState>): void;
  // Checks the server now; concurrent calls share one check.
  refreshHealth(): Promise<boolean>;
  // Looks the virtual microphone up again and returns it.
  refreshVirtualMic(): Promise<MediaDeviceInfo | null>;
}

const Context = createContext<AppStateContext | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    online: true,
    hasVoice: false,
    virtualMic: null,
    recording: false,
  });
  const checking = useRef<Promise<boolean> | null>(null);

  const update = useCallback((patch: Partial<AppState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const refreshHealth = useCallback(() => {
    checking.current ??= backendUrl()
      .then(checkServer)
      .then((online) => {
        update({ online });
        return online;
      })
      .finally(() => {
        checking.current = null;
      });
    return checking.current;
  }, [update]);

  const refreshVirtualMic = useCallback(
    () =>
      findVirtualOutput().then((virtualMic) => {
        update({ virtualMic });
        return virtualMic;
      }),
    [update],
  );

  useEffect(() => {
    const refresh = () => void refreshVirtualMic();
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [refreshVirtualMic]);

  useEffect(() => {
    window.voice.load().then((voice) => {
      if (voice) update({ hasVoice: true });
    });
  }, [update]);

  const value = useMemo(
    () => ({ state, update, refreshHealth, refreshVirtualMic }),
    [state, update, refreshHealth, refreshVirtualMic],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppState() {
  const context = useContext(Context);
  if (!context) throw new Error('useAppState outside AppStateProvider');
  return context;
}
