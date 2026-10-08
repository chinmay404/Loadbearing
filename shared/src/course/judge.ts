import { checkTopology } from '../compatibility.js';
import { docFromBlueprint, graphFromDoc } from '../doc.js';
import { runEngine, steadyScenario, type EngineResult, type Scenario } from '../engine.js';
import { familyOf } from '../families.js';
import { simulate } from '../simulate.js';
import type { GraphDSL, GraphNode } from '../types.js';
import type { Gate, GateResult, PartRef, Patch, Step, StepVerdict } from './types.js';

/**
 * Whether a learner's design passes a step. Pure arithmetic: the same design gets
 * the same verdict every time, with no model involved.
 */

/** Parts the author placed keep their key as `n-<key>` on the canvas. */
export const idOfKey = (key: string) => `n-${key}`;

const DEFAULT_HORIZON = 30;

function matches(node: GraphNode, ref: PartRef): boolean {
  return 'key' in ref ? node.id === idOfKey(ref.key) : node.type === ref.type;
}

function labelOf(graph: GraphDSL, ref: PartRef): string {
  const hit = graph.nodes.find((n) => matches(n, ref));
  return hit?.label ?? ('key' in ref ? ref.key : ref.type.replace(/_/g, ' '));
}

/** The run one gate describes: steady traffic from every client, maybe a kill. */
export function gateScenario(graph: GraphDSL, gate: Gate): Scenario {
  const patterns: Scenario['patterns'] = {};
  for (const n of graph.nodes) {
    if (familyOf(n.type) === 'origin') patterns[n.id] = { shape: 'steady', baseRps: gate.rps };
  }
  return {
    ...steadyScenario(1),
    id: gate.id,
    name: gate.label,
    horizonS: gate.horizonS ?? DEFAULT_HORIZON,
    patterns,
    outages: gate.kill ? [{ nodeId: idOfKey(gate.kill.key), atS: gate.kill.atS, ...(gate.kill.forS ? { forS: gate.kill.forS } : {}) }] : [],
  };
}

const pct = (v: number) => `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;

export function judgeGate(graph: GraphDSL, gate: Gate): { result: GateResult; run: EngineResult } {
  const run = runEngine(graph, gateScenario(graph, gate));
  const horizon = gate.horizonS ?? DEFAULT_HORIZON;
  const from = gate.window === 'after-kill' && gate.kill ? gate.kill.atS : gate.window === 'end' ? horizon - 10 : 0;
  const ticks = run.ticks.filter((t) => t.t >= from);
  const offered = ticks.reduce((s, t) => s + t.offeredRps, 0);
  const completed = ticks.reduce((s, t) => s + t.completedRps, 0);
  const lostPct = offered > 0 ? Math.max(0, (1 - completed / offered) * 100) : 100;
  const p99 = ticks.reduce((m, t) => Math.max(m, t.p99Ms), 0);

  const checks: { pass: boolean; detail: string }[] = [];
  // A phone wired to nothing loses nothing only because it asks nothing of anyone.
  // That is not a working shop, so no traffic goal can pass it.
  const loose = graph.nodes.find((n) => familyOf(n.type) === 'origin' && !graph.edges.some((e) => e.from === n.id));
  if (loose) checks.push({ pass: false, detail: `${loose.label} is not connected` });
  if (gate.maxLostPct !== undefined) checks.push({ pass: lostPct <= gate.maxLostPct + 1e-9, detail: `${pct(lostPct)} lost` });
  if (gate.maxP99Ms !== undefined) checks.push({ pass: p99 <= gate.maxP99Ms, detail: `p99 ${Math.round(p99)} ms` });
  if (gate.maxBusy) {
    const ref = gate.maxBusy.part;
    const busy = run.worst
      .filter((h) => {
        const n = graph.nodes.find((x) => x.id === h.nodeId);
        return n !== undefined && matches(n, ref);
      })
      .reduce((m, h) => Math.max(m, h.utilization), 0);
    checks.push({ pass: busy * 100 <= gate.maxBusy.pct, detail: `${labelOf(graph, ref)} ${pct(busy * 100)} busy` });
  }
  if (gate.reaches) {
    const ref = gate.reaches.part;
    const got = run.final
      .filter((h) => {
        const n = graph.nodes.find((x) => x.id === h.nodeId);
        return n !== undefined && matches(n, ref);
      })
      .reduce((s, h) => s + h.servedRps, 0);
    checks.push({ pass: got > 0.01, detail: got > 0.01 ? gate.reaches.label : `nothing reaches ${labelOf(graph, ref)}` });
  }

  const failed = checks.find((c) => !c.pass);
  return {
    result: {
      id: gate.id,
      label: gate.label,
      pass: checks.every((c) => c.pass),
      detail: (failed ?? checks[0])?.detail ?? '',
    },
    run,
  };
}

export function judgeStep(step: Step, graph: GraphDSL): StepVerdict {
  const judged = step.gates.map((g) => judgeGate(graph, g));
  const gates = judged.map((j) => j.result);

  const open = new Map(checkTopology(graph).map((f) => [f.rule, f.message]));
  const findings = (step.clears ?? []).map((rule) => ({ rule, message: open.get(rule) ?? '', open: open.has(rule) }));

  const uses = (step.uses ?? []).map((u) => ({ label: u.label, pass: graph.nodes.some((n) => n.type === u.type) }));

  const cost = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 }).monthlyCost;
  const budget = { cost: Math.round(cost), cap: step.budget, pass: cost <= step.budget + 1e-9 };

  // The heaviest gate is where "what broke first" is worth naming.
  let heaviest = 0;
  step.gates.forEach((g, i) => {
    if (g.rps > step.gates[heaviest]!.rps) heaviest = i;
  });
  const firstFailure = judged[heaviest]?.run.firstFailure?.nodeId ?? null;

  // A step that only asks you to watch passes once it has been run.
  const passed = step.observe
    ? true
    : gates.every((g) => g.pass) && findings.every((f) => !f.open) && uses.every((u) => u.pass) && budget.pass;

  return { passed, gates, findings, uses, budget, firstFailure };
}

// --------------------------------------------------------------- designs --

/** The design a step starts from, as the canvas holds it. */
export function startGraph(step: Step): GraphDSL {
  return graphFromDoc(docFromBlueprint(step.start));
}

/** A step's design with a patch applied — how the tests prove a step can be solved. */
export function applyPatch(graph: GraphDSL, patch: Patch): GraphDSL {
  const nodes = graph.nodes.map((n) => ({ ...n, attrs: { ...(n.attrs ?? {}) } }));
  for (const a of patch.add ?? []) {
    nodes.push({ id: idOfKey(a.key), type: a.type, label: a.label, annotation: '', attrs: { ...(a.attrs ?? {}) } });
  }
  for (const s of patch.set ?? []) {
    const n = nodes.find((x) => x.id === idOfKey(s.key));
    if (n) n.attrs = { ...n.attrs, ...s.attrs };
  }
  const gone = new Set((patch.disconnect ?? []).map(([a, b]) => `${idOfKey(a)}>${idOfKey(b)}`));
  const edges = graph.edges.filter((e) => !gone.has(`${e.from}>${e.to}`));
  for (const [a, b] of patch.connect ?? []) {
    edges.push({ id: `p-${a}-${b}`, from: idOfKey(a), to: idOfKey(b), kind: 'sync', label: '' });
  }
  return { ...graph, nodes, edges };
}
