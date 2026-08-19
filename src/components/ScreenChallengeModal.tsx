import React, { useState, useRef } from 'react';
import { Camera, X, Check, Loader2, Sparkles, Code2, AlertCircle, Upload, Eye } from 'lucide-react';
import { PersonaType } from '../types';

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
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCaptureScreen = async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen capture API is not supported in this browser context.');
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'never' } as any,
      });

      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        setCapturedImage(dataUrl);
      }
      track.stop();
    } catch (err: any) {
      console.warn('Screen capture prompt cancelled or failed:', err);
      // Fallback: invite user to upload or paste a screenshot
      setError(
        err.name === 'NotAllowedError'
          ? 'Screen capture permission was dismissed. You can also upload or paste a screenshot below.'
          : err.message
      );
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
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!capturedImage) return;
    setAnalyzing(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const res = await fetch('/api/copilot/analyze-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: capturedImage,
          persona,
          interviewContext,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze challenge');
      }

      setAnalysisResult(data.analysis);
    } catch (err: any) {
      console.error('Analysis error:', err);
      setError(err.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-neutral-900/90 border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
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
            className="p-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="text-xs text-neutral-300 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/10">
            <span className="font-semibold text-emerald-300">Live OCR & Challenge Solver:</span>{' '}
            Snap the interviewer's coding problem (LeetCode, HackerRank, IDE, bug, or design wireframe). Gemini Vision reads the screen and generates both the <span className="text-white font-medium">verbal talking points</span> to say out loud and the <span className="text-white font-medium">optimal code/design solution</span>.
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={handleCaptureScreen}
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Capture Active Screen / Window
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-neutral-200 text-xs font-medium flex items-center gap-2 transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Screenshot
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
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
                  onClick={() => setCapturedImage(null)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white text-xs border border-white/20"
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
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
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
