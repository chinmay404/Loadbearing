// The engine is only worth having if its mechanisms are right, so these tests are
// written per mechanism: where traffic starts, how it divides, what absorbs it,
// what sheds it, what retries do to a struggling dependency, what a timeout turns
// slow into, and how a backlog builds and drains.
//
// Each one is a claim about behaviour a real system has. Where a number is
// asserted exactly, it is because the arithmetic is meant to be checkable by hand.

import { describe, expect, it } from 'vitest';
import {
  AUTOSCALE_LAG_S,
  DEFAULT_SOURCE_RPS,
  rateAt,
  runEngine,
  steadyScenario,
  type Scenario,
} from './engine.js';
import type { ArchNodeType, EdgeKind, GraphDSL, GraphEdge, GraphNode, NodeAttrs } from './types.js';

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
  kind: (extra.kind ?? 'sync') as EdgeKind,
  label: '',
  ...extra,
});

const graph = (nodes: GraphNode[], edges: GraphEdge[]): GraphDSL => ({
  nodes,
  edges,
  stickies: [],
  flows: [],
});

/** A run long enough to settle, short enough to read. */
const scenario = (patch: Partial<Scenario> = {}): Scenario => ({
  ...steadyScenario(1),
  horizonS: 10,
  ...patch,
});

const last = <T>(xs: T[]): T => xs[xs.length - 1]!;
const hop = (result: ReturnType<typeof runEngine>, id: string) =>
  result.final.find((h) => h.nodeId === id)!;

describe('where traffic starts', () => {
  it('treats whatever nothing points into as the entry point, and says so', () => {
    // A service and a database, no client: a fragment, not a system under load.
    const g = graph([node('api', 'service'), node('db', 'sql_db')], [edge('api', 'db')]);
    const result = runEngine(g, scenario());

    // Nothing points into the service, so it IS the entry point. The run says so
    // rather than guessing quietly or refusing to simulate a design that predates
    // sources existing.
    expect(result.sources).toEqual([{ nodeId: 'api', rps: DEFAULT_SOURCE_RPS, inferred: true }]);
    expect(result.assumptions.join(' ')).toContain('Nothing is marked as where traffic starts');
    expect(result.assumptions.join(' ')).toContain('api');
  });

  it('treats a client with nothing pointing into it as the start', () => {
    const g = graph(
      [node('web', 'client'), node('api', 'service')],
      [edge('web', 'api')],
    );
    const result = runEngine(g, scenario());

    expect(result.sources).toEqual([{ nodeId: 'web', rps: DEFAULT_SOURCE_RPS, inferred: false }]);
    expect(last(result.ticks).offeredRps).toBe(DEFAULT_SOURCE_RPS);
  });

  it('lets any component be marked a source at a stated rate', () => {
    const g = graph(
      [node('cron', 'scheduler', { trafficRps: 40 }), node('worker', 'worker')],
      [edge('cron', 'worker')],
    );
    expect(runEngine(g, scenario()).sources).toEqual([{ nodeId: 'cron', rps: 40, inferred: false }]);
  });

  it('takes its rate from an authored flow when the sheet predates sources', () => {
    const g: GraphDSL = {
      ...graph([node('web', 'client'), node('api', 'service')], [edge('web', 'api')]),
      flows: [{ id: 'f1', name: 'reads', kind: 'read', steps: ['web', 'api'], rps: 250, description: '' }],
    };
    expect(runEngine(g, scenario()).sources[0]!.rps).toBe(250);
  });

  it('multiplies every source by the slider', () => {
    const g = graph(
      [node('web', 'client', { trafficRps: 100 }), node('api', 'service')],
      [edge('web', 'api')],
    );
    expect(last(runEngine(g, scenario({ loadMultiplier: 7 })).ticks).offeredRps).toBe(700);
  });

  it('ends the journey at whatever has nothing after it', () => {
    const g = graph(
      [node('web', 'client'), node('api', 'service'), node('db', 'sql_db')],
      [edge('web', 'api'), edge('api', 'db')],
    );
    expect(runEngine(g, scenario()).sinkIds).toEqual(['db']);
  });
});

describe('how a component divides what arrives', () => {
  it('a router sends each request to one of its downstreams', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 900 }),
        node('lb', 'load_balancer'),
        node('a', 'service', { concurrency: 1000 }),
        node('b', 'service', { concurrency: 1000 }),
        node('c', 'service', { concurrency: 1000 }),
      ],
      [edge('web', 'lb'), edge('lb', 'a'), edge('lb', 'b'), edge('lb', 'c')],
    );
    const result = runEngine(g, scenario());

    // 900 split three ways, not 900 each.
    for (const id of ['a', 'b', 'c']) expect(hop(result, id).arrivingRps).toBeCloseTo(300, 1);
  });

  it('honours an explicit share when a router is weighted', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('lb', 'load_balancer'),
        node('big', 'service', { concurrency: 1000 }),
        node('small', 'service', { concurrency: 1000 }),
      ],
      [edge('web', 'lb'), edge('lb', 'big', { share: 0.9 }), edge('lb', 'small', { share: 0.1 })],
    );
    const result = runEngine(g, scenario());

    expect(hop(result, 'big').arrivingRps).toBeCloseTo(900, 1);
    expect(hop(result, 'small').arrivingRps).toBeCloseTo(100, 1);
  });

  it('a service calls every dependency once per request, not a share of them', () => {
    // The most consequential rule in the model: splitting here would make a
    // service's dependencies look three times cheaper and three times safer.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 500 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('auth', 'auth', { concurrency: 10_000 }),
        node('cache', 'cache', { cacheHitRate: 0 }),
        node('db', 'sql_db', { capacityRps: 10_000 }),
      ],
      [edge('web', 'api'), edge('api', 'auth'), edge('api', 'cache'), edge('api', 'db')],
    );
    const result = runEngine(g, scenario());

    for (const id of ['auth', 'cache', 'db']) {
      expect(hop(result, id).arrivingRps).toBeCloseTo(500, 1);
    }
  });

  it('reads a share on a fan-out as "this fraction of requests need this call"', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('psp', 'payment_gateway', { capacityRps: 10_000 }),
      ],
      // Only one request in ten reaches checkout.
      [edge('web', 'api'), edge('api', 'psp', { share: 0.1 })],
    );
    expect(hop(runEngine(g, scenario()), 'psp').arrivingRps).toBeCloseTo(100, 1);
  });
});

describe('absorbing and bypassing', () => {
  const cacheAside = (hitRate: number, extra: Partial<Scenario> = {}) => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('cache', 'cache', { cacheHitRate: hitRate, capacityRps: 100_000 }),
        node('db', 'sql_db', { capacityRps: 400 }),
      ],
      [edge('web', 'api'), edge('api', 'cache'), edge('cache', 'db')],
    );
    return runEngine(g, scenario(extra));
  };

  it('passes only the misses through to the store behind it', () => {
    // 1000 reads, 80% hit rate, so the database sees 200.
    expect(hop(cacheAside(0.8), 'db').arrivingRps).toBeCloseTo(200, 1);
  });

  it('a dead cache is transparent, and the herd lands on the database', () => {
    // The lesson: cache death is not read death, it is a database problem. The
    // store sized for 200 rps of misses now sees all 1000 and sheds.
    const result = cacheAside(0.8, { outages: [{ nodeId: 'cache', atS: 0 }] });

    expect(hop(result, 'cache').bypassed).toBe(true);
    expect(hop(result, 'db').arrivingRps).toBeCloseTo(1000, 1);
    expect(hop(result, 'db').state).toBe('saturated');
    expect(result.firstFailure?.nodeId).toBe('db');
  });

  it('a cache emptied mid-run does the same without anything dying', () => {
    // What a cache-busting attack actually is: every key unique, hit rate zero.
    const result = cacheAside(0.9, {
      horizonS: 6,
      overrides: [{ nodeId: 'cache', hitRate: 0, atS: 3 }],
    });

    expect(result.ticks[1]!.lostRps).toBe(0);
    expect(last(result.ticks).lostRps).toBeGreaterThan(0);
    expect(result.firstFailure?.nodeId).toBe('db');
  });
});

describe('capacity as concurrency over service time', () => {
  const apiWith = (attrs: NodeAttrs) => {
    const g = graph(
      [node('web', 'client', { trafficRps: 2000 }), node('api', 'service', attrs)],
      [edge('web', 'api')],
    );
    return hop(runEngine(g, scenario()), 'api');
  };

  it('derives what one replica can serve', () => {
    // 64 in flight, 50ms each: 1280 rps.
    expect(apiWith({ concurrency: 64, latencyMs: 50 }).capacityRps).toBeCloseTo(1280, 0);
  });

  it('loses capacity when a dependency slows it down, with nothing else changed', () => {
    // Same 64 workers, held ten times as long: a tenth of the throughput. This is
    // why a slow dependency takes out a service that is nowhere near its rps limit.
    expect(apiWith({ concurrency: 64, latencyMs: 500 }).capacityRps).toBeCloseTo(128, 0);
  });

  it('multiplies by replicas', () => {
    expect(apiWith({ concurrency: 64, latencyMs: 50, replicas: 3 }).capacityRps).toBeCloseTo(3840, 0);
  });

  it('lets a stated rps override the derivation', () => {
    expect(apiWith({ concurrency: 64, latencyMs: 50, capacityRps: 200 }).capacityRps).toBeCloseTo(200, 0);
  });
});

describe('what happens over capacity', () => {
  it('serves what it can and drops the rest', () => {
    const g = graph(
      [node('web', 'client', { trafficRps: 1000 }), node('api', 'service', { capacityRps: 400 })],
      [edge('web', 'api')],
    );
    const result = runEngine(g, scenario());
    const api = hop(result, 'api');

    expect(api.servedRps).toBeCloseTo(400, 0);
    expect(api.droppedRps).toBeCloseTo(600, 0);
    expect(api.state).toBe('saturated');
    expect(last(result.ticks).successRate).toBeCloseTo(0.4, 2);
  });

  it('warns before it breaks, so there is somewhere to stand', () => {
    const at = (rps: number) => {
      const g = graph(
        [node('web', 'client', { trafficRps: rps }), node('api', 'service', { capacityRps: 100 })],
        [edge('web', 'api')],
      );
      return hop(runEngine(g, scenario()), 'api').state;
    };
    expect(at(50)).toBe('ok');
    expect(at(75)).toBe('warn');
    expect(at(95)).toBe('hot');
    expect(at(150)).toBe('saturated');
  });

  it('sheds at the edge when something there is built to refuse', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 5000 }),
        node('limiter', 'rate_limiter', { capacityRps: 1000 }),
        node('api', 'service', { capacityRps: 1200 }),
      ],
      [edge('web', 'limiter'), edge('limiter', 'api')],
    );
    const result = runEngine(g, scenario());

    // The limiter refuses 4000, and compute behind it never sees the flood.
    expect(hop(result, 'limiter').droppedRps).toBeCloseTo(4000, 0);
    expect(hop(result, 'api').arrivingRps).toBeCloseTo(1000, 0);
    expect(hop(result, 'api').state).not.toBe('saturated');
  });

  it('blames the component that lost traffic first, not the loudest one', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('api', 'service', { capacityRps: 300 }),
        node('db', 'sql_db', { capacityRps: 10 }),
      ],
      [edge('web', 'api'), edge('api', 'db')],
    );
    const result = runEngine(g, scenario());

    // The database is far worse off, but it is only seeing what the API let through:
    // the API is the constraint to fix first.
    expect(result.firstFailure?.nodeId).toBe('api');
    expect(result.failures.map((f) => f.nodeId)).toContain('db');
  });
});

describe('failing over, and not', () => {
  const twoOf = (type: ArchNodeType, replicated: boolean) =>
    graph(
      [
        node('web', 'client', { trafficRps: 400 }),
        node('lb', 'load_balancer'),
        node('one', type, { capacityRps: 1000 }),
        node('two', type, { capacityRps: 1000 }),
      ],
      [
        edge('web', 'lb'),
        edge('lb', 'one'),
        edge('lb', 'two'),
        ...(replicated ? [edge('one', 'two', { kind: 'replication' })] : []),
      ],
    );

  it('does NOT reroute between two components that merely share a type', () => {
    // A load balancer in front of a Catalog API and a Search API is not redundancy.
    // Sending one's traffic to the other would hide the single point of failure this
    // is supposed to find.
    const result = runEngine(twoOf('service', false), scenario({ outages: [{ nodeId: 'two', atS: 0 }] }));

    expect(hop(result, 'one').arrivingRps).toBeCloseTo(200, 1);
    expect(last(result.ticks).successRate).toBeCloseTo(0.5, 2);
  });

  it('does reroute when a replication link says they hold the same data', () => {
    const result = runEngine(twoOf('sql_db', true), scenario({ outages: [{ nodeId: 'two', atS: 0 }] }));

    expect(hop(result, 'one').arrivingRps).toBeCloseTo(400, 1);
    expect(last(result.ticks).successRate).toBeCloseTo(1, 2);
  });
});

describe('timeouts and retries', () => {
  it('fails a call that is merely slow, once it is past the caller’s patience', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 10 }),
        node('api', 'service', { concurrency: 10_000, timeoutMs: 100, latencyMs: 400 }),
      ],
      [edge('web', 'api')],
    );
    const result = runEngine(g, scenario());

    expect(hop(result, 'api').utilization).toBeLessThan(0.1);
    expect(hop(result, 'api').servedRps).toBe(0);
    expect(result.firstFailure?.reason).toContain('past the 100ms');
  });

  it('sends more attempts than requests once a dependency starts failing', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('api', 'service', { concurrency: 100_000 }),
        node('db', 'sql_db', { capacityRps: 200 }),
      ],
      [edge('web', 'api'), edge('api', 'db', { retries: 2 })],
    );
    const result = runEngine(g, scenario());

    // A dependency failing most of its calls is asked again and again: this is the
    // retry storm, and the database is strictly worse off for it.
    expect(hop(result, 'db').arrivingRps).toBeGreaterThan(1000);
    expect(result.retryAmplification).toBeGreaterThan(1);
  });

  it('stops amplifying when the caller is told not to retry', () => {
    const build = (retries: number) =>
      graph(
        [
          node('web', 'client', { trafficRps: 1000 }),
          node('api', 'service', { concurrency: 100_000 }),
          node('db', 'sql_db', { capacityRps: 200 }),
        ],
        [edge('web', 'api'), edge('api', 'db', { retries })],
      );

    const withRetries = hop(runEngine(build(3), scenario()), 'db').arrivingRps;
    const without = hop(runEngine(build(0), scenario()), 'db').arrivingRps;

    expect(without).toBeCloseTo(1000, 0);
    expect(withRetries).toBeGreaterThan(without);
  });
});

describe('buffers over time', () => {
  const withQueue = (patch: Partial<Scenario>) => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('q', 'queue', { capacityRps: 10_000, queueDepthMax: 1_000_000 }),
        node('worker', 'worker', { capacityRps: 200 }),
      ],
      [edge('web', 'api'), edge('api', 'q', { kind: 'async' }), edge('q', 'worker')],
    );
    return runEngine(g, scenario(patch));
  };

  it('falls behind while the rush is on and catches up after it', () => {
    const result = withQueue({
      horizonS: 60,
      patterns: { web: { shape: 'spike', baseRps: 100, peakMultiple: 5, startS: 5, durationS: 10 } },
    });

    const during = result.ticks.find((tick) => tick.t === 12)!;
    expect(during.offeredRps).toBeCloseTo(500, 0);
    // Owed work built up during the rush...
    expect(result.peakBacklog.q).toBeGreaterThan(1000);
    // ...and was paid off afterwards, which only happens because the consumers can
    // drain faster than the baseline arrives. A drain merely equal to the baseline
    // never catches up, which is its own lesson.
    expect(hop(result, 'q').backlog).toBe(0);
  });

  it('never catches up when the drain only just keeps pace with the baseline', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('q', 'queue', { capacityRps: 10_000, queueDepthMax: 1_000_000 }),
        node('worker', 'worker', { capacityRps: 100 }),
      ],
      [edge('web', 'q', { kind: 'async' }), edge('q', 'worker')],
    );
    const result = runEngine(
      g,
      scenario({
        horizonS: 60,
        patterns: { web: { shape: 'spike', baseRps: 100, peakMultiple: 5, startS: 5, durationS: 10 } },
      }),
    );

    expect(hop(result, 'q').backlog).toBeGreaterThan(1000);
  });

  it('accepts what it is given rather than refusing, until its depth runs out', () => {
    const shallow = graph(
      [
        node('web', 'client', { trafficRps: 500 }),
        node('q', 'queue', { capacityRps: 50, queueDepthMax: 10 }),
        node('worker', 'worker', { capacityRps: 50 }),
      ],
      [edge('web', 'q'), edge('q', 'worker')],
    );
    const result = runEngine(shallow, scenario());

    expect(hop(result, 'q').droppedRps).toBeGreaterThan(0);
    expect(result.firstFailure?.reason).toContain('behind');
  });
});

describe('traffic patterns', () => {
  it('a spike is the baseline, then the peak, then the baseline again', () => {
    const p = { shape: 'spike' as const, baseRps: 100, peakMultiple: 10, startS: 5, durationS: 5 };
    expect(rateAt(p, 4)).toBe(100);
    expect(rateAt(p, 5)).toBe(1000);
    expect(rateAt(p, 9)).toBe(1000);
    expect(rateAt(p, 10)).toBe(100);
  });

  it('a ramp climbs to the peak and stays there', () => {
    const p = { shape: 'ramp' as const, baseRps: 100, peakMultiple: 3, startS: 0, durationS: 10 };
    expect(rateAt(p, 0)).toBe(100);
    expect(rateAt(p, 5)).toBe(200);
    expect(rateAt(p, 10)).toBe(300);
    expect(rateAt(p, 50)).toBe(300);
  });

  it('a burst alternates on and off', () => {
    const p = { shape: 'burst' as const, baseRps: 10, peakMultiple: 20, startS: 0, durationS: 2, periodS: 10 };
    expect(rateAt(p, 0)).toBe(200);
    expect(rateAt(p, 1)).toBe(200);
    expect(rateAt(p, 2)).toBe(10);
    expect(rateAt(p, 10)).toBe(200);
  });
});

describe('an autoscaling group', () => {
  const pool = (attrs: NodeAttrs) =>
    graph(
      [node('web', 'client', { trafficRps: 900 }), node('pool', 'container_platform', attrs)],
      [edge('web', 'pool')],
    );

  it('constrains traffic — it is workers, not a scheduler', () => {
    // Drawn between a balancer and a database, this box is the containers serving the
    // requests. Treating it as a control plane reported 0% utilisation while 400 rps
    // flowed straight through an autoscaling group.
    const result = runEngine(pool({ capacityRps: 300, autoscaleMin: 1, autoscaleMax: 10 }), scenario());
    const hop = result.final.find((h) => h.nodeId === 'pool')!;

    expect(hop.capacityRps).toBeCloseTo(300, 0);
    expect(hop.utilization).toBeGreaterThan(1);
    expect(hop.droppedRps).toBeGreaterThan(0);
  });

  it('starts at its floor, so "min 1" meets a spike with one container', () => {
    const result = runEngine(pool({ capacityRps: 300, autoscaleMin: 1, autoscaleMax: 50 }), scenario());
    expect(result.final.find((h) => h.nodeId === 'pool')!.replicas).toBe(1);
  });

  it('starts higher when the floor is raised, and copes immediately', () => {
    const result = runEngine(pool({ capacityRps: 300, autoscaleMin: 5, autoscaleMax: 50 }), scenario());
    const hop = result.final.find((h) => h.nodeId === 'pool')!;

    expect(hop.replicas).toBe(5);
    expect(hop.droppedRps).toBe(0);
    expect(last(result.ticks).successRate).toBeCloseTo(1, 2);
  });

  it('grows to the ceiling and no further', () => {
    const result = runEngine(
      pool({ capacityRps: 300, autoscaleMin: 1, autoscaleMax: 2 }),
      scenario({ horizonS: AUTOSCALE_LAG_S * 2 + 5 }),
    );
    const hop = result.final.find((h) => h.nodeId === 'pool')!;

    expect(hop.replicas).toBe(2);
    // Still short of 900 rps, because the ceiling is the ceiling.
    expect(hop.droppedRps).toBeGreaterThan(0);
  });

  it('leaves headroom rather than scaling to exactly the load', () => {
    const result = runEngine(
      pool({ capacityRps: 100, autoscaleMin: 1, autoscaleMax: 100 }),
      scenario({ horizonS: AUTOSCALE_LAG_S + 5 }),
    );
    // 900 rps at 100 rps each needs 9 replicas to be full; an autoscaler aiming at 70%
    // asks for 13, because scaling to the brim guarantees scaling again immediately.
    expect(result.final.find((h) => h.nodeId === 'pool')!.replicas).toBe(13);
  });
});

describe('scaling, late', () => {
  it('adds capacity only after the damage is done', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1000 }),
        node('api', 'service', { capacityRps: 200, replicas: 1, autoscaleMax: 10 }),
      ],
      [edge('web', 'api')],
    );
    const result = runEngine(g, scenario({ horizonS: AUTOSCALE_LAG_S * 2 + 5 }));

    // One replica through the first minute, more afterwards: a spike shorter than
    // the lag is served entirely by the capacity you already had.
    expect(result.ticks[10]!.successRate).toBeLessThan(0.5);
    expect(hop(result, 'api').replicas).toBeGreaterThan(1);
    expect(last(result.ticks).successRate).toBeGreaterThan(result.ticks[10]!.successRate);
  });
});

describe('outages over time', () => {
  it('takes a component away and gives it back', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('db', 'sql_db', { capacityRps: 1000 }),
      ],
      [edge('web', 'api'), edge('api', 'db')],
    );
    const result = runEngine(g, scenario({ horizonS: 12, outages: [{ nodeId: 'db', atS: 4, forS: 4 }] }));

    expect(result.ticks[2]!.successRate).toBeCloseTo(1, 2);
    expect(result.ticks[5]!.successRate).toBeLessThan(0.1);
    expect(last(result.ticks).successRate).toBeCloseTo(1, 2);
  });

  it('reports an SLO breach with a start, an end, and a recovery', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('api', 'service', { concurrency: 10_000 }),
        node('db', 'sql_db', { capacityRps: 1000 }),
      ],
      [edge('web', 'api'), edge('api', 'db')],
    );
    const result = runEngine(
      g,
      scenario({
        horizonS: 12,
        outages: [{ nodeId: 'db', atS: 4, forS: 4 }],
        slo: { successRate: 0.99 },
      }),
    );

    expect(result.sloBreaches).toEqual([{ metric: 'successRate', fromS: 4, toS: 8 }]);
    expect(result.recoveredAtS).toBe(8);
  });

  it('leaves recovery unset when the run ends still broken', () => {
    const g = graph(
      [node('web', 'client', { trafficRps: 100 }), node('api', 'service', { capacityRps: 10 })],
      [edge('web', 'api')],
    );
    const result = runEngine(g, scenario({ slo: { successRate: 0.99 } }));

    expect(result.sloBreaches.length).toBe(1);
    expect(result.recoveredAtS).toBeNull();
  });
});

describe('the engine itself', () => {
  const g = graph(
    [
      node('web', 'client', { trafficRps: 500 }),
      node('lb', 'load_balancer'),
      node('api', 'service', { capacityRps: 300 }),
      node('db', 'sql_db', { capacityRps: 400 }),
    ],
    [edge('web', 'lb'), edge('lb', 'api'), edge('api', 'db')],
  );

  it('gives the identical answer twice', () => {
    expect(JSON.stringify(runEngine(g, scenario()))).toBe(JSON.stringify(runEngine(g, scenario())));
  });

  it('does not touch what it was given', () => {
    const before = JSON.stringify(g);
    runEngine(g, scenario({ outages: [{ nodeId: 'api', atS: 1 }] }));
    expect(JSON.stringify(g)).toBe(before);
  });

  it('walks a cycle once and says that it did', () => {
    const cyclic = graph(
      [
        node('web', 'client', { trafficRps: 10 }),
        node('a', 'service', { concurrency: 10_000 }),
        node('b', 'service', { concurrency: 10_000 }),
      ],
      [edge('web', 'a'), edge('a', 'b'), edge('b', 'a')],
    );
    const result = runEngine(cyclic, scenario());

    expect(result.cycleNodeIds).toEqual(['a']);
    expect(result.assumptions.join(' ')).toContain('cycle');
  });

  it('states its assumptions every time', () => {
    const result = runEngine(g, scenario());
    expect(result.assumptions.join(' ')).toContain('concurrency divided by service time');
    expect(result.assumptions.join(' ')).toContain('every dependency once per request');
  });

  it('ignores boundaries, which carry no traffic', () => {
    const withGroup = graph(
      [node('web', 'client', { trafficRps: 100 }), node('box', 'group'), node('api', 'service')],
      [edge('web', 'api')],
    );
    expect(runEngine(withGroup, scenario()).final.some((h) => h.nodeId === 'box')).toBe(false);
  });

  it('never routes request traffic down a replication link', () => {
    const replicated = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('primary', 'sql_db', { capacityRps: 1000 }),
        node('follower', 'read_replica', { capacityRps: 1000 }),
      ],
      [edge('web', 'primary'), edge('primary', 'follower', { kind: 'replication' })],
    );
    const result = runEngine(replicated, scenario());

    expect(hop(result, 'follower').arrivingRps).toBe(0);
    expect(result.sinkIds).toEqual(['primary']);
  });
});
