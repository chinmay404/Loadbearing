import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type CanvasMeta } from '../lib/api';
import { copyText, downloadText, toDrawio, toMermaid } from '../lib/diagram';
import { useApp, type LeftTab } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { Canvas } from '../canvas/Canvas';
import { Palette } from '../canvas/Palette';
import { FlowPanel } from './FlowPanel';
import { InspectorPanel } from './InspectorPanel';
import { ChecksPanel } from './ChecksPanel';
import { NotesPanel } from './NotesPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { IconBack } from '../ui/UiIcons';

/**
 * The drawing board for a project view. Same canvas, same simulator, same
 * structural checks — and deliberately no Brief, no Review and no Ask, because
 * there is no rubric to grade against and no problem statement to answer. What is
 * left is the free, deterministic half, which is the half that works on a system
 * nobody set as an exercise.
 */
const TABS: { id: LeftTab; label: string }[] = [
  { id: 'palette', label: 'Add' },
  { id: 'flows', label: 'Flows' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'checks', label: 'Checks' },
  { id: 'notes', label: 'Notes' },
];

export function ProjectWorkspace() {
  const projectId = useApp((s) => s.projectId)!;
  const canvasId = useApp((s) => s.canvasId)!;
  const openProject = useApp((s) => s.openProject);
  const openCanvas = useApp((s) => s.openCanvas);
  const leftTab = useApp((s) => s.leftTab);
  const setLeftTab = useApp((s) => s.setLeftTab);
  const setError = useApp((s) => s.setError);
  const setNotice = useApp((s) => s.setNotice);

  const loadProblem = useCanvas((s) => s.loadProblem);
  const toDoc = useCanvas((s) => s.toDoc);
  const toGraph = useCanvas((s) => s.toGraph);
  const dirty = useCanvas((s) => s.dirty);
  const markClean = useCanvas((s) => s.markClean);

  const [meta, setMeta] = useState<CanvasMeta | null>(null);
  const [siblings, setSiblings] = useState<CanvasMeta[]>([]);
  const [renaming, setRenaming] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const saveTimer = useRef(0);

  // Load this canvas once. `loadProblem` doubles as "load a document" — the store
  // does not care whether the id belongs to a problem or a project canvas.
  useEffect(() => {
    if (loadedFor.current === canvasId) return;
    loadedFor.current = canvasId;
    void (async () => {
      try {
        const c = await api.canvas(canvasId);
        setMeta(c);
        loadProblem(canvasId, c.doc);
      } catch (e) {
        setError({ message: (e as ApiError).message });
        loadProblem(canvasId, null);
      }
    })();
  }, [canvasId, loadProblem, setError]);

  // The sibling list is for switching views without going back up a level.
  useEffect(() => {
    void api
      .project(projectId)
      .then((p) => setSiblings(p.canvases))
      .catch(() => setSiblings([]));
  }, [projectId, canvasId]);

  // Debounced autosave, same shape as the problem workspace: single writer, last
  // write wins.
  useEffect(() => {
    if (!dirty) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api
        .saveCanvas(canvasId, { doc: toDoc() })
        .then(() => markClean())
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [dirty, canvasId, toDoc, markClean]);

  return (
    <div className="workspace">
      <aside className="pane">
        <div className="pane-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={leftTab === t.id ? 'active' : ''} onClick={() => setLeftTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="pane-body">
          <ErrorBoundary area={leftTab}>
            {leftTab === 'palette' && <Palette />}
            {leftTab === 'flows' && <FlowPanel />}
            {leftTab === 'inspect' && <InspectorPanel />}
            {leftTab === 'checks' && <ChecksPanel />}
            {/* Both scopes, because a decision that applies to the whole system is
                worth seeing while drawing the view it constrains. */}
            {leftTab === 'notes' && (
              <>
                <NotesPanel
                  scope="sheet"
                  scopeId={canvasId}
                  blurb="kept with this view only"
                />
                <div style={{ marginTop: 14 }}>
                  <span className="section-label">The whole project</span>
                  <NotesPanel
                    scope="project"
                    scopeId={projectId}
                    blurb="shared by every view of this system"
                  />
                </div>
              </>
            )}
            {leftTab === 'brief' && <Palette />}
          </ErrorBoundary>
        </div>
        <div className="pane-foot">
          <button className="ghost" onClick={() => openProject(projectId)} title="Back to the project">
            <IconBack size={15} /> Project
          </button>
          <span className="grow" />
          <span className="stencil">{dirty ? 'saving…' : 'saved'}</span>
        </div>
      </aside>

      <div className="canvas-wrap">
        <Canvas />
      </div>

      <aside className="pane right">
        <div className="pane-tabs">
          <button className="active">This view</button>
        </div>
        <div className="pane-body">
          {meta && (
            <>
              {renaming ? (
                <RenameCanvas
                  meta={meta}
                  onDone={(next) => {
                    setMeta(next);
                    setRenaming(false);
                    void api.project(projectId).then((p) => setSiblings(p.canvases));
                  }}
                />
              ) : (
                <div className="card">
                  <h4 style={{ margin: 0 }}>{meta.name}</h4>
                  {meta.note ? (
                    <p className="muted" style={{ fontSize: 12, margin: '4px 0 6px' }}>
                      {meta.note}
                    </p>
                  ) : (
                    <p className="stencil" style={{ margin: '4px 0 6px' }}>
                      no note — what is this view for?
                    </p>
                  )}
                  <button className="ghost" onClick={() => setRenaming(true)}>
                    Rename or note
                  </button>
                </div>
              )}

              <span className="section-label">Other views</span>
              {siblings
                .filter((s) => s.id !== canvasId)
                .map((s) => (
                  <button
                    key={s.id}
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
                    onClick={() => openCanvas(projectId, s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              {siblings.length <= 1 && (
                <p className="stencil">this is the only view — add more from the project page</p>
              )}

              <span className="section-label">Take it with you</span>
              <div className="row wrap" style={{ gap: 4 }}>
                <button
                  onClick={() =>
                    void (async () =>
                      setNotice(
                        (await copyText(toMermaid(toGraph())))
                          ? 'Mermaid copied.'
                          : 'Clipboard blocked by the browser.',
                      ))()
                  }
                >
                  Copy Mermaid
                </button>
                <button
                  onClick={() =>
                    downloadText(`${meta.name || 'view'}.drawio`, toDrawio(toDoc()), 'application/xml')
                  }
                >
                  .drawio
                </button>
              </div>
              <p className="stencil" style={{ marginTop: 6 }}>
                the whole-project brief for a coding agent is on the project page — it covers every view
                at once
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function RenameCanvas({ meta, onDone }: { meta: CanvasMeta; onDone: (next: CanvasMeta) => void }) {
  const setError = useApp((s) => s.setError);
  const [name, setName] = useState(meta.name);
  const [note, setNote] = useState(meta.note);
  const [busy, setBusy] = useState(false);

  return (
    <div className="card">
      <label>View name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label style={{ marginTop: 7 }}>What this view is for</label>
      <textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. the write path only — the read path is in another view"
      />
      <div className="row" style={{ marginTop: 7 }}>
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={() => {
            setBusy(true);
            void api
              .saveCanvas(meta.id, { name: name.trim(), note })
              .then(() => onDone({ ...meta, name: name.trim(), note }))
              .catch((e) => setError({ message: (e as ApiError).message }))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <span className="spinner" /> : null} Save
        </button>
        <button className="ghost" onClick={() => onDone(meta)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
