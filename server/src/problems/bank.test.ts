import { describe, expect, it } from 'vitest';
import { CONCEPTS, layoutDiagram } from '@loadbearing/shared';
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
