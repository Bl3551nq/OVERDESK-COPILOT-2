const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 340,
    minHeight: 380,
    maxWidth: 800,
    maxHeight: 1100,
    frame: false,             // Frameless floating window
    transparent: true,       // Pure transparent background overlay
    backgroundColor: '#00000000',
    alwaysOnTop: true,       // Always floating on top of all windows
    hasShadow: false,
    skipTaskbar: false,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // Windows Stealth Display Affinity:
  // Excludes window from screen capture/recordings/sharing (Zoom, Google Meet, Teams, Discord, OBS)
  // while remaining 100% visible on your actual physical monitor.
  try {
    mainWindow.setContentProtection(true);
  } catch (e) {
    console.warn('Could not set display affinity content protection:', e);
  }

  // Load built index.html from dist
  if (process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    // Look for index.html in relative locations for both dev and packaged app
    const possiblePaths = [
      path.join(__dirname, '..', 'dist', 'index.html'),
      path.join(app.getAppPath(), 'dist', 'index.html'),
      path.join(__dirname, 'dist', 'index.html')
    ];

    const targetFile = possiblePaths.find(p => fs.existsSync(p));

    if (targetFile) {
      mainWindow.loadFile(targetFile);
    } else {
      mainWindow.loadURL('http://localhost:3000');
    }
  }

  // Keyboard shortcut: Ctrl + Shift + H to instantly toggle hide/show
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers from Frontend for dynamic resizing & window controls
ipcMain.on('resize-window', (event, { width, height }) => {
  if (!mainWindow) return;
  const currentBounds = mainWindow.getBounds();
  mainWindow.setSize(
    Math.round(width || currentBounds.width),
    Math.round(height || currentBounds.height)
  );
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
