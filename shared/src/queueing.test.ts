// Queueing is the one part of this engine with a known-correct answer, so these
// assert against published Erlang values rather than against the engine's own
// opinion of itself. Where a number is exact it is checkable in any queueing
// textbook or online Erlang-C calculator.

import { describe, expect, it } from 'vitest';
import { erlangC, responseMultiple, waitP99Ms, MAX_WAIT_MULTIPLE } from './queueing.js';

describe('erlangC', () => {
  it('is the utilisation itself when there is one server', () => {
    // For c=1 the probability of waiting is exactly the offered load.
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 6);
    expect(erlangC(1, 0.9)).toBeCloseTo(0.9, 6);
  });

  it('matches the published value for two servers at half load', () => {
    // Textbook M/M/2 with a=1: C = 1/3.
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 6);
  });

  it('matches the published value for ten servers at 80% load', () => {
    // Standard Erlang table entry: c=10, a=8 gives C ~= 0.4092.
    expect(erlangC(10, 8)).toBeCloseTo(0.4092, 3);
  });

  it('is negligible when servers hugely outnumber the load', () => {
    expect(erlangC(100, 1)).toBeLessThan(1e-6);
  });

  it('is nothing when no load is offered', () => {
    expect(erlangC(8, 0)).toBe(0);
  });

  it('survives the server counts this engine actually sees', () => {
    // 64 workers on 10 replicas is 640 channels. The textbook a^c/c! expression
    // overflows to Infinity long before here, which is why the recurrence is used.
    const c = erlangC(640, 512);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

describe('responseMultiple', () => {
  it('reduces exactly to the M/M/1 formula at one server', () => {
    // The regression guard. Anything genuinely holding one request at a time must
    // report precisely what it reported before this module existed.
    for (const u of [0.1, 0.5, 0.7, 0.9, 0.95]) {
      expect(responseMultiple(u, 1)).toBeCloseTo(1 / (1 - u), 6);
    }
  });

  it('is far gentler with many channels at the same utilisation', () => {
    // The correction, stated as a number: ten channels at 80% is not five times
    // its service time, it is 1.2 times.
    expect(responseMultiple(0.8, 1)).toBeCloseTo(5, 6);
    expect(responseMultiple(0.8, 10)).toBeCloseTo(1.2046, 3);
  });

  it('sharpens rather than vanishes as utilisation approaches one', () => {
    // More channels move the knee right; they do not remove it. A design at 99%
    // is still in trouble however wide it is.
    expect(responseMultiple(0.99, 10)).toBeGreaterThan(responseMultiple(0.9, 10));
    expect(responseMultiple(0.9, 10)).toBeGreaterThan(responseMultiple(0.8, 10));
  });

  it('never returns less than one', () => {
    expect(responseMultiple(0, 8)).toBeGreaterThanOrEqual(1);
    expect(responseMultiple(-1, 8)).toBeGreaterThanOrEqual(1);
  });

  it('clamps at saturation rather than dividing by zero', () => {
    expect(responseMultiple(1, 4)).toBe(MAX_WAIT_MULTIPLE);
    expect(responseMultiple(1.5, 4)).toBe(MAX_WAIT_MULTIPLE);
  });

  it('treats a nonsensical channel count as a single channel', () => {
    expect(responseMultiple(0.5, 0)).toBeCloseTo(2, 6);
    expect(responseMultiple(0.5, Number.NaN)).toBeCloseTo(2, 6);
    expect(responseMultiple(0.5, -3)).toBeCloseTo(2, 6);
  });
});

describe('waitP99Ms', () => {
  it('is zero when fewer than one in a hundred requests waits', () => {
    expect(waitP99Ms(0.1, 100, 50)).toBe(0);
  });

  it('matches the closed form for ten channels at 80%', () => {
    // C = 0.40918, mu = 1/50 per ms, so c.mu.(1-u) = 0.04.
    // ln(C/0.01)/0.04 = ln(40.918)/0.04 = 92.8ms
    expect(waitP99Ms(0.8, 10, 50)).toBeCloseTo(92.8, 0);
  });

  it('grows as utilisation rises', () => {
    expect(waitP99Ms(0.9, 10, 50)).toBeGreaterThan(waitP99Ms(0.8, 10, 50));
  });

  it('is zero for a free or nonsensical service time', () => {
    expect(waitP99Ms(0.8, 10, 0)).toBe(0);
    expect(waitP99Ms(0.8, 10, -5)).toBe(0);
  });

  it('is clamped at saturation rather than running away', () => {
    expect(waitP99Ms(1, 10, 50)).toBe(50 * MAX_WAIT_MULTIPLE);
  });
});
