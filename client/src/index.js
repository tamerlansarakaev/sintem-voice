const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// client/.env is optional; see .env.example.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env, fall back to defaults.
}

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
let subtitlesWindow = null;

const isMac = process.platform === 'darwin';

// macOS: translucent window with the native buttons inset at the top left.
// Elsewhere: no frame, the page draws its own buttons at the top right.
const frameOptions = isMac
  ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 24, y: 28 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    }
  : { frame: false, backgroundColor: '#0d0c0b' };

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    ...frameOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  subtitlesWindow.loadFile(path.join(__dirname, 'subtitles.html'));

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

ipcMain.handle('voice:load', async () => {
  try {
    return JSON.parse(await fs.readFile(voicePath(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('voice:save', async (_event, voice) => {
  if (typeof voice?.text !== 'string' || typeof voice?.wav !== 'string') {
    throw new Error('Invalid voice sample');
  }
  const file = voicePath();
  await fs.writeFile(`${file}.part`, JSON.stringify(voice));
  await fs.rename(`${file}.part`, file);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // getDisplayMedia() in the subtitles window gets system audio without a
  // picker. Chromium requires a video source too; the renderer drops it.
  // On macOS 14.2+ this needs the "System Audio Recording" permission.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then(([screen]) => callback({ video: screen, audio: 'loopback' }))
      .catch(() => callback(null));
  });

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
