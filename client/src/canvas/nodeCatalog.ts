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
//   external + LLM    -> tens-to-hundreds rps, 250-1200ms
import { ARCH_NODE_TYPES } from '@archdojo/shared';
import type { ArchNodeType, NodeAttrs } from '@archdojo/shared';

export type NodeCategory =
  | 'Edge & Traffic'
  | 'Compute'
  | 'Data'
  | 'Async'
  | 'AI'
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
