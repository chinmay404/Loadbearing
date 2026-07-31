import { Hono } from 'hono';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeScore } from '@loadbearing/shared';
import type { Attempt, GraphDSL, Problem, ScoreResult } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import type { AttemptRow } from '../storage/types.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';
import { findProblem } from '../problems/routes.js';
import { sanitizeGraph } from '../scoring/validate.js';
import { buildImplementationBrief } from './brief.js';

export const exportRoutes = new Hono<AppEnv>();

/** Writing into an Obsidian vault only makes sense where there is a filesystem. */
const CAN_WRITE_FILES = !process.env.VERCEL;

const toAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  problemId: r.problemId,
  round: r.round,
  graph: JSON.parse(r.graphJson) as GraphDSL,
  score: normalizeScore(JSON.parse(r.scoreJson) as Partial<ScoreResult>),
  overall: r.overall,
  ...(r.twistText ? { twistText: r.twistText } : {}),
  createdAt: r.createdAt,
});

const VAULT_DIR = process.env.LOADBEARING_EXPORT_DIR ?? 'D:\\Obsidian_notes_206\\Notes\\Loadbearing';

function mermaid(graph: GraphDSL): string {
  const safe = (s: string) => s.replace(/["\n]/g, ' ').trim();
  const lines = ['```mermaid', 'graph LR'];
  for (const n of graph.nodes) lines.push(`  ${n.id}["${safe(n.label)}<br/><i>${n.type}</i>"]`);
  for (const e of graph.edges) {
    const arrow = e.kind === 'sync' ? '-->' : e.kind === 'async' ? '-.->' : '==>';
    lines.push(`  ${e.from} ${arrow}${e.label ? `|${safe(e.label)}|` : ''} ${e.to}`);
  }
  lines.push('```');
  return lines.join('\n');
}

function markdown(attempt: Attempt, problemTitle: string, level: number): string {
  const s: ScoreResult = attempt.score;
  const dim = Object.entries(s.dimensions)
    .map(([k, v]) => `| ${k.replace(/_/g, ' ')} | ${v.score}/${v.max} | ${v.notes.replace(/\|/g, '/')} |`)
    .join('\n');

  const failures = s.critical_failures.length
    ? s.critical_failures
        .map((f) => `- **${f.title}** (${f.severity}${f.concept ? `, ${f.concept}` : ''}) — ${f.detail}`)
        .join('\n')
    : '- none found';

  const flows = attempt.graph.flows.length
    ? attempt.graph.flows
        .map((f) => {
          const byId = new Map(attempt.graph.nodes.map((n) => [n.id, n.label]));
          return `- **${f.name}** (${f.kind}, ${f.rps} rps): ${f.steps.map((x) => byId.get(x) ?? x).join(' → ')}`;
        })
        .join('\n')
    : '- no flows declared';

  return `---
tags: [loadbearing, architecture, system-design]
problem: ${attempt.problemId}
level: ${level}
score: ${attempt.overall}
round: ${attempt.round}
date: ${attempt.createdAt}
---

# Loadbearing — ${problemTitle} (${attempt.overall}/100)

Round ${attempt.round}${attempt.twistText ? ` · twist: ${attempt.twistText}` : ''}

## My design

${mermaid(attempt.graph)}

### Flows I declared
${flows}

## Scores

| dimension | score | notes |
| --- | --- | --- |
${dim}

## What was wrong
${failures}

### Single points of failure
${s.spofs.map((x) => `- ${x}`).join('\n') || '- none named'}

### Missing
${s.missing.map((x) => `- ${x}`).join('\n') || '- nothing flagged'}

## What was right
${s.good_calls.map((x) => `- ${x}`).join('\n') || '- nothing flagged'}

## Questions I could not yet answer
${s.socratic_questions.map((x) => `- ${x}`).join('\n') || '- none'}

## How a strong engineer would solve it
${s.model_answer_summary}

## Component teaching
${
  s.verdict_teaching
    .map(
      (t) =>
        `### ${t.component}\n- **Why:** ${t.why}\n- **Breaks without it:** ${t.breaks_without}\n- **Rejected alternative:** ${t.rejected_alt}`,
    )
    .join('\n\n') || '_none returned_'
}

## Links
- [[Architectures MOC]]
- [[Home MOC]]
`;
}

/**
 * An Architecture Decision Record, in the form a team reads a year later:
 * context and constraints, the decision, the alternatives weighed, consequences,
 * risks with mitigations, and what changes first at ten times the load.
 */
function adr(attempt: Attempt, problem: Problem | undefined, title: string): string {
  const s = attempt.score;
  const byId = new Map(attempt.graph.nodes.map((n) => [n.id, n.label]));
  const status = s.overall >= 80 ? 'Accepted' : s.overall >= 60 ? 'Proposed' : 'Draft — not ready to accept';

  const constraints = problem
    ? [
        ...problem.constraints,
        ...Object.entries(problem.nonFunctional).map(([k, v]) => `${k}: ${v}`),
      ]
    : [];

  const components = attempt.graph.nodes
    .map((n) => `| ${n.label} | ${n.type} | ${n.annotation.replace(/\|/g, '/') || '—'} |`)
    .join('\n');

  return `---
tags: [loadbearing, adr, architecture]
adr: ${attempt.problemId}-r${attempt.round}
status: ${status}
score: ${attempt.overall}
date: ${attempt.createdAt}
---

# ADR — ${title}

**Status:** ${status} · **Reviewed score:** ${attempt.overall}/100 · **Revision:** ${attempt.round}

## Context

${problem?.prompt ?? 'No problem statement recorded.'}

${constraints.length ? `Constraints that drove this decision:\n${constraints.map((x) => `- ${x}`).join('\n')}` : ''}

## Decision

${s.decision_summary || 'No decision summary was recorded for this attempt.'}

${mermaid(attempt.graph)}

### Components and the mechanism each carries

| Component | Kind | Mechanism |
| --- | --- | --- |
${components || '| — | — | — |'}

### Request flows

${
  attempt.graph.flows.length
    ? attempt.graph.flows
        .map(
          (f) =>
            `- **${f.name}** (${f.kind}, ${f.rps} rps): ${f.steps.map((x) => byId.get(x) ?? x).join(' → ')}${
              f.description ? ` — ${f.description}` : ''
            }`,
        )
        .join('\n')
    : '- No flows were declared.'
}

## Alternatives considered

${
  s.alternatives.length
    ? s.alternatives.map((a) => `### ${a.option}\nRejected because: ${a.why_not}`).join('\n\n')
    : '_None recorded._'
}

## Consequences

${
  s.verdict_teaching.length
    ? s.verdict_teaching
        .map(
          (t) =>
            `- **${t.component}** — needed because ${t.why} Without it: ${t.breaks_without} Alternative rejected: ${t.rejected_alt}`,
        )
        .join('\n')
    : '_None recorded._'
}

### Known weaknesses in this design

${
  s.critical_failures.length
    ? s.critical_failures
        .map((f) => `- **${f.title}** (${f.severity}) — ${f.detail}`)
        .join('\n')
    : '- None found in review.'
}

${s.spofs.length ? `### Single points of failure\n${s.spofs.map((x) => `- ${x}`).join('\n')}` : ''}

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
${
  s.risks.length
    ? s.risks
        .map((r) => `| ${r.risk} | ${r.likelihood} | ${r.impact.replace(/\|/g, '/')} | ${r.mitigation.replace(/\|/g, '/')} |`)
        .join('\n')
    : '| — | — | — | — |'
}

## At ten times the load

${s.at_10x || '_Not recorded._'}

## Open questions

${s.socratic_questions.length ? s.socratic_questions.map((q) => `- ${q}`).join('\n') : '- None.'}

## Links
- [[Architectures MOC]]
- [[Home MOC]]
`;
}

/**
 * The current canvas as a build specification for a coding agent. Takes the graph
 * from the request rather than an attempt id, because the useful moment for this
 * is while you are still drawing, not only after a review.
 *
 * Registered BEFORE `/export/:attemptId` deliberately: routes match in order, and
 * with the parameterised one first this literal path arrives as an attempt whose
 * id is the string "brief".
 */
exportRoutes.post('/export/brief', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { graph?: unknown; problemId?: string };
  const graph = sanitizeGraph(body.graph);
  if (graph.nodes.length === 0) {
    return c.json(
      { error: { code: 'empty_design', message: 'Draw the design before exporting it.' } },
      400,
    );
  }
  const store = await storage();
  const userId = c.get('userId');
  const problem = body.problemId ? await findProblem(store, userId, String(body.problemId)) : undefined;
  const { markdown } = buildImplementationBrief({ graph, problem });
  return c.json({ markdown, filename: `${problem?.id ?? 'design'}-implementation-brief.md` });
});

exportRoutes.post('/export/:attemptId', requireUser, async (c) => {
  if (!CAN_WRITE_FILES) {
    return c.json(
      {
        error: {
          code: 'no_filesystem',
          message: 'This deployment has no writable filesystem, so it cannot write into your vault.',
          hint: 'Use "copy as text" instead, or run Loadbearing locally to export straight into Obsidian.',
        },
      },
      501,
    );
  }
  const store = await storage();
  const userId = c.get('userId');
  const row = await store.getAttempt(userId, Number(c.req.param('attemptId')));
  if (!row) return c.json({ error: { code: 'not_found', message: 'No such attempt' } }, 404);

  const attempt = toAttempt(row);
  const problem = await findProblem(store, userId, attempt.problemId);
  const title = problem?.title ?? attempt.problemId;
  const level = problem?.level ?? 0;

  const format = c.req.query('format') === 'adr' ? 'adr' : 'review';

  mkdirSync(VAULT_DIR, { recursive: true });
  const date = attempt.createdAt.slice(0, 10);
  const slug = attempt.problemId.replace(/[^a-z0-9-]/gi, '-');
  const kind = format === 'adr' ? 'ADR' : 'Loadbearing';
  let file = join(VAULT_DIR, `${date} ${kind} ${slug} r${attempt.round}.md`);
  let n = 2;
  while (existsSync(file)) {
    file = join(VAULT_DIR, `${date} ${kind} ${slug} r${attempt.round}-${n}.md`);
    n += 1;
  }
  const body = format === 'adr' ? adr(attempt, problem, title) : markdown(attempt, title, level);
  writeFileSync(file, body, 'utf8');
  return c.json({ ok: true, path: file });
});

/** The same two documents, returned as text for copying into a PR or a doc. */
exportRoutes.get('/export/:attemptId/text', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const row = await store.getAttempt(userId, Number(c.req.param('attemptId')));
  if (!row) return c.json({ error: { code: 'not_found', message: 'No such attempt' } }, 404);

  const attempt = toAttempt(row);
  const problem = await findProblem(store, userId, attempt.problemId);
  const title = problem?.title ?? attempt.problemId;
  const format = c.req.query('format') === 'adr' ? 'adr' : 'review';
  return c.json({
    format,
    text: format === 'adr' ? adr(attempt, problem, title) : markdown(attempt, title, problem?.level ?? 0),
  });
});
