/**
 * Ranking for the command palette.
 *
 * Subsequence matching rather than substring, so "vecdb" finds "Vector Database" and
 * "adlb" finds "Add Load Balancer" — the way anyone actually types into a palette. What
 * separates a good palette from an irritating one is the ORDER, so the score is mostly
 * about where the match landed: a hit at the start of a word beats one buried in the
 * middle, and consecutive characters beat scattered ones.
 */

export interface Ranked<T> {
  item: T;
  score: number;
  /** Indices in the haystack that matched, for highlighting. */
  hits: number[];
}

const START_OF_WORD = 18;
const CONSECUTIVE = 8;
const FIRST_CHARACTER = 12;
/** Every character skipped between hits costs a little, so tight matches win. */
const GAP_PENALTY = 1;

/**
 * Score one candidate, or null when the query is not a subsequence of it at all.
 * Case-insensitive; the caller keeps the original text for display.
 */
export function score(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.trim().toLowerCase();
  if (q === '') return { score: 0, hits: [] };
  const t = text.toLowerCase();

  let total = 0;
  let at = 0;
  let previous = -1;
  const hits: number[] = [];

  for (const character of q) {
    if (character === ' ') continue;
    const found = t.indexOf(character, at);
    if (found === -1) return null;

    let points = 1;
    if (found === 0) points += FIRST_CHARACTER;
    else if (!/[a-z0-9]/.test(t[found - 1]!)) points += START_OF_WORD;
    if (found === previous + 1) points += CONSECUTIVE;
    points -= Math.min(6, Math.max(0, found - previous - 1)) * GAP_PENALTY;

    total += points;
    hits.push(found);
    previous = found;
    at = found + 1;
  }

  // Typing the thing's actual name beats an accidental initialism. Without this,
  // "cache" scored higher against "Custom Agent Cost Handling Estimate" — five
  // word-start hits — than against "Cache", because word starts are worth a lot and
  // there were five of them. A contiguous hit is what someone almost always means.
  const contiguous = t.indexOf(q.replace(/\s+/g, ''));
  if (contiguous !== -1) {
    total += 60;
    if (contiguous === 0) total += 25;
    else if (!/[a-z0-9]/.test(t[contiguous - 1]!)) total += 15;
  }

  // A short candidate that matched is usually the one meant: "Cache" over
  // "Cache-Aside Read Path" for the query "cache".
  total += Math.max(0, 20 - text.length) / 4;
  return { score: total, hits };
}

/**
 * Rank a list, best first. Ties break on the supplied order rather than arbitrarily, so
 * a palette does not reshuffle itself between identical queries.
 */
export function rank<T>(query: string, items: T[], textOf: (item: T) => string): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  items.forEach((item, index) => {
    const hit = score(query, textOf(item));
    if (!hit) return;
    // The index tiebreak is a fraction so it can never outweigh a real difference.
    out.push({ item, score: hit.score - index / 10_000, hits: hit.hits });
  });
  return out.sort((a, b) => b.score - a.score);
}
