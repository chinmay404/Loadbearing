// Where each catalogue number came from.
//
// `components.ts` holds roughly 330 numbers — a capacity, a service time and a
// monthly cost for every component type — and until now not one of them said who
// said so. That is an awkward thing for this app in particular to be doing: the
// README promises that a grader's findings must cite the playbook and that
// invented citation keys are discarded server-side, while the capacity model,
// whose output the grader is instructed to treat as fact, cited nothing at all.
//
// WHY THIS IS AN OVERLAY RATHER THAN A REWRITE
//
// The obvious move is to turn each number into `{ value, source, confidence }`.
// Two reasons not to. The tables are `Record<ArchNodeType, number>`, and that
// exhaustiveness is load-bearing — add a component type and TypeScript refuses to
// build until it has a capacity, a latency and a cost, exactly as `families.ts`
// intends. And the engine reads those tables inside its relaxation loop, where an
// object allocation per lookup is not free.
//
// So the numbers stay exactly where they are, and provenance is a SPARSE overlay
// beside them. An entry exists only where somebody actually sourced something.
// Everything else is honestly reported as an estimate, and `coverage()` will tell
// you how much of the catalogue that still is — which is the point. The gap is
// meant to be visible and embarrassing enough to close.

import { DEFAULT_CAPACITY, DEFAULT_COST, DEFAULT_LATENCY } from './components.js';
import type { ArchNodeType } from './types.js';

/**
 * How much weight a number deserves.
 *
 * `measured`   — somebody ran a benchmark and published the result.
 * `documented` — a provider states it, typically as a quota or a formula.
 * `estimate`   — a considered guess. Most of the catalogue, for now.
 */
export type Confidence = 'measured' | 'documented' | 'estimate';

export type Metric = 'capacity' | 'latency' | 'cost';

export interface Provenance {
  /** Who says so: 'AWS Service Quotas', 'ClickBench', 'benchANT'. */
  source: string;
  /** The conditions under which it holds, if that matters. */
  detail?: string;
  /** When it was true, as 'YYYY-MM'. Prices and benchmarks both go stale. */
  measuredAt?: string;
  confidence: Confidence;
}

export interface CatalogValue extends Provenance {
  value: number;
}

/** What a number is worth when nobody has sourced it. */
export const UNSOURCED: Provenance = {
  source: 'Loadbearing catalogue',
  detail: 'A considered guess, not a measurement. Override it if you know better.',
  confidence: 'estimate',
};

type Key = `${Metric}:${ArchNodeType}`;

/**
 * The sourced numbers. Deliberately short.
 *
 * Everything here is something a provider documents publicly and that I am
 * confident of; nothing is inferred, rounded from memory, or attributed to a
 * benchmark I have not actually read. A thin list of real citations is worth more
 * than a full one of plausible ones — that is the whole argument this file exists
 * to make, and it would be self-defeating to pad it.
 */
export const PROVENANCE: Partial<Record<Key, Provenance>> = {
  'capacity:api_gateway': {
    source: 'AWS Service Quotas',
    detail: 'API Gateway default steady-state request rate, per region, before a quota increase.',
    measuredAt: '2026-08',
    confidence: 'documented',
  },
  'capacity:serverless_fn': {
    source: 'AWS Service Quotas',
    detail:
      'Lambda default of 1,000 concurrent executions per region. The rps this becomes depends entirely on duration, which is why the catalogue number is a different shape from the quota.',
    measuredAt: '2026-08',
    confidence: 'documented',
  },
};

const TABLES: Record<Metric, Record<ArchNodeType, number>> = {
  capacity: DEFAULT_CAPACITY,
  latency: DEFAULT_LATENCY,
  cost: DEFAULT_COST,
};

/** A catalogue number together with whatever is known about where it came from. */
export function lookup(metric: Metric, type: ArchNodeType): CatalogValue {
  return {
    value: TABLES[metric][type],
    ...(PROVENANCE[`${metric}:${type}`] ?? UNSOURCED),
  };
}

export const capacityOf = (type: ArchNodeType): CatalogValue => lookup('capacity', type);
export const latencyOf = (type: ArchNodeType): CatalogValue => lookup('latency', type);
export const costOf = (type: ArchNodeType): CatalogValue => lookup('cost', type);

/**
 * How much of the catalogue rests on something other than judgement.
 *
 * Exposed so the honest answer is a number the UI can show rather than a claim
 * buried in a comment. It is currently very small.
 */
export function coverage(): { sourced: number; total: number; byConfidence: Record<Confidence, number> } {
  const metrics: Metric[] = ['capacity', 'latency', 'cost'];
  const types = Object.keys(DEFAULT_CAPACITY) as ArchNodeType[];
  const byConfidence: Record<Confidence, number> = { measured: 0, documented: 0, estimate: 0 };
  for (const metric of metrics) {
    for (const type of types) {
      byConfidence[(PROVENANCE[`${metric}:${type}`] ?? UNSOURCED).confidence] += 1;
    }
  }
  const total = metrics.length * types.length;
  return { sourced: total - byConfidence.estimate, total, byConfidence };
}
