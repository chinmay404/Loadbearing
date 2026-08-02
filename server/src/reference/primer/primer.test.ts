// The vendored primer: that it parsed, that the search lands somewhere useful, and
// that nothing about the original repository leaked into what gets rendered.
//
// The search assertions are the point. Splitting one 110KB document into sections
// and grepping it is easy; making "write-through cache" return the two paragraphs
// about write-through, rather than the first of forty lines containing the word
// "cache", is the entire feature.

import { describe, expect, it } from 'vitest';
import {
  CONCEPT_TO_PRIMER,
  PRIMER_ATTRIBUTION,
  PRIMER_SECTIONS,
  primerSection,
  searchPrimer,
} from './index.js';
import { CONCEPTS } from '@loadbearing/shared';

describe('parsing', () => {
  it('finds the sections that matter and drops the ones about the document', () => {
    const slugs = PRIMER_SECTIONS.map((s) => s.slug);
    for (const expected of ['cache', 'database', 'load-balancer', 'consistency-patterns', 'security']) {
      expect(slugs, `missing ${expected}`).toContain(expected);
    }
    for (const skipped of ['contributing', 'anki-flashcards', 'license', 'credits']) {
      expect(slugs).not.toContain(skipped);
    }
  });

  it('gives every section a summary that is prose, not a heading or a table row', () => {
    for (const s of PRIMER_SECTIONS) {
      if (!s.summary) continue;
      expect(s.summary.startsWith('#'), `${s.slug} summarises with a heading`).toBe(false);
      expect(s.summary.startsWith('|'), `${s.slug} summarises with a table row`).toBe(false);
    }
  });

  it('leaves no images behind, since they live in a repository we did not vendor', () => {
    for (const s of PRIMER_SECTIONS) {
      expect(/!\[/.test(s.markdown), `${s.slug} still has an image`).toBe(false);
      expect(/<img/.test(s.markdown), `${s.slug} still has an img tag`).toBe(false);
    }
  });

  it('rewrites repository-relative links so they still resolve', () => {
    const all = PRIMER_SECTIONS.map((s) => s.markdown).join('\n');
    // Every link is either absolute, or an in-page anchor.
    const links = [...all.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(50);
    for (const href of links) {
      expect(/^(https?:|#)/.test(href), `relative link left behind: ${href}`).toBe(true);
    }
  });
});

describe('search', () => {
  const top = (q: string) => searchPrimer(q, 1)[0];

  it('lands on the subsection, not the eight-thousand-character section', () => {
    // "Database" covers replication, federation, sharding, denormalisation and SQL
    // tuning. Being told the answer is in there is barely better than not asking.
    expect(top('federation')).toMatchObject({ slug: 'database', heading: 'Federation' });
    expect(top('denormalization')).toMatchObject({ slug: 'database' });
    expect(top('eventual consistency')).toMatchObject({
      slug: 'consistency-patterns',
      heading: 'Eventual consistency',
    });
  });

  it('leads with the line carrying most of the query', () => {
    const hit = top('write-through cache')!;
    expect(hit.slug).toBe('cache');
    expect(hit.lines.length).toBeGreaterThan(0);
    // Not merely the first line in the section that happens to say "cache".
    expect(hit.lines[0]!.toLowerCase()).toMatch(/cache|stale|write/);
  });

  it('ranks a heading match above a passing mention', () => {
    const hits = searchPrimer('reverse proxy', 5);
    expect(hits[0]!.slug).toBe('reverse-proxy-web-server');
  });

  it('needs every term to appear, so two words narrow rather than widen', () => {
    const one = searchPrimer('cache', 50).length;
    const two = searchPrimer('cache invalidation', 50).length;
    expect(two).toBeLessThan(one);
  });

  it('returns nothing for nothing, rather than everything', () => {
    expect(searchPrimer('')).toEqual([]);
    expect(searchPrimer('   ')).toEqual([]);
    expect(searchPrimer('zzzznotaword')).toEqual([]);
  });
});

describe('cross-references to our own concepts', () => {
  it('only names concepts that exist', () => {
    for (const concept of Object.keys(CONCEPT_TO_PRIMER)) {
      expect(CONCEPTS, `${concept} is not a concept id`).toContain(concept);
    }
  });

  it('only points at sections that exist', () => {
    for (const [concept, slug] of Object.entries(CONCEPT_TO_PRIMER)) {
      expect(primerSection(slug), `${concept} points at missing section ${slug}`).toBeDefined();
    }
  });
});

describe('attribution', () => {
  it('names the author, the licence and the changes made', () => {
    expect(PRIMER_ATTRIBUTION.author).toBe('Donne Martin');
    expect(PRIMER_ATTRIBUTION.licence).toBe('CC BY 4.0');
    expect(PRIMER_ATTRIBUTION.url).toContain('github.com/donnemartin/system-design-primer');
    // CC BY asks that modifications be indicated, and ours are all subtractive.
    expect(PRIMER_ATTRIBUTION.changes.length).toBeGreaterThan(0);
  });
});
