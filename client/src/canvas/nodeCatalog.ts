// The palette's source of truth: what each node type is called, where it sits in
// the palette, what colour it wears, what it teaches, and the single-replica
// numbers the simulator starts from.
//
// Defaults are deliberately per-replica: `capacityRps` is what ONE instance can
// serve, and the simulator multiplies by `replicas`. Rough tiers used throughout:
//   in-memory / edge  -> tens of thousands rps, 1-15ms
//   app tier          -> hundreds rps, 40-60ms
//   databases         -> low thousands rps, 5-10ms
//   object / search   -> thousands rps, 25-60ms
//   analytical stores -> tens-to-hundreds rps, 200-2000ms
//   external + LLM    -> tens-to-hundreds rps, 250-1200ms
//   batch / pipelines -> a handful of jobs, seconds-to-minutes
import { ARCH_NODE_TYPES } from '@archdojo/shared';
import type { ArchNodeType, NodeAttrs } from '@archdojo/shared';

export type NodeCategory =
  | 'Edge & Traffic'
  | 'Compute'
  | 'Data'
  | 'Async'
  | 'AI'
  | 'Security'
  | 'Ops'
  | 'Layout';

export interface NodeSpec {
  type: ArchNodeType;
  /** Default label placed on the canvas. */
  label: string;
  /** Palette grouping. */
  category: NodeCategory;
  /** Hex accent, one hue family per category, tuned for a #11131a canvas. */
  color: string;
  /** One-line tooltip: what this component is FOR. */
  hint: string;
  /** Realistic starting knobs for the simulator. */
  defaults: NodeAttrs;
  /** Which knobs the inspector should expose for this type. */
  attrFields: (keyof NodeAttrs)[];
}

export const CATEGORY_ORDER: NodeCategory[] = [
  'Edge & Traffic',
  'Compute',
  'Data',
  'Async',
  'AI',
  'Security',
  'Ops',
  'Layout',
];

// Common inspector field sets, so the knobs stay consistent across types.
const STATELESS: (keyof NodeAttrs)[] = ['capacityRps', 'replicas', 'latencyMs', 'monthlyCost'];
const STATELESS_HA: (keyof NodeAttrs)[] = [
  'capacityRps',
  'replicas',
  'latencyMs',
  'multiAz',
  'monthlyCost',
];
const MANAGED: (keyof NodeAttrs)[] = ['capacityRps', 'latencyMs', 'multiAz', 'monthlyCost'];
/** Anything that absorbs traffic instead of forwarding it. */
const CACHED: (keyof NodeAttrs)[] = [
  'capacityRps',
  'replicas',
  'latencyMs',
  'cacheHitRate',
  'multiAz',
  'monthlyCost',
];
/** Anything that buffers messages, so the backlog ceiling matters. */
const BUFFERED: (keyof NodeAttrs)[] = [
  'capacityRps',
  'replicas',
  'latencyMs',
  'queueDepthMax',
  'multiAz',
  'monthlyCost',
];

const CATALOG = [
  // ---------------------------------------------------------------- Edge & Traffic
  {
    type: 'client',
    label: 'Web Client',
    category: 'Edge & Traffic',
    color: '#22d3ee',
    hint: 'Where traffic originates — the browser your users actually hold.',
    defaults: {},
    attrFields: [],
  },
  {
    type: 'mobile_client',
    label: 'Mobile App',
    category: 'Edge & Traffic',
    color: '#38bdf8',
    hint: 'A client you cannot hotfix: assume old versions and flaky networks forever.',
    defaults: {},
    attrFields: [],
  },
  {
    type: 'dns',
    label: 'DNS',
    category: 'Edge & Traffic',
    color: '#2dd4bf',
    hint: 'Turns a name into an address — and is your cheapest failover and geo-routing lever.',
    defaults: { capacityRps: 100000, replicas: 1, latencyMs: 15, multiAz: true, monthlyCost: 5 },
    attrFields: MANAGED,
  },
  {
    type: 'cdn',
    label: 'CDN',
    category: 'Edge & Traffic',
    color: '#06b6d4',
    hint: 'Serves static and cacheable content from the edge, so most requests never reach you.',
    defaults: {
      capacityRps: 200000,
      replicas: 1,
      latencyMs: 15,
      cacheHitRate: 0.9,
      multiAz: true,
      monthlyCost: 100,
    },
    attrFields: ['capacityRps', 'latencyMs', 'cacheHitRate', 'multiAz', 'monthlyCost'],
  },
  {
    type: 'load_balancer',
    label: 'Load Balancer',
    category: 'Edge & Traffic',
    color: '#14b8a6',
    hint: 'Spreads traffic over healthy replicas and hides instance failures from callers.',
    defaults: { capacityRps: 50000, replicas: 2, latencyMs: 1, multiAz: true, monthlyCost: 25 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'api_gateway',
    label: 'API Gateway',
    category: 'Edge & Traffic',
    color: '#0ea5e9',
    hint: 'One front door: routing, authn, quotas and versioning applied before any service sees the call.',
    defaults: { capacityRps: 10000, replicas: 2, latencyMs: 5, multiAz: true, monthlyCost: 60 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'rate_limiter',
    label: 'Rate Limiter',
    category: 'Edge & Traffic',
    color: '#67e8f9',
    hint: 'Sheds load on purpose so one abusive caller cannot take the system down for everyone.',
    defaults: { capacityRps: 30000, replicas: 2, latencyMs: 1, monthlyCost: 20 },
    attrFields: STATELESS,
  },
  {
    type: 'websocket_gw',
    label: 'WebSocket Gateway',
    category: 'Edge & Traffic',
    color: '#5eead4',
    hint: 'Holds long-lived duplex connections for push and realtime — connection count, not rps, is the limit.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 3, multiAz: true, monthlyCost: 80 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'waf',
    label: 'WAF',
    category: 'Edge & Traffic',
    color: '#7dd3fc',
    hint: 'Blocks injection, bots and L7 floods at the perimeter, before a request can reach your app.',
    defaults: { capacityRps: 40000, replicas: 2, latencyMs: 3, multiAz: true, monthlyCost: 45 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'reverse_proxy',
    label: 'Reverse Proxy',
    category: 'Edge & Traffic',
    color: '#a5f3fc',
    hint: 'Terminates TLS and fronts your origins — routing, compression and connection reuse in one cheap hop.',
    defaults: { capacityRps: 40000, replicas: 2, latencyMs: 2, multiAz: true, monthlyCost: 20 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'bff',
    label: 'Backend for Frontend',
    category: 'Edge & Traffic',
    color: '#99f6e4',
    hint: 'One API shaped for one client: aggregates services so the app needs a single round trip.',
    defaults: { capacityRps: 400, replicas: 3, latencyMs: 45, monthlyCost: 55 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'graphql_gateway',
    label: 'GraphQL Gateway',
    category: 'Edge & Traffic',
    color: '#26c6da',
    hint: 'Clients request exactly the fields they need across services — you own the N+1 fan-out and query-cost limits.',
    defaults: { capacityRps: 800, replicas: 2, latencyMs: 35, monthlyCost: 70 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'service_mesh',
    label: 'Service Mesh',
    category: 'Edge & Traffic',
    color: '#4db6ac',
    hint: 'Sidecars that add mTLS, retries, timeouts and traffic shifting to every call without touching service code.',
    defaults: { capacityRps: 30000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 65 },
    attrFields: STATELESS_HA,
  },

  // ---------------------------------------------------------------------- Compute
  {
    type: 'service',
    label: 'Service',
    category: 'Compute',
    color: '#a78bfa',
    hint: 'A stateless unit of business logic you can scale horizontally and deploy on its own.',
    defaults: { capacityRps: 500, replicas: 2, latencyMs: 40, monthlyCost: 30 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'monolith',
    label: 'Monolith',
    category: 'Compute',
    color: '#8b5cf6',
    hint: 'All logic in one deployable — simplest and fastest to build, until scaling and teams collide.',
    defaults: { capacityRps: 800, replicas: 1, latencyMs: 60, monthlyCost: 120 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'serverless_fn',
    label: 'Serverless Function',
    category: 'Compute',
    color: '#c4b5fd',
    hint: 'Scales to zero and to thousands per event — pay per call, but mind cold starts and connection limits.',
    defaults: { capacityRps: 200, replicas: 20, latencyMs: 60, monthlyCost: 40 },
    attrFields: STATELESS,
  },
  {
    type: 'third_party',
    label: 'Third-Party API',
    category: 'Compute',
    color: '#818cf8',
    hint: 'A dependency you cannot fix or scale — wrap it in timeouts, retries and a circuit breaker.',
    defaults: { capacityRps: 200, replicas: 1, latencyMs: 250, monthlyCost: 0 },
    attrFields: ['capacityRps', 'latencyMs', 'monthlyCost'],
  },
  {
    type: 'edge_function',
    label: 'Edge Function',
    category: 'Compute',
    color: '#ddd6fe',
    hint: 'Runs small logic in the PoP nearest the user — auth checks, redirects, personalisation with no origin hop.',
    defaults: { capacityRps: 5000, replicas: 1, latencyMs: 20, multiAz: true, monthlyCost: 15 },
    attrFields: MANAGED,
  },
  {
    type: 'container_platform',
    label: 'Container Platform',
    category: 'Compute',
    color: '#a5b4fc',
    hint: 'Schedules containers, restarts dead ones and owns autoscaling — a control plane, not a request hop.',
    defaults: { capacityRps: 50000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 75 },
    attrFields: MANAGED,
  },
  {
    type: 'vm',
    label: 'Virtual Machine',
    category: 'Compute',
    color: '#9f7aea',
    hint: 'A whole OS you own and patch — reach for it when you need the box, not just the process.',
    defaults: { capacityRps: 300, replicas: 2, latencyMs: 50, monthlyCost: 70 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'batch_job',
    label: 'Batch Job',
    category: 'Compute',
    color: '#6366f1',
    hint: 'Chews through a whole dataset on a schedule — throughput is the goal, per-request latency is irrelevant.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 5000, monthlyCost: 25 },
    attrFields: STATELESS,
  },

  // ------------------------------------------------------------------------- Data
  {
    type: 'cache',
    label: 'Cache',
    category: 'Data',
    color: '#fbbf24',
    hint: 'Absorbs hot reads in memory; the hit rate is exactly how much load your database never sees.',
    defaults: {
      capacityRps: 80000,
      replicas: 1,
      latencyMs: 1,
      cacheHitRate: 0.8,
      monthlyCost: 40,
    },
    attrFields: ['capacityRps', 'replicas', 'latencyMs', 'cacheHitRate', 'multiAz', 'monthlyCost'],
  },
  {
    type: 'sql_db',
    label: 'SQL Database',
    category: 'Data',
    color: '#f59e0b',
    hint: 'Transactions, joins and real constraints. Usually your first bottleneck and your first SPOF.',
    defaults: { capacityRps: 3000, replicas: 1, latencyMs: 8, monthlyCost: 200 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'nosql_db',
    label: 'NoSQL Store',
    category: 'Data',
    color: '#fb923c',
    hint: 'Scales by partition key with flexible schemas — you trade joins and strong consistency for it.',
    defaults: { capacityRps: 10000, replicas: 3, latencyMs: 5, multiAz: true, monthlyCost: 250 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'blob_store',
    label: 'Object Store',
    category: 'Data',
    color: '#f97316',
    hint: 'Cheap durable home for large immutable bytes — images, video, backups; serve via CDN, not your app.',
    defaults: { capacityRps: 5500, replicas: 1, latencyMs: 60, multiAz: true, monthlyCost: 25 },
    attrFields: MANAGED,
  },
  {
    type: 'search_index',
    label: 'Search Index',
    category: 'Data',
    color: '#fcd34d',
    hint: 'Full-text and faceted queries your database cannot do fast — a derived, rebuildable copy.',
    defaults: { capacityRps: 2000, replicas: 2, latencyMs: 25, monthlyCost: 150 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'read_replica',
    label: 'Read Replica',
    category: 'Data',
    color: '#fdba74',
    hint: 'Moves read load off the primary and gives it a failover target — reads are slightly stale by design.',
    defaults: { capacityRps: 3000, replicas: 2, latencyMs: 8, multiAz: true, monthlyCost: 150 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'data_warehouse',
    label: 'Data Warehouse',
    category: 'Data',
    color: '#d97706',
    hint: 'Columnar store for analytics across all of history — never put it on a user request path.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 2000, multiAz: true, monthlyCost: 400 },
    attrFields: MANAGED,
  },
  {
    type: 'olap_db',
    label: 'OLAP Database',
    category: 'Data',
    color: '#fde68a',
    hint: 'Slices and aggregates billions of rows in near-real time — dashboards and funnels, not transactions.',
    defaults: { capacityRps: 200, replicas: 3, latencyMs: 500, multiAz: true, monthlyCost: 250 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'timeseries_db',
    label: 'Time-Series DB',
    category: 'Data',
    color: '#eab308',
    hint: 'Append-heavy metric store with retention and downsampling built in — the right home for telemetry.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 10, multiAz: true, monthlyCost: 110 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'graph_db',
    label: 'Graph Database',
    category: 'Data',
    color: '#facc15',
    hint: 'Treats relationships as data — multi-hop traversals (friends-of-friends, fraud rings) a SQL join chokes on.',
    defaults: { capacityRps: 1500, replicas: 2, latencyMs: 20, multiAz: true, monthlyCost: 180 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'data_lake',
    label: 'Data Lake',
    category: 'Data',
    color: '#fed7aa',
    hint: 'Cheap raw storage for everything you might analyse later — schema is applied on read, not on write.',
    defaults: { capacityRps: 100, replicas: 1, latencyMs: 1000, multiAz: true, monthlyCost: 60 },
    attrFields: MANAGED,
  },
  {
    type: 'cdc_connector',
    label: 'CDC Connector',
    category: 'Data',
    color: '#ffb020',
    hint: 'Streams every row change out of the database so search, caches and analytics stay in sync without dual writes.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 50, monthlyCost: 80 },
    attrFields: STATELESS,
  },

  // ------------------------------------------------------------------------ Async
  {
    type: 'queue',
    label: 'Message Queue',
    category: 'Async',
    color: '#4ade80',
    hint: 'Decouples producer from consumer and buffers spikes — the backlog absorbs what capacity cannot.',
    defaults: {
      capacityRps: 20000,
      replicas: 1,
      latencyMs: 3,
      queueDepthMax: 100000,
      monthlyCost: 30,
    },
    attrFields: [
      'capacityRps',
      'replicas',
      'latencyMs',
      'queueDepthMax',
      'multiAz',
      'monthlyCost',
    ],
  },
  {
    type: 'stream',
    label: 'Event Stream',
    category: 'Async',
    color: '#22c55e',
    hint: 'A replayable ordered log many consumers read independently — events stay after being read.',
    defaults: {
      capacityRps: 50000,
      replicas: 6,
      latencyMs: 5,
      queueDepthMax: 5000000,
      multiAz: true,
      monthlyCost: 120,
    },
    attrFields: [
      'capacityRps',
      'replicas',
      'latencyMs',
      'queueDepthMax',
      'multiAz',
      'monthlyCost',
    ],
  },
  {
    type: 'worker',
    label: 'Worker',
    category: 'Async',
    color: '#34d399',
    hint: 'Drains a queue in the background so slow work never blocks a user request.',
    defaults: { capacityRps: 200, replicas: 4, latencyMs: 120, monthlyCost: 45 },
    attrFields: STATELESS,
  },
  {
    type: 'scheduler',
    label: 'Scheduler',
    category: 'Async',
    color: '#86efac',
    hint: 'Fires periodic and delayed jobs — cleanups, rollups, retries. Must be idempotent and leader-elected.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 10, monthlyCost: 10 },
    attrFields: STATELESS,
  },
  {
    type: 'event_bus',
    label: 'Event Bus',
    category: 'Async',
    color: '#10b981',
    hint: 'Publish once, fan out to every interested subscriber — the producer never learns who consumes.',
    defaults: {
      capacityRps: 25000,
      replicas: 1,
      latencyMs: 4,
      queueDepthMax: 1000000,
      multiAz: true,
      monthlyCost: 45,
    },
    attrFields: BUFFERED,
  },
  {
    type: 'dead_letter_queue',
    label: 'Dead Letter Queue',
    category: 'Async',
    color: '#a3e635',
    hint: 'Parks messages that failed every retry, so one poison message cannot wedge the whole queue.',
    defaults: {
      capacityRps: 20000,
      replicas: 1,
      latencyMs: 3,
      queueDepthMax: 100000,
      multiAz: true,
      monthlyCost: 10,
    },
    attrFields: BUFFERED,
  },
  {
    type: 'workflow_engine',
    label: 'Workflow Engine',
    category: 'Async',
    color: '#6ee7b7',
    hint: 'Runs long multi-step processes durably — state, retries and timers survive a crash mid-flight.',
    defaults: { capacityRps: 500, replicas: 2, latencyMs: 30, multiAz: true, monthlyCost: 90 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'saga_orchestrator',
    label: 'Saga Orchestrator',
    category: 'Async',
    color: '#16a34a',
    hint: 'Drives a transaction across services and issues compensating actions when a later step fails.',
    defaults: { capacityRps: 400, replicas: 2, latencyMs: 40, monthlyCost: 55 },
    attrFields: STATELESS_HA,
  },

  // --------------------------------------------------------------------------- AI
  {
    type: 'llm',
    label: 'LLM',
    category: 'AI',
    color: '#f472b6',
    hint: 'Slow, expensive and non-deterministic per call — cache, stream tokens and cap concurrency.',
    defaults: { capacityRps: 20, replicas: 1, latencyMs: 1200, monthlyCost: 500 },
    attrFields: STATELESS,
  },
  {
    type: 'embedding_svc',
    label: 'Embedding Service',
    category: 'AI',
    color: '#f9a8d4',
    hint: 'Turns text into vectors for retrieval — batch it, and re-embed everything when the model changes.',
    defaults: { capacityRps: 300, replicas: 2, latencyMs: 90, monthlyCost: 120 },
    attrFields: STATELESS,
  },
  {
    type: 'vector_db',
    label: 'Vector DB',
    category: 'AI',
    color: '#ec4899',
    hint: 'Nearest-neighbour search over embeddings — the retrieval half of RAG; recall is a tuning knob.',
    defaults: { capacityRps: 1500, replicas: 2, latencyMs: 35, multiAz: true, monthlyCost: 180 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'eval_gate',
    label: 'Eval Gate',
    category: 'AI',
    color: '#e879f9',
    hint: 'Scores or filters model output before it reaches a user — safety, grounding and regression checks.',
    defaults: { capacityRps: 400, replicas: 2, latencyMs: 150, monthlyCost: 60 },
    attrFields: STATELESS,
  },
  {
    type: 'model_router',
    label: 'Model Router',
    category: 'AI',
    color: '#d946ef',
    hint: 'Sends each request to the cheapest model that can handle it and escalates only when it must.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 5, monthlyCost: 30 },
    attrFields: STATELESS,
  },
  {
    type: 'prompt_cache',
    label: 'Prompt Cache',
    category: 'AI',
    color: '#fbcfe8',
    hint: 'Returns a stored completion for a repeated prompt — the cheapest cut you can make to LLM cost and latency.',
    defaults: {
      capacityRps: 50000,
      replicas: 1,
      latencyMs: 2,
      cacheHitRate: 0.8,
      monthlyCost: 35,
    },
    attrFields: CACHED,
  },
  {
    type: 'guardrail',
    label: 'Guardrail',
    category: 'AI',
    color: '#f0abfc',
    hint: 'Screens what goes into and out of the model — prompt injection, PII leakage, jailbreaks, off-policy answers.',
    defaults: { capacityRps: 200, replicas: 2, latencyMs: 150, monthlyCost: 60 },
    attrFields: STATELESS,
  },
  {
    type: 'reranker',
    label: 'Reranker',
    category: 'AI',
    color: '#db2777',
    hint: 'Re-scores retrieved candidates so only the best few enter the prompt — the precision fix for cheap recall.',
    defaults: { capacityRps: 100, replicas: 2, latencyMs: 120, monthlyCost: 90 },
    attrFields: STATELESS,
  },
  {
    type: 'agent_runtime',
    label: 'Agent Runtime',
    category: 'AI',
    color: '#c026d3',
    hint: 'Loops a model over tools until the task is done — cap steps, budget and concurrency or it never stops.',
    defaults: { capacityRps: 10, replicas: 2, latencyMs: 4000, monthlyCost: 400 },
    attrFields: STATELESS,
  },
  {
    type: 'feature_store',
    label: 'Feature Store',
    category: 'AI',
    color: '#ee87c5',
    hint: 'Serves the same computed features to training and to inference — the cure for train/serve skew.',
    defaults: { capacityRps: 3000, replicas: 2, latencyMs: 15, multiAz: true, monthlyCost: 130 },
    attrFields: STATELESS_HA,
  },

  // --------------------------------------------------------------------- Security
  {
    type: 'iam',
    label: 'IAM',
    category: 'Security',
    color: '#fb7185',
    hint: 'Defines which identity may do what to which resource — the policy layer behind every authorization check.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 15, multiAz: true, monthlyCost: 30 },
    attrFields: MANAGED,
  },
  {
    type: 'kms',
    label: 'Key Management',
    category: 'Security',
    color: '#f43f5e',
    hint: 'Holds encryption keys and does the crypto for you, so raw key material never reaches your app or logs.',
    defaults: { capacityRps: 10000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 15 },
    attrFields: MANAGED,
  },
  {
    type: 'audit_log',
    label: 'Audit Log',
    category: 'Security',
    color: '#fda4af',
    hint: 'Append-only, tamper-evident record of every privileged action — what compliance and incident review actually need.',
    defaults: { capacityRps: 20000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 40 },
    attrFields: MANAGED,
  },

  // -------------------------------------------------------------------------- Ops
  {
    type: 'auth',
    label: 'Auth Service',
    category: 'Ops',
    color: '#cbd5e1',
    hint: 'Establishes who the caller is and what they may do — verify tokens at the edge, authorize at the service.',
    defaults: { capacityRps: 4000, replicas: 2, latencyMs: 20, multiAz: true, monthlyCost: 50 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'observability',
    label: 'Observability',
    category: 'Ops',
    color: '#94a3b8',
    hint: 'Metrics, logs and traces off the request path — without it you cannot tell degraded from down.',
    defaults: { capacityRps: 20000, replicas: 1, latencyMs: 0, monthlyCost: 90 },
    attrFields: ['capacityRps', 'latencyMs', 'monthlyCost'],
  },
  {
    type: 'feature_flags',
    label: 'Feature Flags',
    category: 'Ops',
    color: '#e2e8f0',
    hint: 'Decouples deploy from release: ship dark, enable per cohort, and kill a bad feature without a rollback.',
    defaults: { capacityRps: 50000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 25 },
    attrFields: MANAGED,
  },
  {
    type: 'secrets_manager',
    label: 'Secrets Manager',
    category: 'Ops',
    color: '#7f8ea3',
    hint: 'Stores and rotates credentials outside the repo, handed to services at runtime instead of baked into images.',
    defaults: { capacityRps: 5000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 20 },
    attrFields: MANAGED,
  },
  {
    type: 'ci_cd',
    label: 'CI/CD Pipeline',
    category: 'Ops',
    color: '#a9b6c8',
    hint: 'Builds, tests and rolls out every change — your deploy frequency and time-to-rollback are decided here.',
    defaults: { capacityRps: 10, replicas: 1, latencyMs: 60000, monthlyCost: 50 },
    attrFields: STATELESS,
  },

  // ----------------------------------------------------------------------- Layout
  {
    type: 'group',
    label: 'Group',
    category: 'Layout',
    color: '#6b7280',
    hint: 'A boundary, not a component: region, VPC, cell or team. Draws the blast radius.',
    defaults: {},
    attrFields: [],
  },
] satisfies NodeSpec[];

export const NODE_CATALOG: NodeSpec[] = CATALOG;

export const NODE_SPEC = Object.fromEntries(
  CATALOG.map((spec) => [spec.type, spec]),
) as Record<ArchNodeType, NodeSpec>;

/** Palette sections, ready to render. */
export function catalogByCategory(): { category: NodeCategory; specs: NodeSpec[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    specs: NODE_CATALOG.filter((spec) => spec.category === category),
  }));
}

// --- Compile-time completeness: fails to build if a node type has no entry. ---
type AssertNever<T extends never> = T;
type MissingFromCatalog = Exclude<ArchNodeType, (typeof CATALOG)[number]['type']>;
export type CatalogIsComplete = AssertNever<MissingFromCatalog>;

// --- Runtime sanity: catches duplicates, which the type check cannot see. ---
if (CATALOG.length !== ARCH_NODE_TYPES.length) {
  throw new Error(
    `NODE_CATALOG has ${CATALOG.length} entries but ARCH_NODE_TYPES has ${ARCH_NODE_TYPES.length}`,
  );
}
