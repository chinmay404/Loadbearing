import { Hono } from 'hono';
import {
  checkTopology,
  diffGraphs,
  evaluateAllScenarios,
  normalizeScore,
  renderDiffLines,
  simulate,
} from '@loadbearing/shared';
import type { Attempt, GraphDSL, ScoreResult, SimConfig } from '@loadbearing/shared';
import { db, upsertMastery } from '../db.js';
import { cachedCompleteJson } from '../llm/cache.js';
import { loadLlmConfig } from '../llm/settings.js';
import { findProblem } from '../problems/routes.js';
import { buildCritiquePrompt, buildScoringPrompt, buildSocraticPrompt } from './prompt.js';
import { sanitizeGraph, validateCritique, validateScore, validateSocratic } from './validate.js';

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

  // Every load scenario becomes a pass/fail fact the grader must respect.
  let gates: ReturnType<typeof evaluateAllScenarios> = [];
  try {
    gates = evaluateAllScenarios(graph, problem);
  } catch {
    gates = [];
  }

  // On a twist round, hand the grader the exact diff so it judges the
  // adaptation itself, not just the design that resulted.
  let changes: string[] | undefined;
  if (twist) {
    const prev = db()
      .prepare('SELECT graph_json FROM attempts WHERE problem_id = ? ORDER BY id DESC LIMIT 1')
      .get(problem.id) as { graph_json: string } | undefined;
    if (prev) {
      try {
        changes = renderDiffLines(diffGraphs(JSON.parse(prev.graph_json) as GraphDSL, graph));
      } catch {
        changes = undefined;
      }
    }
  }

  const { system, user } = buildScoringPrompt({ problem, graph, sim, checks, gates, changes, twist });
  const { value: raw, cached } = await cachedCompleteJson<unknown>(loadLlmConfig(db()), system, user, {
    maxTokens: 16000,
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
    maxTokens: 4000,
    temperature: 0.4,
  });
  const critique = validateCritique(raw, graph);

  // The coach hints; it does not build. Whatever the model wanted, an empty
  // canvas gets no ghost components, and a question never earns more than one.
  critique.suggested_additions = graph.nodes.length === 0 ? [] : critique.suggested_additions.slice(0, 1);
  if (graph.nodes.length === 0) critique.canvas_markup = [];
  return c.json(critique);
});

/**
 * Grade a written answer to one of the review's Socratic questions. This is
 * the second half of the learning loop: the review asked, the learner thought,
 * this says whether the thinking held — and mastery moves accordingly.
 */
scoringRoutes.post('/socratic', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    graph?: unknown;
    question?: string;
    answer?: string;
  };
  const problem = findProblem(String(body.problemId ?? ''));
  if (!problem) return c.json({ error: { code: 'not_found', message: 'Unknown problem id' } }, 404);
  const question = String(body.question ?? '').trim();
  const answer = String(body.answer ?? '').trim();
  if (!question || answer.length < 10) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Write your answer first.',
          hint: 'A sentence or two naming the mechanism — this is graded on substance, not length.',
        },
      },
      400,
    );
  }

  const graph = sanitizeGraph(body.graph);
  const { system, user } = buildSocraticPrompt(problem, graph, question, answer);
  const { value: raw } = await cachedCompleteJson<unknown>(loadLlmConfig(db()), system, user, {
    maxTokens: 2500,
    temperature: 0.2,
  });
  const graded = validateSocratic(raw);

  for (const [concept, value] of Object.entries(graded.concept_scores)) {
    upsertMastery(db(), concept, value);
  }
  return c.json(graded);
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
