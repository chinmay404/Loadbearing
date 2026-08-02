import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { Markdown } from '../ui/Markdown';

/**
 * The System Design Primer, in here rather than in another tab.
 *
 * It is one very long document, which is a fine thing to read through once and a
 * poor thing to consult. What you want mid-design is the two paragraphs about
 * write-through caching, and getting them should not involve leaving the drawing,
 * finding a bookmark, and scrolling past forty headings.
 *
 * Search returns passages rather than sections for the same reason: "Database" is
 * eight thousand characters covering replication, federation, sharding and
 * denormalisation, and being told the answer is somewhere inside it is barely better
 * than not asking.
 *
 * Somebody else's writing, under a licence that says to share it. The attribution is
 * not a footnote here; it is at the top, where a reader sees whose work this is.
 */
export function PrimerTab() {
  const setError = useApp((s) => s.setError);
  const [index, setIndex] = useState<Awaited<ReturnType<typeof api.primer>> | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Awaited<ReturnType<typeof api.primerSearch>>['hits'] | null>(null);
  const [open, setOpen] = useState<{ title: string; markdown: string; heading: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(0);

  useEffect(() => {
    void api
      .primer()
      .then(setIndex)
      .catch((e) => setError({ message: (e as ApiError).message }));
  }, [setError]);

  // Searching 110KB server-side is instant, but a request per keystroke is still
  // rude to a server that is also serving the canvas.
  useEffect(() => {
    window.clearTimeout(debounce.current);
    if (query.trim() === '') {
      setHits(null);
      return;
    }
    debounce.current = window.setTimeout(() => {
      void api
        .primerSearch(query)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(debounce.current);
  }, [query]);

  const openSection = async (slug: string, heading?: string) => {
    try {
      setLoading(true);
      const section = await api.primerSection(slug);
      setOpen({ title: section.title, markdown: section.markdown, heading: heading ?? '' });
    } catch (e) {
      setError({ message: (e as ApiError).message });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Land on the passage that matched, not at the top of eight thousand characters.
   *
   * In an effect rather than a requestAnimationFrame callback: the DOM is there by
   * the time an effect runs, and a frame is not guaranteed to arrive at all — a tab
   * that is not being displayed never composites, so rAF never fires and the scroll
   * silently does not happen.
   */
  useEffect(() => {
    if (!open) return;
    const target = open.heading ? findHeading(open.heading) : null;
    (target ?? document.querySelector('.primer-read'))?.scrollIntoView({ block: 'start' });
  }, [open]);

  const attribution = index?.attribution;

  const sections = useMemo(() => index?.sections ?? [], [index]);

  if (open) {
    return (
      <div className="primer-read">
        <div className="row" style={{ marginBottom: 8 }}>
          <button onClick={() => setOpen(null)}>← All sections</button>
          <span className="grow" />
          {attribution && (
            <a className="faint" href={attribution.url} target="_blank" rel="noreferrer noopener">
              source
            </a>
          )}
        </div>
        <h2 style={{ marginTop: 0 }}>{open.title}</h2>
        <Markdown source={open.markdown} className="primer-body" />
      </div>
    );
  }

  return (
    <>
      {attribution && (
        <div className="card primer-credit">
          <strong>{attribution.title}</strong> by {attribution.author}, licensed{' '}
          <a href={attribution.licenceUrl} target="_blank" rel="noreferrer noopener">
            {attribution.licence}
          </a>
          . Vendored from{' '}
          <a href={attribution.url} target="_blank" rel="noreferrer noopener">
            the original
          </a>{' '}
          so it works offline.
          <details className="disclose" style={{ marginTop: 6 }}>
            <summary>What was changed</summary>
            <ul className="list-reset muted" style={{ fontSize: 12 }}>
              {attribution.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <input
        className="lib-search"
        value={query}
        placeholder="Search the primer — write-through cache, federation, eventual consistency…"
        onChange={(e) => setQuery(e.target.value)}
      />

      {hits !== null ? (
        <>
          {hits.length === 0 && <p className="faint">Nothing in the primer matches that.</p>}
          {hits.map((hit, i) => (
            <button
              className="card primer-hit"
              key={`${hit.slug}-${i}`}
              onClick={() => void openSection(hit.slug, hit.heading)}
            >
              <div className="row">
                <h4 className="grow">
                  {hit.title}
                  {hit.heading && <span className="faint"> › {hit.heading}</span>}
                </h4>
              </div>
              {hit.lines.map((line, j) => (
                <p className="muted primer-line" key={j}>
                  {highlight(line, query)}
                </p>
              ))}
            </button>
          ))}
        </>
      ) : (
        <div className="index-grid">
          {sections.map((s) => (
            <button className="plate" key={s.slug} onClick={() => void openSection(s.slug)} disabled={loading}>
              <div className="t">{s.title}</div>
              <div className="m">{s.summary}</div>
              {s.subheadings.length > 0 && (
                <div className="row wrap" style={{ gap: 3, marginTop: 7 }}>
                  {s.subheadings.slice(0, 6).map((h) => (
                    <span className="chip" key={h}>
                      {h}
                    </span>
                  ))}
                  {s.subheadings.length > 6 && (
                    <span className="chip faint">+{s.subheadings.length - 6}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Mark the query terms in a result line.
 *
 * Plain text split around matches, not innerHTML: this is a search box, so the terms
 * are whatever somebody typed, and the one thing that must never happen is that
 * typing markup into a search field puts markup on the page.
 */
function highlight(line: string, query: string): React.ReactNode {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return line;
  const pattern = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'ig');
  return line.split(pattern).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i}>{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The rendered heading matching a search hit's subsection.
 *
 * Matched on text rather than an id, because the markdown renderer does not mint
 * ids and inventing a slugging scheme on both sides is two places to disagree.
 */
function findHeading(heading: string): Element | null {
  const wanted = heading.trim().toLowerCase();
  for (const el of document.querySelectorAll('.primer-body h3, .primer-body h4, .primer-body h5, .primer-body h6')) {
    if ((el.textContent ?? '').trim().toLowerCase() === wanted) return el;
  }
  return null;
}
