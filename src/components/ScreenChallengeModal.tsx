import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, Check, Loader2, Sparkles, Code2, AlertCircle, Upload, Eye, Clipboard, Scissors } from 'lucide-react';
import { PersonaType } from '../types';
import { apiFetch } from '../utils/apiClient';

interface ScreenChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: PersonaType;
  interviewContext: string;
  onApplySolutionAsAnswer: (verbalResponse: string) => void;
}

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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            reader.onload = (event) => {
              if (typeof event.target?.result === 'string') {
                setCapturedImage(event.target.result);
                setError(null);
                setAnalysisResult(null);
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
    setCapturing(true);

    try {
      // 1. Try Desktop Electron Direct Snapper (0 prompts, 100% instant)
      const electron = (window as any).require?.('electron');
      if (electron?.ipcRenderer) {
        const res = await electron.ipcRenderer.invoke('capture-desktop-screen');
        if (res?.success && res.dataUrl) {
          setCapturedImage(res.dataUrl);
          setCapturing(false);
          return;
        } else if (res?.error) {
          console.warn('Electron direct screen capture error:', res.error);
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
      await new Promise((r) => setTimeout(r, 100));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        setCapturedImage(dataUrl);
      }

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());
    } catch (err: any) {
      console.warn('Screen capture note:', err);
      if (err.name === 'NotAllowedError') {
        setError('Screen share selection was cancelled. You can also press Win+Shift+S and Ctrl+V to paste the challenge.');
      } else {
        setError(
          err.message ||
            'Could not capture screen. Tip: Press Win+Shift+S to take a snip, then press Ctrl+V here to paste!'
        );
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setCapturedImage(ev.target.result);
        setError(null);
        setAnalysisResult(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          setCapturedImage(ev.target.result);
          setError(null);
          setAnalysisResult(null);
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

    try {
      const data = await apiFetch<{ analysis: string }>('/api/copilot/analyze-screen', {
        imageBase64: capturedImage,
        persona,
        interviewContext,
      });

      if (!data?.analysis) {
        throw new Error('No solution returned from AI model');
      }

      setAnalysisResult(data.analysis);
    } catch (err: any) {
      console.error('Analysis error:', err);
      setError(err.message || 'Analysis failed. Please check internet connection and try again.');
    } finally {
      setAnalyzing(false);
    }
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
              Screen Vision · Coding & Design Challenge Solver
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
            <span className="font-semibold text-emerald-300">Live OCR & Challenge Solver:</span>{' '}
            Snap or paste the interviewer's coding problem (LeetCode, HackerRank, IDE, bug, or design wireframe). Gemini Vision analyzes the screen and generates both the <span className="text-white font-medium">verbal talking points</span> to say out loud and the <span className="text-white font-medium">optimal code/design solution</span>.
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
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
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
                      Analyzing Challenge with Gemini Vision...
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
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-200 leading-relaxed font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
                {analysisResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
