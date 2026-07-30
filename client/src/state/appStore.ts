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
  setHealth: (h: { serverUp: boolean; llmConfigured: boolean; stubMode: boolean }) => void;
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
  setHealth: ({ serverUp, llmConfigured, stubMode }) => set({ serverUp, llmConfigured, stubMode }),
}));
