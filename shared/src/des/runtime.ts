// What a component's runtime is when nobody has said.
//
// One place for these rules, because two things read them: the request engine,
// which runs on them, and the inspector, which shows them in an empty field. If
// they were written twice, the box would eventually promise one number while the
// engine used another.

import { DEFAULT_LATENCY } from '../components.js';
import { familyOf } from '../families.js';
import { TAIL_MULTIPLE_IDLE } from '../queueing.js';
import type { GraphNode, NodeAttrs } from '../types.js';

export type Runtime = NonNullable<NodeAttrs['runtime']>;

/**
 * CPU per request for a service nobody has measured, ms.
 *
 * A documented middle value, not a measurement: a minimal Node handler measured
 * 0.4 ms of wall time and 0.16 ms of CPU (loadtest/RESULTS.md), and a real
 * application handler does a good deal more. Replace it with a measured heavier
 * handler when the reality lab has one.
 */
export const DEFAULT_SERVICE_CPU_MS = 2;

const positive = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Median own work per request, ms — the same fallback the flow engine uses. */
export function latencyMsOf(node: GraphNode): number {
  return positive(node.attrs?.latencyMs) ? node.attrs!.latencyMs! : (DEFAULT_LATENCY[node.type] ?? 20);
}

/**
 * How compute runs its requests: stated, or a thread pool. The thread pool is the
 * flow engine's model (a worker held for the whole request), so a design that says
 * nothing behaves as it always has.
 */
export function runtimeOf(node: GraphNode): Runtime | undefined {
  const family = familyOf(node.type);
  if (family !== 'compute' && family !== 'ai') return undefined;
  return node.attrs?.runtime ?? 'thread-pool';
}

/**
 * Average CPU per request, ms. Compute gets the documented default, never more than
 * its whole service time; a store's work is taken to be all CPU, which is the
 * cautious reading. Everything else holds no core.
 */
export function cpuMsOf(node: GraphNode): number {
  if (positive(node.attrs?.cpuMs)) return node.attrs!.cpuMs!;
  const family = familyOf(node.type);
  const latency = latencyMsOf(node);
  if (family === 'compute' || family === 'ai') return Math.min(DEFAULT_SERVICE_CPU_MS, latency);
  if (family === 'datastore') return latency;
  return 0;
}

/** The slowest 1% of own work, ms: stated, or the flow engine's idle tail multiple. */
export function latencyP99Of(node: GraphNode): number {
  if (positive(node.attrs?.latencyP99Ms)) return node.attrs!.latencyP99Ms!;
  return latencyMsOf(node) * TAIL_MULTIPLE_IDLE;
}
