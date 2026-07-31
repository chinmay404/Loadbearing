// What kind of thing each component is, for the purposes of load and money.
//
// The palette groups components by where a person looks for them ("Data", "AI").
// This is a different question: given traffic arriving at this box, what does it
// DO with it, and what does it cost to run? A load balancer and an API gateway
// live in different palette groups and behave identically here — both hand each
// request onward to one of several downstreams. A database and a vector database
// look unrelated in the palette and behave identically here — both are sized by
// storage, shards and zone placement.
//
// Families exist so that neither the simulator nor the inspector needs a case for
// 109 types, and so a component only ever offers the knobs that mean something for
// it. A managed load balancer has no multi-AZ setting, because zone redundancy is
// not a decision anyone makes about one.

import type { ArchNodeType } from './types.js';

export type Family =
  /** Where traffic comes from. Emits; never constrains. */
  | 'origin'
  /** Hands each request onward: balancers, gateways, proxies, routers. */
  | 'routing'
  /** Runs code per request. The tier that actually runs out of room. */
  | 'compute'
  /** Holds the data. Sized by storage, shards and zone placement. */
  | 'datastore'
  /** Absorbs reads so the thing behind it does not see them. */
  | 'cache'
  /** Buffers work for someone else to pull. Its drain rate is the constraint. */
  | 'messaging'
  /** Somebody else's system. Priced per call, and it can be slow. */
  | 'external'
  /** Inference and the machinery around it. Priced per token. */
  | 'ai'
  /** Runs beside the system, not on the request path. Costs money, serves no traffic. */
  | 'control'
  /** Drawing furniture: boundaries and notes. No load, no cost. */
  | 'boundary';

/**
 * Exhaustive on purpose — `Record` over the union means a new component type will
 * not compile until it has been given a family, which is the only way this stays
 * honest as the palette grows.
 */
export const FAMILY: Record<ArchNodeType, Family> = {
  // ---- where traffic starts -------------------------------------------------
  client: 'origin',
  mobile_client: 'origin',
  scheduler: 'origin',
  batch_scheduler: 'origin',
  change_feed: 'origin',
  cdc_connector: 'origin',
  chaos_injector: 'origin',

  // ---- handing requests onward ---------------------------------------------
  cdn: 'routing',
  dns: 'routing',
  geo_router: 'routing',
  load_balancer: 'routing',
  waf: 'routing',
  reverse_proxy: 'routing',
  api_gateway: 'routing',
  service_mesh: 'routing',
  sidecar: 'routing',
  rate_limiter: 'routing',
  websocket_gw: 'routing',
  cell_router: 'routing',
  model_router: 'routing',
  db_proxy: 'routing',
  connection_pooler: 'routing',
  service_registry: 'routing',
  strangler_facade: 'routing',

  // ---- running code --------------------------------------------------------
  /**
   * A pool of workers, not a scheduler. Nobody draws the Kubernetes control plane in
   * a request path; when this box appears between a balancer and a database, it is
   * the containers serving the traffic — so it constrains traffic, and it scales.
   * Treating it as a control plane made an autoscaling group report 0% utilisation
   * while 400 rps flowed straight through it.
   */
  container_platform: 'compute',
  service: 'compute',
  monolith: 'compute',
  serverless_fn: 'compute',
  edge_function: 'compute',
  vm: 'compute',
  worker: 'compute',
  bff: 'compute',
  graphql_gateway: 'compute',
  auth: 'compute',
  workflow_engine: 'compute',
  saga_orchestrator: 'compute',
  webhook_dispatcher: 'compute',
  batch_job: 'compute',
  transcoder: 'compute',
  media_streamer: 'compute',
  reconciler: 'compute',
  legacy_system: 'compute',
  sync_engine: 'compute',
  // The AI pipeline's own code: parsing, chunking, validating. Ordinary compute
  // that happens to sit on an ingest path.
  doc_parser: 'compute',
  chunker: 'compute',
  extractor: 'compute',
  output_validator: 'compute',
  retriever: 'compute',
  reranker: 'compute',
  eval_gate: 'compute',
  guardrail: 'compute',
  pii_redactor: 'compute',
  agent_runtime: 'compute',
  tool_sandbox: 'compute',
  mcp_server: 'compute',
  embedding_svc: 'compute',
  model_server: 'compute',
  experiment_platform: 'compute',
  human_review: 'compute',

  // ---- holding data --------------------------------------------------------
  sql_db: 'datastore',
  read_replica: 'datastore',
  nosql_db: 'datastore',
  sharded_cluster: 'datastore',
  search_index: 'datastore',
  vector_db: 'datastore',
  timeseries_db: 'datastore',
  graph_db: 'datastore',
  ledger_db: 'datastore',
  materialized_view: 'datastore',
  blob_store: 'datastore',
  backup_store: 'datastore',
  data_warehouse: 'datastore',
  olap_db: 'datastore',
  data_lake: 'datastore',
  feature_store: 'datastore',
  feedback_store: 'datastore',
  dataset_store: 'datastore',
  agent_memory: 'datastore',
  idempotency_store: 'datastore',
  consent_store: 'datastore',
  offline_store: 'datastore',
  doc_source: 'datastore',
  audit_log: 'datastore',
  siem: 'datastore',

  // ---- absorbing reads -----------------------------------------------------
  cache: 'cache',
  prompt_cache: 'cache',
  session_store: 'cache',

  // ---- buffering work ------------------------------------------------------
  queue: 'messaging',
  stream: 'messaging',
  event_bus: 'messaging',
  dead_letter_queue: 'messaging',

  // ---- somebody else's system ---------------------------------------------
  third_party: 'external',
  payment_gateway: 'external',
  email_provider: 'external',
  sms_provider: 'external',
  push_service: 'external',
  identity_provider: 'external',

  // ---- inference -----------------------------------------------------------
  llm: 'ai',
  fine_tune_job: 'ai',

  // ---- beside the system, not on the path ---------------------------------
  observability: 'control',
  ci_cd: 'control',
  iam: 'control',
  kms: 'control',
  secrets_manager: 'control',
  feature_flags: 'control',
  budget_guard: 'control',
  bastion: 'control',

  // ---- drawing furniture ---------------------------------------------------
  group: 'boundary',
  custom: 'compute',
};

export const familyOf = (type: ArchNodeType): Family => FAMILY[type] ?? 'compute';

/**
 * How a component divides what arrives at it between its outbound connections.
 *
 * `distribute` — one request leaves by ONE of the outbound edges. A load balancer
 * with three services behind it sends each request to one of them, so each sees a
 * third of the traffic.
 *
 * `fanOut` — one request leaves by EVERY outbound edge. A service that checks auth,
 * reads its cache and writes its database does all three per request, so each of
 * them sees the full rate. Splitting here would be the single most misleading thing
 * the model could do: it would make a service's dependencies look four times
 * cheaper than they are.
 */
export type Distribution = 'distribute' | 'fanOut';

export const distributionOf = (type: ArchNodeType): Distribution =>
  familyOf(type) === 'routing' || familyOf(type) === 'origin' ? 'distribute' : 'fanOut';

/** Families that never constrain traffic and never appear as a bottleneck. */
export const PASSIVE_FAMILIES: ReadonlySet<Family> = new Set<Family>(['boundary', 'control']);

/** Can traffic legitimately begin here? */
export const canOriginate = (type: ArchNodeType): boolean => familyOf(type) === 'origin';
