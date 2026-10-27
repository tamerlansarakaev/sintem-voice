const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
} = require('electron');
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

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

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

  subtitlesWindow = new BrowserWindow({
    width: 520,
    height: 280,
    title: 'Live Subtitles',
    alwaysOnTop: true,
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
ipcMain.handle('config:backend-url', () => BACKEND_URL);

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
