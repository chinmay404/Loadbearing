import type {
  Attempt,
  BlueprintLike,
  ChatTurn,
  CritiqueResponse,
  CustomObject,
  GraphDSL,
  MasteryEntry,
  Note,
  NoteScope,
  Problem,
  ProblemSummary,
  ScoreReference,
  ScoreResult,
  SettingsView,
  SimConfig,
  SimResult,
  Stats,
  ConceptCard,
  CanvasDoc,
  UserTemplate,
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

/**
 * Called whenever the server says the session is gone. The app registers a
 * handler that drops back to the sign-in screen, so an expired cookie surfaces
 * as "sign in again" instead of as a scattering of failed panels.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // The session is an HttpOnly cookie, and the dev server is a different
      // origin from the API, so it has to be sent explicitly.
      credentials: 'include',
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

  // Not everything that answers is this server. A platform 404, a gateway 500 or
  // a cold-start timeout replies with HTML, and parsing that as JSON used to
  // surface as "Unexpected token 'A'" — which hides the one fact that matters,
  // namely that the request never reached the application.
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(
        res.ok
          ? 'The server replied with something that is not JSON.'
          : `The server returned HTTP ${res.status} without reaching the application.`,
        'not_json',
        res.status >= 500
          ? 'That is an infrastructure error, not a login error — check the deployment logs for the failing function.'
          : 'Check that /api requests are routed to the API function.',
        text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      );
    }
  }

  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; hint?: string; raw?: string } })?.error;
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, e?.code ?? 'http_error', e?.hint, e?.raw);
  }
  return body as T;
}

export interface ProjectSummary {
  id: string;
  name: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  canvasCount: number;
}

/** One diagram's metadata. The drawing itself is fetched per canvas. */
export interface CanvasMeta {
  id: string;
  projectId: string;
  name: string;
  note: string;
  position: number;
  updatedAt: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  canvases: CanvasMeta[];
}

export interface PlaybookEntryView {
  id: string;
  title: string;
  source: string;
  sourceKind: string;
  rule: string;
  numbers: string;
  failure: string;
  concepts: string[];
  score?: number;
  because?: string[];
}

export const api = {
  health: () =>
    req<{
      ok: boolean;
      storage: 'sqlite' | 'postgres' | null;
      /** Present when the database could not be reached — the deploy's first question. */
      storageError?: string;
      /** Present when DATABASE_URL itself looks wrong for this host. */
      storageAdvice?: string;
      databaseUrlSet: boolean;
      sessionSecretSet: boolean;
      signedIn: boolean;
      username?: string;
      llmConfigured: boolean;
      houseKey: boolean;
      fake: boolean;
    }>('/health'),

  register: (body: { username: string; password: string }) =>
    req<{ username: string; inherited: number }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    req<{ username: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => req<{ username: string }>('/auth/me'),

  projects: () => req<ProjectSummary[]>('/projects'),
  project: (id: string) => req<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  createProject: (body: { name: string; summary: string }) =>
    req<ProjectSummary & { firstCanvasId: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: { name?: string; summary?: string }) =>
    req<ProjectSummary>(`/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) =>
    req<{ ok: true }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createCanvas: (projectId: string, body: { name: string; note?: string }) =>
    req<CanvasMeta>(`/projects/${encodeURIComponent(projectId)}/canvases`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  canvas: (id: string) => req<CanvasMeta & { doc: CanvasDoc | null }>(`/canvases/${encodeURIComponent(id)}`),
  saveCanvas: (id: string, body: { name?: string; note?: string; doc?: CanvasDoc }) =>
    req<{ ok: true }>(`/canvases/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteCanvas: (id: string) =>
    req<{ ok: true }>(`/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Every view of the project as one build specification. */
  projectBrief: (id: string) =>
    req<{ markdown: string; filename: string }>(`/projects/${encodeURIComponent(id)}/brief`, {
      method: 'POST',
    }),

  customObjects: () => req<CustomObject[]>('/custom-objects'),
  saveCustomObject: (body: Omit<CustomObject, 'id' | 'createdAt'>) =>
    req<CustomObject>('/custom-objects', { method: 'POST', body: JSON.stringify(body) }),
  deleteCustomObject: (id: string) =>
    req<{ ok: true }>(`/custom-objects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  templates: () => req<UserTemplate[]>('/templates'),
  saveTemplate: (body: { name: string; summary: string } & Omit<BlueprintLike, 'name'>) =>
    req<UserTemplate>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) =>
    req<{ ok: true }>(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** The current canvas as a build specification for a coding agent. */
  implementationBrief: (body: { graph: GraphDSL; problemId?: string }) =>
    req<{ markdown: string; filename: string }>('/export/brief', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  playbook: () => req<PlaybookEntryView[]>('/playbook'),
  relevantPlaybook: (body: { problemId?: string; graph?: GraphDSL; text?: string; limit?: number }) =>
    req<PlaybookEntryView[]>('/playbook/relevant', { method: 'POST', body: JSON.stringify(body) }),

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
  }) =>
    req<CritiqueResponse & { references?: ScoreReference[]; turns?: ChatTurn[] }>('/critique', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Notes beside the drawing. `sheet` is one drawing (a problem sheet or one view
   * of a project); `project` is the system as a whole.
   */
  notes: (scope: NoteScope, scopeId: string) =>
    req<{ notes: Note[] }>(`/notes?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`),
  createNote: (body: { scope: NoteScope; scopeId: string; title: string; body: string }) =>
    req<Note>('/notes', { method: 'POST', body: JSON.stringify(body) }),
  updateNote: (id: string, patch: { title?: string; body?: string; position?: number }) =>
    req<Note>(`/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteNote: (id: string) => req<{ ok: true }>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** The stored coaching thread for a sheet, and a way to start over. */
  loadChat: (problemId: string) => req<{ turns: ChatTurn[] }>(`/chat/${encodeURIComponent(problemId)}`),
  clearChat: (problemId: string) =>
    req<{ ok: true }>(`/chat/${encodeURIComponent(problemId)}`, { method: 'DELETE' }),

  simulate: (body: { graph: GraphDSL; config: SimConfig }) =>
    req<SimResult>('/simulate', { method: 'POST', body: JSON.stringify(body) }),

  mastery: () => req<MasteryEntry[]>('/mastery'),
  stats: () => req<Stats>('/stats'),
  reviewQueue: () =>
    req<{
      due: { concept: string; name: string; group: string; ema: number; overdueDays: number; intervalDays: number }[];
      drillConcepts: string[];
    }>('/review-queue'),
  socratic: (body: { problemId: string; graph: GraphDSL; question: string; answer: string }) =>
    req<{
      verdict: 'strong' | 'partial' | 'miss';
      feedback: string;
      concept_scores: Record<string, number>;
      references?: ScoreReference[];
    }>('/socratic', { method: 'POST', body: JSON.stringify(body) }),

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
