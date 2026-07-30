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
import { storage } from '../storage/index.js';
import type { AttemptRow } from '../storage/types.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';
import { cachedCompleteJson } from '../llm/cache.js';
import { loadLlmConfig } from '../llm/settings.js';
import { referenceBriefFor } from '../reference/inject.js';
import { findProblem } from '../problems/routes.js';
import { buildCritiquePrompt, buildScoringPrompt, buildSocraticPrompt } from './prompt.js';
import { sanitizeGraph, validateCritique, validateScore, validateSocratic } from './validate.js';

export const scoringRoutes = new Hono<AppEnv>();

const rowToAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  problemId: r.problemId,
  round: r.round,
  graph: JSON.parse(r.graphJson) as GraphDSL,
  score: normalizeScore(JSON.parse(r.scoreJson) as Partial<ScoreResult>),
  overall: r.overall,
  ...(r.twistText ? { twistText: r.twistText } : {}),
  createdAt: r.createdAt,
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

scoringRoutes.post('/attempts', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    round?: number;
    graph?: unknown;
    twistText?: string;
    previousOverall?: number;
  };

  const store = await storage();
  const userId = c.get('userId');
  const problem = await findProblem(store, userId, String(body.problemId ?? ''));
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
    const prev = await store.latestAttemptGraph(userId, problem.id);
    if (prev) {
      try {
        changes = renderDiffLines(diffGraphs(JSON.parse(prev) as GraphDSL, graph));
      } catch {
        changes = undefined;
      }
    }
  }

  // Established practice for THIS problem and THIS drawing, so the review rests
  // on documented engineering rather than on whatever the model recalls.
  const brief = referenceBriefFor({ problem, graph, limit: 8 });

  const { system, user } = buildScoringPrompt({
    problem,
    graph,
    sim,
    checks,
    gates,
    changes,
    twist,
    reference: brief.text,
  });
  const { value: raw, cached } = await cachedCompleteJson<unknown>(
    await loadLlmConfig(store, userId),
    system,
    user,
    { maxTokens: 16000, temperature: 0.2 },
  );
  const score = validateScore(raw, graph, brief.allowed);
  score.references = brief.sources;

  const attemptId = await store.insertAttempt(userId, {
    problemId: problem.id,
    round,
    graphJson: JSON.stringify(graph),
    scoreJson: JSON.stringify(score),
    overall: score.overall,
    twistText: twist?.text ?? null,
  });

  for (const [concept, value] of Object.entries(score.concept_scores)) {
    await store.upsertMastery(userId, concept, value);
  }

  return c.json({ attemptId, score, sim: sim ?? null, checks, cached });
});

scoringRoutes.get('/attempts', requireUser, async (c) => {
  const rows = await (await storage()).listAttempts(
    c.get('userId'),
    c.req.query('problemId') ?? undefined,
  );
  return c.json(rows.map(rowToAttempt));
});

scoringRoutes.get('/attempts/:id', requireUser, async (c) => {
  const row = await (await storage()).getAttempt(c.get('userId'), Number(c.req.param('id')));
  if (!row) return c.json({ error: { code: 'not_found', message: 'No such attempt' } }, 404);
  return c.json(rowToAttempt(row));
});

/** Ask the architect about the design currently on the canvas. */
scoringRoutes.post('/critique', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    graph?: unknown;
    question?: string;
    selectedNodeIds?: unknown;
  };
  const store = await storage();
  const userId = c.get('userId');
  const problem = await findProblem(store, userId, String(body.problemId ?? ''));
  if (!problem) return c.json({ error: { code: 'not_found', message: 'Unknown problem id' } }, 404);
  const question = String(body.question ?? '').trim();
  if (!question) return c.json({ error: { code: 'bad_request', message: 'Ask a question first.' } }, 400);

  const graph = sanitizeGraph(body.graph);
  const selectedNodeIds = (Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds : []).filter(
    (x): x is string => typeof x === 'string',
  );
  // The question itself is part of the retrieval query — asking about retries
  // should surface the retry material even if the problem never says the word.
  const brief = referenceBriefFor({ problem, graph, text: question, limit: 4 });
  const { system, user } = buildCritiquePrompt(problem, graph, question, selectedNodeIds, brief.text);
  const { value: raw } = await cachedCompleteJson<unknown>(
    await loadLlmConfig(store, userId),
    system,
    user,
    { maxTokens: 4000, temperature: 0.4 },
  );
  const critique = validateCritique(raw, graph);

  // The coach hints; it does not build. Whatever the model wanted, an empty
  // canvas gets no ghost components, and a question never earns more than one.
  critique.suggested_additions = graph.nodes.length === 0 ? [] : critique.suggested_additions.slice(0, 1);
  if (graph.nodes.length === 0) critique.canvas_markup = [];
  return c.json({ ...critique, references: brief.sources });
});

/**
 * Grade a written answer to one of the review's Socratic questions. This is
 * the second half of the learning loop: the review asked, the learner thought,
 * this says whether the thinking held — and mastery moves accordingly.
 */
scoringRoutes.post('/socratic', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    graph?: unknown;
    question?: string;
    answer?: string;
  };
  const store = await storage();
  const userId = c.get('userId');
  const problem = await findProblem(store, userId, String(body.problemId ?? ''));
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
  const brief = referenceBriefFor({ problem, graph, text: question, limit: 4 });
  const { system, user } = buildSocraticPrompt(problem, graph, question, answer, brief.text);
  const { value: raw } = await cachedCompleteJson<unknown>(
    await loadLlmConfig(store, userId),
    system,
    user,
    { maxTokens: 2500, temperature: 0.2 },
  );
  const graded = validateSocratic(raw);

  for (const [concept, value] of Object.entries(graded.concept_scores)) {
    await store.upsertMastery(userId, concept, value);
  }
  return c.json({ ...graded, references: brief.sources });
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
