// The Ask panel's conversation, exercised through the real routes.
//
// The bug this covers is not in any single function: the coaching log lived only
// in React state, so it died on reload, on sign-out, and every time the rail
// changed tab — and the coach never saw a previous turn, so a follow-up like
// "why?" had nothing to refer to. What matters is therefore end-to-end: does a
// question survive the request that answered it, and can it be read back.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurn, GraphDSL } from '@loadbearing/shared';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-chat-'));
process.env.LOADBEARING_DB = join(dir, 'chat.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
process.env.FAKE_LLM = '1';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

const PROBLEM = 'l1-read-heavy-product-api';

const graph: GraphDSL = {
  nodes: [
    { id: 'api', type: 'service', label: 'Product API', annotation: '' },
    { id: 'db', type: 'sql_db', label: 'Postgres', annotation: '' },
  ],
  edges: [{ id: 'e1', from: 'api', to: 'db', kind: 'sync', label: 'read' }],
  stickies: [],
  flows: [],
};

let cookie = '';

/** What the coach is pretending to reply with for the next request. */
function reply(answer: string) {
  (globalThis as unknown as { __FAKE_LLM_RESPONSE?: string }).__FAKE_LLM_RESPONSE = JSON.stringify({
    answer,
    canvas_markup: [],
    suggested_additions: [],
  });
}

const ask = (question: string, selectedNodeIds?: string[]) =>
  app.request('/api/critique', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ problemId: PROBLEM, graph, question, ...(selectedNodeIds ? { selectedNodeIds } : {}) }),
  });

const readChat = async (): Promise<ChatTurn[]> => {
  const res = await app.request(`/api/chat/${PROBLEM}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { turns: ChatTurn[] }).turns;
};

beforeAll(async () => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'chattester', password: 'a-long-enough-password' }),
  });
  expect(res.status).toBe(201);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain('=');
});

afterAll(() => {
  delete (globalThis as unknown as { __FAKE_LLM_RESPONSE?: string }).__FAKE_LLM_RESPONSE;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows will not unlink the database while the process still holds it open.
    // It is a scratch file under the OS temp directory; leaving it is harmless.
  }
});

describe('the coaching conversation', () => {
  it('starts empty', async () => {
    expect(await readChat()).toEqual([]);
  });

  it('keeps both sides of a turn, and keeps accumulating', async () => {
    reply('What happens when the cache is cold?');
    expect((await ask('Where does this break?')).status).toBe(200);

    let turns = await readChat();
    expect(turns).toEqual([
      { role: 'me', text: 'Where does this break?' },
      { role: 'ai', text: 'What happens when the cache is cold?' },
    ]);

    reply('Because every miss lands on one database.');
    expect((await ask('why?')).status).toBe(200);

    turns = await readChat();
    expect(turns.length).toBe(4);
    expect(turns[2]).toEqual({ role: 'me', text: 'why?' });
    expect(turns[3]).toEqual({ role: 'ai', text: 'Because every miss lands on one database.' });
  });

  it('answers with the thread it stored, so the panel and the server agree', async () => {
    reply('Start with the read path.');
    const body = (await (await ask('and the writes?')).json()) as { turns?: ChatTurn[] };
    expect(body.turns).toEqual(await readChat());
  });

  it('records what the learner was pointing at as part of the question', async () => {
    reply('That one is doing two jobs.');
    await ask('is this too much?', ['api']);
    const turns = await readChat();
    expect(turns[turns.length - 2]).toEqual({ role: 'me', text: '[about Product API] is this too much?' });
  });

  it('stores nothing when the answer fails, leaving no half-turn behind', async () => {
    const before = await readChat();
    (globalThis as unknown as { __FAKE_LLM_RESPONSE?: string }).__FAKE_LLM_RESPONSE = 'not json at all';

    const res = await ask('does this get recorded?');
    expect(res.status).not.toBe(200);
    expect(await readChat()).toEqual(before);
  });

  it('is per sheet: another problem is a different conversation', async () => {
    expect((await readChat()).length).toBeGreaterThan(0);
    const res = await app.request('/api/chat/l1-image-upload-service', { headers: { cookie } });
    expect(((await res.json()) as { turns: ChatTurn[] }).turns).toEqual([]);
  });

  it('can be cleared', async () => {
    const res = await app.request(`/api/chat/${PROBLEM}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await readChat()).toEqual([]);
  });

  it('belongs to the account that asked', async () => {
    const other = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'chattester2', password: 'a-long-enough-password' }),
    });
    const otherCookie = (other.headers.get('set-cookie') ?? '').split(';')[0]!;

    reply('Only this account should see this.');
    await ask('mine?');
    const res = await app.request(`/api/chat/${PROBLEM}`, { headers: { cookie: otherCookie } });
    expect(((await res.json()) as { turns: ChatTurn[] }).turns).toEqual([]);
  });

  it('needs an account at all', async () => {
    const res = await app.request(`/api/chat/${PROBLEM}`);
    expect(res.status).toBe(401);
  });

});
