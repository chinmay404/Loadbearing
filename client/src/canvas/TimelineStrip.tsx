import { useMemo, useState } from 'react';
import type { SimTimeline } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';

/**
 * The run, second by second.
 *
 * Every other number on this instrument is the worst moment: how bad it got. This is
 * what happened. A design that sheds for four seconds and recovers and one that sheds
 * for ninety produce identical worst-case numbers, and they are not remotely the same
 * design — the difference is only visible over time.
 *
 * Two things it makes plain that a snapshot cannot. An autoscaling group that reaches
 * its ceiling ninety seconds after it was needed: the gap between the offered line and
 * the served one closes slowly, and you can see how long the users were the ones
 * paying for it. And the moment something breaks, marked at the component that broke
 * first, which is rarely the component that looks broken.
 */
export function TimelineStrip({ timeline }: { timeline: SimTimeline }) {
  const nodes = useCanvas((s) => s.nodes);
  const focusNode = useCanvas((s) => s.focusNode);
  const [hover, setHover] = useState<number | null>(null);

  const label = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    const data = node?.data as { label?: string } | undefined;
    return data?.label ?? id;
  };

  const { points, horizonS } = timeline;

  const geometry = useMemo(() => {
    // The vertical scale is set by the offered load, not the served load: the whole
    // point is to see the gap, and a chart rescaled to what got through would hide it.
    const peak = Math.max(1, ...points.map((p) => p.offeredRps));
    const peakLatency = Math.max(1, ...points.map((p) => p.p99Ms));
    const x = (t: number) => (t / Math.max(1, horizonS - 1)) * W;
    const y = (rps: number) => H - (rps / peak) * H;
    const yLat = (ms: number) => LAT_H - (ms / peakLatency) * LAT_H;

    const area = (pick: (p: (typeof points)[number]) => number): string => {
      if (points.length === 0) return '';
      const top = points.map((p) => `${x(p.t).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(' L ');
      return `M 0 ${H} L ${top} L ${W} ${H} Z`;
    };

    return {
      peak,
      peakLatency,
      x,
      offered: area((p) => p.offeredRps),
      completed: area((p) => p.completedRps),
      latency: points.length
        ? `M ${points.map((p) => `${x(p.t).toFixed(1)} ${yLat(p.p99Ms).toFixed(1)}`).join(' L ')}`
        : '',
    };
  }, [points, horizonS]);

  if (points.length === 0) return null;

  const at = hover === null ? null : points[Math.min(points.length - 1, Math.max(0, hover))];
  const first = timeline.firstFailure;

  return (
    <div className="timeline">
      <div className="row timeline-head">
        <span className="stencil">the run · {horizonS}s</span>
        {first && (
          <button
            className="chip fail"
            onClick={() => focusNode(first.nodeId)}
            title={`${first.reason} — click to find it on the sheet`}
          >
            first to break: {label(first.nodeId)} at {first.atS}s
          </button>
        )}
        {timeline.recoveredAtS !== null && (
          <span className="chip pass">back inside the budget at {timeline.recoveredAtS}s</span>
        )}
        <span className="grow" />
        {at && (
          <span className="stencil timeline-readout">
            {at.t}s · {Math.round(at.completedRps)} of {Math.round(at.offeredRps)} rps ·{' '}
            p99 {Math.round(at.p99Ms)}ms
            {at.hottestNodeId ? ` · hottest ${label(at.hottestNodeId)}` : ''}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H + LAT_H + GAP}`}
        preserveAspectRatio="none"
        className="timeline-chart"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientX - box.left) / box.width;
          setHover(Math.round(fraction * (horizonS - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* Offered behind, served in front: the visible gap IS the loss. */}
        <path d={geometry.offered} className="tl-offered" />
        <path d={geometry.completed} className="tl-served" />

        {timeline.breaches.map((b, i) => (
          <rect
            key={i}
            x={geometry.x(b.fromS)}
            y={0}
            width={Math.max(1, geometry.x(b.toS) - geometry.x(b.fromS))}
            height={H}
            className="tl-breach"
          />
        ))}

        {/* One mark per component that lost traffic, at the second it started. */}
        {timeline.failures.map((f) => (
          <g key={`${f.nodeId}-${f.atS}`} className="tl-failure">
            <line x1={geometry.x(f.atS)} y1={0} x2={geometry.x(f.atS)} y2={H} />
            <circle cx={geometry.x(f.atS)} cy={4} r={2.5} />
          </g>
        ))}

        {hover !== null && (
          <line x1={geometry.x(hover)} y1={0} x2={geometry.x(hover)} y2={H} className="tl-cursor" />
        )}

        {/* p99 on its own scale underneath: it moves in the opposite direction from
            throughput and sharing an axis with it would flatten both. */}
        <g transform={`translate(0, ${H + GAP})`}>
          <path d={geometry.latency} className="tl-latency" />
        </g>
      </svg>

      <div className="row timeline-foot">
        <span className="stencil">
          offered peaks at {Math.round(geometry.peak)} rps · p99 peaks at{' '}
          {Math.round(geometry.peakLatency)}ms
        </span>
        <span className="grow" />
        {timeline.failures.length > 1 && (
          <span className="stencil">
            {timeline.failures.length} components lost traffic:{' '}
            {timeline.failures.slice(0, 4).map((f) => label(f.nodeId)).join(', ')}
            {timeline.failures.length > 4 ? '…' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/** Chart units. Rendered with preserveAspectRatio=none, so these are proportions. */
const W = 600;
const H = 46;
const LAT_H = 16;
const GAP = 4;
