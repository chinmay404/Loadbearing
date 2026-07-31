import type { NodeAttrs } from '@loadbearing/shared';
import { NODE_SPEC } from '../canvas/nodeCatalog';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';
import { IconSkull } from '../ui/UiIcons';
import { explainNode } from '../lib/mathExplain';

const FIELD_LABEL: Record<keyof NodeAttrs, string> = {
  capacityRps: 'Capacity (rps per replica)',
  replicas: 'Replicas / shards',
  latencyMs: 'Service latency (ms)',
  cacheHitRate: 'Cache hit rate (0–1)',
  queueDepthMax: 'Max queue depth (messages)',
  multiAz: 'Spread across AZs',
  monthlyCost: 'Cost ($/month per replica)',
  concurrency: 'Concurrent requests (per replica)',
  timeoutMs: 'Caller gives up after (ms)',
  trafficRps: 'Traffic starts here (rps)',
  autoscaleMax: 'Autoscale up to (replicas)',
};

export function InspectorPanel() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const updateNodeAttrs = useCanvas((s) => s.updateNodeAttrs);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const setEdgeLabel = useCanvas((s) => s.setEdgeLabel);
  const killIds = useCanvas((s) => s.simConfig.killNodeIds);
  const toggleKill = useCanvas((s) => s.toggleKillNode);
  const simRunning = useCanvas((s) => s.simRunning);
  const sim = useCanvas((s) => s.simResult);

  const selected = nodes.filter((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected);
  const archNodes = nodes.filter((n) => n.type === 'arch');

  return (
    <div>
      {selected.length === 0 && !selectedEdge && (
        <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
          Select a component to tune its capacity, replicas and latency — those numbers drive the load
          simulator and the grader sees them too.
        </p>
      )}

      {selectedEdge && (
        <div className="card">
          <h4>Connection</h4>
          <label>Label (protocol, payload, guarantee)</label>
          <input
            defaultValue={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
            placeholder="HTTP/JSON · at-least-once · gRPC stream"
            onBlur={(e) => setEdgeLabel(selectedEdge.id, e.target.value)}
          />
          <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            Change its type with the toolbar buttons while it is selected.
          </p>
        </div>
      )}

      {selected
        .filter((n) => n.type === 'arch')
        .map((n) => {
          const data = n.data as ArchNodeData;
          const spec = NODE_SPEC[data.archType];
          return (
            <div className="card" key={n.id}>
              <h4>{data.label}</h4>
              <p className="faint" style={{ fontSize: 11.5 }}>
                {spec.hint}
              </p>
              <label>Reasoning (the grader reads this)</label>
              <textarea
                defaultValue={data.annotation}
                placeholder="e.g. cache-aside, TTL 60s, request coalescing on miss to avoid a stampede"
                onBlur={(e) => updateNodeData(n.id, { annotation: e.target.value })}
                style={{ marginBottom: 8 }}
              />
              {spec.attrFields.map((field) => {
                const value = data.attrs?.[field];
                if (field === 'multiAz') {
                  return (
                    <label key={field} className="row" style={{ marginBottom: 6, textTransform: 'none' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => updateNodeAttrs(n.id, { multiAz: e.target.checked })}
                        style={{ width: 'auto' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--graphite)' }}>{FIELD_LABEL[field]}</span>
                    </label>
                  );
                }
                return (
                  <div key={field} style={{ marginBottom: 6 }}>
                    <label>{FIELD_LABEL[field]}</label>
                    <input
                      type="number"
                      step={field === 'cacheHitRate' ? 0.05 : 1}
                      value={value === undefined ? '' : Number(value)}
                      onChange={(e) =>
                        updateNodeAttrs(n.id, {
                          [field]: e.target.value === '' ? undefined : Number(e.target.value),
                        } as NodeAttrs)
                      }
                    />
                  </div>
                );
              })}
              {sim &&
                (() => {
                  const r = sim.nodes.find((x) => x.nodeId === n.id);
                  if (!r) return null;
                  const perReplica = data.attrs?.capacityRps ?? spec.defaults.capacityRps ?? 0;
                  const replicas = data.attrs?.replicas ?? spec.defaults.replicas ?? 1;
                  const baseLatency = data.attrs?.latencyMs ?? spec.defaults.latencyMs ?? 0;
                  return (
                    <>
                      <div className="row wrap" style={{ gap: 4, marginTop: 8 }}>
                        <span className={`chip ${r.state === 'ok' ? 'pass' : r.state === 'warn' ? 'load' : 'fail'}`}>
                          {r.state}
                        </span>
                        <span className="chip">{Math.round(r.incomingRps)} rps in</span>
                        <span className="chip">{Math.round(r.latencyMs)}ms</span>
                        {r.queueDepth > 0 && <span className="chip load">queue {Math.round(r.queueDepth)}</span>}
                      </div>
                      <details className="disclose" open>
                        <summary>the arithmetic</summary>
                        <table className="mathwork">
                          <tbody>
                            {explainNode(r, perReplica, replicas, baseLatency).map((l) => (
                              <tr key={l.label}>
                                <td className="k">{l.label}</td>
                                <td className="w">{l.work}</td>
                                <td className="r">{l.result}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </>
                  );
                })()}
            </div>
          );
        })}

      {simRunning && archNodes.length > 0 && (
        <div className="card">
          <h4>Chaos — take something offline</h4>
          <p className="faint" style={{ fontSize: 11.5 }}>
            Kill a component and watch which flows survive. Redundant siblings absorb the traffic; single
            instances break the flow. That is what a SPOF feels like.
          </p>
          <div className="row wrap" style={{ gap: 4 }}>
            {archNodes.map((n) => {
              const data = n.data as ArchNodeData;
              const dead = killIds.includes(n.id);
              return (
                <button
                  key={n.id}
                  className={dead ? 'danger on' : ''}
                  onClick={() => toggleKill(n.id)}
                  title={dead ? 'Bring this component back online' : 'Take this component offline'}
                >
                  {dead ? <IconSkull size={13} /> : null}
                  {data.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
