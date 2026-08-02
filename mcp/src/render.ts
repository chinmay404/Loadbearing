// Turning Loadbearing's data into something a model can read.
//
// The lazy version of this server would hand back raw JSON and let the model parse
// it. That works and it is wasteful: a canvas document is mostly coordinates, a
// SimResult is mostly per-tick arrays, and a model asked "what is wrong with this
// design" should not have to spend its attention reconstructing the picture from
// pixel positions it was never going to use.
//
// So each tool returns prose with the numbers in it. Anything a caller might want to
// act on precisely — ids, mostly — is included verbatim, because the next tool call
// will need it.

import type { GraphDSL, Problem, SimResult } from '@loadbearing/shared';

export function renderProblem(p: Problem): string {
  const lines: string[] = [
    `# ${p.title}`,
    `${p.kind === 'lab' ? 'Lab' : 'Design problem'} · level ${p.level} · ${p.domain}${p.custom ? ' · custom' : ''}`,
    `id: ${p.id}`,
    '',
    p.prompt,
    '',
    '## Must do',
    ...p.functional.map((f) => `- ${f}`),
    '',
    '## Numbers',
    ...Object.entries(p.nonFunctional).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Constraints',
    ...p.constraints.map((c) => `- ${c}`),
    '',
    `## Flows the answer should declare`,
    ...p.expectedFlows.map((f) => `- ${f}`),
    '',
    '## Scenarios it must survive',
    ...p.scenarios.flatMap((s) => [
      `- **${s.name}** (id: ${s.id}) — ${s.description}`,
      `  ×${s.rpsMultiplier} load${s.killNodes?.length ? `, kills: ${s.killNodes.join(', ')}` : ''}${
        s.thirdPartyLatencyMs ? `, +${s.thirdPartyLatencyMs}ms on third-party calls` : ''
      }`,
      `  pass: ${s.passCriteria}`,
    ]),
    '',
    `Concepts graded: ${p.concepts.join(', ')}`,
  ];

  if (p.diagram) {
    lines.push(
      '',
      `## ${p.kind === 'lab' ? 'Starting architecture' : 'The system today'}`,
      p.diagram.caption,
      '',
      renderGraph({
        nodes: p.diagram.nodes.map((n) => ({
          id: n.key,
          type: n.type,
          label: n.label,
          annotation: n.annotation,
          ...(n.attrs ? { attrs: n.attrs } : {}),
        })),
        edges: p.diagram.edges.map((e, i) => ({
          id: `d${i}`,
          from: e.from,
          to: e.to,
          kind: e.kind,
          label: e.label ?? '',
        })),
        stickies: [],
        flows: p.diagram.flows.map((f, i) => ({ id: `f${i}`, ...f })),
      }),
    );
  }

  // The rubric is deliberately withheld: it names the mistakes, and a caller reading
  // it would be answering with the marking scheme in hand rather than thinking.
  return lines.join('\n');
}

/** The drawing in words: what is on it, what connects to what, and the paths named. */
export function renderGraph(graph: GraphDSL): string {
  if (graph.nodes.length === 0) return 'The sheet is empty.';

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label ?? id;

  const lines: string[] = [`### Components (${graph.nodes.length})`];
  for (const n of graph.nodes) {
    const knobs = attrSummary(n.attrs);
    lines.push(
      `- **${n.label}** \`${n.type}\` (id: ${n.id})${knobs ? ` — ${knobs}` : ''}` +
        (n.parentId ? ` [inside ${name(n.parentId)}]` : ''),
    );
    if (n.annotation.trim()) lines.push(`  ${n.annotation.trim()}`);
  }

  lines.push('', `### Connections (${graph.edges.length})`);
  if (graph.edges.length === 0) {
    lines.push('Nothing is connected to anything, so no traffic can move through this design.');
  }
  for (const e of graph.edges) {
    const detail = [e.label, e.kind === 'sync' ? null : e.kind, e.retries ? `${e.retries} retries` : null]
      .filter(Boolean)
      .join(', ');
    lines.push(`- ${name(e.from)} → ${name(e.to)}${detail ? ` (${detail})` : ''}`);
  }

  lines.push('', `### Flows (${graph.flows.length})`);
  if (graph.flows.length === 0) {
    lines.push('None declared. The load engine has nothing to run until at least one exists.');
  }
  for (const f of graph.flows) {
    lines.push(`- **${f.name}** [${f.kind}] ${f.rps} rps: ${f.steps.map(name).join(' → ')}`);
    if (f.description.trim()) lines.push(`  ${f.description.trim()}`);
  }

  if (graph.stickies.length > 0) {
    lines.push('', '### Notes on the canvas');
    for (const s of graph.stickies) lines.push(`- ${s.text}`);
  }

  return lines.join('\n');
}

/** Only the knobs that were set to something worth mentioning. */
function attrSummary(attrs: GraphDSL['nodes'][number]['attrs']): string {
  if (!attrs) return '';
  const bits: string[] = [];
  if (attrs.trafficRps) bits.push(`SOURCE of ${attrs.trafficRps} rps`);
  if (attrs.elastic) bits.push('elastic (provider-scaled)');
  if (attrs.autoscaleMax && attrs.autoscaleMax > 1) {
    bits.push(`×${attrs.autoscaleMin ?? attrs.replicas ?? 1}–${attrs.autoscaleMax}`);
  } else if (attrs.replicas && attrs.replicas > 1) bits.push(`×${attrs.replicas}`);
  if (attrs.vcpu) bits.push(`${attrs.vcpu} vCPU`);
  if (attrs.memoryGb) bits.push(`${attrs.memoryGb}GB`);
  if (attrs.latencyMs !== undefined) bits.push(`${attrs.latencyMs}ms`);
  if (attrs.capacityRps) bits.push(`cap ${attrs.capacityRps} rps`);
  if (attrs.concurrency) bits.push(`${attrs.concurrency} in flight`);
  if (attrs.cacheHitRate !== undefined) bits.push(`hit ${Math.round(attrs.cacheHitRate * 100)}%`);
  if (attrs.shards) bits.push(`${attrs.shards} shards`);
  if (attrs.storageGb) bits.push(`${attrs.storageGb}GB stored`);
  if (attrs.multiAz) bits.push('multi-AZ');
  if (attrs.sharedHost) bits.push('shared pool');
  if (attrs.timeoutMs) bits.push(`timeout ${attrs.timeoutMs}ms`);
  if (attrs.rateLimitRps) bits.push(`provider limit ${attrs.rateLimitRps} rps`);
  return bits.join(', ');
}

/**
 * What the engine found, worst first.
 *
 * A run produces a number for every component, and reading all of them is the same
 * mistake as reading the raw JSON. What matters is: did traffic get through, where
 * did it stop, and what did it cost.
 */
export function renderSim(sim: SimResult, graph: GraphDSL): string {
  const name = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const lines: string[] = ['## Load run', sim.verdict];

  const offered = sim.flows.reduce((sum, f) => sum + f.offeredRps, 0);
  const completed = sim.flows.reduce((sum, f) => sum + f.completedRps, 0);
  const droppedPct = offered > 0 ? ((offered - completed) / offered) * 100 : 0;
  lines.push(
    '',
    `Offered ${round(offered)} rps, completed ${round(completed)} rps` +
      (droppedPct > 0.05 ? ` — **${round(droppedPct)}% never made it**.` : ' — all of it got through.'),
  );
  if (sim.bottleneckNodeId) {
    lines.push(`Bottleneck: **${name.get(sim.bottleneckNodeId) ?? sim.bottleneckNodeId}**.`);
  }

  lines.push('', '### Flows');
  for (const f of sim.flows) {
    lines.push(
      `- **${f.name}**: ${f.broken ? `**BROKEN**${f.brokenAt ? ` at ${name.get(f.brokenAt) ?? f.brokenAt}` : ''}` : 'completing'}` +
        `, p50 ${round(f.p50Ms)}ms / p99 ${round(f.p99Ms)}ms, ${round(f.completedRps)} of ${round(f.offeredRps)} rps through`,
    );
    for (const note of f.notes) lines.push(`  ${note}`);
  }

  const hot = [...sim.nodes]
    .filter((n) => n.utilization > 0.7 || n.droppedRps > 0.5)
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 8);
  lines.push('', '### Where it hurts');
  if (hot.length === 0) lines.push('Nothing above 70% utilisation. This design is not being stressed.');
  for (const n of hot) {
    // The replica pair is the interesting part for anything that autoscales: a
    // ceiling of 50 that only ever reached 3 is a different design from one pinned.
    const scaled = n.replicas !== n.replicasSettled ? ` (${n.replicas}→${n.replicasSettled} replicas)` : '';
    lines.push(
      `- **${name.get(n.nodeId) ?? n.nodeId}**: ${Math.round(n.utilization * 100)}% utilised, ${round(n.incomingRps)} rps arriving${scaled}` +
        (n.droppedRps > 0.5 ? `, shedding ${round(n.droppedRps)} rps` : '') +
        (n.queueDepth > 1 ? `, ${Math.round(n.queueDepth)} queued` : '') +
        (n.hostLimited ? ', squeezed by a shared pool' : '') +
        (n.state !== 'ok' ? `, state: ${n.state}` : ''),
    );
  }

  if (sim.findings.length > 0) {
    lines.push('', '### Findings');
    for (const f of sim.findings) lines.push(`- ${f}`);
  }

  lines.push(
    '',
    '### Cost',
    `$${Math.round(sim.cost.totalUsd)}/month — $${Math.round(sim.cost.fixedUsd)} provisioned, $${Math.round(sim.cost.usageUsd)} from the traffic actually served.`,
  );

  return lines.join('\n');
}

const round = (n: number): number => Math.round(n * 100) / 100;
