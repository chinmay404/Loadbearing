import { useState } from 'react';
import { api, ApiError, type AttackRun } from '../lib/api';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { IconTarget } from '../ui/UiIcons';

/**
 * The coach, attacking your drawing.
 *
 * The scenarios shipped with a problem are the author's guesses about what a design
 * for it might get wrong. These are about the design you actually drew — the component
 * with one instance, the cache everything reads through, the third party on the
 * synchronous path.
 *
 * What makes it worth trusting is that the model does not report the outcome. It
 * chooses what to do and states what it expects to break; the deterministic engine
 * runs it and says what happened. So a confident wrong guess is visibly a wrong guess,
 * which is a rare and useful property in anything an LLM produces.
 */
export function AttackPanel() {
  const problem = useApp((s) => s.problem);
  const setError = useApp((s) => s.setError);
  const setNotice = useApp((s) => s.setNotice);
  const toGraph = useCanvas((s) => s.toGraph);
  const nodes = useCanvas((s) => s.nodes);
  const setSimConfig = useCanvas((s) => s.setSimConfig);
  const setRunning = useCanvas((s) => s.setSimRunning);
  const focusNode = useCanvas((s) => s.focusNode);

  const [runs, setRuns] = useState<AttackRun[] | null>(null);
  const [busy, setBusy] = useState(false);

  const label = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    return (node?.data as { label?: string } | undefined)?.label ?? id;
  };

  const devise = async () => {
    if (!problem) return;
    try {
      setBusy(true);
      const { attacks } = await api.attacks({ problemId: problem.id, graph: toGraph() });
      setRuns(attacks);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  /** Put one on the instrument, so the timeline and the canvas show it happening. */
  const replay = (run: AttackRun) => {
    setSimConfig({
      rpsMultiplier: run.config.rpsMultiplier,
      killNodeIds: run.config.killNodeIds,
      thirdPartyLatencyMs: run.config.thirdPartyLatencyMs,
      degradations: run.config.degradations ?? [],
    });
    setRunning(true);
    setNotice(`Running "${run.attack.name}" — watch the timeline.`);
  };

  return (
    <div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        The problem's own scenarios are guesses about what <em>a</em> design might get wrong. These are
        aimed at the one you drew. The coach picks what to do and says what it expects to break; the
        engine runs it and says what actually did.
      </p>

      <button className="primary" onClick={() => void devise()} disabled={busy || !problem}>
        {busy ? <span className="spinner" /> : <IconTarget size={15} />}{' '}
        {runs ? 'Attack it again' : 'Attack this design'}
      </button>

      {runs?.length === 0 && (
        <p className="faint" style={{ marginTop: 8 }}>
          Nothing came back that this engine can run. Try again.
        </p>
      )}

      {runs?.map((run) => {
        const { attack, outcome } = run;
        // Unmeasured is not survival. A design whose flows name components that are no
        // longer on the canvas produces zeroes everywhere, and calling that SURVIVED
        // was the most dangerous thing this panel could say.
        const measured = outcome.measured !== false;
        const survived = measured && outcome.droppedPct < 1 && outcome.brokenFlows.length === 0;
        /**
         * Only ever confirms, never contradicts.
         *
         * The check is a substring match on prose, which is strong enough to say "it
         * named this" and far too weak to say "it did not". A hypothesis can be right
         * and phrased differently, and the first version of this told the reader the
         * prediction was wrong whenever the words did not line up. The two statements
         * are printed next to each other regardless; the reader can compare them.
         */
        const namedIt =
          outcome.firstToBreak !== null &&
          label(outcome.firstToBreak).length > 3 &&
          attack.hypothesis.toLowerCase().includes(label(outcome.firstToBreak).toLowerCase());

        return (
          <div className={`card attack ${survived ? 'ok-card' : 'sev-high'}`} key={attack.id}>
            <div className="row wrap">
              <h4 className="grow">{attack.name}</h4>
              <span className={`chip ${!measured ? 'load' : survived ? 'pass' : 'fail'}`}>
                {!measured ? 'NOT MEASURED' : survived ? 'SURVIVED' : `${outcome.droppedPct}% LOST`}
              </span>
            </div>

            <p className="muted" style={{ fontSize: 12.5 }}>
              {attack.description}
            </p>

            <div className="row wrap" style={{ gap: 4 }}>
              {attack.rpsMultiplier > 1 && <span className="chip load">×{attack.rpsMultiplier} load</span>}
              {attack.killNodes.map((id) => (
                <button className="chip fail" key={id} onClick={() => focusNode(id)}>
                  kill {label(id)}
                </button>
              ))}
              {attack.degrade.map((d, i) => (
                <span className="chip load" key={i}>
                  {d.hitRate !== undefined
                    ? `${d.node} hits ${Math.round(d.hitRate * 100)}%`
                    : d.capacityMultiple !== undefined
                      ? `${d.node} at ${Math.round(d.capacityMultiple * 100)}% capacity`
                      : d.latencyMultiple !== undefined
                        ? `${d.node} ×${d.latencyMultiple} slower`
                        : `${d.node} +${d.addMs}ms`}
                </span>
              ))}
              {attack.thirdPartyLatencyMs > 0 && (
                <span className="chip load">+{attack.thirdPartyLatencyMs}ms third-party</span>
              )}
            </div>

            {attack.unresolved.length > 0 && (
              <p className="connect-warn">
                It also wanted to hit {attack.unresolved.join(', ')}, which is not on this sheet — that
                part did not happen.
              </p>
            )}

            <dl>
              <dt>it expected</dt>
              <dd>{attack.hypothesis || '—'}</dd>
              <dt>what happened</dt>
              <dd>{outcome.verdict}</dd>
              {outcome.brokenFlows.length > 0 && (
                <>
                  <dt>flows that stopped</dt>
                  <dd style={{ color: 'var(--fail)' }}>{outcome.brokenFlows.join(', ')}</dd>
                </>
              )}
              <dt>worst p99</dt>
              <dd>{outcome.worstP99Ms}ms</dd>
              <dt>passes when</dt>
              <dd>{attack.passCriteria}</dd>
            </dl>

            {outcome.firstToBreak && (
              <p className="faint" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                First to break: <b>{label(outcome.firstToBreak)}</b>
                {namedIt ? ' — which is what it predicted.' : ''}
              </p>
            )}

            <button onClick={() => replay(run)} title="Put this on the load instrument and watch it run">
              Run it on the canvas
            </button>
          </div>
        );
      })}
    </div>
  );
}
