// The preview and the Play result must run out at the same place.
//
// The flow engine answers with a capacity; the request engine shows where requests
// start piling up. For each runtime, the request engine must keep up at 95% of the
// flow engine's capacity and fall behind at 105% — the two models agree on the
// knee to within 5%. Service times are fixed in the request engine so the check is
// about the models, not about the request engine's spread (which, being log-normal,
// has a mean ~8% above the median the flow engine uses).

import { describe, expect, it } from 'vitest';
import { runEngine, steadyScenario, type Scenario } from '../engine.js';
import type { GraphDSL, GraphEdge, GraphNode, NodeAttrs } from '../types.js';
import { runDes } from './engine.js';

const node = (id: string, type: GraphNode['type'], attrs: NodeAttrs = {}): GraphNode => ({
  id,
  type,
  label: id,
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

const stack = (rps: number, app: NodeAttrs): GraphDSL => ({
  nodes: [
    node('web', 'client', { trafficRps: rps }),
    node('app', 'service', { vcpu: 1, ...app }),
    node('db', 'sql_db', { vcpu: 64, latencyMs: 1 }),
  ],
  edges: [edge('web', 'app'), edge('app', 'db')],
  stickies: [],
  flows: [],
});

const flowCapacity = (app: NodeAttrs): number => {
  const result = runEngine(stack(100, app), { ...steadyScenario(1), horizonS: 10 });
  return result.final.find((h) => h.nodeId === 'app')!.capacityRps;
};

const hold: Scenario = { id: 'agree', name: 'agree', horizonS: 30, loadMultiplier: 1 };
const keepsUp = (rps: number, app: NodeAttrs): boolean =>
  runDes(stack(Math.round(rps), app), hold, { seed: 1, warmupS: 5, service: { app: 'fixed', db: 'fixed' } })
    .completionRatio >= 0.99;

describe.each([
  ['an event loop (CPU binds)', { runtime: 'event-loop', cpuMs: 0.16, latencyMs: 0.41 }],
  ['a thread pool with few workers (workers bind)', { runtime: 'thread-pool', concurrency: 4, cpuMs: 0.16, latencyMs: 0.16 }],
  ['a thread pool with a stated CPU cost (CPU binds)', { runtime: 'thread-pool', concurrency: 64, cpuMs: 0.5, latencyMs: 1 }],
] as const)('flow and request engines agree on the knee: %s', (_, app) => {
  const capacity = flowCapacity(app);

  it('keeps up at 95% of the flow engine’s capacity', () => {
    expect(keepsUp(capacity * 0.95, app)).toBe(true);
  });

  it('falls behind at 105% of it', () => {
    expect(keepsUp(capacity * 1.05, app)).toBe(false);
  });
});
