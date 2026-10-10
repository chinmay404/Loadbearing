// The shapes randomness takes in a running system.
//
// Gaps between independent arrivals are exponential — that is what "Poisson
// traffic" means. Service times are log-normal: never negative, bunched around a
// median, with a long right tail, which is how measured request times look. The
// flow engine has one openly-labelled tail constant; here the tail is a property
// of the samples instead of a multiplier on the answer.

import type { Rng } from './rng.js';

/** The 99th percentile of the standard normal. */
export const Z_99 = 2.3263478740408408;

/** A draw with the given mean; the gap between Poisson arrivals. */
export function exponential(rng: Rng, mean: number): number {
  // 1 - u is in (0, 1], so the log is finite.
  return -Math.log(1 - rng()) * mean;
}

/** A standard normal draw (Box–Muller; the second value is discarded for simplicity). */
function standardNormal(rng: Rng): number {
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * A log-normal sampler from a median and a 99th percentile.
 *
 * Stated as two percentiles rather than as mu and sigma because those are what a
 * person can measure: "half the requests take 10ms, one in a hundred takes 25ms".
 */
export function logNormal(median: number, p99: number): (rng: Rng) => number {
  const sigma = p99 > median && median > 0 ? Math.log(p99 / median) / Z_99 : 0;
  if (sigma === 0) return () => median;
  return (rng) => median * Math.exp(sigma * standardNormal(rng));
}

/**
 * How many calls one request makes along a connection with this share.
 *
 * The whole part always; the fraction as a coin toss. A share of 2.5 is two calls
 * and a third half the time, so the average is the share and every count is whole.
 */
export function callCount(rng: Rng, share: number): number {
  if (!(share > 0)) return 0;
  const whole = Math.floor(share);
  const fraction = share - whole;
  return fraction > 0 && rng() < fraction ? whole + 1 : whole;
}
