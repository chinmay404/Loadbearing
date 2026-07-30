import { Hono } from 'hono';
import { CONCEPT_CARDS } from '@loadbearing/shared';
import type { MasteryEntry, Stats } from '@loadbearing/shared';
import { db } from '../db.js';

export const masteryRoutes = new Hono();

masteryRoutes.get('/mastery', (c) => {
  const rows = db().prepare('SELECT concept, ema_score, attempts, last_seen FROM mastery').all() as {
    concept: string;
    ema_score: number;
    attempts: number;
    last_seen: string | null;
  }[];
  const byId = new Map(rows.map((r) => [r.concept, r]));
  const entries: MasteryEntry[] = CONCEPT_CARDS.map((card) => {
    const row = byId.get(card.id);
    return {
      concept: card.id,
      name: card.name,
      group: card.group,
      ema: row ? row.ema_score : null,
      attempts: row ? row.attempts : 0,
      lastSeen: row?.last_seen ?? null,
    };
  });
  return c.json(entries);
});

masteryRoutes.get('/stats', (c) => {
  const agg = db().prepare('SELECT COUNT(*) AS n, AVG(overall) AS avg FROM attempts').get() as {
    n: number;
    avg: number | null;
  };
  const trendRows = db()
    .prepare(
      `SELECT date(created_at) AS date, overall FROM attempts ORDER BY id DESC LIMIT 40`,
    )
    .all() as { date: string; overall: number }[];

  const days = db()
    .prepare(`SELECT DISTINCT date(created_at) AS d FROM attempts ORDER BY d DESC`)
    .all() as { d: string }[];

  const stats: Stats = {
    attempts: agg.n,
    avgOverall: agg.avg === null ? null : Math.round(agg.avg),
    streakDays: computeStreak(days.map((r) => r.d)),
    trend: trendRows.reverse(),
  };
  return c.json(stats);
});

/** Consecutive days ending today or yesterday that have at least one attempt. */
function computeStreak(datesDesc: string[]): number {
  if (datesDesc.length === 0) return 0;
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const set = new Set(datesDesc);
  const cursor = new Date(today);
  if (!set.has(iso(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!set.has(iso(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(iso(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
