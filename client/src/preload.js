// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subtitles', {
  open: () => ipcRenderer.send('subtitles:open'),
  onClosed: (callback) => ipcRenderer.on('subtitles:closed', () => callback()),
});

contextBridge.exposeInMainWorld('config', {
  getBackendUrl: () => ipcRenderer.invoke('config:backend-url'),
});
