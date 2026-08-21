// Real-Time Speech Recognition & Robust Multi-Engine Audio Capture for Overdesk Copilot
// Optimized for browser-based platforms (Mercor, MicroAI, HireVue, Karat, etc.)
// Features: Web Audio API, Web Speech API, Background Keep-Alive, WakeLock & Fullscreen Auto-Resume

import { apiFetch } from './apiClient';

export interface SpeechListenerOptions {
  audioSource?: 'auto' | 'system' | 'mic';
  onInterimText: (text: string) => void;
  onFinalText: (text: string) => void;
  onError: (error: string) => void;
  onAudioLevel?: (level: number) => void;
  onStatusChange?: (status: 'listening' | 'interviewer_speaking' | 'stopped' | 'tab_connected') => void;
}

// Convert float PCM samples to a 100% valid 16kHz 16-bit Mono WAV file
function encodeWAV(samples: Float32Array, sampleRate: number = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

export class CopilotSpeechManager {
  private isListening = false;
  private audioContext: AudioContext | null = null;
  private activeStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private animFrameId: number | null = null;
  private intervalCheckId: NodeJS.Timeout | null = null;
  private recognition: any = null;
  private circularPreRoll: Float32Array[] = [];
  private recordedPcmChunks: Float32Array[] = [];
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

  // Send PCM audio chunk to Gemini 3.7 Flash for instant Speech-To-Text
  private async processPcmBuffer(options: SpeechListenerOptions) {
    if (this.recordedPcmChunks.length === 0 || this.isTranscribing) return;

    try {
      this.isTranscribing = true;

      // Include pre-roll buffer if available to ensure first syllables are captured
      const allChunks = [...this.circularPreRoll, ...this.recordedPcmChunks];
      let totalLength = 0;
      for (const chunk of allChunks) {
        totalLength += chunk.length;
      }

      // Minimum ~0.4 seconds of audio (6400 samples at 16kHz)
      if (totalLength < 6400) {
        this.recordedPcmChunks = [];
        this.isTranscribing = false;
        return;
      }

      const mergedSamples = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of allChunks) {
        mergedSamples.set(chunk, offset);
        offset += chunk.length;
      }

      this.recordedPcmChunks = [];

      const sampleRate = this.audioContext?.sampleRate || 16000;
      let finalSamples = mergedSamples;
      if (sampleRate !== 16000) {
        const ratio = sampleRate / 16000;
        const newLength = Math.round(mergedSamples.length / ratio);
        finalSamples = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          finalSamples[i] = mergedSamples[Math.min(mergedSamples.length - 1, Math.round(i * ratio))];
        }
      }

      const wavBlob = encodeWAV(finalSamples, 16000);
      if (wavBlob.size < 800) {
        this.isTranscribing = false;
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          if (!base64 || !this.isListening) {
            this.isTranscribing = false;
            return;
          }

          const res = await apiFetch<{ text?: string }>('/api/copilot/transcribe-audio', {
            audioBase64: base64,
            mimeType: 'audio/wav',
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
          console.warn('Speech transcription note:', e);
        } finally {
          this.isTranscribing = false;
        }
      };
      reader.readAsDataURL(wavBlob);
    } catch (e) {
      this.isTranscribing = false;
    }
  }

  public async startListening(options: SpeechListenerOptions): Promise<boolean> {
    if (this.isListening) {
      this.stopListening();
    }

    this.recordedPcmChunks = [];
    this.circularPreRoll = [];
    this.isSpeaking = false;
    this.lastTranscribedText = '';

    const requestedSource = options.audioSource || 'auto';

    await this.requestWakeLock();

    try {
      // 1. Acquire Stream (Mercor / MicroAI / Tab Audio vs Microphone)
      if (requestedSource === 'system' && navigator.mediaDevices?.getDisplayMedia) {
        this.activeStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
            width: { max: 1 },
            height: { max: 1 },
            frameRate: { max: 1 },
          } as any,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          } as any,
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        } as any);

        const audioTracks = this.activeStream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0) {
          this.stopListening();
          options.onError(
            'No Tab / PC Audio was selected. When the browser prompt opens, choose your Mercor / MicroAI tab and make sure "Share tab audio" is enabled.'
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
        // Auto / Mic mode: request standard audio stream
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            this.activeStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true,
              },
            });
          } catch (micErr) {
            console.warn('Microphone stream notice:', micErr);
          }
        }
      }

      // 2. Setup AudioContext & Analyser for Waveform, VAD and PCM WAV recording
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && this.activeStream) {
        this.audioContext = new AudioCtx();
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume().catch(() => {});
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;

        const sourceNode = this.audioContext.createMediaStreamSource(this.activeStream);
        sourceNode.connect(this.analyser);

        // Setup ScriptProcessor for direct PCM audio capture
        try {
          this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
          this.scriptProcessor.onaudioprocess = (e) => {
            if (!this.isListening) return;
            // Ensure audio context remains active even if page lost focus / went full screen
            if (this.audioContext && this.audioContext.state === 'suspended') {
              this.audioContext.resume().catch(() => {});
            }

            const inputData = e.inputBuffer.getChannelData(0);
            const copy = new Float32Array(inputData.length);
            copy.set(inputData);

            if (this.isSpeaking) {
              this.recordedPcmChunks.push(copy);
              if (this.recordedPcmChunks.length > 25 && Date.now() - this.speechStartTime > 4500) {
                this.speechStartTime = Date.now();
                this.processPcmBuffer(options);
              }
            } else {
              this.circularPreRoll.push(copy);
              if (this.circularPreRoll.length > 4) {
                this.circularPreRoll.shift();
              }
            }
          };

          sourceNode.connect(this.scriptProcessor);
          this.scriptProcessor.connect(this.audioContext.destination);
        } catch (procErr) {
          console.warn('Audio processor notice:', procErr);
        }

        // Real-Time Audio Level & VAD Detection Loop
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        const checkAudioLevel = () => {
          if (!this.isListening || !this.analyser) return;

          // Auto-resume suspended AudioContext if full-screen mode tried to sleep it
          if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
          }

          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const normalized = Math.min(1, average / 45);

          if (options.onAudioLevel) {
            options.onAudioLevel(normalized);
          }

          // Voice Activity threshold
          if (normalized > 0.02) {
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
                this.processPcmBuffer(options);
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

        // Backup setInterval check (keeps VAD alive even if requestAnimationFrame throttles in fullscreen background)
        this.intervalCheckId = setInterval(() => {
          if (this.isListening) {
            checkAudioLevel();
          }
        }, 100);
      }

      // 3. Initialize Web Speech Recognition alongside (if available and not purely tab audio)
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

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch (e) {}
      this.scriptProcessor = null;
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
