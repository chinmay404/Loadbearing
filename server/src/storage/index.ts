// Picks a backend once and hands the same instance to every route.
//
// The choice is made by one environment variable: `DATABASE_URL` present means
// Postgres, absent means the local SQLite file. Nothing else in the server knows
// or cares which one it got.

import type { Storage } from './types.js';

export type { Storage } from './types.js';

let instance: Storage | null = null;
let ready: Promise<Storage> | null = null;

/**
 * Imported lazily, not because of load time but because each backend has a hard
 * requirement the other host cannot meet: SQLite needs `node:sqlite` (absent from
 * some Node builds) and Postgres needs a reachable database. Only the one that
 * was actually chosen gets loaded, so the other's requirement never applies.
 */
export async function createStorage(): Promise<Storage> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { PostgresStorage } = await import('./postgres.js');
    return new PostgresStorage(url);
  }
  const { SqliteStorage } = await import('./sqlite.js');
  return new SqliteStorage(process.env.LOADBEARING_DB ?? undefined);
}

/**
 * The initialised storage. Every caller awaits this rather than a module-level
 * side effect, because on serverless the first request is what wakes the process
 * up and there is nowhere earlier to run migrations.
 */
export function storage(): Promise<Storage> {
  if (!ready) {
    ready = createStorage()
      .then(async (store) => {
        await store.init();
        instance = store;
        console.log(`[loadbearing] storage: ${store.kind}`);
        return store;
      })
      .catch((err) => {
        // A failed init must not be cached as "ready" — the next request retries.
        ready = null;
        instance = null;
        throw err;
      });
  }
  return ready;
}

/** Test hook: swap in a storage instance that is already initialised. */
export function setStorageForTests(store: Storage | null): void {
  instance = store;
  ready = store ? Promise.resolve(store) : null;
}

/** Synchronous peek, for code paths that cannot await. Null before first use. */
export function storageIfReady(): Storage | null {
  return instance;
}
