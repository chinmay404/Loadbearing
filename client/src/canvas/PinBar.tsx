import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

/**
 * The way out of pinning, always visible while anything is pinned.
 *
 * The badge on each pinned component was the only release, and it is drawn inside
 * the canvas transform — so at any distance it shrinks to a couple of pixels and
 * effectively disappears. An escape hatch that is hard to find is not an escape
 * hatch. This sits outside the transform, at a fixed size, and says how many
 * components are affected.
 */
export function PinBar() {
  const nodes = useCanvas((s) => s.nodes);
  const unlockAll = useCanvas((s) => s.unlockAll);
  const setNotice = useApp((s) => s.setNotice);

  const pinned = nodes.filter((n) => n.draggable === false).length;
  if (pinned === 0) return null;

  return (
    <div
      className="card"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 14,
        padding: '5px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
      }}
    >
      <span style={{ fontSize: 11.5 }}>
        {pinned} pinned <span className="stencil">· not selectable</span>
      </span>
      <button
        onClick={() => {
          const n = unlockAll();
          setNotice(`Released ${n} pinned component${n === 1 ? '' : 's'}.`);
        }}
        title="Release everything (Shift+L)"
      >
        Unpin all
      </button>
    </div>
  );
}
