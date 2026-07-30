import { useRef, useState } from 'react';
import { useViewport } from '@xyflow/react';
import { useCanvas } from '../state/canvasStore';

/**
 * Freehand overlay. Strokes are stored in flow (canvas) coordinates so they pan
 * and zoom with the diagram; they are visual only and never sent to the grader.
 */
export function PenLayer() {
  const { x, y, zoom } = useViewport();
  const tool = useCanvas((s) => s.tool);
  const strokes = useCanvas((s) => s.strokes);
  const addStroke = useCanvas((s) => s.addStroke);
  const eraseStrokeAt = useCanvas((s) => s.eraseStrokeAt);
  const penColor = useCanvas((s) => s.penColor);
  const [current, setCurrent] = useState<[number, number][]>([]);
  const drawing = useRef(false);
  const ref = useRef<SVGSVGElement>(null);

  const active = tool === 'pen' || tool === 'eraser';

  const toFlow = (e: React.PointerEvent): [number, number] => {
    const rect = ref.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    return [(px - x) / zoom, (py - y) / zoom];
  };

  const onDown = (e: React.PointerEvent) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = toFlow(e);
    if (tool === 'eraser') eraseStrokeAt(p[0], p[1], 14 / zoom);
    else setCurrent([p]);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!active || !drawing.current) return;
    const p = toFlow(e);
    if (tool === 'eraser') eraseStrokeAt(p[0], p[1], 14 / zoom);
    else setCurrent((c) => (c.length === 0 ? [p] : [...c, p]));
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === 'pen' && current.length > 1) addStroke({ points: current, color: penColor });
    setCurrent([]);
  };

  const toPath = (pts: [number, number][]) =>
    pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');

  return (
    <svg
      ref={ref}
      className="pen-layer"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <g transform={`translate(${x},${y}) scale(${zoom})`}>
        {strokes.map((s, i) => (
          <path
            key={i}
            d={toPath(s.points)}
            stroke={s.color}
            strokeWidth={2 / zoom}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        ))}
        {current.length > 1 && (
          <path
            d={toPath(current)}
            stroke={penColor}
            strokeWidth={2 / zoom}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </g>
    </svg>
  );
}
