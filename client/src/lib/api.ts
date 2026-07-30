import type {
  Attempt,
  CritiqueResponse,
  GraphDSL,
  MasteryEntry,
  Problem,
  ProblemSummary,
  ScoreResult,
  SettingsView,
  SimConfig,
  SimResult,
  Stats,
  ConceptCard,
  CanvasDoc,
} from '@loadbearing/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public hint?: string,
    public raw?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      'Cannot reach the Loadbearing server on port 8787.',
      'offline',
      'Is `npm run dev` still running in the terminal?',
    );
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; hint?: string; raw?: string } })?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, e?.code ?? 'http_error', e?.hint, e?.raw);
  }
  return body as T;
}

export const api = {
  health: () => req<{ ok: boolean; llmConfigured: boolean; fake: boolean }>('/health'),

  problems: () => req<ProblemSummary[]>('/problems'),
  problem: (id: string) => req<Problem>(`/problems/${id}`),
  concepts: () => req<ConceptCard[]>('/concepts'),
  weaknessTarget: () => req<{ level: number; concepts: string[] }>('/weakness-target'),
  generateProblem: (body: { level?: number; concepts?: string[] }) =>
    req<Problem>('/problems/generate', { method: 'POST', body: JSON.stringify(body) }),
  deleteProblem: (id: string) => req<{ ok: true }>(`/problems/${id}`, { method: 'DELETE' }),

  submit: (body: {
    problemId: string;
    round: number;
    graph: GraphDSL;
    twistText?: string;
    previousOverall?: number;
  }) =>
    req<{ attemptId: number; score: ScoreResult; sim: SimResult | null }>('/attempts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  attempts: (problemId?: string) =>
    req<Attempt[]>(`/attempts${problemId ? `?problemId=${encodeURIComponent(problemId)}` : ''}`),

  critique: (body: {
    problemId: string;
    graph: GraphDSL;
    question: string;
    selectedNodeIds?: string[];
  }) => req<CritiqueResponse>('/critique', { method: 'POST', body: JSON.stringify(body) }),

  simulate: (body: { graph: GraphDSL; config: SimConfig }) =>
    req<SimResult>('/simulate', { method: 'POST', body: JSON.stringify(body) }),

  mastery: () => req<MasteryEntry[]>('/mastery'),
  stats: () => req<Stats>('/stats'),

  settings: () => req<SettingsView>('/settings'),
  saveSettings: (body: { provider: string; baseUrl?: string; model: string; apiKey?: string }) =>
    req<SettingsView>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  testSettings: () =>
    req<{ ok: boolean; reply?: string; error?: string; hint?: string }>('/settings/test', { method: 'POST' }),

  loadDesign: (problemId: string) =>
    req<{ doc: CanvasDoc | null; updatedAt: string | null }>(`/designs/${encodeURIComponent(problemId)}`),
  saveDesign: (problemId: string, doc: CanvasDoc) =>
    req<{ ok: true }>(`/designs/${encodeURIComponent(problemId)}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    }),

  exportAttempt: (attemptId: number, format: 'review' | 'adr' = 'review') =>
    req<{ ok: true; path: string }>(`/export/${attemptId}?format=${format}`, { method: 'POST' }),
  exportText: (attemptId: number, format: 'review' | 'adr' = 'adr') =>
    req<{ format: string; text: string }>(`/export/${attemptId}/text?format=${format}`),
  problemFromBrief: (body: {
    brief: string;
    scale?: string;
    constraints?: string;
    focus?: string[];
    level?: number;
    mode?: 'own' | 'exercise';
    harder?: boolean;
  }) =>
    req<Problem>('/problems/from-brief', { method: 'POST', body: JSON.stringify(body) }),
};
