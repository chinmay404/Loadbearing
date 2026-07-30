import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

/**
 * What you can do to a connection, shown when exactly one is selected.
 *
 * Reconnecting by dragging an endpoint is the fast path once you know it exists,
 * but nothing on a canvas advertises a drag gesture. This bar does: it names the
 * two edits — put something in the middle, or take the connection out — and says
 * that the ends can be dragged.
 */
export function EdgeTools() {
  const edges = useCanvas((s) => s.edges);
  const nodes = useCanvas((s) => s.nodes);
  const setEdgeInsertTarget = useCanvas((s) => s.setEdgeInsertTarget);
  const detachEdge = useCanvas((s) => s.detachEdge);
  const setEdgeKind = useCanvas((s) => s.setEdgeKind);
  const setNotice = useApp((s) => s.setNotice);

  const selected = edges.filter((e) => e.selected);
  if (selected.length !== 1) return null;
  const edge = selected[0]!;

  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id;
    return n.type === 'arch' ? n.data.label : 'note';
  };
  const kind = (edge.data as { kind?: string } | undefined)?.kind ?? 'sync';

  return (
    <div
      className="card"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 12,
        padding: '7px 9px',
        maxWidth: 340,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12 }}>
        <strong>{label(edge.source)}</strong> → <strong>{label(edge.target)}</strong>{' '}
        <span className="chip">{kind}</span>
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
      <div className="row wrap" style={{ gap: 3 }}>
        <span className="stencil">retype</span>
        {(['sync', 'async', 'replication'] as const).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setEdgeKind(edge.id, k)}>
            {k}
          </button>
        ))}
      </div>
      <p className="stencil" style={{ margin: 0 }}>
        or drag either end of the line onto another component to re-point it — drop it on empty paper to
        disconnect
      </p>
    </div>
  );
}
