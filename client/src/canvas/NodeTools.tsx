import { useCanvas } from '../state/canvasStore';

/**
 * What you can do to the selected components. Appears only when something is
 * selected, next to the edge toolbar's slot but above it.
 *
 * Stacking matters here more than on a general-purpose canvas: boundaries are
 * drawn as large rectangles behind their contents, and once you nest one
 * boundary in another — an AI stack inside a VPC — which rectangle catches the
 * click is decided entirely by the stacking order.
 */
export function NodeTools() {
  const nodes = useCanvas((s) => s.nodes);
  const restack = useCanvas((s) => s.restack);
  const setLocked = useCanvas((s) => s.setLocked);

  const chosen = nodes.filter((n) => n.selected);
  if (chosen.length === 0) return null;

  const allLocked = chosen.every((n) => n.draggable === false);
  const label =
    chosen.length === 1
      ? chosen[0]!.type === 'arch'
        ? (chosen[0] as { data: { label: string } }).data.label
        : 'note'
      : `${chosen.length} selected`;

  return (
    <div
      className="card"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 132,
        zIndex: 12,
        padding: '7px 9px',
        maxWidth: 320,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12 }}>
        <strong>{label}</strong>
        {allLocked && (
          <span className="chip" style={{ marginLeft: 5 }}>
            pinned
          </span>
        )}
      </div>
      <div className="row wrap" style={{ gap: 3 }}>
        <span className="stencil">order</span>
        <button title="Bring to front (Ctrl+Shift+])" onClick={() => restack('front')}>
          front
        </button>
        <button title="Bring forward (Ctrl+])" onClick={() => restack('forward')}>
          forward
        </button>
        <button title="Send backward (Ctrl+[)" onClick={() => restack('backward')}>
          backward
        </button>
        <button title="Send to back (Ctrl+Shift+[)" onClick={() => restack('back')}>
          back
        </button>
      </div>
      <div className="row wrap" style={{ gap: 3 }}>
        <button
          className={allLocked ? 'on' : ''}
          title="Pinned components cannot be dragged or deleted (L)"
          onClick={() => setLocked(!allLocked)}
        >
          {allLocked ? 'Unpin' : 'Pin in place'}
        </button>
      </div>
    </div>
  );
}
