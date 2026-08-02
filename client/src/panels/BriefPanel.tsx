import { useMemo } from 'react';
import { DESIGN_CHECKLIST, evaluateAllScenarios } from '@loadbearing/shared';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { ArchDiagram } from '../ui/ArchDiagram';

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
  const passCount = [...gates.values()].filter((g) => g.pass).length;
  const emptySheet = nodes.filter((n) => n.type === 'arch').length === 0;

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <span className={`lvl l${problem.level}`}>L{problem.level}</span>
        {problem.kind === 'lab' && <span className="chip lab-chip">lab</span>}
        <span className="chip">{problem.domain}</span>
        {round > 1 && <span className="chip load">round {round}</span>}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{problem.title}</h3>

      {twist && (
        <div className="banner warnb">
          <strong>Twist in play.</strong> {twist}
        </div>
      )}

      <p style={{ marginTop: 0 }}>{problem.prompt}</p>

      {problem.diagram && (
        <>
          <ArchDiagram diagram={problem.diagram} />
          <div className="row wrap" style={{ margin: '-4px 0 10px' }}>
            <span className="stencil grow">
              {problem.kind === 'lab' ? 'your starting point' : 'the system today'} · hover a box for
              what it does
            </span>
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
        </>
      )}

      <div className="card">
        <h4>Must do</h4>
        <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
          {problem.functional.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h4>Numbers</h4>
        <div className="row wrap" style={{ gap: 4 }}>
          {Object.entries(problem.nonFunctional).map(([k, v]) => (
            <span className="chip spec" key={k}>
              {k}: {String(v)}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h4>Constraints — these decide what counts as overengineering</h4>
        <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
          {problem.constraints.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h4>Flows you should declare</h4>
        <div className="row wrap" style={{ gap: 4 }}>
          {problem.expectedFlows.map((f) => (
            <span className="chip spec" key={f}>
              {f}
            </span>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
          Define these in the Flows tab. They drive the load simulator and are graded step by step.
        </p>
      </div>

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

      <details className="disclose" open={flows.length > 0}>
        <summary>
          Scenario gates · {passCount}/{problem.scenarios.length} passing
        </summary>
        {flows.length === 0 && (
          <p className="faint" style={{ fontSize: 11.5 }}>
            Gates evaluate live once you declare a flow — they are checked by the capacity model, not by
            the grader, so making them green costs nothing.
          </p>
        )}
        {problem.scenarios.map((s) => {
          const g = gates.get(s.id);
          return (
            <div
              className={`card ${g ? (g.pass ? 'ok-card' : 'sev-high') : ''}`}
              key={s.id}
            >
              <div className="row">
                <h4 className="grow">{s.name}</h4>
                {g && flows.length > 0 && (
                  <span className={`chip ${g.pass ? 'pass' : 'fail'}`}>{g.pass ? 'PASS' : 'FAIL'}</span>
                )}
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                {s.description}
              </p>
              <div className="row wrap" style={{ gap: 4 }}>
                <span className="chip">×{s.rpsMultiplier} load</span>
                {(s.killNodes ?? []).map((k) => (
                  <span className="chip fail" key={k}>
                    kill {k}
                  </span>
                ))}
                {s.thirdPartyLatencyMs ? <span className="chip load">+{s.thirdPartyLatencyMs}ms 3rd-party</span> : null}
              </div>
              {g && flows.length > 0 ? (
                <ul className="list-reset faint" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                  {g.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="faint" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                  Pass: {s.passCriteria}
                </p>
              )}
            </div>
          );
        })}
      </details>
    </div>
  );
}
