const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Ensure clean alpha rendering for transparent frameless window on Windows DWM
app.commandLine.appendSwitch('enable-transparent-visuals');

let mainWindow;
let tray = null;

/**
 * Windows 10 (2004+) & Windows 11 True Screen Capture Exclusion
 * WDA_EXCLUDEFROMCAPTURE = 0x00000011 (17)
 * Unlike WDA_MONITOR (which fills the window with a black rectangle in screen capture),
 * WDA_EXCLUDEFROMCAPTURE completely removes the window from DWM capture surfaces,
 * so screen shares (Zoom, Teams, Google Meet, OBS, Browser Entire Screen) render whatever
 * is behind the window with ZERO black box.
 */
function applyTrueStealthExclusion(win) {
  if (!win) return;

  // 1. Electron built-in fallback
  try {
    win.setContentProtection(true);
  } catch (e) {
    console.warn('Electron setContentProtection warning:', e);
  }

  // 2. Windows-specific Win32 API call for WDA_EXCLUDEFROMCAPTURE (17)
  if (process.platform === 'win32') {
    try {
      const handleBuf = win.getNativeWindowHandle();
      let hwndNum = '0';
      if (typeof handleBuf.readBigInt64LE === 'function') {
        hwndNum = handleBuf.readBigInt64LE(0).toString();
      } else {
        hwndNum = handleBuf.readInt32LE(0).toString();
      }

      // Execute Win32 SetWindowDisplayAffinity(hwnd, 17)
      const psCommand = `powershell -NoProfile -NonInteractive -Command "$c = @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class WinStealth {\n  [DllImport(\\"user32.dll\\", SetLastError=true)]\n  public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);\n}\n'@; Add-Type -TypeDefinition $c; [WinStealth]::SetWindowDisplayAffinity([IntPtr]${hwndNum}, 17);"`;

      exec(psCommand, (err) => {
        if (err) {
          console.warn('Windows SetWindowDisplayAffinity script note:', err.message);
        } else {
          console.log('Applied WDA_EXCLUDEFROMCAPTURE (17) successfully: Zero black box capture exclusion.');
        }
      });
    } catch (err) {
      console.warn('Could not apply native Win32 exclusion:', err);
    }
  }
}

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
  // using WDA_EXCLUDEFROMCAPTURE (17) so NO black box or shadow appears during screen shares.
  applyTrueStealthExclusion(mainWindow);

  mainWindow.once('ready-to-show', () => {
    applyTrueStealthExclusion(mainWindow);
  });

  mainWindow.on('show', () => {
    applyTrueStealthExclusion(mainWindow);
  });

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

// Direct High-Resolution Screen Snapping for Challenge Solving
ipcMain.handle('capture-desktop-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false
    });

    if (sources && sources.length > 0) {
      // Find primary screen or first available window
      const targetSource = sources.find(s => s.id.startsWith('screen')) || sources[0];
      const dataUrl = targetSource.thumbnail.toDataURL();
      return { success: true, dataUrl };
    }
    return { success: false, error: 'No display screens found' };
  } catch (err) {
    console.error('Error capturing desktop screen:', err);
    return { success: false, error: err.message || 'Capture failed' };
  }
});

const CLOUD_BACKEND_URL = 'https://ais-dev-4lemfiuufuegchaty5ng22-930700759373.europe-west2.run.app';

// AI Proxy handlers for Electron standalone execution
ipcMain.handle('copilot-analyze-screen', async (event, payload) => {
  try {
    const res = await fetch(`${CLOUD_BACKEND_URL}/api/copilot/analyze-screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('Electron copilot-analyze-screen error:', err);
    return { error: err.message || 'Screen analysis request failed' };
  }
});

ipcMain.handle('copilot-answer', async (event, payload) => {
  try {
    const res = await fetch(`${CLOUD_BACKEND_URL}/api/copilot/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('Electron copilot-answer error:', err);
    return { error: err.message || 'Answer request failed' };
  }
});

ipcMain.handle('copilot-parse-resume', async (event, payload) => {
  try {
    const res = await fetch(`${CLOUD_BACKEND_URL}/api/copilot/parse-resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('Electron copilot-parse-resume error:', err);
    return { error: err.message || 'Resume parsing request failed' };
  }
});

app.whenReady().then(() => {
  // Allow getDisplayMedia requests in Electron webPreferences
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0] });
        } else {
          callback({});
        }
      }).catch((err) => {
        console.warn('setDisplayMediaRequestHandler error:', err);
        callback({});
      });
    });
  }

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

