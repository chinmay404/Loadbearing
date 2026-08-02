import { Hono } from 'hono';
import { CONCEPTS, CONCEPT_CARDS } from '@loadbearing/shared';
import type { Problem, ProblemSummary } from '@loadbearing/shared';
import { storage, type Storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';
import { PROBLEM_BANK } from './bank.js';
import { validateProblem } from './validate.js';
import { buildProblemGenPrompt } from '../scoring/prompt.js';
import { completeJson } from '../llm/adapter.js';
import { loadLlmConfig } from '../llm/settings.js';
import { registerReferenceRoutes } from './reference.js';

export const problemRoutes = new Hono<AppEnv>();

async function customProblems(store: Storage, userId: string): Promise<Problem[]> {
  const rows = await store.listCustomProblems(userId);
  return rows.flatMap((json) => {
    try {
      return [JSON.parse(json) as Problem];
    } catch {
      return [];
    }
  });
}

/** The shared bank plus this user's own composed sheets. */
export async function allProblems(store: Storage, userId: string): Promise<Problem[]> {
  return [...PROBLEM_BANK, ...(await customProblems(store, userId))];
}

export async function findProblem(
  store: Storage,
  userId: string,
  id: string,
): Promise<Problem | undefined> {
  const fromBank = PROBLEM_BANK.find((p) => p.id === id);
  if (fromBank) return fromBank;
  return (await customProblems(store, userId)).find((p) => p.id === id);
}

const summarize = (p: Problem): ProblemSummary => ({
  id: p.id,
  title: p.title,
  level: p.level,
  domain: p.domain,
  concepts: p.concepts,
  custom: p.custom,
  kind: p.kind,
});

/** Concepts the learner is weakest on, plus a level suited to their history. */
export async function weaknessTarget(
  store: Storage,
  userId: string,
): Promise<{ level: number; concepts: string[] }> {
  const rows = await store.listMastery(userId);
  const seen = new Map(rows.map((r) => [r.concept, r.emaScore]));
  const scored = CONCEPTS.map((c) => ({ concept: c, score: seen.has(c) ? seen.get(c)! : 0.4 }));
  scored.sort((a, b) => a.score - b.score);
  const concepts = scored.slice(0, 3).map((s) => s.concept);

  const stats = await store.statsAgg(userId);
  const base = 1 + Math.floor(stats.attempts / 5);
  const adjust = (stats.avgOverall ?? 0) >= 75 ? 1 : 0;
  const level = Math.max(1, Math.min(6, base + adjust));
  return { level, concepts };
}

// The bank is the same for everyone, so browsing it needs no account. Anything
// that reads or writes a person's own work goes through requireUser.
problemRoutes.get('/problems', async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const problems = userId ? await allProblems(store, userId) : PROBLEM_BANK;
  return c.json(problems.map(summarize));
});

problemRoutes.get('/concepts', (c) => c.json(CONCEPT_CARDS));

/**
 * What this account has been working on, most recent first.
 *
 * Both signals count. A submitted attempt is obvious, but most sheets are drawn on
 * many times before anything is submitted — so designs are included, and a problem
 * opened yesterday and left half-drawn is exactly the one someone wants at the top of
 * the list tomorrow.
 */
problemRoutes.get('/activity', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const [designs, attempts] = await Promise.all([
    store.listDesignActivity(userId),
    store.listAttempts(userId, undefined, 100),
  ]);

  const latest = new Map<string, { problemId: string; lastTouchedAt: string; attempts: number }>();
  const touch = (problemId: string, at: string, wasAttempt: boolean) => {
    const seen = latest.get(problemId);
    if (!seen) {
      latest.set(problemId, { problemId, lastTouchedAt: at, attempts: wasAttempt ? 1 : 0 });
      return;
    }
    if (at > seen.lastTouchedAt) seen.lastTouchedAt = at;
    if (wasAttempt) seen.attempts += 1;
  };

  for (const d of designs) touch(d.problemId, d.updatedAt, false);
  for (const a of attempts) touch(a.problemId, a.createdAt, true);

  const recent = [...latest.values()].sort((a, b) =>
    a.lastTouchedAt === b.lastTouchedAt
      ? a.problemId.localeCompare(b.problemId)
      : b.lastTouchedAt.localeCompare(a.lastTouchedAt),
  );
  return c.json({ recent });
});

problemRoutes.get('/weakness-target', requireUser, async (c) =>
  c.json(await weaknessTarget(await storage(), c.get('userId'))),
);

problemRoutes.get('/problems/:id', async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const p = userId
    ? await findProblem(store, userId, c.req.param('id'))
    : PROBLEM_BANK.find((x) => x.id === c.req.param('id'));
  if (!p) return c.json({ error: { code: 'not_found', message: 'No such problem' } }, 404);
  return c.json(p);
});

problemRoutes.post('/problems/generate', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { level?: number; concepts?: string[] };
  const store = await storage();
  const userId = c.get('userId');
  const target = await weaknessTarget(store, userId);
  const level = Math.max(1, Math.min(6, Math.round(body.level ?? target.level)));
  const concepts = body.concepts?.length ? body.concepts : target.concepts;

  const { system, user } = buildProblemGenPrompt(level, concepts);
  const raw = await completeJson<unknown>(await loadLlmConfig(store, userId), system, user, {
    maxTokens: 4000,
    temperature: 0.8,
  });
  const problem = validateProblem(raw);

  const taken = await findProblem(store, userId, problem.id);
  const id = taken ? `${problem.id}-${Date.now().toString(36)}` : problem.id;
  const stored: Problem = { ...problem, id, custom: true };
  await store.insertCustomProblem(userId, stored.id, JSON.stringify(stored));
  return c.json(stored);
});

/**
 * Turn a system you actually own into a reviewable sheet. Paste the brief — what it
 * does, the traffic, the constraints — and the model shapes it into a problem with a
 * rubric, so the review that follows judges YOUR system against YOUR numbers.
 */
problemRoutes.post('/problems/from-brief', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    brief?: string;
    constraints?: string;
    scale?: string;
    focus?: string[];
    level?: number;
    /** 'own' = review my real system · 'exercise' = turn this scenario into a drill */
    mode?: 'own' | 'exercise';
    harder?: boolean;
  };
  const brief = String(body.brief ?? '').trim();
  if (brief.length < 40) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Describe the scenario in a few sentences first.',
          hint: 'What does the system do, roughly how much traffic and data, and what are the hard constraints?',
        },
      },
      400,
    );
  }

  const level = Math.max(1, Math.min(6, Math.round(body.level ?? 4)));
  const focus = (body.focus ?? []).filter((f) => typeof f === 'string' && f.trim() !== '');
  const constraints = String(body.constraints ?? '').trim();
  const scale = String(body.scale ?? '').trim();
  const mode = body.mode === 'exercise' ? 'exercise' : 'own';

  const { system } = buildProblemGenPrompt(level, focus);

  const framing =
    mode === 'own'
      ? `A senior engineer wants their OWN system reviewed. Preserve every fact they gave — do not
invent a different system. Set "domain" from their description and make the title name their system.`
      : `Turn this scenario into a training exercise. Keep the scenario's domain and its shape, but you
may sharpen the numbers and add the tensions that make it a genuine design problem.`;

  const user = `${framing}

Where a number is missing, infer a plausible one and keep it modest — never inflate. The rubric
concepts must be the ones this system's correctness actually depends on.
${body.harder ? '\nMake it harder than the description suggests: add one constraint that forces a real trade-off, and say so in the prompt.\n' : ''}
Scenario:
"""
${brief}
"""
${scale ? `\nScale and traffic they gave (respect these exactly where stated):\n"""\n${scale}\n"""` : ''}
${constraints ? `\nHard constraints they are under (these decide what counts as overengineering):\n"""\n${constraints}\n"""` : ''}
${focus.length ? `\nThe answer must demonstrate these concepts, so build the problem around them: ${focus.join(', ')}` : ''}`;

  const store = await storage();
  const userId = c.get('userId');
  const raw = await completeJson<unknown>(await loadLlmConfig(store, userId), system, user, {
    maxTokens: 4000,
    temperature: 0.4,
  });
  const problem = validateProblem(raw);
  const taken = await findProblem(store, userId, problem.id);
  const id = taken ? `${problem.id}-${Date.now().toString(36)}` : problem.id;
  const stored: Problem = { ...problem, id, custom: true };
  await store.insertCustomProblem(userId, stored.id, JSON.stringify(stored));
  return c.json(stored);
});

problemRoutes.delete('/problems/:id', requireUser, async (c) => {
  await (await storage()).deleteCustomProblem(c.get('userId'), c.req.param('id'));
  return c.json({ ok: true });
});

registerReferenceRoutes(problemRoutes);
