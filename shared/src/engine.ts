// The load engine: what happens to this design when traffic arrives.
//
// WHAT THIS IS HONEST ABOUT
//
// The mechanisms here are the ones that decide real outcomes: capacity as
// concurrency over service time, queue wait rising with utilisation, retries
// amplifying load on a struggling dependency, timeouts failing calls that are
// merely slow, shedding at the edge, backlog building and draining over time, and
// autoscaling arriving late. Get those right and the engine will tell you WHERE a
// design breaks, IN WHAT ORDER, and WHETHER it recovers — and will rank two
// designs correctly.
//
// It cannot predict your production numbers. The inputs are estimates, and a box
// diagram does not contain your N+1 queries, your GC pauses or your lock
// contention. Every result therefore carries its assumptions, and the caller is
// expected to show them.
//
// PROPERTIES
//
//   * pure — no clock, no randomness, no mutation of the inputs.
//   * deterministic — identical (graph, scenario) always gives an identical result,
//     including the order of every string in it. Retry jitter is modelled by its
//     expected value rather than sampled, precisely so this stays true.
//   * bounded — every loop has a ceiling, so a cyclic graph terminates.

import {
  DEFAULT_CACHE_HIT_RATE,
  DEFAULT_CAPACITY,
  DEFAULT_LATENCY,
  CACHE_TYPES,
  SHEDDING_TYPES,
  WARN_UTILIZATION,
} from './components.js';
import { distributionOf, familyOf, PASSIVE_FAMILIES, type Family } from './families.js';
import type {
  ArchNodeType,
  GraphDSL,
  GraphEdge,
  GraphNode,
  NodeState,
} from './types.js';

// ------------------------------------------------------------------ inputs ---

/** How offered load moves over the run. */
export type TrafficShape = 'steady' | 'ramp' | 'spike' | 'burst';

export interface TrafficPattern {
  shape: TrafficShape;
  /** Requests per second before any multiplier. */
  baseRps: number;
  /** Multiple of the baseline at the top of a ramp, spike or burst. */
  peakMultiple?: number;
  /** When the event begins, seconds into the run. */
  startS?: number;
  /** How long the event lasts, seconds. Omitted means "to the end". */
  durationS?: number;
  /** Burst only: seconds between bursts. */
  periodS?: number;
}

/** A component taken away, for a while or for good. */
export interface Outage {
  nodeId: string;
  atS: number;
  /** Omitted means it never comes back. */
  forS?: number;
}

/** Extra latency somewhere, as a brownout rather than a death. */
export interface LatencyInjection {
  /** A specific component, or every component of a family. */
  nodeId?: string;
  family?: Family;
  addMs: number;
  atS?: number;
  forS?: number;
}

/** A parameter changed mid-run — what a cache-busting attack really does. */
export interface ParamOverride {
  nodeId: string;
  /** Cache hit rate, 0..1. Setting it to 0 is a stampede. */
  hitRate?: number;
  /** Multiply this component's capacity. 0.1 models a hot partition. */
  capacityMultiple?: number;
  /** Multiply its service time. Slow reads without extra requests. */
  latencyMultiple?: number;
  atS?: number;
  forS?: number;
}

export interface Slo {
  p99Ms?: number;
  /** Fraction of offered requests that must complete, 0..1. */
  successRate?: number;
}

export interface Scenario {
  id: string;
  name: string;
  /** What this run is supposed to prove or disprove. */
  hypothesis?: string;
  /** Seconds to simulate. */
  horizonS: number;
  /** Multiplies every source, on top of its pattern. This is the slider. */
  loadMultiplier: number;
  /** Per-source pattern, by node id. Sources without one run steady at baseline. */
  patterns?: Record<string, TrafficPattern>;
  outages?: Outage[];
  latency?: LatencyInjection[];
  overrides?: ParamOverride[];
  slo?: Slo;
}

export const DEFAULT_HORIZON_S = 120;
export const TICK_S = 1;

export function steadyScenario(loadMultiplier = 1): Scenario {
  return {
    id: 'steady',
    name: 'Steady load',
    horizonS: DEFAULT_HORIZON_S,
    loadMultiplier,
  };
}

// ----------------------------------------------------------------- outputs ---

export interface HopState {
  nodeId: string;
  /** Attempts per second arriving, retries included. */
  arrivingRps: number;
  /** What it accepted after any shedding of its own. */
  admittedRps: number;
  servedRps: number;
  droppedRps: number;
  capacityRps: number;
  utilization: number;
  /** Service time plus queue wait, ms. */
  latencyMs: number;
  /** Messaging only: how far behind its consumers it is. */
  backlog: number;
  replicas: number;
  state: NodeState;
  /** Dead, but transparent: traffic passes through untouched. */
  bypassed: boolean;
  down: boolean;
}

export interface TickState {
  t: number;
  offeredRps: number;
  completedRps: number;
  lostRps: number;
  p50Ms: number;
  p99Ms: number;
  /** Completed over offered, 0..1. */
  successRate: number;
  /** Worst-utilised component this second. */
  hottestNodeId: string | null;
}

export interface PathReport {
  nodeIds: string[];
  /** True when a hand-off ends the caller's wait part-way along. */
  hasAsyncBoundary: boolean;
}

export interface Failure {
  nodeId: string;
  atS: number;
  reason: string;
}

export interface EngineResult {
  scenarioId: string;
  sources: { nodeId: string; rps: number }[];
  sinkIds: string[];
  ticks: TickState[];
  /** Per component, at the worst moment of the run. */
  worst: HopState[];
  /** Per component, at the end — what it settles at. */
  final: HopState[];
  paths: PathReport[];
  pathsOmitted: number;
  /** The first thing to lose traffic, which is rarely the thing that looks broken. */
  firstFailure: Failure | null;
  /** Every component that lost traffic at any point, upstream-most first. */
  failures: Failure[];
  bottleneckNodeId: string | null;
  /** Seconds spent outside the SLO, and what breached. */
  sloBreaches: { metric: 'p99' | 'successRate'; fromS: number; toS: number }[];
  /** When the run came back inside the SLO, null if it never did. */
  recoveredAtS: number | null;
  peakOfferedRps: number;
  /** Retries as a share of all attempts at the worst moment, 0..n. */
  retryAmplification: number;
  cycleNodeIds: string[];
  findings: string[];
  assumptions: string[];
}

// --------------------------------------------------------------- constants ---

/** Concurrent in-flight requests one replica handles, by family. */
const DEFAULT_CONCURRENCY: Record<Family, number> = {
  origin: 1,
  routing: 4_000,
  compute: 64,
  datastore: 200,
  cache: 1_000,
  messaging: 500,
  external: 32,
  ai: 8,
  control: 1_000,
  boundary: 1,
};

/** How long a caller waits before giving up, by the callee's family. */
const DEFAULT_TIMEOUT_MS: Record<Family, number> = {
  origin: 30_000,
  routing: 5_000,
  compute: 2_000,
  datastore: 1_000,
  cache: 200,
  messaging: 1_000,
  external: 10_000,
  ai: 60_000,
  control: 1_000,
  boundary: 1_000,
};

/**
 * Retries a caller makes when a dependency fails it — zero unless the connection
 * says otherwise.
 *
 * Real clients do retry, and that is exactly why storms happen, so the temptation
 * is to default this to two or three. Two reasons not to. A retry policy is a
 * design decision, and inventing one puts load on the drawing that nobody drew;
 * and amplification applied everywhere by default makes every number in a report
 * un-checkable by hand, which is how a model loses the reader's trust. So the
 * engine amplifies only where a retry was stated, and the findings point out a
 * synchronous call that never said.
 */
const DEFAULT_RETRIES = 0;

/** Backlog a buffer holds before it starts refusing, in messages. */
export const DEFAULT_QUEUE_DEPTH = 100_000;
/** Utilisation at which a component is warned about. */

export const HOT_UTILIZATION = 0.9;
/** Queue wait is clamped here: past this the number stops meaning anything. */
const MAX_WAIT_MULTIPLE = 20;
/** Rounds of relaxation per tick. Factors only shrink, so this converges fast. */
const RELAX_ROUNDS = 8;
/** Ceiling on enumerated paths, so a dense graph cannot explode the report. */
const MAX_PATHS = 60;
const MAX_PATH_DEPTH = 24;
const EPSILON = 1e-9;
/** Seconds for an autoscaler to add capacity — why a spike hurts before it helps. */
export const AUTOSCALE_LAG_S = 60;

// ----------------------------------------------------------------- helpers ---

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const round = (v: number, dp = 2): number => {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** A window that may be open forever. */
const activeAt = (t: number, atS = 0, forS?: number): boolean =>
  t >= atS && (forS === undefined || t < atS + forS);

const num = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** Replication carries data between stores; it is not a request path. */
const carriesRequests = (e: GraphEdge): boolean => e.kind !== 'replication';

function stateFor(utilization: number, dropping: boolean): NodeState {
  if (dropping || utilization >= 1) return 'saturated';
  if (utilization >= HOT_UTILIZATION) return 'hot';
  if (utilization >= WARN_UTILIZATION) return 'warn';
  return 'ok';
}

/**
 * Service time at zero load. `latencyMs` on a component is its own work; queue wait
 * is added later and is a consequence, not a setting.
 */
function serviceMsOf(node: GraphNode): number {
  return num(node.attrs?.latencyMs, DEFAULT_LATENCY[node.type] ?? 20);
}

/**
 * In-flight requests one replica holds when nobody has said.
 *
 * Derived from the catalogue rather than guessed per family, so that a component
 * nobody has configured has exactly the capacity the catalogue always gave it —
 * and the moment its service time changes, capacity moves the way Little's law
 * says it must. A service listed at 500 rps with a 50ms service time is holding 25
 * requests at once; that is the same statement twice.
 */
function defaultConcurrency(node: GraphNode): number {
  const capacity = DEFAULT_CAPACITY[node.type];
  const latency = DEFAULT_LATENCY[node.type];
  if (Number.isFinite(capacity) && capacity > 0 && latency > 0) {
    return Math.max(1, (capacity * latency) / 1000);
  }
  return DEFAULT_CONCURRENCY[familyOf(node.type)];
}

/**
 * What one replica can serve per second.
 *
 * Concurrency over service time — Little's law — is how a service actually
 * saturates: 64 workers each held for 50ms is 1280 rps, and the same service
 * behind a dependency that slowed to 500ms is 128 rps without one other thing
 * changing. That relationship is the whole point, so nothing clamps it: an earlier
 * version capped the result at the catalogue's number for the type, which quietly
 * threw the mechanism away and made every configured component report the
 * catalogue default. An explicit `capacityRps` still overrides it, for anyone who
 * would rather state the number outright.
 */
function perReplicaCapacity(node: GraphNode, serviceMs: number): number {
  const explicit = node.attrs?.capacityRps;
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  if (serviceMs <= 0) return DEFAULT_CAPACITY[node.type] ?? 500;
  const concurrency = num(node.attrs?.concurrency, defaultConcurrency(node));
  return concurrency / (serviceMs / 1000);
}

function replicasOf(node: GraphNode): number {
  const r = node.attrs?.replicas;
  return typeof r === 'number' && r > 0 ? Math.floor(r) : 1;
}

function absorbOf(node: GraphNode): number {
  const explicit = node.attrs?.cacheHitRate;
  if (typeof explicit === 'number') return clamp01(explicit);
  return CACHE_TYPES.has(node.type) ? DEFAULT_CACHE_HIT_RATE : 0;
}

/** Queue wait as utilisation approaches one. M/M/1 in shape, clamped. */
function waitMultiple(utilization: number): number {
  if (!(utilization < 1)) return MAX_WAIT_MULTIPLE;
  const u = Math.min(Math.max(utilization, 0), 0.98);
  return Math.min(1 / (1 - u), MAX_WAIT_MULTIPLE);
}

/**
 * Attempts sent for each request when a fraction of calls fail.
 *
 * A caller that retries twice against a dependency failing half its calls sends
 * 1 + 0.5 + 0.25 attempts — the geometric sum, truncated at the retry limit. This
 * is the mechanism behind every retry storm: the dependency gets worse, so the
 * failure fraction rises, so the multiplier rises, so the dependency gets worse.
 */
function retryMultiplier(failFraction: number, retries: number): number {
  const f = clamp01(failFraction);
  if (retries <= 0 || f <= 0) return 1;
  let total = 1;
  let term = 1;
  for (let i = 0; i < retries; i += 1) {
    term *= f;
    total += term;
  }
  return total;
}

// ------------------------------------------------------------------ set-up ---

interface Prepared {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  inbound: Map<string, GraphEdge[]>;
  sources: { node: GraphNode; baseRps: number }[];
  sinkIds: string[];
  cycleNodeIds: string[];
  paths: PathReport[];
  pathsOmitted: number;
}

/**
 * Sources are where traffic begins: a component marked as one, or a component that
 * can originate traffic and has nothing pointing into it. A drawing with no source
 * is not a system under load, and the engine says so rather than inventing one.
 *
 * Emission falls back to the rps on any authored flow starting here, so designs
 * drawn before sources existed still simulate sensibly.
 */
function findSources(graph: GraphDSL, inbound: Map<string, GraphEdge[]>): Prepared['sources'] {
  const flowRpsByFirstStep = new Map<string, number>();
  for (const flow of graph.flows ?? []) {
    const first = flow.steps[0];
    if (!first) continue;
    flowRpsByFirstStep.set(first, (flowRpsByFirstStep.get(first) ?? 0) + num(flow.rps, 0));
  }

  const out: Prepared['sources'] = [];
  for (const node of graph.nodes) {
    const family = familyOf(node.type);
    const explicit = node.attrs?.trafficRps;
    const marked = typeof explicit === 'number' && explicit > 0;
    const canOriginate = family === 'origin' && (inbound.get(node.id)?.length ?? 0) === 0;
    if (!marked && !canOriginate) continue;
    const baseRps = marked
      ? explicit
      : (flowRpsByFirstStep.get(node.id) ?? DEFAULT_SOURCE_RPS);
    out.push({ node, baseRps });
  }
  return out;
}

/** What a source emits when nobody has said. Enough to be interesting, not absurd. */
export const DEFAULT_SOURCE_RPS = 100;

function prepare(graph: GraphDSL): Prepared {
  const nodes = graph.nodes.filter((n) => familyOf(n.type) !== 'boundary');
  const live = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const out = new Map<string, GraphEdge[]>();
  const inbound = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!carriesRequests(e) || !live.has(e.from) || !live.has(e.to) || e.from === e.to) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inbound.get(e.to) ?? inbound.set(e.to, []).get(e.to)!).push(e);
  }

  const sources = findSources({ ...graph, nodes }, inbound);
  const sinkIds = nodes
    .filter((n) => (out.get(n.id)?.length ?? 0) === 0 && (inbound.get(n.id)?.length ?? 0) > 0)
    .map((n) => n.id);

  // Paths are enumerated once: the structure does not change during a run. The
  // per-path visited set is what makes a cyclic graph terminate, and any cycle it
  // trips over is reported rather than silently walked around.
  const paths: PathReport[] = [];
  const cycles = new Set<string>();
  let omitted = 0;

  const walk = (nodeId: string, trail: string[], seen: Set<string>, async: boolean): void => {
    const outs = out.get(nodeId) ?? [];
    if (outs.length === 0 || trail.length >= MAX_PATH_DEPTH) {
      if (paths.length < MAX_PATHS) paths.push({ nodeIds: [...trail], hasAsyncBoundary: async });
      else omitted += 1;
      return;
    }
    for (const e of outs) {
      if (seen.has(e.to)) {
        cycles.add(e.to);
        if (paths.length < MAX_PATHS) paths.push({ nodeIds: [...trail], hasAsyncBoundary: async });
        else omitted += 1;
        continue;
      }
      seen.add(e.to);
      walk(e.to, [...trail, e.to], seen, async || e.kind === 'async');
      seen.delete(e.to);
    }
  };

  for (const { node } of sources) walk(node.id, [node.id], new Set([node.id]), false);

  return {
    nodes,
    byId,
    out,
    inbound,
    sources,
    sinkIds,
    cycleNodeIds: [...cycles].sort(),
    paths,
    pathsOmitted: omitted,
  };
}

// ------------------------------------------------------------------ per tick --

/** Offered load at one source at time t, before the global multiplier. */
export function rateAt(pattern: TrafficPattern, t: number): number {
  const base = Math.max(0, pattern.baseRps);
  const peak = Math.max(1, pattern.peakMultiple ?? 1);
  const start = pattern.startS ?? 0;
  const duration = pattern.durationS;

  switch (pattern.shape) {
    case 'steady':
      return base;
    case 'ramp': {
      if (t <= start) return base;
      const span = duration ?? 1;
      const progress = span <= 0 ? 1 : Math.min(1, (t - start) / span);
      return base * (1 + (peak - 1) * progress);
    }
    case 'spike':
      return activeAt(t, start, duration) ? base * peak : base;
    case 'burst': {
      const period = Math.max(1, pattern.periodS ?? 20);
      const on = Math.max(1, duration ?? Math.floor(period / 4));
      if (t < start) return base;
      return (t - start) % period < on ? base * peak : base;
    }
    default:
      return base;
  }
}

interface NodeRuntime {
  node: GraphNode;
  family: Family;
  serviceMs: number;
  perReplica: number;
  replicas: number;
  capacity: number;
  absorb: number;
  down: boolean;
  bypassed: boolean;
  /** Set by a shedding component: attempts above this are refused cheaply. */
  shedLimit: number;
  arriving: number;
  admitted: number;
  served: number;
  dropped: number;
  utilization: number;
  latencyMs: number;
  backlog: number;
  failFraction: number;
}

/**
 * A killed component that traffic can flow straight through, rather than one that
 * stops it. A dead cache-aside cache does not break reads — it dumps their full
 * weight on whatever is behind it, which is the interesting failure. A dead
 * database has no such story.
 */
function isTransparentWhenDown(type: ArchNodeType): boolean {
  const family = familyOf(type);
  return family === 'cache' || family === 'control';
}

export function runEngine(graph: GraphDSL, scenario: Scenario): EngineResult {
  const prep = prepare(graph);
  const horizon = Math.max(1, Math.floor(scenario.horizonS || DEFAULT_HORIZON_S));
  const multiplier = Math.max(0, scenario.loadMultiplier ?? 1);

  // Backlog and replica count are the only things that survive between ticks —
  // they are what makes a spike hurt after it has passed.
  const backlog = new Map<string, number>();
  const scaledReplicas = new Map<string, number>();
  for (const n of prep.nodes) scaledReplicas.set(n.id, replicasOf(n));

  const ticks: TickState[] = [];
  const failures = new Map<string, Failure>();
  let worstTick: { score: number; states: HopState[] } | null = null;
  let finalStates: HopState[] = [];
  let peakOffered = 0;
  let peakRetry = 1;

  for (let t = 0; t < horizon; t += TICK_S) {
    const runtime = new Map<string, NodeRuntime>();

    for (const node of prep.nodes) {
      const family = familyOf(node.type);
      const down = (scenario.outages ?? []).some(
        (o) => o.nodeId === node.id && activeAt(t, o.atS, o.forS),
      );

      let serviceMs = serviceMsOf(node);
      for (const inj of scenario.latency ?? []) {
        const hits = inj.nodeId ? inj.nodeId === node.id : inj.family === family;
        if (hits && activeAt(t, inj.atS, inj.forS)) serviceMs += Math.max(0, inj.addMs);
      }
      // A third-party brownout lands on everything you call but do not run.
      let capacityMultiple = 1;
      let absorb = absorbOf(node);
      for (const ov of scenario.overrides ?? []) {
        if (ov.nodeId !== node.id || !activeAt(t, ov.atS, ov.forS)) continue;
        if (typeof ov.hitRate === 'number') absorb = clamp01(ov.hitRate);
        if (typeof ov.capacityMultiple === 'number') capacityMultiple *= Math.max(0, ov.capacityMultiple);
        if (typeof ov.latencyMultiple === 'number') serviceMs *= Math.max(0, ov.latencyMultiple);
      }

      const perReplica = perReplicaCapacity(node, serviceMs) * capacityMultiple;
      const replicas = scaledReplicas.get(node.id) ?? 1;
      const passive = PASSIVE_FAMILIES.has(family);
      const capacity = passive
        ? Number.POSITIVE_INFINITY
        : Math.max(0, perReplica * replicas);

      runtime.set(node.id, {
        node,
        family,
        serviceMs,
        perReplica,
        replicas,
        capacity: down && !isTransparentWhenDown(node.type) ? 0 : capacity,
        absorb: down ? 0 : absorb,
        down,
        bypassed: down && isTransparentWhenDown(node.type),
        shedLimit: SHEDDING_TYPES.has(node.type)
          ? num(node.attrs?.capacityRps, DEFAULT_CAPACITY[node.type] ?? 0) * replicas
          : Number.POSITIVE_INFINITY,
        arriving: 0,
        admitted: 0,
        served: 0,
        dropped: 0,
        utilization: 0,
        latencyMs: serviceMs,
        backlog: backlog.get(node.id) ?? 0,
        failFraction: 0,
      });
    }

    // Offered load this second, per source.
    const offeredBySource = new Map<string, number>();
    let offeredTotal = 0;
    for (const { node, baseRps } of prep.sources) {
      const pattern = scenario.patterns?.[node.id] ?? { shape: 'steady' as const, baseRps };
      const rate = rateAt({ ...pattern, baseRps: pattern.baseRps ?? baseRps }, t) * multiplier;
      offeredBySource.set(node.id, rate);
      offeredTotal += rate;
    }
    peakOffered = Math.max(peakOffered, offeredTotal);

    // Relaxation. Arrivals depend on upstream throughput, and retries depend on
    // downstream failure, so the two are solved together. Failure fractions only
    // rise as load rises, which is why a handful of rounds settles it.
    // Counted while flow is pushed, because that is the only place the difference
    // between "a request" and "an attempt" exists. An earlier version divided two
    // totals that are equal by construction and always reported no amplification.
    let firstAttempts = 0;
    let retriedAttempts = 0;

    for (let round = 0; round < RELAX_ROUNDS; round += 1) {
      for (const r of runtime.values()) r.arriving = 0;
      firstAttempts = 0;
      retriedAttempts = 0;
      for (const [id, rate] of offeredBySource) {
        const r = runtime.get(id);
        if (r) r.arriving += rate;
      }

      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        const outs = prep.out.get(node.id) ?? [];
        if (outs.length === 0) continue;

        const forwarded = r.served * (1 - r.absorb);
        if (forwarded <= EPSILON) continue;

        const mode = distributionOf(node.type);
        const shares = outs.map((e) => num(e.share, mode === 'distribute' ? 1 / outs.length : 1));
        const shareTotal = shares.reduce((a, b) => a + b, 0) || 1;

        outs.forEach((e, i) => {
          const target = runtime.get(e.to);
          if (!target) return;
          // A router hands each request to one downstream; a service calls each of
          // its dependencies once per request.
          const fraction =
            mode === 'distribute' ? shares[i]! / shareTotal : Math.min(1, shares[i]!);
          const attempts = forwarded * fraction;
          const multiplier = retryMultiplier(target.failFraction, num(e.retries, DEFAULT_RETRIES));
          target.arriving += attempts * multiplier;
          firstAttempts += attempts;
          retriedAttempts += attempts * multiplier;
        });
      }

      // Serve what arrived, shed the rest, and remember how badly each failed so
      // the next round's retry multiplier is right.
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        r.admitted = Math.min(r.arriving, r.shedLimit);
        const shedAtEdge = r.arriving - r.admitted;

        if (r.family === 'messaging') {
          // A buffer accepts what it is given and falls behind rather than
          // refusing, until its depth runs out.
          const drain = r.capacity;
          const overflow = Math.max(0, r.admitted - drain);
          const depthMax = num(r.node.attrs?.queueDepthMax, DEFAULT_QUEUE_DEPTH);
          const projected = r.backlog + overflow * TICK_S;
          r.served = projected > depthMax ? drain : r.admitted;
          r.dropped = shedAtEdge + Math.max(0, r.admitted - r.served);
        } else {
          r.served = Math.min(r.admitted, r.capacity);
          r.dropped = shedAtEdge + Math.max(0, r.admitted - r.served);
        }

        r.utilization = r.capacity > 0 && Number.isFinite(r.capacity) ? r.arriving / r.capacity : 0;
        r.failFraction = r.arriving > EPSILON ? clamp01(r.dropped / r.arriving) : 0;
      }
    }

    // Latency, once throughput has settled. Timeouts turn "slow" into "failed":
    // a hop past its caller's patience is a failure even at low utilisation.
    for (const node of prep.nodes) {
      const r = runtime.get(node.id)!;
      r.latencyMs = r.bypassed ? 0 : r.serviceMs * waitMultiple(r.utilization);
      const timeout = num(r.node.attrs?.timeoutMs, DEFAULT_TIMEOUT_MS[r.family]);
      if (r.latencyMs > timeout && r.served > 0) {
        r.dropped += r.served;
        r.served = 0;
        r.failFraction = 1;
      }
    }

    // Backlog carries into the next second, and drains when the rush is over.
    for (const node of prep.nodes) {
      const r = runtime.get(node.id)!;
      if (r.family !== 'messaging') continue;
      const next = Math.max(0, r.backlog + (r.admitted - r.served - Math.max(0, r.capacity - r.admitted)) * TICK_S);
      backlog.set(node.id, next);
      r.backlog = next;
    }

    // Autoscaling, arriving late on purpose: capacity a minute after it was needed
    // is why a spike hurts before it helps.
    if (t > 0 && t % AUTOSCALE_LAG_S === 0) {
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        const ceiling = node.attrs?.autoscaleMax;
        if (typeof ceiling !== 'number' || ceiling <= 0 || r.perReplica <= 0) continue;
        const wanted = Math.ceil(r.arriving / r.perReplica);
        scaledReplicas.set(node.id, Math.max(replicasOf(node), Math.min(ceiling, wanted)));
      }
    }

    // What actually completed: the product of every hop's survival along a path.
    let completed = 0;
    let p50Weighted = 0;
    let p99Weighted = 0;
    for (const path of prep.paths) {
      const sourceId = path.nodeIds[0]!;
      let carried = offeredBySource.get(sourceId) ?? 0;
      if (carried <= EPSILON) continue;
      let latency = 0;
      let tail = 0;
      for (const id of path.nodeIds) {
        const r = runtime.get(id);
        if (!r) continue;
        const survival = r.arriving > EPSILON ? r.served / r.arriving : 1;
        carried *= survival;
        latency += r.latencyMs;
        // The tail is where a saturated hop shows up: a queue at 95% has a p99
        // far above its average, and the path inherits it.
        tail += r.latencyMs * (1 + 2 * Math.min(1, r.utilization));
      }
      completed += carried;
      p50Weighted += latency * carried;
      p99Weighted += tail * carried;
    }
    const successRate = offeredTotal > EPSILON ? clamp01(completed / offeredTotal) : 1;
    const p50 = completed > EPSILON ? p50Weighted / completed : 0;
    const p99 = completed > EPSILON ? p99Weighted / completed : 0;

    // Attempts over requests: how much of the load is the system talking to itself.
    if (firstAttempts > EPSILON) peakRetry = Math.max(peakRetry, retriedAttempts / firstAttempts);

    const states: HopState[] = prep.nodes.map((node) => {
      const r = runtime.get(node.id)!;
      return {
        nodeId: node.id,
        arrivingRps: round(r.arriving),
        admittedRps: round(r.admitted),
        servedRps: round(r.served),
        droppedRps: round(r.dropped),
        capacityRps: Number.isFinite(r.capacity) ? round(r.capacity) : Number.POSITIVE_INFINITY,
        utilization: round(r.utilization, 3),
        latencyMs: round(r.latencyMs),
        backlog: Math.round(r.backlog),
        replicas: r.replicas,
        state: stateFor(r.utilization, r.dropped > EPSILON),
        bypassed: r.bypassed,
        down: r.down,
      };
    });

    // Whoever loses traffic first, in path order from the sources, is the cause.
    // The component people notice is usually further downstream.
    for (const path of prep.paths) {
      for (const id of path.nodeIds) {
        const r = runtime.get(id);
        if (!r || r.dropped <= EPSILON || failures.has(id)) continue;
        failures.set(id, { nodeId: id, atS: t, reason: reasonFor(r) });
        break;
      }
    }

    const hottest = states
      .filter((s) => Number.isFinite(s.capacityRps))
      .reduce<HopState | null>((worst, s) => (!worst || s.utilization > worst.utilization ? s : worst), null);

    ticks.push({
      t,
      offeredRps: round(offeredTotal),
      completedRps: round(completed),
      lostRps: round(Math.max(0, offeredTotal - completed)),
      p50Ms: round(p50),
      p99Ms: round(p99),
      successRate: round(successRate, 4),
      hottestNodeId: hottest?.nodeId ?? null,
    });

    // "Worst" is the second with the most traffic on the floor, ties going to the
    // slower one — that is the moment worth showing.
    const score = (1 - successRate) * 1_000_000 + p99;
    if (!worstTick || score > worstTick.score) worstTick = { score, states };
    finalStates = states;
  }

  const failureList = [...failures.values()].sort((a, b) => a.atS - b.atS || a.nodeId.localeCompare(b.nodeId));
  const worstStates = worstTick?.states ?? finalStates;
  const bottleneck = worstStates
    .filter((s) => Number.isFinite(s.capacityRps))
    .reduce<HopState | null>((w, s) => (!w || s.utilization > w.utilization ? s : w), null);

  return {
    scenarioId: scenario.id,
    sources: prep.sources.map((s) => ({ nodeId: s.node.id, rps: s.baseRps })),
    sinkIds: prep.sinkIds,
    ticks,
    worst: worstStates,
    final: finalStates,
    paths: prep.paths,
    pathsOmitted: prep.pathsOmitted,
    firstFailure: failureList[0] ?? null,
    failures: failureList,
    bottleneckNodeId: bottleneck && bottleneck.utilization > 0 ? bottleneck.nodeId : null,
    ...breaches(ticks, scenario.slo),
    peakOfferedRps: round(peakOffered),
    retryAmplification: round(peakRetry, 3),
    cycleNodeIds: prep.cycleNodeIds,
    findings: [],
    assumptions: assumptionsFor(prep, scenario),
  };
}

function reasonFor(r: NodeRuntime): string {
  if (r.down && !r.bypassed) return `${r.node.label} is offline, and nothing else serves its traffic.`;
  if (r.arriving > r.shedLimit) return `${r.node.label} is shedding above its ${Math.round(r.shedLimit)} rps limit.`;
  if (r.latencyMs > num(r.node.attrs?.timeoutMs, DEFAULT_TIMEOUT_MS[r.family])) {
    return `${r.node.label} answers in ${Math.round(r.latencyMs)}ms, past the ${Math.round(num(r.node.attrs?.timeoutMs, DEFAULT_TIMEOUT_MS[r.family]))}ms its caller waits.`;
  }
  if (r.family === 'messaging') {
    return `${r.node.label} is ${Math.round(r.backlog)} messages behind — consumers drain ${Math.round(r.capacity)} rps of ${Math.round(r.arriving)} arriving.`;
  }
  return `${r.node.label} is offered ${Math.round(r.arriving)} rps and can serve ${Math.round(r.capacity)}.`;
}

function breaches(
  ticks: TickState[],
  slo: Slo | undefined,
): Pick<EngineResult, 'sloBreaches' | 'recoveredAtS'> {
  if (!slo || (slo.p99Ms === undefined && slo.successRate === undefined)) {
    return { sloBreaches: [], recoveredAtS: null };
  }
  const out: EngineResult['sloBreaches'] = [];
  for (const metric of ['p99', 'successRate'] as const) {
    const limit = metric === 'p99' ? slo.p99Ms : slo.successRate;
    if (limit === undefined) continue;
    let from: number | null = null;
    for (const tick of ticks) {
      const bad = metric === 'p99' ? tick.p99Ms > limit : tick.successRate < limit;
      if (bad && from === null) from = tick.t;
      if (!bad && from !== null) {
        out.push({ metric, fromS: from, toS: tick.t });
        from = null;
      }
    }
    if (from !== null) out.push({ metric, fromS: from, toS: ticks[ticks.length - 1]?.t ?? from });
  }
  // Recovery is the first second after the last breach where everything is inside
  // the SLO again — and nothing if the run ended still breaching.
  const lastEnd = out.reduce((m, b) => Math.max(m, b.toS), -1);
  const stillBad = out.some((b) => b.toS === (ticks[ticks.length - 1]?.t ?? 0));
  return { sloBreaches: out, recoveredAtS: lastEnd >= 0 && !stillBad ? lastEnd : null };
}

function assumptionsFor(prep: Prepared, scenario: Scenario): string[] {
  const out: string[] = [
    'Capacity is concurrency divided by service time unless a component states its own rps.',
    'Queue wait grows as utilisation approaches one; a component past its caller’s timeout fails rather than merely being slow.',
    'A router sends each request to one downstream; a service calls every dependency once per request.',
  ];
  if (prep.sources.length === 0) out.push('No source is marked, so nothing was offered — mark where traffic starts.');
  if (prep.pathsOmitted > 0) {
    out.push(`${prep.pathsOmitted} paths beyond the first ${MAX_PATHS} were not enumerated; per-component numbers still count all traffic.`);
  }
  if (prep.cycleNodeIds.length > 0) {
    out.push(`A cycle was walked once and not followed round: ${prep.cycleNodeIds.join(', ')}.`);
  }
  if ((scenario.outages ?? []).length === 0) out.push('Nothing was taken offline in this run.');
  return out;
}
