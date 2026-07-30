import { Hono } from 'hono';
import { CONCEPTS, CONCEPT_CARDS } from '@archdojo/shared';
import type { Problem, ProblemSummary } from '@archdojo/shared';
import { db } from '../db.js';
import { PROBLEM_BANK } from './bank.js';
import { validateProblem } from './validate.js';
import { buildProblemGenPrompt } from '../scoring/prompt.js';
import { completeJson } from '../llm/adapter.js';
import { loadLlmConfig } from '../llm/settings.js';

export const problemRoutes = new Hono();

function customProblems(): Problem[] {
  const rows = db().prepare('SELECT json FROM problems_custom ORDER BY created_at DESC').all() as {
    json: string;
  }[];
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.json) as Problem];
    } catch {
      return [];
    }
  });
}

export function allProblems(): Problem[] {
  return [...PROBLEM_BANK, ...customProblems()];
}

export function findProblem(id: string): Problem | undefined {
  return allProblems().find((p) => p.id === id);
}

const summarize = (p: Problem): ProblemSummary => ({
  id: p.id,
  title: p.title,
  level: p.level,
  domain: p.domain,
  concepts: p.concepts,
  custom: p.custom,
});

/** Concepts the learner is weakest on, plus a level suited to their history. */
export function weaknessTarget(): { level: number; concepts: string[] } {
  const rows = db().prepare('SELECT concept, ema_score FROM mastery').all() as {
    concept: string;
    ema_score: number;
  }[];
  const seen = new Map(rows.map((r) => [r.concept, r.ema_score]));
  const scored = CONCEPTS.map((c) => ({ concept: c, score: seen.has(c) ? seen.get(c)! : 0.4 }));
  scored.sort((a, b) => a.score - b.score);
  const concepts = scored.slice(0, 3).map((s) => s.concept);

  const stats = db().prepare('SELECT COUNT(*) AS n, AVG(overall) AS avg FROM attempts').get() as {
    n: number;
    avg: number | null;
  };
  const base = 1 + Math.floor(stats.n / 5);
  const adjust = (stats.avg ?? 0) >= 75 ? 1 : 0;
  const level = Math.max(1, Math.min(6, base + adjust));
  return { level, concepts };
}

problemRoutes.get('/problems', (c) => c.json(allProblems().map(summarize)));

problemRoutes.get('/problems/:id', (c) => {
  const p = findProblem(c.req.param('id'));
  if (!p) return c.json({ error: { code: 'not_found', message: 'No such problem' } }, 404);
  return c.json(p);
});

problemRoutes.get('/weakness-target', (c) => c.json(weaknessTarget()));

problemRoutes.get('/concepts', (c) => c.json(CONCEPT_CARDS));

problemRoutes.post('/problems/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { level?: number; concepts?: string[] };
  const target = weaknessTarget();
  const level = Math.max(1, Math.min(6, Math.round(body.level ?? target.level)));
  const concepts = body.concepts?.length ? body.concepts : target.concepts;

  const { system, user } = buildProblemGenPrompt(level, concepts);
  const raw = await completeJson<unknown>(loadLlmConfig(db()), system, user, { maxTokens: 4000, temperature: 0.8 });
  const problem = validateProblem(raw);

  const id = findProblem(problem.id) ? `${problem.id}-${Date.now().toString(36)}` : problem.id;
  const stored: Problem = { ...problem, id, custom: true };
  db()
    .prepare('INSERT INTO problems_custom (id, json) VALUES (?, ?)')
    .run(stored.id, JSON.stringify(stored));
  return c.json(stored);
});

/**
 * Turn a system you actually own into a reviewable sheet. Paste the brief — what it
 * does, the traffic, the constraints — and the model shapes it into a problem with a
 * rubric, so the review that follows judges YOUR system against YOUR numbers.
 */
problemRoutes.post('/problems/from-brief', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { brief?: string; level?: number };
  const brief = String(body.brief ?? '').trim();
  if (brief.length < 40) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Describe the system in a few sentences first.',
          hint: 'What does it do, roughly how much traffic and data, and what are the hard constraints?',
        },
      },
      400,
    );
  }

  const level = Math.max(1, Math.min(6, Math.round(body.level ?? 4)));
  const { system } = buildProblemGenPrompt(level, []);
  const user = `A senior engineer wants their OWN system reviewed. Turn this description into a problem
sheet, preserving every fact they gave — do not invent a different system. Where they left a number
unstated, infer a plausible one and keep it modest. The rubric concepts must be the ones this system's
correctness actually depends on. Set "domain" from their description and make the title name their system.

Their description:
"""
${brief}
"""`;

  const raw = await completeJson<unknown>(loadLlmConfig(db()), system, user, {
    maxTokens: 4000,
    temperature: 0.4,
  });
  const problem = validateProblem(raw);
  const id = findProblem(problem.id) ? `${problem.id}-${Date.now().toString(36)}` : problem.id;
  const stored: Problem = { ...problem, id, custom: true };
  db().prepare('INSERT INTO problems_custom (id, json) VALUES (?, ?)').run(stored.id, JSON.stringify(stored));
  return c.json(stored);
});

problemRoutes.delete('/problems/:id', (c) => {
  const id = c.req.param('id');
  db().prepare('DELETE FROM problems_custom WHERE id = ?').run(id);
  return c.json({ ok: true });
});
