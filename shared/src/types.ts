// Shared contracts between client and server. Node positions never cross the
// LLM boundary; everything else here is the language the app, the simulator,
// and the grader all speak.

export const ARCH_NODE_TYPES = [
  'client',
  'mobile_client',
  'cdn',
  'dns',
  'load_balancer',
  'api_gateway',
  'service',
  'monolith',
  'serverless_fn',
  'cache',
  'sql_db',
  'nosql_db',
  'blob_store',
  'search_index',
  'queue',
  'stream',
  'worker',
  'scheduler',
  'rate_limiter',
  'websocket_gw',
  'third_party',
  'llm',
  'vector_db',
  'embedding_svc',
  'eval_gate',
  'observability',
  'auth',
  'group',
] as const;

export type ArchNodeType = (typeof ARCH_NODE_TYPES)[number];

export type EdgeKind = 'sync' | 'async' | 'replication';

/** Knobs the simulator reads. All optional — defaults come from the node catalog. */
export interface NodeAttrs {
  /** Requests per second ONE replica can serve before saturating. */
  capacityRps?: number;
  /** How many instances (or shards/partitions) exist. */
  replicas?: number;
  /** Service time at low load, ms. */
  latencyMs?: number;
  /** For caches: fraction of reads served without hitting the next hop (0..1). */
  cacheHitRate?: number;
  /** For queues: max buffered messages before shedding. */
  queueDepthMax?: number;
  /** Spread across availability zones / regions — survives a zone loss. */
  multiAz?: boolean;
  /** Monthly cost estimate in USD, used for the cost dimension and the budget check. */
  monthlyCost?: number;
}

export interface GraphNode {
  id: string;
  type: ArchNodeType;
  label: string;
  annotation: string;
  attrs?: NodeAttrs;
  /** Optional grouping (region / VPC / cell) by parent group-node id. */
  parentId?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  /** Fraction of the caller's traffic that takes this edge (0..1, default: even split). */
  share?: number;
}

export type FlowKind = 'read' | 'write' | 'async' | 'admin';

/** A named request path through the design — the thing that makes a diagram a design. */
export interface Flow {
  id: string;
  name: string;
  kind: FlowKind;
  /** Ordered node ids the request traverses. */
  steps: string[];
  /** Baseline load for this flow, requests per second. */
  rps: number;
  description: string;
}

export interface GraphDSL {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stickies: { text: string }[];
  flows: Flow[];
}

/** What the client stores/restores (with geometry). Never sent to the LLM. */
export interface CanvasDoc {
  nodes: (GraphNode & { position: { x: number; y: number }; size?: { w: number; h: number } })[];
  edges: GraphEdge[];
  stickies: { id: string; text: string; position: { x: number; y: number } }[];
  strokes: { points: [number, number][]; color: string }[];
  flows: Flow[];
}

export interface Problem {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  domain: string;
  prompt: string;
  functional: string[];
  nonFunctional: Record<string, string | number>;
  constraints: string[];
  concepts: string[];
  /** Flows the answer is expected to define, by name — graded for coverage. */
  expectedFlows: string[];
  rubricHints: string;
  twists: string[];
  /** Load scenarios the simulator can run against the user's design. */
  scenarios: LoadScenario[];
  custom?: boolean;
}

/** A dynamic load/chaos scenario: ramp traffic, kill components, watch it break. */
export interface LoadScenario {
  id: string;
  name: string;
  description: string;
  /** Multiplier applied to every flow's baseline rps. */
  rpsMultiplier: number;
  /** Node labels (matched case-insensitively) or ids to take offline. */
  killNodes?: string[];
  /** Extra latency injected into every third-party call, ms. */
  thirdPartyLatencyMs?: number;
  /** What a passing design must do. Shown after the run. */
  passCriteria: string;
}

export type ProblemSummary = Pick<
  Problem,
  'id' | 'title' | 'level' | 'domain' | 'concepts' | 'custom'
>;

export const DIMENSION_KEYS = [
  'requirements',
  'scalability',
  'reliability',
  'data_consistency',
  'security',
  'cost_simplicity',
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export interface Dimension {
  score: number;
  max: number;
  notes: string;
}

export interface CriticalFailure {
  title: string;
  detail: string;
  concept: string;
  severity: 'high' | 'medium' | 'low';
}

export interface TeachingBlock {
  component: string;
  why: string;
  breaks_without: string;
  rejected_alt: string;
}

export type MarkerKind = 'spof' | 'missing' | 'good' | 'question' | 'bottleneck';

/** The grader drawing ON your canvas: a pin attached to one of your nodes. */
export interface CanvasMarkup {
  nodeId: string;
  marker: MarkerKind;
  comment: string;
}

/** The grader proposing a component you left out — rendered as an accept-able ghost node. */
export interface SuggestedAddition {
  type: ArchNodeType;
  label: string;
  annotation: string;
  connect_from?: string;
  connect_to?: string;
  kind: EdgeKind;
  why: string;
}

export interface FlowReview {
  flowName: string;
  verdict: 'sound' | 'flawed' | 'missing';
  issues: string[];
}

export interface ScoreResult {
  overall: number;
  dimensions: Record<DimensionKey, Dimension>;
  critical_failures: CriticalFailure[];
  spofs: string[];
  missing: string[];
  good_calls: string[];
  socratic_questions: string[];
  concept_scores: Record<string, number>;
  model_answer_summary: string;
  verdict_teaching: TeachingBlock[];
  canvas_markup: CanvasMarkup[];
  suggested_additions: SuggestedAddition[];
  flow_reviews: FlowReview[];
}

export interface Attempt {
  id: number;
  problemId: string;
  round: number;
  graph: GraphDSL;
  score: ScoreResult;
  overall: number;
  twistText?: string;
  createdAt: string;
}

// ---------- Simulation ----------

export type NodeState = 'ok' | 'warn' | 'saturated' | 'down';

export interface SimNodeResult {
  nodeId: string;
  incomingRps: number;
  capacityRps: number;
  utilization: number;
  latencyMs: number;
  droppedRps: number;
  queueDepth: number;
  state: NodeState;
}

export interface SimFlowResult {
  flowId: string;
  name: string;
  offeredRps: number;
  completedRps: number;
  p50Ms: number;
  p99Ms: number;
  broken: boolean;
  brokenAt?: string;
  notes: string[];
}

export interface SimResult {
  nodes: SimNodeResult[];
  flows: SimFlowResult[];
  bottleneckNodeId: string | null;
  totalDroppedRps: number;
  monthlyCost: number;
  verdict: string;
  findings: string[];
}

export interface SimConfig {
  rpsMultiplier: number;
  killNodeIds: string[];
  thirdPartyLatencyMs: number;
}

// ---------- LLM / settings ----------

export type LlmProvider = 'anthropic' | 'openai-compatible' | 'fake';

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl?: string;
  model: string;
  apiKey: string;
}

export interface SettingsView {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
}

export interface MasteryEntry {
  concept: string;
  name: string;
  group: string;
  ema: number | null;
  attempts: number;
  lastSeen: string | null;
}

export interface Stats {
  attempts: number;
  avgOverall: number | null;
  streakDays: number;
  trend: { date: string; overall: number }[];
}

/** Free-form architecture chat about the current canvas (the "AI interacts with my drawing" path). */
export interface CritiqueRequest {
  problemId: string;
  graph: GraphDSL;
  question: string;
}

export interface CritiqueResponse {
  answer: string;
  canvas_markup: CanvasMarkup[];
  suggested_additions: SuggestedAddition[];
}
