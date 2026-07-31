import { useEffect, useMemo, useState } from 'react';
import { BLUEPRINTS, BLUEPRINT_FAMILIES } from '@loadbearing/shared';
import type { Blueprint, UserTemplate } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';
import { api, ApiError } from '../lib/api';
import { NODE_SPEC } from '../canvas/nodeCatalog';

/**
 * Prebuilt subsystems. Dropping one is a starting position, not an answer: every
 * node, number and connection is editable the moment it lands, and each card says
 * out loud which decisions it has NOT made for you.
 */
export function BlueprintPanel() {
  const insert = useCanvas((s) => s.insertBlueprint);
  const setNotice = useApp((s) => s.setNotice);
  const setLeftTab = useApp((s) => s.setLeftTab);
  const problem = useApp((s) => s.problem);
  const [family, setFamily] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);

  // A blueprint that exercises this sheet's rubric concepts is worth surfacing
  // first — but never hiding the rest, since the point is to be able to disagree.
  const ordered = useMemo(() => {
    const wanted = new Set(problem?.concepts ?? []);
    const relevance = (b: Blueprint) => b.concepts.filter((c) => wanted.has(c)).length;
    return [...BLUEPRINTS]
      .filter((b) => family === 'all' || b.family === family)
      .sort((a, b) => relevance(b) - relevance(a) || a.name.localeCompare(b.name));
  }, [family, problem]);

  const place = (b: Blueprint) => {
    const ids = insert(b);
    setNotice(
      `${b.name} placed — ${ids.length} components and ${b.flows.length} flow${
        b.flows.length === 1 ? '' : 's'
      }. Everything is editable; the card lists what it left for you to decide.`,
    );
    setLeftTab('inspect');
  };

  const wanted = new Set(problem?.concepts ?? []);

  return (
    <div>
      <MyTemplates />

      <span className="section-label">Built-in blueprints</span>
      <p className="stencil" style={{ marginTop: 0 }}>
        starting positions, not answers — drop one and take it apart
      </p>

      <div className="filter-row">
        <button className={family === 'all' ? 'on' : ''} onClick={() => setFamily('all')}>
          All
        </button>
        {BLUEPRINT_FAMILIES.map((f) => (
          <button key={f} className={family === f ? 'on' : ''} onClick={() => setFamily(f)}>
            {f}
          </button>
        ))}
      </div>

      {ordered.map((b) => {
        const hits = b.concepts.filter((c) => wanted.has(c));
        return (
          <div className="card" key={b.id} style={{ marginBottom: 8 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <h4 className="grow" style={{ margin: 0 }}>
                {b.name}
              </h4>
              {hits.length > 0 && <span className="chip pass">on this rubric</span>}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 6px' }}>
              {b.summary}
            </p>

            <div className="row wrap" style={{ gap: 3, marginBottom: 6 }}>
              {b.nodes.slice(0, 6).map((n) => (
                <span className="chip" key={n.key} style={{ fontSize: 10 }} title={n.annotation}>
                  {NODE_SPEC[n.type]?.label ?? n.type}
                </span>
              ))}
              {b.nodes.length > 6 && <span className="stencil">+{b.nodes.length - 6} more</span>}
            </div>

            <div className="row wrap" style={{ gap: 4 }}>
              <button className="primary" onClick={() => place(b)}>
                Place on sheet
              </button>
              <button className="ghost" onClick={() => setOpen(open === b.id ? null : b.id)}>
                {open === b.id ? 'Hide' : 'What it leaves you'}
              </button>
            </div>

            {open === b.id && (
              <div style={{ marginTop: 7 }}>
                <span className="section-label">Yours to decide</span>
                <ul className="list-reset muted" style={{ fontSize: 12 }}>
                  {b.decisions.map((d) => (
                    <li key={d} style={{ marginBottom: 3 }}>
                      — {d}
                    </li>
                  ))}
                </ul>
                <div className="row wrap" style={{ gap: 3, marginTop: 5 }}>
                  {b.concepts.map((c) => (
                    <span className="chip" key={c} style={{ fontSize: 10 }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {ordered.length === 0 && <p className="faint">Nothing in that family yet.</p>}
    </div>
  );
}

/**
 * Patterns the user built themselves. Saved against the account rather than the
 * sheet, because the whole value is using the same agent or ingest pattern on the
 * next problem without redrawing it.
 */
function MyTemplates() {
  const insert = useCanvas((s) => s.insertBlueprint);
  const asTemplate = useCanvas((s) => s.selectionAsTemplate);
  const selectedCount = useCanvas((s) => s.nodes.filter((n) => n.selected && n.type === 'arch').length);
  const setNotice = useApp((s) => s.setNotice);
  const setError = useApp((s) => s.setError);

  const [list, setList] = useState<UserTemplate[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api
      .templates()
      .then(setList)
      .catch(() => setList([]));
  };
  useEffect(load, []);

  const save = async () => {
    const built = asTemplate(name.trim(), summary.trim());
    if (!built) {
      setError({ message: 'Nothing to save — the sheet is empty.' });
      return;
    }
    try {
      setBusy(true);
      await api.saveTemplate({
        name: built.name,
        summary,
        nodes: built.nodes,
        edges: built.edges,
        flows: built.flows,
      });
      setNaming(false);
      setName('');
      setSummary('');
      load();
      setNotice(`Saved "${built.name}" — it is available on every sheet from now on.`);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: UserTemplate) => {
    try {
      await api.deleteTemplate(t.id);
      load();
    } catch (e) {
      setError({ message: (e as ApiError).message });
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <span className="section-label">My templates</span>

      {naming ? (
        <div className="card">
          <label>Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. our agent pattern"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void save();
              if (e.key === 'Escape') setNaming(false);
            }}
          />
          <label style={{ marginTop: 7 }}>Note to your future self (optional)</label>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="what this is for, and what you always have to change"
          />
          <p className="stencil" style={{ marginTop: 5 }}>
            {selectedCount > 0
              ? `saving the ${selectedCount} selected component${selectedCount === 1 ? '' : 's'}, their connections, and any flow entirely inside the selection`
              : 'nothing is selected, so the whole sheet will be saved'}
          </p>
          <div className="row" style={{ marginTop: 7 }}>
            <button className="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? <span className="spinner" /> : null} Save template
            </button>
            <button className="ghost" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setNaming(true)}>
          {selectedCount > 0 ? `Save ${selectedCount} selected as template…` : 'Save this sheet as a template…'}
        </button>
      )}

      {list && list.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {list.map((t) => (
            <div className="card" key={t.id} style={{ marginBottom: 6 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <strong className="grow" style={{ fontSize: 12.5 }}>
                  {t.name}
                </strong>
                <span className="stencil">{t.nodes.length} parts</span>
              </div>
              {t.summary && (
                <p className="muted" style={{ fontSize: 11.5, margin: '3px 0 5px' }}>
                  {t.summary}
                </p>
              )}
              <div className="row wrap" style={{ gap: 4 }}>
                <button
                  onClick={() => {
                    insert(t);
                    setNotice(`${t.name} placed — edit it freely, the template is unchanged.`);
                  }}
                >
                  Place on sheet
                </button>
                <button className="ghost" onClick={() => void remove(t)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list && list.length === 0 && !naming && (
        <p className="stencil" style={{ marginTop: 5 }}>
          none yet — draw a pattern you like, select it, and save it
        </p>
      )}
    </div>
  );
}
