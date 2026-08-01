import { useEffect, useRef } from 'react';
import { api, ApiError, setUnauthorizedHandler } from './lib/api';
import { useApp, type LeftTab, type RightTab, type View } from './state/appStore';
import { useCanvas } from './state/canvasStore';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { BriefPanel } from './panels/BriefPanel';
import { FlowPanel } from './panels/FlowPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { FeedbackPanel } from './panels/FeedbackPanel';
import { AskPanel } from './panels/AskPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { ProblemBrowser } from './panels/ProblemBrowser';
import { Dashboard } from './panels/Dashboard';
import { ReferencePanel } from './panels/ReferencePanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { ComposePanel } from './panels/ComposePanel';
import { ChecksPanel } from './panels/ChecksPanel';
import { NotesPanel } from './panels/NotesPanel';
import { Panes } from './ui/Panes';
import { SignInPanel } from './panels/SignInPanel';
import { ProjectsPanel } from './panels/ProjectsPanel';
import { ProjectPanel } from './panels/ProjectPanel';
import { ProjectWorkspace } from './panels/ProjectWorkspace';
import { ErrorBoundary } from './ui/ErrorBoundary';
import {
  IconBack,
  IconCompose,
  IconDrafting,
  IconFolder,
  IconGauge,
  IconInstrument,
  IconManual,
  IconSheets,
} from './ui/UiIcons';

const RAIL: { view: View; Icon: (p: { size?: number }) => JSX.Element; title: string }[] = [
  { view: 'problems', Icon: IconSheets, title: 'Problems' },
  { view: 'compose', Icon: IconCompose, title: 'Compose a sheet' },
  { view: 'projects', Icon: IconFolder, title: 'Projects — systems you own' },
  { view: 'workspace', Icon: IconDrafting, title: 'Drawing board' },
  { view: 'dashboard', Icon: IconGauge, title: 'Progress' },
  { view: 'reference', Icon: IconManual, title: 'Design reference' },
  { view: 'settings', Icon: IconInstrument, title: 'Grader model' },
];

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const problem = useApp((s) => s.problem);
  const serverUp = useApp((s) => s.serverUp);
  const setHealth = useApp((s) => s.setHealth);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);
  const notice = useApp((s) => s.notice);
  const setNotice = useApp((s) => s.setNotice);
  const stubMode = useApp((s) => s.stubMode);
  const llmConfigured = useApp((s) => s.llmConfigured);
  const username = useApp((s) => s.username);
  const authChecked = useApp((s) => s.authChecked);
  const signedOut = useApp((s) => s.signedOut);
  const projectId = useApp((s) => s.projectId);
  const canvasId = useApp((s) => s.canvasId);

  useEffect(() => {
    const ping = async () => {
      try {
        const h = await api.health();
        setHealth({
          serverUp: h.ok,
          llmConfigured: h.llmConfigured,
          stubMode: h.fake,
          username: h.signedIn ? (h.username ?? null) : null,
          storageKind: h.storage,
          houseKey: h.houseKey,
        });
        // A database the server cannot reach makes every other failure look like
        // a login problem, so say it plainly and once.
        if (h.storageError) {
          const cause = h.storageAdvice
            ? h.storageAdvice
            : h.databaseUrlSet
              ? h.storageError
              : 'DATABASE_URL is not set on this deployment.';
          setError({
            message: 'The server cannot reach its database, so nothing can be saved or loaded.',
            hint: cause,
          });
        }
      } catch {
        // A server we cannot reach tells us nothing about the session, so the
        // signed-in state is left alone rather than flipped to signed out.
        setHealth({ serverUp: false, llmConfigured: false, stubMode: false });
      }
    };
    void ping();
    const t = window.setInterval(ping, 15000);
    return () => window.clearInterval(t);
  }, [setHealth]);

  // One place decides what an expired session looks like.
  useEffect(() => {
    setUnauthorizedHandler(() => signedOut());
    return () => setUnauthorizedHandler(null);
  }, [signedOut]);

  if (!username) {
    return (
      <div className="gate">
        {authChecked ? (
          <SignInPanel />
        ) : (
          <p className="faint" style={{ marginTop: '10vh' }}>
            Connecting…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="rail">
        <div className="mark" title="Loadbearing">
          LB
        </div>
        {RAIL.map(({ view: v, Icon, title }) => (
          <button
            key={v}
            className={view === v ? 'active' : ''}
            title={title}
            aria-label={title}
            disabled={v === 'workspace' && !problem}
            onClick={() => setView(v)}
          >
            <Icon size={18} />
          </button>
        ))}
        <span className="spacer" />
        <button
          title={`Signed in as ${username} — click to sign out`}
          aria-label="Sign out"
          onClick={() => {
            void api.logout().catch(() => undefined);
            signedOut();
          }}
          style={{ fontSize: 10, letterSpacing: '0.04em' }}
        >
          {username.slice(0, 2).toUpperCase()}
        </button>
        <span
          className={`link-state ${serverUp ? 'up' : ''}`}
          title={serverUp ? 'Server connected on port 8787' : 'Server unreachable on port 8787'}
        >
          {serverUp ? 'linked' : 'no link'}
        </span>
      </nav>

      <main className="main">
        {/* A project canvas never calls a model, so warning about the grader there
            is noise about a capability that view does not use. */}
        {serverUp && !canvasId && (stubMode || !llmConfigured) && (
          <div
            className="banner warnb"
            style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 35, maxWidth: 640, margin: 0 }}
          >
            {stubMode ? (
              <>
                <strong>Reviews are not real right now.</strong> The server was started with{' '}
                <span className="mono">FAKE_LLM=1</span>, which forces the offline stub and ignores the model
                in Settings. Restart it without that variable.
              </>
            ) : (
              <>
                <strong>No grader model configured.</strong> Open <em>Grader model</em> and point Loadbearing at a
                provider, or reviews will not run.
              </>
            )}
          </div>
        )}

        {(error || notice) && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 40, maxWidth: 620 }}>
            {error && (
              <div className="banner error" onClick={() => setError(null)} style={{ cursor: 'pointer' }}>
                <strong>{error.message}</strong>
                {error.hint ? <div style={{ fontSize: 12, marginTop: 3 }}>{error.hint}</div> : null}
                <div className="stencil" style={{ marginTop: 4 }}>
                  click to dismiss
                </div>
              </div>
            )}
            {notice && (
              <div className="banner info" onClick={() => setNotice(null)} style={{ cursor: 'pointer' }}>
                {notice}
              </div>
            )}
          </div>
        )}

        {view === 'problems' && <ProblemBrowser />}
        {view === 'compose' && <ComposePanel />}
        {view === 'projects' && <ProjectsPanel />}
        {view === 'project' && (projectId ? <ProjectPanel /> : <ProjectsPanel />)}
        {view === 'workspace' &&
          (canvasId ? <ProjectWorkspace /> : problem ? <Workspace /> : <ProblemBrowser />)}
        {view === 'dashboard' && <Dashboard />}
        {view === 'reference' && <ReferencePanel />}
        {view === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}

const LEFT_TABS: { id: LeftTab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'palette', label: 'Components' },
  { id: 'flows', label: 'Flows' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'checks', label: 'Checks' },
  { id: 'notes', label: 'Notes' },
];

const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'feedback', label: 'Review' },
  { id: 'ask', label: 'Ask' },
  { id: 'history', label: 'History' },
];

function Workspace() {
  const problem = useApp((s) => s.problem)!;
  const leftTab = useApp((s) => s.leftTab);
  const setLeftTab = useApp((s) => s.setLeftTab);
  const rightTab = useApp((s) => s.rightTab);
  const setRightTab = useApp((s) => s.setRightTab);
  const round = useApp((s) => s.round);
  const twist = useApp((s) => s.activeTwist);
  const previousOverall = useApp((s) => s.previousOverall);
  const submitting = useApp((s) => s.submitting);
  const setSubmitting = useApp((s) => s.setSubmitting);
  const setScore = useApp((s) => s.setScore);
  const setError = useApp((s) => s.setError);
  const setView = useApp((s) => s.setView);

  const loadProblem = useCanvas((s) => s.loadProblem);
  const toGraph = useCanvas((s) => s.toGraph);
  const toDoc = useCanvas((s) => s.toDoc);
  const setMarkup = useCanvas((s) => s.setMarkup);
  const addGhosts = useCanvas((s) => s.addGhosts);
  const clearAi = useCanvas((s) => s.clearAi);
  const nodeCount = useCanvas((s) => s.nodes.filter((n) => n.type === 'arch').length);
  const dirty = useCanvas((s) => s.dirty);
  const markClean = useCanvas((s) => s.markClean);
  const loadedFor = useRef<string | null>(null);
  const saveTimer = useRef(0);

  // Load the saved design once per problem.
  useEffect(() => {
    if (loadedFor.current === problem.id) return;
    loadedFor.current = problem.id;
    void (async () => {
      try {
        const { doc } = await api.loadDesign(problem.id);
        loadProblem(problem.id, doc);
      } catch {
        loadProblem(problem.id, null);
      }
    })();
  }, [problem.id, loadProblem]);

  // Debounced autosave — single writer, last write wins.
  useEffect(() => {
    if (!dirty) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api
        .saveDesign(problem.id, toDoc())
        .then(() => markClean())
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [dirty, problem.id, toDoc, markClean]);

  const submit = async () => {
    clearAi();
    setSubmitting(true);
    setRightTab('feedback');
    try {
      const result = await api.submit({
        problemId: problem.id,
        round,
        graph: toGraph(),
        ...(twist ? { twistText: twist } : {}),
        ...(previousOverall !== null ? { previousOverall } : {}),
      });
      setScore(result);
      setMarkup(result.score.canvas_markup);
      addGhosts(result.score.suggested_additions);
    } catch (e) {
      const err = e as ApiError;
      setSubmitting(false);
      setError({
        message: err.message,
        hint: err.code === 'llm_http' || err.code === 'llm_bad_json' ? (err.hint ?? 'Check the grader model in Settings.') : err.hint,
      });
    }
  };

  return (
    <Panes
      leftLabel="brief"
      rightLabel="review"
      left={
        <>
          <div className="pane-tabs">
          {LEFT_TABS.map((t) => (
            <button key={t.id} className={leftTab === t.id ? 'active' : ''} onClick={() => setLeftTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="pane-body">
          <ErrorBoundary area={leftTab}>
            {leftTab === 'brief' && <BriefPanel />}
            {leftTab === 'palette' && <Palette />}
            {leftTab === 'flows' && <FlowPanel />}
            {leftTab === 'inspect' && <InspectorPanel />}
            {leftTab === 'checks' && <ChecksPanel />}
            {leftTab === 'notes' && (
              <NotesPanel
                scope="sheet"
                scopeId={problem.id}
                blurb="kept with this sheet — not on the canvas, and not graded"
              />
            )}
          </ErrorBoundary>
        </div>
        <div className="pane-foot">
          <button className="ghost" onClick={() => setView('problems')} title="Back to the problem list">
            <IconBack size={15} /> Problems
          </button>
          <span className="grow" />
          <button className="primary" onClick={() => void submit()} disabled={submitting || nodeCount === 0}>
            {submitting ? <span className="spinner" /> : null}
            {submitting ? 'Reviewing' : 'Submit for review'}
          </button>
          </div>
        </>
      }
      right={
        <>
          <div className="pane-tabs">
            {RIGHT_TABS.map((t) => (
              <button key={t.id} className={rightTab === t.id ? 'active' : ''} onClick={() => setRightTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="pane-body">
            <ErrorBoundary area={rightTab === 'feedback' ? 'review' : rightTab}>
              {rightTab === 'feedback' && <FeedbackPanel />}
              {rightTab === 'ask' && <AskPanel />}
              {rightTab === 'history' && <HistoryPanel />}
            </ErrorBoundary>
          </div>
        </>
      }
    >
      <Canvas />
    </Panes>
  );
}
