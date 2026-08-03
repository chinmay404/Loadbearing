// The attack route, with a canned model response.
//
// The generation is the cheap half and the only part a test cannot judge. What matters
// is everything after it: that each attack is RUN, that the outcome comes from the
// engine rather than from the model's own claim about what would happen, and that an
// attack aimed at something absent does not come back reported as survived.
//
// The model's answer is injected, so these assertions are about the pipeline. A real
// provider changes what gets proposed; it cannot change what happens to it here.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-attacks-'));
process.env.LOADBEARING_DB = join(dir, 'attacks.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
process.env.FAKE_LLM = '1';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

let cookie = '';

/** One SPOF, one cache everything reads through, one database. */
const graph = {
  nodes: [
    { id: 'n1', type: 'client', label: 'Shoppers', annotation: '', attrs: { trafficRps: 200 } },
    { id: 'n2', type: 'service', label: 'Catalog API', annotation: '', attrs: { replicas: 1, vcpu: 2, latencyMs: 40 } },
    { id: 'n3', type: 'cache', label: 'Redis', annotation: '', attrs: { cacheHitRate: 0.95 } },
    { id: 'n4', type: 'sql_db', label: 'Postgres', annotation: '', attrs: { latencyMs: 10 } },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'sync', label: '' },
    { id: 'e2', from: 'n2', to: 'n3', kind: 'sync', label: '' },
    { id: 'e3', from: 'n2', to: 'n4', kind: 'sync', label: '' },
  ],
  stickies: [],
  flows: [{ id: 'f1', name: 'product read', kind: 'read', steps: ['n1', 'n2', 'n4'], rps: 200, description: '' }],
};

const fake = (value: unknown) => {
  (globalThis as unknown as { __FAKE_LLM_RESPONSE?: string }).__FAKE_LLM_RESPONSE =
    JSON.stringify(value);
};

const ask = async (body: unknown = { problemId: 'l1-read-heavy-product-api', graph }) => {
  const res = await app.request('/api/attacks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  const registered = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'attacker', password: 'a-long-enough-password' }),
  });
  expect(registered.status).toBe(201);
  cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;
});

afterEach(() => {
  delete (globalThis as unknown as { __FAKE_LLM_RESPONSE?: string }).__FAKE_LLM_RESPONSE;
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('running what the coach devised', () => {
  it('runs each attack and reports what the engine found, not what the model claimed', async () => {
    fake({
      attacks: [
        {
          id: 'kill-the-only-instance',
          name: 'The one instance goes',
          description: 'Catalog API has a single replica.',
          hypothesis: 'The product read flow stops entirely because Catalog API is a SPOF.',
          killNodes: ['Catalog API'],
          passCriteria: 'Reads keep completing.',
        },
      ],
    });

    const { status, body } = await ask();
    expect(status).toBe(200);
    const runs = body.attacks as { attack: Record<string, unknown>; outcome: Record<string, unknown> }[];
    expect(runs).toHaveLength(1);

    // The names it used are resolved to ids before the run, so nothing matches twice.
    expect(runs[0]!.attack.killNodes).toEqual(['n2']);
    // And the outcome is a measurement: killing the only instance breaks the flow.
    expect(runs[0]!.outcome.brokenFlows).toEqual(['product read']);
    expect(runs[0]!.outcome.droppedPct).toBeGreaterThan(50);
  });

  it('lets a wrong prediction be visibly wrong', async () => {
    fake({
      attacks: [
        {
          id: 'blame-the-cache',
          name: 'Cache loses its hits',
          description: 'A deploy flushes Redis.',
          // Wrong: the read flow does not go through the cache, so this predicts a
          // component that will not be the one to break.
          hypothesis: 'Redis will be the first thing to break.',
          degrade: [{ node: 'Redis', hitRate: 0 }],
          rpsMultiplier: 4,
          passCriteria: 'Reads still complete.',
        },
      ],
    });

    const { body } = await ask();
    const run = (body.attacks as { attack: Record<string, unknown>; outcome: Record<string, string | null> }[])[0]!;
    // The engine names what actually gave way, and it is not what was predicted.
    expect(run.outcome.firstToBreak).not.toBe('n3');
    expect(run.outcome.verdict).toBeTruthy();
  });

  it('drops an attack aimed at something absent rather than reporting it survived', async () => {
    fake({
      attacks: [
        { id: 'a', name: 'Kill Cassandra', killNodes: ['Cassandra'], passCriteria: 'x' },
        { id: 'b', name: 'Real one', killNodes: ['Postgres'], passCriteria: 'x' },
      ],
    });
    const { body } = await ask();
    const runs = body.attacks as { attack: { id: string } }[];
    // Not "Cassandra died and you were fine": it never happened.
    expect(runs.map((r) => r.attack.id)).toEqual(['b']);
  });

  it('keeps a partly-wrong attack and says which part did not happen', async () => {
    fake({
      attacks: [
        {
          id: 'mixed',
          name: 'Two things at once',
          killNodes: ['Postgres', 'Kafka'],
          rpsMultiplier: 3,
          passCriteria: 'x',
        },
      ],
    });
    const { body } = await ask();
    const run = (body.attacks as { attack: { killNodes: string[]; unresolved: string[] } }[])[0]!;
    expect(run.attack.killNodes).toEqual(['n4']);
    expect(run.attack.unresolved).toEqual(['Kafka']);
  });

  it('orders them worst first, since that is the one worth reading', async () => {
    fake({
      attacks: [
        { id: 'mild', name: 'A bit more load', rpsMultiplier: 2, passCriteria: 'x' },
        { id: 'severe', name: 'The database goes', killNodes: ['Postgres'], rpsMultiplier: 10, passCriteria: 'x' },
      ],
    });
    const { body } = await ask();
    const runs = body.attacks as { attack: { id: string }; outcome: { droppedPct: number } }[];
    expect(runs[0]!.attack.id).toBe('severe');
    expect(runs[0]!.outcome.droppedPct).toBeGreaterThanOrEqual(runs[1]!.outcome.droppedPct);
  });

  it('says so plainly when nothing it proposed can be run', async () => {
    fake({ attacks: [{ id: 'void', name: 'Nothing at all', rpsMultiplier: 1, passCriteria: 'x' }] });
    const { status, body } = await ask();
    expect(status).toBe(502);
    expect(JSON.stringify(body)).toContain('did not produce a scenario');
  });
});

describe('before it will even try', () => {
  it('refuses an empty sheet', async () => {
    const { status, body } = await ask({
      problemId: 'l1-read-heavy-product-api',
      graph: { nodes: [], edges: [], stickies: [], flows: [] },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('Draw something first');
  });

  it('refuses a drawing with no declared flow, which would pass everything', async () => {
    const { status, body } = await ask({
      problemId: 'l1-read-heavy-product-api',
      graph: { ...graph, flows: [] },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('Declare a flow first');
  });

  it('refuses an unknown problem', async () => {
    const { status } = await ask({ problemId: 'nope', graph });
    expect(status).toBe(404);
  });

  it('needs an account', async () => {
    const res = await app.request('/api/attacks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problemId: 'l1-read-heavy-product-api', graph }),
    });
    expect(res.status).toBe(401);
  });
});
