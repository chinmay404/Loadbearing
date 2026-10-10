// Percentiles from buckets, not from sorted arrays: a run sees millions of
// requests, and keeping each one to sort later would cost memory the browser does
// not have. The price is a bucket width of resolution, stated and tested here.

import { describe, expect, it } from 'vitest';
import { LatencyHistogram } from './stats.js';

describe('latency histogram', () => {
  it('reads percentiles to within one bucket (2%)', () => {
    const h = new LatencyHistogram();
    for (let ms = 1; ms <= 1000; ms += 1) h.add(ms);
    expect(h.count).toBe(1000);
    expect(h.percentile(0.5) / 500).toBeGreaterThan(0.98);
    expect(h.percentile(0.5) / 500).toBeLessThan(1.02);
    expect(h.percentile(0.99) / 990).toBeGreaterThan(0.98);
    expect(h.percentile(0.99) / 990).toBeLessThan(1.02);
  });

  it('keeps the exact mean', () => {
    const h = new LatencyHistogram();
    [1, 2, 3, 10].forEach((v) => h.add(v));
    expect(h.mean).toBe(4);
  });

  it('reads zero when nothing was recorded, rather than inventing a latency', () => {
    const h = new LatencyHistogram();
    expect(h.percentile(0.99)).toBe(0);
    expect(h.mean).toBe(0);
  });

  it('holds sub-millisecond and very long times alike', () => {
    const h = new LatencyHistogram();
    h.add(0);
    h.add(0.05);
    h.add(60_000);
    expect(h.percentile(1) / 60_000).toBeGreaterThan(0.98);
    expect(h.percentile(0)).toBeLessThan(0.02);
  });
});
