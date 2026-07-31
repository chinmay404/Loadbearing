// Deterministic load-simulation engine.
//
// This is a *teaching* model, not a queueing-theory thesis. It answers the four
// questions a beginner needs answered the moment they finish a diagram:
//   1. Where does this break first?   (utilization / bottleneck)
//   2. How much traffic do I lose?    (droppedRps / completedRps)
//   3. How slow does it get?          (congestion-amplified latency, p50/p99)
//   4. What did I forget?             (findings: SPOF, cache, backpressure, AZ)
//
// Properties this file guarantees:
//   * pure — no I/O, no Date, no Math.random, no mutation of the inputs.
//   * deterministic — same (graph, config) always yields the identical SimResult,
//     including string ordering (we only ever iterate graph arrays in-order).

import type {
  ArchNodeType,
  Flow,
  GraphDSL,
  GraphEdge,
  GraphNode,
  NodeState,
  SimConfig,
  SimFlowResult,
  SimNodeResult,
  SimResult,
} from './types.js';

// ---------------------------------------------------------------- catalog ----

/** Requests per second a SINGLE replica handles before it saturates. */
export const DEFAULT_CAPACITY: Record<ArchNodeType, number> = {
  // Traffic origins and logical containers never constrain anything.
  client: Number.POSITIVE_INFINITY,
  mobile_client: Number.POSITIVE_INFINITY,
  group: Number.POSITIVE_INFINITY,
  // Edge / routing tier: cheap, in-memory, absurdly fast.
  cdn: 200_000,
  dns: 100_000,
  geo_router: 100_000,
  load_balancer: 50_000,
  api_gateway: 20_000,
  rate_limiter: 40_000,
  observability: 50_000,
  websocket_gw: 10_000,
  waf: 40_000,
  reverse_proxy: 40_000,
  service_mesh: 30_000,
  sidecar: 30_000,
  // Caches and pipes.
  cache: 80_000,
  queue: 20_000,
  stream: 30_000,
  event_bus: 25_000,
  dead_letter_queue: 20_000,
  change_feed: 8_000,
  webhook_dispatcher: 2_000,
  prompt_cache: 50_000,
  feature_flags: 50_000,
  connection_pooler: 20_000,
  // Compute: this is where real designs actually run out of room.
  service: 500,
  monolith: 800,
  serverless_fn: 1_000,
  edge_function: 5_000,
  vm: 300,
  worker: 300,
  scheduler: 1_000,
  batch_scheduler: 500,
  auth: 2_000,
  eval_gate: 500,
  bff: 400,
  graphql_gateway: 800,
  workflow_engine: 500,
  saga_orchestrator: 400,
  // Control planes: they orchestrate, they do not sit on the request path.
  container_platform: 50_000,
  bastion: 50,
  // Storage.
  sql_db: 3_000,
  read_replica: 3_000,
  db_proxy: 15_000,
  sharded_cluster: 12_000,
  nosql_db: 8_000,
  search_index: 2_000,
  blob_store: 5_000,
  vector_db: 1_000,
  timeseries_db: 5_000,
  graph_db: 1_500,
  feature_store: 3_000,
  materialized_view: 8_000,
  session_store: 40_000,
  ledger_db: 1_500,
  feedback_store: 3_000,
  experiment_platform: 20_000,
  // Analytical stores: built for scans and columns, not for per-request reads.
  data_warehouse: 50,
  olap_db: 200,
  data_lake: 100,
  cdc_connector: 5_000,
  // Security plane: fast, cacheable, and on every call whether you like it or not.
  iam: 5_000,
  kms: 10_000,
  audit_log: 20_000,
  secrets_manager: 5_000,
  // Batch and pipelines: measured in jobs, not in requests per second.
  batch_job: 50,
  ci_cd: 10,
  backup_store: 20,
  transcoder: 5,
  // Media origin: request-cheap, bandwidth-expensive.
  media_streamer: 20_000,
  // Anything you do not own, and the expensive new stuff.
  third_party: 200,
  payment_gateway: 150,
  email_provider: 500,
  sms_provider: 200,
  push_service: 5_000,
  identity_provider: 1_000,
  llm: 20,
  embedding_svc: 100,
  model_router: 5_000,
  guardrail: 200,
  reranker: 100,
  agent_runtime: 10,
  doc_source: 2_000,
  doc_parser: 5,
  chunker: 500,
  extractor: 15,
  output_validator: 2_000,
  retriever: 300,
  tool_sandbox: 50,
  mcp_server: 200,
  agent_memory: 3_000,
  pii_redactor: 1_500,
  legacy_system: 80,
  strangler_facade: 8_000,
  reconciler: 20,
  model_server: 8,
  dataset_store: 500,
  // A training run is not request-serving work. One job at a time, measured in
  // hours — which is exactly why it must never appear on a user-facing flow.
  fine_tune_job: 1,
  cell_router: 20_000,
  idempotency_store: 20_000,
  service_registry: 5_000,
  sync_engine: 400,
  offline_store: 5_000,
  chaos_injector: 100,
  budget_guard: 5_000,
  siem: 2_000,
  consent_store: 3_000,
  // One reviewer, not one server. Replicas are people here, and that is the
  // point: a human step on a synchronous path shows up in the arithmetic as one.
  human_review: 1,
};

/** Service time at low load, milliseconds. */
export const DEFAULT_LATENCY: Record<ArchNodeType, number> = {
  client: 0,
  mobile_client: 0,
  group: 0,
  cdn: 15,
  dns: 20,
  geo_router: 20,
  load_balancer: 2,
  api_gateway: 5,
  rate_limiter: 1,
  observability: 2,
  websocket_gw: 5,
  waf: 3,
  reverse_proxy: 2,
  service_mesh: 1,
  sidecar: 1,
  cache: 1,
  queue: 3,
  stream: 3,
  event_bus: 4,
  dead_letter_queue: 3,
  change_feed: 20,
  webhook_dispatcher: 60,
  prompt_cache: 2,
  feature_flags: 1,
  connection_pooler: 1,
  service: 40,
  monolith: 60,
  serverless_fn: 50,
  edge_function: 20,
  vm: 50,
  worker: 50,
  scheduler: 5,
  batch_scheduler: 10,
  auth: 20,
  eval_gate: 200,
  bff: 45,
  graphql_gateway: 35,
  workflow_engine: 30,
  saga_orchestrator: 40,
  container_platform: 1,
  bastion: 30,
  sql_db: 8,
  read_replica: 8,
  db_proxy: 2,
  sharded_cluster: 8,
  nosql_db: 5,
  search_index: 25,
  blob_store: 30,
  vector_db: 30,
  timeseries_db: 10,
  graph_db: 20,
  feature_store: 15,
  materialized_view: 4,
  session_store: 2,
  ledger_db: 12,
  feedback_store: 10,
  experiment_platform: 3,
  data_warehouse: 2_000,
  olap_db: 500,
  data_lake: 1_000,
  cdc_connector: 50,
  iam: 15,
  kms: 5,
  audit_log: 5,
  secrets_manager: 5,
  batch_job: 5_000,
  ci_cd: 60_000,
  backup_store: 2_000,
  transcoder: 20_000,
  media_streamer: 25,
  third_party: 250,
  payment_gateway: 450,
  email_provider: 300,
  sms_provider: 500,
  push_service: 150,
  identity_provider: 220,
  llm: 1_200,
  embedding_svc: 80,
  model_router: 5,
  guardrail: 150,
  reranker: 120,
  agent_runtime: 4_000,
  doc_source: 40,
  doc_parser: 2_500,
  chunker: 20,
  extractor: 1_800,
  output_validator: 8,
  retriever: 90,
  tool_sandbox: 600,
  mcp_server: 120,
  agent_memory: 15,
  pii_redactor: 25,
  legacy_system: 400,
  strangler_facade: 8,
  reconciler: 1_500,
  model_server: 900,
  dataset_store: 40,
  fine_tune_job: 1_800_000,
  cell_router: 5,
  idempotency_store: 3,
  service_registry: 5,
  sync_engine: 60,
  offline_store: 2,
  chaos_injector: 10,
  budget_guard: 5,
  siem: 50,
  consent_store: 10,
  human_review: 60_000,
};

/** Modest USD/month per replica. Used for the cost total only — no cost opinions. */
export const DEFAULT_COST: Record<ArchNodeType, number> = {
  client: 0,
  mobile_client: 0,
  group: 0,
  cdn: 50,
  dns: 5,
  geo_router: 10,
  load_balancer: 25,
  api_gateway: 40,
  rate_limiter: 20,
  observability: 50,
  websocket_gw: 60,
  waf: 45,
  reverse_proxy: 20,
  service_mesh: 65,
  sidecar: 10,
  cache: 80,
  queue: 40,
  stream: 90,
  event_bus: 45,
  dead_letter_queue: 10,
  change_feed: 45,
  webhook_dispatcher: 35,
  prompt_cache: 35,
  feature_flags: 25,
  connection_pooler: 20,
  service: 60,
  monolith: 120,
  serverless_fn: 20,
  edge_function: 15,
  vm: 70,
  worker: 45,
  scheduler: 10,
  batch_scheduler: 15,
  auth: 40,
  eval_gate: 30,
  bff: 55,
  graphql_gateway: 70,
  workflow_engine: 90,
  saga_orchestrator: 55,
  container_platform: 75,
  bastion: 15,
  sql_db: 200,
  read_replica: 150,
  db_proxy: 30,
  sharded_cluster: 400,
  nosql_db: 150,
  search_index: 120,
  blob_store: 25,
  vector_db: 100,
  timeseries_db: 110,
  graph_db: 180,
  feature_store: 130,
  materialized_view: 40,
  session_store: 50,
  ledger_db: 250,
  feedback_store: 30,
  experiment_platform: 60,
  data_warehouse: 400,
  olap_db: 250,
  data_lake: 60,
  cdc_connector: 80,
  iam: 30,
  kms: 15,
  audit_log: 40,
  secrets_manager: 20,
  batch_job: 25,
  ci_cd: 50,
  backup_store: 40,
  transcoder: 150,
  media_streamer: 120,
  third_party: 100,
  payment_gateway: 0,
  email_provider: 25,
  sms_provider: 40,
  push_service: 20,
  identity_provider: 30,
  llm: 300,
  embedding_svc: 70,
  model_router: 30,
  guardrail: 60,
  reranker: 90,
  agent_runtime: 400,
  doc_source: 25,
  doc_parser: 200,
  chunker: 40,
  extractor: 320,
  output_validator: 30,
  retriever: 90,
  tool_sandbox: 150,
  mcp_server: 60,
  agent_memory: 80,
  pii_redactor: 50,
  legacy_system: 800,
  strangler_facade: 60,
  reconciler: 90,
  // GPUs, billed whether or not anyone asks a question.
  model_server: 1_200,
  dataset_store: 60,
  fine_tune_job: 900,
  cell_router: 80,
  idempotency_store: 70,
  service_registry: 50,
  sync_engine: 120,
  // On the user's device: it costs you nothing and you cannot scale it.
  offline_store: 0,
  chaos_injector: 40,
  budget_guard: 30,
  siem: 400,
  consent_store: 60,
  human_review: 4_000,
};

// ---------------------------------------------------------------- tunables ---

export const DEFAULT_CACHE_HIT_RATE = 0.8;
export const DEFAULT_QUEUE_DEPTH_MAX = 100_000;
/** Queue depth is expressed as "backlog after one minute of this imbalance". */
export const QUEUE_WINDOW_SECONDS = 60;
/** utilization >= this is a 'warn' state and amplifies the tail. */
export const WARN_UTILIZATION = 0.7;
/** M/M/1 flavour, clamped so latency never explodes past 20x the base. */
export const MAX_CONGESTION_FACTOR = 20;
const CONGESTION_UTIL_CAP = 0.95;
/** A flow that completes less than 1% of what was offered is simply broken. */
export const BROKEN_COMPLETION_RATIO = 0.01;
/** A surviving redundant sibling only contributes half its capacity. */
export const REDUNDANT_SIBLING_CAPACITY_SHARE = 0.5;
const MAX_FINDINGS = 8;
const EPSILON = 1e-9;

/**
 * Buffers whose real constraint is consumer drain rate, not their own capacity.
 * A change feed's lag and a webhook dispatcher's pending-delivery backlog are the
 * same lesson as a queue's: the producer is fine, the drain is what fails.
 */
const QUEUE_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'queue',
  'stream',
  'event_bus',
  'dead_letter_queue',
  'change_feed',
  'webhook_dispatcher',
]);
const DATASTORE_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'sql_db',
  'read_replica',
  'nosql_db',
  'search_index',
  'vector_db',
  'timeseries_db',
  'graph_db',
  'sharded_cluster',
  'materialized_view',
  'ledger_db',
  'agent_memory',
  'idempotency_store',
  'consent_store',
]);
/** Losing a zone loses these unless they are spread across AZs. */
const STATEFUL_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'sql_db',
  'read_replica',
  'nosql_db',
  'search_index',
  'blob_store',
  'vector_db',
  'timeseries_db',
  'graph_db',
  'data_warehouse',
  'olap_db',
  'data_lake',
  'feature_store',
  'agent_memory',
  'idempotency_store',
  'consent_store',
  'dataset_store',
  'siem',
  'queue',
  'stream',
  'event_bus',
  'dead_letter_queue',
  'cache',
  'prompt_cache',
  'sharded_cluster',
  'materialized_view',
  'session_store',
  'ledger_db',
  'backup_store',
  'change_feed',
  'feedback_store',
]);
/** Nodes that absorb traffic like a cache unless told otherwise. */
const CACHE_TYPES: ReadonlySet<ArchNodeType> = new Set(['cache', 'prompt_cache']);
/**
 * Dependencies you call but do not run. A chaos scenario's third-party latency
 * lands on all of them (a slow PSP is exactly the failure mode being modelled),
 * and finding #5 treats them as slow dependencies on the synchronous path.
 */
const EXTERNAL_DEPENDENCY_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'third_party',
  'llm',
  'payment_gateway',
  'email_provider',
  'sms_provider',
  'push_service',
  'identity_provider',
]);
/**
 * Stand-ins beyond an identical twin: a read replica keeps reads alive when its
 * primary dies (and the primary keeps serving when a replica dies), and a sharded
 * cluster is the same data as the single-box store it replaced.
 */
const REPLICA_SUBSTITUTES: ReadonlyMap<ArchNodeType, ReadonlySet<ArchNodeType>> = new Map([
  ['sql_db', new Set<ArchNodeType>(['read_replica', 'sharded_cluster'])],
  ['nosql_db', new Set<ArchNodeType>(['read_replica', 'sharded_cluster'])],
  ['read_replica', new Set<ArchNodeType>(['sql_db', 'nosql_db'])],
  ['sharded_cluster', new Set<ArchNodeType>(['sql_db', 'nosql_db'])],
]);

function canSubstitute(killedType: ArchNodeType, candidateType: ArchNodeType): boolean {
  if (killedType === candidateType) return true;
  return REPLICA_SUBSTITUTES.get(killedType)?.has(candidateType) ?? false;
}

/** Live replica-family nodes joined to this one by a replication edge. */
function attachedReplicas(
  graph: GraphDSL,
  node: GraphNode,
  killed: ReadonlySet<string>,
): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: GraphNode[] = [];
  for (const e of graph.edges) {
    if (e.kind !== 'replication') continue;
    const otherId = e.from === node.id ? e.to : e.to === node.id ? e.from : undefined;
    if (!otherId || killed.has(otherId)) continue;
    const other = byId.get(otherId);
    if (other && other.id !== node.id && canSubstitute(node.type, other.type)) out.push(other);
  }
  return out;
}
/** Nodes whose presence in every flow is not interesting SPOF news. */
const NON_INFRA_TYPES: ReadonlySet<ArchNodeType> = new Set(['client', 'mobile_client', 'group', 'offline_store']);
/** Flow kinds where a human is waiting for the response. */
const SYNCHRONOUS_FLOW_KINDS: ReadonlySet<Flow['kind']> = new Set(['read', 'write']);
const SLOW_DEPENDENCY_MS = 200;

// ---------------------------------------------------------------- helpers ----

/** One resolved step of a flow: which node actually served it, and why. */
export interface ResolvedStep {
  /** The node that carried this step (may be a redundant sibling). */
  node: GraphNode;
  /** Set when the step's own node was killed and a sibling took over. */
  substitutedFor?: GraphNode;
  /**
   * Set when the step's node was killed but the request can continue without it.
   * A dead cache-aside cache does not break reads; it dumps their full weight on
   * whatever comes next. That thundering herd is the lesson, not a dead flow.
   */
  bypassed?: GraphNode;
}

/** Everything the engine derives per node before it is trimmed into SimNodeResult. */
interface NodeCompute {
  node: GraphNode;
  capacity: number;
  incoming: number;
  utilization: number;
  latency: number;
  dropped: number;
  queueDepth: number;
  state: NodeState;
  /** Fraction of arriving traffic this node passes on (0..1). */
  survival: number;
  /** Queues only: rps its async consumers can actually drain. */
  consumerCapacity: number;
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Compact human number: 3.2, 0.42, 12000 (never "3.20"). */
function num(value: number, decimals = 2): string {
  if (value === Number.POSITIVE_INFINITY) return 'infinite';
  if (!Number.isFinite(value)) return '0';
  return String(round(value, decimals));
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function replicasOf(node: GraphNode): number {
  const replicas = node.attrs?.replicas;
  return typeof replicas === 'number' && replicas > 0 ? replicas : 1;
}

function baseCapacityOf(node: GraphNode): number {
  const explicit = node.attrs?.capacityRps;
  if (typeof explicit === 'number') return Math.max(0, explicit);
  return DEFAULT_CAPACITY[node.type] ?? 500;
}

/**
 * Fraction of arriving traffic a node absorbs instead of forwarding.
 * Caches (including a prompt cache in front of a model) default to 0.8; any
 * other node opts in by setting `cacheHitRate` explicitly (so a CDN can model
 * offload without being typed as a cache).
 */
function absorbRateOf(node: GraphNode): number {
  const explicit = node.attrs?.cacheHitRate;
  if (typeof explicit === 'number') return Math.min(1, Math.max(0, explicit));
  return CACHE_TYPES.has(node.type) ? DEFAULT_CACHE_HIT_RATE : 0;
}

function costOf(node: GraphNode): number {
  const explicit = node.attrs?.monthlyCost;
  const perReplica = typeof explicit === 'number' ? explicit : (DEFAULT_COST[node.type] ?? 0);
  return perReplica * replicasOf(node);
}

/** Latency at zero load, including any injected third-party penalty. */
function baseLatencyOf(node: GraphNode, config: SimConfig): number {
  const explicit = node.attrs?.latencyMs;
  const base = typeof explicit === 'number' ? explicit : (DEFAULT_LATENCY[node.type] ?? 20);
  const injected = EXTERNAL_DEPENDENCY_TYPES.has(node.type)
    ? (config.thirdPartyLatencyMs ?? 0)
    : 0;
  return Math.max(0, base) + Math.max(0, injected);
}

function congestedLatency(base: number, utilization: number): number {
  if (!(utilization < 1)) return base * MAX_CONGESTION_FACTOR; // covers >=1, NaN, Infinity
  const clamped = Math.min(Math.max(utilization, 0), CONGESTION_UTIL_CAP);
  return Math.min(base / (1 - clamped), base * MAX_CONGESTION_FACTOR);
}

/**
 * Kill list holds node ids, but we also accept a case-insensitive label match so
 * a scenario authored against labels still does the right thing.
 */
function resolveKilled(graph: GraphDSL, config: SimConfig): Set<string> {
  const killed = new Set<string>();
  const wanted = (config.killNodeIds ?? []).map((k) => k.toLowerCase());
  if (wanted.length === 0) return killed;
  for (const node of graph.nodes) {
    if (wanted.includes(node.id.toLowerCase()) || wanted.includes(node.label.toLowerCase())) {
      killed.add(node.id);
    }
  }
  return killed;
}

function connected(edges: readonly GraphEdge[], a: string, b: string): boolean {
  return edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

/**
 * Redundancy awareness: a killed node is survivable if another live node of the
 * same type (or an accepted stand-in, e.g. a read replica for its primary)
 * either replicates it, or hangs off the same upstream neighbour.
 */
function findSibling(
  graph: GraphDSL,
  killedNode: GraphNode,
  previousNodeId: string | undefined,
  killed: ReadonlySet<string>,
): GraphNode | undefined {
  const candidates = graph.nodes.filter(
    (n) =>
      n.id !== killedNode.id && canSubstitute(killedNode.type, n.type) && !killed.has(n.id),
  );
  if (candidates.length === 0) return undefined;

  const replica = candidates.find((n) =>
    graph.edges.some(
      (e) =>
        e.kind === 'replication' &&
        ((e.from === killedNode.id && e.to === n.id) ||
          (e.to === killedNode.id && e.from === n.id)),
    ),
  );
  if (replica) return replica;

  if (previousNodeId !== undefined) {
    const peer = candidates.find((n) => connected(graph.edges, previousNodeId, n.id));
    if (peer) return peer;
  }
  return undefined;
}

// ---------------------------------------------------------------- engine -----

export function simulate(graph: GraphDSL, config: SimConfig): SimResult {
  // Normalize once; never mutate the caller's graph.
  const g: GraphDSL = {
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
    flows: graph.flows ?? [],
    stickies: graph.stickies ?? [],
  };
  const { nodes, edges, flows } = g;
  const multiplier = Number.isFinite(config.rpsMultiplier) ? config.rpsMultiplier : 1;
  const killed = resolveKilled(g, config);

  const byId = new Map<string, GraphNode>();
  for (const node of nodes) byId.set(node.id, node);

  // ---- pass 0: capacity (needed before propagation so redundancy can route) --
  const capacity = new Map<string, number>();
  for (const node of nodes) {
    capacity.set(node.id, killed.has(node.id) ? 0 : baseCapacityOf(node) * replicasOf(node));
  }

  // ---- pass 1: resolve each flow's path and propagate offered demand ---------
  const incoming = new Map<string, number>();
  for (const node of nodes) incoming.set(node.id, 0);

  interface FlowPlan {
    flow: Flow;
    offered: number;
    steps: ResolvedStep[];
    notes: string[];
  }

  const plans: FlowPlan[] = flows.map((flow) => {
    const offered = Math.max(0, (flow.rps ?? 0) * multiplier);
    const steps: ResolvedStep[] = [];
    const notes: string[] = [];
    let carried = offered;
    let previousNodeId: string | undefined;

    for (const stepId of flow.steps ?? []) {
      const stepNode = byId.get(stepId);
      if (!stepNode) {
        notes.push(`Unknown step "${stepId}" is not in the graph — skipped.`);
        continue;
      }

      let serving = stepNode;
      let substitutedFor: GraphNode | undefined;
      if (killed.has(stepNode.id)) {
        const sibling = findSibling(g, stepNode, previousNodeId, killed);
        if (sibling) {
          serving = sibling;
          substitutedFor = stepNode;
        } else if (absorbRateOf(stepNode) > 0) {
          // Cache-aside with a dead cache: reads fall through at full volume.
          steps.push({ node: stepNode, bypassed: stepNode });
          notes.push(
            `${stepNode.label} is down — every request falls through to the next hop at full ` +
              `volume (cache stampede). The design survives only if what follows can absorb it.`,
          );
          previousNodeId = stepNode.id;
          continue;
        }
      }

      steps.push(substitutedFor ? { node: serving, substitutedFor } : { node: serving });

      // Read offload: a datastore with live replicas attached over replication
      // edges shares its READ traffic with them. This is why adding a replica
      // visibly lowers the primary's utilization — writes still all land on it.
      const replicas =
        flow.kind === 'read' && DATASTORE_TYPES.has(serving.type)
          ? attachedReplicas(g, serving, killed)
          : [];
      if (replicas.length > 0) {
        const share = carried / (replicas.length + 1);
        incoming.set(serving.id, (incoming.get(serving.id) ?? 0) + share);
        for (const r of replicas) incoming.set(r.id, (incoming.get(r.id) ?? 0) + share);
        notes.push(
          `${serving.label}'s reads are split across ${replicas.length + 1} nodes ` +
            `(${replicas.map((r) => r.label).join(', ')}) — each takes ${round(share)} rps.`,
        );
      } else {
        incoming.set(serving.id, (incoming.get(serving.id) ?? 0) + carried);
      }

      // Absorbed traffic (cache hits) is served here and never reaches the next hop.
      carried = carried * (1 - absorbRateOf(serving));
      previousNodeId = serving.id;
    }

    if (steps.length === 0) {
      notes.push('This flow has no steps in the graph — nothing to simulate.');
    }
    return { flow, offered, steps, notes };
  });

  // ---- pass 2: per-node utilization, latency, drops, queue depth ------------
  const computed = new Map<string, NodeCompute>();
  const queueFindings: string[] = [];

  for (const node of nodes) {
    const cap = capacity.get(node.id) ?? 0;
    const arriving = incoming.get(node.id) ?? 0;
    const isDown = killed.has(node.id);

    let utilization: number;
    if (cap === Number.POSITIVE_INFINITY) utilization = 0;
    else if (cap <= 0) utilization = arriving > 0 ? Number.POSITIVE_INFINITY : 0;
    else utilization = arriving / cap;

    const latency = congestedLatency(baseLatencyOf(node, config), utilization);
    let dropped = Math.max(0, arriving - cap);
    let queueDepth = 0;
    let consumerCapacity = 0;

    if (QUEUE_TYPES.has(node.type) && !isDown) {
      // A queue's job is to absorb a burst, so it does not shed while it has room.
      // Its real constraint is whether the consumers behind it can drain it.
      consumerCapacity = edges
        .filter((e) => e.kind === 'async' && e.from === node.id && byId.has(e.to))
        .reduce((sum, e) => sum + (capacity.get(e.to) ?? 0), 0);
      const shortfall = arriving - consumerCapacity;
      queueDepth = Math.max(0, shortfall * QUEUE_WINDOW_SECONDS);
      const depthMax = node.attrs?.queueDepthMax ?? DEFAULT_QUEUE_DEPTH_MAX;
      dropped =
        queueDepth > depthMax ? Math.max(0, (queueDepth - depthMax) / QUEUE_WINDOW_SECONDS) : 0;
      if (shortfall > 0) {
        queueFindings.push(
          `${node.label} takes ${num(arriving)} rps but its async consumers only drain ` +
            `${num(consumerCapacity)} rps — the backlog grows ${num(queueDepth, 0)} messages/min. ` +
            `That is backpressure: add consumers or the queue only delays the failure.`,
        );
      }
    }

    const survival = cap <= 0 ? 0 : arriving > 0 ? Math.min(1, (arriving - dropped) / arriving) : 1;

    let state: NodeState;
    if (isDown) state = 'down';
    else if (utilization >= 1 || dropped > 0) state = 'saturated';
    else if (utilization >= WARN_UTILIZATION) state = 'warn';
    else state = 'ok';

    computed.set(node.id, {
      node,
      capacity: cap,
      incoming: arriving,
      utilization,
      latency,
      dropped,
      queueDepth,
      state,
      survival,
      consumerCapacity,
    });
  }

  // ---- pass 3: walk each flow again, applying survival ----------------------
  const flowResults: SimFlowResult[] = plans.map((plan) => {
    const notes = [...plan.notes];
    let carried = plan.offered;
    let served = 0; // absorbed-and-answered traffic (cache hits)
    let p50 = 0;
    let tailExtra = 0;
    let broken = false;
    let brokenAt: string | undefined;

    for (const step of plan.steps) {
      const nc = computed.get(step.node.id);
      if (!nc) continue;

      // A bypassed node contributes no latency, no capacity and no absorption:
      // the traffic simply moves on to the next hop untouched.
      if (step.bypassed) continue;

      p50 += nc.latency;
      if (nc.utilization > WARN_UTILIZATION) tailExtra += nc.latency;

      if (step.substitutedFor) {
        // Survivor is now doing double duty: only half its capacity is free for us.
        const share = nc.capacity * REDUNDANT_SIBLING_CAPACITY_SHARE;
        const survival = share <= 0 ? 0 : Math.min(1, share / Math.max(carried, EPSILON));
        notes.push(
          `${step.substitutedFor.label} is down — survived via ${step.node.label} ` +
            `(redundant path)${survival < 1 ? ` at ${pct(survival)} of demand` : ''}.`,
        );
        carried *= survival;
      } else if (nc.state === 'down') {
        broken = true;
        brokenAt = step.node.label;
        notes.push(`${step.node.label} is down and this flow has no fallback path.`);
        carried = 0;
        break;
      } else {
        if (nc.survival < 1 && carried > 0) {
          const overload = Number.isFinite(nc.utilization) ? `${num(nc.utilization, 1)}x` : 'over';
          notes.push(
            `${step.node.label} saturated at ${overload} capacity — ` +
              `${pct(1 - nc.survival)} of this flow is shed here.`,
          );
        }
        carried *= nc.survival;
      }

      const absorbed = absorbRateOf(step.node);
      if (absorbed > 0) {
        served += carried * absorbed; // a cache hit is a completed request
        carried *= 1 - absorbed;
      }
    }

    const completed = served + carried;
    if (!broken && completed < plan.offered * BROKEN_COMPLETION_RATIO) broken = true;

    return {
      flowId: plan.flow.id,
      name: plan.flow.name,
      offeredRps: round(plan.offered),
      completedRps: round(completed),
      p50Ms: round(p50),
      p99Ms: round(p50 * 2.5 + tailExtra),
      broken,
      ...(brokenAt !== undefined ? { brokenAt } : {}),
      notes,
    };
  });

  // ---- aggregates ----------------------------------------------------------
  const nodeResults: SimNodeResult[] = nodes.map((node) => {
    const nc = computed.get(node.id);
    /* c8 ignore next */
    if (!nc) throw new Error(`unreachable: node ${node.id} was not computed`);
    return {
      nodeId: node.id,
      incomingRps: round(nc.incoming),
      capacityRps: round(nc.capacity),
      utilization: round(nc.utilization, 4),
      latencyMs: round(nc.latency),
      droppedRps: round(nc.dropped),
      queueDepth: round(nc.queueDepth, 0),
      state: nc.state,
    };
  });

  let bottleneckNodeId: string | null = null;
  let bottleneckUtil = 0;
  for (const node of nodes) {
    const nc = computed.get(node.id);
    if (!nc) continue;
    if (Number.isFinite(nc.utilization) && nc.utilization > 0 && nc.utilization > bottleneckUtil) {
      bottleneckUtil = nc.utilization;
      bottleneckNodeId = node.id;
    }
  }

  const totalDroppedRps = round(
    nodeResults.reduce((sum, n) => sum + (Number.isFinite(n.droppedRps) ? n.droppedRps : 0), 0),
  );
  const monthlyCost = round(nodes.reduce((sum, n) => sum + costOf(n), 0));

  const findings = buildFindings({
    nodes,
    edges,
    plans: plans.map((p) => ({ flow: p.flow, steps: p.steps })),
    computed,
    queueFindings,
    bottleneckNodeId,
  });

  const verdict = buildVerdict({
    multiplier,
    nodes,
    flows,
    flowResults,
    computed,
    bottleneckNodeId,
    bottleneckUtil,
    totalDroppedRps,
  });

  return {
    nodes: nodeResults,
    flows: flowResults,
    bottleneckNodeId,
    totalDroppedRps,
    monthlyCost,
    verdict,
    findings,
  };
}

// ---------------------------------------------------------------- findings ---

function buildFindings(args: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  plans: readonly { flow: Flow; steps: readonly ResolvedStep[] }[];
  computed: ReadonlyMap<string, NodeCompute>;
  queueFindings: readonly string[];
  bottleneckNodeId: string | null;
}): string[] {
  const { nodes, edges, plans, computed, queueFindings, bottleneckNodeId } = args;
  const out: string[] = [];

  // 1. The bottleneck, quantified into an action.
  if (bottleneckNodeId) {
    const nc = computed.get(bottleneckNodeId);
    if (nc && nc.utilization >= 1) {
      const needed = Math.ceil(nc.utilization * replicasOf(nc.node));
      out.push(
        `${nc.node.label} is the bottleneck at ${num(nc.utilization, 1)}x capacity — ` +
          `it needs about ${needed} replicas (≈${num(nc.incoming, 0)} rps of capacity) to hold this load.`,
      );
    }
  }

  // 2. Backpressure.
  out.push(...queueFindings);

  // 3. A node every flow depends on, with nothing behind it.
  const flowsWithSteps = plans.filter((p) => p.steps.length > 0);
  if (flowsWithSteps.length > 0) {
    for (const node of nodes) {
      if (NON_INFRA_TYPES.has(node.type)) continue;
      if (replicasOf(node) > 1) continue;
      const inEveryFlow = flowsWithSteps.every((p) => p.steps.some((s) => s.node.id === node.id));
      if (!inEveryFlow) continue;
      const hasReplicationPeer = edges.some(
        (e) => e.kind === 'replication' && (e.from === node.id || e.to === node.id),
      );
      if (hasReplicationPeer) continue;
      out.push(
        `${node.label} is a single point of failure — every flow goes through it and it runs ` +
          `1 instance with no replica. Kill it and the whole design is offline.`,
      );
    }
  }

  // 4. A saturated datastore with nothing caching in front of it.
  for (const node of nodes) {
    if (!DATASTORE_TYPES.has(node.type)) continue;
    const nc = computed.get(node.id);
    if (!nc || nc.state !== 'saturated' || nc.incoming <= 0) continue;
    const cacheUpstream =
      edges.some((e) => {
        const from = nodes.find((n) => n.id === e.from);
        return e.to === node.id && from !== undefined && absorbRateOf(from) > 0;
      }) ||
      plans.some((p) =>
        p.steps.some(
          (s, i) => s.node.id === node.id && i > 0 && absorbRateOf(p.steps[i - 1]!.node) > 0,
        ),
      );
    if (cacheUpstream) continue;
    out.push(
      `${node.label} is saturated with no cache in front of it — reads are hitting the ` +
        `database directly. A cache absorbing 80% would cut its load 5x.`,
    );
  }

  // 5. Slow dependency you do not control, sitting inline on a user request.
  const reported = new Set<string>();
  for (const plan of plans) {
    if (!SYNCHRONOUS_FLOW_KINDS.has(plan.flow.kind)) continue;
    for (const step of plan.steps) {
      if (!EXTERNAL_DEPENDENCY_TYPES.has(step.node.type)) continue;
      const nc = computed.get(step.node.id);
      if (!nc || nc.latency < SLOW_DEPENDENCY_MS) continue;
      const key = `${step.node.id}|${plan.flow.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push(
        `${step.node.label} adds ${num(nc.latency, 0)}ms inline to "${plan.flow.name}" — a slow ` +
          `dependency you do not own is on the synchronous user path. Make it async or add a timeout + fallback.`,
      );
    }
  }

  // 6. Stateful and pinned to one zone.
  const singleAz = nodes.filter(
    (n) => STATEFUL_TYPES.has(n.type) && !n.attrs?.multiAz && (computed.get(n.id)?.incoming ?? 0) > 0,
  );
  if (singleAz.length > 0) {
    const named = singleAz.slice(0, 2).map((n) => n.label);
    const rest = singleAz.length - named.length;
    out.push(
      `${named.join(' and ')}${rest > 0 ? ` (+${rest} more)` : ''} ${
        singleAz.length === 1 ? 'is' : 'are'
      } stateful and single-AZ — one zone failure takes ${singleAz.length === 1 ? 'it' : 'them'} ` +
        `and every flow through ${singleAz.length === 1 ? 'it' : 'them'} offline.`,
    );
  }

  // 7. Flows that are not actually flows.
  for (const plan of plans) {
    if (plan.steps.length === 0) {
      out.push(
        `Flow "${plan.flow.name}" has no steps in the graph — a named path with no components ` +
          `cannot be simulated or reviewed.`,
      );
    }
  }

  return out.slice(0, MAX_FINDINGS);
}

// ---------------------------------------------------------------- verdict ----

function buildVerdict(args: {
  multiplier: number;
  nodes: readonly GraphNode[];
  flows: readonly Flow[];
  flowResults: readonly SimFlowResult[];
  computed: ReadonlyMap<string, NodeCompute>;
  bottleneckNodeId: string | null;
  bottleneckUtil: number;
  totalDroppedRps: number;
}): string {
  const {
    multiplier,
    nodes,
    flows,
    flowResults,
    computed,
    bottleneckNodeId,
    bottleneckUtil,
    totalDroppedRps,
  } = args;

  if (nodes.length === 0) return 'Nothing to simulate — the design has no components.';
  if (flows.length === 0) {
    return `${nodes.length} component${nodes.length === 1 ? '' : 's'} on the canvas but no flows defined — add a request path to simulate load.`;
  }

  const at = multiplier === 1 ? 'At baseline load' : `At ${num(multiplier, 2)}x load`;
  const holds = multiplier === 1 ? 'Holds at baseline' : `Holds at ${num(multiplier, 2)}x`;

  // Worst flow = lowest completion ratio (ties broken by graph order).
  let worst: SimFlowResult | undefined;
  let worstRatio = 1;
  for (const fr of flowResults) {
    const ratio = fr.offeredRps > 0 ? fr.completedRps / fr.offeredRps : 1;
    if (ratio < worstRatio || (worst === undefined && fr.broken)) {
      worstRatio = ratio;
      worst = fr;
    }
  }

  const downFlow = flowResults.find((f) => f.brokenAt !== undefined);
  if (downFlow) {
    const lost =
      downFlow.offeredRps > 0 ? 1 - downFlow.completedRps / downFlow.offeredRps : 1;
    return `${at} "${downFlow.name}" is dead at ${downFlow.brokenAt} — no fallback path, ${pct(
      lost,
    )} of its traffic lost.`;
  }

  const bottleneck = bottleneckNodeId ? computed.get(bottleneckNodeId) : undefined;

  if (totalDroppedRps > 0 || flowResults.some((f) => f.broken)) {
    const head = bottleneck
      ? `${at} ${bottleneck.node.label} saturates (utilization ${num(bottleneck.utilization, 2)})`
      : `${at} the design saturates`;
    const tail =
      worst && worstRatio < 1
        ? ` and ${pct(1 - worstRatio)} of "${worst.name}" is dropped.`
        : ` and ${num(totalDroppedRps)} rps is dropped.`;
    return head + tail;
  }

  if (bottleneck) {
    const degraded = flowResults.filter((f) => f.offeredRps > 0 && f.completedRps < f.offeredRps);
    const flowNote =
      degraded.length > 0
        ? `"${degraded[0]!.name}" is already degrading.`
        : 'no flow degraded.';
    return `${holds}: highest utilization is ${num(bottleneck.utilization, 2)} on ${bottleneck.node.label}; ${flowNote}`;
  }

  return `${holds}: no component carries measurable load; no flow degraded.`;
}

export default simulate;
