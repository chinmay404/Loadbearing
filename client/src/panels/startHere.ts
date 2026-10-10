import type { ProblemSummary } from '@loadbearing/shared';

/** The ladder, easiest topic first. A topic not listed sorts after these, by name. */
export const TOPIC_ORDER = ['photo-upload', 'ai-chat', 'product-page', 'stay-up', 'background-work', 'short-links'];

const TOPIC_TITLE: Record<string, string> = {
  'photo-upload': 'Photo upload',
  'ai-chat': 'AI chat',
  'product-page': 'Product page',
  'stay-up': "Don't fall over",
  'background-work': "Don't make users wait",
  'short-links': 'Short links',
};

export interface StartRow {
  topic: string;
  title: string;
  basics?: ProblemSummary;
  stepUp?: ProblemSummary;
  /** The full problem the Step up hands on to. */
  next?: ProblemSummary;
}

/** The "Start here" ladder: one row per topic, Basics then Step up, then where it leads. */
export function startHereRows(problems: ProblemSummary[]): StartRow[] {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const rows = new Map<string, StartRow>();
  for (const p of problems) {
    if (!p.track) continue;
    const row = rows.get(p.track.topic) ?? { topic: p.track.topic, title: TOPIC_TITLE[p.track.topic] ?? p.track.topic };
    if (p.track.stage === 'basics') row.basics = p;
    else {
      row.stepUp = p;
      if (p.track.next) row.next = byId.get(p.track.next);
    }
    rows.set(p.track.topic, row);
  }
  const rank = (t: string) => (TOPIC_ORDER.includes(t) ? TOPIC_ORDER.indexOf(t) : TOPIC_ORDER.length);
  return [...rows.values()].sort((a, b) => rank(a.topic) - rank(b.topic) || a.topic.localeCompare(b.topic));
}
