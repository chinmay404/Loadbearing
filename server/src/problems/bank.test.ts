import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@archdojo/shared';
import { PROBLEM_BANK, PROBLEM_BY_ID } from './bank.js';
import { auditSeedProblem, validateProblem } from './validate.js';

describe('problem bank', () => {
  it('has 25 problems with unique ids and the intended level spread', () => {
    expect(PROBLEM_BANK).toHaveLength(25);
    expect(new Set(PROBLEM_BANK.map((p) => p.id)).size).toBe(25);
    const byLevel = PROBLEM_BANK.reduce<Record<number, number>>((acc, p) => {
      acc[p.level] = (acc[p.level] ?? 0) + 1;
      return acc;
    }, {});
    expect(byLevel).toEqual({ 1: 4, 2: 4, 3: 5, 4: 5, 5: 4, 6: 3 });
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
