// Course progress: what a learner has passed, recorded only when the server's own
// judge agrees — a client that says "I passed" is not evidence.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STEP_BY_ID, applyPatch, startGraph } from '@loadbearing/shared';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-course-'));
process.env.LOADBEARING_DB = join(dir, 'course.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

let cookie = '';
let other = '';

const signUp = async (username: string) => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-long-enough-password' }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
};

const progress = async (as: string) => {
  const res = await app.request('/api/course/progress', { headers: { cookie: as } });
  expect(res.status).toBe(200);
  return (await res.json()) as { steps: Record<string, { passedAt: string; hints: number }> };
};

const submit = (as: string, stepId: string, graph: unknown, hints = 0) =>
  app.request(`/api/course/steps/${stepId}/pass`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as },
    body: JSON.stringify({ graph, hints }),
  });

beforeAll(async () => {
  cookie = await signUp('learner');
  other = await signUp('otherlearner');
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('course progress', () => {
  const step = STEP_BY_ID['p-1']!;

  it('starts empty', async () => {
    expect((await progress(cookie)).steps).toEqual({});
  });

  it('records a step once the design really passes', async () => {
    const res = await submit(cookie, step.id, applyPatch(startGraph(step), step.solution), 1);
    expect(res.status).toBe(200);
    const mine = await progress(cookie);
    expect(mine.steps[step.id]?.hints).toBe(1);
  });

  it('refuses a design that does not pass, and says why', async () => {
    const res = await submit(cookie, 'p-2', startGraph(STEP_BY_ID['p-2']!));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_passed');
    expect((await progress(cookie)).steps['p-2']).toBeUndefined();
  });

  it('keeps one learner’s progress away from another', async () => {
    expect((await progress(other)).steps).toEqual({});
  });

  it('rejects a step that does not exist', async () => {
    expect((await submit(cookie, 'no-such-step', startGraph(step))).status).toBe(404);
  });

  it('keeps lesson canvases out of the problem list', async () => {
    const saved = await app.request('/api/designs/course:p-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ nodes: [], edges: [], stickies: [], strokes: [], flows: [] }),
    });
    expect(saved.status).toBe(200);
    const res = await app.request('/api/activity', { headers: { cookie } });
    const body = (await res.json()) as { recent: { problemId: string }[] };
    expect(body.recent.map((r) => r.problemId).filter((id) => id.startsWith('course:'))).toEqual([]);
  });

  it('needs you to be signed in', async () => {
    expect((await app.request('/api/course/progress')).status).toBe(401);
  });
});
