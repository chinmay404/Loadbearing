import { Hono } from 'hono';
import { CONCEPT_CARDS } from '@loadbearing/shared';
import type { MasteryEntry, Stats } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

export const masteryRoutes = new Hono<AppEnv>();

masteryRoutes.get('/mastery', requireUser, async (c) => {
  const rows = await (await storage()).listMastery(c.get('userId'));
  const byId = new Map(rows.map((r) => [r.concept, r]));
  const entries: MasteryEntry[] = CONCEPT_CARDS.map((card) => {
    const row = byId.get(card.id);
    return {
      concept: card.id,
      name: card.name,
      group: card.group,
      ema: row ? row.emaScore : null,
      attempts: row ? row.attempts : 0,
      lastSeen: row?.lastSeen ?? null,
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

masteryRoutes.get('/review-queue', requireUser, async (c) => {
  const rows = await (await storage()).reviewQueue(c.get('userId'));
  const cardById = new Map(CONCEPT_CARDS.map((card) => [card.id, card]));
  const due = rows
    .filter((r) => cardById.has(r.concept))
    .map((r) => {
      const interval = REVIEW_INTERVAL_DAYS(r.emaScore);
      return {
        concept: r.concept,
        name: cardById.get(r.concept)!.name,
        group: cardById.get(r.concept)!.group,
        ema: r.emaScore,
        overdueDays: Math.floor(r.daysSince - interval),
        intervalDays: interval,
      };
    })
    .filter((r) => r.overdueDays >= 0)
    .sort((a, b) => a.ema - b.ema || b.overdueDays - a.overdueDays)
    .slice(0, 8);

  return c.json({ due, drillConcepts: due.slice(0, 3).map((d) => d.concept) });
});

masteryRoutes.get('/stats', requireUser, async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  const [agg, trendRows, days] = await Promise.all([
    store.statsAgg(userId),
    store.statsTrend(userId, 40),
    store.statsDays(userId),
  ]);

  const stats: Stats = {
    attempts: agg.attempts,
    avgOverall: agg.avgOverall === null ? null : Math.round(agg.avgOverall),
    streakDays: computeStreak(days),
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
