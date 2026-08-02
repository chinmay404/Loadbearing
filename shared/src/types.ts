// Shared contracts between client and server. Node positions never cross the
// LLM boundary; everything else here is the language the app, the simulator,
// and the grader all speak.

import type { BlueprintLike } from './blueprints.js';
import type { CostReport } from './cost.js';

export const ARCH_NODE_TYPES = [
  'client',
  'mobile_client',
  'cdn',
  'dns',
  'geo_router',
  'load_balancer',
  'waf',
  'reverse_proxy',
  'bastion',
  'api_gateway',
  'bff',
  'graphql_gateway',
  'service_mesh',
  'sidecar',
  'service',
  'monolith',
  'serverless_fn',
  'edge_function',
  'container_platform',
  'vm',
  'batch_job',
  'connection_pooler',
  'cache',
  'sql_db',
  'read_replica',
  'db_proxy',
  'sharded_cluster',
  'nosql_db',
  'blob_store',
  'search_index',
  'materialized_view',
  'session_store',
  'backup_store',
  'ledger_db',
  'data_warehouse',
  'olap_db',
  'timeseries_db',
  'graph_db',
  'data_lake',
  'cdc_connector',
  'change_feed',
  'queue',
  'stream',
  'event_bus',
  'dead_letter_queue',
  'worker',
  'scheduler',
  'batch_scheduler',
  'workflow_engine',
  'saga_orchestrator',
  'webhook_dispatcher',
  'rate_limiter',
  'websocket_gw',
  'third_party',
  'payment_gateway',
  'email_provider',
  'sms_provider',
  'push_service',
  'identity_provider',
  'transcoder',
  'media_streamer',
  'llm',
  'vector_db',
  'embedding_svc',
  'eval_gate',
  'model_router',
  'prompt_cache',
  'guardrail',
  'reranker',
  'agent_runtime',
  // Pipeline stages, not managed services. An AI system's real design lives in
  // the steps a document or a question passes through — parse, chunk, extract,
  // validate — and naming those as "a worker" hides every decision in them.
  'doc_source',
  'doc_parser',
  'chunker',
  'extractor',
  'output_validator',
  'retriever',
  'tool_sandbox',
  'mcp_server',
  'agent_memory',
  'pii_redactor',
  'human_review',
  'feature_store',
  'feedback_store',
  'experiment_platform',
  'iam',
  'kms',
  'audit_log',
  'observability',
  'auth',
  'feature_flags',
  'secrets_manager',
  'ci_cd',
  // Migration and legacy. Most architecture work is replacing something that is
  // still running, and none of that was expressible: the system being replaced,
  // the facade that routes between old and new, and the job that repairs the
  // drift between two stores that are both being written to.
  'legacy_system',
  'strangler_facade',
  'reconciler',
  // Self-hosted inference and the data behind a model, as distinct from a metered
  // API — the capacity and cost arithmetic is not remotely the same.
  'model_server',
  'dataset_store',
  'fine_tune_job',
  // Concepts the rubric already scores but nothing could draw.
  'cell_router',
  'idempotency_store',
  'service_registry',
  'sync_engine',
  'offline_store',
  // Practices you run rather than serve traffic through. Included because a
  // design that never draws them never budgets for them either.
  'chaos_injector',
  'budget_guard',
  'siem',
  'consent_store',
  // Anything the catalogue does not name. The label is yours; the simulator still
  // costs it and the checks still see it, so a custom block is a real component
  // rather than an annotation shaped like one.
  'custom',
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

  // ---- what the load engine reads -----------------------------------------

  /**
   * Requests this component holds in flight at once, per replica. With service
   * time this gives capacity (Little's law), which is how a real service
   * saturates: the same 64 workers serve far less when a dependency slows down.
   */
  concurrency?: number;
  /** How long a caller waits for this component before giving up, ms. */
  timeoutMs?: number;
  /**
   * Marks this component as where traffic STARTS, at this many requests per
   * second. The slider multiplies it. Without a source, nothing is offered.
   */
  trafficRps?: number;
  /**
   * The floor an autoscaling group never drops below. This is what serves the first
   * moments of a spike, because capacity above it arrives a minute late — so "min 1,
   * max 50" is a design that meets a sudden rush with one container.
   */
  autoscaleMin?: number;
  /** The ceiling it may grow to. Beyond this, load sheds however much is offered. */
  autoscaleMax?: number;

  // ---- what the instance actually is --------------------------------------
  //
  // Sizing, rather than a capacity number pulled from the air. These drive BOTH what
  // a replica can serve and what it costs, so the two can never disagree: a design
  // cannot be cheap and fast because someone typed both.

  /** vCPUs per replica. With service time this is where capacity comes from. */
  vcpu?: number;
  /** Memory per replica, GB. A cache's working set; a service's headroom. */
  memoryGb?: number;
  /** Data held, GB. The part of a datastore's bill that grows on its own. */
  storageGb?: number;
  /**
   * Partitions the data is split across. Distinct from replicas: shards multiply
   * throughput because each holds different data, replicas hold the same data.
   */
  shards?: number;
  /** What somebody else's system will let you send before it refuses. */
  rateLimitRps?: number;
  /** Price per million calls, for things billed per request. */
  pricePerMillion?: number;
  /** Tokens in and out for one request — an LLM's bill is measured in these. */
  tokensPerRequest?: number;
  /** Price per thousand tokens. */
  pricePer1kTokens?: number;

  /**
   * Runs on a provider's elastic capacity, so its throughput is not your constraint.
   *
   * An Azure embedding endpoint has no replica count you chose and no rps you
   * provisioned; asking for one invites a made-up number, and a magic sentinel like
   * -1 is a number that has to be explained every time somebody reads it. A component
   * marked elastic simply has no capacity limit — what CAN still stop it is the
   * provider's rate limit and the size of your bill, both of which are asked for
   * separately because both are real.
   */
  elastic?: boolean;

  /**
   * On a boundary: the components inside it run ON this pool and share its limits.
   *
   * Six pipeline stages drawn inside one worker group are six processes on the same
   * machines, not six independently-sized services. Without this they each claim
   * their own capacity and their own bill, which flatters the design twice over.
   */
  sharedHost?: boolean;
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
  /**
   * How much of the caller's traffic this connection carries. A router splits its
   * traffic across its outbound connections, so shares are normalised to one; a
   * service calls each dependency once per request, so a share is the fraction of
   * requests that need that call and defaults to all of them.
   */
  share?: number;
  /**
   * Retries the caller makes when this call fails. The mechanism behind a retry
   * storm: a struggling dependency fails more, so more retries are sent, so it
   * struggles more. Zero switches the amplification off.
   */
  retries?: number;
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

/**
 * How a connection is drawn. Presentation only — the grader is told what connects
 * to what and in which direction, never which way the line bends around a box.
 */
export interface EdgeGeometry {
  shape?: 'smooth' | 'straight' | 'curved' | 'step';
  /** Bend points in canvas coordinates, ordered from source to target. */
  points?: { x: number; y: number }[];
}

/** What the client stores/restores (with geometry). Never sent to the LLM. */
export interface CanvasDoc {
  nodes: (GraphNode & {
    position: { x: number; y: number };
    size?: { w: number; h: number };
    /** Stacking order. Boundaries sit behind by default; overlaps are the user's call. */
    z?: number;
    /** Pinned: cannot be dragged or deleted until unlocked. */
    locked?: boolean;
  })[];
  edges: (GraphEdge & EdgeGeometry)[];
  stickies: {
    id: string;
    text: string;
    position: { x: number; y: number };
    size?: { w: number; h: number };
  }[];
  strokes: { points: [number, number][]; color: string }[];
  flows: Flow[];
}

/**
 * What kind of sheet this is.
 *
 * A `design` problem is a blank canvas and a brief. A `lab` starts you with an
 * architecture that already exists — usually one with something wrong in it — and
 * asks you to change it. The difference is one field, `diagram`: a lab loads it onto
 * your sheet, a design problem only shows it.
 */
export type ProblemKind = 'design' | 'lab';

/**
 * A drawn architecture attached to a brief. Structurally a blueprint — same nodes,
 * same edges, same flows — so the canvas can place it without knowing it came from a
 * problem, and the brief can draw it without knowing it can be placed.
 */
export interface ProblemDiagram extends BlueprintLike {
  /** One line under the picture: what you are looking at, and why it is shown. */
  caption: string;
}

export interface Problem {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  domain: string;
  /** Defaults to 'design' when absent, which is what every seed problem was. */
  kind?: ProblemKind;
  /**
   * An architecture drawn alongside the brief. For a design problem this is the
   * system as it stands today — the thing the prompt describes and you are replacing.
   * For a lab it is your starting point, loaded onto the canvas when you begin.
   *
   * Typed as the same shape the blueprint library and user templates use, so placing
   * it is the code path that already exists rather than a second one.
   */
  diagram?: ProblemDiagram;
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

/** Machine-checkable thresholds a design must clear for a scenario to pass. */
export interface ScenarioPass {
  /** Highest tolerable share of offered traffic dropped, in percent (1 = 1%). */
  maxDroppedPct?: number;
  /** Worst acceptable p99 across synchronous flows, ms. */
  maxP99Ms?: number;
  /** When true, no flow may end the run broken. */
  noBrokenFlows?: boolean;
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
  /** Structured gates; when absent, sensible defaults apply (see scenarios.ts). */
  pass?: ScenarioPass;
}

export type ProblemSummary = Pick<
  Problem,
  'id' | 'title' | 'level' | 'domain' | 'concepts' | 'custom' | 'kind'
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
  /** Playbook entry ids this finding rests on. Empty means the grader had no citation. */
  refs?: string[];
}

/** A playbook entry that was put in front of the grader, and why it surfaced. */
export interface ScoreReference {
  id: string;
  title: string;
  source: string;
  sourceKind: string;
  because: string[];
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

/** A risk worth writing down, in the form an ADR records it. */
export interface Risk {
  risk: string;
  likelihood: 'high' | 'medium' | 'low';
  impact: string;
  mitigation: string;
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
  /** The three risks a reviewer would put in the ADR. */
  risks: Risk[];
  /** What breaks or has to change first at ten times the load, data or team size. */
  at_10x: string;
  /** One-line statement of the architectural decision, for the ADR title. */
  decision_summary: string;
  /** Alternatives a reviewer would have weighed, and why they lose here. */
  alternatives: { option: string; why_not: string }[];
  /** Established practice the review was grounded in — attached server-side, not by the model. */
  references: ScoreReference[];
  /** The subset of those the grader said it actually leaned on. */
  references_used: string[];
}

/**
 * Fills in fields that attempts stored by older versions do not carry, so a saved
 * review from last week still renders instead of throwing on a missing array.
 */
export function normalizeScore(raw: Partial<ScoreResult> | null | undefined): ScoreResult {
  const s = (raw ?? {}) as Partial<ScoreResult>;
  const blankDims = Object.fromEntries(
    DIMENSION_KEYS.map((k) => [k, { score: 0, max: 10, notes: '' }]),
  ) as Record<DimensionKey, Dimension>;
  return {
    overall: typeof s.overall === 'number' ? s.overall : 0,
    dimensions: { ...blankDims, ...(s.dimensions ?? {}) },
    critical_failures: s.critical_failures ?? [],
    spofs: s.spofs ?? [],
    missing: s.missing ?? [],
    good_calls: s.good_calls ?? [],
    socratic_questions: s.socratic_questions ?? [],
    concept_scores: s.concept_scores ?? {},
    model_answer_summary: s.model_answer_summary ?? '',
    verdict_teaching: s.verdict_teaching ?? [],
    canvas_markup: s.canvas_markup ?? [],
    suggested_additions: s.suggested_additions ?? [],
    flow_reviews: s.flow_reviews ?? [],
    risks: s.risks ?? [],
    at_10x: s.at_10x ?? '',
    decision_summary: s.decision_summary ?? '',
    alternatives: s.alternatives ?? [],
    references: s.references ?? [],
    references_used: s.references_used ?? [],
  };
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

/**
 * `hot` sits between warn and saturated: still serving everything, but with no
 * headroom left, which is where a component is when the next spike will take it.
 */
export type NodeState = 'ok' | 'warn' | 'hot' | 'saturated' | 'down';

export interface SimNodeResult {
  nodeId: string;
  incomingRps: number;
  capacityRps: number;
  utilization: number;
  latencyMs: number;
  droppedRps: number;
  queueDepth: number;
  state: NodeState;
  /**
   * Replicas at the worst moment — consistent with every other number here, which is
   * also the worst moment. For an autoscaling group this is the count that met the
   * spike, which is the one that decides what the spike cost.
   */
  replicas: number;
  /**
   * Replicas at the end of the run. Differs from `replicas` exactly when an autoscaler
   * moved, and the pair is the interesting thing: "min 1, max 50" that only ever
   * reached 3 is a different design from one that pinned at 50.
   */
  replicasSettled: number;
  /** True when nothing about this component limits traffic — a client, a control plane. */
  unlimited: boolean;
  /** Squeezed by a pool it shares with its neighbours rather than by its own size. */
  hostLimited: boolean;
  /** Runs on a provider's capacity, so it has no utilisation of its own. */
  elastic: boolean;
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
  /** Provisioned plus per-request, calculated from sizes and the traffic carried. */
  cost: CostReport;
  /** The same total, kept because everything already reads it. */
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
  /** True when this account has no key of its own and is falling back to the instance's. */
  usingHouseKey: boolean;
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

/**
 * One turn of the coaching conversation. Kept per (user, sheet) so a follow-up
 * like "why?" still has something to refer to — the coach is asked in a thread,
 * not one disconnected question at a time.
 */
export interface ChatTurn {
  role: 'me' | 'ai';
  text: string;
}

/** How many turns are stored, and how many of them the coach is shown. */
export const CHAT_HISTORY_KEPT = 60;
export const CHAT_HISTORY_SHOWN = 8;

/**
 * Where a note is pinned. `sheet` is one drawing — a problem sheet or one view of
 * a project, which share an id space with designs. `project` is the system as a
 * whole, for the decisions that outlive any single view.
 */
export type NoteScope = 'sheet' | 'project';

/**
 * A written note kept beside the drawing. Distinct from a sticky, which lives on
 * the canvas at a position and is part of the design the grader reads: these are
 * as many separate documents as you want, and nothing scores them.
 */
export interface Note {
  id: string;
  scope: NoteScope;
  scopeId: string;
  title: string;
  body: string;
  /** Manual order, lowest first; ties fall back to newest-first. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 20_000;

/**
 * Where a note was written.
 *
 * A note is stored against a scope and an opaque id, which is all the writing side
 * needs. Reading them back in one list needs the opposite: what that id *was* — the
 * problem's title, the view's name, the project it belonged to — because "sheet
 * 0f3a-…" is not a place anybody remembers being.
 */
export type NoteLocationKind = 'problem' | 'canvas' | 'project' | 'unknown';

export interface NoteLocation {
  kind: NoteLocationKind;
  /** What to call the place: the problem title, the view name, the project name. */
  label: string;
  /** Set for a view, which is a place inside another place. */
  projectName?: string;
  problemId?: string;
  projectId?: string;
  canvasId?: string;
}

/** A note plus enough context to go back to where it was written. */
export interface LibraryNote extends Note {
  where: NoteLocation;
}
