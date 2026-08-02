import { useEffect, useMemo, useState } from 'react';
import type { LibraryNote, NoteLocationKind } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { Markdown } from '../ui/Markdown';
import { rank } from '../lib/fuzzy';

/**
 * Everything you have written, in one place.
 *
 * Notes are written where the thinking happened — on the sheet, on the view, on the
 * project — which is right, and which is also why they become unfindable. The
 * capacity arithmetic you did for the URL shortener is the arithmetic you want three
 * weeks later on a different sheet, and you will not remember which sheet it was on.
 *
 * So this is not a second place to write notes. It is one place to read all of them,
 * with a search over titles and bodies, and a way back to where each one lives.
 */
export function NoteLibrary() {
  const setError = useApp((s) => s.setError);
  const openProblem = useApp((s) => s.openProblem);
  const openProject = useApp((s) => s.openProject);
  const openCanvas = useApp((s) => s.openCanvas);
  const setLeftTab = useApp((s) => s.setLeftTab);

  const [notes, setNotes] = useState<LibraryNote[] | null>(null);
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<string | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .noteLibrary()
      .then((r) => live && setNotes(r.notes))
      .catch((e) => {
        if (!live) return;
        setNotes([]);
        setError({ message: (e as ApiError).message });
      });
    return () => {
      live = false;
    };
  }, [setError]);

  // A note with no title is still findable by what is in it, so both are searched.
  // An empty query keeps the server's order, which is recency — the note you were
  // last writing is the one you are most likely coming back for.
  //
  // Every term must actually APPEAR, and only then does the fuzzy matcher order what
  // survived. The palette can rank on a scattered subsequence because it searches
  // component names a few words long; a note body is thousands of characters, and
  // over that length the letters of "postgres" occur in order inside almost any
  // English text. Searching for it returned three notes, two of which had never
  // mentioned Postgres. Presence to filter, fuzziness only to sort.
  const shown = useMemo(() => {
    const all = notes ?? [];
    const inPlace = place === 'all' ? all : all.filter((n) => n.scopeId === place);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return inPlace;
    const haystack = (n: LibraryNote) => `${n.title} ${n.body} ${n.where.label}`;
    const present = inPlace.filter((n) => {
      const text = haystack(n).toLowerCase();
      return terms.every((t) => text.includes(t));
    });
    return rank(query, present, haystack).map((r) => r.item);
  }, [notes, query, place]);

  // Places are listed by how much is written in them, so the sheet you think in
  // most is the first one offered.
  const places = useMemo(() => {
    const counts = new Map<string, { label: string; kind: NoteLocationKind; count: number }>();
    for (const n of notes ?? []) {
      const existing = counts.get(n.scopeId);
      if (existing) existing.count += 1;
      else counts.set(n.scopeId, { label: n.where.label, kind: n.where.kind, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [notes]);

  const goTo = async (note: LibraryNote) => {
    const { where } = note;
    try {
      setGoing(note.id);
      if (where.kind === 'problem' && where.problemId) {
        openProblem(await api.problem(where.problemId));
        setLeftTab('notes');
      } else if (where.kind === 'canvas' && where.projectId && where.canvasId) {
        openCanvas(where.projectId, where.canvasId);
        setLeftTab('notes');
      } else if (where.kind === 'project' && where.projectId) {
        openProject(where.projectId);
      }
    } catch (e) {
      setError({ message: (e as ApiError).message });
    } finally {
      setGoing(null);
    }
  };

  const total = notes?.length ?? 0;

  return (
    <div className="sheet">
      <h1>Note library</h1>
      <p className="lede">
        Every note you have written, wherever you wrote it. Searching covers titles and
        bodies both, because the thing you remember about a note is rarely its heading.
      </p>

      {notes !== null && total === 0 && (
        <div className="banner info">
          Nothing written yet. Notes live under the <span className="mono">Notes</span> tab on any
          sheet or project — they sit beside the drawing rather than on it, and nothing grades them.
        </div>
      )}

      {total > 0 && (
        <>
          <input
            className="lib-search"
            value={query}
            placeholder={`Search ${total} note${total === 1 ? '' : 's'}…`}
            onChange={(e) => setQuery(e.target.value)}
          />

          {places.length > 1 && (
            <div className="filter-row">
              <button className={place === 'all' ? 'on' : ''} onClick={() => setPlace('all')}>
                Everywhere
              </button>
              {places.map((p) => (
                <button
                  key={p.id}
                  className={place === p.id ? 'on' : ''}
                  onClick={() => setPlace(place === p.id ? 'all' : p.id)}
                  title={`${p.count} note${p.count === 1 ? '' : 's'} on ${p.label}`}
                >
                  {p.label} <span className="faint">{p.count}</span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 && <p className="faint">Nothing matches that.</p>}

          <div className="lib-list">
            {shown.map((note) => {
              const open = openId === note.id;
              return (
                <div className={`card lib-note${open ? ' open' : ''}`} key={note.id}>
                  <div className="row wrap">
                    <button
                      className="ghost grow lib-title"
                      onClick={() => setOpenId(open ? null : note.id)}
                      title={open ? 'Collapse' : 'Read it here'}
                    >
                      {note.title.trim() || <span className="faint">Untitled</span>}
                    </button>
                    <span className={`chip where ${note.where.kind}`}>
                      {note.where.kind === 'canvas' && note.where.projectName
                        ? `${note.where.projectName} · ${note.where.label}`
                        : note.where.label}
                    </span>
                    {note.where.kind !== 'unknown' && (
                      <button
                        disabled={going === note.id}
                        onClick={() => void goTo(note)}
                        title="Open the sheet this was written on, with its notes showing"
                      >
                        {going === note.id ? <span className="spinner" /> : null} Go there
                      </button>
                    )}
                  </div>
                  {open ? (
                    <div className="lib-body">
                      <Markdown source={note.body} />
                    </div>
                  ) : (
                    <p className="muted lib-peek">{peek(note.body)}</p>
                  )}
                  <span className="stencil">{when(note.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** The first line or so, with markdown syntax stripped: a peek, not a render. */
function peek(body: string): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return 'Empty.';
  return flat.length > 150 ? `${flat.slice(0, 149)}…` : flat;
}

/** Matches how the problem index says it, so the whole app dates things one way. */
function when(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
