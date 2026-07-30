import { useEffect, useRef, useState } from 'react';
import { useNodes, useViewport, type Node } from '@xyflow/react';
import { useCanvas } from '../state/canvasStore';

const KIND_COLOR: Record<string, string> = {
  read: '#cfa349',
  write: '#c9703f',
  async: '#7ba75f',
  admin: '#e2913c',
};

/**
 * Animated request particles travelling each declared flow. Speed and density
 * track the simulated load, so overload is something you SEE before you read it.
 */
export function FlowParticles() {
  const { x, y, zoom } = useViewport();
  const nodes = useNodes();
  const flows = useCanvas((s) => s.flows);
  const sim = useCanvas((s) => s.simResult);
  const running = useCanvas((s) => s.simRunning);
  const [t, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 60);
      last = now;
      setT((prev) => prev + dt / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running]);

  if (!running || flows.length === 0) return null;

  const center = (id: string): [number, number] | null => {
    const n = nodes.find((nd: Node) => nd.id === id);
    if (!n) return null;
    const w = Number(n.measured?.width ?? n.width ?? 160);
    const h = Number(n.measured?.height ?? n.height ?? 60);
    return [n.position.x + w / 2, n.position.y + h / 2];
  };

  return (
    <svg className="pen-layer" style={{ pointerEvents: 'none', zIndex: 4 }}>
      <g transform={`translate(${x},${y}) scale(${zoom})`}>
        {flows.map((flow) => {
          const pts = flow.steps.map(center).filter((p): p is [number, number] => p !== null);
          if (pts.length < 2) return null;
          const fr = sim?.flows.find((f) => f.flowId === flow.id);
          const broken = fr?.broken ?? false;
          const health = fr && fr.offeredRps > 0 ? fr.completedRps / fr.offeredRps : 1;
          const color = broken ? '#d9534b' : KIND_COLOR[flow.kind] ?? '#cfa349';
          const count = Math.max(2, Math.min(9, Math.round(3 + health * 5)));
          const speed = broken ? 0.25 : 0.35 + health * 0.35;

          const segLen = pts.slice(1).map(([px, py], i) => {
            const prev = pts[i]!;
            return Math.hypot(px - prev[0], py - prev[1]);
          });
          const total = segLen.reduce((a, b) => a + b, 0) || 1;

          const at = (frac: number): [number, number] => {
            let d = frac * total;
            for (let i = 0; i < segLen.length; i += 1) {
              const len = segLen[i]!;
              if (d <= len) {
                const a = pts[i]!;
                const b = pts[i + 1]!;
                const k = len === 0 ? 0 : d / len;
                return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
              }
              d -= len;
            }
            return pts[pts.length - 1]!;
          };

          const path = pts
            .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`)
            .join(' ');

          return (
            <g key={flow.id}>
              <path d={path} stroke={color} strokeWidth={1.2 / zoom} opacity={0.22} fill="none" />
              {Array.from({ length: count }, (_, i) => {
                const raw = (t * speed + i / count) % 1;
                const frac = broken ? Math.min(raw, 0.55) : raw;
                const [cx, cy] = at(frac);
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={3.2 / zoom}
                    fill={color}
                    opacity={broken && raw > 0.55 ? 0.12 : 0.9}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
