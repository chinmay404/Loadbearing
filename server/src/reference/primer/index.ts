// The System Design Primer, split up and made searchable.
//
// It is one 110KB markdown document, which is a fine thing to read start to finish
// and a poor thing to consult. What you actually want, mid-design, is the two
// paragraphs about write-through caching — and finding those means scrolling past
// forty other headings, in a document that lives in another tab.
//
// So: split at the `##` boundaries the author already put there, index the words,
// and answer a query with the section plus the lines that matched. Parsed once at
// module load; the whole thing is smaller than a photograph.
//
// The System Design Primer by Donne Martin, CC BY 4.0.

import { PRIMER_MARKDOWN } from './text.js';

export const PRIMER_ATTRIBUTION = {
  title: 'The System Design Primer',
  author: 'Donne Martin',
  url: 'https://github.com/donnemartin/system-design-primer',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  /**
   * CC BY asks that changes be indicated. These are the ones made, and they are all
   * subtractive — nothing has been rewritten, only removed or re-anchored.
   */
  changes: [
    'Split into sections at its own headings, and served through a search rather than as one page.',
    'The translation banner, the Anki-deck and contributing sections, and the images hosted on the original repository are not shown.',
    'Links relative to the source repository are rewritten to absolute ones so they still resolve.',
  ],
};

export interface PrimerSection {
  slug: string;
  title: string;
  /** The `###` headings inside it, so a long section can be skimmed before opening. */
  subheadings: string[];
  /** First real sentence or two — enough to know whether this is the right section. */
  summary: string;
  markdown: string;
}

/**
 * A searchable unit: a `###` block, or the whole `##` section when it has none.
 *
 * Searching at section granularity was the obvious thing and it was not good enough.
 * "Database" is eight thousand characters covering replication, federation, sharding,
 * denormalisation and SQL tuning; being told the answer is somewhere in it is barely
 * better than being handed the document. The author already subdivided the long
 * sections, so those subdivisions are what gets indexed.
 */
interface Passage {
  /** The `##` section it belongs to, which is what gets opened. */
  slug: string;
  sectionTitle: string;
  /** The `###` heading, when there is one. */
  heading: string;
  text: string;
}

export interface PrimerHit {
  slug: string;
  title: string;
  /** The subsection the match is in, so a long section says where to look. */
  heading: string;
  /** Lines that matched, best first, with the query terms left as written. */
  lines: string[];
  score: number;
}

/**
 * Sections that are about the document rather than about system design. Kept out of
 * the index because "contributing" and "buy the Anki deck" are never the answer to a
 * question someone has while drawing.
 */
const SKIP = new Set([
  'anki-flashcards',
  'contributing',
  'index-of-system-design-topics',
  'study-guide',
  'credits',
  'contact-info',
  'license',
  'under-development',
]);

const REPO = 'https://github.com/donnemartin/system-design-primer/blob/master/';

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Rewrite what only made sense inside the original repository.
 *
 * Images live in that repo and are not vendored, so they go rather than render as
 * broken. Relative links would resolve against this app and 404, so they are made
 * absolute — a link to the source is more useful than a dead one anyway.
 */
function clean(markdown: string): string {
  return markdown
    .replace(/^\s*<p align="center">[\s\S]*?<\/p>\s*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/g, '')
    .replace(/\]\((?!https?:|#)([^)]+)\)/g, `](${REPO}$1)`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parse(): PrimerSection[] {
  const lines = PRIMER_MARKDOWN.split('\n');
  const sections: PrimerSection[] = [];
  let title: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (title === null) return;
    const slug = slugify(title);
    const markdown = clean(buffer.join('\n'));
    if (!SKIP.has(slug) && markdown.length > 120) {
      sections.push({
        slug,
        title,
        subheadings: buffer
          .filter((l) => l.startsWith('### '))
          .map((l) => l.slice(4).trim()),
        summary: summarise(markdown),
        markdown,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      title = line.slice(3).trim();
      continue;
    }
    if (title !== null) buffer.push(line);
  }
  flush();
  return sections;
}

/** The first line that is prose rather than a heading, a link, or a blockquote. */
function summarise(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#') || text.startsWith('>') || text.startsWith('<')) continue;
    if (text.startsWith('*') || text.startsWith('-') || text.startsWith('[')) continue;
    // A table row is not a summary. Two of the interview-question sections open
    // with one, and "| Question | |" tells a reader nothing at all.
    if (text.startsWith('|')) continue;
    const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
    return plain.length > 220 ? `${plain.slice(0, 219)}…` : plain;
  }
  return '';
}

export const PRIMER_SECTIONS: PrimerSection[] = parse();

const BY_SLUG = new Map(PRIMER_SECTIONS.map((s) => [s.slug, s]));

/** Every section cut at its `###` headings, which is what search actually reads. */
const PASSAGES: Passage[] = PRIMER_SECTIONS.flatMap((section) => {
  const chunks: Passage[] = [];
  let heading = '';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 40) {
      chunks.push({ slug: section.slug, sectionTitle: section.title, heading, text });
    }
    buffer = [];
  };
  // Three hashes and four: the primer nests one deeper under Database, where
  // federation, sharding and denormalisation each get a `####`. Cutting only at
  // `###` left all of them inside one passage called "Relational database
  // management system", which is the least useful place to be sent.
  for (const line of section.markdown.split('\n')) {
    const cut = /^(#{3,4})\s+(.*)$/.exec(line);
    if (cut) {
      flush();
      heading = cut[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  // A section with no subheadings and nothing but a table is still worth finding.
  return chunks.length > 0
    ? chunks
    : [{ slug: section.slug, sectionTitle: section.title, heading: '', text: section.markdown }];
});

export const primerSection = (slug: string): PrimerSection | undefined => BY_SLUG.get(slug);

/**
 * Find the passages that mention what you asked about.
 *
 * Every term has to appear, and the answer is the lines carrying them rather than
 * the whole section — the point is to read two paragraphs, not to be handed a
 * chapter and told it is in there somewhere. A hit in a heading counts for more than
 * one in the body, because a heading match usually means the section is *about* the
 * thing rather than mentioning it in passing.
 */
export function searchPrimer(query: string, limit = 12): PrimerHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: PrimerHit[] = [];
  for (const passage of PASSAGES) {
    const heading = `${passage.sectionTitle} ${passage.heading}`.toLowerCase();
    const haystack = `${heading}\n${passage.text}`.toLowerCase();
    if (!terms.every((t) => haystack.includes(t))) continue;

    // Lines carrying more of the query come first, so "write-through cache" leads
    // with the write-through sentence rather than the first line that says "cache".
    const scored: { line: string; matched: number }[] = [];
    let body = 0;
    for (const raw of passage.text.split('\n')) {
      const line = raw.trim();
      if (line.length < 3) continue;
      const lower = line.toLowerCase();
      const matched = terms.filter((t) => lower.includes(t)).length;
      if (matched === 0) continue;
      body += matched;
      scored.push({ line: line.replace(/^#+\s*/, ''), matched });
    }
    scored.sort((a, b) => b.matched - a.matched);

    hits.push({
      slug: passage.slug,
      title: passage.sectionTitle,
      heading: passage.heading,
      lines: scored.slice(0, 4).map((s) => s.line),
      // A heading match usually means the passage is ABOUT the thing rather than
      // mentioning it, and every term in one heading is the strongest signal there is.
      score:
        terms.filter((t) => heading.includes(t)).length * 100 +
        (terms.every((t) => heading.includes(t)) ? 200 : 0) +
        body,
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Which primer section belongs beside which of our concept cards.
 *
 * Hand-written rather than matched by name, because the names do not line up: our
 * `spof` is the primer's availability patterns, our `capacity-estimation` is a
 * corner of its appendix. A wrong link here is worse than none — it teaches that
 * the cross-reference cannot be trusted — so only the ones that genuinely
 * correspond are listed.
 */
export const CONCEPT_TO_PRIMER: Record<string, string> = {
  caching: 'cache',
  cdn: 'content-delivery-network',
  'load-balancing': 'load-balancer',
  'dns-routing': 'domain-name-system',
  sharding: 'database',
  replication: 'database',
  'consistency-models': 'consistency-patterns',
  'cap-tradeoff': 'availability-vs-consistency',
  spof: 'availability-patterns',
  'queue-backpressure': 'asynchronism',
  fanout: 'asynchronism',
  'capacity-estimation': 'appendix',
  observability: 'application-layer',
  'authn-authz': 'security',
  encryption: 'security',
  'schema-design': 'database',
  'search-indexing': 'database',
  'rate-limiting': 'application-layer',
  'timeout-retry': 'communication',
  'circuit-breaker': 'communication',
  'multi-region': 'domain-name-system',
};
