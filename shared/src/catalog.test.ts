// The point of the catalogue is that it does not lie about what it knows, so most
// of these check the honesty rather than the numbers: an unsourced type says it is
// unsourced, a provenance entry cannot name a component that does not exist, and
// the coverage figure is not quietly flattering.

import { describe, expect, it } from 'vitest';
import {
  capacityOf,
  costOf,
  coverage,
  latencyOf,
  lookup,
  PROVENANCE,
  UNSOURCED,
  type Metric,
} from './catalog.js';
import { DEFAULT_CAPACITY, DEFAULT_COST, DEFAULT_LATENCY } from './components.js';
import { ARCH_NODE_TYPES } from './types.js';

describe('lookup', () => {
  it('returns the same number the tables hold', () => {
    // The overlay must not become a second, disagreeing source of truth.
    for (const type of ARCH_NODE_TYPES) {
      expect(capacityOf(type).value).toBe(DEFAULT_CAPACITY[type]);
      expect(latencyOf(type).value).toBe(DEFAULT_LATENCY[type]);
      expect(costOf(type).value).toBe(DEFAULT_COST[type]);
    }
  });

  it('says plainly when nothing sourced a number', () => {
    const v = latencyOf('custom');
    expect(v.confidence).toBe('estimate');
    expect(v.source).toBe(UNSOURCED.source);
  });

  it('carries the citation where there is one', () => {
    const v = capacityOf('api_gateway');
    expect(v.confidence).toBe('documented');
    expect(v.source).toBe('AWS Service Quotas');
    expect(v.measuredAt).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('the provenance overlay is honest', () => {
  it('never cites a component type that does not exist', () => {
    // The exact failure this app discards from the grader. It would be absurd to
    // permit it here.
    const known = new Set<string>(ARCH_NODE_TYPES);
    const metrics = new Set<string>(['capacity', 'latency', 'cost']);
    for (const key of Object.keys(PROVENANCE)) {
      const [metric, ...rest] = key.split(':');
      expect(metrics.has(metric!), `${key} has an unknown metric`).toBe(true);
      expect(known.has(rest.join(':')), `${key} names an unknown component`).toBe(true);
    }
  });

  it('gives every citation a source and a date', () => {
    for (const [key, p] of Object.entries(PROVENANCE)) {
      expect(p!.source.trim().length, `${key} has no source`).toBeGreaterThan(2);
      expect(p!.confidence, `${key} is not really sourced`).not.toBe('estimate');
      expect(p!.measuredAt, `${key} has no date`).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('does not claim to have measured what was only documented', () => {
    // 'measured' means somebody ran a benchmark and published the result. Nothing
    // currently qualifies, and quietly promoting a quota to a measurement is the
    // easiest way for this file to start lying.
    for (const p of Object.values(PROVENANCE)) {
      if (p!.confidence !== 'measured') continue;
      expect(p!.detail, 'a measured claim must say under what conditions').toBeDefined();
    }
  });
});

describe('coverage', () => {
  it('counts every metric of every component type', () => {
    expect(coverage().total).toBe(3 * ARCH_NODE_TYPES.length);
  });

  it('adds up', () => {
    const c = coverage();
    const sum = c.byConfidence.measured + c.byConfidence.documented + c.byConfidence.estimate;
    expect(sum).toBe(c.total);
    expect(c.sourced).toBe(c.total - c.byConfidence.estimate);
  });

  it('reports the unflattering truth, which is that almost nothing is sourced', () => {
    // This assertion is meant to be deleted one day. Until then it stops the
    // number drifting upward without anyone noticing why.
    const c = coverage();
    expect(c.sourced).toBe(Object.keys(PROVENANCE).length);
    expect(c.sourced / c.total).toBeLessThan(0.05);
  });
});

describe('every metric is reachable', () => {
  it('handles all three', () => {
    for (const metric of ['capacity', 'latency', 'cost'] as Metric[]) {
      expect(Number.isFinite(lookup(metric, 'service').value)).toBe(true);
    }
  });
});
