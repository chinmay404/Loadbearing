import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  COURSE,
  STEP_BY_ID,
  defaultFor,
  docFromBlueprint,
  familyOf,
  idOfKey,
  judgeStep,
  roleOf,
  simulate,
  type Dial,
  type Gate,
  type Step,
  type StepVerdict,
} from '@loadbearing/shared';
import { Canvas } from '../canvas/Canvas';
import { GoalMark, type GoalState } from '../ui/GoalMark';
import { NODE_ICONS } from '../canvas/icons';
import { NODE_SPEC } from '../canvas/nodeCatalog';
import { api } from '../lib/api';
import { useApp } from '../state/appStore';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';
import { IconBack, IconPlay } from '../ui/UiIcons';
import { RULE_GOAL, STEP_KIND, stepAfter, useCourse } from './useCourse';

/**
 * One course step: a few words on the left, the learner's own system on the right,
 * one button that sends traffic through it. The goals turn green or red from the
 * same arithmetic the server checks.
 */
export function Lesson() {
  const stepId = useCourse((s) => s.stepId);
  const step = stepId ? STEP_BY_ID[stepId] : undefined;
  const setView = useApp((s) => s.setView);
  useEffect(() => {
    if (!step) setView('learn');
  }, [step, setView]);
  if (!step) return null;
  return <LessonFor key={step.id} step={step} />;
}

type Mark = GoalState;

function LessonFor({ step }: { step: Step }) {
  const setView = useApp((s) => s.setView);
  const setNotice = useApp((s) => s.setNotice);
  const username = useApp((s) => s.username);
  const open = useCourse((s) => s.open);
  const passed = useCourse((s) => s.passed);
  const progress = useCourse((s) => s.progress);

  const loadProblem = useCanvas((s) => s.loadProblem);
  const toGraph = useCanvas((s) => s.toGraph);
  const toDoc = useCanvas((s) => s.toDoc);
  const setSimResult = useCanvas((s) => s.setSimResult);
  const setSimRunning = useCanvas((s) => s.setSimRunning);
  const setSimConfig = useCanvas((s) => s.setSimConfig);
  const addGhosts = useCanvas((s) => s.addGhosts);
  const dirty = useCanvas((s) => s.dirty);
  const markClean = useCanvas((s) => s.markClean);

  const [verdict, setVerdict] = useState<StepVerdict | null>(null);
  const [hints, setHints] = useState(0);
  const [guess, setGuess] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef(0);

  const chapter = COURSE.find((c) => c.id === step.chapter)!;
  const index = chapter.steps.indexOf(step);

  // The learner's own canvas for this step if they have one, else the step's start.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let doc = null;
      try {
        doc = (await api.loadDesign(`course:${step.id}`)).doc;
      } catch {
        doc = null;
      }
      if (cancelled) return;
      loadProblem(`course:${step.id}`, doc && doc.nodes.length > 0 ? doc : docFromBlueprint(step.start));
      setReady(true);
    })();
    return () => {
      cancelled = true;
      setSimRunning(false);
      setSimResult(null);
      setSimConfig({ rpsMultiplier: 1, killNodeIds: [] });
    };
  }, [step, loadProblem, setSimRunning, setSimResult, setSimConfig]);

  // Saved as you go, like any sheet.
  useEffect(() => {
    if (!dirty || !ready) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api
        .saveDesign(`course:${step.id}`, toDoc())
        .then(() => markClean())
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [dirty, ready, step.id, toDoc, markClean]);

  // A result describes one design. Change the design and the result is old news.
  const shape = useCanvas((s) =>
    s.nodes
      .filter((n) => n.type === 'arch')
      .map((n) => `${n.id}:${JSON.stringify((n.data as ArchNodeData).attrs ?? {})}`)
      .join('|') +
    '#' +
    s.edges.map((e) => `${e.source}>${e.target}`).join('|'),
  );
  const lastShape = useRef(shape);
  useEffect(() => {
    if (shape === lastShape.current) return;
    lastShape.current = shape;
    if (verdict && !verdict.passed) {
      setVerdict(null);
      setSimRunning(false);
    }
  }, [shape, verdict, setSimRunning]);

  // In a find-the-bottleneck step, clicking a part is the guess.
  const selected = useCanvas((s) =>
    s.nodes
      .filter((n) => n.selected && n.type === 'arch')
      .map((n) => n.id)
      .join(','),
  );
  useEffect(() => {
    if (step.predict && !verdict && selected) setGuess(selected.split(',').pop() ?? null);
  }, [selected, step.predict, verdict]);

  const labelOf = (id: string | null) => {
    if (!id) return '';
    const n = useCanvas.getState().nodes.find((x) => x.id === id);
    return (n?.data as ArchNodeData | undefined)?.label ?? id;
  };

  // Copies of one part break together, so picking either copy is the right call.
  const calledIt = (a: string | null, b: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const nodes = toGraph().nodes;
    const x = nodes.find((n) => n.id === a);
    const y = nodes.find((n) => n.id === b);
    return x !== undefined && y !== undefined && roleOf(x) === roleOf(y);
  };

  const run = () => {
    const graph = toGraph();
    const v = judgeStep(step, graph);
    // The canvas shows the heaviest run: that is where things break.
    const gate = step.gates.reduce<Gate>((a, b) => (b.rps > a.rps ? b : a), step.gates[0]!);
    const base = graph.nodes.find((n) => familyOf(n.type) === 'origin')?.attrs?.trafficRps ?? gate.rps;
    const config = {
      rpsMultiplier: base > 0 ? gate.rps / base : 1,
      killNodeIds: gate.kill ? [idOfKey(gate.kill.key)] : [],
      thirdPartyLatencyMs: 0,
    };
    setSimConfig(config);
    setSimResult(simulate(graph, config), 'local');
    setSimRunning(true);
    setVerdict(v);
    if (v.passed && !progress[step.id] && username) {
      void api
        .passStep(step.id, graph, hints)
        .then((r) => passed(r.progress.steps))
        .catch(() => setNotice('Your pass could not be saved just now. It will count the next time you run it.'));
    }
  };

  const hint = () => {
    const next = Math.min(3, hints + 1);
    setHints(next);
    const ghost = step.hints.ghost;
    if (next === 3 && ghost) {
      const [from, to] = ghost.between;
      addGhosts([
        {
          type: ghost.type,
          label: ghost.label,
          annotation: '',
          connect_from: idOfKey(from),
          ...(to !== from ? { connect_to: idOfKey(to) } : {}),
          kind: 'sync',
          why: 'One way to solve it. Accept it, then wire it in.',
        },
      ]);
    }
  };

  const reset = () => {
    loadProblem(`course:${step.id}`, docFromBlueprint(step.start));
    setVerdict(null);
    setGuess(null);
    setSimRunning(false);
    setSimResult(null);
  };

  const after = stepAfter(step);
  const goNext = () => {
    if (after && after.chapter === step.chapter) open(after.id);
    else setView('learn');
  };

  const mark = (pass: boolean | undefined): Mark => (verdict ? (pass ? 'pass' : 'fail') : 'pending');
  const done = verdict?.passed ?? false;

  // On a long step the pass card can land below the fold; the win should be seen.
  const passCard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!done) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    passCard.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, [done]);

  return (
    <div className="lesson-shell">
      <aside className="lesson-card" data-density="roomy">
        <div className="lesson-top">
          <button className="ghost" onClick={() => setView('learn')} title="Back to the path">
            <IconBack size={15} /> Path
          </button>
          <span className="lesson-where">
            {chapter.number === 0 ? 'Prologue' : `Chapter ${chapter.number}`} · {index + 1} of {chapter.steps.length}
          </span>
        </div>
        <div className="lesson-pips" aria-hidden="true">
          {chapter.steps.map((s) => (
            <i key={s.id} className={progress[s.id] ? 'done' : s.id === step.id ? 'cur' : ''} />
          ))}
        </div>

        <span className="chip spec lesson-kind">{STEP_KIND[step.type]}</span>
        <h1>{step.title}</h1>
        <p className="lesson-story">{step.story}</p>
        <p className="lesson-task">{step.task}</p>

        {(step.dials ?? []).map((d) => (
          <DialControl key={`${d.key}.${String(d.attr)}`} dial={d} />
        ))}

        {step.predict && (
          <div className={`guess${guess ? ' set' : ''}`}>
            {verdict ? (
              <>
                <b>First to break: {labelOf(verdict.firstFailure) || 'nothing'}</b>
                <span>{calledIt(guess, verdict.firstFailure) ? 'You called it.' : guess ? `Not quite. You picked ${labelOf(guess)}.` : ''}</span>
              </>
            ) : guess ? (
              <>
                <b>Your guess: {labelOf(guess)}</b>
                <span>Run it to see.</span>
              </>
            ) : (
              <span>Click a part on the bench to make your guess.</span>
            )}
          </div>
        )}

        <section className="goals-list" aria-live="polite">
          {step.gates.map((g, i) => {
            const r = verdict?.gates[i];
            return <Goal key={g.id} mark={mark(r?.pass)} label={g.label} detail={r?.detail} />;
          })}
          {(verdict?.findings ?? (step.clears ?? []).map((rule) => ({ rule, open: true, message: '' }))).map((f) => (
            <Goal key={f.rule} mark={mark(!f.open)} label={RULE_GOAL[f.rule] ?? f.rule} />
          ))}
          {(step.uses ?? []).map((u, i) => (
            <Goal key={u.label} mark={mark(verdict?.uses[i]?.pass)} label={u.label} />
          ))}
          <Goal
            mark={mark(verdict?.budget.pass)}
            label={`Under $${step.budget} a month`}
            detail={verdict ? `$${verdict.budget.cost}` : undefined}
          />
        </section>

        {!done && (
          <div className="lesson-actions">
            <button className="primary lesson-run" onClick={run} disabled={!ready || (step.predict === true && !guess)}>
              <IconPlay size={15} /> {verdict ? 'Run again' : 'Run'}
            </button>
            <button className="ghost" onClick={hint} disabled={hints >= (step.hints.ghost ? 3 : 2)}>
              {hints === 0 ? 'Hint' : 'Another hint'}
            </button>
            <button className="ghost" onClick={reset} title="Put the step back how it started">
              Reset
            </button>
          </div>
        )}

        {hints > 0 && !done && (
          <div className="hint-box">
            <p>
              <b>Think about it.</b> {step.hints.question}
            </p>
            {hints > 1 && <p>{step.hints.concept}</p>}
            {hints > 2 && step.hints.ghost && <p className="faint">A suggested part is on the bench.</p>}
          </div>
        )}

        {verdict && !done && !step.observe && <p className="lesson-nudge">Not yet. Change one thing and run it again.</p>}

        {done && (
          <div className="pass-card" ref={passCard}>
            <div className="pass-head">
              <span className="pass-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <b>{step.observe ? 'Seen it' : 'Passed'}</b>
            </div>
            <p>{step.lesson}</p>
            <button className="primary" onClick={goNext}>
              {after && after.chapter === step.chapter ? `Next: ${after.title}` : 'Back to the path'}
            </button>
          </div>
        )}
      </aside>

      <section className="lesson-bench">
        {ready && (
          <Canvas lesson>
            <PartsTray step={step} />
          </Canvas>
        )}
      </section>
    </div>
  );
}

function Goal({ mark, label, detail }: { mark: Mark; label: string; detail?: string | undefined }) {
  return (
    <div className="goal-row" data-state={mark}>
      <GoalMark state={mark} />
      <span className="goal-label">{label}</span>
      {detail && <span className={`goal-detail mono${detail.length > 14 ? ' long' : ''}`}>{detail}</span>}
    </div>
  );
}

function DialControl({ dial }: { dial: Dial }) {
  const id = idOfKey(dial.key);
  const node = useCanvas((s) => s.nodes.find((n) => n.id === id));
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const data = node?.data as ArchNodeData | undefined;
  const attrs = data?.attrs ?? {};
  const fallback = data ? defaultFor(data.archType, dial.attr, attrs) : undefined;
  const raw = attrs[dial.attr] ?? fallback;
  const value = typeof raw === 'number' ? raw : dial.min;
  const label = useMemo(() => data?.label ?? dial.key, [data, dial.key]);

  if (!node || !data) return null;
  return (
    <label className="dial">
      <span className="dial-top">
        <span>
          {label} · {dial.label}
        </span>
        <b className="mono">
          {value}
          {dial.unit ? ` ${dial.unit}` : ''}
        </b>
      </span>
      <input
        type="range"
        min={dial.min}
        max={dial.max}
        step={dial.step}
        value={value}
        onChange={(e) => updateNodeData(id, { attrs: { ...attrs, [dial.attr]: Number(e.target.value) } })}
      />
    </label>
  );
}

function PartsTray({ step }: { step: Step }) {
  const addArchNode = useCanvas((s) => s.addArchNode);
  const { fitView } = useReactFlow();
  if (step.parts.length === 0) return null;

  // A new part never lands on top of something already there. On a single row it
  // goes on the end, the way a request travels; in a bigger drawing it waits just
  // below, because where it belongs is the learner's call. Then the bench fits it in.
  const place = (type: Step['parts'][number]) => {
    const at = useCanvas
      .getState()
      .nodes.filter((n) => n.type === 'arch' && !(n.data as ArchNodeData).ghost)
      .map((n) => n.position);
    const xs = at.map((p) => p.x);
    const ys = at.map((p) => p.y);
    const oneRow = at.every((p) => p.y === ys[0]);
    const spot =
      at.length === 0
        ? { x: 0, y: 0 }
        : oneRow
          ? { x: Math.max(...xs) + 300, y: ys[0]! }
          : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 200 };
    addArchNode(type, spot);
    requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1.1, duration: 400 }));
  };
  return (
    <div className="parts-tray">
      <span className="parts-label">Parts</span>
      {step.parts.map((t) => {
        const Icon = NODE_ICONS[t];
        return (
          <button key={t} className="part-btn" onClick={() => place(t)}>
            <span className="part-ico">
              <Icon size={17} />
            </span>
            {NODE_SPEC[t]?.label ?? t}
          </button>
        );
      })}
    </div>
  );
}
