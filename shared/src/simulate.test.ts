import { describe, expect, it } from 'vitest';

import { DEFAULT_CAPACITY, simulate } from './simulate.js';
import type { ArchNodeType, Flow, GraphDSL, GraphEdge, GraphNode, NodeAttrs, SimConfig } from './types.js';

// ---------------------------------------------------------------- builders ---

function node(
  id: string,
  type: ArchNodeType,
  label = id,
  attrs?: NodeAttrs,
): GraphNode {
  return { id, type, label, annotation: '', ...(attrs ? { attrs } : {}) };
}

function edge(from: string, to: string, kind: GraphEdge['kind'] = 'sync'): GraphEdge {
  return { id: `${from}->${to}:${kind}`, from, to, kind, label: '' };
}

function flow(id: string, steps: string[], rps: number, kind: Flow['kind'] = 'read'): Flow {
  return { id, name: id, kind, steps, rps, description: '' };
}

function graph(partial: Partial<GraphDSL>): GraphDSL {
  return { nodes: [], edges: [], stickies: [], flows: [], ...partial };
}

function cfg(partial: Partial<SimConfig> = {}): SimConfig {
  return { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0, ...partial };
}

function nodeOf(result: ReturnType<typeof simulate>, id: string) {
  const found = result.nodes.find((n) => n.nodeId === id);
  if (!found) throw new Error(`no node result for ${id}`);
  return found;
}

// A comfortable read path: LB -> API -> Postgres, well under capacity.
function straightLine(): GraphDSL {
  return graph({
    nodes: [
      node('lb', 'load_balancer', 'Edge LB'),
      node('api', 'service', 'API service', { replicas: 4 }), // 2000 rps
      node('db', 'sql_db', 'Postgres primary'), // 3000 rps
    ],
    edges: [edge('lb', 'api'), edge('api', 'db')],
    flows: [flow('read', ['lb', 'api', 'db'], 100)],
  });
}

// ---------------------------------------------------------------- tests ------

describe('simulate — healthy straight line', () => {
  it('drops nothing, keeps every node ok, and p50 is the sum of node latencies', () => {
    const result = simulate(straightLine(), cfg());

    expect(result.totalDroppedRps).toBe(0);
    for (const n of result.nodes) {
      expect(n.state).toBe('ok');
      expect(n.droppedRps).toBe(0);
      expect(n.incomingRps).toBe(100);
    }

    const only = result.flows[0]!;
    expect(only.broken).toBe(false);
    expect(only.brokenAt).toBeUndefined();
    expect(only.offeredRps).toBe(100);
    expect(only.completedRps).toBeCloseTo(100, 6);

    const pathLatency = ['lb', 'api', 'db']
      .map((id) => nodeOf(result, id).latencyMs)
      .reduce((a, b) => a + b, 0);
    expect(only.p50Ms).toBeCloseTo(pathLatency, 6);
    // No node is above the warn threshold here, so p99 is a flat 2.5x tail.
    // (Both values are rounded to 2dp on the way out, hence the 1dp tolerance.)
    expect(only.p99Ms).toBeCloseTo(only.p50Ms * 2.5, 1);

    // Bottleneck is still reported (highest finite utilization) even when healthy.
    expect(result.bottleneckNodeId).toBe('api'); // 100/2000 = 0.05 vs db 100/3000
    expect(result.verdict).toContain('Holds at baseline');
    expect(result.verdict).toContain('no flow degraded');
  });

  it('does not mutate its inputs', () => {
    const input = straightLine();
    const snapshot = JSON.stringify(input);
    simulate(input, cfg({ rpsMultiplier: 12, killNodeIds: ['db'] }));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is deterministic', () => {
    const a = simulate(straightLine(), cfg({ rpsMultiplier: 7 }));
    const b = simulate(straightLine(), cfg({ rpsMultiplier: 7 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('simulate — 10x overload', () => {
  it('names the bottleneck, drops traffic, and reduces flow completion', () => {
    const result = simulate(straightLine(), cfg({ rpsMultiplier: 10 }));

    // 1000 rps offered: api caps at 2000 (fine), db caps at 3000 (fine). Push harder.
    const hard = simulate(straightLine(), cfg({ rpsMultiplier: 100 })); // 10_000 rps
    expect(hard.bottleneckNodeId).toBe('api'); // 10000/2000 = 5x vs db 3.33x
    expect(nodeOf(hard, 'api').state).toBe('saturated');
    expect(nodeOf(hard, 'api').utilization).toBeCloseTo(5, 6);
    expect(nodeOf(hard, 'api').droppedRps).toBeCloseTo(8000, 6);
    expect(hard.totalDroppedRps).toBeGreaterThan(0);

    const hf = hard.flows[0]!;
    expect(hf.completedRps).toBeLessThan(hf.offeredRps);
    expect(hf.completedRps).toBeGreaterThan(0);
    expect(hf.notes.some((n) => /saturated at 5x capacity/.test(n))).toBe(true);
    expect(hard.verdict).toContain('API service');
    expect(hard.verdict).toContain('dropped');

    // Latency degrades under congestion even at 10x, where nothing drops yet.
    expect(result.totalDroppedRps).toBe(0);
    expect(result.flows[0]!.p50Ms).toBeGreaterThan(straightLine().nodes.length); // sanity
    expect(nodeOf(result, 'api').latencyMs).toBeGreaterThan(40); // base 40ms, now congested
    expect(nodeOf(hard, 'api').latencyMs).toBeCloseTo(40 * 20, 6); // capped at 20x
  });
});

describe('simulate — cache absorption', () => {
  it('passes only the 20% miss rate to the database and still completes the flow', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 20 }),
        node('redis', 'cache', 'Redis'),
        node('db', 'sql_db', 'Postgres'),
      ],
      edges: [edge('api', 'redis'), edge('redis', 'db')],
      flows: [flow('read', ['api', 'redis', 'db'], 1000)],
    });

    const result = simulate(g, cfg());
    expect(nodeOf(result, 'redis').incomingRps).toBeCloseTo(1000, 6);
    expect(nodeOf(result, 'db').incomingRps).toBeCloseTo(200, 6); // 20% miss
    // Cache hits are served, so the flow still completes ~everything.
    expect(result.flows[0]!.completedRps).toBeCloseTo(1000, 6);
    expect(result.flows[0]!.broken).toBe(false);
  });

  it('honours an explicit cacheHitRate', () => {
    const g = graph({
      nodes: [
        node('cdn', 'cdn', 'CDN', { cacheHitRate: 0.95 }),
        node('origin', 'service', 'Origin', { replicas: 10 }),
      ],
      edges: [edge('cdn', 'origin')],
      flows: [flow('read', ['cdn', 'origin'], 2000)],
    });
    const result = simulate(g, cfg());
    expect(nodeOf(result, 'origin').incomingRps).toBeCloseTo(100, 6);
  });
});

describe('simulate — chaos without redundancy', () => {
  it('marks the flow broken and sets brokenAt to the dead node label', () => {
    const result = simulate(straightLine(), cfg({ killNodeIds: ['db'] }));

    const dead = nodeOf(result, 'db');
    expect(dead.state).toBe('down');
    expect(dead.capacityRps).toBe(0);
    expect(dead.droppedRps).toBeCloseTo(100, 6);

    const f = result.flows[0]!;
    expect(f.broken).toBe(true);
    expect(f.brokenAt).toBe('Postgres primary');
    expect(f.completedRps).toBe(0);
    expect(f.notes.some((n) => n.includes('Postgres primary is down') && n.includes('no fallback'))).toBe(
      true,
    );
    expect(result.verdict).toContain('Postgres primary');
  });

  it('accepts a label in killNodeIds as well as an id', () => {
    const result = simulate(straightLine(), cfg({ killNodeIds: ['Postgres primary'] }));
    expect(nodeOf(result, 'db').state).toBe('down');
  });
});

describe('simulate — chaos with a same-type sibling', () => {
  it('survives through a replica and says so', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 10 }),
        node('db1', 'sql_db', 'Postgres primary'),
        node('db2', 'sql_db', 'Postgres replica'),
      ],
      edges: [edge('api', 'db1'), edge('api', 'db2'), edge('db1', 'db2', 'replication')],
      flows: [flow('read', ['api', 'db1'], 400)],
    });

    const result = simulate(g, cfg({ killNodeIds: ['db1'] }));
    const f = result.flows[0]!;

    expect(f.broken).toBe(false);
    expect(f.brokenAt).toBeUndefined();
    expect(f.notes.some((n) => /survived via Postgres replica \(redundant path\)/.test(n))).toBe(true);
    // Traffic was rerouted onto the survivor, not onto the corpse.
    expect(nodeOf(result, 'db2').incomingRps).toBeCloseTo(400, 6);
    expect(nodeOf(result, 'db1').incomingRps).toBe(0);
    expect(nodeOf(result, 'db1').state).toBe('down');
    // Survivor only lends half its capacity (1500 of 3000) — 400 rps still fits.
    expect(f.completedRps).toBeCloseTo(400, 6);
  });

  it('shares only half the survivor capacity, so a big flow is partially shed', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 40 }),
        node('db1', 'sql_db', 'Shard A'),
        node('db2', 'sql_db', 'Shard B'),
      ],
      edges: [edge('api', 'db1'), edge('api', 'db2'), edge('db1', 'db2', 'replication')],
      flows: [flow('read', ['api', 'db1'], 3000)],
    });
    const result = simulate(g, cfg({ killNodeIds: ['db1'] }));
    const f = result.flows[0]!;
    expect(f.broken).toBe(false);
    expect(f.completedRps).toBeCloseTo(1500, 6); // half of Shard B's 3000
    expect(f.notes.some((n) => n.includes('redundant path'))).toBe(true);
  });
});

describe('simulate — queue with a slow consumer', () => {
  it('builds queue depth and emits a backpressure finding', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 20 }),
        node('q', 'queue', 'Orders queue'),
        node('w', 'worker', 'Order worker'), // 300 rps
      ],
      edges: [edge('api', 'q'), edge('q', 'w', 'async')],
      flows: [flow('write', ['api', 'q'], 800, 'write')],
    });

    const result = simulate(g, cfg());
    const q = nodeOf(result, 'q');

    expect(q.incomingRps).toBeCloseTo(800, 6);
    expect(q.queueDepth).toBeGreaterThan(0);
    expect(q.queueDepth).toBeCloseTo((800 - 300) * 60, 0);
    expect(q.droppedRps).toBe(0); // still inside queueDepthMax: it buffers, it does not shed
    expect(result.findings.some((f) => f.includes('Orders queue') && f.includes('backpressure'))).toBe(
      true,
    );
  });

  it('sheds once the backlog passes queueDepthMax', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 20 }),
        node('q', 'queue', 'Orders queue', { queueDepthMax: 6000 }),
        node('w', 'worker', 'Order worker'),
      ],
      edges: [edge('api', 'q'), edge('q', 'w', 'async')],
      flows: [flow('write', ['api', 'q'], 800, 'write')],
    });
    const result = simulate(g, cfg());
    const q = nodeOf(result, 'q');
    expect(q.droppedRps).toBeCloseTo((30000 - 6000) / 60, 6);
    expect(q.state).toBe('saturated');
  });

  it('treats a queue with no async consumer as fully un-drained', () => {
    const g = graph({
      nodes: [node('q', 'queue', 'Events'), node('w', 'worker', 'Worker')],
      edges: [edge('q', 'w', 'sync')], // sync edge: not a consumer
      flows: [flow('async', ['q'], 50, 'async')],
    });
    const result = simulate(g, cfg());
    expect(nodeOf(result, 'q').queueDepth).toBeCloseTo(50 * 60, 0);
  });
});

describe('simulate — shared nodes', () => {
  it('sums incoming rps across flows', () => {
    const g = graph({
      nodes: [
        node('gw', 'api_gateway', 'Gateway'),
        node('api', 'service', 'API', { replicas: 10 }),
        node('db', 'sql_db', 'DB'),
      ],
      edges: [edge('gw', 'api'), edge('api', 'db')],
      flows: [
        flow('read', ['gw', 'api', 'db'], 300),
        flow('write', ['gw', 'api', 'db'], 200, 'write'),
        flow('admin', ['gw', 'api'], 50, 'admin'),
      ],
    });

    const result = simulate(g, cfg());
    expect(nodeOf(result, 'gw').incomingRps).toBeCloseTo(550, 6);
    expect(nodeOf(result, 'api').incomingRps).toBeCloseTo(550, 6);
    expect(nodeOf(result, 'db').incomingRps).toBeCloseTo(500, 6);
  });
});

describe('simulate — degenerate input', () => {
  it('handles an empty graph', () => {
    const result = simulate(graph({}), cfg());
    expect(result.nodes).toEqual([]);
    expect(result.flows).toEqual([]);
    expect(result.bottleneckNodeId).toBeNull();
    expect(result.totalDroppedRps).toBe(0);
    expect(result.monthlyCost).toBe(0);
    expect(result.verdict).toContain('no components');
    expect(result.findings).toEqual([]);
  });

  it('skips unknown step ids without throwing', () => {
    const g = graph({
      nodes: [node('api', 'service', 'API', { replicas: 10 })],
      edges: [],
      flows: [flow('read', ['ghost', 'api', 'phantom'], 100)],
    });
    const result = simulate(g, cfg());
    const f = result.flows[0]!;
    expect(f.notes.filter((n) => n.startsWith('Unknown step')).length).toBe(2);
    expect(f.completedRps).toBeCloseTo(100, 6);
    expect(f.broken).toBe(false);
  });

  it('handles a flow with no steps at all', () => {
    const g = graph({
      nodes: [node('api', 'service', 'API')],
      flows: [flow('empty', [], 100)],
    });
    const result = simulate(g, cfg());
    expect(result.flows[0]!.notes.some((n) => n.includes('no steps'))).toBe(true);
    expect(result.findings.some((f) => f.includes('has no steps'))).toBe(true);
  });

  it('handles zero rps and a zero multiplier', () => {
    const zero = simulate(straightLine(), cfg({ rpsMultiplier: 0 }));
    expect(zero.flows[0]!.broken).toBe(false);
    expect(zero.flows[0]!.completedRps).toBe(0);
    expect(zero.bottleneckNodeId).toBeNull();
    expect(zero.totalDroppedRps).toBe(0);
  });

  it('treats clients and groups as infinite capacity', () => {
    const g = graph({
      nodes: [node('u', 'client', 'Users'), node('api', 'service', 'API', { replicas: 100 })],
      edges: [edge('u', 'api')],
      flows: [flow('read', ['u', 'api'], 5000)],
    });
    const result = simulate(g, cfg());
    expect(nodeOf(result, 'u').capacityRps).toBe(Number.POSITIVE_INFINITY);
    expect(nodeOf(result, 'u').utilization).toBe(0);
    expect(nodeOf(result, 'u').state).toBe('ok');
    expect(DEFAULT_CAPACITY.group).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('simulate — teaching findings', () => {
  it('flags a single point of failure on every flow', () => {
    const g = graph({
      nodes: [
        node('lb', 'load_balancer', 'Edge LB'),
        node('mono', 'monolith', 'The monolith'),
      ],
      edges: [edge('lb', 'mono')],
      flows: [flow('read', ['lb', 'mono'], 10), flow('write', ['lb', 'mono'], 10, 'write')],
    });
    const result = simulate(g, cfg());
    expect(result.findings.some((f) => f.includes('The monolith') && f.includes('single point of failure'))).toBe(
      true,
    );
  });

  it('flags a saturated database with no cache in front of it', () => {
    const result = simulate(straightLine(), cfg({ rpsMultiplier: 100 }));
    expect(
      result.findings.some((f) => f.includes('Postgres primary') && f.includes('no cache in front')),
    ).toBe(true);
  });

  it('flags a slow third-party call on a synchronous path and injects latency', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'Checkout API', { replicas: 10 }),
        node('psp', 'third_party', 'Stripe', { capacityRps: 10000 }),
      ],
      edges: [edge('api', 'psp')],
      flows: [flow('write', ['api', 'psp'], 100, 'write')],
    });
    const result = simulate(g, cfg({ thirdPartyLatencyMs: 500 }));
    expect(nodeOf(result, 'psp').latencyMs).toBeGreaterThanOrEqual(750); // 250 base + 500 injected
    expect(result.findings.some((f) => f.includes('Stripe') && f.includes('synchronous user path'))).toBe(
      true,
    );
  });

  it('flags single-AZ stateful storage and respects multiAz', () => {
    const single = simulate(straightLine(), cfg());
    expect(single.findings.some((f) => f.includes('single-AZ'))).toBe(true);

    const g = straightLine();
    const spread = graph({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'db' ? { ...n, attrs: { multiAz: true } } : n)),
    });
    expect(simulate(spread, cfg()).findings.some((f) => f.includes('single-AZ'))).toBe(false);
  });

  it('never returns more than 8 findings', () => {
    const g = graph({
      nodes: [
        node('lb', 'load_balancer', 'LB'),
        node('mono', 'monolith', 'Monolith'),
        node('db', 'sql_db', 'DB'),
        node('cache2', 'cache', 'Cache'),
        node('q', 'queue', 'Queue'),
        node('idx', 'search_index', 'Index'),
        node('psp', 'third_party', 'PSP'),
        node('llm', 'llm', 'LLM'),
        node('vec', 'vector_db', 'Vectors'),
      ],
      edges: [edge('q', 'mono', 'async')],
      flows: [
        flow('read', ['lb', 'mono', 'cache2', 'db', 'idx', 'vec', 'psp', 'llm', 'q'], 900),
        flow('empty', [], 10, 'admin'),
      ],
    });
    const result = simulate(g, cfg({ rpsMultiplier: 5 }));
    expect(result.findings.length).toBeLessThanOrEqual(8);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe('simulate — cost', () => {
  it('multiplies per-replica cost by replicas and honours overrides', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 3 }), // 60 * 3
        node('db', 'sql_db', 'DB', { monthlyCost: 500 }), // 500 * 1
      ],
    });
    expect(simulate(g, cfg()).monthlyCost).toBe(680);
  });
});

describe('cache death falls through instead of breaking the flow', () => {
  const graph: GraphDSL = {
    nodes: [
      { id: 'api', type: 'service', label: 'API', annotation: '', attrs: { capacityRps: 5000, replicas: 1 } },
      { id: 'cache', type: 'cache', label: 'Redis', annotation: '', attrs: { cacheHitRate: 0.9 } },
      { id: 'db', type: 'sql_db', label: 'Postgres', annotation: '', attrs: { capacityRps: 3000 } },
    ],
    edges: [
      { id: 'e1', from: 'api', to: 'cache', kind: 'sync', label: '' },
      { id: 'e2', from: 'api', to: 'db', kind: 'sync', label: '' },
    ],
    stickies: [],
    flows: [
      { id: 'f1', name: 'read', kind: 'read', steps: ['api', 'cache', 'db'], rps: 1000, description: '' },
    ],
  };

  it('with the cache alive, the database only sees the misses', () => {
    const r = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
    const db = r.nodes.find((n) => n.nodeId === 'db')!;
    expect(db.incomingRps).toBeCloseTo(100, 0);
    expect(r.flows[0]!.broken).toBe(false);
  });

  it('with the cache dead, the flow survives but the database takes the full herd', () => {
    const r = simulate(graph, { rpsMultiplier: 1, killNodeIds: ['cache'], thirdPartyLatencyMs: 0 });
    const flow = r.flows[0]!;
    const db = r.nodes.find((n) => n.nodeId === 'db')!;
    expect(db.incomingRps).toBeCloseTo(1000, 0);
    expect(flow.broken).toBe(false);
    expect(flow.notes.join(' ')).toMatch(/falls through/i);
  });

  it('a dead cache does break the flow when what follows cannot absorb the herd', () => {
    const small: GraphDSL = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'db' ? { ...n, attrs: { capacityRps: 5 } } : n)),
    };
    const r = simulate(small, { rpsMultiplier: 1, killNodeIds: ['cache'], thirdPartyLatencyMs: 0 });
    expect(r.flows[0]!.broken).toBe(true);
  });
});
