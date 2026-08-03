import { useEffect, useState } from 'react';
import {
  capacityOf,
  costOf,
  driftFrom,
  GROUP_LABEL,
  GROUP_ORDER,
  latencyOf,
  paramsFor,
  placeholderFor,
  bindSku,
  choicesFor,
  loadSkus,
  SERVICE_FITS,
  skuById,
  type ArchNodeType,
  type CatalogValue,
  type NodeAttrs,
  type Sku,
} from '@loadbearing/shared';
import { NODE_SPEC } from '../canvas/nodeCatalog';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';
import { IconSkull } from '../ui/UiIcons';
import { explainNode } from '../lib/mathExplain';

/**
 * Where the numbers underneath a component actually came from.
 *
 * The arithmetic above shows how the result was reached. This shows whether the
 * inputs were measured, documented by a provider, or a considered guess — which
 * is the difference between a number worth defending in a review and one worth
 * replacing. Most of the catalogue is still a guess, and it says so rather than
 * presenting every default with equal confidence.
 */
function Provenance({ type, attrs }: { type: ArchNodeType; attrs?: NodeAttrs }) {
  // The snapshots are a megabyte of JSON kept out of the initial bundle, so a
  // component that names a SKU has to wait for them and then re-render. One that
  // does not never triggers the fetch at all.
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!attrs?.sku || skuById(attrs.sku)) return;
    let live = true;
    void loadSkus().then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [attrs?.sku]);

  const rows: { label: string; value: CatalogValue }[] = [
    { label: 'capacity', value: capacityOf(type) },
    { label: 'service time', value: latencyOf(type) },
    { label: 'cost', value: costOf(type) },
  ];
  const sku = skuById(attrs?.sku);
  const drift = driftFrom(attrs);

  return (
    <details className="disclose">
      <summary>where these came from</summary>
      {sku && (
        <p className="faint" style={{ fontSize: 11.5, margin: '4px 0' }}>
          Bound to <strong>{sku.display}</strong> in {sku.region}, priced {sku.measuredAt}.
          {drift.length > 0 && (
            <>
              {' '}
              Edited since:{' '}
              {drift.map((d) => `${String(d.key)} is ${d.current}, not ${d.fromSku}`).join('; ')}.
            </>
          )}
        </p>
      )}
      <table className="mathwork">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="k">{r.label}</td>
              <td className="w">
                <span className={`chip ${r.value.confidence === 'estimate' ? '' : 'pass'}`}>
                  {r.value.confidence}
                </span>{' '}
                {r.value.source}
              </td>
              <td className="r">{r.value.measuredAt ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Pick a real machine for this box.
 *
 * Offered only where a snapshot actually covers the component type, so most
 * components never show it and a learner who never wants a provider never meets
 * one. Choosing writes the real vCPU, memory and documented limits into the
 * ordinary fields below — where they remain editable, because the point is to see
 * what a real instance does to the design, not to be locked to one.
 */
function SkuPicker({
  node,
  type,
  attrs,
  onChange,
}: {
  node: string;
  type: ArchNodeType;
  attrs: NodeAttrs | undefined;
  onChange: (id: string, patch: NodeAttrs) => void;
}) {
  const [options, setOptions] = useState<Sku[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadSkus().then(() => {
      if (!live) return;
      // Both providers at once: which cloud someone is on is a decision they make
      // by picking a machine, not one they should have to declare first.
      setOptions([...choicesFor(type, 'aws'), ...choicesFor(type, 'azure')]);
    });
    return () => {
      live = false;
    };
  }, [open, type]);

  // Nothing in the snapshots fits this component, so there is nothing to offer.
  if (!coveredByAnySnapshot(type)) return null;

  const current = skuById(attrs?.sku);

  return (
    <div style={{ marginTop: 8 }}>
      <span className="stencil">Real instance</span>
      {!open && (
        <button className="ghost" onClick={() => setOpen(true)} style={{ width: '100%' }}>
          {current ? `${current.display} · ${current.region}` : 'Pick a real machine…'}
        </button>
      )}
      {open && options === null && (
        <p className="faint" style={{ fontSize: 11.5 }}>
          Loading prices…
        </p>
      )}
      {open && options !== null && (
        <>
          <select
            value={attrs?.sku ?? ''}
            onChange={(e) => {
              const chosen = options.find((s) => s.id === e.target.value);
              if (!chosen) {
                onChange(node, { sku: undefined } as NodeAttrs);
                return;
              }
              onChange(node, bindSku(attrs, chosen).attrs);
            }}
          >
            <option value="">— none, size it myself —</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.provider} · {s.display} · {s.vcpu ?? '?'} vCPU · {s.memoryGb ?? '?'}GB ·{' '}
                {s.region}
              </option>
            ))}
          </select>
          <p className="faint" style={{ fontSize: 11, marginTop: 4 }}>
            Picking one fills in the fields below from what the provider documents. They stay
            editable — the numbers are a starting point, not a lock.
          </p>
        </>
      )}
    </div>
  );
}

/** Does any offering in the snapshots claim this component type? */
function coveredByAnySnapshot(type: ArchNodeType): boolean {
  return Object.values(SERVICE_FITS).some((types) => (types as readonly string[]).includes(type));
}

/**
 * Every knob a component has, and only the ones it has.
 *
 * The list comes from the component's family rather than from a per-type field array,
 * so a managed load balancer stops offering a zone toggle it has no say over, an
 * autoscaling group gains a floor and a ceiling, and a component someone named
 * themselves inherits the right set from whatever it is based on. Empty means "use the
 * default", which is stated in the placeholder rather than silently filled in.
 */
function Params({
  node,
  type,
  attrs,
  onChange,
}: {
  node: string;
  type: ArchNodeType;
  attrs: NodeAttrs | undefined;
  onChange: (id: string, patch: NodeAttrs) => void;
}) {
  const specs = paramsFor(type);
  if (specs.length === 0) return null;

  return (
    <>
      {GROUP_ORDER.filter((group) => specs.some((s) => s.group === group)).map((group) => (
        <div key={group} style={{ marginTop: 8 }}>
          <span className="stencil">{GROUP_LABEL[group]}</span>
          {specs
            .filter((s) => s.group === group)
            .map((spec) => {
              const value = attrs?.[spec.key];
              if (spec.kind === 'toggle') {
                return (
                  <label
                    key={spec.key}
                    className="row"
                    style={{ marginBottom: 5, textTransform: 'none' }}
                    title={spec.hint}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) => onChange(node, { [spec.key]: e.target.checked } as NodeAttrs)}
                      style={{ width: 'auto' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--graphite)' }}>{spec.label}</span>
                  </label>
                );
              }
              return (
                <div key={spec.key} style={{ marginBottom: 5 }} title={spec.hint}>
                  <label style={{ textTransform: 'none' }}>
                    {spec.label}
                    {spec.unit ? ` (${spec.unit})` : ''}
                  </label>
                  <input
                    type="number"
                    step={spec.step ?? (spec.kind === 'fraction' ? 0.05 : 1)}
                    min={spec.min}
                    max={spec.max}
                    placeholder={placeholderFor(type, spec.key, attrs)}
                    value={value === undefined ? '' : Number(value)}
                    onChange={(e) =>
                      onChange(node, {
                        [spec.key]: e.target.value === '' ? undefined : Number(e.target.value),
                      } as NodeAttrs)
                    }
                  />
                </div>
              );
            })}
        </div>
      ))}
    </>
  );
}

export function InspectorPanel() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const updateNodeAttrs = useCanvas((s) => s.updateNodeAttrs);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const setEdgeLabel = useCanvas((s) => s.setEdgeLabel);
  const killIds = useCanvas((s) => s.simConfig.killNodeIds);
  const degradations = useCanvas((s) => s.simConfig.degradations);
  // Filtered outside the selector: a fresh array from a selector re-renders forever.
  const slowIds = (degradations ?? []).map((d) => d.node);
  const toggleKill = useCanvas((s) => s.toggleKillNode);
  const toggleSlow = useCanvas((s) => s.toggleSlowNode);
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
              <SkuPicker node={n.id} type={data.archType} attrs={data.attrs} onChange={updateNodeAttrs} />
              <Params node={n.id} type={data.archType} attrs={data.attrs} onChange={updateNodeAttrs} />
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
                      <Provenance type={data.archType} attrs={data.attrs} />
                    </>
                  );
                })()}
            </div>
          );
        })}

      {simRunning && archNodes.length > 0 && (
        <div className="card">
          <h4>Chaos — break something</h4>
          <p className="faint" style={{ fontSize: 11.5 }}>
            Kill a component and watch which flows survive. Redundant siblings absorb the traffic; single
            instances break the flow. That is what a SPOF feels like.
          </p>
          <p className="faint" style={{ fontSize: 11.5 }}>
            Slowing one down is usually worse than killing it, and it is the failure most designs are
            unprepared for: a dead dependency fails fast and a slow one holds a worker until the caller
            gives up. <b>Slow</b> makes a component ten times its own service time — a bad query plan, a
            saturated disk — twenty seconds into the run, so you can see the before.
          </p>
          <div className="row wrap" style={{ gap: 4 }}>
            {archNodes.map((n) => {
              const data = n.data as ArchNodeData;
              const dead = killIds.includes(n.id);
              const slow = slowIds.includes(n.id);
              return (
                <span className="row chaos-pair" key={n.id} style={{ gap: 0 }}>
                  <button
                    className={dead ? 'danger on' : ''}
                    onClick={() => toggleKill(n.id)}
                    title={dead ? 'Bring this component back online' : 'Take this component offline'}
                  >
                    {dead ? <IconSkull size={13} /> : null}
                    {data.label}
                  </button>
                  <button
                    className={`chaos-slow${slow ? ' on' : ''}`}
                    onClick={() => toggleSlow(n.id)}
                    title={
                      slow
                        ? `${data.label} is back to its normal speed`
                        : `Make ${data.label} ten times slower from 20s in — the failure a fail-fast design handles and a blocking one does not`
                    }
                  >
                    slow
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
