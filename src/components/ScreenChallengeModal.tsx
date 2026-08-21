import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, Check, Loader2, Sparkles, Code2, AlertCircle, Upload, Eye, Clipboard, Scissors, RefreshCw, Layers, Terminal, Layout, HelpCircle, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { PersonaType } from '../types';
import { apiFetch } from '../utils/apiClient';

interface ScreenChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: PersonaType;
  interviewContext: string;
  onApplySolutionAsAnswer: (verbalResponse: string) => void;
}

export type ChallengeCategory = 'auto' | 'coding' | 'system_design' | 'frontend_ui' | 'multiple_choice' | 'case_study';

// Helper: Compress and resize image for ultra-fast, lightweight transmission
const compressImageDataUrl = (dataUrl: string, maxWidth = 1600, maxHeight = 1200): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export const ScreenChallengeModal: React.FC<ScreenChallengeModalProps> = ({
  isOpen,
  onClose,
  persona,
  interviewContext,
  onApplySolutionAsAnswer,
}) => {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challengeCategory, setChallengeCategory] = useState<ChallengeCategory>('auto');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processAndSetImage = async (rawUrl: string) => {
    // Clear previous analysis result immediately upon new capture
    setAnalysisResult(null);
    setError(null);
    try {
      const compressed = await compressImageDataUrl(rawUrl);
      setCapturedImage(compressed);
    } catch {
      setCapturedImage(rawUrl);
    }
  };

  // Listen for Clipboard Paste (Ctrl+V) anywhere while the modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              if (typeof event.target?.result === 'string') {
                await processAndSetImage(event.target.result);
              }
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCaptureScreen = async () => {
    setError(null);
    setAnalysisResult(null);
    setCapturing(true);

    try {
      // 1. Try Desktop Electron Direct Snapper (0 prompts, 100% instant)
      const electron = (window as any).require?.('electron');
      if (electron?.ipcRenderer) {
        const res = await electron.ipcRenderer.invoke('capture-desktop-screen');
        if (res?.success && res.dataUrl) {
          await processAndSetImage(res.dataUrl);
          setCapturing(false);
          return;
        } else if (res?.error) {
          console.warn('Electron direct screen capture note:', res.error);
        }
      }

      // 2. Web / Browser fallback using getDisplayMedia with <video> canvas draw
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
          'Direct screen capture is restricted in this preview frame. Please use "Upload Screenshot" or press Win+Shift+S and Ctrl+V to paste!'
        );
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'never' } as any,
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve()).catch(() => resolve());
        };
      });

      // Allow a brief frame to render
      await new Promise((r) => setTimeout(r, 120));

      const canvas = document.createElement('canvas');
      canvas.width = Math.min(1920, video.videoWidth || 1920);
      canvas.height = Math.min(1080, video.videoHeight || 1080);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        await processAndSetImage(dataUrl);
      }

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());
    } catch (err: any) {
      console.warn('Screen capture note:', err);
      if (err.name === 'NotAllowedError') {
        setError('Screen share selection was cancelled. You can also press Win+Shift+S and Ctrl+V to paste the challenge.');
      } else {
        setError(err.message || 'Failed to capture screen image.');
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    setError(null);
    setAnalysisResult(null);

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (typeof event.target?.result === 'string') {
          await processAndSetImage(event.target.result);
        }
      };
      reader.readAsDataURL(files[0]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setError(null);
      setAnalysisResult(null);
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (typeof event.target?.result === 'string') {
          await processAndSetImage(event.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!capturedImage) return;
    setAnalyzing(true);
    setError(null);
    setAnalysisResult(null);

    let specificPrompt = '';
    if (challengeCategory === 'coding') {
      specificPrompt = 'Focus on optimal algorithmic code solution, clean syntax, edge cases, and Big-O complexity.';
    } else if (challengeCategory === 'system_design') {
      specificPrompt = 'Focus on system design architecture, components breakdown, data flow, APIs, caching, database choice, and scaling tradeoffs.';
    } else if (challengeCategory === 'frontend_ui') {
      specificPrompt = 'Focus on UI/UX frontend implementation, component hierarchy, responsive layout, state management, and accessibility.';
    } else if (challengeCategory === 'multiple_choice') {
      specificPrompt = 'Identify the multiple choice or test question, provide the exact right option/answer, and concise explanation why.';
    } else if (challengeCategory === 'case_study') {
      specificPrompt = 'Provide structured business/case study consulting analysis, framework, key takeaways, and strategic recommendations.';
    }

    try {
      const data = await apiFetch<{ analysis?: string; error?: string }>('/api/copilot/analyze-screen', {
        imageBase64: capturedImage,
        prompt: specificPrompt,
        persona,
        challengeType: challengeCategory,
        interviewContext,
      });

      if (data?.analysis) {
        setAnalysisResult(data.analysis);
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        throw new Error('No solution returned from model');
      }
    } catch (err: any) {
      console.warn('Analysis error:', err);
      setError(err?.message || 'Failed to analyze screenshot. Please check the image and try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyResult = () => {
    if (!analysisResult) return;
    navigator.clipboard.writeText(analysisResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto flex items-center justify-center p-4 bg-black/80">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        className={`relative w-full max-w-2xl bg-neutral-900 border ${
          isDraggingOver ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-neutral-700/80'
        } rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all`}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white tracking-wide">
              Screen Vision · Universal Challenge & Problem Solver
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="text-xs text-neutral-300 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/10">
            <span className="font-semibold text-emerald-300">Live Multimodal Problem Solver:</span>{' '}
            Snap or paste any coding problem, system architecture diagram, UI design, multiple-choice question, or case study. Gemini Vision identifies the specific challenge and gives you both <span className="text-white font-medium">spoken talking points</span> and the <span className="text-white font-medium">complete step-by-step solution</span>.
          </div>

          {/* Category Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
              Challenge Focus Type
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { id: 'auto', label: 'Auto Detect', icon: Sparkles },
                { id: 'coding', label: 'Coding / DSA', icon: Terminal },
                { id: 'system_design', label: 'System Design', icon: Layers },
                { id: 'frontend_ui', label: 'UI / Figma', icon: Layout },
                { id: 'multiple_choice', label: 'Test / MCQ', icon: HelpCircle },
                { id: 'case_study', label: 'Case Study', icon: FileText },
              ].map((cat) => {
                const Icon = cat.icon;
                const isSelected = challengeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setChallengeCategory(cat.id as ChallengeCategory);
                      if (analysisResult) setAnalysisResult(null);
                    }}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium flex flex-col items-center gap-1 transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              onClick={handleCaptureScreen}
              disabled={capturing}
              className="py-2.5 px-4 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {capturing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Snapping Display...
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  Capture Active Screen
                </>
              )}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-neutral-200 text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Image File
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
          </div>

          {/* Quick Snipping / Clipboard Hint Box */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-950/60 border border-neutral-800 text-[11px] text-neutral-400">
            <div className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 font-mono text-[10px]">Win + Shift + S</kbd> to snip, then press <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 font-mono text-[10px]">Ctrl + V</kbd> to paste!
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-emerald-400/80 font-medium">
              <Clipboard className="w-3.5 h-3.5" />
              <span>Paste ready</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              {capturedImage && (
                <button
                  onClick={handleAnalyze}
                  className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Image Preview */}
          {capturedImage && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border border-white/15 max-h-56 bg-black/40 flex items-center justify-center">
                <img
                  src={capturedImage}
                  alt="Captured Challenge"
                  className="max-h-56 w-auto object-contain"
                />
                <button
                  onClick={() => {
                    setCapturedImage(null);
                    setAnalysisResult(null);
                    setError(null);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white text-xs border border-white/20 cursor-pointer"
                  title="Remove Image"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {!analysisResult && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full py-3 rounded-xl bg-white text-neutral-950 font-semibold text-xs flex items-center justify-center gap-2 hover:bg-neutral-200 transition-all shadow-lg cursor-pointer disabled:opacity-50"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-neutral-900" />
                      Analyzing Problem with Gemini Vision...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      Solve Challenge Now
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Solution Breakdown */}
          {analysisResult && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <Code2 className="w-4 h-4" />
                  Solution & Talking Points
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyResult}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={() => {
                      onApplySolutionAsAnswer(analysisResult);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Use as Active Response
                  </button>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-200 leading-relaxed font-sans max-h-80 overflow-y-auto prose prose-invert prose-xs max-w-none">
                <div className="markdown-body">
                  <ReactMarkdown>{analysisResult}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
