import { useEffect, useState } from 'react';
import { api, ApiError, type ProjectDetail } from '../lib/api';
import { copyText, downloadText } from '../lib/diagram';
import { useApp } from '../state/appStore';
import { IconBack, IconPlus } from '../ui/UiIcons';

/** One project: its views, and the export that covers all of them together. */
export function ProjectPanel() {
  const projectId = useApp((s) => s.projectId)!;
  const openCanvas = useApp((s) => s.openCanvas);
  const closeProject = useApp((s) => s.closeProject);
  const setError = useApp((s) => s.setError);
  const setNotice = useApp((s) => s.setNotice);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    void api
      .project(projectId)
      .then(setProject)
      .catch((e) => setError({ message: (e as ApiError).message }));
  };
  useEffect(load, [projectId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    try {
      setBusy(key);
      await fn();
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(null);
    }
  };

  if (!project) return <div className="sheet">{<p className="faint">Loading…</p>}</div>;

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="ghost" onClick={closeProject}>
          <IconBack size={15} /> Projects
        </button>
      </div>

      <h1>{project.name}</h1>
      {project.summary ? (
        <p className="lede">{project.summary}</p>
      ) : (
        <p className="lede faint">
          No summary yet. What this system does and what constrains it goes into the export — worth
          writing.
        </p>
      )}

      <SummaryEditor project={project} onSaved={load} />

      <span className="section-label">Views · {project.canvases.length}</span>
      <p className="stencil" style={{ marginTop: 0 }}>
        one system, several drawings — a component named the same way in two views is the same component
      </p>

      {project.canvases.map((c) => (
        <div className="card" key={c.id} style={{ marginBottom: 7 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <strong className="grow" style={{ fontSize: 13 }}>
              {c.name}
            </strong>
            <span className="stencil">{c.updatedAt.slice(0, 10)}</span>
          </div>
          {c.note && (
            <p className="muted" style={{ fontSize: 11.5, margin: '3px 0 6px' }}>
              {c.note}
            </p>
          )}
          <div className="row wrap" style={{ gap: 4 }}>
            <button className="primary" onClick={() => openCanvas(project.id, c.id)}>
              Open on the board
            </button>
            <button
              className="ghost"
              onClick={() =>
                void run(`del-${c.id}`, async () => {
                  await api.deleteCanvas(c.id);
                  load();
                })
              }
              disabled={busy !== null || project.canvases.length === 1}
              title={
                project.canvases.length === 1
                  ? 'A project keeps at least one view'
                  : 'Delete this view'
              }
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card" style={{ marginTop: 4 }}>
        <label>Add a view</label>
        <div className="row" style={{ gap: 5 }}>
          <input
            className="grow"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Ingest pipeline, Data layer, Auth flow"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                void run('add', async () => {
                  const c = await api.createCanvas(project.id, { name: newName.trim() });
                  setNewName('');
                  openCanvas(project.id, c.id);
                });
              }
            }}
          />
          <button
            onClick={() =>
              void run('add', async () => {
                const c = await api.createCanvas(project.id, { name: newName.trim() || 'Untitled view' });
                setNewName('');
                openCanvas(project.id, c.id);
              })
            }
            disabled={busy !== null}
          >
            <IconPlus size={15} /> Add
          </button>
        </div>
      </div>

      <span className="section-label">Hand the whole system over</span>
      <div className="card">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          One build specification covering every view: components with their sizing, request paths in
          order, the components shared between views, invariants from your connection kinds, the gaps the
          rule engine found, and the graphs as JSON.
        </p>
        <div className="row wrap" style={{ gap: 4 }}>
          <button
            className="primary"
            onClick={() =>
              void run('brief', async () => {
                const r = await api.projectBrief(project.id);
                const copied = await copyText(r.markdown);
                if (copied) {
                  setNotice('Whole-project brief copied — paste it into a coding agent as the task.');
                } else {
                  downloadText(r.filename, r.markdown, 'text/markdown');
                  setNotice(`Clipboard blocked, saved ${r.filename} instead.`);
                }
              })
            }
            disabled={busy !== null}
          >
            {busy === 'brief' ? <span className="spinner" /> : null} Copy for coding agent
          </button>
          <button
            onClick={() =>
              void run('briefdl', async () => {
                const r = await api.projectBrief(project.id);
                downloadText(r.filename, r.markdown, 'text/markdown');
                setNotice(`Saved ${r.filename}.`);
              })
            }
            disabled={busy !== null}
          >
            .md brief
          </button>
          <span className="grow" />
          <button
            className="ghost"
            onClick={() =>
              void run('delproj', async () => {
                await api.deleteProject(project.id);
                closeProject();
              })
            }
            disabled={busy !== null}
            title="Delete the project and every view in it"
          >
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}

/** Editing the summary in place, because it is the part the export leans on. */
function SummaryEditor({ project, onSaved }: { project: ProjectDetail; onSaved: () => void }) {
  const setError = useApp((s) => s.setError);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [summary, setSummary] = useState(project.summary);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="ghost" onClick={() => setOpen(true)}>
          Edit name and summary
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label style={{ marginTop: 8 }}>Summary</label>
      <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={() => {
            setBusy(true);
            void api
              .updateProject(project.id, { name: name.trim(), summary })
              .then(() => {
                setOpen(false);
                onSaved();
              })
              .catch((e) => setError({ message: (e as ApiError).message }))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <span className="spinner" /> : null} Save
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
