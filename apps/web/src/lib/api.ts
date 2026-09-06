import type {
  CreateSessionResponse,
  JoinSessionRequest,
  JoinSessionResponse,
  QuizQuestion,
} from '@sigunu/shared';

const BASE = import.meta.env.VITE_API_URL || '';

async function req<T>(path: string, init?: RequestInit & { hostToken?: string }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init?.hostToken) headers['x-host-token'] = init.hostToken;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  createSession: () => req<CreateSessionResponse>('/api/sessions', { method: 'POST' }),

  hostLiveKit: (sessionId: string, hostToken: string) =>
    req<{ participantId: string; authToken: string; livekit: { url: string; token: string; roomName: string } }>(
      '/api/sessions/host-livekit',
      { method: 'POST', body: JSON.stringify({ sessionId, hostToken }) }
    ),

  join: (body: JoinSessionRequest) =>
    req<JoinSessionResponse>('/api/sessions/join', { method: 'POST', body: JSON.stringify(body) }),

  setConfig: (
    sessionId: string,
    hostToken: string,
    body: { defaultCorrectPoints: number; defaultWrongPenalty: number; unansweredPolicy: 'zero' | 'penalty' }
  ) => req<{ ok: true }>(`/api/sessions/${sessionId}/config`, { method: 'PUT', hostToken, body: JSON.stringify(body) }),

  listQuestions: (sessionId: string, hostToken: string) =>
    req<{ questions: QuizQuestion[] }>(`/api/sessions/${sessionId}/questions`, { hostToken }),

  createQuestion: (sessionId: string, hostToken: string, q: unknown) =>
    req<QuizQuestion>(`/api/sessions/${sessionId}/questions`, { method: 'POST', hostToken, body: JSON.stringify(q) }),

  updateQuestion: (sessionId: string, hostToken: string, qid: string, q: unknown) =>
    req<QuizQuestion>(`/api/sessions/${sessionId}/questions/${qid}`, { method: 'PUT', hostToken, body: JSON.stringify(q) }),

  deleteQuestion: (sessionId: string, hostToken: string, qid: string) =>
    req<{ ok: true }>(`/api/sessions/${sessionId}/questions/${qid}`, { method: 'DELETE', hostToken }),

  uploadMedia: async (sessionId: string, hostToken: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/sessions/${sessionId}/media`, {
      method: 'POST',
      headers: { 'x-host-token': hostToken },
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
    return res.json() as Promise<{ id: string; type: 'image' | 'video'; url: string }>;
  },

  extractPdf: async (sessionId: string, hostToken: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/sessions/${sessionId}/extract-pdf`, {
      method: 'POST',
      headers: { 'x-host-token': hostToken },
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Extraction failed');
    return res.json() as Promise<{ mode: 'text' | 'pdf_vision'; imported: QuizQuestion[] }>;
  },
};
