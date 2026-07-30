import { useCallback, useEffect, useRef } from 'react';
import { simulate } from '@archdojo/shared';
import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';
import { IconPlay, IconStop } from '../ui/UiIcons';

/**
 * The load instrument. The capacity model runs locally on every change, so
 * dragging the load dial re-colours the drawing live — no server, no tokens.
 */
export function SimHud() {
  const running = useCanvas((s) => s.simRunning);
  const setRunning = useCanvas((s) => s.setSimRunning);
  const config = useCanvas((s) => s.simConfig);
  const setConfig = useCanvas((s) => s.setSimConfig);
  const setSimResult = useCanvas((s) => s.setSimResult);
  const result = useCanvas((s) => s.simResult);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const flows = useCanvas((s) => s.flows);
  const toGraph = useCanvas((s) => s.toGraph);
  const problem = useApp((s) => s.problem);
  const timer = useRef(0);

  const run = useCallback(() => {
    try {
      setSimResult(simulate(toGraph(), config));
    } catch {
      setSimResult(null);
    }
  }, [config, setSimResult, toGraph]);

  useEffect(() => {
    if (!running) {
      setSimResult(null);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, 60);
    return () => window.clearTimeout(timer.current);
  }, [running, run, nodes, edges, flows, setSimResult]);

  if (!running) {
    return (
      <div className="toolbar" style={{ left: 'auto', right: 12, top: 10, transform: 'none' }}>
        <button onClick={() => setRunning(true)} disabled={flows.length === 0} title="Push synthetic traffic down your declared flows">
          <IconPlay size={13} /> Run load
        </button>
        {flows.length === 0 && (
          <span className="stencil" style={{ alignSelf: 'center', padding: '0 6px' }}>
            declare a flow first
          </span>
        )}
      </div>
    );
  }

  const worst = result?.flows.reduce(
    (acc, f) => (acc === null || f.p99Ms > acc.p99Ms ? f : acc),
    null as (typeof result.flows)[number] | null,
  );
  const brokenFlows = result?.flows.filter((f) => f.broken) ?? [];

  return (
    <div className="instrument">
      <div className="strip">
        <button className="on" onClick={() => setRunning(false)} title="Stop the simulation">
          <IconStop size={13} /> Stop
        </button>

        <div className="readout">
          <span className="stencil">load</span>
          <b>×{config.rpsMultiplier}</b>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={config.rpsMultiplier}
            onChange={(e) => setConfig({ rpsMultiplier: Number(e.target.value) })}
            aria-label="Load multiplier"
          />
        </div>

        <div className="readout">
          <span className="stencil">3rd-party</span>
          <b>+{config.thirdPartyLatencyMs}ms</b>
          <input
            type="range"
            min={0}
            max={5000}
            step={100}
            value={config.thirdPartyLatencyMs}
            onChange={(e) => setConfig({ thirdPartyLatencyMs: Number(e.target.value) })}
            style={{ width: 96 }}
            aria-label="Extra third-party latency"
          />
        </div>

        {result && (
          <>
            <div className="readout">
              <span className="stencil">dropped</span>
              <b style={{ color: result.totalDroppedRps > 0 ? 'var(--fail)' : 'var(--pass)' }}>
                {Math.round(result.totalDroppedRps)} rps
              </b>
            </div>
            {worst && (
              <div className="readout">
                <span className="stencil">worst p99</span>
                <b style={{ color: worst.p99Ms > 1000 ? 'var(--load)' : undefined }}>{Math.round(worst.p99Ms)}ms</b>
              </div>
            )}
            <div className="readout">
              <span className="stencil">cost</span>
              <b>${Math.round(result.monthlyCost)}/mo</b>
            </div>
          </>
        )}

        <span className="grow" />

        {problem && problem.scenarios.length > 0 && (
          <div className="row" style={{ gap: 3 }}>
            <span className="stencil">scenarios</span>
            {problem.scenarios.map((sc) => (
              <button
                key={sc.id}
                title={`${sc.description}\n\nPasses when: ${sc.passCriteria}`}
                onClick={() => {
                  const graph = toGraph();
                  const kills = (sc.killNodes ?? []).flatMap((needle) =>
                    graph.nodes
                      .filter(
                        (n) =>
                          n.label.toLowerCase().includes(needle.toLowerCase()) ||
                          n.type.includes(needle.toLowerCase()),
                      )
                      .map((n) => n.id),
                  );
                  setConfig({
                    rpsMultiplier: sc.rpsMultiplier,
                    thirdPartyLatencyMs: sc.thirdPartyLatencyMs ?? 0,
                    killNodeIds: kills,
                  });
                }}
              >
                {sc.name}
              </button>
            ))}
            {config.killNodeIds.length > 0 && (
              <button onClick={() => setConfig({ killNodeIds: [] })} title="Bring every killed component back online">
                Revive {config.killNodeIds.length}
              </button>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="verdict">
          {result.verdict}
          {brokenFlows.length > 0 && (
            <div className="row wrap" style={{ marginTop: 5, gap: 4 }}>
              {brokenFlows.map((f) => (
                <span className="chip fail" key={f.flowId}>
                  {f.name} stops at {f.brokenAt}
                </span>
              ))}
            </div>
          )}
          {result.findings.length > 0 && (
            <details className="disclose" style={{ marginTop: 0 }}>
              <summary>{result.findings.length} findings from the capacity model</summary>
              <ul className="list-reset" style={{ fontSize: 12, marginTop: 3 }}>
                {result.findings.map((f, i) => (
                  <li key={i} className="muted">
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
