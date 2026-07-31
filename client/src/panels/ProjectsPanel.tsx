import { useEffect, useState } from 'react';
import { api, ApiError, type ProjectSummary } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconPlus } from '../ui/UiIcons';

/**
 * Systems you are actually designing, as opposed to problems you are practising
 * on. A project has no rubric and no score — nobody is grading your own
 * architecture — so what it offers instead is the free deterministic feedback and
 * one export covering every view at once.
 */
export function ProjectsPanel() {
  const openProject = useApp((s) => s.openProject);
  const openCanvas = useApp((s) => s.openCanvas);
  const setError = useApp((s) => s.setError);

  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api
      .projects()
      .then(setList)
      .catch((e) => {
        setError({ message: (e as ApiError).message });
        setList([]);
      });
  };
  useEffect(load, []);

  const create = async () => {
    try {
      setBusy(true);
      const p = await api.createProject({ name: name.trim(), summary: summary.trim() });
      setCreating(false);
      setName('');
      setSummary('');
      openCanvas(p.id, p.firstCanvasId);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <h1>Projects</h1>
      <p className="lede">
        A system you are designing for real, drawn across as many views as it needs — the request path,
        the ingest pipeline, the data layer. No rubric and no score here; the structural checks and the
        capacity model still run, and one export covers every view at once for a coding agent.
      </p>

      {creating ? (
        <div className="card">
          <label>What system is this?</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme payments platform"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void create();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <label style={{ marginTop: 8 }}>What it does, and what constrains it (optional)</label>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Traffic, data, team size, budget, compliance — whatever a new engineer would need to know. This goes into the export."
          />
          <div className="row" style={{ marginTop: 9 }}>
            <button className="primary" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? <span className="spinner" /> : null} Create project
            </button>
            <button className="ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap" style={{ gap: 5, marginBottom: 14 }}>
          <button className="primary" onClick={() => setCreating(true)}>
            <IconPlus size={15} /> New project
          </button>
        </div>
      )}

      {list === null && <p className="faint">Loading…</p>}

      {list !== null && list.length === 0 && !creating && (
        <div className="empty-state">
          <div>
            <h3>No projects yet</h3>
            <p style={{ fontSize: 12.5, maxWidth: 320 }}>
              Practice problems live under <em>Problems</em>. A project is for a system you actually own —
              several diagrams of one thing, exported together.
            </p>
          </div>
        </div>
      )}

      {list !== null && list.length > 0 && (
        <div className="index-grid">
          {list.map((p) => (
            <div className="card" key={p.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <h4 className="grow" style={{ margin: 0 }}>
                  {p.name}
                </h4>
                <span className="chip">
                  {p.canvasCount} view{p.canvasCount === 1 ? '' : 's'}
                </span>
              </div>
              {p.summary && (
                <p className="muted" style={{ fontSize: 12, margin: '5px 0 7px' }}>
                  {p.summary.length > 180 ? `${p.summary.slice(0, 180)}…` : p.summary}
                </p>
              )}
              <p className="stencil" style={{ margin: '0 0 7px' }}>
                last touched {p.updatedAt.slice(0, 10)}
              </p>
              <button onClick={() => openProject(p.id)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
