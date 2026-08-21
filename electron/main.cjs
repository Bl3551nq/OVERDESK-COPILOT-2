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

/**
 * Super-Priority Topmost Layer: Pins Over F11 Fullscreen Apps, Video Calls & Taskbar
 * Uses 'screen-saver' level (1000 priority) + Win32 SetWindowPos HWND_TOPMOST
 */
function pinAboveFullscreen(win) {
  if (!win || win.isDestroyed()) return;

  try {
    // 1. Electron top layer (screen-saver priority sits above F11 fullscreen windows & taskbars)
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.moveTop();
  } catch (e) {
    console.warn('Electron setAlwaysOnTop notice:', e);
  }

  // 2. Native Win32 SetWindowPos (HWND_TOPMOST = -1, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE = 0x0013)
  if (process.platform === 'win32') {
    try {
      const handleBuf = win.getNativeWindowHandle();
      let hwndNum = '0';
      if (typeof handleBuf.readBigInt64LE === 'function') {
        hwndNum = handleBuf.readBigInt64LE(0).toString();
      } else {
        hwndNum = handleBuf.readInt32LE(0).toString();
      }

      const psPin = `powershell -NoProfile -NonInteractive -Command "$c = @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class WinPin {\n  [DllImport(\\"user32.dll\\")]\n  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);\n}\n'@; Add-Type -TypeDefinition $c; [WinPin]::SetWindowPos((IntPtr)${hwndNum}, (IntPtr)(-1), 0, 0, 0, 0, 0x0013);"`;
      exec(psPin, () => {});
    } catch (err) {
      // ignore
    }
  }
}

function createTrayIcon() {
  // Verified Blue Scalloped Badge tray icon
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="64" height="64">
    <path fill="#0084FF" d="M512 256c0 28.5-12.7 54.1-32.9 71.4 6.7 27.8 2.2 57.7-12.6 81.3-17.7 28.3-46.7 45.4-78.2 47.9-10.4 26.7-31.5 47.8-58.2 58.2-31.8 12.4-67.4 5.3-92.1-17.8-24.7 23.1-60.3 30.2-92.1 17.8-26.7-10.4-47.8-31.5-58.2-58.2-31.5-2.5-60.5-19.6-78.2-47.9-14.8-23.6-19.3-53.5-12.6-81.3C12.7 310.1 0 284.5 0 256s12.7-54.1 32.9-71.4c-6.7-27.8-2.2-57.7 12.6-81.3 17.7-28.3 46.7-45.4 78.2-47.9 10.4-26.7 31.5-47.8 58.2-58.2 31.8-12.4 67.4-5.3 92.1 17.8 24.7-23.1 60.3-30.2 92.1-17.8 26.7 10.4 47.8 31.5 58.2 58.2 31.5 2.5 60.5 19.6 78.2 47.9 14.8 23.6 19.3 53.5 12.6 81.3C499.3 201.9 512 227.5 512 256z"/>
    <path fill="#FFFFFF" d="M227.3 358.6l-84.9-84.9c-9.4-9.4-9.4-24.6 0-33.9 9.4-9.4 24.6-9.4 33.9 0l51 51 123.1-123.1c9.4-9.4 24.6-9.4 33.9 0 9.4 9.4 9.4 24.6 0 33.9L227.3 358.6z"/>
  </svg>`;

  let icon = null;
  const localIconPath = path.join(__dirname, '../public/verify.svg');
  if (fs.existsSync(localIconPath)) {
    try {
      icon = nativeImage.createFromPath(localIconPath);
    } catch (e) {}
  }
  if (!icon || icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(Buffer.from(svg));
  }

  tray = new Tray(icon.resize({ width: 18, height: 18 }));

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
    fullscreenable: false,   // Prevent OS full screen managers from covering this window
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
  pinAboveFullscreen(mainWindow);

  mainWindow.once('ready-to-show', () => {
    applyTrueStealthExclusion(mainWindow);
    pinAboveFullscreen(mainWindow);
  });

  mainWindow.on('show', () => {
    applyTrueStealthExclusion(mainWindow);
    pinAboveFullscreen(mainWindow);
  });

  // Re-assert topmost when other windows trigger blur, focus, or fullscreen transitions
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      pinAboveFullscreen(mainWindow);
    }
  });

  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      pinAboveFullscreen(mainWindow);
    }
  });

  mainWindow.on('restore', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      pinAboveFullscreen(mainWindow);
    }
  });

  mainWindow.on('always-on-top-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      pinAboveFullscreen(mainWindow);
    }
  });

  // Heartbeat pinning timer: Guarantees F11 fullscreen apps / taskbars can never cover the window
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      try {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch (e) {}
    }
  }, 1500);

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
      pinAboveFullscreen(mainWindow);
    }
  });

  // Keyboard shortcut: Ctrl + Shift + T to force re-pin overlay to ultra-topmost layer
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!mainWindow) return;
    pinAboveFullscreen(mainWindow);
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

ipcMain.on('pin-above-fullscreen', () => {
  if (mainWindow) pinAboveFullscreen(mainWindow);
});

// Dynamic window scaling (0.7x, 1x, 1.2x)
ipcMain.on('set-ui-scale', (event, scale) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const s = typeof scale === 'number' && scale > 0 ? scale : 1;
    const baseW = 440;
    const baseH = 680;
    const newW = Math.round(baseW * s);
    const newH = Math.round(baseH * s);
    mainWindow.setSize(newW, newH);
  }
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

// Disk-backed persistent settings for installed desktop app (Survives app close, restarts & updates)
const getSettingsFilePath = () => {
  try {
    const userDataDir = app.getPath('userData');
    return path.join(userDataDir, 'overdesk_settings.json');
  } catch (e) {
    return path.join(__dirname, 'overdesk_settings.json');
  }
};

ipcMain.handle('copilot-load-settings', async () => {
  try {
    const p = getSettingsFilePath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      return { success: true, settings: JSON.parse(content) };
    }
  } catch (e) {
    console.warn('Could not read settings from disk:', e);
  }
  return { success: false };
});

ipcMain.handle('copilot-save-settings', async (event, settings) => {
  try {
    const p = getSettingsFilePath();
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    console.warn('Could not write settings to disk:', e);
    return { success: false, error: e.message };
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

