import { contextBridge, ipcRenderer } from 'electron';

import type {
  ConfigApi,
  SubtitlesApi,
  VirtualMicApi,
  VoiceApi,
  WindowControlsApi,
} from './shared/api';

const subtitles: SubtitlesApi = {
  open: () => ipcRenderer.send('subtitles:open'),
  onClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('subtitles:closed', listener);
    return () => {
      ipcRenderer.off('subtitles:closed', listener);
    };
  },
};

const config: ConfigApi = {
  getBackendUrl: () => ipcRenderer.invoke('config:backend-url'),
  platform: process.platform,
};

const windowControls: WindowControlsApi = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
};

const voice: VoiceApi = {
  load: () => ipcRenderer.invoke('voice:load'),
  save: (sample) => ipcRenderer.invoke('voice:save', sample),
};

const virtualMic: VirtualMicApi = {
  install: () => ipcRenderer.invoke('virtual-mic:install'),
  uninstall: () => ipcRenderer.invoke('virtual-mic:uninstall'),
};

contextBridge.exposeInMainWorld('subtitles', subtitles);
contextBridge.exposeInMainWorld('config', config);
contextBridge.exposeInMainWorld('windowControls', windowControls);
contextBridge.exposeInMainWorld('voice', voice);
contextBridge.exposeInMainWorld('virtualMic', virtualMic);
