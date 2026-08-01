// The capacity report, projected from the load engine.
//
// This module used to BE the engine: it walked hand-authored step lists and scaled
// the number typed into each one. That answered questions about the list rather
// than about the design, so the engine in engine.ts replaced it — traffic starts at
// a source, follows the connections that were drawn, and ends where there is
// nothing after it.
//
// What survives here is the report. `SimResult` is what the grader, the scenario
// gates, the checks panel and the canvas all read, so its shape is unchanged and
// there is exactly one model behind it. A named flow no longer drives the
// simulation; it is walked through the engine's results so that "the checkout write
// path" still has numbers of its own.

import {
  runEngine,
  TAIL_MULTIPLE_IDLE,
  type EngineResult,
  type HopState,
  type Scenario,
} from './engine.js';
import { costReport } from './cost.js';
import { familyOf } from './families.js';
import { CACHE_TYPES, DATASTORE_TYPES, QUEUE_TYPES, STATEFUL_TYPES } from './components.js';
import type {
  Flow,
  GraphDSL,
  GraphNode,
  SimConfig,
  SimFlowResult,
  SimNodeResult,
  SimResult,
} from './types.js';

/**
 * Long enough to see an autoscaler arrive and a backlog drain, short enough that a
 * grader's run is instant.
 *
 * This was 45s, chosen so a design would be judged on the capacity it has rather than
 * the capacity it might acquire. That was the wrong call: it is shorter than the
 * autoscaler's lag, so a group configured to reach fifty replicas could never reach
 * any of them, and the report said nothing about the thing the author was relying on.
 * The honest answer is to run past the lag and describe BOTH — what the first minute
 * costs, and where it settles.
 */
export const REPORT_HORIZON_S = 150;

/** A flow that completes less than 1% of what it was offered is simply broken. */
export const BROKEN_COMPLETION_RATIO = 0.01;
const MAX_FINDINGS = 8;
const EPSILON = 1e-9;

const round = (v: number, dp = 2): number => {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const int = (v: number): string => String(Math.round(v));
const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;


/**
 * The old three-knob config, expressed as a scenario the engine understands.
 *
 * Kill lists are resolved against the drawing, case-insensitively, by id OR label:
 * the problem bank's scenarios name components the way a person would ("Redis",
 * "primary"), and a gate that silently kills nothing would pass every design.
 */
export function scenarioFromConfig(config: SimConfig, graph: GraphDSL): Scenario {
  const wanted = (config.killNodeIds ?? []).map((k) => k.toLowerCase());
  const killed = graph.nodes
    .filter((n) => wanted.includes(n.id.toLowerCase()) || wanted.includes(n.label.toLowerCase()))
    .map((n) => n.id);

  return {
    id: 'report',
    name: 'Capacity report',
    horizonS: REPORT_HORIZON_S,
    loadMultiplier: Math.max(0, config.rpsMultiplier ?? 1),
    outages: killed.map((nodeId) => ({ nodeId, atS: 0 })),
    // A third-party brownout lands on everything you call but do not run.
    latency:
      (config.thirdPartyLatencyMs ?? 0) > 0
        ? [{ family: 'external' as const, addMs: config.thirdPartyLatencyMs }]
        : [],
  };
}

export function simulate(graph: GraphDSL, config: SimConfig): SimResult {
  return report(graph, runEngine(graph, scenarioFromConfig(config, graph)));
}

export function report(graph: GraphDSL, engine: EngineResult): SimResult {
  const byId = new Map(engine.worst.map((h) => [h.nodeId, h]));
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const settled = new Map(engine.final.map((h) => [h.nodeId, h.replicas]));

  const nodes: SimNodeResult[] = engine.worst.map((h) => ({
    nodeId: h.nodeId,
    incomingRps: h.arrivingRps,
    // Infinity does not survive JSON — it arrives at the browser as null and gets
    // rendered as a capacity of zero. Anything that never constrains traffic says so
    // with a flag instead, and reports the load it carried as its capacity.
    capacityRps: Number.isFinite(h.capacityRps) ? h.capacityRps : h.arrivingRps,
    unlimited: !Number.isFinite(h.capacityRps),
    utilization: h.utilization,
    latencyMs: h.latencyMs,
    droppedRps: h.droppedRps,
    queueDepth: engine.peakBacklog[h.nodeId] ?? h.backlog,
    state: h.down && !h.bypassed ? 'down' : h.state,
    replicas: h.replicas,
    replicasSettled: settled.get(h.nodeId) ?? h.replicas,
  }));

  const flows = flowResults(graph, engine, byId);

  // Cost follows the traffic that actually arrived and the replicas it settled at, so a
  // design that sheds half its load is not billed for the half it refused, and one that
  // scaled to fifty replicas is billed for fifty.
  const cost = costReport(
    graph.nodes,
    new Map(engine.final.map((h) => [h.nodeId, h.servedRps])),
    new Map(engine.final.map((h) => [h.nodeId, h.replicas])),
  );

  return {
    nodes,
    flows,
    cost,
    bottleneckNodeId: engine.bottleneckNodeId,
    totalDroppedRps: round(engine.worst.reduce((sum, h) => sum + h.droppedRps, 0)),
    monthlyCost: cost.totalUsd,
    verdict: buildVerdict(engine, flows, nodesById),
    findings: buildFindings(graph, engine, byId, nodesById),
  };
}

const label = (graph: GraphDSL, id: string): string =>
  graph.nodes.find((n) => n.id === id)?.label ?? id;

/**
 * A named flow's numbers, taken from the engine rather than from a walk of its own.
 * Every hop it names contributes its latency and its survival, so a flow through a
 * saturated component reports what that component actually did to it.
 *
 * A sheet with no named flows gets its derived paths instead, so the report is never
 * empty just because nobody wrote the journeys down.
 */
function flowResults(
  graph: GraphDSL,
  engine: EngineResult,
  byId: Map<string, HopState>,
): SimFlowResult[] {
  const named = graph.flows ?? [];
  const journeys: { id: string; name: string; steps: string[]; kind?: Flow['kind'] }[] =
    named.length > 0
      ? named.map((f) => ({ id: f.id, name: f.name, steps: f.steps, kind: f.kind }))
      : engine.paths.slice(0, 8).map((p, i) => ({
          id: `path-${i + 1}`,
          name: p.nodeIds.map((id) => label(graph, id)).join(' → '),
          steps: p.nodeIds,
        }));

  return journeys.map((journey) => {
    const first = journey.steps[0] ?? '';
    // Offered is what actually arrives at the flow's first hop, so a flow that
    // starts half way down the design is measured from where it starts.
    const offeredRps = round(byId.get(first)?.arrivingRps ?? 0);

    let carried = offeredRps;
    let p50 = 0;
    let p99 = 0;
    let brokenAt: string | undefined;
    const notes: string[] = [];

    for (const stepId of journey.steps) {
      const hop = byId.get(stepId);
      if (!hop) {
        notes.push(`${stepId} is named in this flow but not in the drawing.`);
        continue;
      }
      if (hop.bypassed) {
        notes.push(
          `${label(graph, stepId)} is offline but transparent — its traffic passed straight through.`,
        );
      }
      const survival = hop.arrivingRps > EPSILON ? hop.servedRps / hop.arrivingRps : 1;
      if (survival < 1 && brokenAt === undefined && hop.droppedRps > EPSILON) brokenAt = stepId;
      carried *= survival;
      p50 += hop.latencyMs;
      p99 += hop.latencyMs * (TAIL_MULTIPLE_IDLE + 2 * Math.min(1, hop.utilization));
    }

    return {
      flowId: journey.id,
      name: journey.name,
      offeredRps,
      completedRps: round(carried),
      p50Ms: round(p50),
      p99Ms: round(p99),
      broken: offeredRps > EPSILON && carried / offeredRps < BROKEN_COMPLETION_RATIO,
      ...(brokenAt ? { brokenAt } : {}),
      notes,
    };
  });
}

/**
 * What the design got wrong, in the order a reviewer would raise it. Absences count:
 * no source, nothing absorbing reads, a single copy of the data, a component every
 * path has to cross. The engine supplies the evidence; this turns it into the
 * sentence a reviewer would say out loud.
 */
function buildFindings(
  graph: GraphDSL,
  engine: EngineResult,
  byId: Map<string, HopState>,
  nodesById: Map<string, GraphNode>,
): string[] {
  const out: string[] = [];
  const typeOf = (id: string) => nodesById.get(id)?.type ?? 'custom';

  if (engine.sources.length === 0) {
    out.push(
      'Nothing here can be an entry point, so no load was offered. Give a client a request rate.',
    );
  } else if (engine.sources.every((s) => s.inferred)) {
    out.push(
      `Nothing states where traffic starts, so ${engine.sources
        .map((s) => label(graph, s.nodeId))
        .join(', ')} ${engine.sources.length === 1 ? 'was' : 'were'} treated as the entry point. Set a request rate to say it deliberately.`,
    );
  }

  if (engine.firstFailure) {
    out.push(
      `First loss: ${engine.firstFailure.reason} Everything after it is only seeing what got past.`,
    );
  }

  for (const hop of engine.worst) {
    if (out.length >= MAX_FINDINGS) break;
    const node = nodesById.get(hop.nodeId);
    if (!node || hop.droppedRps > EPSILON || hop.state !== 'hot') continue;
    out.push(
      `${node.label} runs at ${pct(hop.utilization)} of capacity — serving everything, with nothing left for the next spike.`,
    );
  }

  // A queue that is behind is a queue whose consumers are the problem, so the
  // number worth saying out loud is the drain rate, not the queue.
  for (const [nodeId, peak] of Object.entries(engine.peakBacklog)) {
    if (out.length >= MAX_FINDINGS) break;
    if (peak <= 0 || !QUEUE_TYPES.has(typeOf(nodeId))) continue;
    out.push(
      `${label(graph, nodeId)} builds a backlog of ${int(peak)} messages: arrivals outrun what its consumers drain.`,
    );
  }

  if (engine.retryAmplification > 1.2 && out.length < MAX_FINDINGS) {
    out.push(
      `Retries turn each request into ${round(engine.retryAmplification, 2)} attempts at the worst moment — a struggling dependency is being asked again and again.`,
    );
  }

  const hasCache = graph.nodes.some((n) => CACHE_TYPES.has(n.type));
  const busiestStore = engine.worst
    .filter((h) => DATASTORE_TYPES.has(typeOf(h.nodeId)))
    .reduce<HopState | null>((w, h) => (!w || h.arrivingRps > w.arrivingRps ? h : w), null);
  if (!hasCache && busiestStore && busiestStore.arrivingRps > 0 && out.length < MAX_FINDINGS) {
    out.push(
      `${label(graph, busiestStore.nodeId)} takes all ${int(busiestStore.arrivingRps)} rps directly — nothing absorbs reads in front of it.`,
    );
  }

  for (const node of graph.nodes) {
    if (out.length >= MAX_FINDINGS) break;
    if (!STATEFUL_TYPES.has(node.type) || node.attrs?.multiAz) continue;
    if ((byId.get(node.id)?.arrivingRps ?? 0) <= 0) continue;
    out.push(`${node.label} holds state in one place: losing its zone loses the data it serves.`);
  }

  // A component every path must cross is a single point of failure — worth saying
  // only when there is more than one path to compare it against.
  if (engine.paths.length > 1 && out.length < MAX_FINDINGS) {
    for (const id of engine.paths[0]!.nodeIds) {
      if (out.length >= MAX_FINDINGS) break;
      if (!engine.paths.every((p) => p.nodeIds.includes(id))) continue;
      const family = familyOf(typeOf(id));
      if (family === 'origin' || family === 'boundary') continue;
      const node = nodesById.get(id);
      if (!node || (node.attrs?.replicas ?? 1) > 1) continue;
      out.push(`Every path crosses ${node.label}, and there is one of it.`);
    }
  }

  if (engine.cycleNodeIds.length > 0 && out.length < MAX_FINDINGS) {
    out.push(
      `The connections loop back on themselves at ${engine.cycleNodeIds
        .map((id) => label(graph, id))
        .join(', ')} — traffic was followed round once and no further.`,
    );
  }

  return out.slice(0, MAX_FINDINGS);
}

function buildVerdict(
  engine: EngineResult,
  flows: SimFlowResult[],
  nodesById: Map<string, GraphNode>,
): string {
  if (engine.sources.length === 0) {
    return 'No traffic was offered: nothing here is marked as where requests start.';
  }

  const peak = engine.peakOfferedRps;
  const worstTick = engine.ticks.reduce(
    (w, t) => (!w || t.successRate < w.successRate ? t : w),
    null as (typeof engine.ticks)[number] | null,
  );
  const lost = worstTick ? 1 - worstTick.successRate : 0;

  if (lost <= 0.001) {
    const hottest = engine.bottleneckNodeId ? nodesById.get(engine.bottleneckNodeId) : undefined;
    const util = engine.worst.find((h) => h.nodeId === engine.bottleneckNodeId)?.utilization ?? 0;
    const headroom = hottest ? ` ${hottest.label} is closest to its limit at ${pct(util)}.` : '';
    return `Holds ${int(peak)} rps with nothing dropped.${headroom}`;
  }

  const first = engine.firstFailure ? nodesById.get(engine.firstFailure.nodeId) : undefined;
  const where = first ? ` It gives way at ${first.label} first.` : '';
  const brokenCount = flows.filter((f) => f.broken).length;
  const brokenNote =
    brokenCount > 0 ? ` ${brokenCount} path${brokenCount === 1 ? '' : 's'} stopped completely.` : '';
  const recovery = engine.recoveredAtS !== null ? ` It recovered ${engine.recoveredAtS}s in.` : '';
  return `At ${int(peak)} rps it loses ${pct(lost)} of requests.${where}${brokenNote}${recovery}${settling(engine, nodesById)}`;
}

/**
 * What autoscaling did about it. A design that loses a quarter of its requests for the
 * first minute and then holds is a different design from one that never recovers, and
 * the difference is exactly what someone who configured an autoscaling group wants to
 * be told.
 */
function settling(engine: EngineResult, nodesById: Map<string, GraphNode>): string {
  const lastTick = engine.ticks[engine.ticks.length - 1];
  const worstTick = engine.ticks.reduce(
    (w, t) => (!w || t.successRate < w.successRate ? t : w),
    null as (typeof engine.ticks)[number] | null,
  );
  if (!lastTick || !worstTick || lastTick.successRate - worstTick.successRate < 0.01) return '';

  const startedAt = new Map(engine.worst.map((h) => [h.nodeId, h.replicas]));
  const grew = engine.final
    .map((h) => ({ hop: h, added: h.replicas - (startedAt.get(h.nodeId) ?? h.replicas) }))
    .filter((g) => g.added > 0)
    .sort((a, b) => b.added - a.added)[0];

  const settled =
    lastTick.successRate >= 0.999
      ? 'then holds everything'
      : `then settles at ${pct(1 - lastTick.successRate)} lost`;
  const who = grew ? ` once ${nodesById.get(grew.hop.nodeId)?.label ?? grew.hop.nodeId} scaled to ×${grew.hop.replicas}` : '';
  return ` It ${settled}${who}.`;
}

export default simulate;
