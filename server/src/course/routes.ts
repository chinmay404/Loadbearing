import { Hono } from 'hono';
import { STEP_BY_ID, judgeStep, type GraphDSL } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

/**
 * Which course steps a learner has passed.
 *
 * Kept in the per-user settings, so it needs no schema of its own. A pass is
 * recorded only when the server's judge — the same
 * arithmetic the browser runs — agrees with the design it is sent; a request that
 * merely says "passed" is not evidence of anything.
 */
export const courseRoutes = new Hono<AppEnv>();

const PROGRESS_KEY = 'course.progress';

interface Progress {
  steps: Record<string, { passedAt: string; hints: number }>;
}

async function read(userId: string): Promise<Progress> {
  const raw = await (await storage()).getSetting(userId, PROGRESS_KEY);
  if (!raw) return { steps: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return { steps: parsed.steps && typeof parsed.steps === 'object' ? parsed.steps : {} };
  } catch {
    return { steps: {} };
  }
}

/** Just enough shape to simulate; anything else in the body is ignored. */
function asGraph(value: unknown): GraphDSL | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Partial<GraphDSL>;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  return { nodes: g.nodes, edges: g.edges, stickies: [], flows: Array.isArray(g.flows) ? g.flows : [] };
}

courseRoutes.get('/course/progress', requireUser, async (c) => c.json(await read(c.get('userId'))));

courseRoutes.post('/course/steps/:stepId/pass', requireUser, async (c) => {
  const step = STEP_BY_ID[c.req.param('stepId')];
  if (!step) return c.json({ error: { code: 'not_found', message: 'There is no such step.' } }, 404);

  const body = (await c.req.json().catch(() => null)) as { graph?: unknown; hints?: unknown } | null;
  const graph = asGraph(body?.graph);
  if (!graph) {
    return c.json({ error: { code: 'bad_request', message: 'Send the design as { graph: { nodes, edges } }.' } }, 400);
  }

  const verdict = judgeStep(step, graph);
  if (!verdict.passed) {
    return c.json(
      { error: { code: 'not_passed', message: 'This design does not pass the step yet.' }, verdict },
      422,
    );
  }

  const userId = c.get('userId');
  const progress = await read(userId);
  const hints = Math.max(0, Math.min(3, Math.round(Number(body?.hints) || 0)));
  const earlier = progress.steps[step.id];
  // The first pass is the one that counts; a later, cleaner one only improves the hints.
  progress.steps[step.id] = earlier
    ? { passedAt: earlier.passedAt, hints: Math.min(earlier.hints, hints) }
    : { passedAt: new Date().toISOString(), hints };
  await (await storage()).setSetting(userId, PROGRESS_KEY, JSON.stringify(progress));
  return c.json({ ok: true, verdict, progress });
});
