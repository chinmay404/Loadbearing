// Notes through the real routes: what a sheet's list contains, what a project's
// list contains, and whose notes they are.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibraryNote, Note } from '@loadbearing/shared';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-notes-'));
process.env.LOADBEARING_DB = join(dir, 'notes.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

let cookie = '';
let otherCookie = '';

const signUp = async (username: string) => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-long-enough-password' }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
};

const list = async (scope: string, scopeId: string, as = cookie): Promise<Note[]> => {
  const res = await app.request(`/api/notes?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`, {
    headers: { cookie: as },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { notes: Note[] }).notes;
};

const create = async (body: Record<string, unknown>, as = cookie) =>
  app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  cookie = await signUp('noteswriter');
  otherCookie = await signUp('notesreader');
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('notes on a sheet', () => {
  it('starts empty and holds as many notes as you add', async () => {
    expect(await list('sheet', 'l1-read-heavy-product-api')).toEqual([]);

    for (const title of ['Numbers', 'Open questions', 'Why one database']) {
      const res = await create({ scope: 'sheet', scopeId: 'l1-read-heavy-product-api', title, body: `${title} body` });
      expect(res.status).toBe(201);
    }

    const notes = await list('sheet', 'l1-read-heavy-product-api');
    expect(notes.length).toBe(3);
    // Newest first: the note just written is the one being worked on.
    expect(notes.map((n) => n.title)).toEqual(['Why one database', 'Open questions', 'Numbers']);
  });

  it('is a different list from another sheet, and from the project', async () => {
    expect(await list('sheet', 'l1-image-upload-service')).toEqual([]);
    expect(await list('project', 'l1-read-heavy-product-api')).toEqual([]);
  });

  it('edits title and body independently', async () => {
    const notes = await list('sheet', 'l1-read-heavy-product-api');
    const target = notes.find((n) => n.title === 'Numbers')!;

    const res = await app.request(`/api/notes/${target.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ body: '8k reads/sec, 40 writes/sec, 400k SKUs' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Note;
    expect(updated.body).toBe('8k reads/sec, 40 writes/sec, 400k SKUs');
    expect(updated.title).toBe('Numbers');
  });

  it('deletes one without touching the rest', async () => {
    const before = await list('sheet', 'l1-read-heavy-product-api');
    const doomed = before.find((n) => n.title === 'Open questions')!;
    const res = await app.request(`/api/notes/${doomed.id}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);

    const after = await list('sheet', 'l1-read-heavy-product-api');
    expect(after.map((n) => n.title)).toEqual(['Why one database', 'Numbers']);
  });
});

describe('notes on a project', () => {
  it('are their own list, shared by every view of that system', async () => {
    const res = await create({ scope: 'project', scopeId: 'proj-1', title: 'Decision log', body: 'Postgres, not Mongo.' });
    expect(res.status).toBe(201);

    expect((await list('project', 'proj-1')).map((n) => n.title)).toEqual(['Decision log']);
    // A view of that project keeps its own notes; the project's are fetched separately.
    expect(await list('sheet', 'proj-1')).toEqual([]);
  });
});

describe('a note belongs to the account that wrote it', () => {
  it('is invisible to anyone else', async () => {
    expect(await list('sheet', 'l1-read-heavy-product-api', otherCookie)).toEqual([]);
  });

  it('cannot be edited or deleted by anyone else', async () => {
    const mine = (await list('sheet', 'l1-read-heavy-product-api'))[0]!;

    const edit = await app.request(`/api/notes/${mine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({ title: 'mine now' }),
    });
    expect(edit.status).toBe(404);

    await app.request(`/api/notes/${mine.id}`, { method: 'DELETE', headers: { cookie: otherCookie } });
    expect((await list('sheet', 'l1-read-heavy-product-api')).map((n) => n.id)).toContain(mine.id);
  });

  it('needs an account at all', async () => {
    expect((await app.request('/api/notes?scope=sheet&scopeId=x')).status).toBe(401);
  });
});

describe('bad requests', () => {
  it('refuses a scope it does not have', async () => {
    expect((await create({ scope: 'universe', scopeId: 'x', title: 't', body: '' })).status).toBe(400);
    expect((await create({ scope: 'sheet', title: 't', body: '' })).status).toBe(400);
    expect((await app.request('/api/notes?scope=sheet', { headers: { cookie } })).status).toBe(400);
  });

  it('treats an id that could not exist as a miss, not a crash', async () => {
    const res = await app.request('/api/notes/not-a-real-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('the note library', () => {
  const library = async (as = cookie): Promise<LibraryNote[]> => {
    const res = await app.request('/api/notes/library', { headers: { cookie: as } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { notes: LibraryNote[] }).notes;
  };

  it('gathers notes from every sheet and project into one list', async () => {
    const all = await library();
    // Everything written above, across two sheets' worth of scopes and a project.
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(new Set(all.map((n) => n.scopeId)).size).toBeGreaterThan(1);
  });

  it('names the problem a sheet note was written on, rather than showing its id', () => {
    return library().then((all) => {
      const onSheet = all.find((n) => n.scopeId === 'l1-read-heavy-product-api')!;
      expect(onSheet.where.kind).toBe('problem');
      expect(onSheet.where.label).toBe('Read-Heavy Product Catalog API');
      expect(onSheet.where.problemId).toBe('l1-read-heavy-product-api');
    });
  });

  it('says plainly when the place a note was written no longer exists', async () => {
    // 'proj-1' is a scope id from the tests above with no project behind it — the
    // same state a real account reaches by deleting a project it had written on.
    const orphan = (await library()).find((n) => n.scopeId === 'proj-1')!;
    expect(orphan.where.kind).toBe('unknown');
    expect(orphan.where.label).toContain('no longer exists');
  });

  it('resolves a project note to the project, and a view note to both names', async () => {
    const made = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Checkout rewrite', summary: 'The real one' }),
    });
    expect(made.status).toBe(201);
    const project = (await made.json()) as { id: string };

    const view = await app.request(`/api/projects/${project.id}/canvases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Request path', note: '' }),
    });
    expect(view.status).toBe(201);
    const canvas = (await view.json()) as { id: string };

    expect((await create({ scope: 'project', scopeId: project.id, title: 'Why Postgres', body: '' })).status).toBe(201);
    expect((await create({ scope: 'sheet', scopeId: canvas.id, title: 'Fanout math', body: '' })).status).toBe(201);

    const all = await library();
    const onProject = all.find((n) => n.title === 'Why Postgres')!;
    expect(onProject.where).toMatchObject({ kind: 'project', label: 'Checkout rewrite', projectId: project.id });

    const onView = all.find((n) => n.title === 'Fanout math')!;
    // A view is a place inside a place, so it names both — "Request path" alone is
    // not enough to know which system it belongs to.
    expect(onView.where).toMatchObject({
      kind: 'canvas',
      label: 'Request path',
      projectName: 'Checkout rewrite',
      canvasId: canvas.id,
    });
  });

  it('is newest first, so what you were last writing is at the top', async () => {
    const all = await library();
    const stamps = all.map((n) => n.updatedAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it('shows nobody else their notes', async () => {
    expect(await library(otherCookie)).toEqual([]);
  });

  it('needs an account', async () => {
    expect((await app.request('/api/notes/library')).status).toBe(401);
  });
});
