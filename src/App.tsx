import React, { useState, useEffect, useRef } from 'react';
import { motion, useDragControls } from 'motion/react';
import { FloatingPanel } from './components/FloatingPanel';
import { ScreenChallengeModal } from './components/ScreenChallengeModal';
import { StealthAndExeModal } from './components/StealthAndExeModal';
import { UserSettings } from './types';
import { CopilotSpeechManager } from './utils/speech';
import { apiFetch } from './utils/apiClient';

const DEFAULT_SETTINGS: UserSettings = {
  persona: 'coding',
  modelChoice: 'gemini-3.7-flash',
  fontSize: 'normal',
  uiScale: 1,
  resumeRawText: '',
  candidateSummary: '',
  interviewContext: '',
  sentenceLength: 'medium',
  hideFromScreenShare: true,
  pinAboveFullscreen: true,
  autoTriggerOnSilence: true,
  audioInputSource: 'auto',
  speechTtsEnabled: false,
  windowOpacity: 0.98,
};

export default function App() {
  const dragControls = useDragControls();
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem('overdesk_copilot_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.audioInputSource) {
          parsed.audioInputSource = 'auto';
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.warn('LocalStorage load note:', e);
    }
    return DEFAULT_SETTINGS;
  });

  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState(() => {
    try {
      return localStorage.getItem('overdesk_copilot_transcript') || '';
    } catch {
      return '';
    }
  });
  const [suggestedAnswer, setSuggestedAnswer] = useState(() => {
    try {
      return localStorage.getItem('overdesk_copilot_suggested_answer') || '';
    } catch {
      return '';
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sessionDurationSec, setSessionDurationSec] = useState(0);
  const [autoAnswerCountdown, setAutoAnswerCountdown] = useState<number | null>(null);

  // Modals
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isStealthModalOpen, setIsStealthModalOpen] = useState(false);

  // Speech manager & silence timer refs
  const speechManagerRef = useRef<CopilotSpeechManager | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-resume audio processing if browser throttled during fullscreen
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (isListening && speechManagerRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          // Trigger keep-alive ping
        }
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('visibilitychange', handleVisibilityOrFocus);
    document.addEventListener('fullscreenchange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      document.removeEventListener('fullscreenchange', handleVisibilityOrFocus);
    };
  }, [isListening]);

  const clearSilenceTimers = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoAnswerCountdown(null);
  };

  // Persistent storage: LocalStorage + Electron Disk File + Server State Cache
  useEffect(() => {
    try {
      localStorage.setItem('overdesk_copilot_transcript', currentTranscript);
      localStorage.setItem('overdesk_copilot_suggested_answer', suggestedAnswer);
    } catch (e) {}
  }, [currentTranscript, suggestedAnswer]);

  // Initial deep load from Electron disk file & Cloud state cache
  useEffect(() => {
    // 1. Check Electron native disk storage
    try {
      const electron = (window as any).require?.('electron');
      if (electron?.ipcRenderer) {
        electron.ipcRenderer.invoke('copilot-load-settings').then((res: any) => {
          if (res?.success && res?.settings) {
            setSettings((prev) => ({ ...prev, ...res.settings }));
          }
        }).catch(() => {});
      }
    } catch (e) {}

    // 2. Sync from server state cache
    apiFetch<{ state?: Record<string, any> }>('/api/copilot/state')
      .then((res) => {
        if (res?.state?.settings && Object.keys(res.state.settings).length > 0) {
          setSettings((prev) => ({ ...prev, ...res.state.settings }));
        }
      })
      .catch(() => {});
  }, []);

  // Save settings across all storage layers (LocalStorage, Electron Disk File & Server Memory)
  const handleUpdateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem('overdesk_copilot_settings', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage save note:', e);
      }

      // Save to Electron disk file if in desktop mode
      try {
        const electron = (window as any).require?.('electron');
        if (electron?.ipcRenderer) {
          electron.ipcRenderer.invoke('copilot-save-settings', updated).catch(() => {});
          if (newSettings.uiScale !== undefined) {
            electron.ipcRenderer.send('set-ui-scale', newSettings.uiScale);
          }
        }
      } catch (e) {}

      // Save to backend state memory
      apiFetch('/api/copilot/state', { state: { settings: updated } }).catch(() => {});

      return updated;
    });
  };

  // Timer effect for active session
  useEffect(() => {
    let interval: any = null;
    if (isListening) {
      interval = setInterval(() => {
        setSessionDurationSec((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Request backend answer with optimistic instant updates
  const fetchAnswer = async (
    question: string,
    mode: 'generate' | 'shorter' | 'rephrase' | 'regenerate' = 'generate'
  ) => {
    const activeQuestion = question || currentTranscript || (suggestedAnswer ? 'Current interview topic' : 'General Technical Interview Question');
    const prevAnswer = suggestedAnswer;

    // Instant optimistic transform for zero-latency user feedback
    if (mode === 'shorter' && prevAnswer) {
      const sentences = prevAnswer.split(/(?<=[.?!])\s+/).filter(Boolean);
      const shortened = sentences.slice(0, Math.max(1, Math.min(2, Math.ceil(sentences.length / 2)))).join(' ');
      setSuggestedAnswer(shortened || prevAnswer);
    } else if (mode === 'rephrase' && prevAnswer) {
      setSuggestedAnswer(
        `In my direct experience, ${prevAnswer.replace(/^(I would|I approach|To solve this|In my experience,|Basically,)\s*/i, '')}`
      );
    }

    setIsGenerating(true);

    try {
      const data = await apiFetch<{ answer?: string; fallback?: string }>('/api/copilot/answer', {
        question: activeQuestion,
        persona: settings.persona,
        modelChoice: settings.modelChoice || 'gemini-3.7-flash',
        resumeText: settings.candidateSummary || settings.resumeRawText,
        interviewContext: settings.interviewContext,
        sentenceLength: settings.sentenceLength,
        mode,
        previousAnswer: prevAnswer,
      });

      if (data?.answer && data.answer.trim()) {
        setSuggestedAnswer(data.answer.trim());
      } else if (data?.fallback) {
        setSuggestedAnswer(data.fallback);
      }
    } catch (err: any) {
      console.warn('Answer generation fallback active:', err?.message || err);

      // Smart programmatic fallback if offline or API limit
      if (mode === 'shorter') {
        const sentences = (prevAnswer || activeQuestion).split(/(?<=[.?!])\s+/).filter(Boolean);
        setSuggestedAnswer(sentences.slice(0, Math.max(1, Math.min(2, Math.ceil(sentences.length / 2)))).join(' '));
      } else if (mode === 'rephrase') {
        setSuggestedAnswer(
          `From an architectural standpoint, I prioritize clear invariants, decoupling read/write paths, and testing against production scale.`
        );
      } else if (mode === 'regenerate') {
        if (settings.persona === 'job') {
          setSuggestedAnswer(
            `In a recent initiative, I aligned cross-functional teams around measurable KPIs, resolved architectural bottlenecks, and delivered the core milestone ahead of timeline.`
          );
        } else {
          setSuggestedAnswer(
            `I approach this by isolating the core invariants, applying a two-pointer or frequency hash map for O(N) linear time, and validating edge cases.`
          );
        }
      } else {
        setSuggestedAnswer(
          `I approach this methodically by clarifying the operational constraints, architecting for low latency, and delivering clean, maintainable code.`
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Start / Stop Interview listening with automatic speech detection & pause answering
  const handleToggleInterview = async () => {
    if (isListening) {
      // Stop session
      if (speechManagerRef.current) {
        speechManagerRef.current.stopListening();
      }
      clearSilenceTimers();
      setIsListening(false);
      setAudioLevel(0);
    } else {
      // Start session
      setCurrentTranscript('');
      clearSilenceTimers();
      setIsListening(true);
      setSessionDurationSec(0);

      if (!speechManagerRef.current) {
        speechManagerRef.current = new CopilotSpeechManager();
      }

      const onSpeechDetected = (text: string) => {
        if (!text || !text.trim()) return;
        const cleanText = text.trim();
        setCurrentTranscript(cleanText);

        clearSilenceTimers();

        // Automatic Answer Trigger exactly 2.0s after speech pause
        if (cleanText.length >= 6) {
          let remainingMs = 2000;
          setAutoAnswerCountdown(2.0);

          countdownIntervalRef.current = setInterval(() => {
            remainingMs -= 100;
            if (remainingMs <= 0) {
              if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
              }
              setAutoAnswerCountdown(null);
            } else {
              setAutoAnswerCountdown(Number((remainingMs / 1000).toFixed(1)));
            }
          }, 100);

          silenceTimerRef.current = setTimeout(() => {
            clearSilenceTimers();
            fetchAnswer(cleanText, 'generate');
          }, 2000);
        }
      };

      const started = await speechManagerRef.current.startListening({
        audioSource: settings.audioInputSource || 'auto',
        onInterimText: (text) => {
          onSpeechDetected(text);
        },
        onFinalText: (text) => {
          onSpeechDetected(text);
        },
        onStatusChange: (status) => {
          if (status === 'stopped') {
            setIsListening(false);
            setAudioLevel(0);
          }
        },
        onError: (err) => {
          console.warn('Audio capture status:', err);
          setIsListening(false);
          setAudioLevel(0);
        },
        onAudioLevel: (level) => {
          setAudioLevel(level);
        },
      });

      if (!started) {
        setIsListening(false);
        setAudioLevel(0);
      }
    }
  };

  // Action handlers (Regenerate, Shorter, Rephrase, Custom)
  const handleAction = (
    action: 'generate' | 'shorter' | 'rephrase' | 'regenerate',
    customPrompt?: string
  ) => {
    const q = customPrompt || currentTranscript || '';
    fetchAnswer(q, action);
  };

  const handleSelectPresetQuestion = (question: string) => {
    setCurrentTranscript(question);
    fetchAnswer(question, 'generate');
  };

  const isElectron =
    typeof window !== 'undefined' &&
    (Boolean((window as any).process?.versions?.electron) ||
      navigator.userAgent.toLowerCase().includes('electron') ||
      typeof (window as any).require === 'function');

  return (
    <div className={`w-full h-full bg-transparent overflow-hidden ${isElectron ? 'p-1.5 flex flex-col justify-start items-stretch' : 'fixed inset-0 pointer-events-none flex items-start justify-center pt-6 sm:pt-10'}`}>
      {/* Floating Movable Glassmorphic Overlay Panel */}
      {isElectron ? (
        <div className="w-full h-full relative z-30">
          <FloatingPanel
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            isListening={isListening}
            onToggleInterview={handleToggleInterview}
            currentTranscript={currentTranscript}
            suggestedAnswer={suggestedAnswer}
            isGenerating={isGenerating}
            audioLevel={audioLevel}
            autoAnswerCountdown={autoAnswerCountdown}
            onAction={handleAction}
            onOpenScreenModal={() => setIsScreenModalOpen(true)}
            onOpenStealthModal={() => setIsStealthModalOpen(true)}
            sessionDurationSec={sessionDurationSec}
            onSelectPresetQuestion={handleSelectPresetQuestion}
            onResetSession={() => {
              clearSilenceTimers();
              setCurrentTranscript('');
              setSuggestedAnswer('');
              setSessionDurationSec(0);
            }}
          />
        </div>
      ) : (
        <motion.div
          drag
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto relative z-30 max-w-[420px] w-full"
          style={{
            originY: 0,
            originX: 0.5,
            transform: `scale(${settings.uiScale || 1})`,
            transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <FloatingPanel
            settings={settings}
            onStartDrag={(e) => dragControls.start(e as any)}
            onUpdateSettings={handleUpdateSettings}
            isListening={isListening}
            onToggleInterview={handleToggleInterview}
            currentTranscript={currentTranscript}
            suggestedAnswer={suggestedAnswer}
            isGenerating={isGenerating}
            audioLevel={audioLevel}
            autoAnswerCountdown={autoAnswerCountdown}
            onAction={handleAction}
            onOpenScreenModal={() => setIsScreenModalOpen(true)}
            onOpenStealthModal={() => setIsStealthModalOpen(true)}
            sessionDurationSec={sessionDurationSec}
            onSelectPresetQuestion={handleSelectPresetQuestion}
            onResetSession={() => {
              clearSilenceTimers();
              setCurrentTranscript('');
              setSuggestedAnswer('');
              setSessionDurationSec(0);
            }}
          />
        </motion.div>
      )}

      {/* Screen Vision / Challenge OCR Modal */}
      <ScreenChallengeModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        persona={settings.persona}
        interviewContext={settings.interviewContext}
        onApplySolutionAsAnswer={(solutionText) => {
          setSuggestedAnswer(solutionText);
          setCurrentTranscript('Screen Coding / Design Challenge Analysis');
        }}
      />

      {/* Stealth Screen-Share Info & Exe Packaging Modal */}
      <StealthAndExeModal
        isOpen={isStealthModalOpen}
        onClose={() => setIsStealthModalOpen(false)}
      />
    </div>
  );
}
