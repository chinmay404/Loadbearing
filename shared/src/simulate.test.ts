// The capacity report, which is what the grader, the scenario gates and the canvas
// all read.
//
// These tests were rewritten when the engine underneath changed. The old ones
// asserted the previous contract — that a hand-authored step list is what runs, and
// that the rps typed into it is the load — which is exactly what was replaced. What
// they also encoded were domain truths worth keeping, and those are all still here:
// a dead cache degrades rather than kills, a killed store fails over to its replica,
// a queue behind slow consumers builds a backlog, a single copy of the data is a
// finding, a component every path crosses is a finding, and a scenario may name what
// to kill by label.
//
// The mechanisms are tested in engine.test.ts. This file is about the report: its
// shape, its flow numbers, its findings and its verdict.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPACITY } from './components.js';
import { OUTAGE_AT_S, simulate, unmatchedDegradations } from './simulate.js';
import type { ArchNodeType, GraphDSL, GraphEdge, GraphNode, NodeAttrs, SimConfig } from './types.js';

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
  kind: extra.kind ?? 'sync',
  label: '',
  ...extra,
});

const config = (patch: Partial<SimConfig> = {}): SimConfig => ({
  rpsMultiplier: 1,
  killNodeIds: [],
  thirdPartyLatencyMs: 0,
  ...patch,
});

/** Client at 100 rps → API → Postgres, with a named read flow over all three. */
function straightLine(overrides: { api?: NodeAttrs; db?: NodeAttrs } = {}): GraphDSL {
  return {
    nodes: [
      node('web', 'client', { trafficRps: 100 }),
      node('api', 'service', { concurrency: 200, latencyMs: 40, ...overrides.api }),
      node('db', 'sql_db', { capacityRps: 3000, latencyMs: 8, ...overrides.db }),
    ],
    edges: [edge('web', 'api'), edge('api', 'db')],
    stickies: [],
    flows: [
      { id: 'f1', name: 'read path', kind: 'read', steps: ['web', 'api', 'db'], rps: 100, description: '' },
    ],
  };
}

const nodeResult = (result: ReturnType<typeof simulate>, id: string) =>
  result.nodes.find((n) => n.nodeId === id)!;

describe('a design that copes', () => {
  const result = simulate(straightLine(), config());

  it('drops nothing and leaves every component ok', () => {
    expect(result.totalDroppedRps).toBe(0);
    for (const n of result.nodes) expect(n.state).toBe('ok');
  });

  it('adds up the latency of the hops a flow names', () => {
    const flow = result.flows[0]!;
    // 40ms at the API and 8ms at the database, both nearly idle.
    expect(flow.p50Ms).toBeGreaterThanOrEqual(48);
    expect(flow.p50Ms).toBeLessThan(56);
    expect(flow.completedRps).toBeCloseTo(100, 0);
    expect(flow.broken).toBe(false);
  });

  it('says what it holds and what is closest to its limit', () => {
    expect(result.verdict).toContain('Holds 100 rps');
    expect(result.verdict).toMatch(/closest to its limit/);
  });
});

describe('a design that does not', () => {
  const result = simulate(straightLine({ api: { capacityRps: 200 } }), config({ rpsMultiplier: 10 }));

  it('names the bottleneck and reports the loss', () => {
    expect(result.bottleneckNodeId).toBe('api');
    expect(result.totalDroppedRps).toBeGreaterThan(0);
    expect(nodeResult(result, 'api').state).toBe('saturated');
  });

  it('reduces what the flow completes, and says where it gave way', () => {
    const flow = result.flows[0]!;
    expect(flow.offeredRps).toBeCloseTo(1000, 0);
    expect(flow.completedRps).toBeLessThan(300);
    expect(flow.brokenAt).toBe('api');
  });

  it('leads the verdict with the loss and the cause', () => {
    expect(result.verdict).toMatch(/loses \d+% of requests/);
    expect(result.verdict).toContain('gives way at api');
  });
});

describe('caches', () => {
  const cached = (hitRate: number, dbCapacity = 3000): GraphDSL => ({
    nodes: [
      node('web', 'client', { trafficRps: 1000 }),
      node('api', 'service', { concurrency: 100_000 }),
      node('cache', 'cache', { cacheHitRate: hitRate, capacityRps: 100_000 }),
      node('db', 'sql_db', { capacityRps: dbCapacity }),
    ],
    edges: [edge('web', 'api'), edge('api', 'cache'), edge('cache', 'db')],
    stickies: [],
    flows: [
      { id: 'f1', name: 'reads', kind: 'read', steps: ['web', 'api', 'cache', 'db'], rps: 1000, description: '' },
    ],
  });

  it('passes only the misses to the store behind them', () => {
    expect(nodeResult(simulate(cached(0.8), config()), 'db').incomingRps).toBeCloseTo(200, 0);
  });

  it('a dead cache degrades the design instead of killing it', () => {
    // The lesson worth keeping from the old model: cache death is a database
    // problem, not a read outage.
    const result = simulate(cached(0.8), config({ killNodeIds: ['cache'] }));

    expect(nodeResult(result, 'db').incomingRps).toBeCloseTo(1000, 0);
    expect(result.flows[0]!.broken).toBe(false);
    expect(result.flows[0]!.notes.join(' ')).toContain('offline but transparent');
  });

  it('and kills it when what follows cannot take the herd', () => {
    const result = simulate(cached(0.8, 50), config({ killNodeIds: ['cache'] }));
    expect(result.flows[0]!.completedRps).toBeLessThan(100);
    expect(result.flows[0]!.brokenAt).toBe('db');
  });
});

describe('failing over', () => {
  const replicated = (): GraphDSL => ({
    nodes: [
      node('web', 'client', { trafficRps: 500 }),
      node('api', 'service', { concurrency: 100_000 }),
      node('primary', 'sql_db', { capacityRps: 2000 }),
      node('replica', 'read_replica', { capacityRps: 2000 }),
    ],
    edges: [
      edge('web', 'api'),
      // Half the reads each, which is what a read/write split looks like when it is
      // drawn rather than guessed at.
      edge('api', 'primary', { share: 0.5 }),
      edge('api', 'replica', { share: 0.5 }),
      edge('primary', 'replica', { kind: 'replication' }),
    ],
    stickies: [],
    flows: [],
  });

  it('splits reads where the shares say', () => {
    const result = simulate(replicated(), config());
    expect(nodeResult(result, 'primary').incomingRps).toBeCloseTo(250, 0);
    expect(nodeResult(result, 'replica').incomingRps).toBeCloseTo(250, 0);
  });

  it('sends a dead replica’s share to the primary rather than onto the floor', () => {
    const result = simulate(replicated(), config({ killNodeIds: ['replica'] }));
    expect(nodeResult(result, 'primary').incomingRps).toBeCloseTo(500, 0);
    expect(result.totalDroppedRps).toBe(0);
  });

  it('does the same in reverse when the primary is the one that dies', () => {
    const result = simulate(replicated(), config({ killNodeIds: ['primary'] }));
    expect(nodeResult(result, 'replica').incomingRps).toBeCloseTo(500, 0);
  });
});

describe('scenarios that name components the way a person would', () => {
  it('kills by label as well as by id', () => {
    const graph = straightLine();
    graph.nodes[2] = { ...graph.nodes[2]!, id: 'n7', label: 'Postgres' };
    graph.edges[1] = edge('api', 'n7');
    graph.flows[0]!.steps = ['web', 'api', 'n7'];

    // A gate that silently killed nothing would pass every design.
    const byLabel = simulate(graph, config({ killNodeIds: ['Postgres'] }));
    const byId = simulate(graph, config({ killNodeIds: ['n7'] }));

    expect(nodeResult(byLabel, 'n7').state).toBe('down');
    expect(byLabel.flows[0]!.broken).toBe(true);
    expect(byLabel.verdict).toBe(byId.verdict);
  });

  it('is case-insensitive about it', () => {
    expect(nodeResult(simulate(straightLine(), config({ killNodeIds: ['DB'] })), 'db').state).toBe('down');
  });
});

describe('queues', () => {
  const queued = (depthMax: number): GraphDSL => ({
    nodes: [
      node('web', 'client', { trafficRps: 500 }),
      node('q', 'queue', { capacityRps: 50, queueDepthMax: depthMax }),
      node('worker', 'worker', { capacityRps: 50 }),
    ],
    edges: [edge('web', 'q', { kind: 'async' }), edge('q', 'worker')],
    stickies: [],
    flows: [],
  });

  it('builds a backlog when consumers cannot keep up, and says whose fault it is', () => {
    const result = simulate(queued(1_000_000), config());
    expect(nodeResult(result, 'q').queueDepth).toBeGreaterThan(0);
    expect(result.findings.join(' ')).toContain('consumers drain');
  });

  it('sheds once the backlog runs out of room', () => {
    expect(nodeResult(simulate(queued(10), config()), 'q').droppedRps).toBeGreaterThan(0);
  });
});

describe('findings', () => {
  it('flags a component every path has to cross', () => {
    const graph: GraphDSL = {
      nodes: [
        node('web', 'client', { trafficRps: 100 }),
        node('gw', 'api_gateway', { capacityRps: 100_000 }),
        node('a', 'service', { concurrency: 100_000 }),
        node('b', 'service', { concurrency: 100_000 }),
      ],
      edges: [edge('web', 'gw'), edge('gw', 'a'), edge('gw', 'b')],
      stickies: [],
      flows: [],
    };
    expect(simulate(graph, config()).findings.join(' ')).toContain('Every path crosses gw');
  });

  it('flags a store taking every read with nothing in front of it', () => {
    expect(simulate(straightLine(), config()).findings.join(' ')).toContain(
      'nothing absorbs reads in front of it',
    );
  });

  it('flags state kept in one zone, and stops when it is spread', () => {
    expect(simulate(straightLine(), config()).findings.join(' ')).toContain(
      'holds state in one place',
    );
    const spread = simulate(straightLine({ db: { multiAz: true, capacityRps: 3000 } }), config());
    expect(spread.findings.join(' ')).not.toContain('holds state in one place');
  });

  it('names the first thing to lose traffic, not the worst-looking one', () => {
    const graph = straightLine({ api: { capacityRps: 300 }, db: { capacityRps: 10 } });
    const result = simulate(graph, config({ rpsMultiplier: 10 }));

    expect(result.findings[0]).toContain('First loss');
    expect(result.findings[0]).toContain('api');
    expect(result.findings.join(' ')).toContain('only seeing what got past');
  });

  it('flags retries turning one request into several attempts', () => {
    const graph = straightLine({ api: { concurrency: 100_000 }, db: { capacityRps: 100 } });
    graph.edges[1] = edge('api', 'db', { retries: 3 });
    expect(simulate(graph, config({ rpsMultiplier: 5 })).findings.join(' ')).toContain('attempts');
  });

  it('says so when it had to guess where traffic starts', () => {
    // A fragment with no client. Rather than refuse, the engine treats the thing
    // nothing points into as the entry point — and the report puts that in writing,
    // so a reader who disagrees can see a choice was made for them.
    const graph: GraphDSL = {
      nodes: [node('api', 'service'), node('db', 'sql_db')],
      edges: [edge('api', 'db')],
      stickies: [],
      flows: [],
    };
    const result = simulate(graph, config());

    expect(result.findings[0]).toContain('Nothing states where traffic starts');
    expect(result.findings[0]).toContain('api');
    expect(result.findings[0]).toContain('Set a request rate');
  });

  it('keeps a third-party brownout on the components you do not run', () => {
    const graph: GraphDSL = {
      nodes: [
        node('web', 'client', { trafficRps: 10 }),
        node('api', 'service', { concurrency: 100_000, latencyMs: 20 }),
        node('psp', 'payment_gateway', { capacityRps: 1000, latencyMs: 100, timeoutMs: 30_000 }),
      ],
      edges: [edge('web', 'api'), edge('api', 'psp')],
      stickies: [],
      flows: [],
    };

    const calm = simulate(graph, config());
    const brownout = simulate(graph, config({ thirdPartyLatencyMs: 2000 }));

    expect(nodeResult(brownout, 'psp').latencyMs).toBeGreaterThan(
      nodeResult(calm, 'psp').latencyMs + 1900,
    );
    // The service's own work is untouched: only the dependency got slower.
    expect(nodeResult(brownout, 'api').latencyMs).toBeCloseTo(nodeResult(calm, 'api').latencyMs, 0);
  });
});

describe('flows without an author', () => {
  it('reports the paths it derived when nobody wrote any down', () => {
    const graph = straightLine();
    graph.flows = [];
    const result = simulate(graph, config());

    expect(result.flows.length).toBe(1);
    expect(result.flows[0]!.name).toBe('web → api → db');
    expect(result.flows[0]!.completedRps).toBeCloseTo(100, 0);
  });

  it('notes a step that names something not in the drawing', () => {
    const graph = straightLine();
    graph.flows[0]!.steps = ['web', 'ghost', 'db'];
    expect(simulate(graph, config()).flows[0]!.notes.join(' ')).toContain('not in the drawing');
  });
});

describe('degenerate input', () => {
  it('handles a graph with nothing in it', () => {
    const result = simulate({ nodes: [], edges: [], stickies: [], flows: [] }, config());
    expect(result.nodes).toEqual([]);
    expect(result.flows).toEqual([]);
    expect(result.monthlyCost).toBe(0);
    expect(result.bottleneckNodeId).toBeNull();
  });

  it('handles a flow with no steps', () => {
    const graph = straightLine();
    graph.flows[0]!.steps = [];
    expect(() => simulate(graph, config())).not.toThrow();
    expect(simulate(graph, config()).flows[0]!.offeredRps).toBe(0);
  });

  it('leaves the graph it was given alone', () => {
    const graph = straightLine();
    const before = JSON.stringify(graph);
    simulate(graph, config({ rpsMultiplier: 20, killNodeIds: ['api'] }));
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('gives the same report twice', () => {
    const graph = straightLine();
    expect(JSON.stringify(simulate(graph, config({ rpsMultiplier: 7 })))).toBe(
      JSON.stringify(simulate(graph, config({ rpsMultiplier: 7 }))),
    );
  });
});

describe('cost, until it is calculated properly', () => {
  it('still sums the catalogue’s per-replica cost across replicas', () => {
    const four = simulate(straightLine({ api: { replicas: 4, concurrency: 200 } }), config());
    expect(four.monthlyCost).toBeGreaterThan(simulate(straightLine(), config()).monthlyCost);
  });
});

describe('the catalogue', () => {
  it('never constrains a boundary', () => {
    expect(DEFAULT_CAPACITY.group).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the timeline', () => {
  /** A tier that can be overwhelmed, and a database behind it. */
  const graph = (attrs: Record<string, unknown> = {}): GraphDSL => ({
    nodes: [
      { id: 'c', type: 'client', label: 'Users', annotation: '', attrs: { trafficRps: 200 } },
      { id: 'w', type: 'service', label: 'Web', annotation: '', attrs: { replicas: 2, vcpu: 2, latencyMs: 40, ...attrs } },
      { id: 'db', type: 'sql_db', label: 'Postgres', annotation: '', attrs: { latencyMs: 10, vcpu: 8 } },
    ],
    edges: [
      { id: 'e1', from: 'c', to: 'w', kind: 'sync', label: '' },
      { id: 'e2', from: 'w', to: 'db', kind: 'sync', label: '' },
    ],
    stickies: [],
    flows: [{ id: 'f1', name: 'read', kind: 'read', steps: ['c', 'w', 'db'], rps: 200, description: '' }],
  });

  const run = (config: Partial<SimConfig>) =>
    simulate(graph(), { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0, ...config }).timeline!;

  it('reports one point per second of the run', () => {
    const t = run({});
    expect(t.points).toHaveLength(t.horizonS);
    expect(t.points[0]!.t).toBe(0);
    expect(t.points.at(-1)!.t).toBe(t.horizonS - 1);
  });

  it('is healthy before an outage and broken after it, so the moment is visible', () => {
    const t = run({ killNodeIds: ['Postgres'] });
    // Killing at second zero made every number a post-failure number and the whole
    // series a flat line — there was no before to compare the after against.
    const before = t.points[OUTAGE_AT_S - 5]!;
    const after = t.points[OUTAGE_AT_S + 5]!;
    expect(before.completedRps).toBeGreaterThan(0);
    expect(after.completedRps).toBeLessThan(before.completedRps);
    expect(t.failures.some((f) => f.nodeId === 'db' && f.atS === OUTAGE_AT_S)).toBe(true);
  });

  it('names the first thing to break, which is not always the thing that looks broken', () => {
    const t = run({ rpsMultiplier: 8 });
    expect(t.firstFailure).not.toBeNull();
    // The web tier saturates; the database behind it never sees the traffic.
    expect(t.firstFailure!.nodeId).toBe('w');
    expect(t.firstFailure!.reason).toContain('Web');
  });

  it('shows an autoscaling group closing the gap it opened', () => {
    const scaling = simulate(
      graph({ autoscaleMin: 2, autoscaleMax: 40 }),
      { rpsMultiplier: 6, killNodeIds: [], thirdPartyLatencyMs: 0 },
    ).timeline!;
    const early = scaling.points[2]!;
    const late = scaling.points.at(-1)!;
    // Capacity arrives a minute late, and the point of a timeline is that you can see
    // who paid for that minute.
    expect(early.completedRps).toBeLessThan(early.offeredRps);
    expect(late.completedRps).toBeGreaterThan(early.completedRps);
  });

  it('keeps a fixed ceiling failing all the way to the end', () => {
    const pinned = simulate(
      graph({ capacityRps: 50, autoscaleMax: 2 }),
      { rpsMultiplier: 6, killNodeIds: [], thirdPartyLatencyMs: 0 },
    ).timeline!;
    const late = pinned.points.at(-1)!;
    expect(late.completedRps).toBeLessThan(late.offeredRps * 0.9);
  });

  it('rounds, because nobody reads a request rate to fifteen decimal places', () => {
    for (const p of run({ rpsMultiplier: 3 }).points) {
      expect(p.offeredRps).toBe(Math.round(p.offeredRps * 100) / 100);
      expect(p.successRate).toBe(Math.round(p.successRate * 1000) / 1000);
    }
  });
});

describe('degrading one named component', () => {
  /** A cart that calls pricing, which is a service this team runs. */
  const graph: GraphDSL = {
    nodes: [
      { id: 'c', type: 'client', label: 'App', annotation: '', attrs: { trafficRps: 200 } },
      { id: 'cart', type: 'service', label: 'Cart Service', annotation: '', attrs: { replicas: 6, vcpu: 2, latencyMs: 25, concurrency: 48 } },
      { id: 'pri', type: 'service', label: 'Pricing Service', annotation: '', attrs: { replicas: 6, vcpu: 4, latencyMs: 40, concurrency: 30 } },
      { id: 'ext', type: 'third_party', label: 'Tax API', annotation: '', attrs: { latencyMs: 100, elastic: true } },
    ],
    edges: [
      { id: 'e1', from: 'c', to: 'cart', kind: 'sync', label: '' },
      { id: 'e2', from: 'cart', to: 'pri', kind: 'sync', label: '' },
      { id: 'e3', from: 'cart', to: 'ext', kind: 'sync', label: '' },
    ],
    stickies: [],
    flows: [{ id: 'f1', name: 'price a cart', kind: 'read', steps: ['c', 'cart', 'pri'], rps: 200, description: '' }],
  };

  const worstP99 = (config: Partial<SimConfig>) =>
    Math.max(
      ...simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0, ...config }).flows.map(
        (f) => f.p99Ms,
      ),
    );

  it('slows an internal dependency, which thirdPartyLatencyMs could never reach', () => {
    const baseline = worstP99({});
    // The bug this exists for: a scenario written as "pricing degrades to 600ms" used
    // thirdPartyLatencyMs, which only touches components you call and do not run — so
    // once pricing was drawn as an internal service the scenario tested nothing.
    expect(worstP99({ thirdPartyLatencyMs: 560 })).toBeCloseTo(baseline, 0);
    expect(worstP99({ degradations: [{ node: 'Pricing Service', addMs: 560 }] })).toBeGreaterThan(
      baseline * 2,
    );
  });

  it('takes a multiple against the service time the component actually has', () => {
    // 40ms × 15 is 600ms, which is what the author means by "from 40ms to 600ms".
    const byMultiple = worstP99({ degradations: [{ node: 'Pricing Service', latencyMultiple: 15 }] });
    const byMillis = worstP99({ degradations: [{ node: 'Pricing Service', addMs: 560 }] });
    expect(byMultiple).toBeCloseTo(byMillis, 0);
  });

  it('finds a component by label or by id, the way a kill does', () => {
    const byLabel = worstP99({ degradations: [{ node: 'Pricing Service', addMs: 500 }] });
    const byId = worstP99({ degradations: [{ node: 'pri', addMs: 500 }] });
    expect(byId).toBeCloseTo(byLabel, 0);
  });

  it('shrinks capacity, which is what a hot partition does', () => {
    const before = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
    const squeezed = simulate(graph, {
      rpsMultiplier: 1,
      killNodeIds: [],
      thirdPartyLatencyMs: 0,
      // Six replicas holding thirty requests each at 40ms is 4,500 rps; a multiple has
      // to be small enough to fall under the 200 offered, and my first attempt at this
      // test used 0.05, which is 225 — comfortably above it, and it passed nothing.
      degradations: [{ node: 'Pricing Service', capacityMultiple: 0.01 }],
    });
    const capacityOf = (r: typeof before) => r.nodes.find((n) => n.nodeId === 'pri')!.capacityRps;
    expect(capacityOf(squeezed)).toBeLessThan(capacityOf(before) / 50);
    expect(squeezed.totalDroppedRps).toBeGreaterThan(0);
  });

  it('reports what it could not find rather than silently doing nothing', () => {
    expect(unmatchedDegradations(graph, [{ node: 'Cassandra', addMs: 100 }])).toEqual(['Cassandra']);
    expect(unmatchedDegradations(graph, [{ node: 'Pricing Service', addMs: 100 }])).toEqual([]);
  });

  it('ignores a degradation naming nothing, instead of throwing', () => {
    const baseline = worstP99({});
    expect(worstP99({ degradations: [{ node: 'nowhere', addMs: 5000 }] })).toBeCloseTo(baseline, 0);
  });

  it('leaves the run healthy until the degradation lands', () => {
    const t = simulate(graph, {
      rpsMultiplier: 1,
      killNodeIds: [],
      thirdPartyLatencyMs: 0,
      degradations: [{ node: 'Pricing Service', addMs: 2000 }],
    }).timeline!;
    expect(t.points[OUTAGE_AT_S - 5]!.p99Ms).toBeLessThan(t.points[OUTAGE_AT_S + 5]!.p99Ms);
  });
});
