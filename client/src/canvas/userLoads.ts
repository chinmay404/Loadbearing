import type { Flow, SimResult } from '@loadbearing/shared';

/**
 * What one of your users would experience, sampled from the run's own numbers.
 *
 * A p99 is a statistic; a spinner that will not stop is an experience. The little
 * device on a client plays page loads drawn from that client's journeys: most at
 * the median, one in ten at the slow tail, and a share failing exactly as often as
 * the run says requests fail. Nothing here is invented — every load is a draw from
 * the numbers the engine reported.
 */

export interface Journey {
  name: string;
  p50Ms: number;
  p99Ms: number;
  /** Share of this journey's requests that complete, 0..1. */
  success: number;
  broken: boolean;
}

export type LoadOutcome = 'ok' | 'slow' | 'error' | 'timeout';

export interface PageLoad {
  journey: string;
  outcome: LoadOutcome;
  /** How long the user waits before seeing the outcome. */
  ms: number;
}

/** Past this a person calls a page slow (the classic one-second attention limit). */
export const SLOW_MS = 1000;
/** Past this they give up: shown as a timeout rather than an eventual page. */
export const GIVE_UP_MS = 8000;
/** A failure is noticed fast or after a hang; this is how long an error takes to show. */
const ERROR_SHOWS_AFTER_MS = 400;

const finite = (n: number, fallback: number) => (Number.isFinite(n) && n >= 0 ? n : fallback);

/** The journeys that start at this client, from the declared flows the run measured. */
export function journeysFor(clientId: string, flows: readonly Flow[], result: SimResult | null): Journey[] {
  if (!result) return [];
  const mine = flows.filter((f) => f.steps[0] === clientId);
  const out: Journey[] = [];
  for (const f of mine) {
    const r = result.flows.find((x) => x.flowId === f.id);
    if (!r || !r.measured) continue;
    out.push({
      name: f.name,
      p50Ms: finite(r.p50Ms, 0),
      p99Ms: finite(r.p99Ms, finite(r.p50Ms, 0)),
      success: r.offeredRps > 0 ? Math.min(1, Math.max(0, r.completedRps / r.offeredRps)) : 1,
      broken: r.broken,
    });
  }
  if (out.length > 0) return out;

  // No journey declared from here: fall back to the run as a whole, which has a tail
  // and a success rate but no median — so every load is drawn at the tail, and the
  // device says so.
  const last = result.timeline?.points.at(-1);
  if (!last) return [];
  return [
    {
      name: 'any page',
      p50Ms: finite(last.p99Ms, 0),
      p99Ms: finite(last.p99Ms, 0),
      success: Math.min(1, Math.max(0, last.successRate)),
      broken: false,
    },
  ];
}

/** One user's page load, drawn from a journey. `rand` is injectable for tests. */
export function sampleLoad(j: Journey, rand: () => number = Math.random): PageLoad {
  if (j.broken || rand() >= j.success) {
    return { journey: j.name, outcome: 'error', ms: Math.min(ERROR_SHOWS_AFTER_MS, Math.max(120, j.p50Ms)) };
  }
  // Nine in ten at the median, give or take; one in ten at the tail.
  const tail = rand() < 0.1;
  const base = tail ? j.p99Ms : j.p50Ms;
  const ms = Math.max(1, base * (0.85 + rand() * 0.3));
  if (ms > GIVE_UP_MS) return { journey: j.name, outcome: 'timeout', ms: GIVE_UP_MS };
  return { journey: j.name, outcome: ms > SLOW_MS ? 'slow' : 'ok', ms };
}

/** "230 ms", "2.4 s" — the way a person reads a wait. */
export function fmtWait(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}
