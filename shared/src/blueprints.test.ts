// A blueprint that does not simulate, or that references a component type or a
// concept that does not exist, is worse than no blueprint: it teaches the wrong
// thing and the numbers next to it are nonsense. These are structural checks over
// every blueprint, so adding one cannot quietly break that.

import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, BLUEPRINT_BY_ID, BLUEPRINT_FAMILIES } from './blueprints.js';
import { CONCEPTS } from './concepts.js';
import { ARCH_NODE_TYPES } from './types.js';
import type { GraphDSL } from './types.js';
import { simulate } from './simulate.js';
import { checkTopology } from './compatibility.js';

/** The same conversion the client does when a blueprint is placed. */
function toGraph(id: string): GraphDSL {
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

describe('blueprint integrity', () => {
  it('ids are unique and the index agrees with the list', () => {
    const ids = BLUEPRINTS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(BLUEPRINT_BY_ID).sort()).toEqual([...ids].sort());
  });

  for (const b of BLUEPRINTS) {
    describe(b.id, () => {
      it('uses only real component types', () => {
        const types = new Set<string>(ARCH_NODE_TYPES);
        for (const n of b.nodes) expect(types.has(n.type), `${n.key} is a ${n.type}`).toBe(true);
      });

      it('cites only real concepts, and belongs to a known family', () => {
        const concepts = new Set<string>(CONCEPTS);
        for (const c of b.concepts) expect(concepts.has(c), c).toBe(true);
        expect(BLUEPRINT_FAMILIES).toContain(b.family);
      });

      it('has unique node keys, and every edge joins two of them', () => {
        const keys = b.nodes.map((n) => n.key);
        expect(new Set(keys).size).toBe(keys.length);
        const known = new Set(keys);
        for (const e of b.edges) {
          expect(known.has(e.from), `edge from ${e.from}`).toBe(true);
          expect(known.has(e.to), `edge to ${e.to}`).toBe(true);
          expect(e.from).not.toBe(e.to);
        }
      });

      it('declares at least one flow, and every step exists', () => {
        expect(b.flows.length).toBeGreaterThan(0);
        const known = new Set(b.nodes.map((n) => n.key));
        for (const f of b.flows) {
          expect(f.steps.length).toBeGreaterThan(1);
          for (const s of f.steps) expect(known.has(s), `${f.name} step ${s}`).toBe(true);
        }
      });

      it("every flow's consecutive steps are actually connected", () => {
        // A flow that jumps between unconnected components is a drawing that
        // contradicts itself, and the simulator would route load through an edge
        // the learner cannot see.
        const linked = new Set(b.edges.flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
        for (const f of b.flows) {
          for (let i = 0; i < f.steps.length - 1; i += 1) {
            const pair = `${f.steps[i]}>${f.steps[i + 1]}`;
            expect(linked.has(pair), `${b.id}: ${f.name} hops ${pair} with no connection`).toBe(true);
          }
        }
      });

      it('every node carries a label, and non-client nodes explain themselves', () => {
        for (const n of b.nodes) {
          expect(n.label.trim().length, n.key).toBeGreaterThan(1);
          if (n.type !== 'client' && n.type !== 'mobile_client') {
            expect(n.annotation.trim().length, `${n.key} annotation`).toBeGreaterThan(25);
          }
        }
      });

      it('says what it leaves the learner to decide', () => {
        expect(b.decisions.length).toBeGreaterThanOrEqual(2);
        for (const d of b.decisions) expect(d.length).toBeGreaterThan(20);
      });

      it('simulates without throwing and carries its declared load', () => {
        const graph = toGraph(b.id);
        const result = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
        expect(result.flows.length).toBe(b.flows.length);
        // A starting position must not arrive already broken at its own numbers.
        for (const f of result.flows) expect(f.broken, `${f.name} broken as placed`).toBe(false);
      });

      it('has no orphan components — everything placed is wired in', () => {
        const findings = checkTopology(toGraph(b.id));
        const orphans = findings.filter((f) => f.rule === 'orphan-node');
        expect(orphans.map((o) => o.message)).toEqual([]);
      });
    });
  }
});
