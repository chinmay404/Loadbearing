import { memo, useCallback, useEffect, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import type { EdgeGeometry, EdgeKind } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';

const STROKE: Record<EdgeKind, { stroke: string; dash?: string; width: number }> = {
  sync: { stroke: '#9c968b', width: 1.8 },
  async: { stroke: '#7ba75f', dash: '6 4', width: 1.8 },
  replication: { stroke: '#b07ca8', dash: '2 4', width: 1.6 },
};

type Point = { x: number; y: number };

/** Rounded corner radius where a routed line turns. */
const CORNER = 10;
/** Below this, two points are on the same line and no elbow is needed. */
const ALIGNED = 4;

/**
 * Right-angle routing through a set of points.
 *
 * The first version drew straight diagonals between bends, which threw away the
 * orthogonal look the rest of the diagram has — one bend and a carefully aligned
 * design turned into a slanted line. A connector should keep its right angles: for
 * each leg, travel along one axis and then the other, and let the elbow fall where
 * those meet.
 */
function orthogonalRoute(points: Point[]): Point[] {
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const from = out[out.length - 1]!;
    const to = points[i]!;
    const sameRow = Math.abs(from.y - to.y) < ALIGNED;
    const sameColumn = Math.abs(from.x - to.x) < ALIGNED;
    if (!sameRow && !sameColumn) {
      // Lead with the longer axis: it reads as "along, then across" rather than a
      // stub followed by a long run.
      const elbow =
        Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
          ? { x: to.x, y: from.y }
          : { x: from.x, y: to.y };
      out.push(elbow);
    }
    out.push(to);
  }
  return out;
}

/** Straight segments with the corners rounded off. */
function roundedPath(points: Point[]): string {
  if (points.length < 2) return '';
  const first = points[0]!;
  let d = `M ${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    const r = Math.min(CORNER, inLen / 2, outLen / 2);
    const enter = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
    const exit = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
    d += ` L ${enter.x},${enter.y} Q ${p.x},${p.y} ${exit.x},${exit.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x},${last.y}`;
}

function pathThrough(route: Point[], shape: NonNullable<EdgeGeometry['shape']>): string {
  if (route.length < 2) return '';

  if (shape === 'straight') {
    const [first, ...rest] = route as [Point, ...Point[]];
    return `M ${first.x},${first.y} ${rest.map((p) => `L ${p.x},${p.y}`).join(' ')}`;
  }

  if (shape === 'curved') {
    const first = route[0]!;
    let d = `M ${first.x},${first.y}`;
    for (let i = 1; i < route.length - 1; i += 1) {
      const p = route[i]!;
      const next = route[i + 1]!;
      d += ` Q ${p.x},${p.y} ${(p.x + next.x) / 2},${(p.y + next.y) / 2}`;
    }
    const last = route[route.length - 1]!;
    return `${d} L ${last.x},${last.y}`;
  }

  const orthogonal = orthogonalRoute(route);
  if (shape === 'step') {
    const [first, ...rest] = orthogonal as [Point, ...Point[]];
    return `M ${first.x},${first.y} ${rest.map((p) => `L ${p.x},${p.y}`).join(' ')}`;
  }
  return roundedPath(orthogonal);
}

function ArchEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const geometry = (data ?? {}) as EdgeGeometry & { kind?: EdgeKind };
  const kind = (geometry.kind ?? 'sync') as EdgeKind;
  const shape = geometry.shape ?? 'smooth';
  const bends = geometry.points ?? [];
  const s = STROKE[kind];

  const { screenToFlowPosition } = useReactFlow();
  const moveBend = useCanvas((st) => st.moveEdgeBend);
  const addBend = useCanvas((st) => st.addEdgeBend);
  const removeBend = useCanvas((st) => st.removeEdgeBend);

  /**
   * The index being dragged lives in a ref, not state. React state does not update
   * until the next render, so the first pointermove after pointerdown arrived
   * before the handler knew a drag had started — which is why nothing moved.
   */
  const draggingRef = useRef<number | null>(null);

  // Listeners go on the window for the duration of the drag: the pointer leaves
  // the 10px handle immediately, and a handler bound to the handle stops firing.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const index = draggingRef.current;
      if (index === null) return;
      e.preventDefault();
      moveBend(id, index, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [id, moveBend, screenToFlowPosition]);

  const startDrag = useCallback((index: number) => {
    draggingRef.current = index;
  }, []);

  let path: string;
  let labelX: number;
  let labelY: number;

  if (bends.length > 0) {
    const route: Point[] = [{ x: sourceX, y: sourceY }, ...bends, { x: targetX, y: targetY }];
    path = pathThrough(route, shape);
    const middle = bends[Math.floor((bends.length - 1) / 2)]!;
    labelX = middle.x;
    labelY = middle.y;
  } else {
    const args = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
    const [d, lx, ly] =
      shape === 'straight'
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : shape === 'curved'
          ? getBezierPath(args)
          : getSmoothStepPath({ ...args, borderRadius: shape === 'step' ? 0 : 12 });
    path = d;
    labelX = lx;
    labelY = ly;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#cfa349' : s.stroke,
          strokeWidth: selected ? s.width + 0.7 : s.width,
          ...(s.dash ? { strokeDasharray: s.dash } : {}),
          ...style,
        }}
      />

      {/* Handles only while the connection is selected, so the sheet is not covered
          in dots. Double-click removes a bend; the dashed dot creates one. */}
      {selected && (
        <EdgeLabelRenderer>
          {bends.map((p, i) => (
            <div
              key={i}
              className="edge-bend"
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
              title="Drag to reshape · double-click to remove"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startDrag(i);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeBend(id, i);
              }}
            />
          ))}
          <div
            className="edge-bend add"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title="Drag to bend the line here"
            onPointerDown={(e) => {
              // One gesture: the bend is created and immediately under the pointer,
              // so pressing and dragging bends the line rather than requiring a
              // second grab of a dot that has just appeared.
              e.stopPropagation();
              e.preventDefault();
              const index = addBend(id, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              startDrag(index);
            }}
          />
        </EdgeLabelRenderer>
      )}

      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (selected ? 18 : 0)}px)`,
              background: '#121110',
              border: '1px solid #322e29',
              borderRadius: 5,
              padding: '1px 5px',
              fontSize: 10,
              color: '#a09a90',
              pointerEvents: 'none',
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ArchEdge = memo(ArchEdgeInner);
