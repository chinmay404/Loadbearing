// One suite, run against every backend. Postgres is included only when
// DATABASE_URL is set, so a normal `npm test` needs no database — but the
// deployed backend can be verified with the exact same assertions, which is the
// only way to be sure the two dialects actually agree.

import { afterAll, describe, expect, it } from 'vitest';
import { SqliteStorage } from './sqlite.js';
import { PostgresStorage } from './postgres.js';
import type { Storage } from './types.js';

const PG_URL = process.env.DATABASE_URL?.trim();

const backends: { name: string; make: () => Promise<Storage> }[] = [
  {
    name: 'sqlite',
    make: async () => {
      const s = new SqliteStorage(':memory:');
      await s.init();
      return s;
    },
  },
];

if (PG_URL) {
  backends.push({
    name: 'postgres',
    make: async () => {
      const s = new PostgresStorage(PG_URL);
      await s.init();
      return s;
    },
  });
} else {
  describe.skip('postgres storage (set DATABASE_URL to run)', () => {
    it('skipped', () => undefined);
  });
}

for (const backend of backends) {
  describe(`${backend.name} storage`, () => {
    const opened: Storage[] = [];
    const fresh = async () => {
      const s = await backend.make();
      opened.push(s);
      return s;
    };
    // Usernames are globally unique, so a shared Postgres needs distinct ones
    // per assertion rather than a truncate that would clobber real data.
    let n = 0;
    const uniq = (base: string) => `${base}-${backend.name}-${process.pid}-${n++}`;

    afterAll(async () => {
      for (const s of opened) {
        const close = (s as { close?: () => Promise<void> }).close;
        if (close) await close.call(s);
      }
    });

    it('creates and finds users, case-normalised by the caller', async () => {
      const s = await fresh();
      const name = uniq('ada');
      const user = await s.createUser(name, 'hash-1');
      expect(user.username).toBe(name);
      expect(user.id).toMatch(/[0-9a-f-]{36}/);

      expect((await s.getUserByUsername(name))?.passHash).toBe('hash-1');
      expect((await s.getUserById(user.id))?.username).toBe(name);
      expect(await s.getUserByUsername(uniq('nobody'))).toBeNull();
    });

    it('refuses a duplicate username', async () => {
      const s = await fresh();
      const name = uniq('dup');
      await s.createUser(name, 'h');
      await expect(s.createUser(name, 'h')).rejects.toThrow();
    });

    it('mastery: first sample sets the ema, later samples use 0.7*old + 0.3*new', async () => {
      const s = await fresh();
      const u = await s.createUser(uniq('m'), 'h');

      await s.upsertMastery(u.id, 'idempotency', 0.5);
      let row = (await s.listMastery(u.id)).find((r) => r.concept === 'idempotency');
      expect(row?.emaScore).toBeCloseTo(0.5, 5);
      expect(row?.attempts).toBe(1);

      await s.upsertMastery(u.id, 'idempotency', 1.0);
      row = (await s.listMastery(u.id)).find((r) => r.concept === 'idempotency');
      expect(row?.emaScore).toBeCloseTo(0.65, 5);
      expect(row?.attempts).toBe(2);
    });

    it('mastery is per user', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('a'), 'h');
      const b = await s.createUser(uniq('b'), 'h');
      await s.upsertMastery(a.id, 'caching', 0.9);

      expect((await s.listMastery(a.id)).length).toBe(1);
      expect(await s.listMastery(b.id)).toEqual([]);
    });

    it('settings round-trip and are per user', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('sa'), 'h');
      const b = await s.createUser(uniq('sb'), 'h');

      expect(await s.getSetting(a.id, 'model')).toBeNull();
      await s.setSetting(a.id, 'model', 'claude-sonnet-5');
      expect(await s.getSetting(a.id, 'model')).toBe('claude-sonnet-5');
      await s.setSetting(a.id, 'model', 'llama-3.3-70b');
      expect(await s.getSetting(a.id, 'model')).toBe('llama-3.3-70b');
      expect(await s.getSetting(b.id, 'model')).toBeNull();
    });

    it('attempts: insert, list, fetch, and latest-graph, all scoped to the user', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('ta'), 'h');
      const b = await s.createUser(uniq('tb'), 'h');

      const first = await s.insertAttempt(a.id, {
        problemId: 'l1-url-shortener',
        round: 1,
        graphJson: '{"nodes":[{"id":"one"}]}',
        scoreJson: '{"overall":40}',
        overall: 40,
        twistText: null,
      });
      const second = await s.insertAttempt(a.id, {
        problemId: 'l1-url-shortener',
        round: 2,
        graphJson: '{"nodes":[{"id":"two"}]}',
        scoreJson: '{"overall":70}',
        overall: 70,
        twistText: 'traffic 10x',
      });
      expect(second).toBeGreaterThan(first);

      const list = await s.listAttempts(a.id, 'l1-url-shortener');
      expect(list.map((r) => r.round)).toEqual([2, 1]); // newest first
      expect(list[0]!.twistText).toBe('traffic 10x');

      expect((await s.getAttempt(a.id, first))?.overall).toBe(40);
      expect(await s.getAttempt(b.id, first)).toBeNull(); // not yours
      expect(await s.latestAttemptGraph(a.id, 'l1-url-shortener')).toBe('{"nodes":[{"id":"two"}]}');
      expect(await s.latestAttemptGraph(a.id, 'other-problem')).toBeNull();
      expect(await s.listAttempts(b.id)).toEqual([]);
    });

    it('stats aggregate only the asking user', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('sta'), 'h');
      const b = await s.createUser(uniq('stb'), 'h');
      for (const overall of [40, 80]) {
        await s.insertAttempt(a.id, {
          problemId: 'p',
          round: 1,
          graphJson: '{}',
          scoreJson: '{}',
          overall,
          twistText: null,
        });
      }
      await s.insertAttempt(b.id, {
        problemId: 'p',
        round: 1,
        graphJson: '{}',
        scoreJson: '{}',
        overall: 10,
        twistText: null,
      });

      const agg = await s.statsAgg(a.id);
      expect(agg.attempts).toBe(2);
      expect(agg.avgOverall).toBeCloseTo(60, 5);
      expect((await s.statsTrend(a.id, 10)).length).toBe(2);
      expect((await s.statsDays(a.id)).length).toBe(1);
      expect((await s.statsAgg(b.id)).attempts).toBe(1);
    });

    it('the review queue reports fractional days since the last sighting', async () => {
      const s = await fresh();
      const u = await s.createUser(uniq('rq'), 'h');
      await s.upsertMastery(u.id, 'sharding', 0.3);
      const queue = await s.reviewQueue(u.id);
      expect(queue.length).toBe(1);
      expect(queue[0]!.concept).toBe('sharding');
      expect(queue[0]!.daysSince).toBeGreaterThanOrEqual(0);
      expect(queue[0]!.daysSince).toBeLessThan(1);
    });

    it('custom problems: upsert, list newest-first, delete', async () => {
      const s = await fresh();
      const u = await s.createUser(uniq('cp'), 'h');
      await s.insertCustomProblem(u.id, 'mine-1', '{"id":"mine-1"}');
      await s.insertCustomProblem(u.id, 'mine-1', '{"id":"mine-1","v":2}');
      expect(await s.listCustomProblems(u.id)).toEqual(['{"id":"mine-1","v":2}']);

      await s.deleteCustomProblem(u.id, 'mine-1');
      expect(await s.listCustomProblems(u.id)).toEqual([]);
    });

    it('designs: last write wins, per user and problem', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('da'), 'h');
      const b = await s.createUser(uniq('db'), 'h');
      expect(await s.getDesign(a.id, 'p1')).toBeNull();

      await s.putDesign(a.id, 'p1', '{"v":1}');
      await s.putDesign(a.id, 'p1', '{"v":2}');
      expect((await s.getDesign(a.id, 'p1'))?.graphJson).toBe('{"v":2}');
      expect(await s.getDesign(b.id, 'p1')).toBeNull();
    });

    it('reference designs are shared across users', async () => {
      const s = await fresh();
      const a = await s.createUser(uniq('ra'), 'h');
      const b = await s.createUser(uniq('rb'), 'h');
      const problemId = uniq('ref-problem');
      expect(await s.getReference(problemId)).toBeNull();

      await s.putReference(problemId, '{"nodes":[]}');
      expect(await s.getReference(problemId)).toBe('{"nodes":[]}');
      // Both accounts see the same reference — it belongs to the problem.
      expect(await s.getReference(problemId)).toBe('{"nodes":[]}');
      expect(a.id).not.toBe(b.id);
    });

    it('llm cache: get, put, overwrite, delete', async () => {
      const s = await fresh();
      const key = `k-${uniq('cache')}`;
      expect(await s.cacheGet(key)).toBeNull();
      await s.cachePut(key, '{"a":1}');
      expect(await s.cacheGet(key)).toBe('{"a":1}');
      await s.cachePut(key, '{"a":2}');
      expect(await s.cacheGet(key)).toBe('{"a":2}');
      await s.cacheDelete(key);
      expect(await s.cacheGet(key)).toBeNull();
    });

    it('init is idempotent', async () => {
      const s = await fresh();
      await s.init();
      await s.init();
      const u = await s.createUser(uniq('idem'), 'h');
      expect(await s.getUserById(u.id)).not.toBeNull();
    });
  });
}
