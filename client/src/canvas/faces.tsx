import { useId, type CSSProperties } from 'react';
import type { NodeAttrs } from '@loadbearing/shared';
import { fmtInt, fmtMs, type GaugeModel } from './gauge';

/**
 * What a part shows on its face, drawn two ways from one model.
 *
 * Nothing in here animates through React. Each gauge sets a few CSS variables from
 * the run (how full, how fast) and the stylesheet does the moving, so a canvas of
 * thirty working parts costs the compositor, not the main thread. And nothing moves
 * unless a load run is on: a still part means a still system.
 */

/** Workers pick up work in no particular order, so a grid should not fill left to right. */
const FILL_ORDER = [5, 12, 2, 9, 14, 0, 7, 11, 3, 15, 6, 1, 10, 13, 4, 8];

/** A stable, uneven service time per cell, so the grid does not pulse in lockstep. */
const sweepFor = (i: number) => `${(0.5 + ((i * 37) % 11) / 12).toFixed(2)}s`;

const pct = (v: number) => `${Math.round(v * 100)}%`;

interface FaceProps {
  m: GaugeModel;
  attrs: NodeAttrs;
  /** Offered load across the run, for a source's sparkline. */
  series?: number[];
}

// ======================================================================= Instruments

export function InstrumentGauge({ m, attrs, series }: FaceProps) {
  switch (m.kind) {
    case 'traffic':
      return <TrafficGauge m={m} attrs={attrs} series={series} />;
    case 'workers':
      return <WorkersGauge m={m} />;
    case 'tank':
      return <TankGauge m={m} />;
    case 'ring':
      return <RingGauge m={m} attrs={attrs} />;
    case 'queue':
      return <QueueGauge m={m} />;
    case 'fanout':
      return <FanoutGauge m={m} />;
    case 'latency':
      return <LatencyGauge m={m} />;
    default:
      return <StatusGauge m={m} />;
  }
}

function TrafficGauge({ m, attrs, series }: FaceProps) {
  const rate = m.live ? m.inRps : (attrs.trafficRps ?? null);
  const pts = series && series.length > 1 ? series : null;
  const max = pts ? Math.max(...pts, 1) : 1;
  const line = pts
    ? pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 120).toFixed(1)} ${(40 - (v / max) * 34).toFixed(1)}`).join('')
    : null;
  return (
    <div className="g-traffic">
      <div className="g-big">
        <span className="mono">{rate === null ? '—' : fmtInt(rate)}</span>
        <small>{m.live ? 'requests/s' : rate === null ? 'no traffic set' : 'requests/s at 1×'}</small>
      </div>
      <svg className="g-spark" viewBox="0 0 120 42" preserveAspectRatio="none" aria-hidden="true">
        {line ? (
          <>
            <path className="g-spark-area" d={`${line} L120 42 L0 42 Z`} />
            <path className="g-spark-line" d={line} />
          </>
        ) : (
          <path className="g-spark-rest" d="M0 36 L120 36" />
        )}
      </svg>
    </div>
  );
}

function WorkersGauge({ m }: { m: GaugeModel }) {
  const w = m.workers!;
  const busy = new Set(FILL_ORDER.filter((i) => i < w.cells).slice(0, w.busyCells));
  const cols = Math.min(8, w.cells);
  return (
    <div className="g-workers">
      <div className="g-row">
        <span>workers</span>
        <b className="mono">
          {m.live ? `${fmtInt(w.busy)} / ${fmtInt(w.channels)}` : fmtInt(w.channels)}
          {w.waiting > 0 ? <em> · +{fmtInt(w.waiting)} waiting</em> : null}
        </b>
      </div>
      <div className="g-cells" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: w.cells }, (_, i) => (
          <i key={i} className={busy.has(i) ? 'on' : ''} style={{ ['--d' as string]: sweepFor(i) } as CSSProperties}>
            <b />
          </i>
        ))}
      </div>
      {w.replicasSettled !== w.replicas ? (
        <div className="g-note mono">
          scaled ×{w.replicas} → ×{w.replicasSettled}
        </div>
      ) : null}
    </div>
  );
}

function TankGauge({ m }: { m: GaugeModel }) {
  const t = m.tank!;
  const clip = `cyl-${useId().replace(/:/g, '')}`;
  // Ripple grows with throughput and is flat with none: the surface only moves when work is arriving.
  const amp = m.live ? Math.min(1, m.inRps / 600) : 0;
  return (
    <div className="g-tank">
      <svg className="g-cyl" viewBox="0 0 54 64" aria-hidden="true" style={{ ['--fill' as string]: m.fill, ['--amp' as string]: amp } as CSSProperties}>
        <defs>
          <clipPath id={clip}>
            <path d="M4 10 v44 a23 7 0 0 0 46 0 v-44 a23 7 0 0 1 -46 0z" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect className="g-cyl-bg" width="54" height="64" />
          <g className="g-liquid">
            <g className="g-wave">
              <path d="M0 0 Q 6.75 -3 13.5 0 T 27 0 T 40.5 0 T 54 0 T 67.5 0 T 81 0 T 94.5 0 T 108 0 V 70 H 0 Z" />
            </g>
          </g>
        </g>
        <path className="g-cyl-o" d="M4 10 v44 a23 7 0 0 0 46 0 v-44" />
        <ellipse className="g-cyl-cap" cx="27" cy="10" rx="23" ry="7" />
      </svg>
      <div className="g-side">
        <div className="g-row">
          <span>busy</span>
          <b className="mono">{m.live ? pct(m.utilization) : '—'}</b>
        </div>
        {t.poolSize !== null && (
          <>
            <div className="g-row">
              <span>connections</span>
              <b className="mono">
                {m.live ? fmtInt(t.poolUsed ?? 0) : 0} / {fmtInt(t.poolSize)}
              </b>
            </div>
            <div className="g-ticks">
              {Array.from({ length: 20 }, (_, i) => (
                <i key={i} className={m.live && (t.poolUsed ?? 0) / (t.poolSize ?? 1) > i / 20 ? 'on' : ''} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RingGauge({ m, attrs }: { m: GaugeModel; attrs: NodeAttrs }) {
  const hit = m.ring!.hitRate;
  const C = 2 * Math.PI * 23;
  // Faster with more reads: one turn every few seconds at a trickle, a blur at full load.
  const orbit = m.live && m.inRps > 0 ? Math.max(0.7, Math.min(8, 1800 / m.inRps)) : 0;
  return (
    <div className="g-ring">
      <svg viewBox="0 0 60 60" aria-hidden="true" style={{ ['--orbit' as string]: `${orbit}s` } as CSSProperties}>
        <circle className="g-ring-track" cx="30" cy="30" r="23" />
        <circle className="g-ring-hit" cx="30" cy="30" r="23" strokeDasharray={`${(hit * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 30 30)" />
        {orbit > 0 ? (
          <g className="g-orbit">
            <circle cx="30" cy="7" r="2.6" />
          </g>
        ) : null}
        <text x="30" y="34" className="g-ring-text">
          {pct(hit)}
        </text>
      </svg>
      <div className="g-side">
        <div className="g-row">
          <span>answered here</span>
          <b className="mono">{m.live ? `${fmtInt(m.inRps * hit)}/s` : pct(hit)}</b>
        </div>
        <div className="g-row">
          <span>passed on</span>
          <b className="mono">{m.live ? `${fmtInt(m.inRps * (1 - hit))}/s` : pct(1 - hit)}</b>
        </div>
        <div className="g-row">
          <span>memory</span>
          <b className="mono">{attrs.memoryGb ? `${attrs.memoryGb} GB` : '—'}</b>
        </div>
      </div>
    </div>
  );
}

function QueueGauge({ m }: { m: GaugeModel }) {
  const q = m.queue!;
  // Log scale: a backlog of 50 and one of 50,000 should both be visible, and look different.
  const pile = q.depth > 0 ? Math.min(1, Math.log10(1 + q.depth) / Math.log10(1 + q.depthMax)) : 0;
  const flow = m.live && m.inRps > 0 ? Math.max(0.4, Math.min(4, 900 / m.inRps)) : 0;
  return (
    <div className="g-queue">
      <div className="g-row">
        <span>waiting</span>
        <b className="mono">{m.live ? fmtInt(q.depth) : '—'}</b>
      </div>
      <div className="g-tube" style={{ ['--pile' as string]: pile, ['--flow' as string]: `${flow}s` } as CSSProperties}>
        {flow > 0 ? <span className="g-tube-flow" /> : null}
        <span className="g-tube-pile" />
      </div>
      <div className="g-row">
        <span>drains in</span>
        <b className="mono">{q.drainS === null ? (m.live ? 'keeping up' : '—') : `${q.drainS < 10 ? q.drainS.toFixed(1) : fmtInt(q.drainS)} s`}</b>
      </div>
    </div>
  );
}

function FanoutGauge({ m }: { m: GaugeModel }) {
  const f = m.fanout!;
  const n = Math.max(1, Math.min(6, f.targets || 1));
  const ys = Array.from({ length: n }, (_, i) => (n === 1 ? 28 : 8 + (i * 40) / (n - 1)));
  return (
    <div className="g-fanout">
      <svg viewBox="0 0 96 56" aria-hidden="true" className={m.live && m.inRps > 0 ? 'moving' : ''}>
        <path className="g-fan-in" d="M2 28 H 34" />
        {ys.map((y, i) => (
          <path key={i} className="g-fan-out" d={`M34 28 C 54 28, 54 ${y}, 94 ${y}`} />
        ))}
        <circle className="g-fan-hub" cx="34" cy="28" r="4" />
      </svg>
      <div className="g-side">
        <div className="g-row">
          <span>{f.mode === 'fanOut' ? 'copies to' : 'splits across'}</span>
          <b className="mono">{f.targets || 0}</b>
        </div>
        <div className="g-row">
          <span>each gets</span>
          <b className="mono">
            {m.live && f.targets > 0 ? `${fmtInt(f.mode === 'fanOut' ? m.inRps : m.inRps / f.targets)}/s` : '—'}
          </b>
        </div>
      </div>
    </div>
  );
}

function LatencyGauge({ m }: { m: GaugeModel }) {
  const l = m.latency!;
  return (
    <div className="g-latency">
      <div className="g-row">
        <span>answers in</span>
        <b className="mono">{fmtMs(l.ms)}</b>
      </div>
      <div className="g-lat-track" style={{ ['--near' as string]: l.nearTimeout ?? 0 } as CSSProperties}>
        <span className="g-lat-fill" />
        <span className="g-lat-limit" />
      </div>
      <div className="g-row">
        <span>gives up at</span>
        <b className="mono">{l.timeoutMs === null ? 'no timeout' : fmtMs(l.timeoutMs)}</b>
      </div>
    </div>
  );
}

function StatusGauge({ m }: { m: GaugeModel }) {
  return (
    <div className="g-status">
      <span>{m.live ? 'Runs beside the request path' : 'Not on the request path'}</span>
    </div>
  );
}

// ================================================================== Rack screens

export function RackScreen({ m, attrs, series }: FaceProps) {
  switch (m.kind) {
    case 'traffic': {
      const pts = series && series.length > 1 ? series : null;
      const max = pts ? Math.max(...pts, 1) : 1;
      return (
        <>
          <div className="s-row">
            <span>REQ/S</span>
            <span>{m.live ? 'LIVE' : 'SET'}</span>
          </div>
          <div className="s-big">{m.live ? fmtInt(m.inRps) : attrs.trafficRps ? fmtInt(attrs.trafficRps) : '—'}</div>
          <svg className="s-spark" viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts ? pts.map((v, i) => `${((i / (pts.length - 1)) * 120).toFixed(1)},${(20 - (v / max) * 18).toFixed(1)}`).join(' ') : '0,18 120,18'} />
          </svg>
        </>
      );
    }
    case 'workers': {
      const w = m.workers!;
      const busy = new Set(FILL_ORDER.filter((i) => i < w.cells).slice(0, w.busyCells));
      return (
        <>
          <div className="s-row">
            <span>WORKERS</span>
            <span className="s-v">{w.waiting > 0 ? `+${fmtInt(w.waiting)}` : m.live ? `${fmtInt(w.busy)}/${fmtInt(w.channels)}` : fmtInt(w.channels)}</span>
          </div>
          <div className="s-dots" style={{ gridTemplateColumns: `repeat(${Math.min(8, w.cells)}, 1fr)` }}>
            {Array.from({ length: w.cells }, (_, i) => (
              <i key={i} className={busy.has(i) ? 'on' : ''} />
            ))}
          </div>
          <div className="s-row">
            <span>LAT</span>
            <span className="s-v">{m.live ? fmtMs(m.latencyMs).toUpperCase() : '—'}</span>
          </div>
        </>
      );
    }
    case 'tank': {
      const t = m.tank!;
      const pool = t.poolSize ? (t.poolUsed ?? 0) / t.poolSize : 0;
      return (
        <div className="s-split">
          <div className="s-left">
            <div className="s-row">
              <span>BUSY</span>
            </div>
            <div className="s-big2">{m.live ? pct(m.utilization) : '—'}</div>
            <div className="s-row">
              <span>LAT</span>
              <span className="s-v">{m.live ? fmtMs(m.latencyMs).toUpperCase() : '—'}</span>
            </div>
          </div>
          <div className="s-eq">
            <div>
              <span className="s-col" style={{ ['--v' as string]: m.fill } as CSSProperties}>
                <i />
              </span>
              CPU
            </div>
            <div>
              <span className="s-col" style={{ ['--v' as string]: m.live ? pool : 0 } as CSSProperties}>
                <i />
              </span>
              POOL
            </div>
          </div>
        </div>
      );
    }
    case 'ring': {
      const hit = m.ring!.hitRate;
      return (
        <>
          <div className="s-row">
            <span>HIT RATE</span>
            <span>KV</span>
          </div>
          <div className="s-big2">{(hit * 100).toFixed(1)}%</div>
          <div className="s-hbar" style={{ ['--v' as string]: hit } as CSSProperties}>
            <i />
          </div>
          <div className="s-row">
            <span>MISS</span>
            <span className="s-v">{m.live ? `${fmtInt(m.inRps * (1 - hit))}/S` : '—'}</span>
          </div>
        </>
      );
    }
    case 'queue': {
      const q = m.queue!;
      const pile = q.depth > 0 ? Math.min(1, Math.log10(1 + q.depth) / Math.log10(1 + q.depthMax)) : 0;
      return (
        <>
          <div className="s-row">
            <span>DEPTH</span>
            <span className="s-v">{m.live ? fmtInt(q.depth) : '—'}</span>
          </div>
          <div className="s-hbar tall" style={{ ['--v' as string]: pile } as CSSProperties}>
            <i />
          </div>
          <div className="s-row">
            <span>DRAIN</span>
            <span className="s-v">{q.drainS === null ? (m.live ? 'OK' : '—') : `${q.drainS.toFixed(1)}S`}</span>
          </div>
        </>
      );
    }
    case 'fanout': {
      const f = m.fanout!;
      return (
        <>
          <div className="s-row">
            <span>{f.mode === 'fanOut' ? 'COPIES' : 'SPLIT'}</span>
            <span className="s-v">×{f.targets || 0}</span>
          </div>
          <div className="s-big2">{m.live ? `${fmtInt(m.inRps)}/s` : '—'}</div>
          <div className="s-row">
            <span>EACH</span>
            <span className="s-v">{m.live && f.targets > 0 ? fmtInt(f.mode === 'fanOut' ? m.inRps : m.inRps / f.targets) : '—'}</span>
          </div>
        </>
      );
    }
    case 'latency': {
      const l = m.latency!;
      return (
        <>
          <div className="s-row">
            <span>ANSWERS IN</span>
          </div>
          <div className="s-big2">{fmtMs(l.ms)}</div>
          <div className="s-hbar" style={{ ['--v' as string]: l.nearTimeout ?? 0 } as CSSProperties}>
            <i />
          </div>
          <div className="s-row">
            <span>TIMEOUT</span>
            <span className="s-v">{l.timeoutMs === null ? 'NONE' : fmtMs(l.timeoutMs).toUpperCase()}</span>
          </div>
        </>
      );
    }
    default:
      return (
        <div className="s-row" style={{ height: '100%', alignItems: 'center' }}>
          <span>{m.live ? 'BESIDE THE PATH' : 'STANDBY'}</span>
        </div>
      );
  }
}

/** Three lights: only one is ever on, and it says the same thing the engine said. */
export function RackLeds({ health }: { health: GaugeModel['health'] }) {
  return (
    <div className="r-leds" aria-hidden="true">
      <i className={`g${health === 'pass' ? ' on' : ''}`} />
      <i className={`a${health === 'load' ? ' on' : ''}`} />
      <i className={`r${health === 'fail' ? ' on' : ''}`} />
    </div>
  );
}

// ==================================================================== far away

/**
 * Zoomed out, the detail is unreadable anyway — so the same footprint carries a big
 * name and one big ring instead. The edges do not move; the face just simplifies.
 */
export function FarFace({ m, label }: { m: GaugeModel; label: string }) {
  const C = 2 * Math.PI * 30;
  const v = m.kind === 'ring' ? (m.ring?.hitRate ?? 0) : m.kind === 'queue' ? Math.min(1, (m.queue?.depth ?? 0) / 5000) : m.fill;
  return (
    <div className="far">
      <svg viewBox="0 0 72 72" className="far-ring" aria-hidden="true">
        <circle className="far-track" cx="36" cy="36" r="30" />
        <circle className="far-val" cx="36" cy="36" r="30" strokeDasharray={`${(v * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 36 36)" />
      </svg>
      <div className="far-text">
        <div className="far-name">{label}</div>
        <div className="far-head mono">{m.headline || ' '}</div>
      </div>
    </div>
  );
}
