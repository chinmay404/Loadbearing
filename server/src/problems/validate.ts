import { CONCEPTS } from '@loadbearing/shared';
import type { LoadScenario, Problem } from '@loadbearing/shared';

const CONCEPT_SET = new Set<string>(CONCEPTS);

export class ProblemShapeError extends Error {
  constructor(public problems: string[]) {
    super(`Generated problem was unusable: ${problems.join('; ')}`);
    this.name = 'ProblemShapeError';
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

export function validateProblem(raw: unknown): Problem {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) throw new ProblemShapeError(['not an object']);
  const o = raw as Record<string, unknown>;

  const id = str(o.id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) problems.push('missing id');

  const levelNum = Math.round(Number(o.level));
  const level = (levelNum >= 1 && levelNum <= 6 ? levelNum : 3) as Problem['level'];

  const prompt = str(o.prompt).trim();
  if (prompt.length < 40) problems.push('prompt too short to be a real problem');

  const concepts = strArray(o.concepts).filter((c) => CONCEPT_SET.has(c));
  if (concepts.length === 0) problems.push('no valid concept ids');

  const functional = strArray(o.functional);
  if (functional.length === 0) problems.push('no functional requirements');

  const nonFunctional: Record<string, string | number> = {};
  const rawNf = (o.nonFunctional ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawNf)) {
    if (typeof v === 'number' || typeof v === 'string') nonFunctional[k] = v;
  }

  const twists = strArray(o.twists);
  if (twists.length === 0) problems.push('no twists');

  const scenarios: LoadScenario[] = (Array.isArray(o.scenarios) ? o.scenarios : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s, i) => {
      const mult = Number(s.rpsMultiplier);
      const latency = Number(s.thirdPartyLatencyMs);
      return {
        id: str(s.id, `scenario-${i + 1}`),
        name: str(s.name, `Scenario ${i + 1}`),
        description: str(s.description),
        rpsMultiplier: Number.isFinite(mult) && mult > 0 ? Math.min(mult, 1000) : 1,
        killNodes: strArray(s.killNodes),
        thirdPartyLatencyMs: Number.isFinite(latency) ? Math.max(0, Math.min(latency, 60000)) : 0,
        passCriteria: str(s.passCriteria),
      };
    });

  if (problems.length) throw new ProblemShapeError(problems);

  return {
    id,
    title: str(o.title, id),
    level,
    domain: str(o.domain, 'general'),
    prompt,
    functional,
    nonFunctional,
    constraints: strArray(o.constraints),
    concepts,
    expectedFlows: strArray(o.expectedFlows),
    rubricHints: str(o.rubricHints),
    twists,
    scenarios,
    custom: true,
  };
}

/** Used by the bank test: a stricter check for hand-written seed content. */
export function auditSeedProblem(p: Problem): string[] {
  const issues: string[] = [];
  if (!/^l[1-6]-[a-z0-9-]+$/.test(p.id)) issues.push(`${p.id}: id should look like l3-flash-sale`);
  if (!p.id.startsWith(`l${p.level}-`)) issues.push(`${p.id}: id prefix does not match level ${p.level}`);
  if (p.prompt.trim().length < 120) issues.push(`${p.id}: prompt is thin`);
  if (p.functional.length < 3) issues.push(`${p.id}: fewer than 3 functional requirements`);
  if (Object.keys(p.nonFunctional).length < 3) issues.push(`${p.id}: fewer than 3 non-functional numbers`);
  if (p.constraints.length < 2) issues.push(`${p.id}: fewer than 2 constraints`);
  if (p.concepts.length < 4) issues.push(`${p.id}: fewer than 4 rubric concepts`);
  for (const c of p.concepts) if (!CONCEPT_SET.has(c)) issues.push(`${p.id}: unknown concept "${c}"`);
  if (p.expectedFlows.length < 2) issues.push(`${p.id}: fewer than 2 expected flows`);
  if (p.rubricHints.trim().length < 80) issues.push(`${p.id}: rubricHints too vague`);
  if (p.twists.length < 2) issues.push(`${p.id}: fewer than 2 twists`);
  if (p.scenarios.length < 2) issues.push(`${p.id}: fewer than 2 load scenarios`);
  for (const s of p.scenarios) {
    if (!s.passCriteria.trim()) issues.push(`${p.id}/${s.id}: missing passCriteria`);
    if (!(s.rpsMultiplier > 0)) issues.push(`${p.id}/${s.id}: rpsMultiplier must be > 0`);
  }
  return issues;
}
