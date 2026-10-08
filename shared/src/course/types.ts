import type { BlueprintLike } from '../blueprints.js';
import type { ArchNodeType, NodeAttrs } from '../types.js';

/**
 * The course: short steps on one growing product, each judged by the simulator.
 *
 * Text is kept to a title, one sentence of story and short goal labels — the
 * learner should be watching the parts, not reading about them.
 */

export type StepType = 'fill-gap' | 'fix-wiring' | 'find-bottleneck' | 'kill-switch' | 'tune-dial' | 'checkpoint';

/** A part named in a goal: one the author placed (by key), or any part of a type. */
export type PartRef = { key: string } | { type: ArchNodeType };

/** One run of traffic through the learner's design, and what it must survive. */
export interface Gate {
  id: string;
  /** Short and plain: "10 req/s · at most 1% lost". */
  label: string;
  /** Requests per second from every client. */
  rps: number;
  /** Seconds of traffic. 30 unless a kill needs longer. */
  horizonS?: number;
  /** A part switched off part-way through the run. */
  kill?: { key: string; atS: number; forS?: number };
  /** Which seconds count: all of them, only from the kill on, or the last ten. */
  window?: 'all' | 'after-kill' | 'end';
  maxLostPct?: number;
  maxP99Ms?: number;
  /** A part that must stay under this share of its capacity at the worst moment. */
  maxBusy?: { part: PartRef; pct: number };
  /** A part that must actually receive traffic — "orders reach the database". */
  reaches?: { part: PartRef; label: string };
}

/** One slider the step hands the learner. */
export interface Dial {
  key: string;
  attr: keyof NodeAttrs;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** The ghost: where one valid answer goes. Not the only one — the gates decide. */
export interface Ghost {
  type: ArchNodeType;
  label: string;
  between: [string, string];
}

export interface Step {
  id: string;
  chapter: string;
  type: StepType;
  /** At most six words. */
  title: string;
  /** One sentence. What happened, not what to do. */
  story: string;
  /** One short line: what to do. */
  task: string;
  start: BlueprintLike;
  /** Parts the learner may add. Empty means none. */
  parts: ArchNodeType[];
  dials?: Dial[];
  /** Monthly cost cap, dollars. */
  budget: number;
  gates: Gate[];
  /** Rule-engine findings that must not be firing. */
  clears?: string[];
  /** A part type that has to be in the design: "traffic goes through a load balancer". */
  uses?: { type: ArchNodeType; label: string }[];
  /** find-bottleneck: the learner picks a part before the run. */
  predict?: boolean;
  /** kill-switch with nothing to fix yet: running it is the lesson. */
  observe?: boolean;
  /** Question, then a concept card, then a ghost part. */
  hints: { question: string; concept: string; ghost?: Ghost };
  /** One sentence, shown after the pass. */
  lesson: string;
  /** How one valid answer gets there — used by the tests, never shown. */
  solution: Patch;
}

/** Changes to a step's starting design, by authored key. */
export interface Patch {
  add?: { key: string; type: ArchNodeType; label: string; attrs?: NodeAttrs }[];
  connect?: [string, string][];
  disconnect?: [string, string][];
  set?: { key: string; attrs: NodeAttrs }[];
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  /** One line under the title. */
  promise: string;
  /** Parts this chapter introduces. */
  unlocks: ArchNodeType[];
  steps: Step[];
}

// ------------------------------------------------------------------ verdicts --

export interface GateResult {
  id: string;
  label: string;
  pass: boolean;
  /** What happened, short: "34% lost", "p99 612 ms", "Postgres 82% busy". */
  detail: string;
}

export interface StepVerdict {
  passed: boolean;
  gates: GateResult[];
  findings: { rule: string; message: string; open: boolean }[];
  uses: { label: string; pass: boolean }[];
  budget: { cost: number; cap: number; pass: boolean };
  /** The part that lost traffic first in the heaviest gate, if any did. */
  firstFailure: string | null;
}
