// Projects: a real system you are designing, holding several diagrams of it.
//
// Distinct from a problem sheet on purpose. A sheet has a rubric, a score and a
// right answer to be argued with; a project has none of those, because the system
// is yours and nobody is grading it. What a project keeps instead is the free
// feedback — the structural rules and the capacity model, which need no rubric —
// and one export covering every diagram at once.

import { Hono } from 'hono';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';
import { sanitizeGraph } from '../scoring/validate.js';
import { buildProjectBrief } from '../export/brief.js';

export const projectRoutes = new Hono<AppEnv>();

const MAX_NAME = 120;
const MAX_SUMMARY = 2000;
const clean = (raw: unknown, max: number): string => String(raw ?? '').trim().slice(0, max);

projectRoutes.get('/projects', requireUser, async (c) =>
  c.json(await (await storage()).listProjects(c.get('userId'))),
);

projectRoutes.post('/projects', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; summary?: string };
  const name = clean(body.name, MAX_NAME);
  if (!name) {
    return c.json({ error: { code: 'bad_request', message: 'Give the project a name.' } }, 400);
  }
  const store = await storage();
  const userId = c.get('userId');
  const project = await store.createProject(userId, name, clean(body.summary, MAX_SUMMARY));
  // A project with no canvas is a dead end, so it starts with one.
  const canvas = await store.createCanvas(userId, project.id, 'System view', '');
  return c.json({ ...project, canvasCount: 1, firstCanvasId: canvas.id }, 201);
});

projectRoutes.get('/projects/:id', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const project = await store.getProject(userId, c.req.param('id'));
  if (!project) return c.json({ error: { code: 'not_found', message: 'No such project' } }, 404);
  const canvases = await store.listCanvases(userId, project.id);
  // The list carries names and notes but not the drawings: a project with twenty
  // canvases would otherwise send every one of them to render a sidebar.
  return c.json({
    ...project,
    canvases: canvases.map(({ graphJson: _graphJson, ...rest }) => rest),
  });
});

projectRoutes.put('/projects/:id', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; summary?: string };
  const store = await storage();
  const userId = c.get('userId');
  if (!(await store.getProject(userId, c.req.param('id')))) {
    return c.json({ error: { code: 'not_found', message: 'No such project' } }, 404);
  }
  await store.updateProject(userId, c.req.param('id'), {
    ...(body.name !== undefined ? { name: clean(body.name, MAX_NAME) } : {}),
    ...(body.summary !== undefined ? { summary: clean(body.summary, MAX_SUMMARY) } : {}),
  });
  return c.json(await store.getProject(userId, c.req.param('id')));
});

projectRoutes.delete('/projects/:id', requireUser, async (c) => {
  await (await storage()).deleteProject(c.get('userId'), c.req.param('id'));
  return c.json({ ok: true });
});

// ---- canvases within a project ----

projectRoutes.post('/projects/:id/canvases', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; note?: string };
  const store = await storage();
  const userId = c.get('userId');
  const project = await store.getProject(userId, c.req.param('id'));
  if (!project) return c.json({ error: { code: 'not_found', message: 'No such project' } }, 404);
  const canvas = await store.createCanvas(
    userId,
    project.id,
    clean(body.name, MAX_NAME) || 'Untitled view',
    clean(body.note, MAX_SUMMARY),
  );
  return c.json(canvas, 201);
});

/**
 * The whole project as one build specification. This is the reason projects exist
 * rather than a folder of unrelated sheets: a coding agent handed six diagrams
 * separately has to guess how they relate, and the relationships are the design.
 */
projectRoutes.post('/projects/:id/brief', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const project = await store.getProject(userId, c.req.param('id'));
  if (!project) return c.json({ error: { code: 'not_found', message: 'No such project' } }, 404);

  const canvases = await store.listCanvases(userId, project.id);
  const views = canvases.map((canvas) => ({
    name: canvas.name,
    note: canvas.note,
    graph: sanitizeGraph(parse(canvas.graphJson)),
  }));
  if (views.every((v) => v.graph.nodes.length === 0)) {
    return c.json(
      {
        error: {
          code: 'empty_project',
          message: 'Nothing is drawn in this project yet.',
          hint: 'Draw at least one view before exporting it.',
        },
      },
      400,
    );
  }

  const markdown = buildProjectBrief({ name: project.name, summary: project.summary, views });
  return c.json({ markdown, filename: `${slug(project.name)}-implementation-brief.md` });
});

projectRoutes.get('/canvases/:canvasId', requireUser, async (c) => {
  const canvas = await (await storage()).getCanvas(c.get('userId'), c.req.param('canvasId'));
  if (!canvas) return c.json({ error: { code: 'not_found', message: 'No such canvas' } }, 404);
  return c.json({ ...canvas, doc: parse(canvas.graphJson) });
});

projectRoutes.put('/canvases/:canvasId', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    note?: string;
    doc?: unknown;
    position?: number;
  };
  const store = await storage();
  const userId = c.get('userId');
  if (!(await store.getCanvas(userId, c.req.param('canvasId')))) {
    return c.json({ error: { code: 'not_found', message: 'No such canvas' } }, 404);
  }
  await store.updateCanvas(userId, c.req.param('canvasId'), {
    ...(body.name !== undefined ? { name: clean(body.name, MAX_NAME) } : {}),
    ...(body.note !== undefined ? { note: clean(body.note, MAX_SUMMARY) } : {}),
    ...(body.doc && typeof body.doc === 'object' ? { graphJson: JSON.stringify(body.doc) } : {}),
    ...(typeof body.position === 'number' ? { position: Math.round(body.position) } : {}),
  });
  return c.json({ ok: true });
});

projectRoutes.delete('/canvases/:canvasId', requireUser, async (c) => {
  await (await storage()).deleteCanvas(c.get('userId'), c.req.param('canvasId'));
  return c.json({ ok: true });
});

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
