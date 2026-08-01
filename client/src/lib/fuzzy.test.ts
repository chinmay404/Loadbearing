// What separates a usable palette from an irritating one is the order of the results,
// so these are mostly about ranking rather than about matching.

import { describe, expect, it } from 'vitest';
import { rank, score } from './fuzzy';

const best = (query: string, options: string[]): string | undefined =>
  rank(query, options, (s) => s)[0]?.item;

const order = (query: string, options: string[]): string[] =>
  rank(query, options, (s) => s).map((r) => r.item);

describe('matching', () => {
  it('matches a subsequence, not just a substring', () => {
    expect(score('vecdb', 'Vector Database')).not.toBeNull();
    expect(score('adlb', 'Add Load Balancer')).not.toBeNull();
  });

  it('refuses when a character is missing', () => {
    expect(score('zebra', 'Vector Database')).toBeNull();
  });

  it('refuses when the characters are in the wrong order', () => {
    expect(score('bdvec', 'Vector Database')).toBeNull();
  });

  it('ignores case and spaces in the query', () => {
    expect(score('LOAD bal', 'Load Balancer')).not.toBeNull();
  });

  it('treats an empty query as matching everything, unranked', () => {
    expect(score('', 'anything')).toEqual({ score: 0, hits: [] });
  });

  it('reports where it matched, for highlighting', () => {
    expect(score('cac', 'Cache')?.hits).toEqual([0, 1, 2]);
  });
});

describe('ranking', () => {
  it('prefers a match at the start of a word over one buried mid-word', () => {
    expect(best('gate', ['Investigate Later', 'Gateway'])).toBe('Gateway');
  });

  it('prefers consecutive characters over scattered ones', () => {
    expect(best('cache', ['Cache', 'Custom Agent Cost Handling Estimate'])).toBe('Cache');
  });

  it('prefers the shorter of two otherwise equal matches', () => {
    expect(best('cache', ['Cache', 'Cache Aside Read Path'])).toBe('Cache');
  });

  it('finds initials, which is how people type into a palette', () => {
    expect(best('lb', ['Ledger Database', 'Load Balancer'])).toBe('Load Balancer');
  });

  it('puts an exact prefix first', () => {
    expect(order('quo', ['Queue', 'Quota Guard', 'Query Router'])[0]).toBe('Quota Guard');
  });

  it('keeps the given order when scores tie, so results do not reshuffle', () => {
    const options = ['Alpha Thing', 'Alpha Thing'];
    expect(order('alpha', options)).toEqual(options);
  });

  it('drops everything that does not match', () => {
    expect(order('xyz', ['Cache', 'Queue', 'Load Balancer'])).toEqual([]);
  });

  it('returns everything for an empty query, in the given order', () => {
    const options = ['One', 'Two', 'Three'];
    expect(order('', options)).toEqual(options);
  });
});
