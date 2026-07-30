// SQLite implementation of Storage — the zero-setup local backend. Synchronous
// underneath (node:sqlite), wrapped in promises so routes cannot tell which
// backend they are talking to.

import { getDb, type Db } from '../db.js';
import type { AttemptRow, MasteryRow, ReviewQueueRow, StatsAgg, Storage, UserRow } from './types.js';

const MASTERY_ALPHA = 0.3; // ema = (1-alpha)*old + alpha*new
const CACHE_TTL_DAYS = 14;

/** Column list for attempts, in the order rowToAttempt expects. */
const ATTEMPT_COLS = 'id, problem_id, round, graph_json, score_json, overall, twist_text, created_at';

interface RawAttempt {
  id: number;
  problem_id: string;
  round: number;
  graph_json: string;
  score_json: string;
  overall: number;
  twist_text: string | null;
  created_at: string;
}

const toAttempt = (r: RawAttempt): AttemptRow => ({
  id: r.id,
  problemId: r.problem_id,
  round: r.round,
  graphJson: r.graph_json,
  scoreJson: r.score_json,
  overall: r.overall,
  twistText: r.twist_text,
  createdAt: r.created_at,
});

export class SqliteStorage implements Storage {
  readonly kind = 'sqlite';
  private db: Db;

  constructor(path?: string) {
    this.db = getDb(path);
  }

  async init(): Promise<void> {
    // Must happen before the CREATE statements: a pre-auth table has to be moved
    // out of the way while its name is still free, or IF NOT EXISTS keeps it.
    this.setAsidePreAuthTables();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        round INTEGER NOT NULL DEFAULT 1,
        graph_json TEXT NOT NULL,
        score_json TEXT NOT NULL,
        overall INTEGER NOT NULL,
        twist_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_user_problem ON attempts(user_id, problem_id);

      CREATE TABLE IF NOT EXISTS mastery (
        user_id TEXT NOT NULL,
        concept TEXT NOT NULL,
        ema_score REAL NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_seen TEXT,
        PRIMARY KEY (user_id, concept)
      );

      CREATE TABLE IF NOT EXISTS problems_custom (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );

      CREATE TABLE IF NOT EXISTS designs (
        user_id TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, problem_id)
      );

      CREATE TABLE IF NOT EXISTS reference_designs (
        problem_id TEXT PRIMARY KEY,
        graph_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS llm_cache (
        key TEXT PRIMARY KEY,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Cached model replies go stale as prompts evolve; two weeks is plenty.
    this.db.prepare(`DELETE FROM llm_cache WHERE created_at < datetime('now', ?)`).run(`-${CACHE_TTL_DAYS} days`);
  }

  /**
   * The app was single-user before auth existed. Rather than orphan that
   * history, tables in the old shape are moved aside and their rows handed to
   * the first account created — see `claimLegacyData`.
   */
  private setAsidePreAuthTables(): void {
    for (const table of ['attempts', 'mastery', 'problems_custom', 'settings', 'designs']) {
      if (!this.hasTable(table)) continue;
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (cols.some((col) => col.name === 'user_id')) continue;
      this.db.exec(`DROP TABLE IF EXISTS ${table}_preauth`);
      this.db.exec(`ALTER TABLE ${table} RENAME TO ${table}_preauth`);
      console.log(`[loadbearing] ${table} kept from before accounts existed — the first account inherits it`);
    }
  }

  private hasTable(name: string): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) as { name: string } | undefined;
    return Boolean(row);
  }

  /** Moves pre-auth rows onto a user id. Called once, for the first account created. */
  async claimLegacyData(userId: string): Promise<number> {
    let moved = 0;
    const copy = (from: string, to: string, cols: string) => {
      if (!this.hasTable(from)) return;
      const info = this.db.prepare(`SELECT COUNT(*) AS n FROM ${from}`).get() as { n: number };
      this.db
        .prepare(`INSERT OR IGNORE INTO ${to} (user_id, ${cols}) SELECT ?, ${cols} FROM ${from}`)
        .run(userId);
      this.db.exec(`DROP TABLE ${from}`);
      moved += info.n;
    };
    copy('attempts_preauth', 'attempts', 'problem_id, round, graph_json, score_json, overall, twist_text, created_at');
    copy('mastery_preauth', 'mastery', 'concept, ema_score, attempts, last_seen');
    copy('problems_custom_preauth', 'problems_custom', 'id, json, created_at');
    copy('settings_preauth', 'settings', 'key, value');
    copy('designs_preauth', 'designs', 'problem_id, graph_json, updated_at');
    return moved;
  }

  // ---- users ----

  async createUser(username: string, passHash: string): Promise<UserRow> {
    const id = crypto.randomUUID();
    this.db
      .prepare(`INSERT INTO users (id, username, pass_hash) VALUES (?, ?, ?)`)
      .run(id, username, passHash);
    const row = await this.getUserById(id);
    if (!row) throw new Error('User vanished immediately after insert');
    return row;
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const row = this.db
      .prepare('SELECT id, username, pass_hash, created_at FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; pass_hash: string; created_at: string } | undefined;
    return row ? { id: row.id, username: row.username, passHash: row.pass_hash, createdAt: row.created_at } : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const row = this.db
      .prepare('SELECT id, username, pass_hash, created_at FROM users WHERE id = ?')
      .get(id) as { id: string; username: string; pass_hash: string; created_at: string } | undefined;
    return row ? { id: row.id, username: row.username, passHash: row.pass_hash, createdAt: row.created_at } : null;
  }

  async countUsers(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  // ---- attempts ----

  async insertAttempt(
    userId: string,
    a: { problemId: string; round: number; graphJson: string; scoreJson: string; overall: number; twistText: string | null },
  ): Promise<number> {
    const info = this.db
      .prepare(
        `INSERT INTO attempts (user_id, problem_id, round, graph_json, score_json, overall, twist_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, a.problemId, a.round, a.graphJson, a.scoreJson, a.overall, a.twistText);
    return Number(info.lastInsertRowid);
  }

  async listAttempts(userId: string, problemId?: string, limit = 100): Promise<AttemptRow[]> {
    const rows = (
      problemId
        ? this.db
            .prepare(`SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT ?`)
            .all(userId, problemId, limit)
        : this.db
            .prepare(`SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
            .all(userId, limit)
    ) as unknown as RawAttempt[];
    return rows.map(toAttempt);
  }

  async getAttempt(userId: string, id: number): Promise<AttemptRow | null> {
    const row = this.db
      .prepare(`SELECT ${ATTEMPT_COLS} FROM attempts WHERE user_id = ? AND id = ?`)
      .get(userId, id) as RawAttempt | undefined;
    return row ? toAttempt(row) : null;
  }

  async latestAttemptGraph(userId: string, problemId: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT graph_json FROM attempts WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId, problemId) as { graph_json: string } | undefined;
    return row ? row.graph_json : null;
  }

  // ---- mastery ----

  async upsertMastery(userId: string, concept: string, score: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, score));
    const row = this.db
      .prepare('SELECT ema_score FROM mastery WHERE user_id = ? AND concept = ?')
      .get(userId, concept) as { ema_score: number } | undefined;
    if (!row) {
      this.db
        .prepare(
          `INSERT INTO mastery (user_id, concept, ema_score, attempts, last_seen)
           VALUES (?, ?, ?, 1, datetime('now'))`,
        )
        .run(userId, concept, clamped);
      return;
    }
    const ema = (1 - MASTERY_ALPHA) * row.ema_score + MASTERY_ALPHA * clamped;
    this.db
      .prepare(
        `UPDATE mastery SET ema_score = ?, attempts = attempts + 1, last_seen = datetime('now')
         WHERE user_id = ? AND concept = ?`,
      )
      .run(ema, userId, concept);
  }

  async listMastery(userId: string): Promise<MasteryRow[]> {
    const rows = this.db
      .prepare('SELECT concept, ema_score, attempts, last_seen FROM mastery WHERE user_id = ?')
      .all(userId) as { concept: string; ema_score: number; attempts: number; last_seen: string | null }[];
    return rows.map((r) => ({
      concept: r.concept,
      emaScore: r.ema_score,
      attempts: r.attempts,
      lastSeen: r.last_seen,
    }));
  }

  async reviewQueue(userId: string): Promise<ReviewQueueRow[]> {
    const rows = this.db
      .prepare(
        `SELECT concept, ema_score, attempts, last_seen,
                julianday('now') - julianday(last_seen) AS days_since
         FROM mastery WHERE user_id = ? AND last_seen IS NOT NULL`,
      )
      .all(userId) as {
      concept: string;
      ema_score: number;
      attempts: number;
      last_seen: string | null;
      days_since: number;
    }[];
    return rows.map((r) => ({
      concept: r.concept,
      emaScore: r.ema_score,
      attempts: r.attempts,
      lastSeen: r.last_seen,
      daysSince: r.days_since,
    }));
  }

  async statsAgg(userId: string): Promise<StatsAgg> {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n, AVG(overall) AS avg FROM attempts WHERE user_id = ?')
      .get(userId) as { n: number; avg: number | null };
    return { attempts: row.n, avgOverall: row.avg };
  }

  async statsTrend(userId: string, limit: number): Promise<{ date: string; overall: number }[]> {
    return this.db
      .prepare(`SELECT date(created_at) AS date, overall FROM attempts WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
      .all(userId, limit) as { date: string; overall: number }[];
  }

  async statsDays(userId: string): Promise<string[]> {
    const rows = this.db
      .prepare(`SELECT DISTINCT date(created_at) AS d FROM attempts WHERE user_id = ? ORDER BY d DESC`)
      .all(userId) as { d: string }[];
    return rows.map((r) => r.d);
  }

  // ---- custom problems ----

  async insertCustomProblem(userId: string, id: string, json: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO problems_custom (user_id, id, json) VALUES (?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET json = excluded.json`,
      )
      .run(userId, id, json);
  }

  async listCustomProblems(userId: string): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT json FROM problems_custom WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as { json: string }[];
    return rows.map((r) => r.json);
  }

  async deleteCustomProblem(userId: string, id: string): Promise<void> {
    this.db.prepare('DELETE FROM problems_custom WHERE user_id = ? AND id = ?').run(userId, id);
  }

  // ---- settings ----

  async getSetting(userId: string, key: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  async setSetting(userId: string, key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(userId, key, value);
  }

  // ---- designs ----

  async getDesign(userId: string, problemId: string): Promise<{ graphJson: string; updatedAt: string } | null> {
    const row = this.db
      .prepare('SELECT graph_json, updated_at FROM designs WHERE user_id = ? AND problem_id = ?')
      .get(userId, problemId) as { graph_json: string; updated_at: string } | undefined;
    return row ? { graphJson: row.graph_json, updatedAt: row.updated_at } : null;
  }

  async putDesign(userId: string, problemId: string, graphJson: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO designs (user_id, problem_id, graph_json, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, problem_id) DO UPDATE SET graph_json = excluded.graph_json, updated_at = datetime('now')`,
      )
      .run(userId, problemId, graphJson);
  }

  // ---- reference designs ----

  async getReference(problemId: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT graph_json FROM reference_designs WHERE problem_id = ?')
      .get(problemId) as { graph_json: string } | undefined;
    return row ? row.graph_json : null;
  }

  async putReference(problemId: string, graphJson: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO reference_designs (problem_id, graph_json) VALUES (?, ?)
         ON CONFLICT(problem_id) DO UPDATE SET graph_json = excluded.graph_json, created_at = datetime('now')`,
      )
      .run(problemId, graphJson);
  }

  // ---- llm cache ----

  async cacheGet(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT response FROM llm_cache WHERE key = ?').get(key) as
      | { response: string }
      | undefined;
    return row ? row.response : null;
  }

  async cachePut(key: string, response: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO llm_cache (key, response) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET response = excluded.response, created_at = datetime('now')`,
      )
      .run(key, response);
  }

  async cacheDelete(key: string): Promise<void> {
    this.db.prepare('DELETE FROM llm_cache WHERE key = ?').run(key);
  }
}
