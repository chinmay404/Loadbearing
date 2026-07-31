// What each kind of component is worth, numerically: how much one replica can
// serve, how long its own work takes, roughly what it costs, and which sets of
// types share a behaviour the engine cares about.
//
// Lifted out of the engine so that the engine, the projection onto the old
// SimResult, and the cost model can all read the same numbers without importing
// each other in a circle.

import type { ArchNodeType, Flow, GraphDSL, GraphNode } from './types.js';
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
  custom: 500,
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
  custom: 50,
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
  custom: 100,
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
export const CONGESTION_UTIL_CAP = 0.95;
/** A flow that completes less than 1% of what was offered is simply broken. */
export const BROKEN_COMPLETION_RATIO = 0.01;
/** A surviving redundant sibling only contributes half its capacity. */
export const REDUNDANT_SIBLING_CAPACITY_SHARE = 0.5;
export const MAX_FINDINGS = 8;
export const EPSILON = 1e-9;

/**
 * Buffers whose real constraint is consumer drain rate, not their own capacity.
 * A change feed's lag and a webhook dispatcher's pending-delivery backlog are the
 * same lesson as a queue's: the producer is fine, the drain is what fails.
 */
export const QUEUE_TYPES: ReadonlySet<ArchNodeType> = new Set([
  'queue',
  'stream',
  'event_bus',
  'dead_letter_queue',
  'change_feed',
  'webhook_dispatcher',
]);
export const DATASTORE_TYPES: ReadonlySet<ArchNodeType> = new Set([
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
export const STATEFUL_TYPES: ReadonlySet<ArchNodeType> = new Set([
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
export const CACHE_TYPES: ReadonlySet<ArchNodeType> = new Set(['cache', 'prompt_cache']);
/**
 * Dependencies you call but do not run. A chaos scenario's third-party latency
 * lands on all of them (a slow PSP is exactly the failure mode being modelled),
 * and finding #5 treats them as slow dependencies on the synchronous path.
 */
export const EXTERNAL_DEPENDENCY_TYPES: ReadonlySet<ArchNodeType> = new Set([
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
export const REPLICA_SUBSTITUTES: ReadonlyMap<ArchNodeType, ReadonlySet<ArchNodeType>> = new Map([
  ['sql_db', new Set<ArchNodeType>(['read_replica', 'sharded_cluster'])],
  ['nosql_db', new Set<ArchNodeType>(['read_replica', 'sharded_cluster'])],
  ['read_replica', new Set<ArchNodeType>(['sql_db', 'nosql_db'])],
  ['sharded_cluster', new Set<ArchNodeType>(['sql_db', 'nosql_db'])],
]);

export function canSubstitute(killedType: ArchNodeType, candidateType: ArchNodeType): boolean {
  if (killedType === candidateType) return true;
  return REPLICA_SUBSTITUTES.get(killedType)?.has(candidateType) ?? false;
}

/** Live replica-family nodes joined to this one by a replication edge. */
export function attachedReplicas(
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
export const NON_INFRA_TYPES: ReadonlySet<ArchNodeType> = new Set(['client', 'mobile_client', 'group', 'offline_store']);
/** Flow kinds where a human is waiting for the response. */
export const SYNCHRONOUS_FLOW_KINDS: ReadonlySet<Flow['kind']> = new Set(['read', 'write']);
export const SLOW_DEPENDENCY_MS = 200;


/**
 * Components that REFUSE excess cheaply instead of queueing it. This is why the
 * position of a rate limiter matters: shedding at the edge costs nothing, and the
 * same overload reaching compute costs a thread per request.
 */
export const SHEDDING_TYPES: ReadonlySet<ArchNodeType> = new Set<ArchNodeType>([
  'rate_limiter',
  'waf',
  'api_gateway',
  'budget_guard',
  'guardrail',
]);
