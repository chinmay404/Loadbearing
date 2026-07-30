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

/**
 * Spaced repetition, sized for this app: the stronger a concept, the longer it
 * can rest before it should be exercised again. A concept is due when its last
 * assessment is older than its interval; the weakest and most overdue first.
 */
const REVIEW_INTERVAL_DAYS = (ema: number): number => {
  if (ema >= 0.8) return 14;
  if (ema >= 0.6) return 7;
  if (ema >= 0.4) return 3;
  return 1;
};

masteryRoutes.get('/review-queue', (c) => {
  const rows = db()
    .prepare(
      `SELECT concept, ema_score, attempts, last_seen,
              julianday('now') - julianday(last_seen) AS days_since
       FROM mastery WHERE last_seen IS NOT NULL`,
    )
    .all() as { concept: string; ema_score: number; attempts: number; days_since: number }[];

  const cardById = new Map(CONCEPT_CARDS.map((card) => [card.id, card]));
  const due = rows
    .filter((r) => cardById.has(r.concept))
    .map((r) => {
      const interval = REVIEW_INTERVAL_DAYS(r.ema_score);
      return {
        concept: r.concept,
        name: cardById.get(r.concept)!.name,
        group: cardById.get(r.concept)!.group,
        ema: r.ema_score,
        overdueDays: Math.floor(r.days_since - interval),
        intervalDays: interval,
      };
    })
    .filter((r) => r.overdueDays >= 0)
    .sort((a, b) => a.ema - b.ema || b.overdueDays - a.overdueDays)
    .slice(0, 8);

  return c.json({ due, drillConcepts: due.slice(0, 3).map((d) => d.concept) });
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
