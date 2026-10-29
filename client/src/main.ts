import fs from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  type BrowserWindowConstructorOptions,
} from 'electron';
import started from 'electron-squirrel-startup';

import type { VoiceSample } from './shared/api';

// client/.env is optional; see .env.example.
try {
  process.loadEnvFile(path.join(app.getAppPath(), '.env'));
} catch {
  // No .env, fall back to defaults.
}

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let subtitlesWindow: BrowserWindow | null = null;

const isMac = process.platform === 'darwin';

// macOS: translucent window with the native buttons inset at the top left.
// Elsewhere: no frame, the page draws its own buttons at the top right.
const frameOptions: BrowserWindowConstructorOptions = isMac
  ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 24, y: 28 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    }
  : { frame: false, backgroundColor: '#0d0c0b' };

const preload = path.join(__dirname, 'preload.cjs');

// Both windows are pages of one renderer build: the dev server in
// development, the built files in a package.
function loadPage(window: BrowserWindow, page: 'index' | 'subtitles') {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/${page}.html`);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/${page}.html`),
    );
  }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    ...frameOptions,
    webPreferences: { preload },
  });

  loadPage(mainWindow, 'index');
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (!app.isPackaged) mainWindow.webContents.openDevTools();

  // The subtitles window belongs to the main one.
  mainWindow.on('closed', () => {
    mainWindow = null;
    subtitlesWindow?.close();
  });
};

const openSubtitlesWindow = () => {
  if (subtitlesWindow) {
    subtitlesWindow.focus();
    return;
  }

  // Frameless everywhere: the page has its own header with a close button.
  subtitlesWindow = new BrowserWindow({
    width: 560,
    height: 240,
    minWidth: 420,
    minHeight: 180,
    title: 'Live Subtitles',
    alwaysOnTop: true,
    frame: false,
    ...(isMac
      ? {
          vibrancy: 'hud',
          visualEffectState: 'active',
          backgroundColor: '#00000000',
        }
      : { backgroundColor: '#141210' }),
    webPreferences: { preload },
  });

  loadPage(subtitlesWindow, 'subtitles');

  subtitlesWindow.on('closed', () => {
    subtitlesWindow = null;
    mainWindow?.webContents.send('subtitles:closed');
  });
};

ipcMain.on('subtitles:open', openSubtitlesWindow);

// Buttons of frameless windows act on the window that sent them.
ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window?.isMaximized()) window.unmaximize();
  else window?.maximize();
});
ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('config:backend-url', () => BACKEND_URL);

// There is no database: the voice sample lives only on this computer and
// is sent to the server with every live translation session.
const voicePath = () => path.join(app.getPath('userData'), 'voice.json');

ipcMain.handle('voice:load', async (): Promise<VoiceSample | null> => {
  try {
    return JSON.parse(await fs.readFile(voicePath(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('voice:save', async (_event, voice: Partial<VoiceSample>) => {
  if (typeof voice?.text !== 'string' || typeof voice?.wav !== 'string') {
    throw new Error('Invalid voice sample');
  }
  const file = voicePath();
  await fs.writeFile(`${file}.part`, JSON.stringify(voice));
  await fs.rename(`${file}.part`, file);
});

app.whenReady().then(() => {
  // getDisplayMedia() in the subtitles window gets system audio without a
  // picker. Chromium requires a video source too; the renderer drops it.
  // On macOS 14.2+ this needs the "System Audio Recording" permission.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then(([screen]) => callback({ video: screen, audio: 'loopback' }))
      .catch(() => callback({}));
  });

  createWindow();

  // On macOS a window is re-created when the dock icon is clicked and none
  // are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS, where apps stay
// active until the user quits explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
