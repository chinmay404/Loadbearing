// The request engine is only worth its cost if it reproduces what queueing theory
// says it must where the theory is exact. These are those cases: one server and
// several, with Poisson arrivals and exponential service, where the mean wait has
// a closed form. Then the promises that make a simulation usable at all: the same
// seed replays the same run, and calls go where the drawing says.

import { describe, expect, it } from 'vitest';
import { erlangC } from '../queueing.js';
import type { ArchNodeType, GraphDSL, GraphEdge, GraphNode, NodeAttrs } from '../types.js';
import { runDes } from './engine.js';
import type { Scenario } from '../engine.js';

const node = (id: string, type: ArchNodeType, attrs: NodeAttrs = {}): GraphNode => ({
  id,
  type,
  label: id,
  annotation: '',
  attrs,
});

const edge = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  kind: 'sync',
  label: '',
  ...extra,
});

const graph = (nodes: GraphNode[], edges: GraphEdge[]): GraphDSL => ({ nodes, edges, stickies: [], flows: [] });

const scenario = (horizonS: number): Scenario => ({ id: 'test', name: 'test', horizonS, loadMultiplier: 1 });

/** Poisson arrivals at `rps` into a store with `servers` cores and exponential service of `serviceMs`. */
const queue = (rps: number, servers: number, serviceMs: number) =>
  graph(
    [node('web', 'client', { trafficRps: rps }), node('db', 'sql_db', { vcpu: servers, latencyMs: serviceMs })],
    [edge('web', 'db')],
  );

const exact = { service: { db: 'exponential' as const }, warmupS: 20 };

describe('one server (M/M/1)', () => {
  // λ = 600/s, μ = 1000/s, ρ = 0.6. Mean wait in queue λ / (μ(μ − λ)) = 600 / (1000 × 400) s
  // = 1.5 ms. (The same formula with λ = 50/h, μ = 60/h gives 50 / (60 × 10) h = 5 minutes.)
  // 600 s at 600/s is ~350,000 requests after warm-up, enough for ±5%.
  it.each([1, 2, 3])('matches the closed-form mean wait (seed %i)', (seed) => {
    const result = runDes(queue(600, 1, 1), scenario(600), { seed, ...exact });
    const db = result.parts.find((p) => p.nodeId === 'db')!;
    expect(db.meanWaitMs).toBeGreaterThan(1.5 * 0.95);
    expect(db.meanWaitMs).toBeLessThan(1.5 * 1.05);
    expect(db.utilization).toBeCloseTo(0.6, 1);
  });
});

describe('several servers (M/M/c)', () => {
  // c = 4, λ = 3000/s, μ = 1000/s per server: offered load 3, 75% busy.
  // Mean wait = C(4, 3) / (cμ − λ) = C(4, 3) / 1000 s = C(4, 3) ms.
  it.each([1, 2, 3])('matches Erlang-C (seed %i)', (seed) => {
    const expected = erlangC(4, 3);
    const result = runDes(queue(3000, 4, 1), scenario(200), { seed, ...exact });
    const db = result.parts.find((p) => p.nodeId === 'db')!;
    expect(db.meanWaitMs).toBeGreaterThan(expected * 0.95);
    expect(db.meanWaitMs).toBeLessThan(expected * 1.05);
  });
});

describe('replaying a run', () => {
  const g = queue(500, 2, 2);

  it('gives a byte-identical result for the same seed', () => {
    const a = JSON.stringify(runDes(g, scenario(30), { seed: 9 }));
    const b = JSON.stringify(runDes(g, scenario(30), { seed: 9 }));
    expect(a).toBe(b);
  });

  it('gives a different result for a different seed', () => {
    const a = JSON.stringify(runDes(g, scenario(30), { seed: 9 }));
    const b = JSON.stringify(runDes(g, scenario(30), { seed: 10 }));
    expect(a).not.toBe(b);
  });
});

describe('requests go where the drawing says', () => {
  it('counts every request that arrives in each second, at the offered rate', () => {
    const result = runDes(queue(200, 4, 1), scenario(60), { seed: 1 });
    const offered = result.ticks.reduce((sum, t) => sum + t.offered, 0) / result.ticks.length;
    // Poisson count over 60 s at 200/s: standard error ~1.8/s.
    expect(offered).toBeGreaterThan(190);
    expect(offered).toBeLessThan(210);
    expect(result.ticks).toHaveLength(60);
  });

  it('makes share-many calls on each connection', () => {
    // Every request reads the cache-like store twice and the database a fifth of the time.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('kv', 'sql_db', { vcpu: 64, latencyMs: 0.1 }),
        node('db', 'sql_db', { vcpu: 64, latencyMs: 0.1 }),
      ],
      [edge('web', 'kv', { share: 2 }), edge('web', 'db', { share: 0.2 })],
    );
    const result = runDes(g, scenario(30), { seed: 1 });
    const web = result.parts.find((p) => p.nodeId === 'web')!.arrivals;
    expect(result.parts.find((p) => p.nodeId === 'kv')!.arrivals / web).toBeCloseTo(2, 2);
    expect(result.parts.find((p) => p.nodeId === 'db')!.arrivals / web).toBeCloseTo(0.2, 1);
  });

  it('a router sends each request to one backend, by share', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('lb', 'load_balancer'),
        node('a', 'sql_db', { vcpu: 64, latencyMs: 0.1 }),
        node('b', 'sql_db', { vcpu: 64, latencyMs: 0.1 }),
      ],
      [edge('web', 'lb'), edge('lb', 'a', { share: 3 }), edge('lb', 'b', { share: 1 })],
    );
    const result = runDes(g, scenario(30), { seed: 1 });
    const a = result.parts.find((p) => p.nodeId === 'a')!.arrivals;
    const b = result.parts.find((p) => p.nodeId === 'b')!.arrivals;
    expect(a / (a + b)).toBeCloseTo(0.75, 1);
  });

  it('end-to-end time adds the work and the wire, one half of the round trip each way', () => {
    // One store, no queueing to speak of, a 70 ms cross-region round trip and a
    // fixed 10 ms of work (no spread): every request takes 80 ms.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 10 }),
        node('db', 'sql_db', { vcpu: 64, latencyMs: 10 }),
      ],
      [edge('web', 'db', { placement: 'cross-region' })],
    );
    const result = runDes(g, scenario(10), { seed: 1, service: { db: 'fixed' } });
    expect(result.meanResponseMs).toBeCloseTo(80, 0);
  });
});
