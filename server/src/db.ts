// SQLite via Node's built-in node:sqlite — no native build step on Windows.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

// Loaded through createRequire so bundlers (vite/vitest) don't try to resolve
// `node:sqlite` statically — its prefixed-only builtin name breaks their resolver.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export type Db = InstanceType<typeof DatabaseSync>;

const MASTERY_ALPHA = 0.3; // ema = (1-alpha)*old + alpha*new

export function getDb(path = 'data/archdojo.sqlite'): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      graph_json TEXT NOT NULL,
      score_json TEXT NOT NULL,
      overall INTEGER NOT NULL,
      twist_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_problem ON attempts(problem_id);

    CREATE TABLE IF NOT EXISTS mastery (
      concept TEXT PRIMARY KEY,
      ema_score REAL NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT
    );

    CREATE TABLE IF NOT EXISTS problems_custom (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS designs (
      problem_id TEXT PRIMARY KEY,
      graph_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function upsertMastery(db: Db, concept: string, score: number): void {
  const clamped = Math.max(0, Math.min(1, score));
  const row = db.prepare('SELECT ema_score, attempts FROM mastery WHERE concept = ?').get(concept) as
    | { ema_score: number; attempts: number }
    | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO mastery (concept, ema_score, attempts, last_seen) VALUES (?, ?, 1, datetime('now'))`,
    ).run(concept, clamped);
    return;
  }
  const ema = (1 - MASTERY_ALPHA) * row.ema_score + MASTERY_ALPHA * clamped;
  db.prepare(
    `UPDATE mastery SET ema_score = ?, attempts = attempts + 1, last_seen = datetime('now') WHERE concept = ?`,
  ).run(ema, concept);
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

let singleton: Db | null = null;
export function db(): Db {
  if (!singleton) singleton = getDb(process.env.ARCHDOJO_DB ?? 'data/archdojo.sqlite');
  return singleton;
}
