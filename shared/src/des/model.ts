// From a drawing to the parts a request can visit.
//
// Everything here is read once per run and turned into plain numbers and arrays,
// so the event loop never touches the graph, a Map lookup or a default table while
// it runs. The defaults are the flow engine's own, read from the same constants,
// so the two engines disagree only where their models do.

import { DEFAULT_LATENCY } from '../components.js';
import { DEFAULT_VCPU } from '../cost.js';
import { entryPoints } from '../engine.js';
import { familyOf, type Family } from '../families.js';
import { rttMs } from '../network.js';
import { TAIL_MULTIPLE_IDLE } from '../queueing.js';
import type { GraphDSL, GraphEdge, GraphNode } from '../types.js';
import { exponential, logNormal } from './dist.js';
import type { Rng } from './rng.js';

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
  /** Cores that serve requests in parallel. Infinity is elastic: nothing ever waits. */
  servers: number;
  /** Median own work per request, ms. */
  latencyMs: number;
  sample: (rng: Rng) => number;
  /** A router sends each request to ONE of its links; everything else calls all of them. */
  routes: boolean;
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

function serversOf(node: GraphNode, family: Family): number {
  if (node.attrs?.elastic === true) return Infinity;
  const vcpu = positive(node.attrs?.vcpu) ? node.attrs!.vcpu! : DEFAULT_VCPU[family];
  // Families the cost model gives no cores (routers, caches, origins, providers)
  // are elastic here until their own behaviour arrives in a later phase.
  if (!(vcpu > 0)) return Infinity;
  const replicas = Math.max(
    positive(node.attrs?.replicas) ? Math.floor(node.attrs!.replicas!) : 1,
    positive(node.attrs?.autoscaleMin) ? Math.floor(node.attrs!.autoscaleMin!) : 1,
  );
  const shards = family === 'datastore' && positive(node.attrs?.shards) ? Math.floor(node.attrs!.shards!) : 1;
  return Math.max(1, Math.floor(vcpu)) * replicas * shards;
}

function samplerFor(latencyMs: number, override: ServiceOverride | undefined): (rng: Rng) => number {
  if (latencyMs <= 0 || override === 'fixed') return () => latencyMs;
  if (override === 'exponential') return (rng) => exponential(rng, latencyMs);
  return logNormal(latencyMs, latencyMs * TAIL_MULTIPLE_IDLE);
}

export function buildModel(graph: GraphDSL, service: Record<string, ServiceOverride> = {}): Model {
  const assumptions: string[] = [
    'Request engine, phase 1: every part is a queue of vCPU × replicas cores, each request holding a core for its whole own work. Compute runtimes, caches, connection limits, timeouts and retries are not modelled yet.',
    `Service times are log-normal with the 99th percentile at ${TAIL_MULTIPLE_IDLE}× the median, where no spread is stated.`,
  ];

  const nodes = graph.nodes.filter((n) => familyOf(n.type) !== 'boundary');
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));

  const parts: Part[] = nodes.map((node, index) => {
    const family = familyOf(node.type);
    const latencyMs = positive(node.attrs?.latencyMs) ? node.attrs!.latencyMs! : (DEFAULT_LATENCY[node.type] ?? 20);
    return {
      index,
      node,
      family,
      servers: serversOf(node, family),
      latencyMs,
      sample: samplerFor(latencyMs, service[node.id]),
      routes: family === 'routing',
      out: [],
    };
  });

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
