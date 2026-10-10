// From a drawing to the parts a request can visit.
//
// Everything here is read once per run and turned into plain numbers and arrays,
// so the event loop never touches the graph, a Map lookup or a default table while
// it runs. The defaults are the flow engine's own, read from the same constants,
// so the two engines disagree only where their models do.
//
// A visit to a part holds up to two kinds of thing:
//   - a token for the whole visit: a thread-pool worker, or a store connection;
//   - a core, only while the request is computing.
// What differs between runtimes is which of the two exist, and that difference is
// the whole of "event loop versus thread pool".

import { DEFAULT_VCPU } from '../cost.js';
import { concurrencyFor, connectionCeiling, effectiveHitRate, entryPoints } from '../engine.js';
import { familyOf, type Family } from '../families.js';
import { rttMs } from '../network.js';
import { TAIL_MULTIPLE_IDLE } from '../queueing.js';
import type { GraphDSL, GraphEdge, GraphNode } from '../types.js';
import { Z_99 } from './dist.js';
import type { Rng } from './rng.js';
import { cpuMsOf, DEFAULT_SERVICE_CPU_MS, latencyMsOf, latencyP99Of, runtimeOf } from './runtime.js';

/** Test hook: replace a part's log-normal service time, by node id. */
export type ServiceOverride = 'exponential' | 'fixed';

export interface Link {
  edge: GraphEdge;
  to: number;
  /** Calls per request (or, from a router, relative weight). */
  share: number;
  /** One way: half of the placement's round trip. */
  halfRttMs: number;
}

export interface Part {
  index: number;
  node: GraphNode;
  family: Family;
  /** Cores that compute in parallel. Infinity: computing never waits. */
  cores: number;
  /** How much of a core one core is: a 0.5 vCPU box computes at half speed. */
  speed: number;
  /** Held for the whole visit: thread-pool workers or store connections. Infinity: none. */
  tokens: number;
  /** Median own work per request (wall time), ms. */
  latencyMs: number;
  /** Mean CPU per request, ms. The rest of the wall time holds no core. */
  cpuMs: number;
  /** One draw per visit: how slow this visit is, median 1. Wall and CPU both scale by it. */
  factor: (rng: Rng) => number;
  /** The factor's mean, so CPU averages exactly `cpuMs` (it is measured as a mean). */
  meanFactor: number;
  /** A router sends each request to ONE of its links; everything else calls all of them. */
  routes: boolean;
  /** Probability a visit is answered here without calling on (a cache hit). */
  answers: number;
  out: Link[];
}

export interface Source {
  part: number;
  baseRps: number;
}

export interface Model {
  parts: Part[];
  sources: Source[];
  assumptions: string[];
}

const positive = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Families that compute on cores of their own. The rest take time but hold no core. */
const COMPUTES: ReadonlySet<Family> = new Set(['compute', 'datastore', 'ai']);

function replicasOf(node: GraphNode): number {
  return Math.max(
    positive(node.attrs?.replicas) ? Math.floor(node.attrs!.replicas!) : 1,
    positive(node.attrs?.autoscaleMin) ? Math.floor(node.attrs!.autoscaleMin!) : 1,
  );
}

function factorFor(node: GraphNode, override: ServiceOverride | undefined): Pick<Part, 'factor' | 'meanFactor'> {
  if (override === 'fixed') return { factor: () => 1, meanFactor: 1 };
  if (override === 'exponential') return { factor: (rng) => -Math.log(1 - rng()), meanFactor: 1 };
  const spread = latencyP99Of(node) / latencyMsOf(node);
  const sigma = spread > 1 ? Math.log(spread) / Z_99 : 0;
  if (sigma === 0) return { factor: () => 1, meanFactor: 1 };
  return {
    factor: (rng) => {
      // Box–Muller, one value kept.
      const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
      return Math.exp(sigma * z);
    },
    meanFactor: Math.exp((sigma * sigma) / 2),
  };
}

function buildPart(node: GraphNode, index: number, override: ServiceOverride | undefined): Part {
  const family = familyOf(node.type);
  const runtime = runtimeOf(node);
  const replicas = replicasOf(node);
  const vcpu = positive(node.attrs?.vcpu) ? node.attrs!.vcpu! : DEFAULT_VCPU[family];
  const elastic = node.attrs?.elastic === true || runtime === 'serverless' || !COMPUTES.has(family) || !(vcpu > 0);

  const shards = family === 'datastore' && positive(node.attrs?.shards) ? Math.floor(node.attrs!.shards!) : 1;
  const cores = elastic ? Infinity : Math.max(1, Math.floor(vcpu)) * replicas * shards;

  let tokens = Infinity;
  if (!elastic && runtime === 'thread-pool') {
    const concurrency = positive(node.attrs?.concurrency) ? node.attrs!.concurrency! : concurrencyFor(node);
    tokens = Math.max(1, Math.round(concurrency * replicas));
  }
  if (family === 'datastore') tokens = connectionCeiling(node) ?? Infinity;

  return {
    index,
    node,
    family,
    cores,
    speed: elastic ? 1 : Math.min(1, vcpu),
    tokens,
    latencyMs: latencyMsOf(node),
    cpuMs: elastic ? 0 : cpuMsOf(node),
    ...factorFor(node, override),
    routes: family === 'routing',
    answers: family === 'cache' ? effectiveHitRate(node) : 0,
    out: [],
  };
}

/** Labels, joined for a sentence. */
const listed = (parts: Part[]): string => parts.map((p) => p.node.label).join(', ');

export function buildModel(graph: GraphDSL, service: Record<string, ServiceOverride> = {}): Model {
  const assumptions: string[] = [
    'Request engine, phase 2: compute runs as a thread pool (a worker held for the whole request, waits included) or an event loop (a core held only while computing); stores queue for cores and connections; caches answer hits and pass misses on; routers, caches and outside services take time but hold no core. Timeouts, retries, outages and bounded queues are not modelled yet.',
    `Service times are log-normal with the slowest 1% at ${TAIL_MULTIPLE_IDLE}× the median, where no spread is stated.`,
  ];

  const nodes = graph.nodes.filter((n) => familyOf(n.type) !== 'boundary');
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const parts = nodes.map((node, index) => buildPart(node, index, service[node.id]));

  const computing = parts.filter((p) => Number.isFinite(p.cores));
  const pooled = computing.filter((p) => (p.family === 'compute' || p.family === 'ai') && !p.node.attrs?.runtime);
  if (pooled.length > 0) {
    assumptions.push(`${listed(pooled)} run(s) as a thread pool, because no runtime was stated.`);
  }
  const guessedCpu = computing.filter((p) => (p.family === 'compute' || p.family === 'ai') && !positive(p.node.attrs?.cpuMs));
  if (guessedCpu.length > 0) {
    assumptions.push(
      `${listed(guessedCpu)} spend(s) ${DEFAULT_SERVICE_CPU_MS} ms of CPU per request (or the whole service time, if shorter), because none was stated.`,
    );
  }
  const storeCpu = computing.filter((p) => p.family === 'datastore' && !positive(p.node.attrs?.cpuMs));
  if (storeCpu.length > 0) {
    assumptions.push(`${listed(storeCpu)}: the whole service time is taken as CPU, because no CPU per request was stated.`);
  }

  let skippedAsync = 0;
  for (const edge of graph.edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to || edge.kind === 'replication') continue;
    if (edge.kind === 'async') {
      skippedAsync += 1;
      continue;
    }
    const share = typeof edge.share === 'number' && edge.share >= 0 ? edge.share : 1;
    const rtt = rttMs(edge.placement, parts[from]!.node.attrs?.region, parts[to]!.node.attrs?.region);
    parts[from]!.out.push({ edge, to, share, halfRttMs: rtt / 2 });
  }
  if (skippedAsync > 0) {
    assumptions.push(`${skippedAsync} hand-off connection(s) carry no requests yet in the request engine.`);
  }

  const sources: Source[] = [];
  for (const { node, baseRps, inferred } of entryPoints(graph)) {
    const part = indexOf.get(node.id);
    if (part === undefined) continue;
    sources.push({ part, baseRps });
    if (inferred) assumptions.push(`${node.label} is treated as an entry point because nothing calls it.`);
  }

  return { parts, sources, assumptions };
}
