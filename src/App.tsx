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
  resumeRawText: '',
  candidateSummary: 'Senior Software Engineer with 6+ years building distributed cloud systems, high-throughput microservices, React/TypeScript frontends, and scalable databases.',
  interviewContext: 'Senior Software Engineering Role, distributed architecture, API design, performance optimization, and system resilience.',
  sentenceLength: 'medium',
  hideFromScreenShare: true,
  pinAboveFullscreen: true,
  autoTriggerOnSilence: true,
  audioInputSource: 'mic',
  speechTtsEnabled: false,
  windowOpacity: 0.98,
};

export default function App() {
  const dragControls = useDragControls();
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem('overdesk_copilot_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState(() => {
    try {
      const saved = localStorage.getItem('overdesk_copilot_transcript');
      return saved || '';
    } catch {
      return '';
    }
  });
  const [suggestedAnswer, setSuggestedAnswer] = useState(() => {
    try {
      const saved = localStorage.getItem('overdesk_copilot_suggested_answer');
      return saved || '';
    } catch {
      return '';
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sessionDurationSec, setSessionDurationSec] = useState(0);

  // Modals
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isStealthModalOpen, setIsStealthModalOpen] = useState(false);

  // Speech manager ref
  const speechManagerRef = useRef<CopilotSpeechManager | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state to localStorage & backend memory cache
  useEffect(() => {
    try {
      localStorage.setItem('overdesk_copilot_transcript', currentTranscript);
      localStorage.setItem('overdesk_copilot_suggested_answer', suggestedAnswer);
    } catch (e) {}
  }, [currentTranscript, suggestedAnswer]);

  // Initial sync from server state cache if available
  useEffect(() => {
    apiFetch<{ state?: Record<string, any> }>('/api/copilot/state')
      .then((res) => {
        if (res?.state?.settings) {
          setSettings((prev) => ({ ...prev, ...res.state.settings }));
        }
      })
      .catch(() => {});
  }, []);

  // Save settings with dual-layer memory (LocalStorage + Backend Cache)
  const handleUpdateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem('overdesk_copilot_settings', JSON.stringify(updated));
        apiFetch('/api/copilot/state', { state: { settings: updated } }).catch(() => {});
      } catch (e) {
        console.warn('Failed to persist settings:', e);
      }
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

  // Request backend answer
  const fetchAnswer = async (
    question: string,
    mode: 'generate' | 'shorter' | 'rephrase' | 'regenerate' = 'generate'
  ) => {
    const activeQuestion = question || currentTranscript || (suggestedAnswer ? 'Current interview topic' : '');
    if (!activeQuestion && !suggestedAnswer) return;
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
        previousAnswer: suggestedAnswer,
      });

      if (data?.answer) {
        setSuggestedAnswer(data.answer);
      } else if (data?.fallback) {
        setSuggestedAnswer(data.fallback);
      }
    } catch (err: any) {
      console.error('Answer generation error:', err);
      // Client-side smart transformation fallback
      if (mode === 'shorter' && suggestedAnswer) {
        const sentences = suggestedAnswer.split(/(?<=[.?!])\s+/).filter(Boolean);
        const shortened = sentences.slice(0, Math.max(1, Math.min(2, Math.ceil(sentences.length / 2)))).join(' ');
        setSuggestedAnswer(shortened || suggestedAnswer);
      } else if (mode === 'rephrase' && suggestedAnswer) {
        setSuggestedAnswer(
          `In my experience, ${suggestedAnswer.replace(/^(I would|I approach|To solve this|In my experience,)\s*/i, '')}`
        );
      } else if (mode === 'regenerate' && (suggestedAnswer || activeQuestion)) {
        setSuggestedAnswer(
          `My approach focuses on establishing clear architectural boundaries, optimizing for O(N) time complexity, and validating all edge cases.`
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Start / Stop Interview listening
  const handleToggleInterview = async () => {
    if (isListening) {
      // Stop session
      if (speechManagerRef.current) {
        speechManagerRef.current.stopListening();
      }
      setIsListening(false);
      setAudioLevel(0);
    } else {
      // Start session - clear placeholder sample so user gets fresh active listening
      setCurrentTranscript('');
      setSuggestedAnswer('');
      setIsListening(true);
      setSessionDurationSec(0);

      if (!speechManagerRef.current) {
        speechManagerRef.current = new CopilotSpeechManager();
      }

      await speechManagerRef.current.startListening({
        audioSource: settings.audioInputSource || 'mic',
        onInterimText: (text) => {
          setCurrentTranscript(text);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
        },
        onFinalText: (text) => {
          setCurrentTranscript(text);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            fetchAnswer(text, 'generate');
          }, 1200);
        },
        onError: (err) => {
          console.warn('Speech recognition warning:', err);
        },
        onAudioLevel: (level) => {
          setAudioLevel(level);
        },
      });
    }
  };

  // Action handlers
  const handleAction = (
    action: 'generate' | 'shorter' | 'rephrase' | 'regenerate',
    customPrompt?: string
  ) => {
    const q = customPrompt || currentTranscript;
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
            onAction={handleAction}
            onOpenScreenModal={() => setIsScreenModalOpen(true)}
            onOpenStealthModal={() => setIsStealthModalOpen(true)}
            sessionDurationSec={sessionDurationSec}
            onSelectPresetQuestion={handleSelectPresetQuestion}
            onResetSession={() => {
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
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto relative z-30 max-w-[420px] w-full"
          style={{ originY: 0 }}
        >
          <FloatingPanel
            settings={settings}
            onStartDrag={(e) => dragControls.start(e)}
            onUpdateSettings={handleUpdateSettings}
            isListening={isListening}
            onToggleInterview={handleToggleInterview}
            currentTranscript={currentTranscript}
            suggestedAnswer={suggestedAnswer}
            isGenerating={isGenerating}
            audioLevel={audioLevel}
            onAction={handleAction}
            onOpenScreenModal={() => setIsScreenModalOpen(true)}
            onOpenStealthModal={() => setIsStealthModalOpen(true)}
            sessionDurationSec={sessionDurationSec}
            onSelectPresetQuestion={handleSelectPresetQuestion}
            onResetSession={() => {
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
