import { Hono } from 'hono';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attempt, GraphDSL, ScoreResult } from '@archdojo/shared';
import { db } from '../db.js';
import { findProblem } from '../problems/routes.js';

export const exportRoutes = new Hono();

const VAULT_DIR = process.env.ARCHDOJO_EXPORT_DIR ?? 'D:\\Obsidian_notes_206\\Notes\\ArchDojo';

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
tags: [archdojo, architecture, system-design]
problem: ${attempt.problemId}
level: ${level}
score: ${attempt.overall}
round: ${attempt.round}
date: ${attempt.createdAt}
---

# ArchDojo — ${problemTitle} (${attempt.overall}/100)

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

exportRoutes.post('/export/:attemptId', (c) => {
  const id = Number(c.req.param('attemptId'));
  const row = db().prepare('SELECT * FROM attempts WHERE id = ?').get(id) as
    | {
        id: number;
        problem_id: string;
        round: number;
        graph_json: string;
        score_json: string;
        overall: number;
        twist_text: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return c.json({ error: { code: 'not_found', message: 'No such attempt' } }, 404);

  const attempt: Attempt = {
    id: row.id,
    problemId: row.problem_id,
    round: row.round,
    graph: JSON.parse(row.graph_json) as GraphDSL,
    score: JSON.parse(row.score_json) as ScoreResult,
    overall: row.overall,
    ...(row.twist_text ? { twistText: row.twist_text } : {}),
    createdAt: row.created_at,
  };

  const problem = findProblem(attempt.problemId);
  const title = problem?.title ?? attempt.problemId;
  const level = problem?.level ?? 0;

  mkdirSync(VAULT_DIR, { recursive: true });
  const date = attempt.createdAt.slice(0, 10);
  const slug = attempt.problemId.replace(/[^a-z0-9-]/gi, '-');
  let file = join(VAULT_DIR, `${date} ArchDojo ${slug} r${attempt.round}.md`);
  let n = 2;
  while (existsSync(file)) {
    file = join(VAULT_DIR, `${date} ArchDojo ${slug} r${attempt.round}-${n}.md`);
    n += 1;
  }
  writeFileSync(file, markdown(attempt, title, level), 'utf8');
  return c.json({ ok: true, path: file });
});
