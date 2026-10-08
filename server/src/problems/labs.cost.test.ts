// What the labs cost when they are run, and whether the bill teaches the right lesson.
//
// A lab ships an architecture, and the cost meter sits in the corner of the canvas the
// moment it is loaded. A line that is wrong by a factor of a thousand is the first thing
// a learner reads, so these check the shape of the bill rather than exact dollars: the
// exact dollars are the calibration snapshot's job.

import { describe, expect, it } from 'vitest';
import { simulate, type GraphDSL, type Problem } from '@loadbearing/shared';
import { LABS } from './labs.js';

/** The same conversion the canvas does when a lab is loaded. */
function labGraph(lab: Problem): GraphDSL {
  const d = lab.diagram!;
  return {
    nodes: d.nodes.map((n) => ({
      id: n.key,
      type: n.type,
      label: n.label,
      annotation: n.annotation,
      ...(n.attrs ? { attrs: n.attrs } : {}),
    })),
    edges: d.edges.map((e, i) => ({
      id: `d${i}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? '',
    })),
    stickies: [],
    flows: d.flows.map((f, i) => ({ id: `f${i}`, ...f })),
  };
}

const RESOLVE_ONCE = new Set(['dns', 'geo_router']);

describe('what the labs cost at their own load', () => {
  it('prices the one-box storefront DNS at a few dollars, not hundreds', () => {
    // 900 rps through an A record used to be billed as 2.3 billion queries a month.
    // Browsers and resolvers cache the answer for its TTL; the authoritative server
    // sees a sliver of that.
    const lab = LABS.find((l) => l.id === 'l1-lab-one-box-storefront')!;
    const sim = simulate(labGraph(lab), { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
    const dns = sim.cost.lines.find((l) => l.nodeId === 'dns')!;
    expect(dns.totalUsd).toBeLessThan(5);
    expect(dns.totalUsd).toBeGreaterThan(0);
  });

  it('never lets name resolution dominate the bill in any lab', () => {
    for (const lab of LABS) {
      const graph = labGraph(lab);
      const sim = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
      const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
      for (const line of sim.cost.lines) {
        if (!RESOLVE_ONCE.has(types.get(line.nodeId)!)) continue;
        expect(line.totalUsd, `${lab.id}: ${line.label}`).toBeLessThan(sim.cost.totalUsd * 0.05);
      }
    }
  });
});
