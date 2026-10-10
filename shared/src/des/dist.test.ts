// The shapes randomness takes. Each is checked against the property that defines
// it, over enough draws that the tolerance is honest rather than lucky.

import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import { callCount, exponential, logNormal, Z_99 } from './dist.js';

const N = 200_000;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const quantile = (xs: number[], q: number) => sorted(xs)[Math.floor(q * (xs.length - 1))]!;

describe('distributions', () => {
  it('exponential draws have the stated mean', () => {
    // Standard error of the mean of N exponentials is mean / sqrt(N) ≈ 0.22% here.
    const rng = createRng(1);
    const xs = Array.from({ length: N }, () => exponential(rng, 4));
    expect(xs.reduce((a, b) => a + b, 0) / N).toBeCloseTo(4, 1);
  });

  it('log-normal draws have the stated median and 99th percentile', () => {
    const rng = createRng(2);
    const sampler = logNormal(10, 25);
    const xs = Array.from({ length: N }, () => sampler(rng));
    expect(quantile(xs, 0.5)).toBeGreaterThan(9.8);
    expect(quantile(xs, 0.5)).toBeLessThan(10.2);
    expect(quantile(xs, 0.99)).toBeGreaterThan(24);
    expect(quantile(xs, 0.99)).toBeLessThan(26);
  });

  it('a log-normal with no spread is the median, every time', () => {
    const sampler = logNormal(10, 10);
    const rng = createRng(3);
    expect(sampler(rng)).toBe(10);
  });

  it('uses the standard normal 99th percentile', () => {
    expect(Z_99).toBeCloseTo(2.3263, 4);
  });

  it('call counts are whole and average to the share', () => {
    // share 2.5 → 2 calls, plus a third half the time.
    const rng = createRng(4);
    const xs = Array.from({ length: N }, () => callCount(rng, 2.5));
    expect(new Set(xs)).toEqual(new Set([2, 3]));
    expect(xs.reduce((a, b) => a + b, 0) / N).toBeCloseTo(2.5, 2);
    expect(callCount(rng, 4)).toBe(4);
    expect(callCount(rng, 0)).toBe(0);
  });
});
