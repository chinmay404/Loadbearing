// Templates the user saved from their own canvas, to reuse on any sheet.
//
// Stored as one JSON blob in that user's settings rather than in a table of its
// own. That is a deliberate constraint, not laziness: Postgres migrations here
// run only when the schema is first created, so a new table would never appear on
// an already-deployed instance. Templates are small user configuration, and the
// settings row is exactly the right size for them.

import { Hono } from 'hono';
import { ARCH_NODE_TYPES } from '@loadbearing/shared';
import type { CustomObject, UserTemplate } from '@loadbearing/shared';
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

// ---- custom objects: the user's own component types ----

const OBJECTS_KEY = 'custom_objects';
const MAX_OBJECTS = 120;

async function readObjects(userId: string): Promise<CustomObject[]> {
  const raw = await (await storage()).getSetting(userId, OBJECTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CustomObject[]) : [];
  } catch {
    return [];
  }
}

templateRoutes.get('/custom-objects', requireUser, async (c) =>
  c.json(await readObjects(c.get('userId'))),
);

templateRoutes.post('/custom-objects', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<CustomObject>;
  const name = String(body.name ?? '').trim().slice(0, 60);
  const baseType = String(body.baseType ?? '');
  if (!name) {
    return c.json({ error: { code: 'bad_request', message: 'Give the object a name.' } }, 400);
  }
  if (!ARCH_NODE_TYPES.includes(baseType as (typeof ARCH_NODE_TYPES)[number])) {
    return c.json(
      {
        error: {
          code: 'bad_base_type',
          message: 'Pick which built-in component this behaves like.',
          hint: 'The base type decides its icon and how the simulator and the checks treat it.',
        },
      },
      400,
    );
  }

  const userId = c.get('userId');
  const existing = await readObjects(userId);
  const object: CustomObject = {
    id: `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    baseType: baseType as CustomObject['baseType'],
    note: String(body.note ?? '').trim().slice(0, 1000),
    attrs: (body.attrs && typeof body.attrs === 'object' ? body.attrs : {}) as CustomObject['attrs'],
    createdAt: new Date().toISOString(),
  };

  // Same name replaces: refining a variant you already keep is the common case.
  const next = [object, ...existing.filter((o) => o.name !== name)].slice(0, MAX_OBJECTS);
  await (await storage()).setSetting(userId, OBJECTS_KEY, JSON.stringify(next));
  return c.json(object, 201);
});

templateRoutes.delete('/custom-objects/:id', requireUser, async (c) => {
  const userId = c.get('userId');
  const next = (await readObjects(userId)).filter((o) => o.id !== c.req.param('id'));
  await (await storage()).setSetting(userId, OBJECTS_KEY, JSON.stringify(next));
  return c.json({ ok: true });
});
