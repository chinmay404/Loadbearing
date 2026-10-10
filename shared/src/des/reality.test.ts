// The reality baseline: the request engine against a real stack it has never been
// told the answer for (spec test 8, loadtest/RESULTS.md).
//
// The stack: nginx → Node (1 CPU) → Redis (80% hits) → Postgres, under k6. Measured:
// fine at 6,000 rps, failing from ~7,000 (99.2% ok at 7,000, 96% at 7,500), p99
// 5.4 ms at 3,000 rps.
//
// The drawing gets what a learner could measure without running the load test:
// the compose file's sizes, the idle probe's medians, and Node's CPU per request
// at LOW load (0.16 ms at 1,000 rps). It is never given capacityRps or the knee.
// CPU per request measured at 5,000 rps was ~0.18 ms (spec 1.1), which would put
// the knee near 5,550 — so this test passing says the 0.16 ms figure predicts the
// knee, not that CPU per request is a constant.

import { describe, expect, it } from 'vitest';
import type { GraphDSL, GraphEdge, GraphNode, NodeAttrs } from '../types.js';
import type { Scenario } from '../engine.js';
import { runDes } from './engine.js';

// Idle probe medians, ms (loadtest/results/probe-1.summary.json).
const MEASURED = { nginx: 0.8, app: 0.41, redis: 0.34, pg: 0.65 };
const NODE_CPU_MS_AT_LOW_LOAD = 0.16;

const node = (id: string, type: GraphNode['type'], label: string, attrs: NodeAttrs): GraphNode => ({
  id,
  type,
  label,
  annotation: '',
  attrs,
});
const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: 'sync',
  label: '',
  placement: 'same-host',
});

const stack = (rps: number): GraphDSL => ({
  nodes: [
    node('client', 'client', 'k6', { trafficRps: rps }),
    node('nginx', 'reverse_proxy', 'nginx', { vcpu: 1, memoryGb: 0.25, latencyMs: MEASURED.nginx }),
    node('app', 'service', 'Node', {
      vcpu: 1,
      memoryGb: 0.5,
      replicas: 1,
      timeoutMs: 1000,
      runtime: 'event-loop',
      cpuMs: NODE_CPU_MS_AT_LOW_LOAD,
      latencyMs: MEASURED.app,
    }),
    node('redis', 'cache', 'Redis', {
      vcpu: 0.5,
      memoryGb: 0.25,
      workingSetGb: 0.011,
      cacheHitRate: 0.8,
      latencyMs: MEASURED.redis,
    }),
    node('pg', 'sql_db', 'Postgres', {
      vcpu: 1,
      memoryGb: 1,
      poolSize: 10,
      maxConnections: 100,
      latencyMs: MEASURED.pg,
    }),
  ],
  edges: [edge('client', 'nginx'), edge('nginx', 'app'), edge('app', 'redis'), edge('redis', 'pg')],
  stickies: [],
  flows: [],
});

const hold: Scenario = { id: 'reality', name: 'reality', horizonS: 30, loadMultiplier: 1 };
const run = (rps: number) => runDes(stack(rps), hold, { seed: 1, warmupS: 5 });

describe('the request engine against the real stack (Node CPU from the low-load measurement)', () => {
  it('keeps up at 6,000 rps, as the real stack did', () => {
    expect(run(6000).completionRatio).toBeGreaterThanOrEqual(0.99);
  });

  it('falls behind by 7,500 rps, where the real stack was failing', () => {
    expect(run(7500).completionRatio).toBeLessThan(0.99);
  });

  it('runs out of Node CPU first — the right reason, not a coincidence of formulas', () => {
    const parts = run(7500).parts;
    const busiest = [...parts].sort((a, b) => b.utilization - a.utilization)[0]!;
    expect(busiest.nodeId).toBe('app');
    expect(busiest.utilization).toBeGreaterThan(0.97);
  });

  it('puts p99 at 3,000 rps within 2× of the measured 5.4 ms', () => {
    const p99 = run(3000).p99ResponseMs;
    expect(p99).toBeGreaterThan(5.4 / 2);
    expect(p99).toBeLessThan(5.4 * 2);
  });
});
