// Notes through the real routes: what a sheet's list contains, what a project's
// list contains, and whose notes they are.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Note } from '@loadbearing/shared';

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
