import { create } from 'zustand';
import type { ChatTurn, Problem, ProblemSummary, ScoreResult, SimResult } from '@loadbearing/shared';

export type View =
  | 'problems'
  | 'compose'
  | 'workspace'
  | 'projects'
  | 'project'
  | 'dashboard'
  | 'reference'
  | 'settings';
export type LeftTab = 'brief' | 'palette' | 'flows' | 'inspect' | 'checks' | 'notes';
export type RightTab = 'feedback' | 'ask' | 'history';

interface AppState {
  view: View;
  leftTab: LeftTab;
  rightTab: RightTab;
  problems: ProblemSummary[];
  problem: Problem | null;
  round: number;
  activeTwist: string | null;
  score: ScoreResult | null;
  lastSim: SimResult | null;
  attemptId: number | null;
  previousOverall: number | null;
  submitting: boolean;
  error: { message: string; hint?: string } | null;
  notice: string | null;
  serverUp: boolean;
  llmConfigured: boolean;
  /** True when the server is forcing the offline stub, so reviews are not real. */
  stubMode: boolean;
  /** null = signed out. Everything a person owns is keyed to this account. */
  username: string | null;
  /** Undecided until /health answers, so the app does not flash the sign-in panel. */
  authChecked: boolean;
  /** Which database is behind this instance — worth seeing on a fresh deploy. */
  storageKind: 'sqlite' | 'postgres' | null;
  /** True when the instance carries an API key that users without one can borrow. */
  houseKey: boolean;
  /** Set while a project is open. Null everywhere else. */
  projectId: string | null;
  /** Set while one of that project's canvases is open on the drawing board. */
  canvasId: string | null;
  /**
   * Bumped whenever the user's own component types change. The palette watches it
   * rather than polling, so saving an object makes it appear immediately.
   */
  customObjectsVersion: number;
  /**
   * The coaching conversation for the sheet on screen. It lives here rather than
   * in the Ask panel because the panel unmounts every time the rail changes tab,
   * and a conversation that dies when you glance at the feedback is not a
   * conversation. `chatFor` is the sheet it belongs to, so a different sheet
   * fetches its own instead of inheriting this one.
   */
  chat: ChatTurn[];
  chatFor: string | null;

  setView: (v: View) => void;
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  setProblems: (p: ProblemSummary[]) => void;
  openProblem: (p: Problem) => void;
  setScore: (s: { attemptId: number; score: ScoreResult; sim: SimResult | null }) => void;
  startTwist: (twist: string) => void;
  setSubmitting: (v: boolean) => void;
  setError: (e: { message: string; hint?: string } | null) => void;
  setNotice: (n: string | null) => void;
  /** The project being worked on, and which of its canvases is open. */
  openProject: (id: string) => void;
  openCanvas: (projectId: string, canvasId: string) => void;
  closeProject: () => void;
  /** Tells the palette its list of custom objects is stale. */
  bumpCustomObjects: () => void;
  /** Replaces the thread — used when one is loaded for a sheet, or cleared. */
  setChat: (problemId: string, turns: ChatTurn[]) => void;
  /** Shows a turn immediately; the server is the one that keeps it. */
  appendChat: (turn: ChatTurn) => void;
  setHealth: (h: {
    serverUp: boolean;
    llmConfigured: boolean;
    stubMode: boolean;
    username?: string | null;
    storageKind?: 'sqlite' | 'postgres' | null;
    houseKey?: boolean;
  }) => void;
  signedIn: (username: string) => void;
  signedOut: () => void;
}

export const useApp = create<AppState>((set) => ({
  view: 'problems',
  leftTab: 'brief',
  rightTab: 'feedback',
  problems: [],
  problem: null,
  round: 1,
  activeTwist: null,
  score: null,
  lastSim: null,
  attemptId: null,
  previousOverall: null,
  submitting: false,
  error: null,
  notice: null,
  serverUp: false,
  llmConfigured: false,
  stubMode: false,
  username: null,
  authChecked: false,
  storageKind: null,
  houseKey: false,
  projectId: null,
  canvasId: null,
  customObjectsVersion: 0,
  chat: [],
  chatFor: null,

  setView: (view) => set({ view }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setProblems: (problems) => set({ problems }),

  openProblem: (problem) =>
    set({
      problem,
      projectId: null,
      canvasId: null,
      view: 'workspace',
      leftTab: 'brief',
      rightTab: 'feedback',
      round: 1,
      activeTwist: null,
      score: null,
      lastSim: null,
      attemptId: null,
      previousOverall: null,
      error: null,
    }),

  setScore: ({ attemptId, score, sim }) =>
    set({ attemptId, score, lastSim: sim, rightTab: 'feedback', submitting: false, error: null }),

  startTwist: (twist) =>
    set((s) => ({
      activeTwist: twist,
      round: s.round + 1,
      previousOverall: s.score?.overall ?? null,
      score: null,
      leftTab: 'brief',
    })),

  setSubmitting: (submitting) => set({ submitting }),
  setError: (error) => set({ error, submitting: false }),
  setNotice: (notice) => set({ notice }),

  // A project and a problem sheet are mutually exclusive: opening one closes the
  // other, so the workspace never has to guess which thing it is showing.
  openProject: (projectId) =>
    set({ view: 'project', projectId, canvasId: null, problem: null, score: null, error: null }),

  openCanvas: (projectId, canvasId) =>
    set({
      view: 'workspace',
      projectId,
      canvasId,
      problem: null,
      score: null,
      lastSim: null,
      attemptId: null,
      leftTab: 'palette',
      error: null,
    }),

  closeProject: () => set({ view: 'projects', projectId: null, canvasId: null }),

  bumpCustomObjects: () => set((s) => ({ customObjectsVersion: s.customObjectsVersion + 1 })),

  setChat: (chatFor, chat) => set({ chatFor, chat }),
  appendChat: (turn) => set((s) => ({ chat: [...s.chat, turn] })),

  setHealth: ({ serverUp, llmConfigured, stubMode, username, storageKind, houseKey }) =>
    set({
      serverUp,
      llmConfigured,
      stubMode,
      authChecked: true,
      ...(username !== undefined ? { username } : {}),
      ...(storageKind !== undefined ? { storageKind } : {}),
      ...(houseKey !== undefined ? { houseKey } : {}),
    }),

  signedIn: (username) => set({ username, authChecked: true, view: 'problems', error: null }),

  // Signing out clears the work in progress too: the next person at this browser
  // must not inherit the last one's problem, score or drawing.
  signedOut: () =>
    set({
      username: null,
      authChecked: true,
      view: 'problems',
      problem: null,
      problems: [],
      score: null,
      lastSim: null,
      attemptId: null,
      round: 1,
      activeTwist: null,
      previousOverall: null,
      error: null,
      chat: [],
      chatFor: null,
    }),
}));
