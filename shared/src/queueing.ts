// How long a request waits, given how busy a thing is and how many of it there are.
//
// The engine used to answer this with 1/(1-u) for every component. That is the
// M/M/1 response multiple: correct for ONE server, and badly wrong for anything
// serving several requests at once — which is nearly everything. A service holding
// 64 requests in flight is a 64-channel queue, and telling it that being 80% busy
// costs five times its service time penalises exactly the designs this tool exists
// to reward.
//
// Erlang-C is the multi-server generalisation. At c=1 it reduces to the old
// formula exactly, so anything genuinely serving one request at a time is
// unchanged, and the difference everywhere else is the correction.
//
// Pure arithmetic: no state, no allocation beyond a couple of numbers, no
// dependency on the graph. That is the point of it living here rather than in the
// engine — every value below is checkable against a published Erlang table.

/** Queue wait is clamped here: past this the number stops meaning anything. */
export const MAX_WAIT_MULTIPLE = 20;

/**
 * How much worse the slowest 1% is than the average, with nothing queueing at all.
 *
 * Not 1, and deliberately not derived. The service time is itself a distribution,
 * and garbage collection, thread scheduling and network jitter all land here. No
 * closed form gives this number, so it stays an openly-labelled empirical constant
 * while the queueing half of the tail becomes a real percentile. One honest
 * estimate beats a formula that hides one.
 */
export const TAIL_MULTIPLE_IDLE = 2.5;

/**
 * Iteration ceiling for the Erlang-B recurrence, which is O(servers) and runs
 * inside the engine's relaxation loop.
 *
 * Beyond a few hundred parallel channels, the probability of waiting at any
 * utilisation below saturation is already indistinguishable from zero — at 512
 * channels and 90% busy the response multiple is 1.0004 — so more channels change
 * the answer by less than rounding while costing a linear pass. Capping is a
 * performance decision with no measurable effect on the result.
 */
export const ERLANG_MAX_SERVERS = 512;

const clampServers = (servers: number): number => {
  if (!Number.isFinite(servers) || servers < 1) return 1;
  return Math.min(Math.floor(servers), ERLANG_MAX_SERVERS);
};

/**
 * The probability that an arriving request has to wait at all.
 *
 * Computed through the Erlang-B recurrence rather than the textbook `a^c/c!`
 * expression, which overflows to Infinity well below the channel counts this
 * engine routinely sees:
 *
 *   B(0) = 1
 *   B(k) = a.B(k-1) / (k + a.B(k-1))
 *   C    = B(c) / (1 - u(1 - B(c)))
 *
 * The recurrence is also numerically stable, where the ratio of two enormous
 * factorials is not.
 */
export function erlangC(servers: number, offeredLoad: number): number {
  const c = clampServers(servers);
  const a = Math.max(0, offeredLoad);
  if (a <= 0) return 0;

  let b = 1;
  for (let k = 1; k <= c; k += 1) {
    b = (a * b) / (k + a * b);
  }

  const u = a / c;
  if (u >= 1) return 1;
  const denominator = 1 - u * (1 - b);
  if (denominator <= 0) return 1;
  return Math.min(1, b / denominator);
}

/**
 * Response time as a multiple of service time: 1 + Wq/S.
 *
 * At c=1 this is exactly 1/(1-u) — the formula the engine used before — so the
 * reduction is a property of the maths rather than a special case in the code.
 */
export function responseMultiple(utilization: number, servers: number): number {
  if (!Number.isFinite(utilization) || utilization <= 0) return 1;
  if (utilization >= 1) return MAX_WAIT_MULTIPLE;

  const c = clampServers(servers);
  const multiple = 1 + erlangC(c, c * utilization) / (c * (1 - utilization));
  if (!Number.isFinite(multiple)) return MAX_WAIT_MULTIPLE;
  return Math.min(Math.max(1, multiple), MAX_WAIT_MULTIPLE);
}

/**
 * The 99th percentile of time spent waiting for a free channel, in milliseconds.
 *
 * For M/M/c the waiting time is an exponential tail above an atom at zero:
 *
 *   P(W > t) = C.exp(-c.mu.(1-u).t)
 *
 * so the 99th percentile is ln(C/0.01) / (c.mu.(1-u)), and it is genuinely zero
 * whenever fewer than one request in a hundred waits at all. That zero matters:
 * it is what stops an idle design from being reported with an invented tail.
 */
export function waitP99Ms(utilization: number, servers: number, serviceMs: number): number {
  if (!Number.isFinite(serviceMs) || serviceMs <= 0) return 0;
  if (!Number.isFinite(utilization) || utilization <= 0) return 0;
  if (utilization >= 1) return serviceMs * MAX_WAIT_MULTIPLE;

  const c = clampServers(servers);
  const waiting = erlangC(c, c * utilization);
  if (waiting <= 0.01) return 0;

  const rate = (c * (1 - utilization)) / serviceMs;
  if (rate <= 0) return serviceMs * MAX_WAIT_MULTIPLE;
  return Math.min(Math.log(waiting / 0.01) / rate, serviceMs * MAX_WAIT_MULTIPLE);
}
