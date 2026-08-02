import { Hono } from 'hono';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

export const designRoutes = new Hono<AppEnv>();

/**
 * Canvas persistence. One row per (user, problem), single writer, last write
 * wins — deliberately not merged from two sources.
 */
designRoutes.get('/designs/:problemId', requireUser, async (c) => {
  const row = await (await storage()).getDesign(c.get('userId'), c.req.param('problemId'));
  if (!row) return c.json({ doc: null, updatedAt: null });
  try {
    return c.json({ doc: JSON.parse(row.graphJson), updatedAt: row.updatedAt });
  } catch {
    return c.json({ doc: null, updatedAt: null });
  }
});

designRoutes.put('/designs/:problemId', requireUser, async (c) => {
  const doc = await c.req.json().catch(() => null);
  // A `nodes` array is what makes this a canvas document rather than merely an
  // object. Accepting any object meant a caller that wrapped the document — sending
  // `{ doc: … }` because the GET replies that way — stored the wrapper, got a 200,
  // and only found out when the sheet came back empty. Silence is the wrong answer
  // to a body that could not possibly be right.
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { nodes?: unknown }).nodes)) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Body must be a canvas document.',
          hint: 'The document itself, not wrapped in anything: { nodes: [...], edges: [...], stickies: [...], strokes: [...], flows: [...] }.',
        },
      },
      400,
    );
  }
  await (await storage()).putDesign(c.get('userId'), c.req.param('problemId'), JSON.stringify(doc));
  return c.json({ ok: true });
});
