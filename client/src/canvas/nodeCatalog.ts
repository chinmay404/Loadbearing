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
import { ARCH_NODE_TYPES } from '@loadbearing/shared';
import type { ArchNodeType, NodeAttrs } from '@loadbearing/shared';

export type NodeCategory =
  | 'Edge & Traffic'
  | 'Compute'
  | 'Data'
  | 'Async'
  | 'Integration'
  | 'Media'
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
  'Integration',
  'Media',
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
    color: '#e0bd6c',
    hint: 'Where traffic originates — the browser your users actually hold.',
    defaults: {},
    attrFields: [],
  },
  {
    type: 'mobile_client',
    label: 'Mobile App',
    category: 'Edge & Traffic',
    color: '#d7b05c',
    hint: 'A client you cannot hotfix: assume old versions and flaky networks forever.',
    defaults: {},
    attrFields: [],
  },
  {
    type: 'dns',
    label: 'DNS',
    category: 'Edge & Traffic',
    color: '#c69a3d',
    hint: 'Turns a name into an address — and is your cheapest failover and geo-routing lever.',
    defaults: { capacityRps: 100000, replicas: 1, latencyMs: 15, multiAz: true, monthlyCost: 5 },
    attrFields: MANAGED,
  },
  {
    type: 'cdn',
    label: 'CDN',
    category: 'Edge & Traffic',
    color: '#cfa349',
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
    color: '#d9b45f',
    hint: 'Spreads traffic over healthy replicas and hides instance failures from callers.',
    defaults: { capacityRps: 50000, replicas: 2, latencyMs: 1, multiAz: true, monthlyCost: 25 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'api_gateway',
    label: 'API Gateway',
    category: 'Edge & Traffic',
    color: '#e3c47a',
    hint: 'One front door: routing, authn, quotas and versioning applied before any service sees the call.',
    defaults: { capacityRps: 10000, replicas: 2, latencyMs: 5, multiAz: true, monthlyCost: 60 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'rate_limiter',
    label: 'Rate Limiter',
    category: 'Edge & Traffic',
    color: '#dcb765',
    hint: 'Sheds load on purpose so one abusive caller cannot take the system down for everyone.',
    defaults: { capacityRps: 30000, replicas: 2, latencyMs: 1, monthlyCost: 20 },
    attrFields: STATELESS,
  },
  {
    type: 'websocket_gw',
    label: 'WebSocket Gateway',
    category: 'Edge & Traffic',
    color: '#caa04a',
    hint: 'Holds long-lived duplex connections for push and realtime — connection count, not rps, is the limit.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 3, multiAz: true, monthlyCost: 80 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'waf',
    label: 'WAF',
    category: 'Edge & Traffic',
    color: '#c8a555',
    hint: 'Blocks injection, bots and L7 floods at the perimeter, before a request can reach your app.',
    defaults: { capacityRps: 40000, replicas: 2, latencyMs: 3, multiAz: true, monthlyCost: 45 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'reverse_proxy',
    label: 'Reverse Proxy',
    category: 'Edge & Traffic',
    color: '#b98d31',
    hint: 'Terminates TLS and fronts your origins — routing, compression and connection reuse in one cheap hop.',
    defaults: { capacityRps: 40000, replicas: 2, latencyMs: 2, multiAz: true, monthlyCost: 20 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'bff',
    label: 'Backend for Frontend',
    category: 'Edge & Traffic',
    color: '#d2a83f',
    hint: 'One API shaped for one client: aggregates services so the app needs a single round trip.',
    defaults: { capacityRps: 400, replicas: 3, latencyMs: 45, monthlyCost: 55 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'graphql_gateway',
    label: 'GraphQL Gateway',
    category: 'Edge & Traffic',
    color: '#c19b4b',
    hint: 'Clients request exactly the fields they need across services — you own the N+1 fan-out and query-cost limits.',
    defaults: { capacityRps: 800, replicas: 2, latencyMs: 35, monthlyCost: 70 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'service_mesh',
    label: 'Service Mesh',
    category: 'Edge & Traffic',
    color: '#b08a3a',
    hint: 'Sidecars that add mTLS, retries, timeouts and traffic shifting to every call without touching service code.',
    defaults: { capacityRps: 30000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 65 },
    attrFields: STATELESS_HA,
  },

  // ---------------------------------------------------------------------- Compute
  {
    type: 'service',
    label: 'Service',
    category: 'Compute',
    color: '#c9703f',
    hint: 'A stateless unit of business logic you can scale horizontally and deploy on its own.',
    defaults: { capacityRps: 500, replicas: 2, latencyMs: 40, monthlyCost: 30 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'monolith',
    label: 'Monolith',
    category: 'Compute',
    color: '#b96234',
    hint: 'All logic in one deployable — simplest and fastest to build, until scaling and teams collide.',
    defaults: { capacityRps: 800, replicas: 1, latencyMs: 60, monthlyCost: 120 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'serverless_fn',
    label: 'Serverless Function',
    category: 'Compute',
    color: '#d47f4d',
    hint: 'Scales to zero and to thousands per event — pay per call, but mind cold starts and connection limits.',
    defaults: { capacityRps: 200, replicas: 20, latencyMs: 60, monthlyCost: 40 },
    attrFields: STATELESS,
  },
  {
    type: 'third_party',
    label: 'Third-Party API',
    category: 'Integration',
    color: '#dc8a6e',
    hint: 'A dependency you cannot fix or scale — wrap it in timeouts, retries and a circuit breaker.',
    defaults: { capacityRps: 200, replicas: 1, latencyMs: 250, monthlyCost: 0 },
    attrFields: ['capacityRps', 'latencyMs', 'monthlyCost'],
  },
  {
    type: 'edge_function',
    label: 'Edge Function',
    category: 'Compute',
    color: '#e08c5b',
    hint: 'Runs small logic in the PoP nearest the user — auth checks, redirects, personalisation with no origin hop.',
    defaults: { capacityRps: 5000, replicas: 1, latencyMs: 20, multiAz: true, monthlyCost: 15 },
    attrFields: MANAGED,
  },
  {
    type: 'container_platform',
    label: 'Container Platform',
    category: 'Compute',
    color: '#ad5a2e',
    hint: 'Schedules containers, restarts dead ones and owns autoscaling — a control plane, not a request hop.',
    defaults: { capacityRps: 50000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 75 },
    attrFields: MANAGED,
  },
  {
    type: 'vm',
    label: 'Virtual Machine',
    category: 'Compute',
    color: '#c07a4d',
    hint: 'A whole OS you own and patch — reach for it when you need the box, not just the process.',
    defaults: { capacityRps: 300, replicas: 2, latencyMs: 50, monthlyCost: 70 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'batch_job',
    label: 'Batch Job',
    category: 'Compute',
    color: '#a85128',
    hint: 'Chews through a whole dataset on a schedule — throughput is the goal, per-request latency is irrelevant.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 5000, monthlyCost: 25 },
    attrFields: STATELESS,
  },

  // ------------------------------------------------------------------------- Data
  {
    type: 'cache',
    label: 'Cache',
    category: 'Data',
    color: '#a8b56b',
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
    color: '#9aa95f',
    hint: 'Transactions, joins and real constraints. Usually your first bottleneck and your first SPOF.',
    defaults: { capacityRps: 3000, replicas: 1, latencyMs: 8, monthlyCost: 200 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'nosql_db',
    label: 'NoSQL Store',
    category: 'Data',
    color: '#a4b164',
    hint: 'Scales by partition key with flexible schemas — you trade joins and strong consistency for it.',
    defaults: { capacityRps: 10000, replicas: 3, latencyMs: 5, multiAz: true, monthlyCost: 250 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'blob_store',
    label: 'Object Store',
    category: 'Data',
    color: '#8f9e58',
    hint: 'Cheap durable home for large immutable bytes — images, video, backups; serve via CDN, not your app.',
    defaults: { capacityRps: 5500, replicas: 1, latencyMs: 60, multiAz: true, monthlyCost: 25 },
    attrFields: MANAGED,
  },
  {
    type: 'search_index',
    label: 'Search Index',
    category: 'Data',
    color: '#b0bd75',
    hint: 'Full-text and faceted queries your database cannot do fast — a derived, rebuildable copy.',
    defaults: { capacityRps: 2000, replicas: 2, latencyMs: 25, monthlyCost: 150 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'read_replica',
    label: 'Read Replica',
    category: 'Data',
    color: '#8d9c54',
    hint: 'Moves read load off the primary and gives it a failover target — reads are slightly stale by design.',
    defaults: { capacityRps: 3000, replicas: 2, latencyMs: 8, multiAz: true, monthlyCost: 150 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'data_warehouse',
    label: 'Data Warehouse',
    category: 'Data',
    color: '#7f8e4c',
    hint: 'Columnar store for analytics across all of history — never put it on a user request path.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 2000, multiAz: true, monthlyCost: 400 },
    attrFields: MANAGED,
  },
  {
    type: 'olap_db',
    label: 'OLAP Database',
    category: 'Data',
    color: '#96a45a',
    hint: 'Slices and aggregates billions of rows in near-real time — dashboards and funnels, not transactions.',
    defaults: { capacityRps: 200, replicas: 3, latencyMs: 500, multiAz: true, monthlyCost: 250 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'timeseries_db',
    label: 'Time-Series DB',
    category: 'Data',
    color: '#a9b76e',
    hint: 'Append-heavy metric store with retention and downsampling built in — the right home for telemetry.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 10, multiAz: true, monthlyCost: 110 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'graph_db',
    label: 'Graph Database',
    category: 'Data',
    color: '#889751',
    hint: 'Treats relationships as data — multi-hop traversals (friends-of-friends, fraud rings) a SQL join chokes on.',
    defaults: { capacityRps: 1500, replicas: 2, latencyMs: 20, multiAz: true, monthlyCost: 180 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'data_lake',
    label: 'Data Lake',
    category: 'Data',
    color: '#748345',
    hint: 'Cheap raw storage for everything you might analyse later — schema is applied on read, not on write.',
    defaults: { capacityRps: 100, replicas: 1, latencyMs: 1000, multiAz: true, monthlyCost: 60 },
    attrFields: MANAGED,
  },
  {
    type: 'cdc_connector',
    label: 'CDC Connector',
    category: 'Data',
    color: '#9db06a',
    hint: 'Streams every row change out of the database so search, caches and analytics stay in sync without dual writes.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 50, monthlyCost: 80 },
    attrFields: STATELESS,
  },

  // ------------------------------------------------------------------------ Async
  {
    type: 'queue',
    label: 'Message Queue',
    category: 'Async',
    color: '#6fa271',
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
    color: '#63955f',
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
    color: '#84b586',
    hint: 'Drains a queue in the background so slow work never blocks a user request.',
    defaults: { capacityRps: 200, replicas: 4, latencyMs: 120, monthlyCost: 45 },
    attrFields: STATELESS,
  },
  {
    type: 'scheduler',
    label: 'Scheduler',
    category: 'Async',
    color: '#6d9c6a',
    hint: 'Fires periodic and delayed jobs — cleanups, rollups, retries. Must be idempotent and leader-elected.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 10, monthlyCost: 10 },
    attrFields: STATELESS,
  },
  {
    type: 'event_bus',
    label: 'Event Bus',
    category: 'Async',
    color: '#7cae7e',
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
    color: '#588a54',
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
    color: '#5f9163',
    hint: 'Runs long multi-step processes durably — state, retries and timers survive a crash mid-flight.',
    defaults: { capacityRps: 500, replicas: 2, latencyMs: 30, multiAz: true, monthlyCost: 90 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'saga_orchestrator',
    label: 'Saga Orchestrator',
    category: 'Async',
    color: '#78a878',
    hint: 'Drives a transaction across services and issues compensating actions when a later step fails.',
    defaults: { capacityRps: 400, replicas: 2, latencyMs: 40, monthlyCost: 55 },
    attrFields: STATELESS_HA,
  },

  // --------------------------------------------------------------------------- AI
  {
    type: 'llm',
    label: 'LLM',
    category: 'AI',
    color: '#c06a9e',
    hint: 'Slow, expensive and non-deterministic per call — cache, stream tokens and cap concurrency.',
    defaults: { capacityRps: 20, replicas: 1, latencyMs: 1200, monthlyCost: 500 },
    attrFields: STATELESS,
  },
  {
    type: 'embedding_svc',
    label: 'Embedding Service',
    category: 'AI',
    color: '#cb7cab',
    hint: 'Turns text into vectors for retrieval — batch it, and re-embed everything when the model changes.',
    defaults: { capacityRps: 300, replicas: 2, latencyMs: 90, monthlyCost: 120 },
    attrFields: STATELESS,
  },
  {
    type: 'vector_db',
    label: 'Vector DB',
    category: 'AI',
    color: '#b25c90',
    hint: 'Nearest-neighbour search over embeddings — the retrieval half of RAG; recall is a tuning knob.',
    defaults: { capacityRps: 1500, replicas: 2, latencyMs: 35, multiAz: true, monthlyCost: 180 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'eval_gate',
    label: 'Eval Gate',
    category: 'AI',
    color: '#a54f83',
    hint: 'Scores or filters model output before it reaches a user — safety, grounding and regression checks.',
    defaults: { capacityRps: 400, replicas: 2, latencyMs: 150, monthlyCost: 60 },
    attrFields: STATELESS,
  },
  {
    type: 'model_router',
    label: 'Model Router',
    category: 'AI',
    color: '#d68cb8',
    hint: 'Sends each request to the cheapest model that can handle it and escalates only when it must.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 5, monthlyCost: 30 },
    attrFields: STATELESS,
  },
  {
    type: 'prompt_cache',
    label: 'Prompt Cache',
    category: 'AI',
    color: '#bb6699',
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
    color: '#98457a',
    hint: 'Screens what goes into and out of the model — prompt injection, PII leakage, jailbreaks, off-policy answers.',
    defaults: { capacityRps: 200, replicas: 2, latencyMs: 150, monthlyCost: 60 },
    attrFields: STATELESS,
  },
  {
    type: 'reranker',
    label: 'Reranker',
    category: 'AI',
    color: '#c97aa6',
    hint: 'Re-scores retrieved candidates so only the best few enter the prompt — the precision fix for cheap recall.',
    defaults: { capacityRps: 100, replicas: 2, latencyMs: 120, monthlyCost: 90 },
    attrFields: STATELESS,
  },
  {
    type: 'agent_runtime',
    label: 'Agent Runtime',
    category: 'AI',
    color: '#ad5589',
    hint: 'Loops a model over tools until the task is done — cap steps, budget and concurrency or it never stops.',
    defaults: { capacityRps: 10, replicas: 2, latencyMs: 4000, monthlyCost: 400 },
    attrFields: STATELESS,
  },
  {
    type: 'feature_store',
    label: 'Feature Store',
    category: 'AI',
    color: '#d29ac0',
    hint: 'Serves the same computed features to training and to inference — the cure for train/serve skew.',
    defaults: { capacityRps: 3000, replicas: 2, latencyMs: 15, multiAz: true, monthlyCost: 130 },
    attrFields: STATELESS_HA,
  },

  // --------------------------------------------------------------------- Security
  {
    type: 'iam',
    label: 'IAM',
    category: 'Security',
    color: '#c8514c',
    hint: 'Defines which identity may do what to which resource — the policy layer behind every authorization check.',
    defaults: { capacityRps: 5000, replicas: 2, latencyMs: 15, multiAz: true, monthlyCost: 30 },
    attrFields: MANAGED,
  },
  {
    type: 'kms',
    label: 'Key Management',
    category: 'Security',
    color: '#b64440',
    hint: 'Holds encryption keys and does the crypto for you, so raw key material never reaches your app or logs.',
    defaults: { capacityRps: 10000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 15 },
    attrFields: MANAGED,
  },
  {
    type: 'audit_log',
    label: 'Audit Log',
    category: 'Security',
    color: '#d4685f',
    hint: 'Append-only, tamper-evident record of every privileged action — what compliance and incident review actually need.',
    defaults: { capacityRps: 20000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 40 },
    attrFields: MANAGED,
  },

  // -------------------------------------------------------------------------- Ops
  {
    type: 'auth',
    label: 'Auth Service',
    category: 'Ops',
    color: '#b8a794',
    hint: 'Establishes who the caller is and what they may do — verify tokens at the edge, authorize at the service.',
    defaults: { capacityRps: 4000, replicas: 2, latencyMs: 20, multiAz: true, monthlyCost: 50 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'observability',
    label: 'Observability',
    category: 'Ops',
    color: '#a79684',
    hint: 'Metrics, logs and traces off the request path — without it you cannot tell degraded from down.',
    defaults: { capacityRps: 20000, replicas: 1, latencyMs: 0, monthlyCost: 90 },
    attrFields: ['capacityRps', 'latencyMs', 'monthlyCost'],
  },
  {
    type: 'feature_flags',
    label: 'Feature Flags',
    category: 'Ops',
    color: '#96866f',
    hint: 'Decouples deploy from release: ship dark, enable per cohort, and kill a bad feature without a rollback.',
    defaults: { capacityRps: 50000, replicas: 1, latencyMs: 1, multiAz: true, monthlyCost: 25 },
    attrFields: MANAGED,
  },
  {
    type: 'secrets_manager',
    label: 'Secrets Manager',
    category: 'Ops',
    color: '#a2917d',
    hint: 'Stores and rotates credentials outside the repo, handed to services at runtime instead of baked into images.',
    defaults: { capacityRps: 5000, replicas: 1, latencyMs: 5, multiAz: true, monthlyCost: 20 },
    attrFields: MANAGED,
  },
  {
    type: 'ci_cd',
    label: 'CI/CD Pipeline',
    category: 'Ops',
    color: '#8d7d68',
    hint: 'Builds, tests and rolls out every change — your deploy frequency and time-to-rollback are decided here.',
    defaults: { capacityRps: 10, replicas: 1, latencyMs: 60000, monthlyCost: 50 },
    attrFields: STATELESS,
  },

  // ----------------------------------------------------------------------- Layout
  {
    type: 'group',
    label: 'Group',
    category: 'Layout',
    color: '#7c766c',
    hint: 'A boundary, not a component: region, VPC, cell or team. Draws the blast radius.',
    defaults: {},
    attrFields: [],
  },
  {
    type: 'geo_router',
    label: 'Geo Router',
    category: 'Edge & Traffic',
    color: '#bd9134',
    hint: 'Steers each user to the nearest healthy region by latency or geography.',
    defaults: { capacityRps: 100000, replicas: 2, latencyMs: 20, multiAz: true, monthlyCost: 10 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'bastion',
    label: 'Bastion Host',
    category: 'Edge & Traffic',
    color: '#af8628',
    hint: 'The single audited door for human access to private infrastructure.',
    defaults: { capacityRps: 50, replicas: 1, latencyMs: 30, monthlyCost: 15 },
    attrFields: STATELESS,
  },
  {
    type: 'sidecar',
    label: 'Sidecar',
    category: 'Compute',
    color: '#d68a63',
    hint: 'Per-instance proxy adding mTLS, retries and telemetry without touching your code.',
    defaults: { capacityRps: 30000, replicas: 1, latencyMs: 1, monthlyCost: 10 },
    attrFields: STATELESS,
  },
  {
    type: 'connection_pooler',
    label: 'Connection Pooler',
    category: 'Compute',
    color: '#bb6a45',
    hint: 'Multiplexes many client connections onto the few a database can actually hold.',
    defaults: { capacityRps: 20000, replicas: 2, latencyMs: 1, monthlyCost: 20 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'db_proxy',
    label: 'DB Proxy',
    category: 'Data',
    color: '#b5c07e',
    hint: 'Routes reads to replicas and writes to the primary, hiding failover from callers.',
    defaults: { capacityRps: 15000, replicas: 2, latencyMs: 2, multiAz: true, monthlyCost: 30 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'materialized_view',
    label: 'Materialized View',
    category: 'Data',
    color: '#84964f',
    hint: 'A precomputed read model: an expensive query paid for on write instead of on read.',
    defaults: { capacityRps: 8000, replicas: 1, latencyMs: 4, monthlyCost: 40 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'session_store',
    label: 'Session Store',
    category: 'Data',
    color: '#a2ae63',
    hint: 'Server-side session state, so any instance can serve any logged-in user.',
    defaults: { capacityRps: 40000, replicas: 2, latencyMs: 2, multiAz: true, monthlyCost: 50 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'backup_store',
    label: 'Backup Store',
    category: 'Data',
    color: '#7a8949',
    hint: 'Snapshots and point-in-time archives — the only thing that survives a bad migration.',
    defaults: { capacityRps: 20, replicas: 1, latencyMs: 2000, monthlyCost: 40 },
    attrFields: MANAGED,
  },
  {
    type: 'sharded_cluster',
    label: 'Sharded Cluster',
    category: 'Data',
    color: '#93a256',
    hint: 'Data split across nodes by a partition key, when one machine can no longer hold it.',
    defaults: { capacityRps: 12000, replicas: 3, latencyMs: 8, multiAz: true, monthlyCost: 400 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'ledger_db',
    label: 'Ledger',
    category: 'Data',
    color: '#869440',
    hint: 'Append-only financial record: entries are never updated, only compensated.',
    defaults: { capacityRps: 1500, replicas: 2, latencyMs: 12, multiAz: true, monthlyCost: 250 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'change_feed',
    label: 'Change Feed',
    category: 'Async',
    color: '#8bb98d',
    hint: "Subscribe to a store's changes in order, without polling it.",
    defaults: { capacityRps: 8000, replicas: 1, latencyMs: 20, queueDepthMax: 100000, monthlyCost: 45 },
    attrFields: BUFFERED,
  },
  {
    type: 'batch_scheduler',
    label: 'Batch Scheduler',
    category: 'Async',
    color: '#4f8250',
    hint: 'Owns the batch window: what runs when, in what order, and what happens if it overruns.',
    defaults: { capacityRps: 500, replicas: 1, latencyMs: 10, monthlyCost: 15 },
    attrFields: STATELESS,
  },
  {
    type: 'webhook_dispatcher',
    label: 'Webhook Dispatcher',
    category: 'Async',
    color: '#6aa06f',
    hint: 'Signed, retried outbound delivery to systems you do not control.',
    defaults: { capacityRps: 2000, replicas: 2, latencyMs: 60, queueDepthMax: 200000, monthlyCost: 35 },
    attrFields: BUFFERED,
  },
  {
    type: 'payment_gateway',
    label: 'Payment Gateway',
    category: 'Integration',
    color: '#d47a5c',
    hint: 'The PSP that moves money: slow, rate-limited, and the one call you must never double-send.',
    defaults: { capacityRps: 150, latencyMs: 450, monthlyCost: 0 },
    attrFields: MANAGED,
  },
  {
    type: 'email_provider',
    label: 'Email Provider',
    category: 'Integration',
    color: '#e39a80',
    hint: 'Transactional email delivery, with bounces and suppression you have to handle.',
    defaults: { capacityRps: 500, latencyMs: 300, monthlyCost: 25 },
    attrFields: MANAGED,
  },
  {
    type: 'sms_provider',
    label: 'SMS Provider',
    category: 'Integration',
    color: '#cb6f52',
    hint: 'Text delivery: expensive per message, and carriers silently drop some of them.',
    defaults: { capacityRps: 200, latencyMs: 500, monthlyCost: 40 },
    attrFields: MANAGED,
  },
  {
    type: 'push_service',
    label: 'Push Service',
    category: 'Integration',
    color: '#e8a893',
    hint: 'APNs and FCM fanout, where device tokens expire and quietly stop working.',
    defaults: { capacityRps: 5000, latencyMs: 150, monthlyCost: 20 },
    attrFields: MANAGED,
  },
  {
    type: 'identity_provider',
    label: 'Identity Provider',
    category: 'Integration',
    color: '#c26647',
    hint: 'External login (social or corporate SSO): an availability dependency on your front door.',
    defaults: { capacityRps: 1000, latencyMs: 220, monthlyCost: 30 },
    attrFields: MANAGED,
  },
  {
    type: 'transcoder',
    label: 'Transcoder',
    category: 'Media',
    color: '#b07ca8',
    hint: 'Turns one upload into every format and size you serve. Slow, bursty, expensive.',
    defaults: { capacityRps: 5, replicas: 2, latencyMs: 20000, monthlyCost: 150 },
    attrFields: STATELESS,
  },
  {
    type: 'media_streamer',
    label: 'Media Streamer',
    category: 'Media',
    color: '#a06c98',
    hint: "Serves segmented video (HLS/DASH) and adapts quality to each viewer's bandwidth.",
    defaults: { capacityRps: 20000, replicas: 2, latencyMs: 25, multiAz: true, monthlyCost: 120 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'feedback_store',
    label: 'Feedback Store',
    category: 'AI',
    color: '#bf78a4',
    hint: 'Collects thumbs, corrections and labels from real use — the raw material for evals.',
    defaults: { capacityRps: 3000, replicas: 1, latencyMs: 10, monthlyCost: 30 },
    attrFields: STATELESS_HA,
  },
  {
    type: 'experiment_platform',
    label: 'Experiment Platform',
    category: 'AI',
    color: '#a86293',
    hint: 'Assigns users to variants and holdouts, so a change is measured rather than assumed.',
    defaults: { capacityRps: 20000, replicas: 2, latencyMs: 3, monthlyCost: 60 },
    attrFields: STATELESS_HA,
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
