// Speech Recognition & Audio Capture Utilities for Overdesk Copilot

export interface SpeechListenerOptions {
  onInterimText: (text: string) => void;
  onFinalText: (text: string) => void;
  onError: (error: string) => void;
  onAudioLevel?: (level: number) => void;
}

export class CopilotSpeechManager {
  private recognition: any = null;
  private isListening = false;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  constructor() {
    // Check for web speech API
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
    }
  }

  public isSupported(): boolean {
    return !!this.recognition;
  }

  public async startListening(options: SpeechListenerOptions): Promise<boolean> {
    if (this.isListening) return true;

    try {
      // 1. Start Web Speech recognition if available
      if (this.recognition) {
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
            options.onInterimText(interimTranscript.trim());
          }
          if (finalTranscript) {
            options.onFinalText(finalTranscript.trim());
          }
        };

        this.recognition.onerror = (event: any) => {
          console.warn('Speech recognition event:', event.error);
          if (event.error !== 'no-speech') {
            options.onError(event.error);
          }
        };

        this.recognition.onend = () => {
          // Restart if still marked as listening
          if (this.isListening) {
            try {
              this.recognition.start();
            } catch (e) {
              // Ignore already started error
            }
          }
        };

        this.recognition.start();
      }

      // 2. Setup Audio Visualizer / Level meter
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaStream = stream;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          const source = this.audioContext.createMediaStreamSource(stream);
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 64;
          source.connect(this.analyser);

          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!this.isListening || !this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalized = Math.min(1, average / 128);
            if (options.onAudioLevel) {
              options.onAudioLevel(normalized);
            }
            this.animFrameId = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        }
      } catch (err) {
        console.warn('Microphone audio level capture warning:', err);
      }

      this.isListening = true;
      return true;
    } catch (err: any) {
      console.error('Failed to start speech listener:', err);
      options.onError(err.message || 'Microphone access denied');
      return false;
    }
  }

  public stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // ignore
      }
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

// Simple Text to Speech whisper (optional candidate earpiece readout)
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
