import { describe, expect, it } from 'vitest';

import { evaluateAllScenarios, evaluateScenario, resolveKillIds } from './scenarios.js';
import type {
  ArchNodeType,
  Flow,
  GraphDSL,
  GraphEdge,
  GraphNode,
  LoadScenario,
  NodeAttrs,
  Problem,
} from './types.js';

// ---------------------------------------------------------------- builders ---

function node(id: string, type: ArchNodeType, label = id, attrs?: NodeAttrs): GraphNode {
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

function scenario(partial: Partial<LoadScenario> = {}): LoadScenario {
  return {
    id: 's1',
    name: 'Baseline',
    description: '',
    rpsMultiplier: 1,
    passCriteria: '',
    ...partial,
  };
}

function problem(partial: Partial<Problem> = {}): Problem {
  return {
    id: 'p1',
    title: 'Test problem',
    level: 1,
    domain: 'test',
    prompt: '',
    functional: [],
    nonFunctional: {},
    constraints: [],
    concepts: [],
    expectedFlows: [],
    rubricHints: '',
    twists: [],
    scenarios: [],
    ...partial,
  };
}

// LB (50k) -> API service x4 (2000) -> Postgres (3000), one 100 rps read flow.
// Healthy at 1x, saturated-but-not-dropping at exactly 20x, dropping at 100x.
function straightLine(): GraphDSL {
  return graph({
    nodes: [
      node('lb', 'load_balancer', 'Edge LB'),
      node('api', 'service', 'API service', { replicas: 4 }),
      node('db', 'sql_db', 'Postgres primary'),
    ],
    edges: [edge('lb', 'api'), edge('api', 'db')],
    flows: [flow('read', ['lb', 'api', 'db'], 100)],
  });
}

// ---------------------------------------------------------------- tests ------

describe('resolveKillIds', () => {
  it('matches a case-insensitive label substring', () => {
    expect(resolveKillIds(straightLine(), ['postgres'])).toEqual(['db']);
    expect(resolveKillIds(straightLine(), ['POSTGRES PRIMARY'])).toEqual(['db']);
  });

  it('matches by node type', () => {
    expect(resolveKillIds(straightLine(), ['sql_db'])).toEqual(['db']);
    // A type substring reaches every node of that family.
    expect(resolveKillIds(straightLine(), ['service'])).toEqual(['api']);
  });

  it('returns [] for undefined, empty and blank kill names (blank must not match all)', () => {
    expect(resolveKillIds(straightLine(), undefined)).toEqual([]);
    expect(resolveKillIds(straightLine(), [])).toEqual([]);
    expect(resolveKillIds(straightLine(), ['   '])).toEqual([]);
    expect(resolveKillIds(straightLine(), ['no such thing'])).toEqual([]);
  });
});

describe('evaluateScenario — default gates', () => {
  it('passes a healthy design and says so, PASS reasons included', () => {
    const v = evaluateScenario(straightLine(), scenario());
    expect(v.pass).toBe(true);
    expect(v.scenarioId).toBe('s1');
    expect(v.name).toBe('Baseline');
    expect(v.reasons).toContain('PASS — no flow broke.');
    expect(v.reasons.some((r) => r.includes('of offered traffic dropped'))).toBe(true);
    expect(v.metrics.offeredRps).toBe(100);
    expect(v.metrics.droppedPct).toBe(0);
    expect(v.metrics.brokenFlows).toEqual([]);
  });

  it('fails noBrokenFlows when a killed node breaks the flow', () => {
    const v = evaluateScenario(straightLine(), scenario({ killNodes: ['Postgres'] }));
    expect(v.pass).toBe(false);
    expect(v.metrics.brokenFlows).toEqual(['read']);
    expect(v.reasons.some((r) => r.startsWith('FAIL') && r.includes("flow 'read'"))).toBe(true);
    expect(v.reasons.some((r) => r.includes('no flow may break'))).toBe(true);
  });

  it('fails the 1% default drop gate with the right reason text, failed reasons first', () => {
    // 100x: 10 000 rps offered, only the API tier (2 000 cap) sheds => 80% dropped.
    const g = graph({
      nodes: [
        node('lb', 'load_balancer', 'Edge LB'),
        node('api', 'service', 'API service', { replicas: 4 }),
        node('db', 'sql_db', 'Postgres primary', { capacityRps: 20_000 }),
      ],
      edges: [edge('lb', 'api'), edge('api', 'db')],
      flows: [flow('read', ['lb', 'api', 'db'], 100)],
    });
    const v = evaluateScenario(g, scenario({ rpsMultiplier: 100 }));
    expect(v.pass).toBe(false);
    expect(v.metrics.droppedPct).toBeCloseTo(80, 1);
    expect(
      v.reasons.some((r) => r.includes('80% of offered traffic dropped (gate: at most 1%)')),
    ).toBe(true);
    // Ordering: the failed drop gate leads, the passed no-broken gate follows.
    expect(v.reasons[0]!.startsWith('FAIL')).toBe(true);
    expect(v.reasons.at(-1)!.startsWith('PASS')).toBe(true);
  });
});

describe('evaluateScenario — structured pass overrides defaults', () => {
  it('checks only the declared gates: a broken flow passes when only maxDroppedPct is gated', () => {
    const v = evaluateScenario(
      straightLine(),
      scenario({ killNodes: ['Postgres'], pass: { maxDroppedPct: 100 } }),
    );
    expect(v.metrics.brokenFlows).toEqual(['read']); // it DID break...
    expect(v.pass).toBe(true); // ...but the only declared gate tolerates it
    expect(v.reasons.some((r) => r.includes('no flow may break'))).toBe(false);
  });

  it('applies an explicit maxP99Ms gate in both directions', () => {
    // At 1x the read path p99 is ~131ms (p50 ~52ms * 2.5, mild congestion).
    const tight = evaluateScenario(straightLine(), scenario({ pass: { maxP99Ms: 100 } }));
    expect(tight.pass).toBe(false);
    expect(tight.reasons.some((r) => r.startsWith('FAIL') && r.includes('p99'))).toBe(true);

    const loose = evaluateScenario(straightLine(), scenario({ pass: { maxP99Ms: 200 } }));
    expect(loose.pass).toBe(true);
    expect(loose.reasons.some((r) => r.startsWith('PASS') && r.includes('p99'))).toBe(true);
  });
});

describe('evaluateScenario — the problem p99 budget', () => {
  it('is applied at baseline load (rpsMultiplier <= 1) when no structured pass exists', () => {
    const fail = evaluateScenario(straightLine(), scenario(), { problemP99Ms: 100 });
    expect(fail.pass).toBe(false);
    expect(fail.metrics.worstP99Ms).toBeCloseTo(130.96, 1);
    expect(fail.reasons.some((r) => r.includes('gate: at most 100ms'))).toBe(true);

    const ok = evaluateScenario(straightLine(), scenario(), { problemP99Ms: 200 });
    expect(ok.pass).toBe(true);
  });

  it('is NOT applied to a stress run (a 20x scenario is about survival, not the SLO)', () => {
    const v = evaluateScenario(straightLine(), scenario({ rpsMultiplier: 20 }), {
      problemP99Ms: 100,
    });
    // 2000 rps exactly saturates the API tier: latency explodes, nothing drops.
    expect(v.metrics.worstP99Ms).toBeGreaterThan(100);
    expect(v.pass).toBe(true);
    expect(v.reasons.some((r) => r.includes('p99'))).toBe(false);
  });

  it('measures p99 over synchronous flows only — an async pipeline never fails the gate', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'API', { replicas: 10 }),
        node('model', 'llm', 'LLM'), // 1200ms base latency
      ],
      edges: [edge('api', 'model', 'async')],
      flows: [flow('read', ['api'], 100), flow('enrich', ['model'], 10, 'async')],
    });
    const v = evaluateScenario(g, scenario(), { problemP99Ms: 500 });
    // The async flow's ~3000ms p99 is ignored; the read flow's 100ms is the worst.
    expect(v.metrics.worstP99Ms).toBeLessThan(500);
    expect(v.pass).toBe(true);
  });
});

describe('evaluateScenario — degenerate input', () => {
  it('fails with an explanatory reason when the design declares no flows', () => {
    const g = graph({ nodes: [node('api', 'service', 'API')] });
    const v = evaluateScenario(g, scenario());
    expect(v.pass).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toContain('at least one declared flow');
    expect(v.metrics).toEqual({ offeredRps: 0, droppedPct: 0, worstP99Ms: 0, brokenFlows: [] });
  });

  it('is deterministic', () => {
    const a = evaluateScenario(straightLine(), scenario({ rpsMultiplier: 100, killNodes: ['lb'] }));
    const b = evaluateScenario(straightLine(), scenario({ rpsMultiplier: 100, killNodes: ['lb'] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the graph or the scenario', () => {
    const g = straightLine();
    const s = scenario({ rpsMultiplier: 50, killNodes: ['Postgres'], pass: { maxP99Ms: 100 } });
    const gSnap = JSON.stringify(g);
    const sSnap = JSON.stringify(s);
    evaluateScenario(g, s, { problemP99Ms: 100 });
    expect(JSON.stringify(g)).toBe(gSnap);
    expect(JSON.stringify(s)).toBe(sSnap);
  });
});

describe('evaluateAllScenarios', () => {
  it('maps every scenario and feeds the p99 budget only where it applies', () => {
    const p = problem({
      nonFunctional: { 'P99 (ms)': 100, availability: '99.9%' },
      scenarios: [
        scenario({ id: 'base', name: 'Baseline', rpsMultiplier: 1 }),
        scenario({ id: 'surge', name: 'Surge', rpsMultiplier: 20 }),
      ],
    });
    const verdicts = evaluateAllScenarios(straightLine(), p);
    expect(verdicts.map((v) => v.scenarioId)).toEqual(['base', 'surge']);
    // Baseline is held to the problem's 100ms budget (p99 is 125ms) and fails...
    expect(verdicts[0]!.pass).toBe(false);
    expect(verdicts[0]!.reasons.some((r) => r.includes('at most 100ms'))).toBe(true);
    // ...while the 20x surge is not held to it.
    expect(verdicts[1]!.pass).toBe(true);
  });

  it('ignores a non-numeric p99 and returns [] for a problem with no scenarios', () => {
    const p = problem({
      nonFunctional: { p99Ms: 'fast please' },
      scenarios: [scenario({ id: 'base', rpsMultiplier: 1 })],
    });
    const verdicts = evaluateAllScenarios(straightLine(), p);
    expect(verdicts[0]!.pass).toBe(true); // no budget applied, defaults pass
    expect(evaluateAllScenarios(straightLine(), problem())).toEqual([]);
  });
});
