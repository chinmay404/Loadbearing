import type { FlowKind } from '@archdojo/shared';
import { FLOW_KINDS, useCanvas, type ArchNodeData } from '../state/canvasStore';
import { useApp } from '../state/appStore';

const KIND_HINT: Record<FlowKind, string> = {
  read: 'A read path — cacheable, latency-sensitive, usually the highest volume.',
  write: 'A write path — where consistency, idempotency and durability get decided.',
  async: 'Background work — queued, retried, eventually consistent.',
  admin: 'Operational or internal path — low volume, high privilege.',
};

export function FlowPanel() {
  const flows = useCanvas((s) => s.flows);
  const nodes = useCanvas((s) => s.nodes);
  const addFlow = useCanvas((s) => s.addFlow);
  const updateFlow = useCanvas((s) => s.updateFlow);
  const removeFlow = useCanvas((s) => s.removeFlow);
  const appendFlowStep = useCanvas((s) => s.appendFlowStep);
  const removeFlowStep = useCanvas((s) => s.removeFlowStep);
  const sim = useCanvas((s) => s.simResult);
  const problem = useApp((s) => s.problem);

  const archNodes = nodes.filter(
    (n): n is Extract<typeof n, { type: 'arch' }> => n.type === 'arch' && !(n.data as ArchNodeData).ghost,
  );
  const labelOf = (id: string) => archNodes.find((n) => n.id === id)?.data.label ?? '?';

  const declared = new Set(flows.map((f) => f.name.trim().toLowerCase()));
  const missing = (problem?.expectedFlows ?? []).filter((f) => !declared.has(f.trim().toLowerCase()));

  return (
    <div>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        A flow is one request's journey through your design. Declaring them is what turns a box diagram
        into a design — the simulator pushes load down them and the grader reviews them step by step.
      </p>

      {missing.length > 0 && (
        <div className="banner info">
          Still undeclared: {missing.join(', ')}
          <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
            {missing.map((name) => (
              <button
                key={name}
                onClick={() => {
                  const id = addFlow();
                  updateFlow(id, { name });
                }}
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="primary" onClick={() => addFlow()} style={{ marginBottom: 10 }}>
        + New flow
      </button>

      {flows.length === 0 && (
        <p className="faint" style={{ fontSize: 12 }}>
          No flows yet. Add one, then click components in order to build the path.
        </p>
      )}

      {flows.map((flow) => {
        const result = sim?.flows.find((f) => f.flowId === flow.id);
        return (
          <div className="card" key={flow.id}>
            <div className="row" style={{ marginBottom: 6 }}>
              <input
                value={flow.name}
                onChange={(e) => updateFlow(flow.id, { name: e.target.value })}
                placeholder="checkout write path"
              />
              <button className="ghost" onClick={() => removeFlow(flow.id)} title="Delete flow">
                ✕
              </button>
            </div>

            <div className="row" style={{ marginBottom: 6 }}>
              <select
                value={flow.kind}
                onChange={(e) => updateFlow(flow.id, { kind: e.target.value as FlowKind })}
                title={KIND_HINT[flow.kind]}
                style={{ width: 110 }}
              >
                {FLOW_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <div className="row" style={{ gap: 4 }}>
                <input
                  type="number"
                  min={0}
                  value={flow.rps}
                  onChange={(e) => updateFlow(flow.id, { rps: Math.max(0, Number(e.target.value)) })}
                  style={{ width: 90 }}
                />
                <span className="faint mono">rps</span>
              </div>
            </div>

            <input
              value={flow.description}
              onChange={(e) => updateFlow(flow.id, { description: e.target.value })}
              placeholder="What this flow guarantees (e.g. exactly-once charge, read-your-writes)"
              style={{ marginBottom: 6 }}
            />

            <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>
              {flow.steps.length === 0 && <span className="faint" style={{ fontSize: 11.5 }}>no steps yet →</span>}
              {flow.steps.map((s, i) => (
                <span className="chip accent" key={`${s}-${i}`}>
                  {i + 1}. {labelOf(s)}
                  <button
                    className="ghost"
                    style={{ padding: '0 2px', fontSize: 10 }}
                    onClick={() => removeFlowStep(flow.id, i)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <select
              value=""
              onChange={(e) => {
                if (e.target.value) appendFlowStep(flow.id, e.target.value);
              }}
            >
              <option value="">+ add next step…</option>
              {archNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.label} ({n.data.archType})
                </option>
              ))}
            </select>

            {result && (
              <div style={{ marginTop: 8 }}>
                <div className="row wrap" style={{ gap: 4 }}>
                  <span className={`chip ${result.broken ? 'bad' : 'good'}`}>
                    {result.broken ? `breaks at ${result.brokenAt}` : 'completes'}
                  </span>
                  <span className="chip">
                    {Math.round(result.completedRps)}/{Math.round(result.offeredRps)} rps
                  </span>
                  <span className="chip info">p99 {Math.round(result.p99Ms)}ms</span>
                </div>
                {result.notes.length > 0 && (
                  <ul className="list-reset faint" style={{ fontSize: 11.5, marginTop: 5 }}>
                    {result.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
