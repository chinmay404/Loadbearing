import type { GraphDSL, Problem, SimResult } from '@archdojo/shared';
import { CONCEPT_CARDS } from '@archdojo/shared';

const GRADER_PERSONA = `You are a staff engineer running a rigorous architecture design review. You have shipped
systems at scale and you have been burned by every shortcut in the book. You are honest, specific,
and generous with teaching — but you never inflate a score.

How you review:
- Judge the design ONLY against the stated requirements, numbers, and constraints. A design that
  meets a 500-RPS requirement does not need Kafka, and you will say so.
- Name concrete failure scenarios, not categories. Not "reliability could be improved" but
  "a client retry on POST /charge with no idempotency key charges the card twice".
- Penalise overengineering as hard as underengineering. Microservices with a team of 3, Kubernetes
  for one container, event sourcing for CRUD, multi-region before product-market fit: these lose
  points under cost_simplicity, and you explain the simpler design that was available.
- Absences are findings. No timeouts, no dead-letter queue, no idempotency, no rate limiter, no
  observability, no eval gate on an LLM path — call each one out even though nothing was drawn.
- Read the annotations and sticky notes as part of the answer. Reasoning written on a node counts;
  a box labelled "Cache" with no strategy stated does not earn the caching concept.
- Read the declared flows as the load-bearing part of the answer. A correct-looking box diagram with
  an incoherent write path is a weak design, and a modest diagram with a rigorous flow is a strong one.
- Where the learner got something right, say exactly why it was right, so they can repeat the reasoning.

Scoring anchors (each dimension is out of 10):
9-10 = a senior engineer would ship this; the hard cases are handled explicitly.
7-8  = sound shape, one or two real gaps.
5-6  = plausible but naive; misses a failure mode that WILL occur at the stated scale.
3-4  = major requirement or failure mode unaddressed.
0-2  = the design does not work at the stated numbers, or is largely empty.
overall = the weighted whole-design verdict out of 100 — NOT the plain average. A high-severity
critical failure on the money/data path caps overall at 65 no matter how pretty the rest is.`;

const OUTPUT_CONTRACT = `Reply with ONLY a JSON object, no prose and no code fences, matching exactly:

{
  "overall": <integer 0-100>,
  "dimensions": {
    "requirements":     { "score": <0-10>, "max": 10, "notes": "<2-4 sentences, specific>" },
    "scalability":      { "score": <0-10>, "max": 10, "notes": "..." },
    "reliability":      { "score": <0-10>, "max": 10, "notes": "..." },
    "data_consistency": { "score": <0-10>, "max": 10, "notes": "..." },
    "security":         { "score": <0-10>, "max": 10, "notes": "..." },
    "cost_simplicity":  { "score": <0-10>, "max": 10, "notes": "<judge overengineering here>" }
  },
  "critical_failures": [
    { "title": "<short name of the bug>", "detail": "<the exact sequence that produces it, and the fix>",
      "concept": "<concept id from the taxonomy>", "severity": "high" | "medium" | "low" }
  ],
  "spofs": ["<component whose loss takes the system down, and what breaks>"],
  "missing": ["<component or mechanism absent from the design that the requirements demand>"],
  "good_calls": ["<a decision that was right, and why it was right>"],
  "socratic_questions": ["<question that forces the learner to find the next gap themselves>"],
  "concept_scores": { "<concept-id>": <0.0-1.0 mastery shown for that concept in THIS design> },
  "model_answer_summary": "<8-14 sentences: how a strong engineer would solve this, including the numbers, the key mechanisms, and what they would deliberately NOT build>",
  "verdict_teaching": [
    { "component": "<component in the chosen/correct design>", "why": "<which requirement or constraint forces it>",
      "breaks_without": "<what fails if it is absent>", "rejected_alt": "<the alternative and why it loses here>" }
  ],
  "canvas_markup": [
    { "nodeId": "<an id from the submitted nodes list>", "marker": "spof" | "missing" | "good" | "question" | "bottleneck",
      "comment": "<one short line pinned to that node on their canvas>" }
  ],
  "suggested_additions": [
    { "type": "<node type from the allowed list>", "label": "<name>", "annotation": "<the mechanism/config that matters>",
      "connect_from": "<existing node id or omit>", "connect_to": "<existing node id or omit>",
      "kind": "sync" | "async" | "replication", "why": "<the requirement it satisfies>" }
  ],
  "flow_reviews": [
    { "flowName": "<declared or expected flow name>", "verdict": "sound" | "flawed" | "missing",
      "issues": ["<what goes wrong at which step>"] }
  ],
  "decision_summary": "<one sentence naming the architectural decision this design represents, in ADR voice: 'Serve the catalog read path from a cache-aside Redis layer in front of a single Postgres primary.'>",
  "alternatives": [
    { "option": "<a design a reviewer would have weighed>", "why_not": "<why it loses under THESE constraints>" }
  ],
  "risks": [
    { "risk": "<the risk>", "likelihood": "high" | "medium" | "low",
      "impact": "<what the user or the business feels>", "mitigation": "<the concrete next step>" }
  ],
  "at_10x": "<3-5 sentences: what breaks or has to change FIRST at ten times the traffic, ten times the data, and ten times the team — in that order of likelihood, with the numbers>"
}

Rules for the fields:
- dimensions: all six keys are required. Never omit one — if you have little evidence for a dimension,
  score it and say in the notes what evidence was missing.
- concept_scores: score EVERY concept id listed in "Rubric concepts" for this problem, plus any other
  taxonomy concept the design clearly demonstrated or clearly botched. Use the taxonomy ids verbatim.
- canvas_markup: 3-8 entries, each nodeId MUST be one of the submitted node ids. This is drawn on the
  learner's own diagram, so keep comments under ~90 characters.
- suggested_additions: 1-5 components they should add. connect_from/connect_to MUST be submitted node ids.
- flow_reviews: one entry per expected flow, plus any extra flow the learner declared.
- critical_failures: only real, reachable failures. Empty array is allowed for an excellent design.
- risks: exactly three, ordered most serious first. These go straight into an Architecture Decision
  Record, so write them the way a staff engineer writes them for a team that will read this in a year.
- alternatives: 2-3 entries. Name the real fork in the road, not a straw man.`;

/**
 * The rubric concepts get their full card — summary and the red flag to hunt for.
 * Everything else is just an id, so the grader can still score a concept it spots
 * without us paying for 45 descriptions it does not need. Keeping this lean is what
 * lets small free-tier models run a review at all.
 */
function conceptTaxonomyBlock(ids: string[]): string {
  const wanted = new Set(ids);
  const focused = CONCEPT_CARDS.filter((c) => wanted.has(c.id)).map(
    (c) => `* ${c.id} — ${c.name}: ${c.summary} Red flag: ${c.redFlags}`,
  );
  const rest = CONCEPT_CARDS.filter((c) => !wanted.has(c.id)).map((c) => c.id);
  return `${focused.join('\n')}

Other valid concept ids (use them if the design demonstrates or botches one, no description needed):
${rest.join(', ')}`;
}

function allowedNodeTypes(): string {
  return [
    'client, mobile_client, cdn, dns, load_balancer, api_gateway, service, monolith, serverless_fn,',
    'cache, sql_db, nosql_db, blob_store, search_index, queue, stream, worker, scheduler,',
    'rate_limiter, websocket_gw, third_party, llm, vector_db, embedding_svc, eval_gate,',
    'observability, auth',
  ].join(' ');
}

function renderProblem(p: Problem): string {
  const nf = Object.entries(p.nonFunctional)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');
  return `PROBLEM (level ${p.level}/6, domain: ${p.domain})
Title: ${p.title}

${p.prompt}

Functional requirements:
${p.functional.map((f) => `  - ${f}`).join('\n')}

Non-functional / numbers:
${nf}

Hard constraints (these decide what is overengineering):
${p.constraints.map((c) => `  - ${c}`).join('\n')}

Flows the answer is expected to define: ${p.expectedFlows.join('; ')}

Rubric concepts (marked with * in the taxonomy below — score every one):
${p.concepts.join(', ')}

Interviewer notes — failure modes to hunt for in this specific problem:
${p.rubricHints}`;
}

export function renderGraph(graph: GraphDSL): string {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => {
    const n = nodeById.get(id);
    return n ? `${n.label} [${n.id}]` : `UNKNOWN[${id}]`;
  };

  const nodes = graph.nodes.length
    ? graph.nodes
        .map((n) => {
          const attrs = n.attrs
            ? Object.entries(n.attrs)
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : '';
          const parts = [`- id=${n.id} type=${n.type} label="${n.label}"`];
          if (n.annotation.trim()) parts.push(`  annotation: ${n.annotation.trim()}`);
          if (attrs) parts.push(`  attrs: ${attrs}`);
          if (n.parentId) parts.push(`  inside group: ${name(n.parentId)}`);
          return parts.join('\n');
        })
        .join('\n')
    : '(no components drawn)';

  const edges = graph.edges.length
    ? graph.edges
        .map((e) => {
          const arrow = e.kind === 'sync' ? '--sync-->' : e.kind === 'async' ? '~~async~~>' : '==repl==>';
          return `- ${name(e.from)} ${arrow} ${name(e.to)}${e.label ? ` : ${e.label}` : ''}`;
        })
        .join('\n')
    : '(no connections drawn)';

  const flows = graph.flows.length
    ? graph.flows
        .map(
          (f) =>
            `- "${f.name}" (${f.kind}, ${f.rps} rps baseline): ${f.steps.map(name).join(' -> ')}${
              f.description ? `\n  intent: ${f.description}` : ''
            }`,
        )
        .join('\n')
    : '(no flows declared — the learner did not state how a request travels through the design)';

  const stickies = graph.stickies.length
    ? graph.stickies.map((s) => `- ${s.text}`).join('\n')
    : '(none)';

  return `COMPONENTS
${nodes}

CONNECTIONS
${edges}

DECLARED FLOWS
${flows}

LEARNER'S NOTES (sticky notes — treat as part of their answer)
${stickies}`;
}

function renderSim(sim: SimResult): string {
  const hot = sim.nodes
    .filter((n) => n.utilization >= 0.7 || n.state === 'down' || n.droppedRps > 0)
    .slice(0, 10)
    .map(
      (n) =>
        `  - ${n.nodeId}: utilization ${n.utilization.toFixed(2)}, ${n.latencyMs.toFixed(0)}ms, dropped ${n.droppedRps.toFixed(
          0,
        )} rps, state ${n.state}`,
    )
    .join('\n');
  const flows = sim.flows
    .map(
      (f) =>
        `  - ${f.name}: offered ${f.offeredRps.toFixed(0)} rps, completed ${f.completedRps.toFixed(
          0,
        )} rps, p99 ${f.p99Ms.toFixed(0)}ms${f.broken ? `, BROKEN at ${f.brokenAt}` : ''}`,
    )
    .join('\n');
  return `SIMULATOR RESULT (a deterministic capacity model already ran against this design — use it as evidence, and correct it if the model is being naive)
${sim.verdict}
Estimated monthly cost of drawn components: $${Math.round(sim.monthlyCost)}
Hot or failed components:
${hot || '  (none — everything under 70% utilization)'}
Flows:
${flows || '  (no flows)'}
Model findings:
${sim.findings.map((f) => `  - ${f}`).join('\n') || '  (none)'}`;
}

export interface ScoringPromptInput {
  problem: Problem;
  graph: GraphDSL;
  sim?: SimResult;
  twist?: { text: string; previousOverall: number };
}

export function buildScoringPrompt(input: ScoringPromptInput): { system: string; user: string } {
  const { problem, graph, sim, twist } = input;

  const system = `${GRADER_PERSONA}

CONCEPT TAXONOMY (use these ids verbatim in concept_scores and critical_failures.concept; lines marked * are this problem's rubric):
${conceptTaxonomyBlock(problem.concepts)}

Allowed node types for suggested_additions: ${allowedNodeTypes()}

${OUTPUT_CONTRACT}`;

  const twistBlock = twist
    ? `
ROUND 2 — TWIST APPLIED
The learner already scored ${twist.previousOverall}/100 on round 1. This constraint then changed:
"${twist.text}"

The design below is their ADAPTATION. Grade the whole design again, but weight heavily whether the
adaptation actually addresses the twist. In requirements.notes, state plainly whether they adapted
correctly, partially, or not at all. If their round-1 design already handled the twist by luck rather
than intent, say so.
`
    : '';

  const user = `${renderProblem(problem)}
${twistBlock}
=== THE LEARNER'S DESIGN ===
${renderGraph(graph)}
${sim ? `\n${renderSim(sim)}\n` : ''}
Review this design now. Output only the JSON object.`;

  return { system, user };
}

export function buildCritiquePrompt(problem: Problem, graph: GraphDSL, question: string): { system: string; user: string } {
  const system = `You are a staff engineer sitting next to a learner at a whiteboard, looking at the design they
have drawn. Answer their question directly and concretely, in at most 200 words, in the context of THIS design
and THIS problem's numbers. Teach the trade-off, do not just give the answer. If their design has a flaw
relevant to the question, say so plainly. Never invent components they did not draw when describing what they have.

You may also draw on their canvas. Reply with ONLY a JSON object:
{
  "answer": "<your reply in markdown, <=200 words>",
  "canvas_markup": [{ "nodeId": "<a submitted node id>", "marker": "spof"|"missing"|"good"|"question"|"bottleneck", "comment": "<=90 chars" }],
  "suggested_additions": [{ "type": "<allowed node type>", "label": "...", "annotation": "...", "connect_from": "<node id or omit>", "connect_to": "<node id or omit>", "kind": "sync"|"async"|"replication", "why": "..." }]
}
Both arrays may be empty when the question is purely conceptual. Allowed node types: ${allowedNodeTypes()}`;

  const user = `${renderProblem(problem)}

=== THE DESIGN ON THE WHITEBOARD ===
${renderGraph(graph)}

=== THE LEARNER ASKS ===
${question}`;

  return { system, user };
}

export function buildProblemGenPrompt(level: number, concepts: string[]): { system: string; user: string } {
  const conceptIds = CONCEPT_CARDS.map((c) => c.id).join(', ');
  const system = `You author system-design interview problems for an architecture training app. Problems must be
realistic, numerically concrete, and solvable in a 30-minute whiteboard session. Difficulty scale:
1 = single-service fundamentals, 3 = reliability and correctness under retries, 5 = distributed hard mode
(multi-region, exactly-once, tenant isolation), 6 = AI/LLM systems.

Reply with ONLY a JSON object:
{
  "id": "<kebab-case, prefixed l${level}->",
  "title": "<short>",
  "level": ${level},
  "domain": "<e.g. fintech, social, devtools, ai-platform>",
  "prompt": "<3-6 sentences: business framing, real numbers, and the tension that makes it hard>",
  "functional": ["<3-6 capabilities>"],
  "nonFunctional": { "peakRps": <number>, "p99Ms": <number>, "<other keys with real numbers>": "..." },
  "constraints": ["<2-4 hard limits: team size, budget, compliance, existing stack>"],
  "concepts": [<the concept ids below, plus any others that the answer must demonstrate>],
  "expectedFlows": ["<2-4 lowercase flow names, e.g. 'checkout write path'>"],
  "rubricHints": "<2-5 sentences naming the SPECIFIC bugs a grader should hunt for — name the bug, not the category>",
  "twists": ["<2-3 constraint changes with numbers that force a redesign>"],
  "scenarios": [
    { "id": "<kebab>", "name": "<short>", "description": "<what is being tested>",
      "rpsMultiplier": <1|5|10|20|50>, "killNodes": ["<lowercase component word likely drawn, e.g. 'cache'>"],
      "thirdPartyLatencyMs": <0-5000>, "passCriteria": "<one sentence: what must still hold>" }
  ]
}
Use only these concept ids:
${conceptIds}`;

  const user = `Write one level-${level} problem that forces the learner to demonstrate these concepts they are weak on:
${concepts.join(', ')}

Make the weakness concepts unavoidable: the problem should be unsolvable without reasoning about them.`;
  return { system, user };
}
