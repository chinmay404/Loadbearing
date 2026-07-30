// Deterministic component-compatibility engine.
//
// The simulator answers "does this hold up under load". This file answers the
// question that comes first: *can this work at all as drawn?* It is the reviewer
// who looks at the boxes and arrows before anyone talks about traffic — the one
// who says "your browser is holding Postgres credentials" while the diagram is
// still being drawn.
//
// Two entry points, two moments in the UI:
//   * checkTopology(graph)              — the whole design, after the fact.
//   * checkConnection(from, to, kind)   — one edge, live, while it is dragged.
//
// Properties this file guarantees, same as simulate.ts:
//   * pure — no I/O, no Date, no Math.random, no mutation of the inputs.
//   * deterministic — findings only ever come from iterating the graph arrays
//     in order, so the same graph yields the identical array every time.
//
// Voice rule for every message below: name the failure, not the taxonomy. A
// learner cannot act on "invalid connection"; they can act on "that ships
// database credentials to every user's device".

import type { ArchNodeType, EdgeKind, Flow, GraphDSL, GraphEdge, GraphNode } from './types.js';

export type Severity = 'error' | 'warning' | 'info';

export interface TopologyFinding {
  severity: Severity;
  /** Stable machine id for the rule, e.g. 'client-direct-to-datastore'. */
  rule: string;
  /** One sentence naming what is wrong, in the app's teaching voice. */
  message: string;
  /** What to do instead. */
  fix: string;
  /** Node ids and/or edge ids this finding attaches to, so the UI can pin it. */
  nodeIds: string[];
  edgeIds: string[];
  /** Concept id from concepts.ts when one applies, else omitted. */
  concept?: string;
}

// ------------------------------------------------------------ type families ---

export const CLIENT_TYPES: ReadonlySet<ArchNodeType> = new Set(['client', 'mobile_client']);

/**
 * Stores a client must never hold credentials for. `blob_store` is deliberately
 * absent: presigned direct upload/download from the browser is the *recommended*
 * pattern, not a mistake.
 */
export const DATASTORE_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'sql_db',
  'nosql_db',
  'read_replica',
  'search_index',
  'vector_db',
  'graph_db',
  'timeseries_db',
  'olap_db',
  'data_warehouse',
  'data_lake',
  'feature_store',
]);

/** Anything durable enough to be a system of record (datastores plus object storage). */
export const DURABLE_TYPES: ReadonlySet<ArchNodeType> = new Set([...DATASTORE_TYPES, 'blob_store']);

/** Message buffers. Producers push; consumers pull. Nobody calls them back. */
export const BUFFER_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'queue',
  'stream',
  'event_bus',
  'dead_letter_queue',
]);

/** Buffers that are supposed to have consumers (a DLQ legitimately has none). */
export const WORK_BUFFER_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'queue',
  'stream',
  'event_bus',
]);

export const CACHE_TYPES: ReadonlySet<ArchNodeType> = new Set(['cache', 'prompt_cache']);

/** Things that run your code — the plausible "from" side of a write. */
export const COMPUTE_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'service',
  'monolith',
  'bff',
  'serverless_fn',
  'edge_function',
  'worker',
  'workflow_engine',
  'saga_orchestrator',
  'graphql_gateway',
]);

/** Valid consumers of a queue. */
export const CONSUMER_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'worker',
  'service',
  'serverless_fn',
  'workflow_engine',
]);

/** Anything a client reaching it should have been authenticated first. */
export const AUTH_TARGET_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'service',
  'monolith',
  'api_gateway',
  'bff',
]);

/** Nodes that establish who the caller is. An api_gateway is both a target and a boundary. */
export const AUTH_BOUNDARY_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'auth',
  'iam',
  'api_gateway',
]);

/** Anything that reads a prompt before the model does. */
export const LLM_GUARD_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'guardrail',
  'eval_gate',
  'rate_limiter',
]);

/** Anything that bounds what a model costs. */
export const LLM_COST_CEILING_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'rate_limiter',
  'prompt_cache',
  'model_router',
]);

export const MODEL_TYPES: ReadonlySet<ArchNodeType> = new Set(['llm', 'agent_runtime']);

/** Stores built for scans and columns, not for a user waiting on a response. */
export const ANALYTICAL_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'data_warehouse',
  'olap_db',
  'data_lake',
]);

/** Stateful components whose single instance is the whole feature's availability. */
export const STATEFUL_TYPES: ReadonlySet<ArchNodeType> = new Set([
  ...DATASTORE_TYPES,
  ...CACHE_TYPES,
  ...BUFFER_TYPES,
]);

/** Nodes that legitimately sit off to the side of the diagram, wired to nothing. */
export const OFF_TO_THE_SIDE_TYPES: ReadonlySet<ArchNodeType> = new Set(['group', 'observability']);

/** Flow kinds where a human is waiting for the response. */
export const USER_FACING_FLOW_KINDS: ReadonlySet<Flow['kind']> = new Set(['read', 'write']);

// ----------------------------------------------------------------- tunables ---

/** Below this many real components, "you forgot observability" is noise. */
export const MIN_NODES_FOR_OBSERVABILITY = 4;
/** A load balancer needs at least this many interchangeable backends to be balancing. */
export const MIN_LB_BACKENDS = 2;
/** This many services with no load to justify them reads as premature distribution. */
export const OVERENGINEERING_SERVICE_COUNT = 3;
/** Peak rps a single modular monolith carries without breaking a sweat. */
export const SMALL_SCALE_RPS = 100;
/** Annotation words that mean "regulated data lives here". */
export const SENSITIVE_DATA_PATTERN =
  /\b(pii|personally[- ]identifiable|cards?|credit[- ]card|ssn|passports?|health|phi|hipaa)\b/i;

// ------------------------------------------------------------------ helpers ---

interface Normalized {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  flows: readonly Flow[];
  byId: ReadonlyMap<string, GraphNode>;
}

/** Defensive copy of the arrays we read. Never touches the caller's graph. */
function normalize(graph: GraphDSL): Normalized {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const flows = graph?.flows ?? [];
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) byId.set(node.id, node);
  return { nodes, edges, flows, byId };
}

function finding(
  severity: Severity,
  rule: string,
  message: string,
  fix: string,
  nodeIds: string[],
  edgeIds: string[],
  concept?: string,
): TopologyFinding {
  return {
    severity,
    rule,
    message,
    fix,
    nodeIds,
    edgeIds,
    ...(concept !== undefined ? { concept } : {}),
  };
}

function has(nodes: readonly GraphNode[], type: ArchNodeType): boolean {
  return nodes.some((n) => n.type === type);
}

function hasAny(nodes: readonly GraphNode[], types: ReadonlySet<ArchNodeType>): boolean {
  return nodes.some((n) => types.has(n.type));
}

function idsOf(nodes: readonly GraphNode[], predicate: (n: GraphNode) => boolean): string[] {
  return nodes.filter(predicate).map((n) => n.id);
}

function replicasOf(node: GraphNode): number {
  const replicas = node.attrs?.replicas;
  return typeof replicas === 'number' && replicas > 0 ? replicas : 1;
}

function mentions(text: string | undefined, needle: string): boolean {
  return (text ?? '').toLowerCase().includes(needle);
}

/** Plain-English list: "A", "A and B", "A, B and C". */
function listLabels(nodes: readonly GraphNode[]): string {
  const labels = nodes.map((n) => n.label || n.id);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export interface ReachOptions {
  /**
   * Edge kinds the walk may follow. Default: sync + async — the request paths.
   * `replication` is a data-copy, not a way for a request to travel.
   */
  kinds?: ReadonlySet<EdgeKind>;
  /**
   * Types that terminate the walk: they are reported as reached, but nothing
   * behind them is. This is how "is X reachable with no guardrail in between"
   * becomes a plain BFS — block the guardrails, then ask whether X still shows up.
   */
  blockTypes?: ReadonlySet<ArchNodeType>;
}

const DEFAULT_REACH_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['sync', 'async']);

/**
 * Everything reachable from `startIds` following edge direction.
 *
 * Deliberately edge-based and order-preserving: the queue is seeded and drained
 * in graph order, so the returned set has a stable iteration order too.
 */
export function reachableFrom(
  graph: GraphDSL,
  startIds: readonly string[],
  opts: ReachOptions = {},
): Set<string> {
  const { edges, byId } = normalize(graph);
  const kinds = opts.kinds ?? DEFAULT_REACH_KINDS;
  const blockTypes = opts.blockTypes;

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const id of startIds) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
  const starts = new Set(queue);

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) continue;
    const node = byId.get(current);
    // A blocking node is still reported as reached — the walk just stops there.
    // A start node is never blocked by itself, or nothing would ever be walked.
    if (node && blockTypes?.has(node.type) === true && !starts.has(current)) continue;
    for (const edge of edges) {
      if (edge.from !== current) continue;
      if (!kinds.has(edge.kind)) continue;
      if (!byId.has(edge.to)) continue;
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

/**
 * "Is there a path from one of `startIds` to `targetId` with none of `protect`
 * on it?"
 *
 * Declared flows win over raw edges wherever a flow mentions the target: a flow
 * IS the author's own statement of which path a request takes, so if they wrote
 * `client -> gateway -> service` we judge that path and do not go hunting for a
 * shortcut through the edge list that they never claimed a request uses. Only
 * when no flow mentions the target do we fall back to a BFS over edges.
 */
function unprotectedPathExists(
  graph: Normalized,
  startIds: readonly string[],
  targetId: string,
  protect: ReadonlySet<ArchNodeType>,
): boolean {
  const starts = new Set(startIds);
  const isProtective = (id: string): boolean => {
    const node = graph.byId.get(id);
    return node !== undefined && protect.has(node.type);
  };

  let anyFlowCoversTarget = false;
  for (const flow of graph.flows) {
    const steps = flow.steps ?? [];
    const targetIdx = steps.indexOf(targetId);
    if (targetIdx < 0) continue;
    let startIdx = -1;
    for (let i = 0; i < targetIdx; i += 1) {
      const step = steps[i];
      if (step !== undefined && starts.has(step)) {
        startIdx = i;
        break;
      }
    }
    if (startIdx < 0) continue;
    anyFlowCoversTarget = true;
    const guarded = steps.slice(startIdx, targetIdx + 1).some((id) => isProtective(id));
    if (!guarded) return true;
  }
  if (anyFlowCoversTarget) return false;

  const reached = reachableFrom(
    { nodes: [...graph.nodes], edges: [...graph.edges], stickies: [], flows: [] },
    startIds,
    { blockTypes: protect },
  );
  return reached.has(targetId) && !starts.has(targetId);
}

/** Union of "downstream via edges" and "later in a flow that mentions it". */
function downstreamOf(graph: Normalized, nodeId: string): Set<string> {
  const out = reachableFrom(
    { nodes: [...graph.nodes], edges: [...graph.edges], stickies: [], flows: [] },
    [nodeId],
  );
  out.delete(nodeId);
  for (const flow of graph.flows) {
    const steps = flow.steps ?? [];
    const idx = steps.indexOf(nodeId);
    if (idx < 0) continue;
    for (const later of steps.slice(idx + 1)) {
      if (graph.byId.has(later)) out.add(later);
    }
  }
  return out;
}

/**
 * Something that can always regenerate what the cache holds. A durable store
 * obviously counts; so does a model or a third-party API, because a prompt cache
 * losing an entry means one extra (expensive) call, not lost data.
 */
const REBUILDABLE_BEHIND_CACHE: ReadonlySet<ArchNodeType> = new Set([
  ...DURABLE_TYPES,
  'llm',
  'agent_runtime',
  'third_party',
]);

/** Which node ids each user-facing flow touches, and the flow that touched them. */
function userFacingFlowByNode(graph: Normalized): Map<string, Flow> {
  const out = new Map<string, Flow>();
  for (const flow of graph.flows) {
    if (!USER_FACING_FLOW_KINDS.has(flow.kind)) continue;
    for (const step of flow.steps ?? []) {
      if (!out.has(step) && graph.byId.has(step)) out.set(step, flow);
    }
  }
  return out;
}

/**
 * Two stores only replicate if they are the same kind of store. A read replica
 * is the accepted stand-in for its primary (relational or document); everything
 * else that people draw as "replication" is really a feed or an invalidation.
 */
function sameReplicationFamily(a: ArchNodeType, b: ArchNodeType): boolean {
  if (a === b) return true;
  const replicaOf: ReadonlySet<ArchNodeType> = new Set(['sql_db', 'nosql_db']);
  if (a === 'read_replica' && replicaOf.has(b)) return true;
  if (b === 'read_replica' && replicaOf.has(a)) return true;
  return false;
}

/** A circuit breaker is a pattern, not a node type — accept a label or a mesh. */
function hasCircuitProtection(nodes: readonly GraphNode[]): boolean {
  return nodes.some(
    (n) =>
      n.type === 'service_mesh' || mentions(n.label, 'circuit') || mentions(n.label, 'breaker'),
  );
}

function clientWord(node: GraphNode): string {
  return node.type === 'mobile_client' ? 'a phone in someone else’s hand' : 'a browser';
}

// ============================================================================
// Single-edge rules — shared by checkTopology and checkConnection so the live
// hint while you drag and the report afterwards can never disagree.
// ============================================================================

/** Rule 1 — client wired straight into storage or a broker. */
function ruleClientDirectToDatastore(
  from: GraphNode,
  to: GraphNode,
  kind: EdgeKind,
  edgeIds: string[],
): TopologyFinding | undefined {
  if (kind !== 'sync') return undefined;
  if (!CLIENT_TYPES.has(from.type)) return undefined;
  const isStore = DATASTORE_TYPES.has(to.type);
  const isBuffer = BUFFER_TYPES.has(to.type);
  if (!isStore && !isBuffer) return undefined;
  const message = isStore
    ? `${from.label} talking straight to ${to.label} means shipping database credentials to every user — ` +
      `${clientWord(from)} can then read or delete any row it likes, with nothing checking who it is ` +
      `and nothing limiting how often it asks.`
    : `${from.label} publishing straight into ${to.label} hands broker credentials to every user — ` +
      `anyone can inject messages your workers will happily process as if you had produced them.`;
  return finding(
    'error',
    'client-direct-to-datastore',
    message,
    `Put a service or an api_gateway between them: the client calls an authenticated endpoint you own, ` +
      `and only that server-side component holds ${to.label}'s credentials, enforces authorization and rate-limits.`,
    [from.id, to.id],
    edgeIds,
    'authn-authz',
  );
}

/** Rule 2 — "replication" between two things that cannot replicate each other. */
function ruleReplicationBetweenUnlikeStores(
  from: GraphNode,
  to: GraphNode,
  kind: EdgeKind,
  edgeIds: string[],
): TopologyFinding | undefined {
  if (kind !== 'replication') return undefined;
  const bothStores = DURABLE_TYPES.has(from.type) && DURABLE_TYPES.has(to.type);
  if (bothStores && sameReplicationFamily(from.type, to.type)) return undefined;
  const reason = bothStores
    ? `they are different kinds of store, so neither can be a byte-for-byte copy of the other`
    : `replication copies one store into another, and ${
        DURABLE_TYPES.has(from.type) ? to.label : from.label
      } is not a store`;
  return finding(
    'error',
    'replication-between-unlike-stores',
    `The replication edge between ${from.label} and ${to.label} claims one is a copy of the other, but ${reason} — ` +
      `nothing here is replicating.`,
    `If this is cache invalidation or a data feed, draw it as a sync or async call instead; if a store's changes ` +
      `should fan out to another system, put a cdc_connector between them and make the edge async.`,
    [from.id, to.id],
    edgeIds,
    'replication',
  );
}

/** Rule 3 — a sync edge leaving a buffer. Producing is a write; consuming is a pull. */
function ruleSyncOutOfQueue(
  from: GraphNode,
  to: GraphNode,
  kind: EdgeKind,
  edgeIds: string[],
): TopologyFinding | undefined {
  if (kind !== 'sync') return undefined;
  if (!BUFFER_TYPES.has(from.type)) return undefined;
  return finding(
    'error',
    'sync-into-queue',
    `This sync edge has ${from.label} calling ${to.label}, but a queue never calls anyone — ` +
      `consumers pull from it on their own schedule, which is the entire reason the queue is there.`,
    `Make it an async edge from ${from.label} to ${to.label} (the consumer polls or subscribes). ` +
      `Keep sync edges pointing INTO the queue: producing a message is a synchronous write.`,
    [from.id, to.id],
    edgeIds,
    'queue-backpressure',
  );
}

/** Rule 15 — the edge cache placed behind the thing it exists to protect. */
function ruleCdnBehindApp(
  from: GraphNode,
  to: GraphNode,
  kind: EdgeKind,
  edgeIds: string[],
): TopologyFinding | undefined {
  if (kind !== 'sync') return undefined;
  if (to.type !== 'cdn') return undefined;
  if (from.type !== 'service' && from.type !== 'monolith') return undefined;
  return finding(
    'warning',
    'cdn-behind-app',
    `${to.label} sits behind ${from.label}, so every byte is served by your own compute before the CDN ever sees it — ` +
      `the edge cache is downstream of the thing it was supposed to shield.`,
    `Reverse the arrow: client → ${to.label} → ${from.label}, so cache hits never reach your servers ` +
      `and only misses become origin traffic.`,
    [from.id, to.id],
    edgeIds,
    'cdn',
  );
}

/** checkConnection extra — a store reaching back into your code. */
function ruleDatastoreCallsService(
  from: GraphNode,
  to: GraphNode,
  kind: EdgeKind,
  edgeIds: string[],
): TopologyFinding | undefined {
  if (kind !== 'sync') return undefined;
  if (!DURABLE_TYPES.has(from.type)) return undefined;
  if (!COMPUTE_TYPES.has(to.type)) return undefined;
  return finding(
    'warning',
    'datastore-calls-service',
    `This arrow has ${from.label} calling ${to.label}, but databases do not call your code — ` +
      `your code queries them, and an arrow pointing the other way hides who actually initiates the work.`,
    `Flip the edge if ${to.label} is the caller. If you really mean "when the data changes, run this", ` +
      `that is change capture: add a cdc_connector and draw the edge async.`,
    [from.id, to.id],
    edgeIds,
    'outbox',
  );
}

// ============================================================================
// checkTopology
// ============================================================================

/**
 * Reviews a whole design. Returns findings ordered error → warning → info, and
 * within each group in rule order (which, because every rule iterates the graph
 * arrays in order, is stable for a given graph).
 */
export function checkTopology(graph: GraphDSL): TopologyFinding[] {
  const g = normalize(graph);
  const { nodes, edges, flows, byId } = g;

  const errors: TopologyFinding[] = [];
  const warnings: TopologyFinding[] = [];
  const infos: TopologyFinding[] = [];

  const archNodes = nodes.filter((n) => n.type !== 'group');
  const clientIds = idsOf(nodes, (n) => CLIENT_TYPES.has(n.type));
  const flowByNode = userFacingFlowByNode(g);

  // ---------------------------------------------------------------- errors ---
  // Rules 1-4: the design cannot work as drawn, at any traffic level.

  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue; // a dangling edge is the canvas's problem, not a design flaw
    const single =
      ruleClientDirectToDatastore(from, to, edge.kind, [edge.id]) ??
      ruleReplicationBetweenUnlikeStores(from, to, edge.kind, [edge.id]) ??
      ruleSyncOutOfQueue(from, to, edge.kind, [edge.id]);
    if (single) errors.push(single);
  }

  // Rule 4a — a store that only ever receives data through a cache.
  for (const store of nodes) {
    if (!DATASTORE_TYPES.has(store.type)) continue;
    const inboundWrites = edges.filter(
      (e) => e.to === store.id && e.kind !== 'replication' && byId.has(e.from),
    );
    if (inboundWrites.length === 0) continue;
    const sources = inboundWrites.map((e) => byId.get(e.from)!);
    if (!sources.every((s) => CACHE_TYPES.has(s.type))) continue;
    errors.push(
      finding(
        'error',
        'cache-as-system-of-record',
        `Every write that reaches ${store.label} arrives through ${listLabels(sources)} — ` +
          `an eviction or a cache restart before that data is flushed and the write simply never happened.`,
        `Write to ${store.label} first and let the cache follow (write-through or invalidate-on-write). ` +
          `The durable store, not the cache, has to be the thing that accepts the write.`,
        [store.id, ...sources.map((s) => s.id)],
        inboundWrites.map((e) => e.id),
        'caching',
      ),
    );
  }

  // Rule 4b — a cache with nothing behind it is the system of record by accident.
  for (const cache of nodes) {
    if (!CACHE_TYPES.has(cache.type)) continue;
    const wired =
      edges.some((e) => e.from === cache.id || e.to === cache.id) ||
      flows.some((f) => (f.steps ?? []).includes(cache.id));
    if (!wired) continue; // an unwired cache is rule 5's story, not this one
    const downstream = downstreamOf(g, cache.id);
    let backed = false;
    for (const id of downstream) {
      const node = byId.get(id);
      if (node && REBUILDABLE_BEHIND_CACHE.has(node.type)) {
        backed = true;
        break;
      }
    }
    if (backed) continue;
    errors.push(
      finding(
        'error',
        'cache-as-system-of-record',
        `Nothing durable sits behind ${cache.label}, which makes it the system of record — and a cache is ` +
          `allowed to forget: one eviction, one restart, and that data is gone with no way to rebuild it.`,
        `Put a datastore behind ${cache.label} and treat the cache as a disposable copy — ` +
          `everything in it must be reconstructible from something that survives a restart.`,
        [cache.id],
        [],
        'caching',
      ),
    );
  }

  // -------------------------------------------------------------- warnings ---
  // Rule 5 — drawn but not part of the design.

  for (const node of nodes) {
    if (OFF_TO_THE_SIDE_TYPES.has(node.type)) continue;
    const touched =
      edges.some((e) => e.from === node.id || e.to === node.id) ||
      flows.some((f) => (f.steps ?? []).includes(node.id));
    if (touched) continue;
    warnings.push(
      finding(
        'warning',
        'orphan-node',
        `${node.label} is on the canvas but nothing connects to it and no flow names it, ` +
          `so it plays no part in the design as drawn — a reviewer cannot tell what you meant it to do.`,
        `Wire it into the path it belongs on, add it to a flow's steps, or delete it. ` +
          `A component that carries no traffic and no data is a note, not a decision.`,
        [node.id],
        [],
      ),
    );
  }

  // Rule 6 — a model a user can reach with nothing reading the prompt first.
  for (const model of nodes) {
    if (!MODEL_TYPES.has(model.type)) continue;
    if (clientIds.length === 0) continue;
    if (!unprotectedPathExists(g, clientIds, model.id, LLM_GUARD_TYPES)) continue;
    warnings.push(
      finding(
        'warning',
        'llm-without-guardrail',
        `A request reaches ${model.label} from the client with nothing in between inspecting the prompt, ` +
          `so whatever a user types — or whatever a retrieved document happens to say — arrives as instructions to the model.`,
        `Put a guardrail in front of ${model.label} to screen input and output, an eval_gate on the responses that ` +
          `matter, and a rate_limiter so an abusive caller cannot iterate until something gets through.`,
        [model.id],
        [],
        'prompt-injection-defense',
      ),
    );
  }

  // Rule 7 — a model with no ceiling on the bill.
  const llmIds = idsOf(nodes, (n) => n.type === 'llm');
  if (llmIds.length > 0 && !hasAny(nodes, LLM_COST_CEILING_TYPES)) {
    warnings.push(
      finding(
        'warning',
        'llm-no-cost-ceiling',
        `There is a model in this design and nothing bounding what it costs — no rate limiter, no prompt cache, ` +
          `and no cheaper model to route the easy requests to, so a retry loop or one enthusiastic user is an unbounded bill.`,
        `Add a rate_limiter per user or tenant, a prompt_cache for repeated prompts, and a model_router ` +
          `so only the requests that need the expensive model get it.`,
        llmIds,
        [],
        'llm-cost-control',
      ),
    );
  }

  // Rule 8 — someone else's latency, inline, where a user is waiting.
  const circuitProtected = hasCircuitProtection(nodes);
  if (!circuitProtected) {
    const reportedRisk = new Set<string>();
    for (const flow of flows) {
      if (!USER_FACING_FLOW_KINDS.has(flow.kind)) continue;
      for (const step of flow.steps ?? []) {
        const node = byId.get(step);
        if (!node) continue;
        if (node.type !== 'third_party' && node.type !== 'llm') continue;
        if (reportedRisk.has(node.id)) continue;
        reportedRisk.add(node.id);
        warnings.push(
          finding(
            'warning',
            'third-party-on-sync-user-path',
            `${node.label} sits inline on "${flow.name}" where a user is waiting, and nothing in this design ever ` +
              `stops calling it — the day it answers in 30 seconds instead of 300ms, your threads fill with its ` +
              `pending calls and every request on this path dies with it.`,
            `Give the call a hard timeout, wrap it in a circuit breaker (a labelled breaker node or a service_mesh) ` +
              `so repeated failures fail fast, and decide now what the user sees when it is open.`,
            [node.id],
            [],
            'circuit-breaker',
          ),
        );
      }
    }
  }

  // Rules 9 and 10 — the buffer nobody drains, and the poison message with nowhere to go.
  const hasDlq = has(nodes, 'dead_letter_queue');
  const hasThirdParty = has(nodes, 'third_party');
  for (const buffer of nodes) {
    if (!WORK_BUFFER_TYPES.has(buffer.type)) continue;
    const consumerEdges = edges.filter((e) => {
      if (e.from !== buffer.id || e.kind !== 'async') return false;
      const target = byId.get(e.to);
      return target !== undefined && CONSUMER_TYPES.has(target.type);
    });
    if (consumerEdges.length === 0) {
      warnings.push(
        finding(
          'warning',
          'queue-without-consumer',
          `${buffer.label} accepts messages and nothing consumes them, so it is a buffer that only ever fills — ` +
            `the work is not deferred, it is discarded once the depth limit is reached.`,
          `Attach a worker (or service, serverless_fn, workflow_engine) on an async edge out of ${buffer.label}, ` +
            `and say how many of them run when the backlog grows.`,
          [buffer.id],
          [],
          'queue-backpressure',
        ),
      );
      continue;
    }
    if (!hasDlq) {
      warnings.push(
        finding(
          'warning',
          'queue-without-dlq',
          `${buffer.label} has consumers but nowhere to put a message they cannot process, so the first bad payload ` +
            `is retried forever at the head of the queue — or dropped silently, which is worse because nobody finds out.`,
          `Add a dead_letter_queue, route messages there after a bounded number of attempts, and alarm on its depth: ` +
            `a DLQ with items in it is the cheapest bug report you will ever get.`,
          [buffer.id],
          [],
          hasThirdParty ? 'webhook-reliability' : 'exactly-once',
        ),
      );
    }
  }

  // Rule 11 — a client reaching your code with nothing establishing who it is.
  if (clientIds.length > 0) {
    const unprotected = nodes.filter(
      (n) =>
        AUTH_TARGET_TYPES.has(n.type) &&
        !AUTH_BOUNDARY_TYPES.has(n.type) && // an api_gateway IS the boundary
        unprotectedPathExists(g, clientIds, n.id, AUTH_BOUNDARY_TYPES),
    );
    if (unprotected.length > 0) {
      const firstClient = byId.get(clientIds[0]!)!;
      warnings.push(
        finding(
          'warning',
          'no-auth-boundary',
          `Nothing on the path from ${firstClient.label} to ${listLabels(unprotected)} establishes who the caller is, ` +
            `so every request is trusted simply because it arrived — there is no point in the design where "is this ` +
            `user allowed to do this" gets asked.`,
          `Enforce authentication at one boundary and only one: an api_gateway that validates the token, or an auth ` +
            `service (or iam) the entry point calls before anything else. Then pass a verified identity inward.`,
          [firstClient.id, ...unprotected.map((n) => n.id)],
          [],
          'authn-authz',
        ),
      );
    }
  }

  // Rule 12 — dual write into a database and a search index with nothing reconciling them.
  for (const edge of edges) {
    if (edge.kind !== 'sync') continue;
    const writer = byId.get(edge.from);
    const index = byId.get(edge.to);
    if (!writer || !index) continue;
    if (index.type !== 'search_index') continue;
    if (!COMPUTE_TYPES.has(writer.type)) continue;
    const dbEdge = edges.find((e) => {
      if (e.from !== writer.id || e.kind === 'replication') return false;
      const target = byId.get(e.to);
      return target !== undefined && (target.type === 'sql_db' || target.type === 'nosql_db');
    });
    if (!dbEdge) continue;
    const db = byId.get(dbEdge.to)!;
    warnings.push(
      finding(
        'warning',
        'search-index-written-synchronously',
        `${writer.label} writes to ${db.label} and ${index.label} in the same request, so the moment the second write ` +
          `fails the two stores disagree — and nothing in this design ever notices or repairs the difference.`,
        `Commit once, to ${db.label}, writing an outbox row in the same transaction; have a relay (or a cdc_connector ` +
          `tailing the log) feed ${index.label} asynchronously. Search lag you can explain; silent drift you cannot.`,
        [writer.id, db.id, index.id],
        [dbEdge.id, edge.id],
        'outbox',
      ),
    );
  }

  // Rule 13 — one instance of something stateful, on a path a user is waiting on.
  for (const node of nodes) {
    if (!STATEFUL_TYPES.has(node.type)) continue;
    if (replicasOf(node) > 1) continue;
    const flow = flowByNode.get(node.id);
    if (!flow) continue;
    warnings.push(
      finding(
        'warning',
        'stateful-single-replica',
        `${node.label} carries "${flow.name}" on a single instance, and it holds state — so losing it is not a ` +
          `degraded response, it is the flow being down until someone restores it.`,
        `Set replicas to 2 or more and say what the second one is: a standby you fail over to, a read_replica for ` +
          `reads, or a partitioned cluster. Then draw the failover path so it is a decision, not a hope.`,
        [node.id],
        [],
        'spof',
      ),
    );
  }

  // Rule 14 — balancing across one thing.
  for (const lb of nodes) {
    if (lb.type !== 'load_balancer' && lb.type !== 'reverse_proxy') continue;
    const targetIds: string[] = [];
    const usedEdgeIds: string[] = [];
    for (const edge of edges) {
      if (edge.from !== lb.id || edge.kind !== 'sync') continue;
      if (!byId.has(edge.to) || targetIds.includes(edge.to)) continue;
      targetIds.push(edge.to);
      usedEdgeIds.push(edge.id);
    }
    const byType = new Map<ArchNodeType, number>();
    for (const id of targetIds) {
      const type = byId.get(id)!.type;
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    let widest = 0;
    for (const count of byType.values()) widest = Math.max(widest, count);
    if (widest >= MIN_LB_BACKENDS) continue;
    const what =
      targetIds.length === 0
        ? 'nothing at all'
        : `a single ${byId.get(targetIds[0]!)!.label}`;
    warnings.push(
      finding(
        'warning',
        'lb-without-backends',
        `${lb.label} balances across ${what} — one instance behind a load balancer is an extra hop and an extra ` +
          `thing to fail, not redundancy; when that instance dies the balancer keeps forwarding to a corpse.`,
        `Put at least ${MIN_LB_BACKENDS} interchangeable instances of the same type behind ${lb.label} and add a ` +
          `health check, so a failing one is taken out of rotation instead of receiving its share of traffic.`,
        [lb.id, ...targetIds],
        usedEdgeIds,
        'load-balancing',
      ),
    );
  }

  // Rule 15 — CDN behind the app it should be in front of.
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const hit = ruleCdnBehindApp(from, to, edge.kind, [edge.id]);
    if (hit) warnings.push(hit);
  }

  // Rule 16 — an analytical store answering a user request.
  for (const node of nodes) {
    if (!ANALYTICAL_TYPES.has(node.type)) continue;
    const flow = flowByNode.get(node.id);
    if (!flow) continue;
    warnings.push(
      finding(
        'warning',
        'warehouse-on-user-path',
        `${node.label} is built to scan columns for seconds at a time, and "${flow.name}" puts it in front of a user ` +
          `waiting on milliseconds — the first concurrent burst turns every request on this path into a timeout.`,
        `Serve this path from an OLTP store or a cache holding the precomputed answer, and feed ${node.label} ` +
          `asynchronously for the analysis it is actually good at.`,
        [node.id],
        [],
        'capacity-estimation',
      ),
    );
  }

  // Rule 17 — vectors with nothing to produce them.
  const hasEmbedder = has(nodes, 'embedding_svc');
  for (const store of nodes) {
    if (store.type !== 'vector_db') continue;
    if (hasEmbedder) continue;
    if (mentions(store.annotation, 'embed')) continue;
    warnings.push(
      finding(
        'warning',
        'vector-db-without-embedder',
        `${store.label} stores vectors but nothing in this design turns text into them, so there is no way to fill ` +
          `the index and no way to embed the query you are searching with.`,
        `Add an embedding_svc on both the ingest path and the query path (the same model on both, or the distances ` +
          `are meaningless), and note the model version so a reindex is possible later.`,
        [store.id],
        [],
        'rag-retrieval',
      ),
    );
  }

  // Rule 18 — regulated data leaving the building with no key management.
  const hasKms = has(nodes, 'kms');
  if (!hasKms) {
    for (const edge of edges) {
      if (edge.kind !== 'sync') continue;
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const sensitive = SENSITIVE_DATA_PATTERN.test(from.annotation ?? '')
        ? from
        : SENSITIVE_DATA_PATTERN.test(to.annotation ?? '')
          ? to
          : undefined;
      if (!sensitive) continue;
      const external = from.type === 'third_party' ? from : to.type === 'third_party' ? to : undefined;
      if (!external || external.id === sensitive.id) continue;
      warnings.push(
        finding(
          'warning',
          'pii-unencrypted-third-party',
          `${sensitive.label} is annotated as holding sensitive personal data and hands it to ${external.label} ` +
            `over a plain call, with no key management anywhere in this design — you cannot say who can decrypt it, ` +
            `or rotate anything the day that vendor is breached.`,
          `Add a kms and encrypt the field before it leaves, or better, do not send it: tokenize the value and pass ` +
            `the token to ${external.label}. Record what leaves in an audit_log.`,
          [sensitive.id, external.id],
          [edge.id],
          'encryption',
        ),
      );
    }
  }

  // ------------------------------------------------------------------ info ---

  // Rule 19 — no way to see what happened.
  if (archNodes.length >= MIN_NODES_FOR_OBSERVABILITY && !has(nodes, 'observability')) {
    infos.push(
      finding(
        'info',
        'no-observability',
        `${archNodes.length} components and nothing collecting metrics, logs or traces — when this misbehaves in ` +
          `production the fastest available answer will be a guess.`,
        `Add an observability node and name the golden signals per hop (rate, errors, duration, saturation) plus one ` +
          `trace id that survives the whole flow. Alert on what users feel, not on CPU.`,
        [],
        [],
        'observability',
      ),
    );
  }

  // Rule 20 — components without paths.
  if (flows.length === 0) {
    infos.push(
      finding(
        'info',
        'no-flows-declared',
        `No flows are declared, so this is an inventory of components rather than a design — nothing states what ` +
          `actually happens when a user does something.`,
        `Name your two or three main paths (one read, one write, one background job) and list the nodes each one ` +
          `traverses. Flows are what unlock load simulation and the step-by-step review of the path.`,
        [],
        [],
      ),
    );
  }

  // Rule 21 — distribution bought before the load that pays for it.
  const serviceIds = idsOf(nodes, (n) => n.type === 'service');
  if (serviceIds.length >= OVERENGINEERING_SERVICE_COUNT && flows.length > 0) {
    let peak = 0;
    for (const flow of flows) peak = Math.max(peak, flow.rps ?? 0);
    if (peak < SMALL_SCALE_RPS) {
      infos.push(
        finding(
          'info',
          'overengineered-for-scale',
          `${serviceIds.length} separate services for a peak of ${peak} rps — every one of them is a deploy, a ` +
            `dashboard, a network hop and a partial-failure mode you are paying for with no load that requires them.`,
          `A modular monolith carries this load comfortably on one deploy. Keep the module boundaries you would have ` +
            `drawn as services, and split the first one out when a real number forces it — different scaling profile, ` +
            `different team, or a genuinely different availability requirement.`,
          serviceIds,
          [],
          'overengineering-avoidance',
        ),
      );
    }
  }

  return [...errors, ...warnings, ...infos];
}

// ============================================================================
// checkConnection
// ============================================================================

/**
 * Can these two be connected this way at all? Used for live feedback while
 * drawing, so it only covers what a single edge can prove on its own: no graph,
 * no flows, no reachability. Everything here is also checked by checkTopology,
 * from the same helpers, so the hint under the cursor can never contradict the
 * report. Findings carry no edge id because the edge does not exist yet.
 */
export function checkConnection(from: GraphNode, to: GraphNode, kind: EdgeKind): TopologyFinding[] {
  const out: TopologyFinding[] = [];
  const push = (f: TopologyFinding | undefined): void => {
    if (f) out.push(f);
  };

  push(ruleClientDirectToDatastore(from, to, kind, []));
  push(ruleReplicationBetweenUnlikeStores(from, to, kind, []));
  push(ruleSyncOutOfQueue(from, to, kind, []));
  push(ruleCdnBehindApp(from, to, kind, []));
  push(ruleDatastoreCallsService(from, to, kind, []));

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank[a.f.severity] - rank[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

export default checkTopology;
