// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subtitles', {
  open: () => ipcRenderer.send('subtitles:open'),
  onClosed: (callback) => ipcRenderer.on('subtitles:closed', () => callback()),
});

contextBridge.exposeInMainWorld('config', {
  getBackendUrl: () => ipcRenderer.invoke('config:backend-url'),
  platform: process.platform,
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
});

// {text, wav: base64 WAV} or null.
contextBridge.exposeInMainWorld('voice', {
  load: () => ipcRenderer.invoke('voice:load'),
  save: (voice) => ipcRenderer.invoke('voice:save', voice),
});
