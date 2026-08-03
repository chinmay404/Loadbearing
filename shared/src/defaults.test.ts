// The placeholder is a promise about behaviour, so these check it against the
// behaviour rather than against itself: what the box says will happen if you leave
// it empty must be what the engine and the cost model actually do.

import { describe, expect, it } from 'vitest';
import { defaultFor, placeholderFor } from './defaults.js';
import { DEFAULT_CAPACITY, DEFAULT_LATENCY } from './components.js';
import { ARCH_NODE_TYPES } from './types.js';
import { paramsFor } from './params.js';

describe('defaultFor', () => {
  it('agrees with the catalogue the engine reads', () => {
    expect(defaultFor('vm', 'capacityRps')).toBe(DEFAULT_CAPACITY.vm);
    expect(defaultFor('vm', 'latencyMs')).toBe(DEFAULT_LATENCY.vm);
  });

  it('gives compute and datastores their cost-model sizing', () => {
    expect(defaultFor('vm', 'vcpu')).toBe(2);
    expect(defaultFor('vm', 'memoryGb')).toBe(4);
    expect(defaultFor('sql_db', 'vcpu')).toBe(4);
    expect(defaultFor('sql_db', 'memoryGb')).toBe(16);
    expect(defaultFor('sql_db', 'storageGb')).toBe(100);
  });

  it('derives concurrency from vCPU once the box has been sized', () => {
    // 8 in flight per vCPU, so sizing the machine moves the answer.
    expect(defaultFor('vm', 'concurrency', { vcpu: 4 })).toBe(32);
    expect(defaultFor('vm', 'concurrency', { vcpu: 1 })).toBe(8);
  });

  it('says nothing rather than inventing a number where there is no default', () => {
    // An unset ceiling is not "some number" — it is a component that does not
    // autoscale, and claiming otherwise would be a lie in a box.
    expect(defaultFor('vm', 'autoscaleMax')).toBeUndefined();
    expect(defaultFor('vm', 'rateLimitRps')).toBeUndefined();
  });

  it('only offers a hit rate to something that caches', () => {
    expect(defaultFor('cache', 'cacheHitRate')).toBe(0.8);
    expect(defaultFor('sql_db', 'cacheHitRate')).toBeUndefined();
  });

  it('reports an unbounded capacity as no number, not as Infinity', () => {
    expect(defaultFor('client', 'capacityRps')).toBeUndefined();
  });
});

describe('placeholderFor', () => {
  it('shows the number a learner will actually get', () => {
    expect(placeholderFor('vm', 'vcpu')).toBe('2');
    expect(placeholderFor('vm', 'latencyMs')).toBe('50');
  });

  it('abbreviates the large ones so they can be read at a glance', () => {
    expect(placeholderFor('cdn', 'capacityRps')).toBe('200k');
  });

  it('explains itself where there is no default to show', () => {
    expect(placeholderFor('vm', 'autoscaleMax')).toBe('no autoscaling');
    expect(placeholderFor('third_party', 'rateLimitRps')).toBe('no limit');
    expect(placeholderFor('vm', 'monthlyCost')).toBe('calculated');
  });

  it('never renders the literal word "default" again, for any knob anywhere', () => {
    // The whole complaint. Every field the inspector can show, on every component
    // type, must say something a reader can act on.
    for (const type of ARCH_NODE_TYPES) {
      for (const spec of paramsFor(type)) {
        const text = placeholderFor(type, spec.key);
        expect(text, `${type}.${String(spec.key)}`).not.toBe('default');
        expect(text.length, `${type}.${String(spec.key)} is blank`).toBeGreaterThan(0);
        expect(text, `${type}.${String(spec.key)} is NaN`).not.toContain('NaN');
      }
    }
  });
});
