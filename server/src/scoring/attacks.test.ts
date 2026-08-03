// What a model proposes, and what survives being checked against the drawing.
//
// The whole point of this layer is that a scenario naming something absent runs clean
// and reports a pass. Three of the bank's hand-written gates were doing that, and a
// model will make the mistake far more readily than a person. So these tests are
// almost entirely about what gets thrown away.

import { describe, expect, it } from 'vitest';
import type { GraphDSL } from '@loadbearing/shared';
import { validateAttacks } from './attacks.js';

const graph: GraphDSL = {
  nodes: [
    { id: 'n1', type: 'client', label: 'Shoppers', annotation: '', attrs: { trafficRps: 100 } },
    { id: 'n2', type: 'service', label: 'Catalog API', annotation: '', attrs: { replicas: 2, latencyMs: 40 } },
    { id: 'n3', type: 'cache', label: 'Redis', annotation: '', attrs: { cacheHitRate: 0.95 } },
    { id: 'n4', type: 'sql_db', label: 'Postgres', annotation: '', attrs: { latencyMs: 10 } },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'sync', label: '' },
    { id: 'e2', from: 'n2', to: 'n3', kind: 'sync', label: '' },
    { id: 'e3', from: 'n2', to: 'n4', kind: 'sync', label: '' },
  ],
  stickies: [],
  flows: [{ id: 'f1', name: 'read', kind: 'read', steps: ['n1', 'n2', 'n4'], rps: 100, description: '' }],
};

const one = (attack: Record<string, unknown>) => validateAttacks({ attacks: [attack] }, graph);

describe('what survives', () => {
  it('resolves component names to ids, so nothing downstream matches again', () => {
    const [a] = one({ id: 'kill-db', name: 'Database lost', killNodes: ['Postgres'] });
    expect(a!.killNodes).toEqual(['n4']);
    expect(a!.unresolved).toEqual([]);
  });

  it('accepts an id as readily as a label', () => {
    const [a] = one({ name: 'x', killNodes: ['n4'] });
    expect(a!.killNodes).toEqual(['n4']);
  });

  it('keeps every degradation lever the engine understands', () => {
    const [a] = one({
      name: 'everything at once',
      degrade: [
        { node: 'Catalog API', latencyMultiple: 12 },
        { node: 'Postgres', addMs: 500 },
        { node: 'Redis', hitRate: 0 },
        { node: 'Postgres', capacityMultiple: 0.1 },
      ],
    });
    expect(a!.degrade).toHaveLength(4);
    expect(a!.degrade[2]).toMatchObject({ node: 'Redis', hitRate: 0 });
  });

  it('fills in a pass criterion rather than leaving a gate with no bar', () => {
    const [a] = one({ name: 'x', rpsMultiplier: 10 });
    expect(a!.passCriteria).toContain('completing');
  });
});

describe('what gets thrown away', () => {
  it('drops an attack with no lever at all — the silent pass', () => {
    // Baseline load, nothing killed, nothing slowed. It would run, report clean, and
    // the learner would believe their design survived something.
    expect(one({ name: 'nothing happens', rpsMultiplier: 1 })).toEqual([]);
  });

  it('drops an attack whose only lever names a component that is not there', () => {
    expect(one({ name: 'kill Cassandra', killNodes: ['Cassandra'] })).toEqual([]);
    expect(one({ name: 'slow Kafka', degrade: [{ node: 'Kafka', latencyMultiple: 10 }] })).toEqual([]);
  });

  it('keeps an attack that still has a real lever, and says what missed', () => {
    const [a] = one({
      name: 'partly wrong',
      rpsMultiplier: 8,
      killNodes: ['Postgres', 'Cassandra'],
    });
    expect(a!.killNodes).toEqual(['n4']);
    // Reported, not hidden: "your design survived this" and "half of it did not
    // happen" are different sentences.
    expect(a!.unresolved).toEqual(['Cassandra']);
  });

  it('drops a degradation that names something but asks for nothing', () => {
    // The subtlest void: it resolves, it looks configured, it changes nothing.
    expect(one({ name: 'x', degrade: [{ node: 'Postgres' }] })).toEqual([]);
    expect(one({ name: 'x', degrade: [{ node: 'Postgres', latencyMultiple: 1 }] })).toEqual([]);
  });

  it('ignores third-party latency when the sheet has no third party', () => {
    expect(one({ name: 'slow the world', thirdPartyLatencyMs: 3000 })).toEqual([]);
  });

  it('drops duplicates rather than running the same attack twice', () => {
    const out = validateAttacks(
      { attacks: [
        { id: 'same', name: 'A', killNodes: ['Postgres'] },
        { id: 'same', name: 'B', killNodes: ['Redis'] },
      ] },
      graph,
    );
    expect(out).toHaveLength(1);
  });

  it('survives anything at all as input', () => {
    for (const junk of [null, undefined, 42, 'attacks', {}, { attacks: 'lots' }, { attacks: [null, 7] }]) {
      expect(validateAttacks(junk, graph)).toEqual([]);
    }
  });
});

describe('bounds', () => {
  it('clamps a load multiplier a model invented', () => {
    expect(one({ name: 'x', rpsMultiplier: 1e9 })[0]!.rpsMultiplier).toBe(1000);
    expect(one({ name: 'x', rpsMultiplier: -5, killNodes: ['Postgres'] })[0]!.rpsMultiplier).toBe(0);
  });

  it('clamps a latency multiple, since 10,000x is not a brownout', () => {
    expect(one({ name: 'x', degrade: [{ node: 'Postgres', latencyMultiple: 1e6 }] })[0]!.degrade[0]!.latencyMultiple).toBe(200);
  });

  it('returns at most four, ordered as given', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      name: `Attack ${i}`,
      killNodes: ['Postgres'],
    }));
    const out = validateAttacks({ attacks: many }, graph);
    expect(out).toHaveLength(4);
    expect(out[0]!.id).toBe('a0');
  });

  it('makes an id when the model forgot one, from the name', () => {
    expect(one({ name: 'Cache Falls Over', killNodes: ['Redis'] })[0]!.id).toBe('cache-falls-over');
  });
});
