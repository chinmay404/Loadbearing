import { useEffect, useRef, useState } from 'react';
import type { Note, NoteScope } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconPlus } from '../ui/UiIcons';

/**
 * As many written notes as you want, beside the drawing rather than on it.
 *
 * Deliberately separate from sticky notes: a sticky sits on the canvas, is part of
 * the design the grader reads, and belongs to one spot in the picture. These are
 * documents — the numbers you looked up, the decisions and why, what is still
 * open — and nothing scores them.
 *
 * The same panel serves both scopes. `sheet` is one drawing; `project` is the
 * system as a whole, for what outlives any single view.
 */
export function NotesPanel({
  scope,
  scopeId,
  blurb,
}: {
  scope: NoteScope;
  scopeId: string;
  blurb?: string;
}) {
  const setError = useApp((s) => s.setError);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(0);

  useEffect(() => {
    let live = true;
    setNotes(null);
    setOpenId(null);
    void api
      .notes(scope, scopeId)
      .then((r) => live && setNotes(r.notes))
      .catch((e) => {
        if (!live) return;
        setNotes([]);
        setError({ message: (e as ApiError).message });
      });
    return () => {
      live = false;
    };
  }, [scope, scopeId, setError]);

  // Edits are held locally and flushed on a timer, the same way the canvas saves:
  // typing must not wait for a round trip. Pending edits are collected per note
  // rather than in a single slot — one timer holding one patch loses the first
  // note's changes the moment a second one is touched.
  const pending = useRef(new Map<string, { title?: string; body?: string }>());

  const flush = () => {
    const waiting = [...pending.current.entries()];
    pending.current.clear();
    if (waiting.length === 0) return;
    setSaving(true);
    void Promise.all(waiting.map(([id, patch]) => api.updateNote(id, patch)))
      .catch((e) => setError({ message: (e as ApiError).message }))
      .finally(() => setSaving(false));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const edit = (id: string, patch: { title?: string; body?: string }) => {
    setNotes((current) => (current ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)));
    pending.current.set(id, { ...pending.current.get(id), ...patch });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flushRef.current(), 700);
  };

  // Leaving the panel — a rail tab, another sheet, signing out — must not discard
  // what was typed a moment ago, so the pending edits go out on the way out.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      flushRef.current();
    },
    [],
  );

  const add = () => {
    void api
      .createNote({ scope, scopeId, title: '', body: '' })
      .then((note) => {
        setNotes((current) => [note, ...(current ?? [])]);
        setOpenId(note.id);
      })
      .catch((e) => setError({ message: (e as ApiError).message }));
  };

  const remove = (id: string) => {
    setNotes((current) => (current ?? []).filter((n) => n.id !== id));
    setConfirmDelete(null);
    if (openId === id) setOpenId(null);
    void api.deleteNote(id).catch((e) => setError({ message: (e as ApiError).message }));
  };

  if (notes === null) return <p className="faint">Loading…</p>;

  return (
    <div className="col" style={{ gap: 6 }}>
      {blurb && (
        <p className="stencil" style={{ marginTop: 0 }}>
          {blurb}
        </p>
      )}

      <div className="row" style={{ alignItems: 'baseline' }}>
        <span className="section-label grow" style={{ margin: 0 }}>
          {notes.length === 0 ? 'No notes yet' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
        </span>
        {saving && <span className="stencil">saving…</span>}
        <button onClick={add} title="Add a note">
          <IconPlus size={14} /> Note
        </button>
      </div>

      {notes.length === 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Somewhere to keep the numbers you worked out, the decisions you made and why, and the
          questions still open. Not on the canvas, and not graded.
        </p>
      )}

      {notes.map((note) => {
        const open = openId === note.id;
        const firstLine = note.body.trim().split('\n')[0] ?? '';
        return (
          <div className="card" key={note.id} style={{ marginBottom: 0 }}>
            {open ? (
              <>
                <input
                  value={note.title}
                  placeholder="Title"
                  onChange={(e) => edit(note.id, { title: e.target.value })}
                  style={{ fontWeight: 600 }}
                />
                <textarea
                  rows={10}
                  value={note.body}
                  placeholder="Write it down here."
                  onChange={(e) => edit(note.id, { body: e.target.value })}
                  style={{ marginTop: 5 }}
                />
                <div className="row" style={{ gap: 4, marginTop: 5 }}>
                  <button className="ghost" onClick={() => setOpenId(null)}>
                    Done
                  </button>
                  <span className="grow" />
                  {confirmDelete === note.id ? (
                    <>
                      <button className="ghost" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                      <button onClick={() => remove(note.id)}>Delete for good</button>
                    </>
                  ) : (
                    <button className="ghost" onClick={() => setConfirmDelete(note.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                onClick={() => setOpenId(note.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, padding: 0 }}
                title="Open this note"
              >
                <strong style={{ fontSize: 12.5 }}>{note.title.trim() || 'Untitled note'}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}>
                  {firstLine ? firstLine.slice(0, 90) : 'empty'}
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
