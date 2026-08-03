// Prebuilt subsystems you can drop onto the sheet and then take apart.
//
// The point is not to hand over an answer — a blueprint is a starting position,
// and every node, edge and number in it is editable the moment it lands. It
// exists because the interesting decisions in a pipeline are the ones *inside*
// it: where the chunk boundaries fall, what happens to output the schema
// rejects, whether the human step is on the synchronous path. You cannot argue
// with those decisions until they are drawn, and drawing eleven boxes before you
// can disagree with any of them is a tax on thinking.
//
// Positions are relative to the insertion point, in canvas units.

import type { ArchNodeType, EdgeKind, FlowKind, NodeAttrs } from './types.js';

export interface BlueprintNode {
  /** Local id, unique within the blueprint. Rewritten on insert. */
  key: string;
  type: ArchNodeType;
  label: string;
  /** The mechanism that matters, pre-filled — and the first thing worth editing. */
  annotation: string;
  at: { x: number; y: number };
  attrs?: NodeAttrs;
  size?: { w: number; h: number };
  /** Key of a `group` node in the same blueprint. */
  parent?: string;
}

export interface BlueprintEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface BlueprintFlow {
  name: string;
  kind: FlowKind;
  /** Node keys, in order. */
  steps: string[];
  rps: number;
  description: string;
}

/**
 * The structural minimum needed to place something on a sheet. Both the built-in
 * blueprints and a template the user saved from their own canvas satisfy it, so
 * insertion is one code path rather than two.
 */
export interface BlueprintLike {
  name: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  flows: BlueprintFlow[];
}

/**
 * A component type the user defined — a named preset over one of the built-in
 * types.
 *
 * The catalogue names categories of thing, not every variant of them: there is one
 * `chunker`, but a fixed-size chunker, a recursive one, a layout-aware one and a
 * sentence-window one are different decisions with different failure modes. Rather
 * than guess which variants matter, this lets the person who knows name their own
 * and reuse them. The base type still decides the icon and how the simulator and
 * the rule engine treat it, so a custom object is a real component, not a label.
 */
export interface CustomObject {
  id: string;
  name: string;
  baseType: ArchNodeType;
  /** Pre-filled reasoning, so the variant explains itself every time it is placed. */
  note: string;
  attrs: NodeAttrs;
  createdAt: string;
}

/** A subsystem the user saved from their own canvas, to reuse on any sheet. */
export interface UserTemplate extends BlueprintLike {
  id: string;
  /** Optional note to their future self. */
  summary: string;
  createdAt: string;
}

export interface Blueprint extends BlueprintLike {
  id: string;
  /** One line: what this is for. */
  summary: string;
  /** Which family it belongs to, for grouping in the picker. */
  family: 'AI systems' | 'Data & caching' | 'Correctness' | 'Async' | 'Reliability' | 'Migration';
  /** Concept ids this blueprint exercises, so it can be offered against a rubric. */
  concepts: string[];
  /** What the blueprint deliberately leaves for you to decide. */
  decisions: string[];
}

const COL = 210;
const ROW = 120;

export const BLUEPRINTS: Blueprint[] = [
  // ------------------------------------------------------------ AI systems ---
  {
    id: 'rag-query',
    name: 'RAG query path',
    summary: 'A question answered from your own documents, with retrieval you can defend.',
    family: 'AI systems',
    concepts: ['rag-retrieval', 'prompt-injection-defense', 'llm-cost-control', 'caching'],
    decisions: [
      'Hybrid retrieval or vector only — and how many candidates before the reranker',
      'What the system does when retrieval returns nothing relevant',
      'Whether the prompt cache is keyed on the question or on the retrieved set',
    ],
    nodes: [
      { key: 'client', type: 'client', label: 'Client', annotation: '', at: { x: 0, y: 0 } },
      {
        key: 'gw',
        type: 'api_gateway',
        label: 'API Gateway',
        annotation: 'Authenticates, and rate-limits per user because inference is the expensive path.',
        at: { x: COL, y: 0 },
      },
      {
        key: 'guard-in',
        type: 'guardrail',
        label: 'Input Guardrail',
        annotation: 'Retrieved text and user text are data, never instructions. Screens both before the model sees them.',
        attrs: { replicas: 4 },
        at: { x: COL * 2, y: 0 },
      },
      {
        key: 'cache',
        type: 'prompt_cache',
        label: 'Prompt Cache',
        annotation: 'Identical question plus identical retrieved set answers without a model call.',
        at: { x: COL * 2, y: -ROW },
      },
      {
        key: 'retriever',
        type: 'retriever',
        label: 'Retriever',
        annotation: 'Lexical and vector search together, then rerank to a handful. Decides what the model is allowed to know.',
        attrs: { replicas: 2 },
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'embed',
        type: 'embedding_svc',
        label: 'Embedder',
        annotation: 'Same model as the ingest path used, or the distances mean nothing.',
        at: { x: COL * 3, y: ROW },
      },
      {
        key: 'vdb',
        type: 'vector_db',
        label: 'Vector Index',
        annotation: 'Nearest neighbours over chunk embeddings. Recall is a tuning knob, not a given.',
        attrs: { replicas: 2 },
        at: { x: COL * 4, y: ROW },
      },
      {
        key: 'rerank',
        type: 'reranker',
        label: 'Reranker',
        annotation: 'Cross-encoder over the candidates. Cheapest large win in retrieval quality.',
        attrs: { replicas: 7, monthlyCost: 400 },
        at: { x: COL * 4, y: 0 },
      },
      {
        key: 'llm',
        type: 'llm',
        label: 'Answer Model',
        annotation: 'Answers ONLY from the passages given, cites them, and refuses when they do not cover the question.',
        at: { x: COL * 5, y: 0 },
        attrs: { replicas: 2, monthlyCost: 400 },
      },
      {
        key: 'guard-out',
        type: 'guardrail',
        label: 'Output Guardrail',
        annotation: 'Nothing the model produced reaches a privileged action or a user unchecked.',
        at: { x: COL * 6, y: 0 },
      },
      {
        key: 'obs',
        type: 'observability',
        label: 'Traces & Evals',
        annotation: 'Question, retrieved ids, answer and verdict logged together — the only way to debug a wrong answer later.',
        at: { x: COL * 5, y: ROW * 1.8 },
      },
    ],
    edges: [
      { from: 'client', to: 'gw', kind: 'sync', label: 'question' },
      { from: 'gw', to: 'guard-in', kind: 'sync' },
      { from: 'guard-in', to: 'cache', kind: 'sync', label: 'cache probe' },
      { from: 'guard-in', to: 'retriever', kind: 'sync' },
      { from: 'retriever', to: 'embed', kind: 'sync', label: 'embed the query' },
      { from: 'retriever', to: 'vdb', kind: 'sync', label: 'top-k candidates' },
      { from: 'vdb', to: 'rerank', kind: 'sync', label: 'candidates to score' },
      { from: 'rerank', to: 'llm', kind: 'sync', label: 'passages' },
      { from: 'llm', to: 'guard-out', kind: 'sync' },
      { from: 'llm', to: 'obs', kind: 'async', label: 'trace' },
    ],
    flows: [
      {
        name: 'question answered from documents',
        kind: 'read',
        steps: ['client', 'gw', 'guard-in', 'retriever', 'vdb', 'rerank', 'llm', 'guard-out'],
        rps: 30,
        description: 'The user-facing path. Latency budget is dominated by the model call.',
      },
    ],
  },
  {
    id: 'rag-ingest',
    name: 'Document ingest & indexing',
    summary: 'Documents in, retrievable chunks out — the half of RAG that decides answer quality.',
    family: 'AI systems',
    concepts: ['rag-chunking', 'vector-db-choice', 'queue-backpressure', 'search-indexing'],
    decisions: [
      'Chunk size and overlap, and whether boundaries follow structure or character counts',
      'What happens to a document the parser cannot read',
      'How a change to the embedding model triggers a reindex',
    ],
    nodes: [
      {
        key: 'src',
        type: 'doc_source',
        label: 'Document Source',
        annotation: 'Bucket or connector, with change detection. Decides how stale the index can get.',
        at: { x: 0, y: 0 },
      },
      {
        key: 'q',
        type: 'queue',
        label: 'Ingest Queue',
        annotation: 'Bounded. Parsing is slow, so this is where a bulk import is absorbed rather than dropped.',
        at: { x: COL, y: 0 },
        attrs: { queueDepthMax: 200_000 },
      },
      {
        key: 'parse',
        type: 'doc_parser',
        label: 'Parser / OCR',
        annotation: 'PDF, scan and slide deck to text with structure kept. Slowest step and the ceiling on everything after it.',
        at: { x: COL * 2, y: 0 },
        attrs: { replicas: 4 },
      },
      {
        key: 'dlq',
        type: 'dead_letter_queue',
        label: 'Unparseable',
        annotation: 'Documents that failed every retry, with an alarm on depth > 0. Otherwise they vanish silently.',
        at: { x: COL * 2, y: ROW },
      },
      {
        key: 'chunk',
        type: 'chunker',
        label: 'Chunker',
        annotation: 'Splits on semantic boundaries with overlap. This choice moves retrieval quality more than the model does.',
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'embed',
        type: 'embedding_svc',
        label: 'Embedder',
        annotation: 'Model and version recorded per chunk, so a model change is a reindex you can actually run.',
        at: { x: COL * 4, y: 0 },
      },
      {
        key: 'vdb',
        type: 'vector_db',
        label: 'Vector Index',
        annotation: 'Derived data. Must be rebuildable from the source without touching the source.',
        at: { x: COL * 5, y: 0 },
      },
      {
        key: 'meta',
        type: 'sql_db',
        label: 'Document Metadata',
        annotation: 'Source, version, permissions, chunk ids. The index answers "which"; this answers "may they see it".',
        at: { x: COL * 5, y: ROW },
      },
    ],
    edges: [
      { from: 'src', to: 'q', kind: 'async', label: 'new or changed doc' },
      { from: 'q', to: 'parse', kind: 'async' },
      { from: 'parse', to: 'dlq', kind: 'async', label: 'after max retries' },
      { from: 'parse', to: 'chunk', kind: 'sync' },
      { from: 'chunk', to: 'embed', kind: 'sync' },
      { from: 'embed', to: 'vdb', kind: 'sync', label: 'upsert vectors' },
      { from: 'chunk', to: 'meta', kind: 'sync', label: 'chunk ids, permissions' },
    ],
    flows: [
      {
        name: 'document indexed',
        kind: 'async',
        steps: ['src', 'q', 'parse', 'chunk', 'embed', 'vdb'],
        rps: 5,
        description: 'Background. Its throughput sets how fresh the index can be.',
      },
    ],
  },
  {
    id: 'doc-extraction',
    name: 'Documents to a fixed schema',
    summary: 'Pull structured fields out of unstructured documents, and know when it went wrong.',
    family: 'AI systems',
    concepts: ['eval-gates', 'rag-chunking', 'idempotency', 'queue-backpressure'],
    decisions: [
      'What the schema is, and which fields may be null versus must be found',
      'How many retries an invalid extraction gets, and what happens after the last one',
      'Whether a low-confidence extraction goes to a person or straight to the store',
    ],
    nodes: [
      {
        key: 'src',
        type: 'doc_source',
        label: 'Incoming Documents',
        annotation: 'Invoices, contracts, forms. One document is one unit of work with one id.',
        at: { x: 0, y: 0 },
      },
      {
        key: 'q',
        type: 'queue',
        label: 'Work Queue',
        annotation: 'Keyed by document id so a redelivery is the same work, not a second extraction.',
        at: { x: COL, y: 0 },
      },
      {
        key: 'parse',
        type: 'doc_parser',
        label: 'Parser / OCR',
        annotation: 'Layout matters: a table read as prose loses the row/column relationship the fields depend on.',
        attrs: { replicas: 2 },
        at: { x: COL * 2, y: 0 },
      },
      {
        key: 'redact',
        type: 'pii_redactor',
        label: 'PII Redactor',
        annotation: 'Tokenise anything sensitive before it leaves the boundary. The only way a third-party model stays in scope.',
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'extract',
        type: 'extractor',
        label: 'Schema Extractor',
        annotation: 'Model call constrained to one shape, with the schema in the request and confidence per field.',
        at: { x: COL * 4, y: 0 },
      },
      {
        key: 'validate',
        type: 'output_validator',
        label: 'Validator',
        annotation: 'Types, required fields, and the business rules a schema cannot express (totals add up, dates are ordered).',
        at: { x: COL * 5, y: 0 },
      },
      {
        key: 'review',
        type: 'human_review',
        label: 'Human Review',
        annotation: 'Low confidence and hard failures land here. Off the synchronous path — a reviewer takes minutes, not milliseconds.',
        attrs: { replicas: 4 },
        at: { x: COL * 5, y: ROW * 1.4 },
      },
      {
        key: 'db',
        type: 'sql_db',
        label: 'Extracted Records',
        annotation: 'System of record for the structured result, keyed by document id so re-running is idempotent.',
        at: { x: COL * 6, y: 0 },
      },
      {
        key: 'evals',
        type: 'eval_gate',
        label: 'Eval Set',
        annotation: 'Hand-labelled documents scored on every prompt or model change. Blocks a regression before it ships.',
        at: { x: COL * 4, y: ROW * 1.4 },
      },
    ],
    edges: [
      { from: 'src', to: 'q', kind: 'async', label: 'document id' },
      { from: 'q', to: 'parse', kind: 'async' },
      { from: 'parse', to: 'redact', kind: 'sync' },
      { from: 'redact', to: 'extract', kind: 'sync', label: 'text + schema' },
      { from: 'extract', to: 'validate', kind: 'sync', label: 'candidate fields' },
      { from: 'validate', to: 'db', kind: 'sync', label: 'accepted' },
      { from: 'validate', to: 'review', kind: 'async', label: 'rejected or low confidence' },
      { from: 'review', to: 'db', kind: 'sync', label: 'corrected' },
      { from: 'extract', to: 'evals', kind: 'async', label: 'sampled for scoring' },
    ],
    flows: [
      {
        name: 'document extracted to schema',
        kind: 'async',
        steps: ['src', 'q', 'parse', 'redact', 'extract', 'validate', 'db'],
        rps: 3,
        description: 'The happy path. Everything interesting is in what leaves it.',
      },
    ],
  },
  {
    id: 'tool-agent',
    name: 'Tool-using agent',
    summary: 'A model that acts, with the blast radius drawn in.',
    family: 'AI systems',
    concepts: ['agent-tool-sandboxing', 'prompt-injection-defense', 'llm-cost-control', 'authn-authz'],
    decisions: [
      'The step, token and wall-clock ceiling on one task',
      'Which tools need a human confirmation and which are safe to call unattended',
      'Whether memory is trusted input on the next turn (it is not)',
    ],
    nodes: [
      { key: 'client', type: 'client', label: 'Client', annotation: '', at: { x: 0, y: 0 } },
      {
        key: 'gw',
        type: 'api_gateway',
        label: 'API Gateway',
        annotation: 'Carries the end user identity through, so tools authorise as the user and not as the agent.',
        at: { x: COL, y: 0 },
      },
      {
        key: 'agent',
        type: 'agent_runtime',
        label: 'Agent Runtime',
        annotation: 'Hard caps: max steps, max tokens, max wall clock. Without them a loop is a bill.',
        at: { x: COL * 2, y: 0 },
        attrs: { replicas: 2 },
      },
      {
        key: 'mem',
        type: 'agent_memory',
        label: 'Agent Memory',
        annotation: 'Task and conversation state. Treat what is read back as untrusted input, because a tool may have written it.',
        at: { x: COL * 2, y: ROW * 1.4 },
      },
      {
        key: 'guard',
        type: 'guardrail',
        label: 'Action Guardrail',
        annotation: 'Sits between the decision and the effect. Irreversible actions stop here for a human.',
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'mcp',
        type: 'mcp_server',
        label: 'Tool Server',
        annotation: 'Tool descriptions are text the model obeys, so this server is part of the trust boundary.',
        at: { x: COL * 4, y: 0 },
      },
      {
        key: 'sandbox',
        type: 'tool_sandbox',
        label: 'Tool Sandbox',
        annotation: 'Least privilege, no ambient network, hard timeout. Assume any tool call is hostile input.',
        at: { x: COL * 5, y: 0 },
      },
      {
        key: 'svc',
        type: 'service',
        label: 'Your Services',
        annotation: 'Authorise per object, per caller. Being called by the agent is not authorisation.',
        at: { x: COL * 6, y: 0 },
      },
      {
        key: 'audit',
        type: 'audit_log',
        label: 'Action Audit',
        annotation: 'Every tool call and its arguments, append-only. After an incident this is the only account of what happened.',
        at: { x: COL * 5, y: ROW * 1.4 },
      },
    ],
    edges: [
      { from: 'client', to: 'gw', kind: 'sync', label: 'task' },
      { from: 'gw', to: 'agent', kind: 'sync' },
      { from: 'agent', to: 'mem', kind: 'sync', label: 'read/write state' },
      { from: 'agent', to: 'guard', kind: 'sync', label: 'proposed action' },
      { from: 'guard', to: 'mcp', kind: 'sync', label: 'approved call' },
      { from: 'mcp', to: 'sandbox', kind: 'sync' },
      { from: 'sandbox', to: 'svc', kind: 'sync' },
      { from: 'sandbox', to: 'audit', kind: 'async', label: 'call + args' },
    ],
    flows: [
      {
        name: 'agent completes a task',
        kind: 'write',
        steps: ['client', 'gw', 'agent', 'guard', 'mcp', 'sandbox', 'svc'],
        rps: 5,
        description: 'One step of the loop. Multiply by your step ceiling for the real cost.',
      },
    ],
  },

  // -------------------------------------------------------- non-AI patterns ---
  {
    id: 'cache-aside-read',
    name: 'Cache-aside read path',
    summary: 'A read-heavy path with the stampede and invalidation questions already visible.',
    family: 'Data & caching',
    concepts: ['caching', 'replication', 'capacity-estimation'],
    decisions: [
      'TTL only, write-through, or explicit invalidation — and the staleness each permits',
      'What one hot key does when it expires',
      'Whether a read that follows a write may hit the replica',
    ],
    nodes: [
      { key: 'client', type: 'client', label: 'Client', annotation: '', at: { x: 0, y: 0 } },
      { key: 'cdn', type: 'cdn', label: 'CDN', annotation: 'Everything cacheable is served before your origin is involved.', at: { x: COL, y: 0 } },
      { key: 'lb', type: 'load_balancer', label: 'Load Balancer', annotation: 'Health-checked, more than one backend.', at: { x: COL * 2, y: 0 } },
      {
        key: 'api',
        type: 'service',
        label: 'API',
        annotation: 'Cache-aside: look up, miss, load, populate with a jittered TTL.',
        attrs: { replicas: 7 },
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'cache',
        type: 'cache',
        label: 'Cache',
        annotation:
          'Drawn on the read path because that is where the traffic goes; the application does the cache-aside itself (look up, miss, load, populate with a jittered TTL). Single-flight on miss so one expiry cannot become a thundering herd. Never a system of record.',
        at: { x: COL * 4, y: -ROW * 0.8 },
      },
      { key: 'db', type: 'sql_db', label: 'Primary', annotation: 'Owns the write. Sized for the miss rate, not the request rate.', at: { x: COL * 4, y: ROW * 0.6 } },
      {
        key: 'replica',
        type: 'read_replica',
        label: 'Read Replica',
        annotation: 'Serves reads that tolerate lag. A read-your-own-write must not come here.',
        at: { x: COL * 5, y: ROW * 0.6 },
      },
    ],
    edges: [
      { from: 'client', to: 'cdn', kind: 'sync' },
      { from: 'cdn', to: 'lb', kind: 'sync', label: 'cache miss' },
      { from: 'lb', to: 'api', kind: 'sync' },
      { from: 'api', to: 'cache', kind: 'sync', label: 'get / set' },
      { from: 'cache', to: 'db', kind: 'sync', label: 'on miss' },
      { from: 'db', to: 'replica', kind: 'replication' },
      { from: 'api', to: 'replica', kind: 'sync', label: 'lag-tolerant reads' },
    ],
    flows: [
      {
        name: 'cached read',
        kind: 'read',
        steps: ['client', 'cdn', 'lb', 'api', 'cache', 'db'],
        rps: 2000,
        description: 'Most requests stop at the cache. The database is sized for the ones that do not.',
      },
    ],
  },
  {
    id: 'idempotent-write',
    name: 'Idempotent write with outbox',
    summary: 'A write that can be retried safely and still tells the rest of the system.',
    family: 'Correctness',
    concepts: ['idempotency', 'outbox', 'timeout-retry', 'distributed-transactions'],
    decisions: [
      'Where the idempotency key comes from and how long it is kept',
      'Which downstream effects belong in the same transaction as the row',
      'What the client sees when it retries a request that already succeeded',
    ],
    nodes: [
      { key: 'client', type: 'client', label: 'Client', annotation: 'Generates one idempotency key per logical operation and reuses it on every retry.', at: { x: 0, y: 0 } },
      { key: 'gw', type: 'api_gateway', label: 'API Gateway', annotation: 'Passes the key through untouched.', at: { x: COL, y: 0 } },
      {
        key: 'svc',
        type: 'service',
        label: 'Write Service',
        annotation: 'Stores the key with the result in the SAME transaction as the effect. A retry becomes a lookup.',
        attrs: { replicas: 6 },
        at: { x: COL * 2, y: 0 },
      },
      {
        key: 'db',
        type: 'sql_db',
        label: 'Primary + Outbox',
        annotation: 'Business row and outgoing message committed together. One transaction is the only atomicity needed.',
        at: { x: COL * 3, y: 0 },
      },
      {
        key: 'cdc',
        type: 'cdc_connector',
        label: 'Outbox Relay',
        annotation: 'Reads the committed outbox and publishes. At-least-once, so consumers must be idempotent too.',
        at: { x: COL * 4, y: 0 },
      },
      { key: 'bus', type: 'event_bus', label: 'Event Bus', annotation: 'Fan-out to whoever cares. No publisher waits on a subscriber.', at: { x: COL * 5, y: 0 } },
      {
        key: 'pay',
        type: 'payment_gateway',
        label: 'Payment Provider',
        annotation: 'Third party on a money path: idempotency key, timeout, breaker, and a reconciliation job.',
        at: { x: COL * 2, y: ROW * 1.3 },
      },
    ],
    edges: [
      { from: 'client', to: 'gw', kind: 'sync', label: 'POST + Idempotency-Key' },
      { from: 'gw', to: 'svc', kind: 'sync' },
      { from: 'svc', to: 'db', kind: 'sync', label: 'row + outbox, one txn' },
      { from: 'svc', to: 'pay', kind: 'sync', label: 'charge, same key' },
      { from: 'db', to: 'cdc', kind: 'async', label: 'committed outbox' },
      { from: 'cdc', to: 'bus', kind: 'async' },
    ],
    flows: [
      {
        name: 'idempotent write',
        kind: 'write',
        steps: ['client', 'gw', 'svc', 'db'],
        rps: 200,
        description: 'The retried path. Two identical requests must produce one effect.',
      },
    ],
  },
  {
    id: 'strangler-migration',
    name: 'Strangler migration',
    summary: 'Replace a system that is still running, one route at a time, with a way back.',
    family: 'Migration',
    concepts: ['deployment-safety', 'consistency-models', 'distributed-transactions', 'observability'],
    decisions: [
      'What the routing key is — route, tenant, or percentage — and who can change it',
      'Which store is authoritative while both are being written, and for how long',
      'What the reconciler does when the two disagree: prefer one, or stop and page someone',
    ],
    nodes: [
      { key: 'client', type: 'client', label: 'Client', annotation: '', at: { x: 0, y: 0 } },
      {
        key: 'facade',
        type: 'strangler_facade',
        label: 'Strangler Facade',
        annotation: 'Routes per route or per tenant. Flipping one rule back is the entire rollback plan, which is why the plan works.',
        at: { x: COL, y: 0 },
      },
      {
        key: 'flags',
        type: 'feature_flags',
        label: 'Routing Rules',
        annotation: 'The routing decision lives here, not in a deploy. Changing who is on the new path must not need a release.',
        at: { x: COL, y: -ROW },
      },
      {
        key: 'legacy',
        type: 'legacy_system',
        label: 'Legacy System',
        annotation: 'Cannot be changed and cannot be scaled by you. Its capacity is the ceiling on the old path for as long as it carries traffic.',
        at: { x: COL * 2, y: ROW },
      },
      {
        key: 'legacydb',
        type: 'sql_db',
        label: 'Legacy Store',
        annotation: 'Still authoritative for whatever the legacy path writes. Read it directly at your peril — the schema is its own.',
        at: { x: COL * 3, y: ROW },
      },
      {
        key: 'svc',
        type: 'service',
        label: 'New Service',
        annotation: 'The replacement, taking one slice of traffic at a time so a problem is one slice wide.',
        at: { x: COL * 2, y: -ROW * 0.3 },
        attrs: { capacityRps: 400, replicas: 2 },
      },
      {
        key: 'newdb',
        type: 'sql_db',
        label: 'New Store',
        annotation: 'Modelled for the access patterns you have now, not the ones the legacy schema was shaped by.',
        at: { x: COL * 3, y: -ROW * 0.3 },
      },
      {
        key: 'recon',
        type: 'reconciler',
        label: 'Reconciler',
        annotation: 'Compares both stores on a schedule and repairs the drift. Without it, "we will migrate the data later" means "we will discover the difference later".',
        at: { x: COL * 4, y: ROW * 0.4 },
      },
      {
        key: 'obs',
        type: 'observability',
        label: 'Comparison Metrics',
        annotation: 'Same request through both paths, results diffed. This is how you learn the new path is correct before it carries everything.',
        at: { x: COL * 2, y: -ROW * 1.4 },
      },
    ],
    edges: [
      { from: 'client', to: 'facade', kind: 'sync' },
      { from: 'facade', to: 'flags', kind: 'sync', label: 'which path?' },
      { from: 'facade', to: 'svc', kind: 'sync', label: 'migrated routes' },
      { from: 'facade', to: 'legacy', kind: 'sync', label: 'everything else' },
      { from: 'svc', to: 'newdb', kind: 'sync' },
      { from: 'legacy', to: 'legacydb', kind: 'sync' },
      { from: 'recon', to: 'newdb', kind: 'async', label: 'compare' },
      { from: 'recon', to: 'legacydb', kind: 'async', label: 'compare' },
      { from: 'svc', to: 'obs', kind: 'async', label: 'result diff' },
    ],
    flows: [
      {
        name: 'request on the migrated path',
        kind: 'write',
        steps: ['client', 'facade', 'svc', 'newdb'],
        rps: 200,
        description: 'The slice already moved across.',
      },
      {
        name: 'request still on the legacy path',
        kind: 'write',
        steps: ['client', 'facade', 'legacy', 'legacydb'],
        rps: 40,
        description: 'Everything not yet migrated. The legacy capacity is the constraint here.',
      },
    ],
  },
  {
    id: 'offline-first-sync',
    name: 'Offline-first sync',
    summary: 'A client that works with no network, and a server that can reconcile what it did.',
    family: 'Correctness',
    concepts: ['consistency-models', 'idempotency', 'schema-design'],
    decisions: [
      'Conflict resolution: last-write-wins, per-field merge, or ask the user',
      'Whether a change id is assigned on the device or by the server',
      'How much history the device keeps, and what a fresh install has to download',
    ],
    nodes: [
      {
        key: 'app',
        type: 'mobile_client',
        label: 'Mobile App',
        annotation: 'Reads and writes locally first, always. The network is an optimisation, not a requirement.',
        at: { x: 0, y: 0 },
      },
      {
        key: 'local',
        type: 'offline_store',
        label: 'Offline Store',
        annotation: 'On the device: holds writes the server has never seen. You cannot scale it, back it up, or query it in an incident.',
        at: { x: COL, y: 0 },
      },
      {
        key: 'sync',
        type: 'sync_engine',
        label: 'Sync Engine',
        annotation: 'Change tracking both ways, resumable, and one explicit conflict rule. Ambiguity here becomes data loss on someone else’s phone.',
        at: { x: COL * 2, y: 0 },
      },
      {
        key: 'idem',
        type: 'idempotency_store',
        label: 'Change Ledger',
        annotation: 'Change ids already applied. A device that retries after a dropped connection must not apply its edit twice.',
        at: { x: COL * 3, y: -ROW },
      },
      {
        key: 'db',
        type: 'sql_db',
        label: 'Server Store',
        annotation: 'Authoritative once a change is accepted, and the source for a fresh device’s first sync.',
        at: { x: COL * 3, y: 0 },
      },
    ],
    edges: [
      { from: 'app', to: 'local', kind: 'sync', label: 'write locally first' },
      { from: 'local', to: 'sync', kind: 'async', label: 'queued changes' },
      { from: 'sync', to: 'idem', kind: 'sync', label: 'seen this change?' },
      { from: 'sync', to: 'db', kind: 'sync', label: 'apply' },
    ],
    flows: [
      {
        name: 'offline write reaches the server',
        kind: 'write',
        steps: ['app', 'local', 'sync', 'db'],
        rps: 100,
        description: 'The write already succeeded on the device. This is it catching up.',
      },
    ],
  },
  {
    id: 'async-jobs',
    name: 'Async job pipeline',
    summary: 'Work taken off the request path, with the failure paths drawn rather than assumed.',
    family: 'Async',
    concepts: ['queue-backpressure', 'timeout-retry', 'scheduled-jobs', 'observability'],
    decisions: [
      'Queue depth at which you shed rather than buffer',
      'Retry ceiling, and whether the work is safe to retry at all',
      'Who is paged when the dead-letter queue is non-empty',
    ],
    nodes: [
      { key: 'api', type: 'service', label: 'API', annotation: 'Accepts, enqueues, returns. Never does the slow work inline.', at: { x: 0, y: 0 } },
      {
        key: 'q',
        type: 'queue',
        label: 'Job Queue',
        annotation: 'Bounded, with a max receive count. Unbounded buffering turns overload into unbounded latency.',
        at: { x: COL, y: 0 },
      },
      { key: 'worker', type: 'worker', label: 'Workers', annotation: 'Idempotent per job id, autoscaled on queue depth rather than CPU.', at: { x: COL * 2, y: 0 }, attrs: { replicas: 4 } },
      { key: 'dlq', type: 'dead_letter_queue', label: 'Dead Letters', annotation: 'Alarm on depth > 0, with a documented replay. A DLQ nobody watches is silent data loss.', at: { x: COL * 2, y: ROW } },
      { key: 'db', type: 'sql_db', label: 'Results', annotation: 'Job state readable by the client that submitted it.', at: { x: COL * 3, y: 0 } },
      { key: 'sched', type: 'scheduler', label: 'Scheduler', annotation: 'Periodic sweeps: reconcile, retry the retryable, expire the stale.', at: { x: COL, y: ROW * 1.6 } },
      { key: 'obs', type: 'observability', label: 'Metrics', annotation: 'Queue depth, oldest message age, failure rate. Age is what tells you the drain is losing.', at: { x: COL * 3, y: ROW } },
    ],
    edges: [
      { from: 'api', to: 'q', kind: 'async', label: 'job' },
      { from: 'q', to: 'worker', kind: 'async' },
      { from: 'worker', to: 'dlq', kind: 'async', label: 'after max receives' },
      { from: 'worker', to: 'db', kind: 'sync' },
      { from: 'sched', to: 'q', kind: 'async', label: 'periodic sweep' },
      { from: 'worker', to: 'obs', kind: 'async' },
    ],
    flows: [
      {
        name: 'job processed',
        kind: 'async',
        steps: ['api', 'q', 'worker', 'db'],
        rps: 100,
        description: 'Throughput is the worker drain rate, not the enqueue rate.',
      },
    ],
  },
];

export const BLUEPRINT_FAMILIES = [
  'AI systems',
  'Data & caching',
  'Correctness',
  'Async',
  'Reliability',
  'Migration',
] as const;

export const BLUEPRINT_BY_ID: Record<string, Blueprint> = Object.fromEntries(
  BLUEPRINTS.map((b) => [b.id, b]),
);
