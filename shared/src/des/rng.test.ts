// A simulation that cannot be replayed cannot be debugged, compared or trusted:
// the same seed has to give the same run, every time, in every place it runs.

import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';

const draw = (seed: number, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng());
};

describe('seeded random numbers', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(42, 1000)).toEqual(draw(42, 1000));
  });

  it('gives a different sequence for a different seed', () => {
    expect(draw(42, 10)).not.toEqual(draw(43, 10));
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    // 100,000 draws: the mean of U(0,1) is 0.5 with standard error ~0.0009.
    const xs = draw(7, 100_000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeCloseTo(0.5, 2);
  });
});
