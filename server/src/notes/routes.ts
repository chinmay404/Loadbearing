// Notes kept beside the drawing.
//
// Deliberately not sticky notes: a sticky sits on the canvas at a position and is
// part of the design the grader reads. These are as many separate documents as you
// want — the decision log, the numbers you looked up, the questions still open —
// pinned either to one sheet or to a whole project, and nothing scores them.

import { Hono } from 'hono';
import {
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  type LibraryNote,
  type NoteLocation,
  type NoteScope,
} from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { allProblems } from '../problems/routes.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

export const noteRoutes = new Hono<AppEnv>();

const SCOPES: NoteScope[] = ['sheet', 'project'];

const asScope = (v: unknown): NoteScope | null =>
  SCOPES.includes(v as NoteScope) ? (v as NoteScope) : null;

const clamp = (v: unknown, max: number): string => String(v ?? '').slice(0, max);

/**
 * Postgres ids are UUIDs, and handing it something that is not one is an error
 * rather than a miss. A note id that could not exist is a 404, not a 500.
 */
const looksLikeId = (id: string): boolean => /^[0-9a-fA-F-]{16,64}$/.test(id);

noteRoutes.get('/notes', requireUser, async (c) => {
  const scope = asScope(c.req.query('scope'));
  const scopeId = c.req.query('scopeId') ?? '';
  if (!scope || !scopeId) {
    return c.json(
      { error: { code: 'bad_request', message: 'Ask for notes with a scope of sheet or project, and a scopeId.' } },
      400,
    );
  }
  const notes = await (await storage()).listNotes(c.get('userId'), scope, scopeId);
  return c.json({ notes });
});

/**
 * Every note, in one list, each one knowing where it came from.
 *
 * Notes get written where the thinking happened — which is the right place to write
 * them and a poor place to find them again, once there are nine sheets and three
 * projects. The scope id a note carries is opaque: a problem id, a view id, a project
 * id, all of them just strings. Resolving those to names is this route's whole job,
 * and it happens here rather than in the client so the client is not made to fetch
 * every project and every problem to render a list.
 */
noteRoutes.get('/notes/library', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');

  const [notes, problems, projects] = await Promise.all([
    store.listAllNotes(userId),
    allProblems(store, userId),
    store.listProjects(userId),
  ]);

  const problemTitle = new Map(problems.map((p) => [p.id, p.title]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // One round per project rather than per note: a hundred notes on four views is
  // four queries, not a hundred.
  const canvases = new Map<string, { name: string; projectId: string }>();
  await Promise.all(
    projects.map(async (project) => {
      for (const canvas of await store.listCanvases(userId, project.id)) {
        canvases.set(canvas.id, { name: canvas.name, projectId: project.id });
      }
    }),
  );

  const locate = (scope: NoteScope, scopeId: string): NoteLocation => {
    if (scope === 'project') {
      const name = projectName.get(scopeId);
      return name
        ? { kind: 'project', label: name, projectId: scopeId }
        : { kind: 'unknown', label: 'a project that no longer exists' };
    }
    const title = problemTitle.get(scopeId);
    if (title) return { kind: 'problem', label: title, problemId: scopeId };
    const canvas = canvases.get(scopeId);
    if (canvas) {
      return {
        kind: 'canvas',
        label: canvas.name,
        projectName: projectName.get(canvas.projectId) ?? '',
        projectId: canvas.projectId,
        canvasId: scopeId,
      };
    }
    // Deleting a project deletes its views; the notes written on them are not
    // deleted, because a note is somebody's writing and a deleted drawing is not a
    // reason to throw it away. They surface here, honestly labelled.
    return { kind: 'unknown', label: 'a sheet that no longer exists' };
  };

  const library: LibraryNote[] = notes.map((note) => ({ ...note, where: locate(note.scope, note.scopeId) }));
  return c.json({ notes: library });
});

noteRoutes.post('/notes', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: unknown;
    scopeId?: unknown;
    title?: unknown;
    body?: unknown;
  };
  const scope = asScope(body.scope);
  const scopeId = String(body.scopeId ?? '');
  if (!scope || !scopeId) {
    return c.json(
      { error: { code: 'bad_request', message: 'A note needs a scope of sheet or project, and a scopeId.' } },
      400,
    );
  }
  const note = await (await storage()).createNote(c.get('userId'), {
    scope,
    scopeId,
    title: clamp(body.title, NOTE_TITLE_MAX),
    body: clamp(body.body, NOTE_BODY_MAX),
  });
  return c.json(note, 201);
});

noteRoutes.put('/notes/:id', requireUser, async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: unknown;
    body?: unknown;
    position?: unknown;
  };
  const patch: { title?: string; body?: string; position?: number } = {};
  if (body.title !== undefined) patch.title = clamp(body.title, NOTE_TITLE_MAX);
  if (body.body !== undefined) patch.body = clamp(body.body, NOTE_BODY_MAX);
  if (typeof body.position === 'number' && Number.isFinite(body.position)) {
    patch.position = Math.trunc(body.position);
  }

  const note = looksLikeId(id) ? await (await storage()).updateNote(c.get('userId'), id, patch) : null;
  if (!note) return c.json({ error: { code: 'not_found', message: 'No such note' } }, 404);
  return c.json(note);
});

noteRoutes.delete('/notes/:id', requireUser, async (c) => {
  const id = c.req.param('id');
  if (looksLikeId(id)) await (await storage()).deleteNote(c.get('userId'), id);
  return c.json({ ok: true });
});
