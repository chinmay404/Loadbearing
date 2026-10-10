import { useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';
import { effectiveHitRate, familyOf, type Flow, type SimFlowResult } from '@loadbearing/shared';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';

/**
 * Requests, as dots travelling each declared flow along the cables actually drawn.
 *
 * Where a cache answers, a dot ends in a small green pop; where a flow is losing
 * traffic, that share of dots falls away in red at the part that dropped them. Both
 * proportions come from the run, so the picture and the numbers cannot disagree.
 *
 * One canvas, one animation loop, and no React work per frame: this reads the flow
 * library's store and the canvas store directly. It only runs while a load run is
 * on, stops with the tab, and draws nothing for anyone who asked for less motion.
 */

type Pt = [number, number];
interface Leg {
  pts: Pt[];
  cum: number[];
  len: number;
}
interface Dot {
  legs: Leg[];
  leg: number;
  d: number;
  speed: number;
  end: 'serve' | 'hit' | 'drop';
}
interface Pop {
  x: number;
  y: number;
  t: number;
}
interface Fall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

const MAX_DOTS = 260;
const SPEED = 230; // flow units per second
const SAMPLES = 40;

function polyline(pts: Pt[]): Leg {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(bx - ax, by - ay));
  }
  return { pts, cum, len: cum[cum.length - 1]! || 1 };
}

function at(leg: Leg, d: number): Pt {
  const { pts, cum } = leg;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < d) i += 1;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const span = cum[i]! - cum[i - 1]! || 1;
  const k = Math.min(1, Math.max(0, (d - cum[i - 1]!) / span));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function FlowParticles() {
  const ref = useRef<HTMLCanvasElement>(null);
  const rf = useStoreApi();
  const running = useCanvas((s) => s.simRunning);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!running || reduce) {
      clear();
      return;
    }

    const host = canvas.parentElement!;
    let dpr = 1;
    const size = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(host.clientWidth * dpr);
      canvas.height = Math.round(host.clientHeight * dpr);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);

    let colors = { dot: '', pass: '', fail: '' };
    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      colors = {
        dot: cs.getPropertyValue('--dot').trim(),
        pass: cs.getPropertyValue('--pass').trim(),
        fail: cs.getPropertyValue('--fail').trim(),
      };
    };
    readColors();
    const themeWatch = new MutationObserver(readColors);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // A cable's drawn curve, sampled once per shape it takes.
    const sampled = new Map<string, { d: string; pts: Pt[] }>();
    const curveOf = (edgeId: string): Pt[] | null => {
      const el = host.querySelector<SVGPathElement>(`path.react-flow__edge-path[id="${CSS.escape(edgeId)}"]`);
      if (!el) return null;
      const d = el.getAttribute('d') ?? '';
      const hit = sampled.get(edgeId);
      if (hit && hit.d === d) return hit.pts;
      const total = el.getTotalLength();
      const pts: Pt[] = [];
      for (let i = 0; i <= SAMPLES; i += 1) {
        const p = el.getPointAtLength((total * i) / SAMPLES);
        pts.push([p.x, p.y]);
      }
      sampled.set(edgeId, { d, pts });
      return pts;
    };
    const centreOf = (id: string): Pt | null => {
      const n = rf.getState().nodeLookup.get(id);
      if (!n) return null;
      const p = n.internals.positionAbsolute;
      return [p.x + (n.measured.width ?? 0) / 2, p.y + (n.measured.height ?? 0) / 2];
    };
    const legBetween = (a: string, b: string): Leg | null => {
      const edges = useCanvas.getState().edges;
      const fwd = edges.find((e) => e.source === a && e.target === b);
      const pts = fwd ? curveOf(fwd.id) : null;
      if (pts && pts.length > 1) return polyline(pts);
      // Called by an earlier step rather than the one before it (API → cache → database).
      const ca = centreOf(a);
      const cb = centreOf(b);
      return ca && cb ? polyline([ca, cb]) : null;
    };

    /**
     * The last step a request can reach, by the engine's rule: each step must be called,
     * along a connection pointing the right way, by a step already passed. A dot never
     * crosses a gap or runs a wire backwards, because no request can.
     */
    const reachOf = (steps: string[]): number => {
      const edges = useCanvas.getState().edges;
      for (let i = 1; i < steps.length; i += 1) {
        const earlier = new Set(steps.slice(0, i));
        if (!edges.some((e) => e.target === steps[i] && earlier.has(e.source))) return i - 1;
      }
      return steps.length - 1;
    };

    /** Where a dot on this flow ends, decided as it leaves so the proportions hold. */
    const plan = (flow: Flow, result: SimFlowResult | undefined): Dot | null => {
      const steps = flow.steps;
      // No result means no claim about this flow; drawing it as served would be one.
      if (steps.length < 2 || !result) return null;
      const nodes = useCanvas.getState().nodes;
      const reach = reachOf(steps);
      let stop = steps.length - 1;
      let end: Dot['end'] = 'serve';

      // A read can be answered early by a cache on the way.
      if (flow.kind === 'read') {
        for (let i = 1; i < steps.length - 1; i += 1) {
          const n = nodes.find((x) => x.id === steps[i]);
          const data = n?.data as ArchNodeData | undefined;
          if (!data?.archType || familyOf(data.archType) !== 'cache') continue;
          const hitRate = effectiveHitRate({ id: n!.id, type: data.archType, label: '', annotation: '', attrs: data.attrs });
          if (Math.random() < hitRate) {
            stop = i;
            end = 'hit';
          }
          break;
        }
      }
      // And some share never gets served, lost where the run says it was lost.
      if (end === 'serve' && result.offeredRps > 0) {
        const loss = Math.max(0, 1 - result.completedRps / result.offeredRps);
        if (Math.random() < loss) {
          // Lost at the part the run names — the very first step included.
          const at = result.brokenAt ? steps.indexOf(result.brokenAt) : -1;
          stop = at >= 0 ? at : reach;
          end = 'drop';
        }
      }
      if (stop > reach) {
        stop = reach;
        end = 'drop';
      }

      const legs: Leg[] = [];
      for (let i = 0; i < stop; i += 1) {
        const leg = legBetween(steps[i]!, steps[i + 1]!);
        if (!leg) return null;
        legs.push(leg);
      }
      // Turned away where it started: a zero-length leg, so it falls on the spot.
      if (legs.length === 0) {
        const c = centreOf(steps[0]!);
        if (!c) return null;
        legs.push(polyline([c, c]));
      }
      return { legs, leg: 0, d: 0, speed: SPEED * (0.88 + Math.random() * 0.24), end };
    };

    const dots: Dot[] = [];
    const pops: Pop[] = [];
    const falls: Fall[] = [];
    const owed = new Map<string, number>();
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { flows, simResult } = useCanvas.getState();
      const [tx, ty, zoom] = rf.getState().transform;

      // Spawn in proportion to each flow's offered load, within a fixed budget.
      for (const flow of flows) {
        const result = simResult?.flows.find((f) => f.flowId === flow.id);
        if (result && !result.measured) continue;
        const rate = Math.max(1.5, Math.min(26, (result?.offeredRps ?? flow.rps ?? 50) / 40));
        let due = (owed.get(flow.id) ?? 0) + rate * dt;
        while (due >= 1 && dots.length < MAX_DOTS) {
          due -= 1;
          const dot = plan(flow, result);
          if (dot) dots.push(dot);
        }
        owed.set(flow.id, Math.min(due, 3));
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      const r = Math.max(1.8, 2.7 * Math.sqrt(zoom));
      const toScreen = ([x, y]: Pt): Pt => [x * zoom + tx, y * zoom + ty];

      ctx.fillStyle = colors.dot;
      ctx.globalAlpha = 0.85;
      for (let i = dots.length - 1; i >= 0; i -= 1) {
        const dot = dots[i]!;
        dot.d += dot.speed * dt;
        let leg = dot.legs[dot.leg]!;
        while (dot.d >= leg.len) {
          dot.d -= leg.len;
          dot.leg += 1;
          if (dot.leg >= dot.legs.length) break;
          leg = dot.legs[dot.leg]!;
        }
        if (dot.leg >= dot.legs.length) {
          const lastLeg = dot.legs[dot.legs.length - 1]!;
          const [ex, ey] = toScreen(lastLeg.pts[lastLeg.pts.length - 1]!);
          if (dot.end === 'hit') pops.push({ x: ex, y: ey, t: 0 });
          else if (dot.end === 'drop') falls.push({ x: ex, y: ey, vx: (Math.random() - 0.5) * 70, vy: -50 - Math.random() * 50, t: 0 });
          dots.splice(i, 1);
          continue;
        }
        const [x, y] = toScreen(at(leg, dot.d));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = colors.pass;
      ctx.lineWidth = 1.5;
      for (let i = pops.length - 1; i >= 0; i -= 1) {
        const p = pops[i]!;
        p.t += dt / 0.34;
        if (p.t >= 1) {
          pops.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = (1 - p.t) * 0.75;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + p.t * 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = colors.fail;
      for (let i = falls.length - 1; i >= 0; i -= 1) {
        const f = falls[i]!;
        f.t += dt;
        f.vy += 900 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.t > 0.8) {
          falls.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, 1 - f.t / 0.8);
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeWatch.disconnect();
      clear();
    };
  }, [running, rf]);

  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
