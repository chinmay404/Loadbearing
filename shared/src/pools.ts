// Anything with a fixed number of slots, and what happens when more work wants one
// than there are.
//
// Two things in this engine have that shape, and until now one was modelled inline
// and the other not at all. A boundary declared a shared host, where six pipeline
// stages compete for one worker group's machines. And a connection pool in front of
// a database, where fifty service replicas holding twenty connections each meet a
// Postgres instance that accepts a hundred — which is among the most common real
// outages there is, and was entirely invisible.
//
// The quantity that composes is concurrency, not requests per second. Components
// sharing a pool have different holding times, and a parser held for 2.5 seconds
// costs the pool far more per request than a chunker held for 20ms. Only slots add
// up.

export interface PoolDemand {
  arrivingRps: number;
  /** How long each request holds its slot — own work plus what it waits on. */
  occupancyMs: number;
}

/** Little's law: concurrent slots required to sustain this arrival rate. */
export function slotsNeeded(demand: PoolDemand): number {
  const rps = Math.max(0, demand.arrivingRps);
  const ms = Math.max(0, demand.occupancyMs);
  if (rps <= 0 || ms <= 0) return 0;
  return rps * (ms / 1000);
}

/**
 * What gets a slot, and what is turned away.
 *
 * Proportional rather than first-come. At steady state a pool that can serve half
 * the demand serves half of it, and which particular requests lose is not something
 * a deterministic model has any business pretending to know.
 */
export function admit(
  demandRps: number,
  needed: number,
  available: number,
): { admittedRps: number; rejectedRps: number } {
  const rps = Math.max(0, demandRps);
  if (!Number.isFinite(available)) return { admittedRps: rps, rejectedRps: 0 };
  if (needed <= 0) return { admittedRps: rps, rejectedRps: 0 };
  if (available <= 0) return { admittedRps: 0, rejectedRps: rps };
  if (needed <= available) return { admittedRps: rps, rejectedRps: 0 };
  const admitted = rps * (available / needed);
  return { admittedRps: admitted, rejectedRps: rps - admitted };
}

/**
 * Divide a fixed supply between competing members. Everyone is squeezed by the
 * same factor: a pool does not choose favourites.
 */
export function shareOut(demands: readonly number[], supply: number): number[] {
  const wanted = demands.map((d) => Math.max(0, d));
  const total = wanted.reduce((sum, d) => sum + d, 0);
  if (total <= 0) return wanted.map(() => 0);
  if (!Number.isFinite(supply)) return wanted;
  if (supply <= 0) return wanted.map(() => 0);
  if (total <= supply) return wanted;
  const factor = supply / total;
  return wanted.map((d) => d * factor);
}
