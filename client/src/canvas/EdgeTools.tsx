import { useEffect, useState } from 'react';
import { bendsOf, shapeOf, useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

/**
 * What you can do to a connection, shown when exactly one is selected.
 *
 * The label is editable right here rather than only in the Inspect tab. Naming
 * what travels over a connection is the most common single edit on this canvas,
 * and sending someone across the workspace to a different panel for it means the
 * labels do not get written — which matters, because the grader reads them.
 */
export function EdgeTools() {
  const edges = useCanvas((s) => s.edges);
  const nodes = useCanvas((s) => s.nodes);
  const setEdgeInsertTarget = useCanvas((s) => s.setEdgeInsertTarget);
  const detachEdge = useCanvas((s) => s.detachEdge);
  const setEdgeKind = useCanvas((s) => s.setEdgeKind);
  const setEdgeLabel = useCanvas((s) => s.setEdgeLabel);
  const setEdgeShape = useCanvas((s) => s.setEdgeShape);
  const clearEdgeBends = useCanvas((s) => s.clearEdgeBends);
  const setNotice = useApp((s) => s.setNotice);

  const selected = edges.filter((e) => e.selected);
  const edge = selected.length === 1 ? selected[0]! : null;

  // Local draft so typing is not fighting the store on every keystroke.
  const [label, setLabel] = useState('');
  useEffect(() => {
    setLabel(edge && typeof edge.label === 'string' ? edge.label : '');
  }, [edge?.id]);

  if (!edge) return null;

  const name = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id;
    return n.type === 'arch' ? n.data.label : 'note';
  };
  const kind = (edge.data as { kind?: string } | undefined)?.kind ?? 'sync';
  const shape = shapeOf(edge);
  const bends = bendsOf(edge);

  const commit = () => setEdgeLabel(edge.id, label.trim());

  return (
    <div
      className="card"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 12,
        padding: '7px 9px',
        width: 340,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12 }}>
        <strong>{name(edge.source)}</strong> → <strong>{name(edge.target)}</strong>{' '}
        <span className="chip">{kind}</span>
      </div>

      <div>
        <label style={{ fontSize: 9.5 }}>What travels over this connection</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setLabel(typeof edge.label === 'string' ? edge.label : '');
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="e.g. POST /checkout, order-placed event, replication stream"
        />
      </div>

      <div className="row wrap" style={{ gap: 3 }}>
        <span className="stencil">kind</span>
        {(['sync', 'async', 'replication'] as const).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setEdgeKind(edge.id, k)}>
            {k}
          </button>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 3 }}>
        <span className="stencil">shape</span>
        {(['smooth', 'step', 'straight', 'curved'] as const).map((sh) => (
          <button key={sh} className={shape === sh ? 'on' : ''} onClick={() => setEdgeShape(edge.id, sh)}>
            {sh}
          </button>
        ))}
        {bends.length > 0 && (
          <button className="ghost" onClick={() => clearEdgeBends(edge.id)} title="Remove every bend">
            straighten ({bends.length})
          </button>
        )}
      </div>

      <div className="row wrap" style={{ gap: 4 }}>
        <button onClick={() => setEdgeInsertTarget(edge.id)}>Insert component between…</button>
        <button
          onClick={() => {
            detachEdge(edge.id);
            setNotice('Connection removed. Both components are still on the sheet.');
          }}
        >
          Disconnect
        </button>
      </div>

      <p className="stencil" style={{ margin: 0 }}>
        drag the dashed dot on the line to bend it, drag a bend to move it, double-click a bend to remove
        it · drag either end onto another component to re-point it, or onto empty paper to disconnect
      </p>
    </div>
  );
}
