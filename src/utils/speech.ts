// Speech Recognition & Audio Capture Utilities for Overdesk Copilot
// Supports Microphone, Browser Meeting Tab Audio (for Earpiece users), and Mixed Audio

export interface SpeechListenerOptions {
  onInterimText: (text: string) => void;
  onFinalText: (text: string) => void;
  onError: (error: string) => void;
  onAudioLevel?: (level: number) => void;
  onStatusChange?: (status: 'listening' | 'interviewer_speaking' | 'stopped' | 'tab_connected') => void;
  audioSource?: 'mic' | 'system' | 'mixed';
}

export class CopilotSpeechManager {
  private recognition: any = null;
  private isListening = false;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private tabStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private currentAudioSource: 'mic' | 'system' | 'mixed' = 'mic';

  constructor() {
    this.initRecognition();
  }

  private initRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 1;
        this.recognition.lang = 'en-US';
      } catch (e) {
        console.warn('SpeechRecognition initialization note:', e);
      }
    }
  }

  public isSupported(): boolean {
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  public getAudioSource(): 'mic' | 'system' | 'mixed' {
    return this.currentAudioSource;
  }

  public async startListening(options: SpeechListenerOptions): Promise<boolean> {
    if (this.isListening) {
      this.stopListening();
    }

    this.currentAudioSource = options.audioSource || 'mic';

    try {
      if (!this.recognition) {
        this.initRecognition();
      }

      // 1. Setup Speech Recognition
      if (this.recognition) {
        this.recognition.onstart = () => {
          if (options.onStatusChange) {
            options.onStatusChange('listening');
          }
        };

        this.recognition.onresult = (event: any) => {
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

          if (interimTranscript) {
            if (options.onStatusChange) {
              options.onStatusChange('interviewer_speaking');
            }
            options.onInterimText(interimTranscript.trim());
          }
          if (finalTranscript) {
            options.onFinalText(finalTranscript.trim());
          }
        };

        this.recognition.onerror = (event: any) => {
          console.warn('Speech recognition warning/event:', event.error);
          if (event.error === 'not-allowed') {
            options.onError('Microphone/audio permission denied. Please allow microphone access in your browser address bar.');
          } else if (event.error !== 'no-speech') {
            options.onError(`Audio notice: ${event.error}`);
          }
        };

        this.recognition.onend = () => {
          // Keep continuous recognition alive while active
          if (this.isListening && this.recognition) {
            try {
              this.recognition.start();
            } catch (e) {
              // Ignore already started error
            }
          }
        };

        try {
          this.recognition.start();
        } catch (e) {
          console.warn('Speech recognition start note:', e);
        }
      }

      // 2. Setup Audio Visualizer & Earpiece / Tab Audio Capture
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64;

        // If user chose system/tab audio (e.g. wearing earpiece for Google Meet/Zoom)
        if (this.currentAudioSource === 'system' || this.currentAudioSource === 'mixed') {
          try {
            if (navigator.mediaDevices?.getDisplayMedia) {
              // Capture browser tab audio (Google Meet, Teams, Zoom Web)
              this.tabStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1, height: 1, frameRate: 1 } as any,
                audio: {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                } as any,
              });

              if (this.tabStream && this.tabStream.getAudioTracks().length > 0) {
                const tabSource = this.audioContext.createMediaStreamSource(this.tabStream);
                tabSource.connect(this.analyser);
                if (options.onStatusChange) {
                  options.onStatusChange('tab_connected');
                }
              }
            }
          } catch (tabErr: any) {
            console.warn('Meeting Tab audio selection note:', tabErr);
            // Fallback to mic if tab share was cancelled
          }
        }

        // Also capture mic stream (unless pure system audio and tab stream is already active)
        if (this.currentAudioSource === 'mic' || this.currentAudioSource === 'mixed' || !this.tabStream) {
          try {
            this.micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            });
            if (this.micStream) {
              const micSource = this.audioContext.createMediaStreamSource(this.micStream);
              micSource.connect(this.analyser);
            }
          } catch (micErr) {
            console.warn('Microphone stream capture notice:', micErr);
          }
        }

        // Audio VU Level loop
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        const updateAudioLevel = () => {
          if (!this.isListening || !this.analyser) return;
          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const normalized = Math.min(1, average / 90);
          if (options.onAudioLevel) {
            options.onAudioLevel(normalized);
          }
          this.animFrameId = requestAnimationFrame(updateAudioLevel);
        };
        updateAudioLevel();
      }

      this.isListening = true;
      return true;
    } catch (err: any) {
      console.error('Failed to start speech listener:', err);
      options.onError(err.message || 'Audio access error');
      return false;
    }
  }

  public stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch (e) {
        // ignore
      }
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.tabStream) {
      this.tabStream.getTracks().forEach((track) => track.stop());
      this.tabStream = null;
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

