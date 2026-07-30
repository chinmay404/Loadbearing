// SQLite via Node's built-in node:sqlite — no native build step on Windows.
// This module only opens connections; the schema and every query live in
// `storage/sqlite.ts` behind the Storage interface.
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Loaded through createRequire so bundlers (vite/vitest) don't try to resolve
// `node:sqlite` statically — its prefixed-only builtin name breaks their resolver.
// Resolved on first use rather than at import: a serverless deployment running on
// Postgres must not fail to boot because its Node build lacks node:sqlite.
let ctor: typeof import('node:sqlite').DatabaseSync | null = null;
function DatabaseSyncClass(): typeof import('node:sqlite').DatabaseSync {
  if (!ctor) {
    const nodeRequire = createRequire(import.meta.url);
    ctor = (nodeRequire('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
  }
  return ctor;
}

export type Db = import('node:sqlite').DatabaseSync;

/**
 * Anchored to the repository, not to the process's working directory. A relative
 * path here means `npm run dev` and `npm --workspace server run dev` open two
 * different files depending on where they were launched from, and a history that
 * silently forks in two is worse than one that fails loudly.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = join(REPO_ROOT, 'data', 'loadbearing.sqlite');
/** What the file was called before the app was renamed. */
const LEGACY_DB_PATH = join(REPO_ROOT, 'data', 'archdojo.sqlite');

export function getDb(path = DB_PATH): Db {
  // Carry an existing history across the rename rather than silently starting
  // fresh: attempts and concept mastery are the whole point of keeping a file.
  if (path === DB_PATH && !existsSync(path) && existsSync(LEGACY_DB_PATH)) {
    renameSync(LEGACY_DB_PATH, path);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(LEGACY_DB_PATH + suffix)) renameSync(LEGACY_DB_PATH + suffix, path + suffix);
    }
    console.log(`[loadbearing] carried your history over from ${LEGACY_DB_PATH}`);
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const DatabaseSync = DatabaseSyncClass();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
