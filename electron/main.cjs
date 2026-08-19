const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function startBackendServer() {
  const serverScript = path.join(__dirname, '..', 'dist', 'server.cjs');
  try {
    serverProcess = spawn('node', [serverScript], {
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production' },
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('Failed to spawn backend server:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 340,
    minHeight: 380,
    maxWidth: 600,
    maxHeight: 900,
    frame: false,             // Frameless floating window
    transparent: true,       // Pure transparent background overlay
    alwaysOnTop: true,       // Always floating on top of all windows
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  // Windows Stealth Display Affinity:
  // Under the hood, this invokes Win32 SetWindowDisplayAffinity(hwnd, 0x00000011 /* WDA_EXCLUDEFROMCAPTURE */)
  // This makes the window 100% INVISIBLE to Zoom, Google Meet, Teams, Discord, & OS Screen Share.
  mainWindow.setContentProtection(true);

  // Load backend or development URL
  const targetUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  
  const loadWithRetry = (retries = 10) => {
    mainWindow.loadURL(targetUrl).catch((err) => {
      if (retries > 0) {
        setTimeout(() => loadWithRetry(retries - 1), 1000);
      } else {
        console.error('Failed to connect to Overdesk backend server.');
      }
    });
  };

  loadWithRetry();

  // Keyboard shortcut: Ctrl + Shift + H to instantly toggle hide/show
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.env.NODE_ENV === 'production' || !process.env.ELECTRON_START_URL) {
    startBackendServer();
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
