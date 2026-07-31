// The design, rewritten as something a coding agent can build from.
//
// A diagram is not a specification. What an agent needs is the request paths in
// order, the numbers each component is sized for, the invariants that must hold,
// and the things that are deliberately absent — plus the machine-readable graph so
// it does not have to parse prose. This assembles all of that from what the app
// already knows: the sheet, the drawing, the deterministic checks and the
// simulator's arithmetic.

import { checkTopology, simulate } from '@loadbearing/shared';
import type { GraphDSL, Problem, SimResult, TopologyFinding } from '@loadbearing/shared';

export interface BriefInput {
  graph: GraphDSL;
  problem?: Problem | undefined;
}

const nl = (lines: (string | false | undefined)[]): string => lines.filter(Boolean).join('\n');

export function buildImplementationBrief(input: BriefInput): { markdown: string; graph: GraphDSL } {
  const { graph, problem } = input;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label ?? id;

  let sim: SimResult | undefined;
  try {
    sim = simulate(graph, { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 });
  } catch {
    sim = undefined;
  }
  const checks = checkTopology(graph);

  return {
    graph,
    markdown: nl([
      `# Implementation brief — ${problem?.title ?? 'architecture'}`,
      '',
      'This is a build specification derived from an architecture diagram. It states what to build,',
      'the order requests travel in, the load each component is sized for, and the invariants that',
      'must hold. Where it says a component is absent, that absence is deliberate and recorded —',
      'do not add it without saying why.',
      '',
      problemSection(problem),
      componentSection(graph),
      flowSection(graph, name),
      invariantSection(graph),
      capacitySection(sim),
      absentSection(checks),
      acceptanceSection(problem, graph),
      '',
      '## Machine-readable design',
      '',
      'Components, connections and flows as JSON. `steps` are node ids in request order.',
      '',
      '```json',
      JSON.stringify(graph, null, 2),
      '```',
    ]),
  };
}

function problemSection(problem?: Problem): string {
  if (!problem) {
    return nl([
      '## Context',
      '',
      'No problem sheet was attached, so treat the diagram as the whole requirement.',
      '',
    ]);
  }
  const numbers = Object.entries(problem.nonFunctional).map(([k, v]) => `- ${k}: ${v}`);
  return nl([
    '## Context',
    '',
    problem.prompt,
    '',
    '### Must do',
    ...problem.functional.map((f) => `- ${f}`),
    '',
    '### Numbers to design against',
    ...(numbers.length > 0 ? numbers : ['- none stated']),
    '',
    '### Hard constraints',
    'These decide what counts as overengineering. Do not exceed them to make something tidier.',
    ...problem.constraints.map((c) => `- ${c}`),
    '',
  ]);
}

function componentSection(graph: GraphDSL): string {
  if (graph.nodes.length === 0) return '';
  const rows = graph.nodes
    .filter((n) => n.type !== 'group')
    .map((n) => {
      const a = n.attrs ?? {};
      const sizing = [
        a.capacityRps !== undefined && `${a.capacityRps} rps per instance`,
        a.replicas !== undefined && `${a.replicas} instance${a.replicas === 1 ? '' : 's'}`,
        a.latencyMs !== undefined && `${a.latencyMs}ms service time`,
        a.cacheHitRate !== undefined && `${Math.round(a.cacheHitRate * 100)}% hit rate`,
        a.queueDepthMax !== undefined && `max depth ${a.queueDepthMax}`,
        a.multiAz && 'multi-AZ',
      ]
        .filter(Boolean)
        .join(', ');
      return nl([
        `### ${n.label}  \`${n.type}\``,
        n.annotation.trim() ? n.annotation.trim() : '_No mechanism was written on this component — infer it from the flows below and say what you assumed._',
        sizing ? `Sized for: ${sizing}.` : '',
        '',
      ]);
    });
  return nl(['## Components to build', '', ...rows]);
}

function flowSection(graph: GraphDSL, name: (id: string) => string): string {
  if (graph.flows.length === 0) {
    return nl([
      '## Request paths',
      '',
      'No flows were declared. Derive them from the connections, and state the order you assumed —',
      'a component diagram without request paths does not determine behaviour.',
      '',
    ]);
  }
  const blocks = graph.flows.map((f) =>
    nl([
      `### ${f.name} (${f.kind}, ${f.rps} rps)`,
      f.description ? f.description : '',
      '',
      ...f.steps.map((s, i) => `${i + 1}. ${name(s)} \`${s}\``),
      '',
    ]),
  );
  return nl([
    '## Request paths',
    '',
    'Implement these in order. Each step is a real hop: a call, a queue publish, or a read.',
    '',
    ...blocks,
  ]);
}

function invariantSection(graph: GraphDSL): string {
  const invariants: string[] = [];
  const types = new Set(graph.nodes.map((n) => n.type));
  const has = (t: string) => types.has(t as never);

  for (const e of graph.edges) {
    const from = graph.nodes.find((n) => n.id === e.from);
    const to = graph.nodes.find((n) => n.id === e.to);
    if (!from || !to) continue;
    if (e.kind === 'async') {
      invariants.push(
        `\`${from.label} → ${to.label}\` is asynchronous: the caller must not wait on it, and the consumer must tolerate duplicate delivery.`,
      );
    }
    if (e.kind === 'replication') {
      invariants.push(
        `\`${from.label} → ${to.label}\` is replication: reads from ${to.label} may be stale, so a read-after-write must not be served from it.`,
      );
    }
  }
  if (has('payment_gateway') || has('third_party')) {
    invariants.push(
      'Every call to a third party carries a timeout, a bounded retry with jitter, and an idempotency key where it has an effect.',
    );
  }
  if (has('queue') || has('stream')) {
    invariants.push('Queue consumers are idempotent per message id; queues are bounded and shed rather than buffer without limit.');
  }
  if (has('dead_letter_queue')) {
    invariants.push('The dead-letter queue is alarmed on depth greater than zero and has a documented replay path.');
  }
  if (has('cache')) {
    invariants.push('The cache is never the only copy of anything, and one hot key expiring must not send every reader to the database at once.');
  }
  if (has('llm') || has('extractor') || has('agent_runtime')) {
    invariants.push(
      'Model output is untrusted until validated, and retrieved or tool-supplied text is data — never concatenated into the instruction channel.',
    );
  }
  if (has('human_review')) {
    invariants.push('The human-review step is off the synchronous path; the caller gets an accepted-for-processing response, not a wait.');
  }

  if (invariants.length === 0) return '';
  return nl([
    '## Invariants',
    '',
    'These follow from the connection kinds and the components chosen. Breaking one is a design change,',
    'not an implementation detail.',
    '',
    ...invariants.map((i) => `- ${i}`),
    '',
  ]);
}

function capacitySection(sim?: SimResult): string {
  if (!sim) return '';
  const hot = sim.nodes
    .filter((n) => n.utilization >= 0.5 || n.droppedRps > 0)
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 8)
    .map(
      (n) =>
        `- \`${n.nodeId}\`: ${Math.round(n.utilization * 100)}% utilized at the declared load, ${n.latencyMs.toFixed(
          0,
        )}ms${n.droppedRps > 0 ? `, shedding ${n.droppedRps.toFixed(0)} rps` : ''}`,
    );
  return nl([
    '## Capacity the design assumes',
    '',
    `A deterministic capacity model over the declared flows: ${sim.verdict}`,
    `Estimated cost of the drawn components: $${Math.round(sim.monthlyCost)}/month.`,
    '',
    ...(hot.length > 0
      ? ['Components with meaningful load — these are the ones whose sizing is load-bearing:', ...hot]
      : ['Nothing is above half its capacity at the declared load.']),
    '',
  ]);
}

function absentSection(checks: TopologyFinding[]): string {
  if (checks.length === 0) return '';
  return nl([
    '## Known gaps in this design',
    '',
    'A deterministic rule engine found these. They are stated so you do not silently "fix" them, and',
    'so you know what the design is currently choosing not to handle.',
    '',
    ...checks.slice(0, 12).map((f) => `- **${f.rule}** (${f.severity}): ${f.message} → ${f.fix}`),
    '',
  ]);
}

function acceptanceSection(problem: Problem | undefined, graph: GraphDSL): string {
  const items: string[] = [];
  for (const f of graph.flows) {
    items.push(`\`${f.name}\` completes end to end at ${f.rps} rps without dropping requests.`);
  }
  if (problem) {
    for (const s of problem.scenarios) {
      items.push(
        `Under "${s.name}" (${s.rpsMultiplier}x load${
          s.killNodes?.length ? `, ${s.killNodes.join(' and ')} offline` : ''
        }): ${s.passCriteria}`,
      );
    }
  }
  if (items.length === 0) return '';
  return nl([
    '## Acceptance',
    '',
    'The build is not done until each of these can be demonstrated, by a load test or a fault injection',
    'rather than by inspection.',
    '',
    ...items.map((i) => `- [ ] ${i}`),
    '',
  ]);
}
