export type PersonaType = 'research' | 'job' | 'coding' | 'design';

export type SentenceLength = 'short' | 'medium' | 'detailed';

export type AIModelChoice = 'gemini-3.7-flash' | 'gemini-2.5-pro';

export type AppFontSize = 'small' | 'normal' | 'large';

export interface UserSettings {
  persona: PersonaType;
  modelChoice?: AIModelChoice;
  fontSize?: AppFontSize;
  resumeFileName?: string;
  resumeRawText: string;
  candidateSummary: string;
  interviewContext: string;
  sentenceLength: SentenceLength;
  hideFromScreenShare: boolean;
  pinAboveFullscreen?: boolean;
  autoTriggerOnSilence: boolean;
  audioInputSource: 'mic' | 'system' | 'mixed';
  speechTtsEnabled: boolean;
  windowOpacity: number; // 0.7 to 1.0
}

export interface TranscriptItem {
  id: string;
  sender: 'interviewer' | 'candidate';
  text: string;
  timestamp: number;
  answer?: string;
  isFinal?: boolean;
}

export interface ScreenAnalysisResult {
  title?: string;
  problemSummary: string;
  verbalResponse: string;
  codeSolution?: string;
  complexity?: {
    time: string;
    space: string;
  };
  keyInsights: string[];
}
