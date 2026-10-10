// The request engine is only worth its cost if it reproduces what queueing theory
// says it must where the theory is exact. These are those cases: one server and
// several, with Poisson arrivals and exponential service, where the mean wait has
// a closed form. Then the promises that make a simulation usable at all: the same
// seed replays the same run, and calls go where the drawing says.

import { describe, expect, it } from 'vitest';
import { erlangC } from '../queueing.js';
import type { ArchNodeType, GraphDSL, GraphEdge, GraphNode, NodeAttrs } from '../types.js';
import { runDes } from './engine.js';
import { effectiveHitRate, type Scenario } from '../engine.js';

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

// ------------------------------------------------------------- phase 2 ---
// Compute runtimes, connection limits and caches. "Starts dropping" is measured as
// completions falling below 99% of arrivals over a hold: until bounded queues and
// timeouts arrive (phase 3), an overloaded part grows its queue instead of
// refusing, so what it cannot finish shows up as completions falling behind.

const hold = (horizonS = 30): Scenario => scenario(horizonS);
const at = (result: ReturnType<typeof runDes>, id: string) => result.parts.find((p) => p.nodeId === id)!;

/** A service in front of a fast store: one core, 0.16 ms of CPU, a 1 ms call. */
const serviceAndStore = (rps: number, app: NodeAttrs) =>
  graph(
    [
      node('web', 'client', { trafficRps: rps }),
      node('app', 'service', { vcpu: 1, cpuMs: 0.16, latencyMs: 0.16, ...app }),
      node('db', 'sql_db', { vcpu: 64, latencyMs: 1 }),
    ],
    [edge('web', 'app', { placement: 'same-host' }), edge('app', 'db', { placement: 'same-host' })],
  );

describe('an event loop is limited by CPU, not by waiting', () => {
  // 1 core ÷ 0.16 ms = 6,250 rps. Holding anything through the 1 ms call would cap
  // it near 1 ÷ 1.2 ms ≈ 830 rps instead.
  const run = (rps: number) =>
    runDes(serviceAndStore(rps, { runtime: 'event-loop' }), hold(), { seed: 1, warmupS: 5 });

  it('keeps up at 5,800 rps', () => {
    expect(run(5800).completionRatio).toBeGreaterThanOrEqual(0.99);
  });

  it('falls behind by 6,600 rps, with its one core full', () => {
    const result = run(6600);
    expect(result.completionRatio).toBeLessThan(0.99);
    expect(at(result, 'app').utilization).toBeGreaterThan(0.97);
  });
});

describe('a thread pool holds its slots through every wait', () => {
  // 4 slots, each held ~1.21 ms (0.16 CPU + 0.05 wire + 1 ms call): 4 ÷ 1.21 ms ≈ 3,300
  // rps, well under the 6,250 its one core could do. Fixed times keep it hand-checkable.
  const exactTimes = { service: { app: 'fixed', db: 'fixed' } as const };
  const run = (rps: number, runtime: 'thread-pool' | 'event-loop') =>
    runDes(serviceAndStore(rps, { runtime, concurrency: 4 }), hold(), { seed: 1, warmupS: 5, ...exactTimes });

  it('keeps up at 3,000 rps', () => {
    expect(run(3000, 'thread-pool').completionRatio).toBeGreaterThanOrEqual(0.99);
  });

  it('falls behind by 3,800 rps with its core barely half used: slots, not CPU', () => {
    const result = run(3800, 'thread-pool');
    expect(result.completionRatio).toBeLessThan(0.99);
    expect(at(result, 'app').utilization).toBeLessThan(0.7);
  });

  it('the same part as an event loop carries 3,800 rps easily', () => {
    expect(run(3800, 'event-loop').completionRatio).toBeGreaterThanOrEqual(0.99);
  });
});

describe('a store gives out only the connections it has', () => {
  // 500 rps each holding a connection for 50 ms needs 25. Ten allow 10 ÷ 50 ms = 200 rps.
  const store = (attrs: NodeAttrs) =>
    graph(
      [node('web', 'client', { trafficRps: 500 }), node('db', 'sql_db', { vcpu: 64, latencyMs: 50, ...attrs })],
      [edge('web', 'db')],
    );
  const served = (attrs: NodeAttrs) =>
    at(runDes(store(attrs), hold(), { seed: 1, warmupS: 5, service: { db: 'fixed' } }), 'db').servedRps;

  it('serves 200 rps through a pool of 10 in front of a 100-connection store', () => {
    expect(served({ poolSize: 10, maxConnections: 100 })).toBeCloseTo(200, -1);
  });

  it('takes the smaller limit whichever side states it', () => {
    expect(served({ poolSize: 100, maxConnections: 10 })).toBeCloseTo(200, -1);
  });

  it('serves everything when no limit is stated', () => {
    expect(served({})).toBeGreaterThan(480);
  });
});

describe('a cache answers what it holds and passes the rest on', () => {
  const cached = (attrs: NodeAttrs) =>
    graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('kv', 'cache', attrs),
        node('db', 'sql_db', { vcpu: 64, latencyMs: 1 }),
      ],
      [edge('web', 'kv'), edge('kv', 'db')],
    );
  const missRate = (attrs: NodeAttrs) => {
    const result = runDes(cached(attrs), hold(), { seed: 1 });
    return at(result, 'db').arrivals / at(result, 'kv').arrivals;
  };

  it('sends the misses on: 80% hits leave a fifth for the database', () => {
    expect(missRate({ cacheHitRate: 0.8 })).toBeCloseTo(0.2, 1);
  });

  it('cannot hit more than its memory allows', () => {
    // 1 GB of cache for 16 GB of working set covers √(1/16) = 25%, whatever was typed.
    const attrs = { cacheHitRate: 0.95, memoryGb: 1, workingSetGb: 16 };
    const expected = 1 - effectiveHitRate(node('kv', 'cache', attrs));
    expect(expected).toBeGreaterThan(0.5);
    expect(missRate(attrs)).toBeCloseTo(expected, 1);
  });
});

describe('what a service is when nobody says', () => {
  it('is a thread pool spending 2 ms of CPU per request, and says so', () => {
    const g = graph(
      [node('web', 'client', { trafficRps: 10 }), node('app', 'service')],
      [edge('web', 'app')],
    );
    const text = runDes(g, hold(5), { seed: 1 }).assumptions.join(' ');
    expect(text).toContain('thread pool');
    expect(text).toContain('2 ms');
  });
});
