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

import type { VoiceSample } from '../../shared/api';
import { backendUrl, checkServer } from '../lib/backend';
import { listDevices } from '../lib/devices';

// State the main window pages share. Each page owns some fields and the
// others react to them.
export interface AppState {
  online: boolean;
  voice: VoiceSample | null;
  inputs: MediaDeviceInfo[];
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
  // Lists the devices again and returns the virtual microphone.
  refreshDevices(): Promise<MediaDeviceInfo | null>;
}

const Context = createContext<AppStateContext | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    online: true,
    voice: null,
    inputs: [],
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

  const refreshDevices = useCallback(
    () =>
      listDevices().then((devices) => {
        update(devices);
        return devices.virtualMic;
      }),
    [update],
  );

  useEffect(() => {
    const refresh = () => void refreshDevices();
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [refreshDevices]);

  useEffect(() => {
    window.voice.load().then((voice) => update({ voice }));
  }, [update]);

  const value = useMemo(
    () => ({ state, update, refreshHealth, refreshDevices }),
    [state, update, refreshHealth, refreshDevices],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppState() {
  const context = useContext(Context);
  if (!context) throw new Error('useAppState outside AppStateProvider');
  return context;
}
