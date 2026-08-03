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
  canSubstitute,
} from './components.js';
import { distributionOf, familyOf, PASSIVE_FAMILIES, type Family } from './families.js';
import {
  MAX_WAIT_MULTIPLE,
  responseMultiple,
  waitP99Ms,
  TAIL_MULTIPLE_IDLE,
} from './queueing.js';
import { inferPlacement, rttMs } from './network.js';
import { admit, shareOut, slotsNeeded } from './pools.js';
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
  /** Squeezed by the pool it shares rather than by a limit of its own. */
  hostLimited: boolean;
  /** Runs on a provider's capacity, so it has no utilisation to report. */
  elastic: boolean;
  /**
   * Parallel service channels: concurrency x replicas x shards. What queueing is
   * computed against, and not the same as the replica count — one replica of a
   * 64-worker service is a 64-channel queue, which is why it barely queues at all
   * until it is nearly full.
   */
  servers: number;
  /**
   * How long one request holds a worker: this component's own service time plus
   * the wire and the response of everything it synchronously calls. Capacity is
   * concurrency divided by this, which is why a slow dependency costs its caller
   * throughput the caller never used.
   */
  occupancyMs: number;
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
  sources: { nodeId: string; rps: number; inferred: boolean }[];
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
  /**
   * How far behind each buffer ever got, by node id. A queue's headline number is
   * its peak, not its depth at one arbitrary instant: a buffer that never refuses
   * anything drops nothing, so the moment with the most traffic on the floor is not
   * the moment it was most behind.
   */
  peakBacklog: Record<string, number>;
  /** Retries as a share of all attempts at the worst moment, 0..n. */
  retryAmplification: number;
  cycleNodeIds: string[];
  /** Which shared pool each component runs on, by node id. Empty when nothing shares. */
  hostedBy: Record<string, string>;
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
/** Rounds of relaxation per tick. Factors only shrink, so this converges fast. */
const RELAX_ROUNDS = 8;
/** Headroom on top of the worst congestion the model will report. */
const TIMEOUT_HEADROOM = 1.1;
/**
 * In-flight requests one vCPU sustains. Higher than one because a request spends most
 * of its life waiting on something else rather than burning CPU — which is also why a
 * dependency getting slower costs a service throughput it never used.
 */
export const CONCURRENT_REQUESTS_PER_VCPU = 8;
/**
 * Queueing lives in `queueing.ts` now, but these two are re-exported because
 * `simulate.ts` and the tests have always imported them from here, and the shape
 * of the module boundary is not worth a breaking rename.
 */
export { TAIL_MULTIPLE_IDLE, MAX_WAIT_MULTIPLE } from './queueing.js';
/** Ceiling on enumerated paths, so a dense graph cannot explode the report. */
const MAX_PATHS = 60;
const MAX_PATH_DEPTH = 24;
const EPSILON = 1e-9;
/** Seconds for an autoscaler to add capacity — why a spike hurts before it helps. */
export const AUTOSCALE_LAG_S = 60;
/**
 * What an autoscaler aims for, rather than 100%. Nobody targets full utilisation:
 * scaling to exactly the offered load leaves no headroom for the next increment and
 * guarantees a second scaling event while the first is still arriving.
 */
export const AUTOSCALE_TARGET_UTILIZATION = 0.7;

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
function perReplicaCapacity(node: GraphNode, occupancyMs: number): number {
  const explicit = node.attrs?.capacityRps;
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  if (occupancyMs <= 0) return DEFAULT_CAPACITY[node.type] ?? 500;
  const concurrency = num(node.attrs?.concurrency, concurrencyFor(node));
  const shards = Math.max(1, Math.floor(num(node.attrs?.shards, 1)));
  // Shards hold DIFFERENT data, so throughput multiplies. Replicas hold the same data
  // and are handled separately, because they buy availability rather than capacity.
  return (concurrency / (occupancyMs / 1000)) * shards;
}

/**
 * Requests one replica holds at once — from its size when it has been sized.
 *
 * Stating "2 vCPU" and having capacity follow is the honest direction: a number of
 * requests per second typed straight in can be anything, whereas a size has to be paid
 * for. The two are the same statement, which is why the cost model reads the same field.
 */
/**
 * Parallel service channels.
 *
 * Capacity is `channels / serviceMs`, so the channel count and the capacity are
 * the same statement — which is exactly why queueing must be computed from this
 * rather than from the replica count. Ten replicas of a 64-worker service is 640
 * channels, and a queue with 640 servers behaves nothing like a queue with ten.
 */
function serversOf(node: GraphNode, replicas: number): number {
  const concurrency = num(node.attrs?.concurrency, concurrencyFor(node));
  const shards = Math.max(1, Math.floor(num(node.attrs?.shards, 1)));
  return Math.max(1, Math.round(concurrency * replicas * shards));
}

function concurrencyFor(node: GraphNode): number {
  const vcpu = node.attrs?.vcpu;
  if (typeof vcpu === 'number' && vcpu > 0) {
    return Math.max(1, vcpu * CONCURRENT_REQUESTS_PER_VCPU);
  }
  return defaultConcurrency(node);
}

/**
 * How many replicas exist to begin with. An autoscaling group starts at its floor:
 * "min 1, max 50" means one container is what meets the first seconds of a spike, and
 * saying so is the entire point of modelling the floor separately from the ceiling.
 */
function replicasOf(node: GraphNode): number {
  const explicit = node.attrs?.replicas;
  const stated = typeof explicit === 'number' && explicit > 0 ? Math.floor(explicit) : 1;
  const floor = node.attrs?.autoscaleMin;
  return typeof floor === 'number' && floor > 0 ? Math.max(Math.floor(floor), stated) : stated;
}

function absorbOf(node: GraphNode): number {
  const explicit = node.attrs?.cacheHitRate;
  if (typeof explicit === 'number') return clamp01(explicit);
  return CACHE_TYPES.has(node.type) ? DEFAULT_CACHE_HIT_RATE : 0;
}

/**
 * How long a caller waits before giving up, when nobody has said.
 *
 * Deliberately generous: enough that congestion alone never trips it. Overload is
 * already modelled as shedding, and a component that both sheds AND fails everything
 * it managed to serve is being punished twice for the same problem — which made every
 * saturated hop report a totally broken path instead of a degraded one.
 *
 * So a stated `timeoutMs` is what creates timeout failures, exactly like a stated
 * retry count is what creates amplification. No stated timeout means the caller is
 * patient, which is both the safer default and usually the truth.
 */
function defaultTimeoutFor(node: GraphNode, family: Family): number {
  const patient = serviceMsOf(node) * MAX_WAIT_MULTIPLE * TIMEOUT_HEADROOM;
  return Math.max(DEFAULT_TIMEOUT_MS[family], patient);
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
  sources: { node: GraphNode; baseRps: number; inferred: boolean }[];
  sinkIds: string[];
  /**
   * Components a caller is synchronously waiting on — reachable from a source
   * without crossing a hand-off. Only these can fail a timeout.
   */
  waited: Set<string>;
  /** Who holds a copy of whose data, from the replication links that were drawn. */
  replicatedWith: Map<string, Set<string>>;
  /**
   * Components that run on a shared pool, and the boundary that is that pool. Six
   * pipeline stages inside one worker group are six processes on the same machines.
   */
  hostOf: Map<string, GraphNode>;
  /** The members of each pool, so its capacity can be divided between them. */
  hosted: Map<string, string[]>;
  cycleNodeIds: string[];
  paths: PathReport[];
  pathsOmitted: number;
}

/**
 * Where traffic begins, in order of how sure we are:
 *
 *   1. A component marked with a request rate. Unambiguous.
 *   2. A client or other origin with nothing pointing into it.
 *   3. Failing both: anything nothing points into. If nobody calls it, it is where
 *      calls come in — every design drawn before sources existed looks like this,
 *      as does every blueprint that starts at a service, and refusing to simulate
 *      them would be pedantry rather than accuracy.
 *
 * An inferred source is flagged, and the run says out loud which components it
 * treated as entry points, so the guess is visible rather than silent.
 *
 * Emission falls back to the rps on any authored flow that starts here.
 */
function findSources(graph: GraphDSL, inbound: Map<string, GraphEdge[]>): Prepared['sources'] {
  const flowRpsByFirstStep = new Map<string, number>();
  for (const flow of graph.flows ?? []) {
    const first = flow.steps[0];
    if (!first) continue;
    flowRpsByFirstStep.set(first, (flowRpsByFirstStep.get(first) ?? 0) + num(flow.rps, 0));
  }

  const rateFor = (node: GraphNode): number =>
    flowRpsByFirstStep.get(node.id) ?? DEFAULT_SOURCE_RPS;
  const unreached = (node: GraphNode): boolean => (inbound.get(node.id)?.length ?? 0) === 0;

  const marked = graph.nodes
    .filter((n) => typeof n.attrs?.trafficRps === 'number' && n.attrs.trafficRps > 0)
    .map((node) => ({ node, baseRps: node.attrs!.trafficRps!, inferred: false }));

  const origins = graph.nodes
    .filter((n) => familyOf(n.type) === 'origin' && unreached(n) && !marked.some((m) => m.node.id === n.id))
    .map((node) => ({ node, baseRps: rateFor(node), inferred: false }));

  if (marked.length > 0 || origins.length > 0) return [...marked, ...origins];

  return graph.nodes
    .filter((n) => unreached(n) && !PASSIVE_FAMILIES.has(familyOf(n.type)))
    .map((node) => ({ node, baseRps: rateFor(node), inferred: true }));
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

  // Replication links carry no requests, but they are what makes two stores the same
  // data — which is the only thing that justifies failing over between them.
  const replicatedWith = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== 'replication' || !live.has(e.from) || !live.has(e.to)) continue;
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      const set = replicatedWith.get(a) ?? new Set<string>();
      set.add(b);
      replicatedWith.set(a, set);
    }
  }

  // A boundary marked as a shared host is the machines its contents run on. Nesting
  // walks upward, so a stage inside a subgroup inside a worker pool still lands on the
  // pool.
  const byIdAll = new Map(graph.nodes.map((n) => [n.id, n]));
  const hostOf = new Map<string, GraphNode>();
  const hosted = new Map<string, string[]>();
  for (const node of nodes) {
    let parentId = node.parentId;
    const seen = new Set<string>([node.id]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byIdAll.get(parentId);
      if (!parent) break;
      if (parent.attrs?.sharedHost) {
        hostOf.set(node.id, parent);
        hosted.set(parent.id, [...(hosted.get(parent.id) ?? []), node.id]);
        break;
      }
      parentId = parent.parentId;
    }
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

  const waited = new Set<string>();

  const walk = (nodeId: string, trail: string[], seen: Set<string>, async: boolean): void => {
    if (!async) waited.add(nodeId);
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
    waited,
    replicatedWith,
    hostOf,
    hosted,
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
  /** Constrained by the pool it shares rather than by anything of its own. */
  hostLimited: boolean;
  /** Parallel service channels, for queueing. */
  servers: number;
  /** Own service time plus everything synchronously waited on, ms. */
  occupancyMs: number;
  /**
   * Capacity before this round's constraints, so it can be rebuilt from scratch
   * each time round the relaxation loop.
   *
   * Every constraint below narrows capacity with `Math.min`, and arrivals start at
   * zero and grow as flow propagates through the rounds. Without a reset, round
   * zero — where nothing has arrived anywhere yet — clamps a pool-limited
   * component to zero capacity and the `min` never lets it back up.
   */
  baseCapacity: number;
  /**
   * The scenario's capacity override for this tick — a hot partition at 0.1, say.
   * Carried on the runtime because capacity is re-derived from occupancy inside
   * the relaxation loop, and a re-derivation that forgot this silently undid
   * every degradation a scenario asked for.
   */
  capacityMultiple: number;
}

/**
 * Concurrent requests a shared pool can hold in flight across all of it.
 *
 * Expressed in slots rather than requests per second because the components sharing it
 * have different service times: a parser at 2.5 seconds and a chunker at 20ms cost the
 * pool wildly different amounts per request, and only concurrency adds up.
 */
function hostSlots(host: GraphNode, scaled?: number): number {
  const vcpu = host.attrs?.vcpu;
  const replicas = scaled ?? replicasOf(host);
  if (typeof vcpu === 'number' && vcpu > 0) {
    return vcpu * CONCURRENT_REQUESTS_PER_VCPU * replicas;
  }
  const stated = host.attrs?.concurrency;
  if (typeof stated === 'number' && stated > 0) return stated * replicas;
  // Unsized pool: it is a drawing boundary that happens to be marked shared, and
  // constraining traffic by a number nobody gave would be inventing one.
  return Number.POSITIVE_INFINITY;
}

/**
 * What a buffer's consumers can pull between them. A queue with one worker behind it
 * drains at that worker's rate however fast the queue itself is — the drain is the
 * constraint, always, and saying so is the whole lesson of backpressure.
 */
function consumerCapacity(
  nodeId: string,
  runtime: Map<string, NodeRuntime>,
  prep: Prepared,
): number {
  const outs = prep.out.get(nodeId) ?? [];
  if (outs.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const e of outs) {
    const consumer = runtime.get(e.to);
    if (!consumer) continue;
    if (!Number.isFinite(consumer.capacity)) return Number.POSITIVE_INFINITY;
    total += consumer.capacity;
  }
  return total;
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

/**
 * Families where a request in flight occupies a WORKER rather than a socket.
 *
 * This is the line between "a slow dependency costs me throughput" and "a slow
 * dependency costs me nothing but memory". A thread-per-request service blocked on
 * a database has that worker unavailable to anyone else, and its capacity falls
 * accordingly. An event-driven proxy blocked on the same database is holding a
 * file descriptor: it can hold tens of thousands of them, which is the entire
 * reason load balancers and gateways are built that way.
 *
 * Getting this wrong is not subtle. Charging a load balancer's capacity for its
 * backends' service time took it from 50,000 rps to 2,400 and starved everything
 * drawn behind it.
 */
const WORKER_BOUND: ReadonlySet<Family> = new Set<Family>([
  'compute',
  'datastore',
  'ai',
  'external',
]);

/**
 * How long each component holds a worker, and therefore what its capacity is.
 *
 * A caller waits for its own work AND for everything it synchronously calls, so a
 * payment provider slowing to four seconds takes out a checkout API that is
 * nowhere near its request limit. The engine asserted this relationship in three
 * separate comments and implemented it in none: `perReplicaCapacity` read only a
 * node's own `latencyMs`, so a slow dependency changed nothing upstream.
 *
 * Walks downward from every node, memoised per pass. What a caller experiences is
 * the callee's QUEUED response, not its bare service time, so congestion
 * propagates upward and a saturated dependency drags its callers down with it —
 * which is the cascading failure this whole model exists to show.
 *
 * Two guards. A cycle returns the node's own service time on the second visit
 * rather than recursing. And every result is capped at what the caller is
 * prepared to wait: a caller that gives up at two seconds does not hold a worker
 * for thirty. That cap is physically correct and also what bounds the feedback
 * loop — the spiral must be possible, but it must terminate.
 */
function computeOccupancy(prep: Prepared, runtime: Map<string, NodeRuntime>): void {
  const memo = new Map<string, number>();

  const responseOf = (nodeId: string, visiting: Set<string>): number => {
    const r = runtime.get(nodeId);
    if (!r) return 0;
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return r.serviceMs;

    visiting.add(nodeId);

    // Past a hand-off nobody is waiting, so it costs the caller nothing.
    const outs = (prep.out.get(nodeId) ?? []).filter(
      (e) => e.kind !== 'async' && runtime.has(e.to),
    );

    /** One hop's cost: the wire, plus whatever the far end takes to answer. */
    const costOf = (e: GraphEdge): number => {
      const fromRegion = r.node.attrs?.region;
      const toRegion = runtime.get(e.to)!.node.attrs?.region;
      return (
        rttMs(e.placement ?? inferPlacement(fromRegion, toRegion), fromRegion, toRegion) +
        responseOf(e.to, visiting)
      );
    };

    let downstream = 0;
    if (outs.length > 0) {
      if (distributionOf(r.node.type) === 'distribute') {
        // A router hands each request to ONE downstream, so what its caller waits
        // for is the weighted AVERAGE of its backends, not their sum. Summing made
        // a load balancer in front of three services wait for all three, which
        // collapsed its capacity and starved everything behind it.
        const routable = outs.filter(
          (e) => familyOf(runtime.get(e.to)!.node.type) !== 'control',
        );
        const across = routable.length > 0 ? routable : outs;
        const weights = across.map((e) => num(e.share, 1 / across.length));
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        downstream = across.reduce(
          (sum, e, i) => sum + (weights[i]! / total) * costOf(e),
          0,
        );
      } else {
        // A service calls every dependency it has, so it waits for all of them —
        // each weighted by how often that call is actually made.
        downstream = outs.reduce((sum, e) => sum + Math.min(1, num(e.share, 1)) * costOf(e), 0);
      }
    }
    visiting.delete(nodeId);

    const occupancy = Math.min(
      r.serviceMs + downstream,
      num(r.node.attrs?.timeoutMs, defaultTimeoutFor(r.node, r.family)),
    );
    r.occupancyMs = occupancy;

    const response = occupancy * responseMultiple(r.utilization, r.servers);
    memo.set(nodeId, response);
    return response;
  };

  for (const node of prep.nodes) responseOf(node.id, new Set());
}

export function runEngine(graph: GraphDSL, scenario: Scenario): EngineResult {
  const prep = prepare(graph);
  const horizon = Math.max(1, Math.floor(scenario.horizonS || DEFAULT_HORIZON_S));
  const multiplier = Math.max(0, scenario.loadMultiplier ?? 1);

  // Backlog and replica count are the only things that survive between ticks —
  // they are what makes a spike hurt after it has passed.
  const backlog = new Map<string, number>();
  const peakBacklog = new Map<string, number>();
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
      // Elastic means somebody else's capacity, so the only thing that can stop it is
      // their rate limit — which is applied as shedding, further down.
      const unbounded = passive || node.attrs?.elastic === true;
      const capacity = unbounded
        ? Number.POSITIVE_INFINITY
        : Math.max(0, perReplica * replicas);

      runtime.set(node.id, {
        node,
        family,
        serviceMs,
        perReplica,
        replicas,
        capacity: down && !isTransparentWhenDown(node.type) ? 0 : capacity,
        baseCapacity: down && !isTransparentWhenDown(node.type) ? 0 : capacity,
        absorb: down ? 0 : absorb,
        down,
        bypassed: down && isTransparentWhenDown(node.type),
        // Two ways to be refused rather than queued: something built to shed at the
        // edge, or somebody else's rate limit. A provider's quota rejects you at their
        // door, which costs you nothing but loses the request just the same.
        shedLimit: node.attrs?.rateLimitRps
          ? Math.max(0, node.attrs.rateLimitRps)
          : SHEDDING_TYPES.has(node.type)
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
        hostLimited: false,
        servers: serversOf(node, replicas),
        occupancyMs: serviceMs,
        capacityMultiple,
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
      for (const r of runtime.values()) {
        r.arriving = 0;
        r.hostLimited = false;
        // Constraints below only ever narrow capacity, and arrivals grow as flow
        // propagates through the rounds — so it has to start each round unclamped.
        r.capacity = r.baseCapacity;
      }
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

        // Not every outbound connection is somewhere the request GOES. A facade
        // consults the feature flags and reports to observability on every request
        // while routing the request itself to one of its backends — so a router
        // splits only across the components that can serve the request, and treats a
        // control plane as a side call. Without this, a strangler facade sent a third
        // of production traffic to the flag store.
        const mode = distributionOf(node.type);
        const routable = outs.filter((e) => familyOf(runtime.get(e.to)?.node.type ?? 'custom') !== 'control');
        const splitAcross = mode === 'distribute' ? (routable.length || outs.length) : 0;
        const isSideCall = (e: GraphEdge): boolean =>
          mode === 'distribute' && routable.length > 0 && !routable.includes(e);

        const shares = outs.map((e) =>
          num(e.share, mode === 'distribute' && !isSideCall(e) ? 1 / splitAcross : 1),
        );
        const shareTotal = routable.reduce((sum, e) => sum + shares[outs.indexOf(e)]!, 0) || 1;

        outs.forEach((e, i) => {
          let target = runtime.get(e.to);
          if (!target) return;

          // Failover. A caller with two endpoints for the same DATA uses the one that
          // answers, so a dead primary's share goes to its replica rather than onto
          // the floor.
          //
          // Deliberately narrow. Two components sharing a type are not
          // interchangeable — a load balancer in front of a Catalog API and a Search
          // API is not redundancy, and quietly rerouting one to the other would hide
          // exactly the single point of failure this tool exists to find. So a stand-in
          // must either be joined to it by a replication link or be the same data in
          // another shape: a replica for its primary, a shard cluster for the box it
          // replaced.
          if (target.down && !target.bypassed) {
            const dead = target;
            const standIn = outs
              .map((other) => runtime.get(other.to))
              .find(
                (alt) =>
                  alt !== undefined &&
                  alt !== dead &&
                  !alt.down &&
                  canSubstitute(dead.node.type, alt.node.type) &&
                  (alt.node.type !== dead.node.type || prep.replicatedWith.get(dead.node.id)?.has(alt.node.id) === true),
              );
            if (standIn) target = standIn;
          }

          // A router hands each request to one downstream; a service calls each of
          // its dependencies once per request; and a side call happens every time
          // whatever the router does with the request itself.
          const fraction =
            mode === 'distribute' && !isSideCall(e)
              ? shares[i]! / shareTotal
              : Math.min(1, shares[i]!);
          const attempts = forwarded * fraction;
          const multiplier = retryMultiplier(target.failFraction, num(e.retries, DEFAULT_RETRIES));
          target.arriving += attempts * multiplier;
          firstAttempts += attempts;
          retriedAttempts += attempts * multiplier;
        });
      }

      // Occupancy before anything measures demand against a pool, because a
      // "how much of the pool does this need" question is answered in
      // concurrency-seconds and needs the holding time to be right first.
      //
      // Capacity is then re-derived from it. This is the fixpoint: capacity
      // depends on what a caller waits for, which depends on how busy that thing
      // is, which depends on what upstream capacity let through. The same
      // relaxation rounds that already resolve retry amplification resolve this.
      computeOccupancy(prep, runtime);
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        if (r.down || r.node.attrs?.elastic === true) continue;
        // Only where a request in flight costs a worker. A proxy waiting on a
        // backend is holding a socket, and sockets are cheap.
        if (!WORKER_BOUND.has(r.family)) continue;
        // An explicit rps is the author overriding the derivation outright.
        if (typeof r.node.attrs?.capacityRps === 'number' && r.node.attrs.capacityRps > 0) continue;
        r.capacity = Math.max(0, perReplicaCapacity(r.node, r.occupancyMs) * r.replicas * r.capacityMultiple);
      }

      // Components sharing a pool compete for it.
      //
      // The quantity that composes is concurrency, not requests per second: a stage
      // needs `arrivals x service time` slots at once, and the pool supplies
      // `vCPU x replicas` worth. Six pipeline stages inside one worker group are six
      // processes on the same machines — drawn separately, but they cannot each have
      // their own capacity, and a parser holding a worker for 2.5 seconds starves the
      // chunker beside it far more than its request count suggests.
      for (const [hostId, memberIds] of prep.hosted) {
        const host = prep.hostOf.get(memberIds[0] ?? '');
        if (!host) continue;
        const supply = hostSlots(host, scaledReplicas.get(hostId));
        if (!Number.isFinite(supply) || supply <= 0) continue;

        const members = memberIds
          .map((id) => runtime.get(id))
          .filter((r): r is NodeRuntime => r !== undefined);
        // Occupancy, not bare service time: a stage waiting on something else is
        // still holding the pool's machine while it waits.
        const demands = members.map((r) =>
          slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs }),
        );
        const granted = shareOut(demands, supply);
        members.forEach((r, i) => {
          if (granted[i]! >= demands[i]! - EPSILON) return;
          r.capacity = Math.min(r.capacity, r.arriving * (granted[i]! / demands[i]!));
          r.hostLimited = true;
        });
      }

      // A connection ceiling is a second, independent limit. A store can be nowhere
      // near its request capacity and still refuse callers because it has no
      // connection left to give them — which is how a database that looks healthy on
      // every dashboard stops serving. Fifty replicas holding twenty connections
      // each against a hundred-connection Postgres is the canonical case, and it was
      // invisible until occupancy existed to measure the holding time.
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        const ceiling = r.node.attrs?.maxConnections ?? r.node.attrs?.poolSize;
        if (typeof ceiling !== 'number' || ceiling <= 0 || r.down) continue;
        const needed = slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs });
        const { admittedRps } = admit(r.arriving, needed, ceiling);
        r.capacity = Math.min(r.capacity, admittedRps);
      }

      // Serve what arrived, shed the rest, and remember how badly each failed so
      // the next round's retry multiplier is right.
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        r.admitted = Math.min(r.arriving, r.shedLimit);
        const shedAtEdge = r.arriving - r.admitted;

        if (r.family === 'messaging') {
          // A buffer forwards at the rate its CONSUMERS pull, not at its own
          // throughput: the constraint on a queue is always the drain. What it
          // cannot forward becomes backlog, and only a full buffer refuses.
          const drain = Math.min(r.capacity, consumerCapacity(node.id, runtime, prep));
          const available = r.admitted + r.backlog / TICK_S;
          r.served = Math.min(available, drain);
          const depthMax = num(r.node.attrs?.queueDepthMax, DEFAULT_QUEUE_DEPTH);
          const projected = r.backlog + Math.max(0, r.admitted - r.served) * TICK_S;
          const overflowing = Math.max(0, projected - depthMax) / TICK_S;
          r.dropped = shedAtEdge + overflowing;
        } else {
          r.served = Math.min(r.admitted, r.capacity);
          r.dropped = shedAtEdge + Math.max(0, r.admitted - r.served);
        }

        r.utilization = r.capacity > 0 && Number.isFinite(r.capacity) ? r.arriving / r.capacity : 0;
        r.failFraction = r.arriving > EPSILON ? clamp01(r.dropped / r.arriving) : 0;
      }
    }

    // Latency, once throughput has settled. Timeouts turn "slow" into "failed" — but
    // only where somebody is actually waiting. Work behind a hand-off has no caller
    // counting the milliseconds, so a document parser that takes two and a half
    // seconds is doing its job, not failing; applying a synchronous budget to it
    // reported every ingest pipeline as broken at its own declared load.
    for (const node of prep.nodes) {
      const r = runtime.get(node.id)!;
      r.latencyMs = r.bypassed ? 0 : r.serviceMs * responseMultiple(r.utilization, r.servers);
      if (!prep.waited.has(node.id)) continue;
      const timeout = num(r.node.attrs?.timeoutMs, defaultTimeoutFor(r.node, r.family));
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
      // Owed work grows by what arrived and was not forwarded, and shrinks when the
      // drain outruns arrivals — which is how a spike is paid off after it passes.
      const depthMax = num(r.node.attrs?.queueDepthMax, DEFAULT_QUEUE_DEPTH);
      const next = Math.min(depthMax, Math.max(0, r.backlog + (r.admitted - r.served) * TICK_S));
      backlog.set(node.id, next);
      r.backlog = next;
      peakBacklog.set(node.id, Math.max(peakBacklog.get(node.id) ?? 0, next));
    }

    // Autoscaling, arriving late on purpose: capacity a minute after it was needed is
    // why a spike hurts before it helps, and why the floor matters more than the
    // ceiling for anything that arrives suddenly. It scales back down too, so a design
    // is not credited with capacity it stopped paying for.
    if (t > 0 && t % AUTOSCALE_LAG_S === 0) {
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        const ceiling = node.attrs?.autoscaleMax;
        if (typeof ceiling !== 'number' || ceiling <= 0 || r.perReplica <= 0) continue;
        const wanted = Math.ceil(r.arriving / (r.perReplica * AUTOSCALE_TARGET_UTILIZATION));
        const floor = replicasOf(node);
        scaledReplicas.set(node.id, Math.max(floor, Math.min(Math.floor(ceiling), wanted)));
      }
    }

    // What actually completed.
    //
    // Not "walk each path from the source's full rate and multiply by survival":
    // that counts the whole of the offered load once per path, so a load balancer in
    // front of two services reported twice as many completions as there were
    // requests, and a saturated branch looked like it had dropped nothing.
    //
    // A request completes when every synchronous call it makes succeeds. So the
    // probability is computed per component, over what is below it: a router picks
    // ONE downstream, weighted by share, while a service needs ALL the dependencies
    // it calls, each weighted by how often it calls them. Hand-offs are excluded
    // because nobody is waiting on the far side.
    const succeeds = new Map<string, number>();
    const succeedsAt = (nodeId: string, visiting: Set<string>): number => {
      const cached = succeeds.get(nodeId);
      if (cached !== undefined) return cached;
      // A cycle cannot be resolved as a probability; treat the second visit as
      // succeeding so the recursion terminates instead of counting forever.
      if (visiting.has(nodeId)) return 1;
      const r = runtime.get(nodeId);
      if (!r) return 1;

      visiting.add(nodeId);
      const own = r.arriving > EPSILON ? clamp01(r.served / r.arriving) : 1;
      const outs = (prep.out.get(nodeId) ?? []).filter((e) => e.kind !== 'async');
      let below = 1;

      if (outs.length > 0) {
        if (distributionOf(r.node.type) === 'distribute') {
          const routable = outs.filter(
            (e) => familyOf(runtime.get(e.to)?.node.type ?? 'custom') !== 'control',
          );
          const across = routable.length > 0 ? routable : outs;
          const weights = across.map((e) => num(e.share, 1 / across.length));
          const total = weights.reduce((a, b) => a + b, 0) || 1;
          below = across.reduce(
            (sum, e, i) => sum + (weights[i]! / total) * succeedsAt(e.to, visiting),
            0,
          );
        } else {
          // Every call must come back. A call made for one request in ten only
          // threatens that one request.
          below = outs.reduce((product, e) => {
            const rate = Math.min(1, num(e.share, 1));
            return product * (1 - rate + rate * succeedsAt(e.to, visiting));
          }, 1);
        }
      }

      visiting.delete(nodeId);
      const result = own * below;
      succeeds.set(nodeId, result);
      return result;
    };

    let completed = 0;
    for (const [sourceId, rate] of offeredBySource) {
      completed += rate * succeedsAt(sourceId, new Set());
    }

    // Latency is averaged over the paths, weighted by how much traffic each one
    // actually carries — the same branch fractions, so a rarely-taken path does not
    // drag the headline number around.
    let p50Weighted = 0;
    let p99Weighted = 0;
    let weightTotal = 0;
    for (const path of prep.paths) {
      let weight = offeredBySource.get(path.nodeIds[0]!) ?? 0;
      if (weight <= EPSILON) continue;
      let latency = 0;
      let tail = 0;
      let waiting = true;

      for (let i = 0; i < path.nodeIds.length; i += 1) {
        const r = runtime.get(path.nodeIds[i]!);
        if (!r) continue;
        weight *= r.arriving > EPSILON ? clamp01(r.served / r.arriving) : 1;
        if (waiting) {
          latency += r.latencyMs;
          // Two separable things, and they used to be one invented factor. The
          // service time has a spread of its own even at rest — GC, scheduling,
          // jitter — which is the estimate; and a busy hop makes people wait for a
          // channel, which is a real M/M/c percentile.
          tail +=
            r.serviceMs * TAIL_MULTIPLE_IDLE + waitP99Ms(r.utilization, r.servers, r.serviceMs);
        }
        const next = path.nodeIds[i + 1];
        if (next === undefined) break;
        const link = (prep.out.get(r.node.id) ?? []).find((e) => e.to === next);
        if (!link) continue;
        // Past a hand-off the caller has already been answered.
        // Occupancy already charged this hop against the caller's capacity. This
        // is the other half of the same fact: the milliseconds a reader sees.
        if (waiting) {
          const fromRegion = r.node.attrs?.region;
          const toRegion = runtime.get(next)?.node.attrs?.region;
          const wire = rttMs(
            link.placement ?? inferPlacement(fromRegion, toRegion),
            fromRegion,
            toRegion,
          );
          latency += wire;
          tail += wire;
        }
        if (link.kind === 'async') waiting = false;
        const siblings = prep.out.get(r.node.id) ?? [];
        weight *=
          distributionOf(r.node.type) === 'distribute'
            ? num(link.share, 1 / Math.max(1, siblings.length))
            : Math.min(1, num(link.share, 1));
      }

      p50Weighted += latency * weight;
      p99Weighted += tail * weight;
      weightTotal += weight;
    }

    const successRate = offeredTotal > EPSILON ? clamp01(completed / offeredTotal) : 1;
    const p50 = weightTotal > EPSILON ? p50Weighted / weightTotal : 0;
    const p99 = weightTotal > EPSILON ? p99Weighted / weightTotal : 0;

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
        hostLimited: r.hostLimited,
        elastic: r.node.attrs?.elastic === true,
        servers: r.servers,
        occupancyMs: round(r.occupancyMs),
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

    // "Worst" is the second with the most traffic on the floor; ties go to the most
    // stressed, and only then to the slowest.
    //
    // Utilisation is in here deliberately. This score used to be loss and p99 alone,
    // which worked only because p99 was computed as a factor rising with utilisation
    // — so it doubled as a stress proxy by accident. A real M/M/c tail is flat across
    // the whole healthy range, as it should be, and that silently made every tick
    // score identically: the first second always won, and a run whose interesting
    // moment is an outage at t=20 reported the calm before it.
    const stress = states.reduce(
      (max, s) => (Number.isFinite(s.capacityRps) && s.utilization > max ? s.utilization : max),
      0,
    );
    const score = (1 - successRate) * 1_000_000 + stress * 1_000 + p99;
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
    sources: prep.sources.map((s) => ({ nodeId: s.node.id, rps: s.baseRps, inferred: s.inferred })),
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
    peakBacklog: Object.fromEntries(
      [...peakBacklog.entries()].filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]),
    ),
    retryAmplification: round(peakRetry, 3),
    cycleNodeIds: prep.cycleNodeIds,
    hostedBy: Object.fromEntries([...prep.hostOf].map(([child, host]) => [child, host.id])),
    findings: [],
    assumptions: assumptionsFor(prep, scenario),
  };
}

function reasonFor(r: NodeRuntime): string {
  if (r.down && !r.bypassed) return `${r.node.label} is offline, and nothing else serves its traffic.`;
  if (r.hostLimited) {
    return `${r.node.label} shares a pool that has run out of room — the components beside it are using the machines.`;
  }
  // Before blaming throughput: a store can be almost idle by request count and
  // still be turning callers away because it has no connection left to give.
  const ceiling = r.node.attrs?.maxConnections ?? r.node.attrs?.poolSize;
  if (typeof ceiling === 'number' && ceiling > 0) {
    const needed = slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs });
    if (needed > ceiling) {
      return `${r.node.label} has ${ceiling} connections and its callers need ${Math.ceil(needed)} — they are queueing for a connection, not for the data.`;
    }
  }
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
  if (prep.sources.length === 0) {
    out.push('Nothing here can be an entry point, so no load was offered — mark where traffic starts.');
  } else if (prep.sources.every((s) => s.inferred)) {
    // The guess is stated rather than made quietly: a reader who disagrees with the
    // entry point can see that one was chosen for them, and where.
    out.push(
      `Nothing is marked as where traffic starts, so ${prep.sources
        .map((s) => s.node.label)
        .join(', ')} ${prep.sources.length === 1 ? 'was' : 'were'} treated as the entry point — nothing points into ${prep.sources.length === 1 ? 'it' : 'them'}.`,
    );
  }
  if (prep.pathsOmitted > 0) {
    out.push(`${prep.pathsOmitted} paths beyond the first ${MAX_PATHS} were not enumerated; per-component numbers still count all traffic.`);
  }
  if (prep.cycleNodeIds.length > 0) {
    out.push(`A cycle was walked once and not followed round: ${prep.cycleNodeIds.join(', ')}.`);
  }
  if ((scenario.outages ?? []).length === 0) out.push('Nothing was taken offline in this run.');
  return out;
}
