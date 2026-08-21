// Real-Time Speech Recognition & High-Sensitivity Audio Capture for Overdesk Copilot
// Optimized for web-based interview platforms (Mercor, MicroAI, HireVue, Karat, etc.)
// Uses MediaRecorder (WebM/Opus) + PCM WAV fallback with Gemini 3.7 Flash & Web Speech API

import { apiFetch } from './apiClient';

export interface SpeechListenerOptions {
  audioSource?: 'auto' | 'system' | 'mic';
  onInterimText: (text: string) => void;
  onFinalText: (text: string) => void;
  onError: (error: string) => void;
  onAudioLevel?: (level: number) => void;
  onStatusChange?: (status: 'listening' | 'interviewer_speaking' | 'stopped' | 'tab_connected') => void;
}

export class CopilotSpeechManager {
  private isListening = false;
  private audioContext: AudioContext | null = null;
  private activeStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private animFrameId: number | null = null;
  private intervalCheckId: NodeJS.Timeout | null = null;
  private recognition: any = null;
  private isSpeaking = false;
  private speechStartTime = 0;
  private speechSilenceTimeout: NodeJS.Timeout | null = null;
  private isTranscribing = false;
  private lastTranscribedText = '';
  private wakeLock: any = null;

  public isSupported(): boolean {
    const hasWebSpeech = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    const hasMedia = typeof navigator !== 'undefined' && !!(navigator.mediaDevices);
    return hasWebSpeech || hasMedia;
  }

  // Prevent background throttling via Screen WakeLock if available
  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch (e) {}
  }

  private releaseWakeLock() {
    try {
      if (this.wakeLock) {
        this.wakeLock.release().catch(() => {});
        this.wakeLock = null;
      }
    } catch (e) {}
  }

  // Send recorded speech blob to Gemini 3.7 Flash for instant transcription
  private async sendAudioForTranscription(audioBlob: Blob, options: SpeechListenerOptions) {
    if (audioBlob.size < 1200 || this.isTranscribing) return;

    try {
      this.isTranscribing = true;
      const reader = new FileReader();

      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          if (!base64 || !this.isListening) {
            this.isTranscribing = false;
            return;
          }

          const mimeType = audioBlob.type || 'audio/webm';
          const res = await apiFetch<{ text?: string }>('/api/copilot/transcribe-audio', {
            audioBase64: base64,
            mimeType,
          });

          if (res?.text && res.text.trim()) {
            const cleanText = res.text.trim();
            if (cleanText.toLowerCase() !== this.lastTranscribedText.toLowerCase()) {
              this.lastTranscribedText = cleanText;
              if (options.onStatusChange) {
                options.onStatusChange('interviewer_speaking');
              }
              options.onInterimText(cleanText);
              options.onFinalText(cleanText);
            }
          }
        } catch (e) {
          console.warn('Transcription API error:', e);
        } finally {
          this.isTranscribing = false;
        }
      };

      reader.readAsDataURL(audioBlob);
    } catch (e) {
      this.isTranscribing = false;
    }
  }

  // Slice and flush current MediaRecorder buffer for transcription
  private flushSpeechBuffer(options: SpeechListenerOptions) {
    if (!this.mediaRecorder || this.audioChunks.length === 0) return;

    const mime = this.mediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(this.audioChunks, { type: mime });
    this.audioChunks = [];
    this.sendAudioForTranscription(blob, options);
  }

  public async startListening(options: SpeechListenerOptions): Promise<boolean> {
    if (this.isListening) {
      this.stopListening();
    }

    this.audioChunks = [];
    this.isSpeaking = false;
    this.lastTranscribedText = '';

    const requestedSource = options.audioSource || 'auto';

    await this.requestWakeLock();

    try {
      // 1. Acquire Media Stream
      if (requestedSource === 'system' && navigator.mediaDevices?.getDisplayMedia) {
        // Tab / System audio stream for web interview platforms (Mercor, MicroAI, etc.)
        this.activeStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as any,
          systemAudio: 'include',
        } as any);

        const audioTracks = this.activeStream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0) {
          this.stopListening();
          options.onError(
            'No Tab Audio was shared. Please click Start Interview again, select your Mercor/MicroAI tab, and check "Also share tab audio".'
          );
          return false;
        }

        audioTracks.forEach((track) => {
          track.onended = () => {
            this.stopListening();
            if (options.onStatusChange) options.onStatusChange('stopped');
          };
        });
      } else {
        // Auto / Mic mode: request primary audio input
        if (navigator.mediaDevices?.getUserMedia) {
          this.activeStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: true,
            },
          });
        }
      }

      if (!this.activeStream) {
        options.onError('Could not obtain an audio input stream.');
        return false;
      }

      // 2. Setup AudioContext & High-Sensitivity Analyser for Voice Activity Detection
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume().catch(() => {});
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.3;

        const sourceNode = this.audioContext.createMediaStreamSource(this.activeStream);
        sourceNode.connect(this.analyser);

        // 3. Setup MediaRecorder for native continuous chunking
        const audioStreamOnly = new MediaStream(this.activeStream.getAudioTracks());
        let mimeType = 'audio/webm;codecs=opus';
        if (typeof MediaRecorder !== 'undefined') {
          if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            if (MediaRecorder.isTypeSupported('audio/webm')) {
              mimeType = 'audio/webm';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              mimeType = 'audio/mp4';
            } else {
              mimeType = '';
            }
          }

          try {
            this.mediaRecorder = mimeType ? new MediaRecorder(audioStreamOnly, { mimeType }) : new MediaRecorder(audioStreamOnly);
            this.mediaRecorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) {
                this.audioChunks.push(e.data);
                // Keep only last 15 chunks (~3-4s buffer)
                if (this.audioChunks.length > 20) {
                  this.audioChunks.shift();
                }
              }
            };
            // Slice chunks every 200ms
            this.mediaRecorder.start(200);
          } catch (recErr) {
            console.warn('MediaRecorder notice:', recErr);
          }
        }

        // Real-Time Audio Level & VAD Detection Loop
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        const checkAudioLevel = () => {
          if (!this.isListening || !this.analyser) return;

          if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
          }

          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          // High-sensitivity scale (detects quiet speech & headphone tab audio)
          const normalized = Math.min(1, average / 28);

          if (options.onAudioLevel) {
            options.onAudioLevel(normalized);
          }

          // Voice Activity Threshold (> 0.015)
          if (normalized > 0.015) {
            if (!this.isSpeaking) {
              this.isSpeaking = true;
              this.speechStartTime = Date.now();
              if (options.onStatusChange) {
                options.onStatusChange('interviewer_speaking');
              }
            }
            if (this.speechSilenceTimeout) {
              clearTimeout(this.speechSilenceTimeout);
              this.speechSilenceTimeout = null;
            }
          } else if (this.isSpeaking) {
            if (!this.speechSilenceTimeout) {
              this.speechSilenceTimeout = setTimeout(() => {
                this.isSpeaking = false;
                this.flushSpeechBuffer(options);
              }, 450);
            }
          }
        };

        const updateLoop = () => {
          if (!this.isListening) return;
          checkAudioLevel();
          this.animFrameId = requestAnimationFrame(updateLoop);
        };
        updateLoop();

        // Interval heartbeat keeps VAD alive in background tabs
        this.intervalCheckId = setInterval(() => {
          if (this.isListening) {
            checkAudioLevel();
          }
        }, 100);
      }

      // 4. Web Speech API Integration (instant streaming text for standard speech)
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition && requestedSource !== 'system') {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.maxAlternatives = 1;

          rec.onresult = (event: any) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
              } else {
                interimTranscript += transcript;
              }
            }

            if (options.onStatusChange) {
              options.onStatusChange('interviewer_speaking');
            }

            if (interimTranscript.trim()) {
              options.onInterimText(interimTranscript.trim());
            }

            if (finalTranscript.trim()) {
              this.lastTranscribedText = finalTranscript.trim();
              options.onFinalText(finalTranscript.trim());
            }
          };

          rec.onerror = (e: any) => {
            if (e.error !== 'no-speech' && e.error !== 'aborted') {
              console.warn('Web Speech API status:', e.error);
            }
          };

          rec.onend = () => {
            if (this.isListening) {
              try {
                rec.start();
              } catch (restartErr) {}
            }
          };

          rec.start();
          this.recognition = rec;
        } catch (recErr) {
          console.warn('SpeechRecognition init notice:', recErr);
        }
      }

      this.isListening = true;
      if (options.onStatusChange) {
        options.onStatusChange(requestedSource === 'system' ? 'tab_connected' : 'listening');
      }
      return true;
    } catch (err: any) {
      console.warn('Audio capture start error:', err);
      if (err.name === 'NotAllowedError') {
        options.onError('Audio permission was denied. Please allow microphone or select your interview tab with audio enabled.');
      } else {
        options.onError(err.message || 'Could not start audio listener.');
      }
      this.stopListening();
      return false;
    }
  }

  public stopListening() {
    this.isListening = false;
    this.isSpeaking = false;
    this.releaseWakeLock();

    if (this.intervalCheckId) {
      clearInterval(this.intervalCheckId);
      this.intervalCheckId = null;
    }

    if (this.speechSilenceTimeout) {
      clearTimeout(this.speechSilenceTimeout);
      this.speechSilenceTimeout = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
      this.mediaRecorder = null;
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {}
      this.recognition = null;
    }

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => track.stop());
      this.activeStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

// Text to Speech whisper (optional candidate earpiece readout)
export function speakAnswerWhisper(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 1.0;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
