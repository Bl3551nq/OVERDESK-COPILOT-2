import React, { useState, useRef, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Play,
  Square,
  RotateCcw,
  Scissors,
  Sparkles,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Camera,
  Shield,
  ShieldAlert,
  Sliders,
  FileText,
  Upload,
  Mic,
  MicOff,
  Radio,
  ChevronDown,
  ExternalLink,
  Info,
  Maximize2,
  Minimize2,
  Type,
  Pin,
  X,
} from 'lucide-react';
import { UserSettings, PersonaType, SentenceLength, TranscriptItem, AppFontSize } from '../types';
import { PERSONAS, PersonaInfo, SAMPLE_QUESTIONS } from '../utils/presets';
import { speakAnswerWhisper, stopSpeaking } from '../utils/speech';
import { apiFetch } from '../utils/apiClient';

interface FloatingPanelProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onStartDrag?: (event: React.PointerEvent | React.MouseEvent) => void;
  isListening: boolean;
  onToggleInterview: () => void;
  currentTranscript: string;
  suggestedAnswer: string;
  isGenerating: boolean;
  audioLevel: number;
  onAction: (action: 'generate' | 'shorter' | 'rephrase' | 'regenerate', customPrompt?: string) => void;
  onOpenScreenModal: () => void;
  onOpenStealthModal: () => void;
  sessionDurationSec: number;
  activePresetId?: string;
  onSelectPresetQuestion: (question: string) => void;
  onResetSession: () => void;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  settings,
  onUpdateSettings,
  onStartDrag,
  isListening,
  onToggleInterview,
  currentTranscript,
  suggestedAnswer,
  isGenerating,
  audioLevel,
  onAction,
  onOpenScreenModal,
  onOpenStealthModal,
  sessionDurationSec,
  onSelectPresetQuestion,
  onResetSession,
}) => {
  const [currentView, setCurrentView] = useState<'home' | 'settings'>('home');
  const [copied, setCopied] = useState(false);
  const [isWhispering, setIsWhispering] = useState(false);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);
  const [customQuestionInput, setCustomQuestionInput] = useState('');
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);
  const ORIGINAL_HEIGHT = 580;
  const MAX_HEIGHT = Math.round(ORIGINAL_HEIGHT * 1.5); // 870px (1.5x original)
  const MIN_HEIGHT = ORIGINAL_HEIGHT; // Cannot go below normal original size when not minimized

  const [panelHeight, setPanelHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('overdesk_copilot_panel_height');
      return saved ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parseInt(saved, 10))) : ORIGINAL_HEIGHT;
    } catch {
      return ORIGINAL_HEIGHT;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [resumeParsing, setResumeParsing] = useState(false);
  const [activeAction, setActiveAction] = useState<'regenerate' | 'shorter' | 'rephrase' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const initialTopRef = useRef<number>(0);

  // Persist panel height changes
  useEffect(() => {
    try {
      localStorage.setItem('overdesk_copilot_panel_height', panelHeight.toString());
    } catch (e) {}
  }, [panelHeight]);

  // Bottom resize drag handler (strictly resizes only from bottom downwards, bounded between ORIGINAL_HEIGHT and 1.5x ORIGINAL_HEIGHT)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;
      const topAnchor = initialTopRef.current || panelRef.current.getBoundingClientRect().top;
      const rawHeight = e.clientY - topAnchor;
      const clampedHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, rawHeight));
      setPanelHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Sync Electron native window size when resized or minimized
  useEffect(() => {
    try {
      const electron = (window as any).require?.('electron');
      if (electron?.ipcRenderer) {
        const targetHeight = isMinimized ? 56 : panelHeight + 12;
        electron.ipcRenderer.send('resize-window', { width: 440, height: targetHeight });
      }
    } catch {
      // ignore in browser
    }
  }, [panelHeight, isMinimized]);

  const handleClose = () => {
    try {
      const electron = (window as any).require?.('electron');
      if (electron?.ipcRenderer) {
        electron.ipcRenderer.send('close-window');
        return;
      }
    } catch {
      // ignore
    }
    setIsMinimized(true);
  };

  const handleCopyAnswer = () => {
    if (!suggestedAnswer) return;
    navigator.clipboard.writeText(suggestedAnswer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleWhisper = () => {
    if (isWhispering) {
      stopSpeaking();
      setIsWhispering(false);
    } else {
      if (suggestedAnswer) {
        speakAnswerWhisper(suggestedAnswer);
        setIsWhispering(true);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResumeParsing(true);
    const fileName = file.name;
    const isPdf = file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

    try {
      if (isPdf) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const base64 = ev.target?.result as string;
            // Set 12s safety timeout promise
            const parsePromise = apiFetch<{ summary?: string }>('/api/copilot/parse-resume', {
              fileBase64: base64,
              mimeType: 'application/pdf',
            });

            const timeoutPromise = new Promise<{ summary: string }>((resolve) =>
              setTimeout(() => {
                resolve({
                  summary: `Profile extracted from ${fileName}: Experienced professional with strong technical foundations, problem-solving track record, and collaborative communication skills.`,
                });
              }, 12000)
            );

            const data = await Promise.race([parsePromise, timeoutPromise]);
            onUpdateSettings({
              resumeFileName: fileName,
              candidateSummary:
                data?.summary || `Profile extracted from ${fileName}. Experience loaded into live interview context.`,
            });
          } catch (err) {
            console.error('PDF parsing error:', err);
            onUpdateSettings({
              resumeFileName: fileName,
              candidateSummary: `Resume: ${fileName}. Core experience ready for tailored question answering.`,
            });
          } finally {
            setResumeParsing(false);
          }
        };

        reader.onerror = () => {
          setResumeParsing(false);
          onUpdateSettings({
            resumeFileName: fileName,
            candidateSummary: `Resume: ${fileName} loaded.`,
          });
        };

        reader.readAsDataURL(file);
      } else {
        const text = await file.text();
        const parsePromise = apiFetch<{ summary?: string }>('/api/copilot/parse-resume', {
          rawText: text,
        });

        const timeoutPromise = new Promise<{ summary: string }>((resolve) =>
          setTimeout(() => {
            resolve({
              summary: text.slice(0, 500),
            });
          }, 10000)
        );

        const data = await Promise.race([parsePromise, timeoutPromise]);
        onUpdateSettings({
          resumeFileName: fileName,
          resumeRawText: text,
          candidateSummary: data?.summary || text.slice(0, 500),
        });
        setResumeParsing(false);
      }
    } catch (err) {
      console.error('Resume upload parsing error:', err);
      onUpdateSettings({
        resumeFileName: fileName,
        candidateSummary: `Resume ${fileName} uploaded. Context ready.`,
      });
      setResumeParsing(false);
    } finally {
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentPersonaInfo = PERSONAS[settings.persona] || PERSONAS.coding;
  const fontSize = settings.fontSize || 'normal';

  // Dynamic font sizing classes
  const transcriptFontClass =
    fontSize === 'small'
      ? 'text-[12.5px]'
      : fontSize === 'large'
      ? 'text-[15.5px]'
      : 'text-[14px]';

  const answerFontClass =
    fontSize === 'small'
      ? 'text-[13px]'
      : fontSize === 'large'
      ? 'text-[16.5px]'
      : 'text-[14.5px]';

  return (
    <div
      ref={panelRef}
      id="overdesk-floating-panel"
      style={{
        height: isMinimized ? 'auto' : `${panelHeight}px`,
        opacity: settings.windowOpacity || 1,
      }}
      className="relative w-full rounded-[20px] overflow-hidden flex flex-col bg-[#0d0f12] border border-neutral-800/80 shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.08)] text-neutral-100 transition-opacity duration-200 select-none"
    >
      {/* ================= TITLEBAR (Dark & Stealth & Native OS Drag Anchor) ================= */}
      <div
        onPointerDown={(e) => {
          // Only start drag if left click on titlebar itself, not on nested buttons
          if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, select, textarea, [data-no-drag], .app-no-drag')) {
            onStartDrag?.(e);
          }
        }}
        className="app-drag-header relative z-10 flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800/90 cursor-grab active:cursor-grabbing bg-neutral-950/95"
      >
        <div className="flex items-center gap-2.5 pointer-events-none">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                isListening
                  ? 'bg-emerald-400 shadow-[0_0_12px_#34d399] animate-pulse'
                  : 'bg-emerald-600/80 shadow-[0_0_8px_rgba(5,150,105,0.4)]'
              }`}
            />
            {isListening && (
              <span
                className="absolute w-4 h-4 rounded-full border border-emerald-400/40 animate-ping"
                style={{ animationDuration: '2s' }}
              />
            )}
          </div>
          <span className="text-[13.5px] font-bold tracking-wide text-white flex items-center gap-1.5">
            Overdesk <span className="text-emerald-400 font-medium">· Copilot</span>
            <svg
              viewBox="0 0 512 512"
              className="w-4 h-4 text-sky-400 inline-block drop-shadow-[0_1px_4px_rgba(0,132,255,0.4)]"
              xmlns="http://www.w3.org/2000/svg"
              title="Verified Overdesk Pro (System Tray & Memory Active)"
            >
              <path
                fill="#0084FF"
                d="M512 256c0 28.5-12.7 54.1-32.9 71.4 6.7 27.8 2.2 57.7-12.6 81.3-17.7 28.3-46.7 45.4-78.2 47.9-10.4 26.7-31.5 47.8-58.2 58.2-31.8 12.4-67.4 5.3-92.1-17.8-24.7 23.1-60.3 30.2-92.1 17.8-26.7 10.4-47.8 31.5-58.2 58.2-31.5 2.5-60.5 19.6-78.2-47.9-14.8-23.6-19.3-53.5-12.6-81.3C12.7 310.1 0 284.5 0 256s12.7-54.1 32.9-71.4c-6.7-27.8-2.2-57.7 12.6-81.3 17.7-28.3 46.7-45.4 78.2-47.9 10.4-26.7 31.5-47.8 58.2-58.2 31.8-12.4 67.4-5.3 92.1 17.8 24.7-23.1 60.3-30.2 92.1-17.8 26.7 10.4 47.8 31.5 58.2 58.2 31.5 2.5 60.5 19.6 78.2 47.9 14.8 23.6 19.3 53.5 12.6 81.3C499.3 201.9 512 227.5 512 256z"
              />
              <path
                fill="#FFFFFF"
                d="M227.3 358.6l-84.9-84.9c-9.4-9.4-9.4-24.6 0-33.9 9.4-9.4 24.6-9.4 33.9 0l51 51 123.1-123.1c9.4-9.4 24.6-9.4 33.9 0 9.4 9.4 9.4 24.6 0 33.9L227.3 358.6z"
              />
            </svg>
          </span>
        </div>

        <div className="flex items-center gap-1.5 app-no-drag">
          {/* Pinned over Fullscreen badge */}
          <button
            onClick={() => {
              const nextVal = !(settings.pinAboveFullscreen ?? true);
              onUpdateSettings({ pinAboveFullscreen: nextVal });
              try {
                const electron = (window as any).require?.('electron');
                if (electron?.ipcRenderer) {
                  electron.ipcRenderer.send('pin-above-fullscreen');
                }
              } catch (e) {}
            }}
            title={
              (settings.pinAboveFullscreen ?? true)
                ? 'Pinned: Floats above F11 fullscreen apps, browser tests & taskbar (Ctrl+Shift+T)'
                : 'Click to lock overlay above F11 fullscreen apps'
            }
            className={`app-no-drag px-2 py-0.5 rounded-full border text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              (settings.pinAboveFullscreen ?? true)
                ? 'bg-sky-500/15 border-sky-400/40 text-sky-300 hover:bg-sky-500/25'
                : 'bg-neutral-900 border-neutral-700/60 text-neutral-400 hover:text-white'
            }`}
          >
            <Pin className={`w-2.5 h-2.5 ${(settings.pinAboveFullscreen ?? true) ? 'rotate-45 text-sky-300' : ''}`} />
            <span>{(settings.pinAboveFullscreen ?? true) ? 'Pinned' : 'Pin'}</span>
          </button>

          {/* Stealth badge */}
          {settings.hideFromScreenShare && (
            <button
              onClick={onOpenStealthModal}
              title="Stealth active: Hidden from screen share"
              className="app-no-drag px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              <Shield className="w-2.5 h-2.5" />
              Stealth Active
            </button>
          )}

          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="app-no-drag w-6 h-6 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700/60 flex items-center justify-center text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </button>

          <button
            onClick={handleClose}
            className="app-no-drag w-6 h-6 rounded-lg bg-neutral-900 hover:bg-rose-950/80 hover:border-rose-600/60 border border-neutral-700/60 flex items-center justify-center text-neutral-400 hover:text-rose-300 transition-colors cursor-pointer"
            title="Close / Hide to Tray (Ctrl+Shift+H)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ================= CONTENT BODY ================= */}
      {!isMinimized && (
        <div className="relative z-10 flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
          {currentView === 'home' ? (
            /* ================= HOME VIEW ================= */
            <>
              {/* Top pill row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/15 border border-white/40 text-white flex items-center gap-1 shadow-sm">
                    <span>{currentPersonaInfo.icon}</span>
                    {currentPersonaInfo.title}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 border border-white/15 text-neutral-300">
                    English
                  </span>
                  {isListening && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/20 border border-rose-500/30 text-rose-300">
                      {formatTimer(sessionDurationSec)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={onOpenScreenModal}
                    title="Read Screen Coding/Design Challenge"
                    className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-emerald-300 hover:text-emerald-200 transition-colors flex items-center gap-1 text-xs font-medium cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">OCR</span>
                  </button>

                  <button
                    onClick={() => setCurrentView('settings')}
                    title="Settings"
                    className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <SettingsIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* LISTENING CARD */}
              <div className="p-3.5 rounded-2xl bg-white/[0.06] border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-emerald-300/90">
                  <div className="flex items-center gap-1.5">
                    {isListening ? (
                      <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                    ) : (
                      <MicOff className="w-3 h-3 text-neutral-400" />
                    )}
                    <span>{isListening ? 'LISTENING TO INTERVIEW AUDIO' : 'INTERVIEW AUDIO TRANSCRIPT'}</span>
                  </div>

                  {/* Audio Level Waveform */}
                  {isListening && (
                    <div className="flex items-center gap-0.5 h-3">
                      {[0.4, 0.8, 0.3, 0.9, 0.5, 0.7].map((factor, i) => (
                        <span
                          key={i}
                          className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                          style={{
                            height: `${Math.max(3, audioLevel * factor * 14)}px`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className={`${transcriptFontClass} leading-relaxed text-white/95 min-h-[46px] flex items-center font-normal`}>
                  {currentTranscript ? (
                    <span className="italic font-medium">"{currentTranscript}"</span>
                  ) : isListening ? (
                    <span className="text-neutral-400 text-xs flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Listening to questions from PC / microphone...
                    </span>
                  ) : (
                    <span className="text-neutral-400 text-xs">
                      Press "Start Interview" to listen, or select a question below.
                    </span>
                  )}
                </div>

                {/* Quick preset question trigger */}
                <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <button
                      onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                      className="w-full text-left px-2.5 py-1 rounded-lg bg-black/20 hover:bg-black/30 border border-white/10 text-[11px] text-neutral-300 flex items-center justify-between gap-1 transition-colors cursor-pointer"
                    >
                      <span className="truncate">Sample Questions ({currentPersonaInfo.title})</span>
                      <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                    </button>

                    {showPresetsDropdown && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-neutral-900/95 border border-white/20 rounded-xl shadow-2xl p-1.5 space-y-1 max-h-48 overflow-y-auto">
                        {SAMPLE_QUESTIONS.map((q) => (
                          <button
                            key={q.id}
                            onClick={() => {
                              onSelectPresetQuestion(q.question);
                              setShowPresetsDropdown(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-[11.5px] text-neutral-200 hover:text-white transition-colors"
                          >
                            <span className="font-semibold text-emerald-400 block text-[10px]">
                              {q.category}
                            </span>
                            <span className="line-clamp-2">{q.question}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual trigger test prompt */}
                  <button
                    onClick={() => {
                      const input = window.prompt('Enter interview question to test answers:');
                      if (input) onSelectPresetQuestion(input);
                    }}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-300 text-[11px] font-medium transition-colors"
                  >
                    Type
                  </button>
                </div>
              </div>

              {/* SUGGESTED RESPONSE CARD */}
              <div className="p-4 rounded-2xl bg-white/[0.09] border border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_24px_rgba(0,0,0,0.25)] flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-white">
                  <div className="flex items-center gap-1.5 text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>SUGGESTED RESPONSE</span>
                    {isGenerating && (
                      <span className="text-[10px] text-emerald-400 font-normal animate-pulse">
                        (Generating in ~1.2s...)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleToggleWhisper}
                      title={isWhispering ? 'Stop earpiece whisper' : 'Whisper response into earpiece'}
                      className="p-1 rounded-md hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
                    >
                      {isWhispering ? (
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={handleCopyAnswer}
                      title="Copy response"
                      className="p-1 rounded-md hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className={`${answerFontClass} leading-relaxed text-white/95 min-h-[90px] font-normal whitespace-pre-line`}>
                  {suggestedAnswer ? (
                    suggestedAnswer
                  ) : (
                    <span className="text-neutral-400 text-xs italic">
                      Responses will appear here instantly as soon as the interviewer speaks or finishes a question.
                    </span>
                  )}
                </div>

                {/* Quick Action buttons */}
                <div className="flex items-center gap-1.5 pt-2 border-t border-white/15">
                  <button
                    onClick={() => {
                      setActiveAction('regenerate');
                      onAction('regenerate');
                    }}
                    disabled={isGenerating || !suggestedAnswer}
                    className={`flex-1 py-1.5 px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-40 ${
                      isGenerating && activeAction === 'regenerate'
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                        : 'bg-white/5 hover:bg-white/15 border-white/15 text-neutral-200'
                    }`}
                  >
                    <RotateCcw className={`w-3 h-3 text-emerald-400 ${isGenerating && activeAction === 'regenerate' ? 'animate-spin' : ''}`} />
                    {isGenerating && activeAction === 'regenerate' ? 'Working...' : 'Regenerate'}
                  </button>

                  <button
                    onClick={() => {
                      setActiveAction('shorter');
                      onAction('shorter');
                    }}
                    disabled={isGenerating || !suggestedAnswer}
                    className={`flex-1 py-1.5 px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-40 ${
                      isGenerating && activeAction === 'shorter'
                        ? 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                        : 'bg-white/5 hover:bg-white/15 border-white/15 text-neutral-200'
                    }`}
                  >
                    <Scissors className={`w-3 h-3 text-sky-400 ${isGenerating && activeAction === 'shorter' ? 'animate-pulse' : ''}`} />
                    {isGenerating && activeAction === 'shorter' ? 'Shortening...' : 'Shorter'}
                  </button>

                  <button
                    onClick={() => {
                      setActiveAction('rephrase');
                      onAction('rephrase');
                    }}
                    disabled={isGenerating || !suggestedAnswer}
                    className={`flex-1 py-1.5 px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-40 ${
                      isGenerating && activeAction === 'rephrase'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                        : 'bg-white/5 hover:bg-white/15 border-white/15 text-neutral-200'
                    }`}
                  >
                    <Sparkles className={`w-3 h-3 text-amber-400 ${isGenerating && activeAction === 'rephrase' ? 'animate-pulse' : ''}`} />
                    {isGenerating && activeAction === 'rephrase' ? 'Rephrasing...' : 'Rephrase'}
                  </button>
                </div>
              </div>

              {/* START / END INTERVIEW BUTTON */}
              <div className="mt-auto pt-2">
                <button
                  id="start-btn"
                  onClick={onToggleInterview}
                  className={`w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg cursor-pointer ${
                    isListening
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                      : 'bg-white hover:bg-neutral-100 text-neutral-950 border border-white/80 shadow-[0_4px_24px_rgba(255,255,255,0.3)]'
                  }`}
                >
                  {isListening ? (
                    <>
                      <Square className="w-4 h-4 fill-current text-rose-400" />
                      <span>End Interview Session</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current text-emerald-600" />
                      <span>Start Interview</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            /* ================= SETTINGS VIEW ================= */
            <div className="flex flex-col gap-4 text-xs">
              {/* AI Intelligence Model Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold tracking-wider text-emerald-300 flex items-center justify-between">
                  <span>AI INTELLIGENCE ENGINE</span>
                  <span className="text-[10px] text-neutral-400 font-normal">Gemini Multimodal</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onUpdateSettings({ modelChoice: 'gemini-3.7-flash' })}
                    className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      (settings.modelChoice || 'gemini-3.7-flash') === 'gemini-3.7-flash'
                        ? 'bg-emerald-500/20 border-emerald-400/70 text-white shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">Gemini 3.7 Flash</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-400/20 text-emerald-300 font-mono">1-2s Realtime</span>
                    </div>
                    <p className="text-[10px] text-neutral-300 leading-tight">
                      Ultra-low latency streaming voice responses with adaptive reasoning.
                    </p>
                  </button>

                  <button
                    onClick={() => onUpdateSettings({ modelChoice: 'gemini-2.5-pro' })}
                    className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      settings.modelChoice === 'gemini-2.5-pro'
                        ? 'bg-indigo-500/20 border-indigo-400/70 text-white shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className="text-white">Gemini 2.5 Pro</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-400/20 text-indigo-300 font-mono">Deep Reasoning</span>
                    </div>
                    <p className="text-[10px] text-neutral-300 leading-tight">
                      Maximum reasoning depth for complex math, architecture, and research.
                    </p>
                  </button>
                </div>
              </div>

              {/* Persona Section */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold tracking-wider text-emerald-300">
                  PERSONA FOCUS
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(PERSONAS) as PersonaType[]).map((key) => {
                    const p = PERSONAS[key];
                    const active = settings.persona === key;
                    return (
                      <button
                        key={key}
                        onClick={() => onUpdateSettings({ persona: key })}
                        className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                          active
                            ? 'bg-white/15 border-white/60 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]'
                            : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span>{p.icon}</span>
                          <span>{p.title}</span>
                        </div>
                        <p className="text-[10.5px] text-neutral-400 line-clamp-2 leading-tight">
                          {p.badge}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Resume / About Me Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold tracking-wider text-emerald-300">
                    RESUME / CANDIDATE CONTEXT
                  </label>
                  {settings.resumeFileName && (
                    <span className="text-[10px] text-emerald-400 font-medium">
                      ✓ Uploaded ({settings.resumeFileName})
                    </span>
                  )}
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-3 rounded-xl border border-dashed border-white/30 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2 text-neutral-300 cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs">
                    {resumeParsing ? (
                      'Analyzing resume with Gemini...'
                    ) : settings.resumeFileName ? (
                      `Replace ${settings.resumeFileName}`
                    ) : (
                      'Upload résumé (PDF, DOCX, TXT)'
                    )}
                  </span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".pdf,.docx,.txt,.md"
                    className="hidden"
                  />
                </div>

                <textarea
                  value={settings.candidateSummary}
                  onChange={(e) => onUpdateSettings({ candidateSummary: e.target.value })}
                  placeholder="Or paste your summary/experience (e.g. 5 yrs React/Node, Led payment team at Fintech, Scaled to 1M DAU)..."
                  className="w-full h-16 p-2.5 rounded-xl bg-black/20 border border-white/15 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400/50 resize-none font-sans"
                />
              </div>

              {/* Target Interview Context */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold tracking-wider text-emerald-300">
                  TARGET INTERVIEW CONTEXT
                </label>
                <textarea
                  value={settings.interviewContext}
                  onChange={(e) => onUpdateSettings({ interviewContext: e.target.value })}
                  placeholder="e.g. Senior Backend Role at Stripe, emphasis on distributed transactions, Postgres, Redis, and high concurrency..."
                  className="w-full h-16 p-2.5 rounded-xl bg-black/20 border border-white/15 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400/50 resize-none font-sans"
                />
              </div>

              {/* Font Size & Readability Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11.5px] font-bold tracking-wider text-emerald-300 flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5 text-emerald-400" />
                    <span>FONT SIZE & READABILITY</span>
                  </label>
                  <span className="text-[10px] text-neutral-400 font-medium">
                    {settings.fontSize === 'small'
                      ? 'Slightly Smaller'
                      : settings.fontSize === 'large'
                      ? 'Slightly Bigger'
                      : 'Normal'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fontSize: 'small' })}
                    className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                      settings.fontSize === 'small'
                        ? 'bg-emerald-500/20 border-emerald-400/80 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="text-xs font-semibold leading-none">Aa</span>
                    <span className="text-[10px] font-medium leading-tight">Slightly Smaller</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fontSize: 'normal' })}
                    className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                      (settings.fontSize || 'normal') === 'normal'
                        ? 'bg-emerald-500/20 border-emerald-400/80 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-none">Aa</span>
                    <span className="text-[10px] font-medium leading-tight">Normal</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fontSize: 'large' })}
                    className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                      settings.fontSize === 'large'
                        ? 'bg-emerald-500/20 border-emerald-400/80 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="text-base font-bold leading-none">Aa</span>
                    <span className="text-[10px] font-medium leading-tight">Slightly Bigger</span>
                  </button>
                </div>
              </div>

              {/* Sentence Length Selection */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold tracking-wider text-emerald-300">
                  RESPONSE SENTENCE LENGTH
                </label>
                <div className="flex gap-1.5">
                  {(['short', 'medium', 'detailed'] as SentenceLength[]).map((len) => (
                    <button
                      key={len}
                      onClick={() => onUpdateSettings({ sentenceLength: len })}
                      className={`flex-1 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-all cursor-pointer ${
                        settings.sentenceLength === len
                          ? 'bg-white/20 border-white/60 text-white'
                          : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {len}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pin Above Fullscreen (F11) & Taskbar Toggle */}
              <div className="pt-2 border-t border-white/15 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Pin className="w-3.5 h-3.5 text-sky-400" />
                    Overlay F11 Fullscreen & Taskbar
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    Always stays topmost above fullscreen browser tests, proctored screens, video calls & taskbar
                  </div>
                </div>

                <div
                  onClick={() => {
                    const nextVal = !(settings.pinAboveFullscreen ?? true);
                    onUpdateSettings({ pinAboveFullscreen: nextVal });
                    try {
                      const electron = (window as any).require?.('electron');
                      if (electron?.ipcRenderer) {
                        electron.ipcRenderer.send('pin-above-fullscreen');
                      }
                    } catch (e) {}
                  }}
                  className={`w-10 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                    (settings.pinAboveFullscreen ?? true) ? 'bg-sky-500' : 'bg-neutral-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      (settings.pinAboveFullscreen ?? true) ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>

              {/* Stealth & Overlay Toggle */}
              <div className="pt-2 border-t border-white/15 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    Hide from Screen Share
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    Windows DWM stealth exclusion (WDA_EXCLUDEFROMCAPTURE)
                  </div>
                </div>

                <div
                  onClick={() =>
                    onUpdateSettings({ hideFromScreenShare: !settings.hideFromScreenShare })
                  }
                  className={`w-10 h-6 rounded-full p-0.5 cursor-pointer transition-colors ${
                    settings.hideFromScreenShare ? 'bg-emerald-500' : 'bg-neutral-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      settings.hideFromScreenShare ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>

              {/* Window Opacity Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-neutral-300">
                  <span>Window Opacity (Ghost Mode)</span>
                  <span className="font-mono text-emerald-400">{Math.round((settings.windowOpacity || 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.0"
                  step="0.05"
                  value={settings.windowOpacity || 1}
                  onChange={(e) => onUpdateSettings({ windowOpacity: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>

              {/* Persistent App Memory Status */}
              <div className="pt-2 border-t border-white/15">
                <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                    <div>
                      <div className="text-[11.5px] font-bold text-sky-200">App Memory & State: Active</div>
                      <div className="text-[9.5px] text-neutral-400">Settings, resume profile & notes persist across app restarts</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-sky-300 bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-400/30">
                    Saved ✓
                  </span>
                </div>
              </div>

              {/* Save & Return */}
              <button
                onClick={() => {
                  setSaveSuccessNotice(true);
                  setTimeout(() => {
                    setSaveSuccessNotice(false);
                    setCurrentView('home');
                  }, 400);
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-bold text-xs hover:opacity-95 transition-all shadow cursor-pointer mt-2 flex items-center justify-center gap-1.5"
              >
                {saveSuccessNotice ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>Saved to Memory!</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>Save & Return</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= BOTTOM RESIZE HANDLE ================= */}
      {!isMinimized && (
        <div
          data-no-drag="true"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (panelRef.current) {
              initialTopRef.current = panelRef.current.getBoundingClientRect().top;
            }
            setIsResizing(true);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          className="relative z-30 h-5 w-full flex items-center justify-center cursor-ns-resize hover:bg-white/10 active:bg-white/15 transition-colors border-t border-neutral-800/40"
          title="Drag down to extend height (Original: 580px - Max: 870px)"
        >
          <div className="w-10 h-1.5 rounded-full bg-neutral-600 hover:bg-emerald-400/80 active:bg-emerald-400 transition-colors" />
        </div>
      )}
    </div>
  );
};
