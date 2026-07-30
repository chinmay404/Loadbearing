import { Hono } from 'hono';
import { db } from '../db.js';

export const designRoutes = new Hono();

/**
 * Canvas persistence. One row per problem, single writer, last write wins —
 * deliberately not merged from two sources.
 */
designRoutes.get('/designs/:problemId', (c) => {
  const row = db()
    .prepare('SELECT graph_json, updated_at FROM designs WHERE problem_id = ?')
    .get(c.req.param('problemId')) as { graph_json: string; updated_at: string } | undefined;
  if (!row) return c.json({ doc: null, updatedAt: null });
  try {
    return c.json({ doc: JSON.parse(row.graph_json), updatedAt: row.updated_at });
  } catch {
    return c.json({ doc: null, updatedAt: null });
  }
});

designRoutes.put('/designs/:problemId', async (c) => {
  const doc = await c.req.json().catch(() => null);
  if (!doc || typeof doc !== 'object') {
    return c.json({ error: { code: 'bad_request', message: 'Body must be a canvas document.' } }, 400);
  }
  db()
    .prepare(
      `INSERT INTO designs (problem_id, graph_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(problem_id) DO UPDATE SET graph_json = excluded.graph_json, updated_at = datetime('now')`,
    )
    .run(c.req.param('problemId'), JSON.stringify(doc));
  return c.json({ ok: true });
});
