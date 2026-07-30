import { create } from 'zustand';
import type { Problem, ProblemSummary, ScoreResult, SimResult } from '@loadbearing/shared';

export type View = 'problems' | 'compose' | 'workspace' | 'dashboard' | 'reference' | 'settings';
export type LeftTab = 'brief' | 'palette' | 'flows' | 'inspect' | 'checks';
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

  setView: (view) => set({ view }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setProblems: (problems) => set({ problems }),

  openProblem: (problem) =>
    set({
      problem,
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
    }),
}));
