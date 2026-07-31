import { memo, useCallback, useState } from 'react';
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

/**
 * A line through explicit bend points.
 *
 * The built-in routers take a source and a target and decide the rest, which is
 * fine until two connections overlap or one runs through a box it has nothing to
 * do with. Once there are bends the path is ours to draw: straight segments,
 * rounded corners, or a curve through them.
 */
function pathThrough(points: Point[], shape: NonNullable<EdgeGeometry['shape']>): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points as [Point, ...Point[]];

  if (shape === 'straight' || shape === 'step') {
    return `M ${first.x},${first.y} ${rest.map((p) => `L ${p.x},${p.y}`).join(' ')}`;
  }

  if (shape === 'curved') {
    // Quadratic through each bend, with the joins at segment midpoints so the
    // curve stays smooth rather than kinking at every point.
    let d = `M ${first.x},${first.y}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i]!;
      const next = points[i + 1]!;
      d += ` Q ${p.x},${p.y} ${(p.x + next.x) / 2},${(p.y + next.y) / 2}`;
    }
    const last = points[points.length - 1]!;
    return `${d} L ${last.x},${last.y}`;
  }

  // smooth: straight runs with the corners rounded off.
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
  const [dragging, setDragging] = useState<number | null>(null);

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

  const onHandleDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(index);
    },
    [],
  );

  const onHandleMove = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      if (dragging !== index) return;
      e.stopPropagation();
      moveBend(id, index, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [dragging, id, moveBend, screenToFlowPosition],
  );

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

      {/* Bend handles only while the connection is selected, so the canvas is not
          covered in dots. Double-click removes one; the midpoint dot adds one. */}
      {selected && (
        <EdgeLabelRenderer>
          {bends.map((p, i) => (
            <div
              key={i}
              className="edge-bend"
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
              title="Drag to reshape · double-click to remove"
              onPointerDown={onHandleDown(i)}
              onPointerMove={onHandleMove(i)}
              onPointerUp={() => setDragging(null)}
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
            title="Add a bend here, then drag it"
            onPointerDown={(e) => {
              e.stopPropagation();
              addBend(id, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
          />
        </EdgeLabelRenderer>
      )}

      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (selected ? 16 : 0)}px)`,
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
