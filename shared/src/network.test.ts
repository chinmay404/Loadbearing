// Distance used to be free. These are the numbers that make it cost something,
// and the rules for which number applies when the drawing is ambiguous.

import { describe, expect, it } from 'vitest';
import { rttMs, inferPlacement, DEFAULT_PLACEMENT, PLACEMENT_RTT_MS } from './network.js';

describe('rttMs', () => {
  it('defaults to same-az when nothing is stated', () => {
    expect(rttMs(undefined)).toBe(rttMs(DEFAULT_PLACEMENT));
  });

  it('gets more expensive the further apart things are', () => {
    expect(rttMs('same-host')).toBeLessThan(rttMs('same-az'));
    expect(rttMs('same-az')).toBeLessThan(rttMs('cross-az'));
    expect(rttMs('cross-az')).toBeLessThan(rttMs('internet'));
    expect(rttMs('internet')).toBeLessThan(rttMs('cross-region'));
  });

  it('uses the measured pair when both regions are known', () => {
    const measured = rttMs('cross-region', 'us-east-1', 'eu-west-1');
    expect(measured).toBe(75);
  });

  it('is symmetric, because distance is', () => {
    expect(rttMs('cross-region', 'us-east-1', 'eu-west-1')).toBe(
      rttMs('cross-region', 'eu-west-1', 'us-east-1'),
    );
  });

  it('falls back to the generic figure for a pair nobody measured', () => {
    expect(rttMs('cross-region', 'moon-north-1', 'us-east-1')).toBe(
      PLACEMENT_RTT_MS['cross-region'],
    );
  });

  it('charges nothing extra for two boxes in one region, whatever the edge claims', () => {
    // A stated region pair beats a stated placement: they are not far apart.
    expect(rttMs('cross-region', 'us-east-1', 'us-east-1')).toBe(PLACEMENT_RTT_MS['same-az']);
  });

  it('ignores a half-stated region pair and trusts the placement', () => {
    expect(rttMs('cross-az', 'us-east-1', undefined)).toBe(PLACEMENT_RTT_MS['cross-az']);
    expect(rttMs('cross-az', undefined, 'us-east-1')).toBe(PLACEMENT_RTT_MS['cross-az']);
  });
});

describe('inferPlacement', () => {
  it('is the default when neither end names a region', () => {
    expect(inferPlacement(undefined, undefined)).toBe(DEFAULT_PLACEMENT);
  });

  it('is same-az within one region', () => {
    expect(inferPlacement('us-east-1', 'us-east-1')).toBe('same-az');
  });

  it('is cross-region across two', () => {
    expect(inferPlacement('us-east-1', 'eu-west-1')).toBe('cross-region');
  });
});
