import { describe, expect, it } from 'vitest';
import { CONCEPTS, docFromBlueprint, graphFromDoc, layoutDiagram } from '@loadbearing/shared';
import { PROBLEM_BANK, PROBLEM_BY_ID } from './bank.js';
import { auditSeedProblem, validateProblem } from './validate.js';

describe('problem bank', () => {
  it('has 44 sheets with unique ids and the intended level spread', () => {
    expect(PROBLEM_BANK).toHaveLength(44);
    expect(new Set(PROBLEM_BANK.map((p) => p.id)).size).toBe(44);
    const byLevel = PROBLEM_BANK.reduce<Record<number, number>>((acc, p) => {
      acc[p.level] = (acc[p.level] ?? 0) + 1;
      return acc;
    }, {});
    expect(byLevel).toEqual({ 1: 7, 2: 6, 3: 7, 4: 9, 5: 8, 6: 7 });
  });

  it('carries 9 labs, every one of them at a different starting point', () => {
    const labs = PROBLEM_BANK.filter((p) => p.kind === 'lab');
    expect(labs).toHaveLength(9);
    for (const lab of labs) expect(lab.diagram, `${lab.id} has no architecture`).toBeDefined();
    // Spread across the levels rather than clustered at the easy end.
    expect(new Set(labs.map((l) => l.level)).size).toBeGreaterThanOrEqual(5);
  });

  it('lays every diagram out without overlapping boxes, because a lab becomes a real sheet', () => {
    for (const lab of PROBLEM_BANK.filter((p) => p.diagram)) {
      const layout = layoutDiagram(lab.diagram!);
      const solid = layout.boxes.filter((b) => !b.group);
      for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i]!;
          const b = solid[j]!;
          const overlaps =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlaps, `${lab.id}: "${a.key}" sits on top of "${b.key}"`).toBe(false);
        }
      }
    }
  });

  /**
   * A gate that names something not on the sheet kills nothing, slows nothing, and
   * passes every design. That is worse than having no gate, because it reports a pass.
   *
   * Only labs can be checked this way — a blank sheet has no components yet, and its
   * scenarios name what the author HOPES you draw. A lab ships the architecture, so
   * every name in its own scenarios must resolve against it.
   */
  it('has no lab scenario that names a component the lab does not contain', () => {
    const misses: string[] = [];
    for (const lab of PROBLEM_BANK.filter((p) => p.kind === 'lab' && p.diagram)) {
      // Against the PLACED graph, not the authored keys. The first version of this
      // test compared scenario names to diagram keys and passed while the gate it was
      // checking killed nothing, because placing rewrites keys into node ids and the
      // resolver matches ids and labels. A test that checks a different string from
      // the one the code checks is worse than no test.
      const placed = graphFromDoc(docFromBlueprint(lab.diagram!));
      const names = new Set(placed.nodes.flatMap((n) => [n.id.toLowerCase(), n.label.toLowerCase()]));
      for (const s of lab.scenarios) {
        // A kill list may name alternatives — "redis" OR "cache" — so at least one
        // has to land, not all of them.
        if (s.killNodes?.length && !s.killNodes.some((k) => names.has(k.toLowerCase()))) {
          misses.push(`${lab.id}/${s.id}: kills ${s.killNodes.join(' or ')}, none of which is on the sheet`);
        }
        for (const d of s.degrade ?? []) {
          if (!names.has(d.node.toLowerCase())) {
            misses.push(`${lab.id}/${s.id}: degrades "${d.node}", which is not on the sheet`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('every problem meets the seed-content bar', () => {
    const issues = PROBLEM_BANK.flatMap(auditSeedProblem);
    expect(issues).toEqual([]);
  });

  it('uses only known concept ids and covers most of the taxonomy', () => {
    const used = new Set(PROBLEM_BANK.flatMap((p) => p.concepts));
    for (const c of used) expect(CONCEPTS).toContain(c);
    expect(used.size).toBeGreaterThanOrEqual(40);
  });

  it('PROBLEM_BY_ID resolves every problem', () => {
    for (const p of PROBLEM_BANK) expect(PROBLEM_BY_ID[p.id]).toBe(p);
  });

  it('seed problems survive the generated-problem validator', () => {
    for (const p of PROBLEM_BANK) {
      const round = validateProblem(JSON.parse(JSON.stringify(p)));
      expect(round.id).toBe(p.id);
      expect(round.concepts).toEqual(p.concepts);
    }
  });
});
