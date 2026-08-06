// The bridge from "what your repo contains" to "what is on the sheet".
//
// The deliberate restriction: only the parts the repository actually has are
// draggable. A load balancer, a cache, a queue, a second replica and a guardrail
// are not in the inventory because they are not in the code — they are the design,
// and the design is the learner's work. The scan removes the typing, not the
// thinking, and that line is the whole pedagogy of the feature.

import type { GraphNode, NodeAttrs } from '../types.js';
import type { CandidateFlow, Detected, ObservedComponent, RepoScan, TraceSummary } from './types.js';
import { slug } from './manifests.js';

/** One row of the code view. */
export interface InventoryItem {
  /** Stable ref, matching what a Binding stores. */
  ref: string;
  group: 'deployable' | 'endpoint' | 'data' | 'external' | 'ai';
  label: string;
  sublabel: string;
  /** Absent for endpoints, which are drawn as part of a deployable. */
  node?: Pick<GraphNode, 'type' | 'label' | 'annotation'> & { attrs?: NodeAttrs };
  evidence: { file: string; line: number; snippet: string }[];
  confidence: 'observed' | 'inferred';
}

/**
 * The code view, in the order a person reads it: what ships, what it answers on,
 * what it stores, who it calls, what it thinks with.
 */
export function inventory(scan: RepoScan): InventoryItem[] {
  const items: InventoryItem[] = [];

  for (const d of scan.deployables) {
    const endpointCount = scan.endpoints.filter((e) => e.deployable === d.id).length;
    items.push({
      ref: `deployable:${d.id}`,
      group: 'deployable',
      label: d.name,
      sublabel: `${describeKind(d.kind)}${endpointCount ? ` · ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'}` : ''}`,
      node: {
        // One deployable holding many routes is a monolith by the catalogue's
        // definition, whatever the person building it calls it.
        type: d.kind === 'container' || d.kind === 'node_service' || d.kind === 'python_service'
          ? endpointCount > 6 ? 'monolith' : 'service'
          : d.kind === 'next_app'
            ? 'serverless_fn'
            : 'service',
        label: d.name,
        annotation: `${describeKind(d.kind)}, ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'} in one deployable`,
      },
      evidence: d.evidence,
      confidence: 'observed',
    });
  }

  for (const e of scan.endpoints) {
    items.push({
      ref: `endpoint:${e.id}`,
      group: 'endpoint',
      label: `${e.method} ${e.path}`,
      sublabel: [
        e.authGuard === 'none' ? 'no sign-in check' : e.authGuard === 'found' ? 'guarded' : 'guard unclear',
        e.touches.length ? `reaches ${e.touches.length}` : 'reaches nothing detected',
      ].join(' · '),
      evidence: [e.evidence],
      confidence: e.confidence,
    });
  }

  const push = (d: Detected, group: InventoryItem['group']) =>
    items.push({
      ref: `component:${d.id}`,
      group,
      label: d.label,
      sublabel: d.mechanism,
      node: { type: d.nodeType, label: d.label, annotation: d.mechanism },
      evidence: d.evidence,
      confidence: d.confidence,
    });

  for (const d of scan.datastores) push(d, 'data');
  for (const d of scan.externals) push(d, 'external');
  for (const d of scan.ai) push(d, 'ai');

  return items;
}

function describeKind(kind: string): string {
  const map: Record<string, string> = {
    next_app: 'Next.js app',
    node_service: 'Node service',
    python_service: 'Python service',
    static_site: 'static site',
    worker: 'background worker',
    container: 'container',
    unknown: 'unidentified',
  };
  return map[kind] ?? kind;
}

/**
 * A node ready to drop on the canvas.
 *
 * The annotation is filled from the code because an unannotated box scores nothing
 * — the grader is explicit that "Cache" with no strategy earns no marks — and a
 * component that arrives from the inventory already failing that would teach the
 * wrong lesson on contact.
 */
export function nodeFromInventory(item: InventoryItem, id?: string): GraphNode | null {
  if (!item.node) return null;
  return {
    id: id ?? slug(`${item.node.type}-${item.node.label}`),
    type: item.node.type,
    label: item.node.label,
    annotation: item.node.annotation,
    ...(item.node.attrs ? { attrs: item.node.attrs } : {}),
  };
}

// ------------------------------------------------------------ candidate flows ---

/**
 * Request paths worth suggesting, never declaring.
 *
 * From the static scan these are guesses: `touches` says a module is in scope, not
 * that it is called on this path. From a trace they are observations. Either way
 * the learner has to accept one before it becomes a declared flow, because a flow
 * is the thing that turns a box diagram into a design and handing it over for free
 * removes the step where the thinking happens.
 */
export function candidateFlows(scan: RepoScan, trace?: TraceSummary): CandidateFlow[] {
  if (trace && trace.flows.length > 0) {
    return trace.flows.slice(0, 12).map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      steps: [],
      refs: f.steps,
      rps: 1,
      description: `Measured ${f.samples} time${f.samples === 1 ? '' : 's'}: p50 ${f.p50Ms}ms, p95 ${f.p95Ms}ms.`,
      origin: 'trace',
    }));
  }

  return scan.endpoints
    .filter((e) => e.touches.length > 0)
    .slice(0, 12)
    .map((e, i) => ({
      id: `cand-${i + 1}`,
      name: `${e.method} ${e.path}`,
      kind: e.method === 'GET' || e.method === 'ANY' ? 'read' : 'write',
      steps: [],
      refs: ['client', `endpoint:${e.id}`, ...e.touches.map((t) => `component:${t}`)],
      rps: 1,
      description: `Suggested from imports in ${e.evidence.file}. Nothing proves this call happens on every request — confirm it.`,
      origin: 'static',
    }));
}

// ------------------------------------------------------------- measured attrs ---

/**
 * Node attributes a measurement justifies.
 *
 * Only latency and, for elastic third parties, the observation that they are
 * elastic. Capacity is deliberately not inferred from a trace: sixty seconds of
 * one person clicking says nothing about how many requests per second a component
 * can serve, and a made-up capacity would flow straight into the utilisation
 * arithmetic the whole simulator rests on.
 */
export function attrsFromObservation(component: ObservedComponent): NodeAttrs {
  const attrs: NodeAttrs = { latencyMs: Math.round(component.p50Ms) };
  if (component.nodeType === 'llm' || component.nodeType === 'third_party') attrs.elastic = true;
  return attrs;
}
