import { PersonaType, SentenceLength, AIModelChoice } from '../types';

// Default Hosted Backend Endpoint (used as fallback when running locally inside Electron without local server)
const HOSTED_BACKEND_ORIGIN = 'https://ais-dev-4lemfiuufuegchaty5ng22-930700759373.europe-west2.run.app';

export function getApiBaseUrl(): string {
  // 1. If custom backend URL is saved in localStorage, use that
  const customUrl = localStorage.getItem('overdesk_custom_backend_url');
  if (customUrl && customUrl.trim().startsWith('http')) {
    return customUrl.trim().replace(/\/+$/, '');
  }

  // 2. If running inside standard HTTP/HTTPS web app (e.g. cloud preview or local dev server)
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http')) {
    return window.location.origin;
  }

  // 3. Running from Electron file:// protocol or packaged app
  return HOSTED_BACKEND_ORIGIN;
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
 * Universal safe API caller: tries local/relative route, falls back to Cloud backend automatically
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

  // First try: Standard relative endpoint if on http(s), or BaseUrl
  const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const primaryUrl = isFileProto ? `${HOSTED_BACKEND_ORIGIN}${cleanEndpoint}` : cleanEndpoint;

  try {
    const res = await fetch(primaryUrl, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.ok) {
      return (await res.json()) as T;
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}: ${res.statusText}`);
  } catch (err: any) {
    console.warn(`Primary request to ${primaryUrl} failed, trying hosted cloud backend fallback...`, err);

    // Fallback: If primary wasn't already the hosted backend, try the hosted backend
    if (primaryUrl !== `${HOSTED_BACKEND_ORIGIN}${cleanEndpoint}`) {
      const fallbackUrl = `${HOSTED_BACKEND_ORIGIN}${cleanEndpoint}`;
      const fallbackRes = await fetch(fallbackUrl, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (fallbackRes.ok) {
        return (await fallbackRes.json()) as T;
      }
      const errFallback = await fallbackRes.json().catch(() => ({}));
      throw new Error(errFallback.error || `Server responded with ${fallbackRes.status}`);
    }

    throw new Error(err.message || 'Failed to connect to AI server. Please check internet connection.');
  }
}
