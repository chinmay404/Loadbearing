import { useCallback, useEffect, useRef, useState } from 'react';
import { FAMILY, simulate } from '@loadbearing/shared';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';
import { useApp } from '../state/appStore';
import { api, ApiError } from '../lib/api';
import { IconStop } from '../ui/UiIcons';
import { TimelineStrip } from './TimelineStrip';

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
  const setError = useApp((s) => s.setError);
  const simSource = useCanvas((s) => s.simSource);
  const [verifying, setVerifying] = useState(false);
  const timer = useRef(0);

  const run = useCallback(() => {
    try {
      setSimResult(simulate(toGraph(), config), 'local');
    } catch {
      setSimResult(null);
    }
  }, [config, setSimResult, toGraph]);

  /**
   * The same engine runs in both places (it lives in the shared package), but a
   * capacity claim you are about to defend should come from the server, not from
   * whatever JavaScript happens to be loaded in this tab.
   */
  const verifyOnServer = useCallback(async () => {
    try {
      setVerifying(true);
      const authoritative = await api.simulate({ graph: toGraph(), config });
      setSimResult(authoritative, 'server');
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setVerifying(false);
    }
  }, [config, setSimResult, toGraph, setError]);

  useEffect(() => {
    if (!running) {
      setSimResult(null);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, 60);
    return () => window.clearTimeout(timer.current);
  }, [running, run, nodes, edges, flows, setSimResult]);

  // Idle, the corner carries Run load beside the bill (CostMeter.tsx).
  if (!running) return null;

  const worst = result?.flows.reduce(
    (acc, f) => (acc === null || f.p99Ms > acc.p99Ms ? f : acc),
    null as (typeof result.flows)[number] | null,
  );
  const brokenFlows = result?.flows.filter((f) => f.broken) ?? [];
  const hasExternal = nodes.some(
    (n) => n.type === 'arch' && FAMILY[(n.data as ArchNodeData).archType] === 'external',
  );

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

        {/* Only meaningful when the sheet has an external part. */}
        {(hasExternal || config.thirdPartyLatencyMs > 0) && (
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
        )}

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
                <span className="stencil">p99</span>
                <b style={{ color: worst.p99Ms > 1000 ? 'var(--load)' : undefined }}>{Math.round(worst.p99Ms)}ms</b>
              </div>
            )}
          </>
        )}

        <span className="grow" />

        {problem && problem.scenarios.length > 0 && (
          <div className="row" style={{ gap: 3 }}>
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

        <button
          className="ghost"
          onClick={() => void verifyOnServer()}
          disabled={verifying}
          title={
            simSource === 'server'
              ? 'These numbers came from the backend engine.'
              : 'Computed in the browser for a smooth slider. Recompute on the server for a result you can defend.'
          }
        >
          {verifying ? <span className="spinner" /> : null}
          {simSource === 'server' ? 'Verified' : 'Verify'}
        </button>
      </div>

      {result?.timeline && <TimelineStrip timeline={result.timeline} />}

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
              <summary>{result.findings.length} findings</summary>
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
