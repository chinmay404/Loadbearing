// A frozen record of what the engine says today.
//
// This is not a correctness test. Nothing here claims the numbers are right —
// several of them are about to be proven wrong. It is a tripwire: the physics is
// being changed in four separate places, each change moves numbers all over the
// suite, and without a committed before-picture there is no way to tell a
// deliberate correction from a silent regression.
//
// Blueprints are the subject because they are the only fixtures that are complete
// designs with declared load, and because they are held to arriving un-broken —
// so a change that quietly breaks one shows up here first.

import { BLUEPRINTS, BLUEPRINT_BY_ID } from '../blueprints.js';
import { simulate } from '../simulate.js';
import type { GraphDSL } from '../types.js';

export interface BlueprintSnapshot {
  verdict: string;
  bottleneckNodeId: string | null;
  totalDroppedRps: number;
  monthlyCost: number;
  flows: {
    name: string;
    offeredRps: number;
    completedRps: number;
    p50Ms: number;
    p99Ms: number;
    broken: boolean;
  }[];
  nodes: {
    nodeId: string;
    utilization: number;
    latencyMs: number;
    capacityRps: number;
  }[];
}

export type Snapshot = Record<string, BlueprintSnapshot>;

/** The same conversion the client does when a blueprint is placed. */
export function blueprintGraph(id: string): GraphDSL {
  const b = BLUEPRINT_BY_ID[id]!;
  return {
    nodes: b.nodes.map((n) => ({
      id: n.key,
      type: n.type,
      label: n.label,
      annotation: n.annotation,
      ...(n.attrs ? { attrs: n.attrs } : {}),
    })),
    edges: b.edges.map((e, i) => ({
      id: `e${i}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? '',
    })),
    stickies: [],
    flows: b.flows.map((f, i) => ({
      id: `f${i}`,
      name: f.name,
      kind: f.kind,
      steps: f.steps,
      rps: f.rps,
      description: f.description,
    })),
  };
}

/**
 * Every blueprint at its own declared load, with nothing killed.
 *
 * Sorted at every level. A snapshot whose diff is dominated by reordering is a
 * snapshot nobody reads, and this one exists precisely to be read.
 */
export function snapshotAll(): Snapshot {
  const out: Snapshot = {};
  for (const b of [...BLUEPRINTS].sort((x, y) => x.id.localeCompare(y.id))) {
    const sim = simulate(blueprintGraph(b.id), {
      rpsMultiplier: 1,
      killNodeIds: [],
      thirdPartyLatencyMs: 0,
    });
    out[b.id] = {
      verdict: sim.verdict,
      bottleneckNodeId: sim.bottleneckNodeId,
      totalDroppedRps: sim.totalDroppedRps,
      monthlyCost: sim.monthlyCost,
      flows: sim.flows
        .map((f) => ({
          name: f.name,
          offeredRps: f.offeredRps,
          completedRps: f.completedRps,
          p50Ms: f.p50Ms,
          p99Ms: f.p99Ms,
          broken: f.broken,
        }))
        .sort((a, z) => a.name.localeCompare(z.name)),
      nodes: sim.nodes
        .map((n) => ({
          nodeId: n.nodeId,
          utilization: n.utilization,
          latencyMs: n.latencyMs,
          capacityRps: n.capacityRps,
        }))
        .sort((a, z) => a.nodeId.localeCompare(z.nodeId)),
    };
  }
  return out;
}
