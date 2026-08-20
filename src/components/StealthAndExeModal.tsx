import React, { useState } from 'react';
import { EyeOff, Download, ShieldCheck, Terminal, Copy, Check, X, Laptop, Monitor, Sparkles } from 'lucide-react';

interface StealthAndExeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StealthAndExeModal: React.FC<StealthAndExeModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'stealth' | 'exe'>('stealth');

  if (!isOpen) return null;

  const electronCodeSnippet = `// main.js - Native Windows Exe Stealth & Fullscreen Pinning
const { app, BrowserWindow, globalShortcut } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 680,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false, // Prevents OS from hiding window when other apps go full screen
    webPreferences: { nodeIntegration: true }
  });

  // 1. Invisible on Screen Share (Zoom, Meet, Teams, OBS)
  win.setContentProtection(true);

  // 2. Ultra-Topmost Layer: Pins Over F11 Fullscreen Tests & Windows Taskbar
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Re-pin whenever window blurs or transitions
  win.on('blur', () => win.setAlwaysOnTop(true, 'screen-saver', 1));

  // Shortcut Ctrl+Shift+T to re-assert topmost layer instantly
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.moveTop();
  });

  win.loadURL('http://localhost:3000');
}

app.whenReady().then(createWindow);`;

  const handleCopy = () => {
    navigator.clipboard.writeText(electronCodeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto flex items-center justify-center p-4 bg-black/80">
      <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Stealth Screen-Share Protection & Windows .EXE
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-white/10 px-5 pt-3 gap-4">
          <button
            onClick={() => setActiveTab('stealth')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'stealth'
                ? 'border-emerald-400 text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            Screen Share Cloaking (How It Works)
          </button>
          <button
            onClick={() => setActiveTab('exe')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'exe'
                ? 'border-emerald-400 text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Windows .EXE Standalone Exporter
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-neutral-300 leading-relaxed">
          {activeTab === 'stealth' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-white mb-1">
                    100% Invisible to Zoom, Teams, Google Meet & Discord
                  </div>
                  When running as the native Windows application, Overdesk Copilot binds to the Windows Desktop Window Manager (DWM) display affinity flag:{' '}
                  <code className="text-emerald-300 font-mono bg-black/40 px-1.5 py-0.5 rounded">
                    WDA_EXCLUDEFROMCAPTURE (0x00000011)
                  </code>
                  .
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <Monitor className="w-4 h-4 text-sky-400" />
                    What YOU See
                  </div>
                  <p className="text-neutral-400 text-[11px]">
                    The floating glass overlay sits crystal clear on top of your coding test, video call, or notes.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <Laptop className="w-4 h-4 text-amber-400" />
                    What the INTERVIEWER Sees
                  </div>
                  <p className="text-neutral-400 text-[11px]">
                    The shared stream completely ignores this window. Interviewers only see your IDE / desktop without any overlay.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Additional Built-in Stealth Safeguards:
                </div>
                <ul className="space-y-1.5 list-disc pl-4 text-neutral-300 text-[11.5px]">
                  <li>
                    <strong className="text-white">F11 Fullscreen & Taskbar Overlay:</strong> Configured with screen-saver priority and Win32 Topmost pinning so it stays visible over F11 fullscreen test browsers (HackerRank, Codility, HireVue), video calls, and the Windows taskbar.
                  </li>
                  <li>
                    <strong className="text-white">Re-Pin Hotkey:</strong> Press <code className="bg-white/10 px-1 rounded text-white font-mono">Ctrl + Shift + T</code> to immediately re-lock overlay priority over any full-screen window.
                  </li>
                  <li>
                    <strong className="text-white">Adjustable Transparency:</strong> Dim opacity from 50% to 100% so you can read background code seamlessly.
                  </li>
                  <li>
                    <strong className="text-white">Panic Hide Hotkey:</strong> Toggle hide/show in 1 millisecond using <code className="bg-white/10 px-1 rounded text-white font-mono">Ctrl + Shift + H</code>.
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-neutral-300">
                You can run Overdesk Copilot directly in this web workspace, or package it into a standalone Windows <code className="text-white font-mono bg-white/10 px-1 py-0.5 rounded">OverdeskCopilot.exe</code> using Electron or Tauri.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    Windows Native Exe Config
                  </span>
                  <button
                    onClick={handleCopy}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center gap-1 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy Code
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] text-emerald-300 overflow-x-auto">
                  {electronCodeSnippet}
                </pre>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-1">
                <div className="font-semibold text-white">Quick Build Command:</div>
                <div className="font-mono text-neutral-300 text-[11px] bg-black/40 p-2 rounded border border-white/5">
                  npx electron-builder --win --x64
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white text-neutral-950 font-semibold text-xs hover:bg-neutral-200 transition-all cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
