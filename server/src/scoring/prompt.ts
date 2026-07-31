import type {
  ChatTurn,
  GraphDSL,
  Problem,
  ScenarioVerdict,
  SimResult,
  TopologyFinding,
} from '@loadbearing/shared';
import { CONCEPT_CARDS } from '@loadbearing/shared';

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
      "concept": "<concept id from the taxonomy>", "severity": "high" | "medium" | "low",
      "refs": ["<key from the trusted reference material that establishes this, or [] if none applies>"] }
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
  "at_10x": "<3-5 sentences: what breaks or has to change FIRST at ten times the traffic, ten times the data, and ten times the team — in that order of likelihood, with the numbers>",
  "references_used": ["<keys from the trusted reference material you actually reasoned from>"]
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
- alternatives: 2-3 entries. Name the real fork in the road, not a straw man.
- refs / references_used: cite ONLY keys that appear in the trusted reference material given to you.
  Invented keys are discarded. A finding the reference material covers and that you state without
  citing it is a worse answer, because the learner cannot go and read the source.`;

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

function renderChecks(findings: TopologyFinding[]): string {
  if (findings.length === 0) {
    return `STRUCTURAL CHECKS
A deterministic rule engine found nothing wrong with how the components are wired. That is a
genuine positive — say so if it is deserved, but it says nothing about whether the design meets
the requirements.`;
  }
  const lines = findings
    .slice(0, 14)
    .map((f) => `  - [${f.severity}] ${f.rule}: ${f.message}`)
    .join('\n');
  return `STRUCTURAL CHECKS (a deterministic rule engine already ran — these are facts about the wiring, not opinions)
${lines}

Do not simply restate these. They are the floor, not the review: assume the learner can already see
them, and spend your findings on what a rule engine cannot judge — whether the design actually meets
the numbers, where the trade-offs are wrong, and what a reviewer would push back on.`;
}

function renderGates(gates: ScenarioVerdict[]): string {
  if (gates.length === 0) return '';
  const lines = gates
    .map(
      (g) =>
        `  - ${g.name}: ${g.pass ? 'PASS' : 'FAIL'} — ${g.reasons.join(' ')}` +
        ` (dropped ${g.metrics.droppedPct.toFixed(1)}%, worst p99 ${Math.round(g.metrics.worstP99Ms)}ms${
          g.metrics.brokenFlows.length ? `, broken: ${g.metrics.brokenFlows.join(', ')}` : ''
        })`,
    )
    .join('\n');
  return `SCENARIO GATES (the capacity model ran every load scenario against this design — these results are facts)
${lines}`;
}

function renderChanges(changes: string[]): string {
  if (changes.length === 0) {
    return `WHAT CHANGED SINCE THE PREVIOUS ROUND
Nothing — the design is identical to the last submission. If the twist demanded a change, say so plainly.`;
  }
  return `WHAT CHANGED SINCE THE PREVIOUS ROUND (computed diff — judge whether these changes actually address the twist)
${changes.map((l) => `  ${l}`).join('\n')}`;
}

export interface ScoringPromptInput {
  problem: Problem;
  graph: GraphDSL;
  sim?: SimResult;
  checks?: TopologyFinding[];
  gates?: ScenarioVerdict[];
  /** renderDiffLines output vs the previous round's graph. */
  changes?: string[];
  twist?: { text: string; previousOverall: number };
  /**
   * Retrieved playbook entries, rendered. Goes in the user message rather than
   * the system prompt: it varies per problem, and the system prefix has to stay
   * byte-identical across reviews for provider-side caching to hit.
   */
  reference?: string;
}

export function buildScoringPrompt(input: ScoringPromptInput): { system: string; user: string } {
  const { problem, graph, sim, checks, gates, changes, twist, reference } = input;

  // Ordered for provider-side prefix caching (DeepSeek/Groq/OpenAI cache by
  // exact prefix; Anthropic via cache_control): everything identical across
  // ALL reviews comes first, the per-problem taxonomy last. Reordering this
  // is what lets a review of a different problem still hit the cached prefix.
  const system = `${GRADER_PERSONA}

Allowed node types for suggested_additions: ${allowedNodeTypes()}

${OUTPUT_CONTRACT}

CONCEPT TAXONOMY (use these ids verbatim in concept_scores and critical_failures.concept; lines marked * are this problem's rubric):
${conceptTaxonomyBlock(problem.concepts)}`;

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
${gates && gates.length ? `\n${renderGates(gates)}\n` : ''}
${checks ? `\n${renderChecks(checks)}\n` : ''}
${twist && changes !== undefined ? `\n${renderChanges(changes)}\n` : ''}
${reference ? `\n${reference}\n` : ''}
Review this design now. Output only the JSON object.`;

  return { system, user };
}

export function buildCritiquePrompt(
  problem: Problem,
  graph: GraphDSL,
  question: string,
  selectedNodeIds: string[] = [],
  reference = '',
  history: ChatTurn[] = [],
): { system: string; user: string } {
  const system = `You are a staff engineer coaching a learner at a whiteboard. The learner learns by DOING:
your job is to sharpen their thinking, never to do the design for them. The moment you hand over the
finished architecture, the exercise is dead — treat the full solution as something you are not allowed
to reveal before they have submitted an attempt for review.

How you coach:
- Answer only the question that was asked, in at most 120 words.
- NEVER enumerate the target architecture or list the components the design needs — not for "what
  should I build", not for an empty canvas, not for a greeting. Give the single most important gap or
  the next question they should ask themselves, and stop.
- Prefer naming the failure mode over naming the component. "What happens when two buyers reserve the
  last seat at once?" teaches more than "add a lock manager".
- If the sketch is empty, do not sketch it for them. Point them at where thinking starts for THIS
  problem — usually the hardest number or the first flow — in 2-3 sentences.
- If it is small talk ("hi", "hello"), reply in one friendly sentence and invite a real question.
- Ground everything in what they actually drew and this problem's numbers. Never invent components
  they did not draw when describing their design.
- This is one continuing conversation. If earlier turns are shown, treat a short follow-up ("why?",
  "and then?", "what about writes") as being about what you just discussed, and do not repeat a point
  you have already made — take it further instead.

You may also mark their canvas. Reply with ONLY a JSON object:
{
  "answer": "<your reply in markdown, <=120 words>",
  "canvas_markup": [{ "nodeId": "<a submitted node id>", "marker": "spof"|"missing"|"good"|"question"|"bottleneck", "comment": "<=90 chars" }],
  "suggested_additions": [{ "type": "<allowed node type>", "label": "...", "annotation": "...", "connect_from": "<node id or omit>", "connect_to": "<node id or omit>", "kind": "sync"|"async"|"replication", "why": "..." }]
}
Rules for the arrays:
- canvas_markup: at most 3 pins, and only ones directly relevant to the question asked.
- suggested_additions: at most ONE, and only when the learner EXPLICITLY asked what component to add
  or what is missing. For any other question — and always on an empty canvas — it must be [].
Allowed node types: ${allowedNodeTypes()}`;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const selected = selectedNodeIds
    .map((id) => nodeById.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const selectionBlock = selected.length
    ? `\n=== THE LEARNER IS POINTING AT ===\n${selected
        .map((n) => `- ${n.label} [${n.id}] (${n.type})${n.annotation ? ` — "${n.annotation}"` : ''}`)
        .join('\n')}\nRead the question as being about these components specifically; anchor markup to them.\n`
    : '';

  // Oldest first, so the last thing before the new question is the previous answer.
  const historyBlock = history.length
    ? `\n=== THE CONVERSATION SO FAR ===\n${history
        .map((t) => `${t.role === 'me' ? 'LEARNER' : 'YOU'}: ${t.text}`)
        .join('\n\n')}\n`
    : '';

  const user = `${renderProblem(problem)}

=== THE DESIGN ON THE WHITEBOARD ===
${renderGraph(graph)}
${selectionBlock}${reference ? `\n${reference}\nUse this material to keep your hint accurate. Do NOT dump it at them — one gap, one question.\n` : ''}${historyBlock}
=== THE LEARNER ASKS ===
${question}`;

  return { system, user };
}

/**
 * Grades the learner's WRITTEN answer to one of the review's follow-up
 * questions. This is where the Socratic loop closes: the question forced them
 * to think, and this tells them whether the thinking was right.
 */
export function buildSocraticPrompt(
  problem: Problem,
  graph: GraphDSL,
  question: string,
  answer: string,
  reference = '',
): { system: string; user: string } {
  const system = `You grade a learner's written answer to a follow-up question from an architecture design
review. Judge the ANSWER, not the design — the design already got its review. Be exact about what they
got right and what they missed; an answer that sounds fluent but dodges the mechanism is a miss.

Verdicts:
- "strong": names the actual mechanism and its consequence correctly. Minor wording slips are fine.
- "partial": right direction, but a load-bearing piece is missing or fuzzy — say which piece.
- "miss": wrong mechanism, wrong consequence, or a non-answer.

Reply with ONLY a JSON object:
{
  "verdict": "strong" | "partial" | "miss",
  "feedback": "<=80 words. What was right, what was missing, and the one thing to remember. Never restate the full solution.>",
  "concept_scores": { "<concept-id>": <0.0-1.0> }
}
concept_scores: score ONLY the concepts this question actually tests (1-3 of them), using ids from this
taxonomy verbatim:
${CONCEPT_CARDS.map((c) => c.id).join(', ')}`;

  const user = `PROBLEM: ${problem.title} (level ${problem.level})
${problem.prompt}

Key numbers: ${Object.entries(problem.nonFunctional)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}

THEIR DESIGN (context for the question):
${renderGraph(graph)}

THE QUESTION THEY WERE ASKED:
${question}

THEIR WRITTEN ANSWER:
"""
${answer}
"""
${reference ? `\n${reference}\nJudge the answer against this material, not against your own recollection.\n` : ''}
Grade the answer now. Output only the JSON object.`;

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
