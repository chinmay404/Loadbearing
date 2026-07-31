// Templates the user saved from their own canvas, to reuse on any sheet.
//
// Stored as one JSON blob in that user's settings rather than in a table of its
// own. That is a deliberate constraint, not laziness: Postgres migrations here
// run only when the schema is first created, so a new table would never appear on
// an already-deployed instance. Templates are small user configuration, and the
// settings row is exactly the right size for them.

import { Hono } from 'hono';
import type { UserTemplate } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

export const templateRoutes = new Hono<AppEnv>();

const KEY = 'canvas_templates';
const MAX_TEMPLATES = 40;
/** A whole sheet of a hundred components is still well under this. */
const MAX_BLOB_CHARS = 400_000;

async function read(userId: string): Promise<UserTemplate[]> {
  const raw = await (await storage()).getSetting(userId, KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UserTemplate[]) : [];
  } catch {
    // A corrupt blob must not lock the user out of their templates feature.
    return [];
  }
}

async function write(userId: string, list: UserTemplate[]): Promise<void> {
  await (await storage()).setSetting(userId, KEY, JSON.stringify(list));
}

templateRoutes.get('/templates', requireUser, async (c) => c.json(await read(c.get('userId'))));

templateRoutes.post('/templates', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<UserTemplate>;
  const name = String(body.name ?? '').trim();
  if (!name) {
    return c.json({ error: { code: 'bad_request', message: 'Give the template a name.' } }, 400);
  }
  if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
    return c.json(
      {
        error: {
          code: 'empty_template',
          message: 'Select the components to save first.',
          hint: 'With nothing selected the whole sheet is saved — but the sheet is empty.',
        },
      },
      400,
    );
  }

  const userId = c.get('userId');
  const existing = await read(userId);

  const template: UserTemplate = {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    summary: String(body.summary ?? '').trim(),
    createdAt: new Date().toISOString(),
    nodes: body.nodes,
    edges: Array.isArray(body.edges) ? body.edges : [],
    flows: Array.isArray(body.flows) ? body.flows : [],
  };

  // Saving under an existing name replaces it: the common case is refining a
  // pattern you already keep, not accumulating six versions of it.
  const next = [template, ...existing.filter((t) => t.name !== name)].slice(0, MAX_TEMPLATES);
  const blob = JSON.stringify(next);
  if (blob.length > MAX_BLOB_CHARS) {
    return c.json(
      {
        error: {
          code: 'templates_full',
          message: 'Your saved templates would exceed the size limit.',
          hint: 'Delete one you no longer use, or save a smaller selection.',
        },
      },
      413,
    );
  }

  await write(userId, next);
  return c.json(template, 201);
});

templateRoutes.delete('/templates/:id', requireUser, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await read(userId);
  await write(userId, existing.filter((t) => t.id !== id));
  return c.json({ ok: true });
});
