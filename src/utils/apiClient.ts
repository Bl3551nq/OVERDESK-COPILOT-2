import { PersonaType, SentenceLength, AIModelChoice } from '../types';

export const DEFAULT_CLOUD_BACKEND = 'https://ais-dev-4lemfiuufuegchaty5ng22-930700759373.europe-west2.run.app';

export function getApiBaseUrl(): string {
  // 1. If custom backend URL is saved in localStorage, use that
  try {
    const customUrl = localStorage.getItem('overdesk_custom_backend_url');
    if (customUrl && customUrl.trim().startsWith('http')) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  } catch (e) {}

  // 2. If running inside standard HTTP/HTTPS web app (e.g. cloud preview or local dev server)
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) {
    return window.location.origin;
  }

  // 3. Fallback origin for Electron desktop apps running on file:// or local environment
  return DEFAULT_CLOUD_BACKEND;
}

export interface CopilotAnswerRequest {
  question?: string;
  transcriptHistory?: any[];
  persona?: PersonaType;
  resumeText?: string;
  interviewContext?: string;
  sentenceLength?: SentenceLength;
  mode?: 'generate' | 'shorter' | 'rephrase' | 'regenerate';
  previousAnswer?: string;
  modelChoice?: AIModelChoice;
}

export interface ScreenAnalyzeRequest {
  imageBase64: string;
  prompt?: string;
  persona?: PersonaType;
  interviewContext?: string;
}

export interface ParseResumeRequest {
  fileBase64?: string;
  mimeType?: string;
  rawText?: string;
}

/**
 * Universal safe API caller: handles JSON safely and avoids doctype HTML parse crashes
 */
export async function apiFetch<T>(endpoint: string, body?: any): Promise<T> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const method = body !== undefined ? 'POST' : 'GET';

  // Check if Electron IPC handler is available
  try {
    const electron = (window as any).require?.('electron');
    if (electron?.ipcRenderer) {
      if (cleanEndpoint.includes('analyze-screen')) {
        const res = await electron.ipcRenderer.invoke('copilot-analyze-screen', body);
        if (res && !res.error) return res as T;
      } else if (cleanEndpoint.includes('answer')) {
        const res = await electron.ipcRenderer.invoke('copilot-answer', body);
        if (res && !res.error) return res as T;
      } else if (cleanEndpoint.includes('parse-resume')) {
        const res = await electron.ipcRenderer.invoke('copilot-parse-resume', body);
        if (res && !res.error) return res as T;
      }
    }
  } catch (e) {
    // continue to fetch
  }

  const baseUrl = getApiBaseUrl();
  const primaryUrl = `${baseUrl}${cleanEndpoint}`;

  try {
    const res = await fetch(primaryUrl, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();

    if (res.ok) {
      if (contentType.includes('application/json') || (rawText.startsWith('{') || rawText.startsWith('['))) {
        try {
          return JSON.parse(rawText) as T;
        } catch (e) {
          console.warn('JSON parse error from server:', rawText.slice(0, 100));
        }
      }
      return { success: true, raw: rawText } as unknown as T;
    }

    // Try to extract JSON error message
    let errorMessage = `Server error (HTTP ${res.status})`;
    if (rawText.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {}
    } else if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
      errorMessage = `Server temporarily busy or restarting. Please try again.`;
    }

    throw new Error(errorMessage);
  } catch (err: any) {
    console.warn(`Request to ${primaryUrl} failed:`, err?.message || err);
    throw new Error(err.message || 'Failed to connect to AI server. Please check internet connection.');
  }
}

