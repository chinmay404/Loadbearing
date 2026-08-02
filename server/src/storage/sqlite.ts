// SQLite implementation of Storage — the zero-setup local backend. Synchronous
// underneath (node:sqlite), wrapped in promises so routes cannot tell which
// backend they are talking to.

import type { NoteScope } from '@loadbearing/shared';
import { getDb, type Db } from '../db.js';
import type {
  ApiTokenRow,
  AttemptRow,
  CanvasRow,
  MasteryRow,
  NoteRow,
  ProjectRow,
  ReviewQueueRow,
  StatsAgg,
  Storage,
  UserRow,
} from './types.js';

const MASTERY_ALPHA = 0.3; // ema = (1-alpha)*old + alpha*new
const CACHE_TTL_DAYS = 14;

/**
 * datetime('now') has one-second granularity, so two projects touched in the same
 * second sort arbitrarily and "most recently worked on" is a coin flip. Ordering
 * has to be finer than a person can click. Same string shape, so comparisons and
 * existing rows are unaffected.
 */
const NOW_MS = "strftime('%Y-%m-%d %H:%M:%f','now')";

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

interface RawProject {
  id: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  canvas_count?: number;
}

interface RawCanvas {
  id: string;
  project_id: string;
  name: string;
  note: string;
  graph_json: string;
  position: number;
  updated_at: string;
}

const toProject = (r: RawProject): ProjectRow => ({
  id: r.id,
  name: r.name,
  summary: r.summary,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toCanvas = (r: RawCanvas): CanvasRow => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  note: r.note,
  graphJson: r.graph_json,
  position: Number(r.position),
  updatedAt: r.updated_at,
});

interface RawNote {
  id: string;
  scope: string;
  scope_id: string;
  title: string;
  body: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface RawApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const toApiToken = (r: RawApiToken): ApiTokenRow => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at ?? '',
});

const toNote = (r: RawNote): NoteRow => ({
  id: r.id,
  scope: r.scope as NoteScope,
  scopeId: r.scope_id,
  title: r.title,
  body: r.body,
  position: Number(r.position),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

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
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
        PRIMARY KEY (user_id, problem_id)
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
      );
      CREATE INDEX IF NOT EXISTS notes_by_scope ON notes (user_id, scope, scope_id, position);

      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS api_tokens_by_user ON api_tokens (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS chats (
        user_id TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        turns_json TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS project_canvases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        graph_json TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_canvases_project ON project_canvases(project_id, position);
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
        // Millisecond resolution, because this timestamp is what "where you left off"
        // orders by: three sheets touched in the same second tie, and the list comes
        // back in an order that has nothing to do with when you worked on them.
        `INSERT INTO designs (user_id, problem_id, graph_json, updated_at) VALUES (?, ?, ?, ${NOW_MS})
         ON CONFLICT(user_id, problem_id) DO UPDATE SET graph_json = excluded.graph_json, updated_at = ${NOW_MS}`,
      )
      .run(userId, problemId, graphJson);
  }

  async listDesignActivity(
    userId: string,
    limit = 40,
  ): Promise<{ problemId: string; updatedAt: string }[]> {
    const rows = this.db
      .prepare(
        `SELECT problem_id, updated_at FROM designs WHERE user_id = ?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as { problem_id: string; updated_at: string }[];
    return rows.map((r) => ({ problemId: r.problem_id, updatedAt: r.updated_at }));
  }

  // ---- notes ----

  // ---- API tokens ----

  async createApiToken(
    userId: string,
    token: { id: string; name: string; hash: string },
  ): Promise<ApiTokenRow> {
    this.db
      .prepare('INSERT INTO api_tokens (id, user_id, name, hash) VALUES (?, ?, ?, ?)')
      .run(token.id, userId, token.name, token.hash);
    const row = (await this.listApiTokens(userId)).find((t) => t.id === token.id);
    if (!row) throw new Error('Token vanished immediately after insert');
    return row;
  }

  async listApiTokens(userId: string): Promise<ApiTokenRow[]> {
    const rows = this.db
      .prepare(
        `SELECT id, name, created_at, last_used_at FROM api_tokens
         WHERE user_id = ? ORDER BY created_at DESC, id`,
      )
      .all(userId) as unknown as RawApiToken[];
    return rows.map(toApiToken);
  }

  async findApiToken(
    id: string,
  ): Promise<{ id: string; userId: string; hash: string; lastUsedAt: string } | null> {
    const row = this.db
      .prepare('SELECT id, user_id, hash, last_used_at FROM api_tokens WHERE id = ?')
      .get(id) as { id: string; user_id: string; hash: string; last_used_at: string | null } | undefined;
    if (!row) return null;
    return { id: row.id, userId: row.user_id, hash: row.hash, lastUsedAt: row.last_used_at ?? '' };
  }

  async touchApiToken(id: string): Promise<void> {
    this.db
      .prepare(`UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`)
      .run(id);
  }

  async deleteApiToken(userId: string, id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId);
    return Number(res.changes) > 0;
  }

  async listNotes(userId: string, scope: NoteScope, scopeId: string): Promise<NoteRow[]> {
    const rows = this.db
      .prepare(
        `SELECT id, scope, scope_id, title, body, position, created_at, updated_at
         FROM notes WHERE user_id = ? AND scope = ? AND scope_id = ?
         ORDER BY position, created_at DESC, id`,
      )
      .all(userId, scope, scopeId) as unknown as RawNote[];
    return rows.map(toNote);
  }

  async listAllNotes(userId: string): Promise<NoteRow[]> {
    // Ordered by when it was last touched rather than by position: `position` is
    // manual order *within* a sheet, and comparing one sheet's ordering against
    // another's is meaningless. Across everything, recency is the only honest sort.
    const rows = this.db
      .prepare(
        `SELECT id, scope, scope_id, title, body, position, created_at, updated_at
         FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id`,
      )
      .all(userId) as unknown as RawNote[];
    return rows.map(toNote);
  }

  async createNote(
    userId: string,
    note: { scope: NoteScope; scopeId: string; title: string; body: string },
  ): Promise<NoteRow> {
    const id = crypto.randomUUID();
    // New notes go to the top: the one just written is the one being worked on.
    const lowest = this.db
      .prepare('SELECT MIN(position) AS p FROM notes WHERE user_id = ? AND scope = ? AND scope_id = ?')
      .get(userId, note.scope, note.scopeId) as { p: number | null };
    const position = (lowest.p ?? 0) - 1;
    this.db
      .prepare(
        `INSERT INTO notes (id, user_id, scope, scope_id, title, body, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, note.scope, note.scopeId, note.title, note.body, position);
    const row = (await this.listNotes(userId, note.scope, note.scopeId)).find((n) => n.id === id);
    if (!row) throw new Error('Note vanished immediately after insert');
    return row;
  }

  async updateNote(
    userId: string,
    id: string,
    patch: { title?: string; body?: string; position?: number },
  ): Promise<NoteRow | null> {
    const sets: string[] = [];
    const args: (string | number)[] = [];
    if (patch.title !== undefined) (sets.push('title = ?'), args.push(patch.title));
    if (patch.body !== undefined) (sets.push('body = ?'), args.push(patch.body));
    if (patch.position !== undefined) (sets.push('position = ?'), args.push(patch.position));
    if (sets.length > 0) {
      sets.push(`updated_at = strftime('%Y-%m-%d %H:%M:%f','now')`);
      this.db
        .prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...args, id, userId);
    }
    const row = this.db
      .prepare(
        `SELECT id, scope, scope_id, title, body, position, created_at, updated_at
         FROM notes WHERE id = ? AND user_id = ?`,
      )
      .get(id, userId) as RawNote | undefined;
    return row ? toNote(row) : null;
  }

  async deleteNote(userId: string, id: string): Promise<void> {
    this.db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId);
  }

  // ---- coaching conversation ----

  async getChat(userId: string, problemId: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT turns_json FROM chats WHERE user_id = ? AND problem_id = ?')
      .get(userId, problemId) as { turns_json: string } | undefined;
    return row ? row.turns_json : null;
  }

  async putChat(userId: string, problemId: string, turnsJson: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO chats (user_id, problem_id, turns_json, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, problem_id) DO UPDATE SET turns_json = excluded.turns_json, updated_at = datetime('now')`,
      )
      .run(userId, problemId, turnsJson);
  }

  async deleteChat(userId: string, problemId: string): Promise<void> {
    this.db.prepare('DELETE FROM chats WHERE user_id = ? AND problem_id = ?').run(userId, problemId);
  }

  // ---- projects and their canvases ----

  async createProject(userId: string, name: string, summary: string): Promise<ProjectRow> {
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO projects (id, user_id, name, summary) VALUES (?, ?, ?, ?)')
      .run(id, userId, name, summary);
    const row = await this.getProject(userId, id);
    if (!row) throw new Error('Project vanished immediately after insert');
    return row;
  }

  async listProjects(userId: string): Promise<(ProjectRow & { canvasCount: number })[]> {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.summary, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM project_canvases c WHERE c.project_id = p.id) AS canvas_count
         FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.created_at DESC, p.id`,
      )
      .all(userId) as unknown as RawProject[];
    return rows.map((r) => ({ ...toProject(r), canvasCount: Number(r.canvas_count ?? 0) }));
  }

  async getProject(userId: string, id: string): Promise<ProjectRow | null> {
    const row = this.db
      .prepare('SELECT id, name, summary, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?')
      .get(userId, id) as RawProject | undefined;
    return row ? toProject(row) : null;
  }

  async updateProject(
    userId: string,
    id: string,
    patch: { name?: string; summary?: string },
  ): Promise<void> {
    if (patch.name !== undefined) {
      this.db
        .prepare(`UPDATE projects SET name = ?, updated_at = ${NOW_MS} WHERE user_id = ? AND id = ?`)
        .run(patch.name, userId, id);
    }
    if (patch.summary !== undefined) {
      this.db
        .prepare(`UPDATE projects SET summary = ?, updated_at = ${NOW_MS} WHERE user_id = ? AND id = ?`)
        .run(patch.summary, userId, id);
    }
  }

  async deleteProject(userId: string, id: string): Promise<void> {
    // No cascade in this schema, so the children go first and explicitly.
    this.db.prepare('DELETE FROM project_canvases WHERE user_id = ? AND project_id = ?').run(userId, id);
    this.db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').run(userId, id);
  }

  async createCanvas(userId: string, projectId: string, name: string, note: string): Promise<CanvasRow> {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM project_canvases WHERE project_id = ?')
      .get(projectId) as { n: number };
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_canvases (id, project_id, user_id, name, note, graph_json, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, userId, name, note, '{}', next.n);
    this.touchProject(userId, projectId);
    const row = await this.getCanvas(userId, id);
    if (!row) throw new Error('Canvas vanished immediately after insert');
    return row;
  }

  async listCanvases(userId: string, projectId: string): Promise<CanvasRow[]> {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, name, note, graph_json, position, updated_at
         FROM project_canvases WHERE user_id = ? AND project_id = ? ORDER BY position, updated_at`,
      )
      .all(userId, projectId) as unknown as RawCanvas[];
    return rows.map(toCanvas);
  }

  async getCanvas(userId: string, id: string): Promise<CanvasRow | null> {
    const row = this.db
      .prepare(
        `SELECT id, project_id, name, note, graph_json, position, updated_at
         FROM project_canvases WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as RawCanvas | undefined;
    return row ? toCanvas(row) : null;
  }

  async updateCanvas(
    userId: string,
    id: string,
    patch: { name?: string; note?: string; graphJson?: string; position?: number },
  ): Promise<void> {
    const pairs: [string, string | number][] = [];
    if (patch.name !== undefined) pairs.push(['name', patch.name]);
    if (patch.note !== undefined) pairs.push(['note', patch.note]);
    if (patch.graphJson !== undefined) pairs.push(['graph_json', patch.graphJson]);
    if (patch.position !== undefined) pairs.push(['position', patch.position]);
    for (const [column, value] of pairs) {
      this.db
        .prepare(
          `UPDATE project_canvases SET ${column} = ?, updated_at = ${NOW_MS}
           WHERE user_id = ? AND id = ?`,
        )
        .run(value, userId, id);
    }
    const row = await this.getCanvas(userId, id);
    if (row) this.touchProject(userId, row.projectId);
  }

  async deleteCanvas(userId: string, id: string): Promise<void> {
    this.db.prepare('DELETE FROM project_canvases WHERE user_id = ? AND id = ?').run(userId, id);
  }

  /** A project's timestamp reflects the newest work in it, not when it was named. */
  private touchProject(userId: string, projectId: string): void {
    this.db
      .prepare(`UPDATE projects SET updated_at = ${NOW_MS} WHERE user_id = ? AND id = ?`)
      .run(userId, projectId);
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
