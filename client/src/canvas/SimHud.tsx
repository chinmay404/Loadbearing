import { useCallback, useEffect, useRef } from 'react';
import { simulate } from '@archdojo/shared';
import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

/**
 * The live load HUD. The simulation runs locally on every change, so dragging
 * the load slider re-colours the diagram in real time — no server, no tokens.
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
        <button
          onClick={() => setRunning(true)}
          title="Push synthetic load through your declared flows"
          disabled={flows.length === 0}
        >
          ▶ Run load
        </button>
        {flows.length === 0 && (
          <span className="faint" style={{ fontSize: 11, alignSelf: 'center', padding: '0 6px' }}>
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

  return (
    <div className="sim-hud">
      <div className="row wrap">
        <button className="on" onClick={() => setRunning(false)} title="Stop the simulation">
          ■ Stop
        </button>
        <div className="row" style={{ gap: 6 }}>
          <span className="faint mono">load ×{config.rpsMultiplier}</span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={config.rpsMultiplier}
            onChange={(e) => setConfig({ rpsMultiplier: Number(e.target.value) })}
          />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="faint mono">3rd-party +{config.thirdPartyLatencyMs}ms</span>
          <input
            type="range"
            min={0}
            max={5000}
            step={100}
            value={config.thirdPartyLatencyMs}
            onChange={(e) => setConfig({ thirdPartyLatencyMs: Number(e.target.value) })}
            style={{ width: 110 }}
          />
        </div>
        {result && (
          <>
            <span className={`chip ${result.totalDroppedRps > 0 ? 'bad' : 'good'}`}>
              {result.totalDroppedRps > 0
                ? `dropping ${Math.round(result.totalDroppedRps)} rps`
                : 'no drops'}
            </span>
            {worst && <span className="chip info">worst p99 {Math.round(worst.p99Ms)}ms</span>}
            <span className="chip">~${Math.round(result.monthlyCost)}/mo</span>
          </>
        )}
        <span className="grow" />
        {problem && problem.scenarios.length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            {problem.scenarios.map((sc) => (
              <button
                key={sc.id}
                title={`${sc.description}\n\nPass: ${sc.passCriteria}`}
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
              <button onClick={() => setConfig({ killNodeIds: [] })} title="Revive all killed components">
                revive {config.killNodeIds.length}
              </button>
            )}
          </div>
        )}
      </div>

      {result && (
        <>
          <div className="verdict">{result.verdict}</div>
          {result.flows.some((f) => f.broken) && (
            <div className="row wrap" style={{ marginTop: 5, gap: 5 }}>
              {result.flows
                .filter((f) => f.broken)
                .map((f) => (
                  <span className="chip bad" key={f.flowId}>
                    {f.name} breaks at {f.brokenAt}
                  </span>
                ))}
            </div>
          )}
          {result.findings.length > 0 && (
            <details className="disclose" style={{ marginTop: 4 }}>
              <summary>{result.findings.length} findings from the capacity model</summary>
              <ul className="list-reset" style={{ fontSize: 12, marginTop: 4 }}>
                {result.findings.map((f, i) => (
                  <li key={i} className="muted">
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="faint" style={{ fontSize: 11, margin: '5px 0 0' }}>
            Tip: click a component in the Inspector's kill list to take it offline and watch the flows
            re-route — or fail.
          </p>
        </>
      )}
    </div>
  );
}
