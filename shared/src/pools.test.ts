// A pool is the same arithmetic wherever it appears: demand measured in
// concurrency-seconds against a supply measured in slots. A shared worker pool and
// a database connection pool differ only in what the slots are called.

import { describe, expect, it } from 'vitest';
import { slotsNeeded, admit, shareOut } from './pools.js';

describe('slotsNeeded', () => {
  it('is Little’s law: arrivals times how long each is held', () => {
    // 100 rps each held 200ms needs 20 concurrent slots.
    expect(slotsNeeded({ arrivingRps: 100, occupancyMs: 200 })).toBeCloseTo(20, 6);
  });

  it('is zero when nothing arrives', () => {
    expect(slotsNeeded({ arrivingRps: 0, occupancyMs: 200 })).toBe(0);
  });

  it('is zero for instantaneous work', () => {
    expect(slotsNeeded({ arrivingRps: 100, occupancyMs: 0 })).toBe(0);
  });

  it('refuses to be negative on nonsense input', () => {
    expect(slotsNeeded({ arrivingRps: -5, occupancyMs: 200 })).toBe(0);
    expect(slotsNeeded({ arrivingRps: 100, occupancyMs: -5 })).toBe(0);
  });
});

describe('admit', () => {
  it('lets everything through when the pool is big enough', () => {
    expect(admit(100, 20, 50)).toEqual({ admittedRps: 100, rejectedRps: 0 });
  });

  it('admits proportionally when the pool is too small', () => {
    // Needs 40 slots, has 20: half the traffic gets a connection.
    expect(admit(100, 40, 20)).toEqual({ admittedRps: 50, rejectedRps: 50 });
  });

  it('rejects everything when there is no pool at all', () => {
    expect(admit(100, 40, 0)).toEqual({ admittedRps: 0, rejectedRps: 100 });
  });

  it('treats an unbounded pool as no constraint', () => {
    expect(admit(100, 40, Number.POSITIVE_INFINITY)).toEqual({
      admittedRps: 100,
      rejectedRps: 0,
    });
  });

  it('is unbothered by demand for no slots', () => {
    expect(admit(100, 0, 10)).toEqual({ admittedRps: 100, rejectedRps: 0 });
  });
});

describe('shareOut', () => {
  it('leaves everyone alone when supply covers demand', () => {
    expect(shareOut([10, 20], 50)).toEqual([10, 20]);
  });

  it('squeezes everyone by the same factor, playing no favourites', () => {
    // 30 wanted, 15 available: everyone gets half.
    expect(shareOut([10, 20], 15)).toEqual([5, 10]);
  });

  it('gives nothing to anyone when there is nothing', () => {
    expect(shareOut([10, 20], 0)).toEqual([0, 0]);
  });

  it('handles an empty membership', () => {
    expect(shareOut([], 10)).toEqual([]);
  });

  it('never hands out more than was asked for', () => {
    const granted = shareOut([10, 20], Number.POSITIVE_INFINITY);
    expect(granted).toEqual([10, 20]);
  });
});
