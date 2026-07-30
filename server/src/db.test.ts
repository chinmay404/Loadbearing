import { describe, expect, it } from 'vitest';
import { getDb, getSetting, setSetting, upsertMastery } from './db.js';

describe('db', () => {
  it('creates all tables', () => {
    const db = getDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['attempts', 'mastery', 'problems_custom', 'settings']));
  });

  it('upsertMastery: first sample sets ema, later samples use ema = 0.7*old + 0.3*new', () => {
    const db = getDb(':memory:');
    upsertMastery(db, 'idempotency', 0.5);
    let row = db.prepare(`SELECT * FROM mastery WHERE concept='idempotency'`).get() as any;
    expect(row.ema_score).toBeCloseTo(0.5, 5);
    expect(row.attempts).toBe(1);

    upsertMastery(db, 'idempotency', 1.0);
    row = db.prepare(`SELECT * FROM mastery WHERE concept='idempotency'`).get() as any;
    expect(row.ema_score).toBeCloseTo(0.65, 5);
    expect(row.attempts).toBe(2);
  });

  it('settings roundtrip', () => {
    const db = getDb(':memory:');
    expect(getSetting(db, 'model')).toBeNull();
    setSetting(db, 'model', 'claude-sonnet-5');
    expect(getSetting(db, 'model')).toBe('claude-sonnet-5');
    setSetting(db, 'model', 'llama-3.3-70b');
    expect(getSetting(db, 'model')).toBe('llama-3.3-70b');
  });
});
