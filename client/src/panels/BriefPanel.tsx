import { useMemo, useState } from 'react';
import { DESIGN_CHECKLIST, evaluateAllScenarios, type Problem } from '@loadbearing/shared';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { ArchDiagram } from '../ui/ArchDiagram';

/**
 * The problem, in the order you need it while drawing: what has to pass, the numbers
 * that size it, the situation, then the rules. It used to open with a 150-word
 * paragraph and bury the pass conditions at the bottom in a collapsed section, so the
 * one thing that decides "done" was the last thing anybody read.
 */
export function BriefPanel() {
  const problem = useApp((s) => s.problem);
  const round = useApp((s) => s.round);
  const twist = useApp((s) => s.activeTwist);
  const score = useApp((s) => s.score);
  const setNotice = useApp((s) => s.setNotice);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const flows = useCanvas((s) => s.flows);
  const toGraph = useCanvas((s) => s.toGraph);
  const insertBlueprint = useCanvas((s) => s.insertBlueprint);
  const deselectAll = useCanvas((s) => s.deselectAll);
  const setSimConfig = useCanvas((s) => s.setSimConfig);
  const setSimRunning = useCanvas((s) => s.setSimRunning);
  const [storyOpen, setStoryOpen] = useState(false);
  const [openGoal, setOpenGoal] = useState<string | null>(null);

  // Live pass/fail per scenario — deterministic and free, recomputed as you draw.
  const gates = useMemo(() => {
    if (!problem) return new Map<string, ReturnType<typeof evaluateAllScenarios>[number]>();
    try {
      return new Map(evaluateAllScenarios(toGraph(), problem).map((g) => [g.scenarioId, g]));
    } catch {
      return new Map<string, ReturnType<typeof evaluateAllScenarios>[number]>();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, nodes, edges, flows, toGraph]);

  if (!problem) return null;
  const checked = flows.length > 0;
  const passCount = [...gates.values()].filter((g) => g.pass).length;
  const emptySheet = nodes.filter((n) => n.type === 'arch').length === 0;
  const { lead, rest } = splitStory(problem.prompt);
  const numbers = numberTiles(problem.nonFunctional);

  /** Play a goal's scenario on the canvas, so "what does this mean" is one click. */
  const playScenario = (s: Problem['scenarios'][number]) => {
    const graph = toGraph();
    const kills = (s.killNodes ?? []).flatMap((needle) =>
      graph.nodes
        .filter((n) => n.label.toLowerCase().includes(needle.toLowerCase()) || n.type.includes(needle.toLowerCase()))
        .map((n) => n.id),
    );
    setSimConfig({ rpsMultiplier: s.rpsMultiplier, thirdPartyLatencyMs: s.thirdPartyLatencyMs ?? 0, killNodeIds: kills });
    setSimRunning(true);
  };

  return (
    <div className="brief">
      <div className="brief-tags">
        <span className={`lvl l${problem.level}`}>L{problem.level}</span>
        {problem.kind === 'lab' && <span className="chip lab-chip">lab</span>}
        <span className="chip">{problem.domain}</span>
        {round > 1 && <span className="chip load">round {round}</span>}
      </div>
      <h3 className="brief-title">{problem.title.replace(/^Lab:\s*/, '')}</h3>

      {twist && (
        <div className="banner warnb">
          <strong>Twist in play.</strong> {twist}
        </div>
      )}

      {problem.scenarios.length > 0 && (
        <section className="brief-goal">
          <header>
            <h4>Make these pass</h4>
            <span className="brief-count">
              {checked ? `${passCount} / ${problem.scenarios.length}` : 'declare a flow to check'}
            </span>
          </header>
          <ul>
            {problem.scenarios.map((s) => {
              const g = gates.get(s.id);
              const state = !checked || !g ? 'idle' : g.pass ? 'pass' : 'fail';
              const open = openGoal === s.id;
              return (
                <li key={s.id} className={`goal ${state}${open ? ' open' : ''}`}>
                  <button className="goal-row" onClick={() => setOpenGoal(open ? null : s.id)} aria-expanded={open}>
                    <span className="goal-dot" aria-hidden="true" />
                    <span className="goal-text">
                      <b>{s.name}</b>
                      <span>{s.passCriteria}</span>
                    </span>
                  </button>
                  <div className="goal-more">
                    <div>
                      <p>{s.description}</p>
                      {checked && g && !g.pass && (
                        <ul className="goal-reasons">
                          {g.reasons
                            .filter((r) => !r.startsWith('PASS'))
                            .slice(0, 3)
                            .map((r, i) => (
                              <li key={i}>{r.replace(/^FAIL\s*[—-]\s*/, '')}</li>
                            ))}
                        </ul>
                      )}
                      <button className="goal-play" onClick={() => playScenario(s)}>
                        ▶ Try it on the canvas
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {numbers.length > 0 && (
        <section className="brief-numbers">
          {numbers.map((n) => (
            <div className="num-tile" key={n.key} title={n.note}>
              <b>
                {n.value}
                {n.unit && <small>{n.unit}</small>}
              </b>
              <span>{n.label}</span>
            </div>
          ))}
        </section>
      )}

      <section className="brief-story">
        <h4>The situation</h4>
        <p>{lead}</p>
        {rest && (
          <>
            {storyOpen && <p>{rest}</p>}
            <button className="link-btn" onClick={() => setStoryOpen(!storyOpen)}>
              {storyOpen ? 'Show less' : 'Read the full story'}
            </button>
          </>
        )}
      </section>

      {problem.diagram && (
        <section>
          <ArchDiagram diagram={problem.diagram} />
          <div className="row wrap" style={{ margin: '-4px 0 0' }}>
            <span className="stencil grow">{problem.kind === 'lab' ? 'your starting point' : 'the system today'}</span>
            <button
              onClick={() => {
                insertBlueprint(problem.diagram!);
                deselectAll();
                setNotice(
                  emptySheet
                    ? 'Starting architecture placed. Everything on it is yours to change.'
                    : 'Placed alongside what you had drawn — nothing was replaced.',
                );
              }}
              title={
                emptySheet
                  ? 'Put this architecture on the canvas'
                  : 'Adds another copy beside your work; it never overwrites what you have drawn'
              }
            >
              {emptySheet ? 'Put it on the canvas' : 'Place another copy'}
            </button>
          </div>
        </section>
      )}

      <section className="brief-list">
        <h4>It must</h4>
        <ul>
          {problem.functional.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </section>

      <section className="brief-list rules">
        <h4>Rules</h4>
        <ul>
          {problem.constraints.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="brief-list">
        <h4>Flows to declare</h4>
        <div className="row wrap" style={{ gap: 4 }}>
          {problem.expectedFlows.map((f) => (
            <span className="chip spec" key={f}>
              {f}
            </span>
          ))}
        </div>
      </section>

      {score === null && (
        <details className="disclose">
          <summary>The 10-step checklist a complete answer covers</summary>
          <ol className="list-reset" style={{ fontSize: 12, marginTop: 6 }}>
            {DESIGN_CHECKLIST.map((s) => (
              <li key={s.step} style={{ marginBottom: 5 }}>
                <strong>{s.step}</strong>
                <div className="faint">{s.detail}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** The first two sentences carry the situation; the rest is colour you can open. */
export function splitStory(prompt: string): { lead: string; rest: string } {
  const sentences = prompt.match(/[^.!?]+[.!?]+(?:["')\]]+)?(?:\s+|$)/g) ?? [prompt];
  if (sentences.length <= 2) return { lead: prompt.trim(), rest: '' };
  return { lead: sentences.slice(0, 2).join('').trim(), rest: sentences.slice(2).join('').trim() };
}

const UNIT_SUFFIX: [RegExp, string][] = [
  [/Rps$/, 'rps'],
  [/Ms$/, 'ms'],
  [/Pct$/, '%'],
  [/Gb$/i, 'GB'],
  [/Tb$/i, 'TB'],
];

/** `peakRps: 900` → { label: 'Peak', value: '900', unit: 'rps' }. */
export function numberTiles(nf: Problem['nonFunctional']): { key: string; label: string; value: string; unit: string; note?: string }[] {
  return Object.entries(nf).map(([key, raw]) => {
    let base = key;
    let unit = '';
    for (const [re, u] of UNIT_SUFFIX) {
      if (re.test(base) && base.replace(re, '').length > 0) {
        base = base.replace(re, '');
        unit = u;
        break;
      }
    }
    const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    const label = words.charAt(0).toUpperCase() + words.slice(1);
    if (typeof raw === 'number') return { key, label, value: raw.toLocaleString('en-US'), unit };
    const text = String(raw);
    const cut = text.indexOf(' — ');
    return cut > 0
      ? { key, label, value: text.slice(0, cut), unit, note: text.slice(cut + 3) }
      : { key, label, value: text, unit };
  });
}
