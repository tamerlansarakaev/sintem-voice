import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC,
  type ConfigApi,
  type SubtitlesApi,
  type VirtualMicApi,
  type VoiceApi,
  type WindowControlsApi,
} from './shared/api';

const subtitles: SubtitlesApi = {
  open: () => ipcRenderer.send(IPC.subtitlesOpen),
  onClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.subtitlesClosed, listener);
    return () => {
      ipcRenderer.off(IPC.subtitlesClosed, listener);
    };
  },
};

const config: ConfigApi = {
  getBackendUrl: () => ipcRenderer.invoke(IPC.backendUrl),
  platform: process.platform,
};

const windowControls: WindowControlsApi = {
  minimize: () => ipcRenderer.send(IPC.windowMinimize),
  toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
  close: () => ipcRenderer.send(IPC.windowClose),
};

const voice: VoiceApi = {
  load: () => ipcRenderer.invoke(IPC.voiceLoad),
  save: (sample) => ipcRenderer.invoke(IPC.voiceSave, sample),
};

const virtualMic: VirtualMicApi = {
  install: () => ipcRenderer.invoke(IPC.virtualMicInstall),
  uninstall: () => ipcRenderer.invoke(IPC.virtualMicUninstall),
};

contextBridge.exposeInMainWorld('subtitles', subtitles);
contextBridge.exposeInMainWorld('config', config);
contextBridge.exposeInMainWorld('windowControls', windowControls);
contextBridge.exposeInMainWorld('voice', voice);
contextBridge.exposeInMainWorld('virtualMic', virtualMic);
