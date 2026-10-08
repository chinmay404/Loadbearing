import {
  concurrencyFor,
  distributionOf,
  effectiveHitRate,
  familyOf,
  type ArchNodeType,
  type Family,
  type NodeAttrs,
  type NodeState,
  type SimNodeResult,
} from '@loadbearing/shared';

/**
 * What a part shows on its face, and nothing it cannot back up.
 *
 * Every number here is one the engine computed for this run, or follows from one by
 * the formula written next to it. A gauge that invents a figure to look busy is a
 * gauge nobody should trust, and this whole product rests on trusting the numbers.
 *
 * Both skins (Instruments, Rack) draw from this model, so the arithmetic lives once.
 */

export type GaugeKind = 'traffic' | 'workers' | 'tank' | 'ring' | 'queue' | 'fanout' | 'latency' | 'status';

/** One gauge per family: 109 component types, eight drawings. */
export const GAUGE_OF: Record<Family, GaugeKind> = {
  origin: 'traffic',
  compute: 'workers',
  ai: 'workers',
  datastore: 'tank',
  cache: 'ring',
  messaging: 'queue',
  routing: 'fanout',
  external: 'latency',
  control: 'status',
  boundary: 'status',
};

/** idle: no run yet. down: killed by the chaos controls. */
export type Health = 'idle' | 'pass' | 'load' | 'fail' | 'down';

/** The engine already decides how a part is doing; the gauge only translates it into colour. */
export function healthOf(state: NodeState | undefined, killed: boolean): Health {
  if (killed || state === 'down') return 'down';
  switch (state) {
    case 'ok':
      return 'pass';
    case 'warn':
    case 'hot':
      return 'load';
    case 'saturated':
      return 'fail';
    default:
      return 'idle';
  }
}

/** Most cells a worker grid draws. Past this, one cell stands for several workers. */
export const MAX_CELLS = 16;

export interface GaugeModel {
  kind: GaugeKind;
  health: Health;
  /** Has a run produced numbers for this part? */
  live: boolean;
  inRps: number;
  /** Arriving ÷ capacity. Unbounded: 1.5 means half again what it can serve. */
  utilization: number;
  /** Utilisation clamped to 0..1, for anything drawn as a fill. */
  fill: number;
  latencyMs: number | null;
  droppedRps: number;
  /** Share of what arrived that was not served, 0..1. */
  shed: number;
  unlimited: boolean;
  elastic: boolean;
  hostLimited: boolean;

  workers?: {
    /** Parallel channels: concurrency per replica × replicas. */
    channels: number;
    /** Channels busy right now: min(ρ, 1) × channels (Little's law, busy servers = ρc). */
    busy: number;
    /** Requests queued past a full house: the engine's queue depth. */
    waiting: number;
    cells: number;
    busyCells: number;
    replicas: number;
    replicasSettled: number;
  };
  tank?: {
    /** Connection ceiling (maxConnections, else poolSize), when one is stated. */
    poolSize: number | null;
    /** Connections in use ≈ queries in flight = min(ρ,1) × channels, capped by the pool. */
    poolUsed: number | null;
  };
  ring?: {
    /** The hit rate the engine used: stated or default, capped by memory coverage. */
    hitRate: number;
  };
  queue?: {
    depth: number;
    depthMax: number;
    /** How long the backlog takes to drain at the consumers' rate, s. */
    drainS: number | null;
  };
  fanout?: {
    targets: number;
    /** 'distribute' splits traffic across targets; 'fanOut' copies it to each. */
    mode: 'distribute' | 'fanOut';
  };
  latency?: {
    ms: number | null;
    timeoutMs: number | null;
    /** latency ÷ timeout, 0..1 — how close the wait is to being given up on. */
    nearTimeout: number | null;
  };
  /** One-line headline for the zoomed-out face. */
  headline: string;
}

export interface GaugeInput {
  type: ArchNodeType;
  attrs?: NodeAttrs;
  sim?: SimNodeResult;
  killed: boolean;
  /** Outgoing connections, for a router's fan-out. */
  outDegree: number;
  /** The run's peak backlog for this part, if it is a buffer. */
  peakBacklog?: number;
}

const DEFAULT_QUEUE_DEPTH_MAX = 100_000;
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const finite = (n: number | undefined, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

export function gaugeModel(input: GaugeInput): GaugeModel {
  const { type, attrs = {}, sim, killed, outDegree } = input;
  const family = familyOf(type);
  const kind = GAUGE_OF[family];
  const health = healthOf(sim?.state, killed);
  const live = !!sim && !killed;

  const inRps = live ? finite(sim.incomingRps) : 0;
  const utilization = live && !sim.unlimited && !sim.elastic ? Math.max(0, finite(sim.utilization)) : 0;
  const fill = Math.min(1, utilization);
  const latencyMs = live && Number.isFinite(sim.latencyMs) ? sim.latencyMs : null;
  const droppedRps = live ? finite(sim.droppedRps) : 0;
  const shed = inRps > 0 ? Math.min(1, droppedRps / inRps) : 0;

  const node = { id: '', type, label: '', annotation: '', attrs };
  const model: GaugeModel = {
    kind,
    health,
    live,
    inRps,
    utilization,
    fill,
    latencyMs,
    droppedRps,
    shed,
    unlimited: !!sim?.unlimited,
    elastic: !!sim?.elastic,
    hostLimited: !!sim?.hostLimited,
    headline: '',
  };

  const replicas = live ? Math.max(1, sim.replicas) : Math.max(1, finite(attrs.replicas, 1));
  const channels = Math.max(1, Math.round(finite(attrs.concurrency, concurrencyFor(node)) * replicas));
  const inFlight = fill * channels;

  switch (kind) {
    case 'workers': {
      const cells = Math.min(MAX_CELLS, channels);
      model.workers = {
        channels,
        busy: Math.round(inFlight),
        waiting: live ? Math.round(finite(sim.queueDepth)) : 0,
        cells,
        busyCells: Math.min(cells, Math.round(fill * cells)),
        replicas,
        replicasSettled: live ? Math.max(1, sim.replicasSettled) : replicas,
      };
      break;
    }
    case 'tank': {
      const ceiling = attrs.maxConnections ?? attrs.poolSize;
      const poolSize = typeof ceiling === 'number' && ceiling > 0 ? ceiling : null;
      model.tank = {
        poolSize,
        poolUsed: poolSize === null ? null : Math.min(poolSize, Math.round(inFlight)),
      };
      break;
    }
    case 'ring':
      model.ring = { hitRate: effectiveHitRate(node) };
      break;
    case 'queue': {
      const depth = live ? Math.max(finite(input.peakBacklog), finite(sim.queueDepth)) : 0;
      const drainRate = live ? finite(sim.capacityRps) : 0;
      model.queue = {
        depth,
        depthMax: finite(attrs.queueDepthMax, DEFAULT_QUEUE_DEPTH_MAX),
        drainS: depth > 0 && drainRate > 0 ? depth / drainRate : null,
      };
      break;
    }
    case 'fanout':
      model.fanout = { targets: outDegree, mode: distributionOf(type) };
      break;
    case 'latency': {
      const timeoutMs = typeof attrs.timeoutMs === 'number' && attrs.timeoutMs > 0 ? attrs.timeoutMs : null;
      model.latency = {
        ms: latencyMs,
        timeoutMs,
        nearTimeout: latencyMs !== null && timeoutMs !== null ? Math.min(1, latencyMs / timeoutMs) : null,
      };
      break;
    }
    default:
      break;
  }

  model.headline = headlineOf(model);
  return model;
}

function headlineOf(m: GaugeModel): string {
  if (m.health === 'down') return 'down';
  if (!m.live) return '';
  switch (m.kind) {
    case 'traffic':
      return `${fmtInt(m.inRps)}/s`;
    case 'ring':
      return `${Math.round((m.ring?.hitRate ?? 0) * 100)}% hits`;
    case 'queue':
      return `${fmtInt(m.queue?.depth ?? 0)} waiting`;
    case 'fanout':
    case 'status':
      return `${fmtInt(m.inRps)}/s`;
    default:
      if (m.elastic) return `${fmtInt(m.inRps)}/s`;
      return m.shed > 0 ? `sheds ${Math.round(m.shed * 100)}%` : `${Math.round(m.utilization * 100)}%`;
  }
}

/** Milliseconds people can read: 80000ms tells nobody anything. */
export function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

export { fmtInt };

/** What the status light means right now, in words — shown when you hover it. */
export interface StatusNote {
  title: string;
  body: string;
  /** What is setting the ceiling, when it is not the part's own speed. */
  limit?: string;
}

export function statusNote(m: GaugeModel, sim: SimNodeResult | undefined, attrs: NodeAttrs = {}): StatusNote {
  if (m.health === 'down') return { title: 'Killed', body: 'Switched off for this run. Revive it from the scenario bar.' };
  if (!m.live || !sim) return { title: 'Not running', body: 'Press Run load to send traffic through it.' };
  if (m.elastic) return { title: 'Healthy', body: `Carrying ${fmtInt(m.inRps)} rps on the provider’s capacity, so it has no ceiling of its own.` };
  if (m.unlimited) return { title: 'Healthy', body: `Carrying ${fmtInt(m.inRps)} rps. Nothing about this part limits traffic.` };

  const cap = finite(sim.capacityRps, Number.POSITIVE_INFINITY);
  const capText = Number.isFinite(cap) ? fmtInt(cap) : '∞';
  const pct = Math.round(m.utilization * 100);
  const load = `${fmtInt(m.inRps)} of ${capText} rps it can serve`;

  let limit: string | undefined;
  if (m.hostLimited) limit = 'The machine pool it shares with its neighbours is full.';
  else {
    const ceiling = attrs.maxConnections ?? attrs.poolSize;
    const own = finite(attrs.capacityRps, Number.POSITIVE_INFINITY) * Math.max(1, sim.replicas);
    if (typeof ceiling === 'number' && ceiling > 0 && cap < own - 1) {
      limit = `Its ceiling is the ${fmtInt(ceiling)} connections it holds open, not its speed.`;
    }
  }
  const out = (title: string, body: string): StatusNote => (limit ? { title, body, limit } : { title, body });

  if (m.droppedRps > 0) {
    return out('Overloaded', `Turning away ${fmtInt(m.droppedRps)} of ${fmtInt(m.inRps)} rps — it can serve ${capText}.`);
  }
  if (m.health === 'fail') return out('At its limit', `${load} — 100%. Any more traffic will be turned away.`);
  if (m.health === 'load') return out('Busy', `${pct}% used: ${load}. Past 70% requests start waiting in line.`);
  return out('Healthy', `${pct}% used: ${load}.`);
}
