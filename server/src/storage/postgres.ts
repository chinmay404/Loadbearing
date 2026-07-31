// Postgres (Supabase) implementation of Storage — the deployed backend.
//
// Two constraints shape this file. First, it must survive serverless: a pool of
// one or two connections, opened lazily, because a Vercel function has no
// long-lived process to share a big pool with. Second, it must run behind
// Supabase's transaction pooler, which forbids server-side prepared statements —
// so every query is a plain parameterised text query, never a named one.

import pg from 'pg';
import { adviseOnConnectionString } from './advice.js';
import type { AttemptRow, MasteryRow, ReviewQueueRow, StatsAgg, Storage, UserRow } from './types.js';

const MASTERY_ALPHA = 0.3;
const CACHE_TTL_DAYS = 14;

const ATTEMPT_COLS =
  'id, problem_id, round, graph_json, score_json, overall, twist_text, created_at';

interface RawAttempt {
  id: string | number;
  problem_id: string;
  round: string | number;
  graph_json: string;
  score_json: string;
  overall: string | number;
  twist_text: string | null;
  created_at: Date | string;
}

const iso = (v: Date | string | null): string =>
  v === null ? '' : v instanceof Date ? v.toISOString() : String(v);

const toAttempt = (r: RawAttempt): AttemptRow => ({
  id: Number(r.id),
  problemId: r.problem_id,
  round: Number(r.round),
  graphJson: r.graph_json,
  scoreJson: r.score_json,
  overall: Number(r.overall),
  twistText: r.twist_text,
  createdAt: iso(r.created_at),
});

export class PostgresStorage implements Storage {
  readonly kind = 'postgres';
  private pool: pg.Pool;

  /** Diagnosis of the connection string, surfaced on /api/health. */
  readonly advice: string | null;

  constructor(connectionString: string) {
    // On serverless there is one pool per instance and the platform decides how
    // many instances exist, so the pool must be small: a pool of N multiplies by
    // however many functions happen to be warm. One connection per instance,
    // released quickly, is the shape that survives a pooler's client limit.
    const serverless = Boolean(process.env.VERCEL);
    this.advice = adviseOnConnectionString(connectionString, serverless);
    if (this.advice) console.warn(`[loadbearing] ${this.advice}`);

    this.pool = new pg.Pool({
      connectionString,
      // Supabase terminates TLS with a certificate this client has no root for;
      // the connection is still encrypted, and the host is fixed by the URL.
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX ?? (serverless ? 1 : 5)),
      idleTimeoutMillis: serverless ? 2_000 : 10_000,
      connectionTimeoutMillis: 15_000,
      // Hand the connection back as soon as the instance goes idle rather than
      // holding a slot open for the next invocation that may never come.
      allowExitOnIdle: serverless,
      // A query that never answers must not become a 60-second gateway timeout:
      // that reports as "the app is broken" with no clue which call stalled.
      // Client-side, so it works behind a pooler that forbids session-level SET.
      query_timeout: 20_000,
    });
  }

  private async q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query({ text: sql, values: params as any[] });
    return res.rows as T[];
  }

  private async one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q<T>(sql, params);
    return rows.length > 0 ? rows[0]! : null;
  }

  async init(): Promise<void> {
    // Every cold start used to re-run the whole DDL block. CREATE TABLE IF NOT
    // EXISTS still takes an ACCESS EXCLUSIVE lock even when it does nothing, so a
    // fleet of functions waking at once serialises on the same catalog locks —
    // and a request that arrives mid-storm waits behind them. One cheap probe
    // makes the common path a single SELECT.
    //
    // The cost is that a future schema change needs a real migration step rather
    // than being picked up here. That is the correct trade: silent DDL on the
    // request path is not a migration story either.
    const existing = await this.one<{ one: number }>(
      `SELECT 1 AS one FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    if (existing) {
      await this.pruneCache();
      return;
    }

    await this.q(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS attempts (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_id TEXT NOT NULL,
        round INTEGER NOT NULL DEFAULT 1,
        graph_json TEXT NOT NULL,
        score_json TEXT NOT NULL,
        overall INTEGER NOT NULL,
        twist_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_attempts_user_problem ON attempts(user_id, problem_id)`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS mastery (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept TEXT NOT NULL,
        ema_score DOUBLE PRECISION NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_seen TIMESTAMPTZ,
        PRIMARY KEY (user_id, concept)
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS problems_custom (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS settings (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS designs (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_id TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, problem_id)
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS reference_designs (
        problem_id TEXT PRIMARY KEY,
        graph_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.q(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        key TEXT PRIMARY KEY,
        response TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.pruneCache();
  }

  /** Cached model replies go stale as prompts evolve; two weeks is plenty. */
  private async pruneCache(): Promise<void> {
    await this.q(`DELETE FROM llm_cache WHERE created_at < now() - ($1 || ' days')::interval`, [
      String(CACHE_TTL_DAYS),
    ]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---- users ----

  async createUser(username: string, passHash: string): Promise<UserRow> {
    const row = await this.one<{ id: string; username: string; pass_hash: string; created_at: Date }>(
      `INSERT INTO users (id, username, pass_hash) VALUES (gen_random_uuid(), $1, $2)
       RETURNING id, username, pass_hash, created_at`,
      [username, passHash],
    );
    if (!row) throw new Error('Insert returned no user row');
    return { id: row.id, username: row.username, passHash: row.pass_hash, createdAt: iso(row.created_at) };
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const row = await this.one<{ id: string; username: string; pass_hash: string; created_at: Date }>(
      'SELECT id, username, pass_hash, created_at FROM users WHERE username = $1',
      [username],
    );
    return row
      ? { id: row.id, username: row.username, passHash: row.pass_hash, createdAt: iso(row.created_at) }
      : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const row = await this.one<{ id: string; username: string; pass_hash: string; created_at: Date }>(
      'SELECT id, username, pass_hash, created_at FROM users WHERE id = $1',
      [id],
    );
    return row
      ? { id: row.id, username: row.username, passHash: row.pass_hash, createdAt: iso(row.created_at) }
      : null;
  }

  async countUsers(): Promise<number> {
    const row = await this.one<{ n: string }>('SELECT COUNT(*) AS n FROM users');
    return Number(row?.n ?? 0);
  }

  async claimLegacyData(): Promise<number> {
    return 0; // Postgres only ever existed after accounts did.
  }

  // ---- attempts ----

  async insertAttempt(
    userId: string,
    a: { problemId: string; round: number; graphJson: string; scoreJson: string; overall: number; twistText: string | null },
  ): Promise<number> {
    const row = await this.one<{ id: string }>(
      `INSERT INTO attempts (user_id, problem_id, round, graph_json, score_json, overall, twist_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, a.problemId, a.round, a.graphJson, a.scoreJson, a.overall, a.twistText],
    );
    return Number(row?.id ?? 0);
  }

  async listAttempts(userId: string, problemId?: string, limit = 100): Promise<AttemptRow[]> {
    const rows = problemId
      ? await this.q<RawAttempt>(
          `SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = $1 AND problem_id = $2 ORDER BY id DESC LIMIT $3`,
          [userId, problemId, limit],
        )
      : await this.q<RawAttempt>(
          `SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
          [userId, limit],
        );
    return rows.map(toAttempt);
  }

  async getAttempt(userId: string, id: number): Promise<AttemptRow | null> {
    const row = await this.one<RawAttempt>(
      `SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return row ? toAttempt(row) : null;
  }

  async latestAttemptGraph(userId: string, problemId: string): Promise<string | null> {
    const row = await this.one<{ graph_json: string }>(
      'SELECT graph_json FROM attempts WHERE user_id = $1 AND problem_id = $2 ORDER BY id DESC LIMIT 1',
      [userId, problemId],
    );
    return row ? row.graph_json : null;
  }

  // ---- mastery ----

  async upsertMastery(userId: string, concept: string, score: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, score));
    // The EMA is computed in SQL so a concurrent second grading cannot read a
    // stale score and overwrite the first one's update.
    await this.q(
      `INSERT INTO mastery (user_id, concept, ema_score, attempts, last_seen)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (user_id, concept) DO UPDATE
         SET ema_score = (1 - $4::double precision) * mastery.ema_score + $4::double precision * $3::double precision,
             attempts = mastery.attempts + 1,
             last_seen = now()`,
      [userId, concept, clamped, MASTERY_ALPHA],
    );
  }

  async listMastery(userId: string): Promise<MasteryRow[]> {
    const rows = await this.q<{
      concept: string;
      ema_score: number;
      attempts: number;
      last_seen: Date | null;
    }>('SELECT concept, ema_score, attempts, last_seen FROM mastery WHERE user_id = $1', [userId]);
    return rows.map((r) => ({
      concept: r.concept,
      emaScore: Number(r.ema_score),
      attempts: Number(r.attempts),
      lastSeen: r.last_seen ? iso(r.last_seen) : null,
    }));
  }

  async reviewQueue(userId: string): Promise<ReviewQueueRow[]> {
    const rows = await this.q<{
      concept: string;
      ema_score: number;
      attempts: number;
      last_seen: Date | null;
      days_since: number;
    }>(
      `SELECT concept, ema_score, attempts, last_seen,
              EXTRACT(EPOCH FROM (now() - last_seen)) / 86400.0 AS days_since
       FROM mastery WHERE user_id = $1 AND last_seen IS NOT NULL`,
      [userId],
    );
    return rows.map((r) => ({
      concept: r.concept,
      emaScore: Number(r.ema_score),
      attempts: Number(r.attempts),
      lastSeen: r.last_seen ? iso(r.last_seen) : null,
      daysSince: Number(r.days_since),
    }));
  }

  async statsAgg(userId: string): Promise<StatsAgg> {
    const row = await this.one<{ n: string; avg: string | null }>(
      'SELECT COUNT(*) AS n, AVG(overall) AS avg FROM attempts WHERE user_id = $1',
      [userId],
    );
    return {
      attempts: Number(row?.n ?? 0),
      avgOverall: row?.avg === null || row?.avg === undefined ? null : Number(row.avg),
    };
  }

  async statsTrend(userId: string, limit: number): Promise<{ date: string; overall: number }[]> {
    const rows = await this.q<{ date: string; overall: number }>(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS date, overall
       FROM attempts WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({ date: r.date, overall: Number(r.overall) }));
  }

  async statsDays(userId: string): Promise<string[]> {
    const rows = await this.q<{ d: string }>(
      `SELECT DISTINCT to_char(created_at, 'YYYY-MM-DD') AS d FROM attempts WHERE user_id = $1 ORDER BY d DESC`,
      [userId],
    );
    return rows.map((r) => r.d);
  }

  // ---- custom problems ----

  async insertCustomProblem(userId: string, id: string, json: string): Promise<void> {
    await this.q(
      `INSERT INTO problems_custom (user_id, id, json) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, id) DO UPDATE SET json = excluded.json`,
      [userId, id, json],
    );
  }

  async listCustomProblems(userId: string): Promise<string[]> {
    const rows = await this.q<{ json: string }>(
      'SELECT json FROM problems_custom WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((r) => r.json);
  }

  async deleteCustomProblem(userId: string, id: string): Promise<void> {
    await this.q('DELETE FROM problems_custom WHERE user_id = $1 AND id = $2', [userId, id]);
  }

  // ---- settings ----

  async getSetting(userId: string, key: string): Promise<string | null> {
    const row = await this.one<{ value: string }>(
      'SELECT value FROM settings WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    return row ? row.value : null;
  }

  async setSetting(userId: string, key: string, value: string): Promise<void> {
    await this.q(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
      [userId, key, value],
    );
  }

  // ---- designs ----

  async getDesign(userId: string, problemId: string): Promise<{ graphJson: string; updatedAt: string } | null> {
    const row = await this.one<{ graph_json: string; updated_at: Date }>(
      'SELECT graph_json, updated_at FROM designs WHERE user_id = $1 AND problem_id = $2',
      [userId, problemId],
    );
    return row ? { graphJson: row.graph_json, updatedAt: iso(row.updated_at) } : null;
  }

  async putDesign(userId: string, problemId: string, graphJson: string): Promise<void> {
    await this.q(
      `INSERT INTO designs (user_id, problem_id, graph_json, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, problem_id) DO UPDATE SET graph_json = excluded.graph_json, updated_at = now()`,
      [userId, problemId, graphJson],
    );
  }

  // ---- reference designs ----

  async getReference(problemId: string): Promise<string | null> {
    const row = await this.one<{ graph_json: string }>(
      'SELECT graph_json FROM reference_designs WHERE problem_id = $1',
      [problemId],
    );
    return row ? row.graph_json : null;
  }

  async putReference(problemId: string, graphJson: string): Promise<void> {
    await this.q(
      `INSERT INTO reference_designs (problem_id, graph_json) VALUES ($1, $2)
       ON CONFLICT (problem_id) DO UPDATE SET graph_json = excluded.graph_json, created_at = now()`,
      [problemId, graphJson],
    );
  }

  // ---- llm cache ----

  async cacheGet(key: string): Promise<string | null> {
    const row = await this.one<{ response: string }>('SELECT response FROM llm_cache WHERE key = $1', [key]);
    return row ? row.response : null;
  }

  async cachePut(key: string, response: string): Promise<void> {
    await this.q(
      `INSERT INTO llm_cache (key, response) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET response = excluded.response, created_at = now()`,
      [key, response],
    );
  }

  async cacheDelete(key: string): Promise<void> {
    await this.q('DELETE FROM llm_cache WHERE key = $1', [key]);
  }
}
