import { Hono } from 'hono';
import { checkTopology, normalizeScore, simulate } from '@loadbearing/shared';
import type { Attempt, GraphDSL, ScoreResult, SimConfig } from '@loadbearing/shared';
import { db, upsertMastery } from '../db.js';
import { cachedCompleteJson } from '../llm/cache.js';
import { loadLlmConfig } from '../llm/settings.js';
import { findProblem } from '../problems/routes.js';
import { buildCritiquePrompt, buildScoringPrompt } from './prompt.js';
import { sanitizeGraph, validateCritique, validateScore } from './validate.js';

export const scoringRoutes = new Hono();

interface AttemptRow {
  id: number;
  problem_id: string;
  round: number;
  graph_json: string;
  score_json: string;
  overall: number;
  twist_text: string | null;
  created_at: string;
}

const rowToAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  problemId: r.problem_id,
  round: r.round,
  graph: JSON.parse(r.graph_json) as GraphDSL,
  score: normalizeScore(JSON.parse(r.score_json) as Partial<ScoreResult>),
  overall: r.overall,
  ...(r.twist_text ? { twistText: r.twist_text } : {}),
  createdAt: r.created_at,
});

/** Runs the capacity model at the harshest scenario so the grader sees evidence. */
function simulateForGrading(graph: GraphDSL, multiplier: number) {
  const config: SimConfig = { rpsMultiplier: multiplier, killNodeIds: [], thirdPartyLatencyMs: 0 };
  try {
    return simulate(graph, config);
  } catch {
    return undefined;
  }
}

scoringRoutes.post('/attempts', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    round?: number;
    graph?: unknown;
    twistText?: string;
    previousOverall?: number;
  };

  const problem = findProblem(String(body.problemId ?? ''));
  if (!problem) return c.json({ error: { code: 'not_found', message: 'Unknown problem id' } }, 404);

  const graph = sanitizeGraph(body.graph);
  if (graph.nodes.length === 0) {
    return c.json(
      { error: { code: 'empty_design', message: 'Draw at least one component before submitting.' } },
      400,
    );
  }

  const round = Math.max(1, Math.min(9, Math.round(body.round ?? 1)));
  const twist =
    round > 1 && body.twistText
      ? { text: String(body.twistText), previousOverall: Math.round(body.previousOverall ?? 0) }
      : undefined;

  const stressMultiplier = Math.max(
    1,
    ...problem.scenarios.map((s) => (Number.isFinite(s.rpsMultiplier) ? s.rpsMultiplier : 1)),
  );
  const sim = simulateForGrading(graph, stressMultiplier);

  // The rule engine is free and certain; run it so the model spends its judgement
  // on what rules cannot decide.
  const checks = checkTopology(graph);
  const { system, user } = buildScoringPrompt({ problem, graph, sim, checks, twist });
  const { value: raw, cached } = await cachedCompleteJson<unknown>(loadLlmConfig(db()), system, user, {
    maxTokens: 8000,
    temperature: 0.2,
  });
  const score = validateScore(raw, graph);

  const info = db()
    .prepare(
      `INSERT INTO attempts (problem_id, round, graph_json, score_json, overall, twist_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      problem.id,
      round,
      JSON.stringify(graph),
      JSON.stringify(score),
      score.overall,
      twist?.text ?? null,
    );

  for (const [concept, value] of Object.entries(score.concept_scores)) {
    upsertMastery(db(), concept, value);
  }

  return c.json({ attemptId: Number(info.lastInsertRowid), score, sim: sim ?? null, checks, cached });
});

scoringRoutes.get('/attempts', (c) => {
  const problemId = c.req.query('problemId');
  const rows = (
    problemId
      ? db().prepare('SELECT * FROM attempts WHERE problem_id = ? ORDER BY id DESC').all(problemId)
      : db().prepare('SELECT * FROM attempts ORDER BY id DESC LIMIT 100').all()
  ) as unknown as AttemptRow[];
  return c.json(rows.map(rowToAttempt));
});

scoringRoutes.get('/attempts/:id', (c) => {
  const row = db()
    .prepare('SELECT * FROM attempts WHERE id = ?')
    .get(Number(c.req.param('id'))) as AttemptRow | undefined;
  if (!row) return c.json({ error: { code: 'not_found', message: 'No such attempt' } }, 404);
  return c.json(rowToAttempt(row));
});

/** Ask the architect about the design currently on the canvas. */
scoringRoutes.post('/critique', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    graph?: unknown;
    question?: string;
    selectedNodeIds?: unknown;
  };
  const problem = findProblem(String(body.problemId ?? ''));
  if (!problem) return c.json({ error: { code: 'not_found', message: 'Unknown problem id' } }, 404);
  const question = String(body.question ?? '').trim();
  if (!question) return c.json({ error: { code: 'bad_request', message: 'Ask a question first.' } }, 400);

  const graph = sanitizeGraph(body.graph);
  const selectedNodeIds = (Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds : []).filter(
    (x): x is string => typeof x === 'string',
  );
  const { system, user } = buildCritiquePrompt(problem, graph, question, selectedNodeIds);
  const { value: raw } = await cachedCompleteJson<unknown>(loadLlmConfig(db()), system, user, {
    maxTokens: 2000,
    temperature: 0.4,
  });
  const critique = validateCritique(raw, graph);

  // The coach hints; it does not build. Whatever the model wanted, an empty
  // canvas gets no ghost components, and a question never earns more than one.
  critique.suggested_additions = graph.nodes.length === 0 ? [] : critique.suggested_additions.slice(0, 1);
  if (graph.nodes.length === 0) critique.canvas_markup = [];
  return c.json(critique);
});

/** Run the deterministic simulator without spending a token. */
scoringRoutes.post('/simulate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    graph?: unknown;
    config?: Partial<SimConfig>;
  };
  const graph = sanitizeGraph(body.graph);
  const config: SimConfig = {
    rpsMultiplier: Math.max(0, Number(body.config?.rpsMultiplier ?? 1)) || 1,
    killNodeIds: Array.isArray(body.config?.killNodeIds)
      ? body.config!.killNodeIds.filter((x): x is string => typeof x === 'string')
      : [],
    thirdPartyLatencyMs: Math.max(0, Number(body.config?.thirdPartyLatencyMs ?? 0)) || 0,
  };
  return c.json(simulate(graph, config));
});
