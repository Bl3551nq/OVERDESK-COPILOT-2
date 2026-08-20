const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure clean alpha rendering for transparent frameless window on Windows DWM
app.commandLine.appendSwitch('enable-transparent-visuals');

let mainWindow;
let tray = null;

function createTrayIcon() {
  // Generate a clean high-resolution tray icon programmatically (emerald dot / shield)
  // This ensures a crisp icon is always present on Windows system tray without external image dependencies
  const size = 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#09090b" stroke="#10b981" stroke-width="2.5"/>
    <circle cx="12" cy="12" r="4.5" fill="#10b981"/>
  </svg>`;

  const icon = nativeImage.createFromBuffer(Buffer.from(svg));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Overdesk Copilot',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide Panel (Ctrl+Shift+H)',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Stealth: Invisible to Screen Shares',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Exit Copilot',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Overdesk Copilot (Stealth Active)');
  tray.setContextMenu(contextMenu);

  // Left click tray icon to toggle show / hide
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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
    skipTaskbar: true,       // 100% hidden from the Windows Taskbar (only in System Tray)
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

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of quitting when closed from window
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
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
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.hide();
});

app.whenReady().then(() => {
  createTrayIcon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
  }
});

app.on('window-all-closed', () => {
  // Keep alive in system tray on Windows & Mac
});

