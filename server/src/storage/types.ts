// The storage contract. Two implementations stand behind it: SQLite for local,
// zero-setup use, and Postgres (Supabase) for deployment — routes only ever see
// this interface, so neither dialect leaks upward. Everything is async because
// the Postgres side has no choice, and the SQLite side can afford to pretend.

import type { NoteScope } from '@loadbearing/shared';

export interface UserRow {
  id: string;
  username: string;
  passHash: string;
  createdAt: string;
}

export interface AttemptRow {
  id: number;
  problemId: string;
  round: number;
  graphJson: string;
  scoreJson: string;
  overall: number;
  twistText: string | null;
  createdAt: string;
}

export interface MasteryRow {
  concept: string;
  emaScore: number;
  attempts: number;
  lastSeen: string | null;
}

export interface ReviewQueueRow extends MasteryRow {
  /** Days since last_seen, fractional. */
  daysSince: number;
}

export interface StatsAgg {
  attempts: number;
  avgOverall: number | null;
}

/** A real system being designed, as opposed to a practice problem. */
export interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One diagram inside a project. A system is rarely one picture: the request path,
 * the ingest pipeline and the data layer are separate drawings of the same thing.
 */
export interface CanvasRow {
  id: string;
  projectId: string;
  name: string;
  /** What this particular view is for. Goes into the project's export. */
  note: string;
  graphJson: string;
  position: number;
  updatedAt: string;
}

/**
 * A long-lived credential for something that is not a browser.
 *
 * Sessions here are signed cookies with no server-side row, which is right for a
 * browser and wrong for this: a token handed to an agent running on some other
 * machine has to be revocable the moment you regret it, and that needs a row to
 * delete. The secret itself is never stored — only its hash — so this table leaking
 * does not hand anybody an account.
 */
export interface ApiTokenRow {
  /** The public half, which is also the lookup key. Safe to display. */
  id: string;
  /** What it is for, in the owner's words: "Claude Desktop", "the laptop". */
  name: string;
  createdAt: string;
  /** Empty until it is used, which is how you tell a token nothing ever picked up. */
  lastUsedAt: string;
}

/** A written note kept beside a sheet or a whole project. */
export interface NoteRow {
  id: string;
  scope: NoteScope;
  scopeId: string;
  title: string;
  body: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Storage {
  /** Which backend answered — surfaced on /api/health so deploys are checkable. */
  readonly kind: 'sqlite' | 'postgres';
  /** Optional: close pooled connections. Tests use it; the app does not. */
  close?: () => Promise<void>;

  /** Creates tables when missing and prunes expired cache rows. Idempotent. */
  init(): Promise<void>;

  // ---- users ----
  createUser(username: string, passHash: string): Promise<UserRow>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  countUsers(): Promise<number>;
  /**
   * Hands rows written before accounts existed to `userId`, returning how many
   * moved. Only the local SQLite file can have any; Postgres returns 0.
   */
  claimLegacyData(userId: string): Promise<number>;

  // ---- attempts (all scoped to a user) ----
  insertAttempt(
    userId: string,
    a: { problemId: string; round: number; graphJson: string; scoreJson: string; overall: number; twistText: string | null },
  ): Promise<number>;
  listAttempts(userId: string, problemId?: string, limit?: number): Promise<AttemptRow[]>;
  getAttempt(userId: string, id: number): Promise<AttemptRow | null>;
  /** Newest attempt's graph for a problem, for round-to-round diffing. */
  latestAttemptGraph(userId: string, problemId: string): Promise<string | null>;

  // ---- mastery ----
  /** ema = 0.7*old + 0.3*new (first sample: the sample), attempts += 1, last_seen = now. */
  upsertMastery(userId: string, concept: string, score: number): Promise<void>;
  listMastery(userId: string): Promise<MasteryRow[]>;
  reviewQueue(userId: string): Promise<ReviewQueueRow[]>;
  statsAgg(userId: string): Promise<StatsAgg>;
  /** Newest-first (date, overall) pairs, capped. */
  statsTrend(userId: string, limit: number): Promise<{ date: string; overall: number }[]>;
  /** Distinct YYYY-MM-DD days with attempts, newest first. */
  statsDays(userId: string): Promise<string[]>;

  // ---- custom problems ----
  insertCustomProblem(userId: string, id: string, json: string): Promise<void>;
  listCustomProblems(userId: string): Promise<string[]>;
  deleteCustomProblem(userId: string, id: string): Promise<void>;

  // ---- per-user settings (LLM provider config lives here) ----
  getSetting(userId: string, key: string): Promise<string | null>;
  setSetting(userId: string, key: string, value: string): Promise<void>;

  // ---- canvas designs (one per problem sheet) ----
  getDesign(userId: string, problemId: string): Promise<{ graphJson: string; updatedAt: string } | null>;
  putDesign(userId: string, problemId: string, graphJson: string): Promise<void>;
  /**
   * When each sheet was last drawn on, newest first. Drawing counts as working on a
   * problem — most sheets are touched many times before anything is submitted, so
   * attempts alone would call a problem untouched right up until it is finished.
   */
  listDesignActivity(userId: string, limit?: number): Promise<{ problemId: string; updatedAt: string }[]>;

  // ---- notes (as many as you like, per sheet or per project) ----
  // ---- API tokens (for anything that is not a browser) ----
  createApiToken(userId: string, token: { id: string; name: string; hash: string }): Promise<ApiTokenRow>;
  listApiTokens(userId: string): Promise<ApiTokenRow[]>;
  /** By its public id, for authentication. Includes the hash; nothing else should. */
  findApiToken(id: string): Promise<{ id: string; userId: string; hash: string; lastUsedAt: string } | null>;
  /** Records that it was used just now. Callers throttle; this always writes. */
  touchApiToken(id: string): Promise<void>;
  /** Returns whether anything was revoked, so a wrong id is a 404 rather than a lie. */
  deleteApiToken(userId: string, id: string): Promise<boolean>;

  listNotes(userId: string, scope: NoteScope, scopeId: string): Promise<NoteRow[]>;
  /**
   * Every note this person has written, newest first, regardless of what it is
   * attached to. Notes are written where the thinking happened, which is the right
   * place to write them and the wrong place to find them again six sheets later.
   */
  listAllNotes(userId: string): Promise<NoteRow[]>;
  createNote(
    userId: string,
    note: { scope: NoteScope; scopeId: string; title: string; body: string },
  ): Promise<NoteRow>;
  /** Only the fields present are written. Returns null when the note is not theirs. */
  updateNote(
    userId: string,
    id: string,
    patch: { title?: string; body?: string; position?: number },
  ): Promise<NoteRow | null>;
  deleteNote(userId: string, id: string): Promise<void>;

  // ---- coaching conversation (one thread per problem sheet) ----
  /** The stored turns as JSON, or null when nothing has been asked yet. */
  getChat(userId: string, problemId: string): Promise<string | null>;
  putChat(userId: string, problemId: string, turnsJson: string): Promise<void>;
  deleteChat(userId: string, problemId: string): Promise<void>;

  // ---- projects and their canvases ----
  createProject(userId: string, name: string, summary: string): Promise<ProjectRow>;
  listProjects(userId: string): Promise<(ProjectRow & { canvasCount: number })[]>;
  getProject(userId: string, id: string): Promise<ProjectRow | null>;
  updateProject(userId: string, id: string, patch: { name?: string; summary?: string }): Promise<void>;
  deleteProject(userId: string, id: string): Promise<void>;

  createCanvas(userId: string, projectId: string, name: string, note: string): Promise<CanvasRow>;
  listCanvases(userId: string, projectId: string): Promise<CanvasRow[]>;
  getCanvas(userId: string, id: string): Promise<CanvasRow | null>;
  updateCanvas(
    userId: string,
    id: string,
    patch: { name?: string; note?: string; graphJson?: string; position?: number },
  ): Promise<void>;
  deleteCanvas(userId: string, id: string): Promise<void>;

  // ---- reference designs (shared across users — the reference is per problem) ----
  getReference(problemId: string): Promise<string | null>;
  putReference(problemId: string, graphJson: string): Promise<void>;

  // ---- LLM response cache (shared; keyed by prompt hash which includes the key's model) ----
  cacheGet(key: string): Promise<string | null>;
  cachePut(key: string, response: string): Promise<void>;
  cacheDelete(key: string): Promise<void>;
}
