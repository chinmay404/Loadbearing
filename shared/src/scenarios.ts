// Machine-checkable scenario gates.
//
// Every LoadScenario has always carried a prose `passCriteria` for the human
// reading the result. This module adds the machine's version: run the
// simulator with the scenario's knobs, then compare the numbers against
// explicit thresholds. WHY: prose can be argued with, a threshold cannot —
// "did this design survive Black Friday?" becomes a boolean the UI can render
// as a green tick and the grader can trust without re-deriving the math.
//
// Same guarantees as simulate.ts: pure, deterministic (same inputs, same
// verdict, same string order), never throws on weird input, never mutates
// its arguments.

import { simulate } from './simulate.js';
import type {
  Flow,
  GraphDSL,
  LoadScenario,
  Problem,
  ScenarioPass,
  SimConfig,
} from './types.js';

/**
 * When a scenario declares no structured gates, hold it to the floor every
 * design should clear under chaos: nothing may break outright, and at most 1%
 * of offered traffic may be dropped. WHY 1% and not 0: redundant-sibling
 * failover and rounding legitimately shave fractions of a percent — a design
 * that keeps 99% alive through a kill has learned the lesson being taught.
 */
const DEFAULT_GATE: ScenarioPass = { noBrokenFlows: true, maxDroppedPct: 1 };

/** Flow kinds where a human is waiting on the response — the only ones p99 judges. */
const SYNCHRONOUS_FLOW_KINDS: ReadonlySet<Flow['kind']> = new Set(['read', 'write']);

/** Compact human number: 80, 1.5, 0.42 (never "80.00"). */
function num(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** "flow 'checkout'" / "flows 'checkout', 'search'" — for reason sentences. */
function flowList(names: readonly string[]): string {
  const quoted = names.map((n) => `'${n}'`).join(', ');
  return `${names.length === 1 ? 'flow' : 'flows'} ${quoted}`;
}

/**
 * Case-insensitive substring match of scenario kill names against node labels
 * and types (plus exact-id match, since scenarios may be authored either way).
 *
 * WHY substring and not equality: problem scenarios are written before the
 * learner draws anything, so "kill the database" can only say "postgres" or
 * "sql_db" and hope the learner's label ("Postgres primary") contains it.
 */
export function resolveKillIds(graph: GraphDSL, killNodes: string[] | undefined): string[] {
  const nodes = graph?.nodes ?? [];
  const wanted = (killNodes ?? [])
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0); // a blank kill name must not match everything
  if (wanted.length === 0) return [];

  const out: string[] = [];
  for (const node of nodes) {
    const label = (node.label ?? '').toLowerCase();
    const type = (node.type ?? '').toLowerCase();
    const id = (node.id ?? '').toLowerCase();
    if (wanted.some((w) => label.includes(w) || type.includes(w) || id === w)) {
      out.push(node.id);
    }
  }
  return out;
}

export interface ScenarioVerdict {
  scenarioId: string;
  name: string;
  pass: boolean;
  /** Human sentences explaining each failed (or passed) gate, teaching voice. */
  reasons: string[];
  metrics: { offeredRps: number; droppedPct: number; worstP99Ms: number; brokenFlows: string[] };
}

/**
 * Run one scenario against a design and judge it.
 *
 * Gate selection: `scenario.pass` when present, otherwise DEFAULT_GATE. An
 * explicit `maxP99Ms` is always checked. Additionally, when the scenario has
 * no structured gates AND runs at baseline load (rpsMultiplier <= 1) AND the
 * problem states a p99 budget, that budget applies — a design should meet its
 * own SLO at the load it was asked to handle, but a 50x stress run is about
 * survival, not latency, so the budget is deliberately NOT applied there.
 */
export function evaluateScenario(
  graph: GraphDSL,
  scenario: LoadScenario,
  opts?: { problemP99Ms?: number },
): ScenarioVerdict {
  const scenarioId = scenario?.id ?? '';
  const name = scenario?.name ?? '';
  const flows = graph?.flows ?? [];

  // Without a declared flow there is no offered traffic, no p99 and nothing
  // that can break — a pass here would be vacuous, so it is a fail with a hint.
  if (flows.length === 0) {
    return {
      scenarioId,
      name,
      pass: false,
      reasons: [
        'FAIL — gates need at least one declared flow. Draw the request path as a flow so ' +
          'there is a number to measure; a diagram with no flows cannot pass or fail load.',
      ],
      metrics: { offeredRps: 0, droppedPct: 0, worstP99Ms: 0, brokenFlows: [] },
    };
  }

  const config: SimConfig = {
    rpsMultiplier: Number.isFinite(scenario?.rpsMultiplier) ? scenario.rpsMultiplier : 1,
    killNodeIds: resolveKillIds(graph, scenario?.killNodes),
    thirdPartyLatencyMs: scenario?.thirdPartyLatencyMs ?? 0,
    // Without this a scenario whose whole point is an internal dependency slowing
    // down ran at baseline and reported a pass.
    ...(scenario?.degrade?.length ? { degradations: scenario.degrade } : {}),
  };
  const sim = simulate(graph, config);

  // ---- metrics --------------------------------------------------------------
  const offeredRps = sim.flows.reduce(
    (sum, f) => sum + (Number.isFinite(f.offeredRps) ? f.offeredRps : 0),
    0,
  );
  const droppedPct = offeredRps > 0 ? (sim.totalDroppedRps / offeredRps) * 100 : 0;

  // p99 only over flows a human is waiting on — nobody stares at a spinner
  // for an async pipeline, so its tail must not fail a latency gate.
  const kindOf = new Map(flows.map((f) => [f.id, f.kind]));
  let worstP99Ms = 0;
  for (const f of sim.flows) {
    const kind = kindOf.get(f.flowId);
    if (kind === undefined || !SYNCHRONOUS_FLOW_KINDS.has(kind)) continue;
    if (Number.isFinite(f.p99Ms) && f.p99Ms > worstP99Ms) worstP99Ms = f.p99Ms;
  }
  const brokenFlows = sim.flows.filter((f) => f.broken).map((f) => f.name);

  // ---- gates ----------------------------------------------------------------
  const hasExplicitGates = scenario?.pass !== undefined && scenario.pass !== null;
  const gates: ScenarioPass = hasExplicitGates ? scenario.pass! : DEFAULT_GATE;

  let p99LimitMs: number | undefined;
  if (typeof gates.maxP99Ms === 'number' && Number.isFinite(gates.maxP99Ms)) {
    p99LimitMs = gates.maxP99Ms;
  } else if (
    !hasExplicitGates &&
    config.rpsMultiplier <= 1 &&
    typeof opts?.problemP99Ms === 'number' &&
    Number.isFinite(opts.problemP99Ms)
  ) {
    p99LimitMs = opts.problemP99Ms;
  }

  const failed: string[] = [];
  const passed: string[] = [];

  if (gates.noBrokenFlows === true) {
    if (brokenFlows.length === 0) {
      passed.push('PASS — no flow broke.');
    } else {
      failed.push(
        `FAIL — ${flowList(brokenFlows)} ended the run broken (gate: no flow may break). ` +
          'A broken flow means every user on that path got nothing at all, no matter how ' +
          'healthy the averages look — give it redundancy or a fallback.',
      );
    }
  }

  if (typeof gates.maxDroppedPct === 'number' && Number.isFinite(gates.maxDroppedPct)) {
    const line = `${num(droppedPct)}% of offered traffic dropped (gate: at most ${num(gates.maxDroppedPct)}%).`;
    if (droppedPct <= gates.maxDroppedPct) {
      passed.push(`PASS — ${line}`);
    } else {
      failed.push(
        `FAIL — ${line} Every dropped request is a user who saw an error — add capacity at ` +
          'the bottleneck or absorb the load with a cache before it gets there.',
      );
    }
  }

  if (p99LimitMs !== undefined) {
    const line = `worst synchronous p99 is ${num(worstP99Ms)}ms (gate: at most ${num(p99LimitMs)}ms).`;
    if (worstP99Ms <= p99LimitMs) {
      passed.push(`PASS — ${line}`);
    } else {
      failed.push(
        `FAIL — ${line} The tail is where your slowest users live — cut hops on the ` +
          'synchronous path or move slow dependencies off it.',
      );
    }
  }

  // Failed gates first: the learner should see what to fix before the applause.
  const reasons = [...failed, ...passed];
  if (reasons.length === 0) {
    reasons.push('PASS — this scenario declares no machine-checkable gates, so nothing can fail.');
  }

  return {
    scenarioId,
    name,
    pass: failed.length === 0,
    reasons,
    metrics: {
      offeredRps: round(offeredRps),
      droppedPct: round(droppedPct),
      worstP99Ms: round(worstP99Ms),
      brokenFlows,
    },
  };
}

/**
 * Judge every scenario a problem declares against one design.
 *
 * The problem's own p99 budget is fished out of `nonFunctional`, which is
 * authored prose-adjacent JSON — so the key is matched leniently ('p99Ms',
 * 'p99ms', 'p99', even 'P99 (ms)') and only a finite numeric value counts.
 */
export function evaluateAllScenarios(graph: GraphDSL, problem: Problem): ScenarioVerdict[] {
  const scenarios = problem?.scenarios ?? [];

  let problemP99Ms: number | undefined;
  for (const [key, value] of Object.entries(problem?.nonFunctional ?? {})) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized !== 'p99ms' && normalized !== 'p99') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      problemP99Ms = value;
      break;
    }
  }

  return scenarios.map((s) =>
    evaluateScenario(graph, s, problemP99Ms !== undefined ? { problemP99Ms } : undefined),
  );
}
