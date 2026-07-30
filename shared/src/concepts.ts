// The ArchDojo concept taxonomy — the fixed vocabulary for rubrics, mastery
// tracking, and the in-app Design Reference. Every card teaches: what it is,
// when to reach for it, the trade-off it costs, and the red flag of misuse.

export interface ConceptCard {
  id: string;
  name: string;
  group: string;
  summary: string;
  when: string;
  tradeoffs: string;
  redFlags: string;
}

export const CONCEPT_GROUPS = [
  'Traffic & Edge',
  'Scaling & Data',
  'Consistency & Transactions',
  'Async & Messaging',
  'Reliability',
  'Security',
  'Operations & Cost',
  'AI Systems',
] as const;

export type ConceptGroup = (typeof CONCEPT_GROUPS)[number];

export const CONCEPT_CARDS: ConceptCard[] = [
  // Traffic & Edge
  { id: 'load-balancing', name: 'Load balancing', group: 'Traffic & Edge', summary: 'Spread requests across replicas (L4/L7, round-robin, least-conn, consistent hashing).', when: 'More than one instance serves the same role.', tradeoffs: 'L7 gives routing smarts but costs latency and money; sticky sessions fight autoscaling.', redFlags: 'A single LB with no failover; stateful servers behind a round-robin LB.' },
  { id: 'cdn', name: 'CDN & edge caching', group: 'Traffic & Edge', summary: 'Serve static and cacheable content from edge POPs near users.', when: 'Global users, static assets, cacheable GETs, video/images.', tradeoffs: 'Invalidation is hard; dynamic content needs careful cache keys.', redFlags: 'Serving images/video straight from your app servers; no cache-control headers.' },
  { id: 'rate-limiting', name: 'Rate limiting & throttling', group: 'Traffic & Edge', summary: 'Bound request rates per user/IP/key (token bucket, sliding window) at the edge.', when: 'Any public API; anything with abuse or cost exposure.', tradeoffs: 'Distributed counters need a shared store (usually Redis) — adds a dependency.', redFlags: 'No limiter in front of expensive endpoints (search, LLM calls, login).' },
  { id: 'dns-routing', name: 'DNS & geo-routing', group: 'Traffic & Edge', summary: 'Route users by geography/latency/health at the DNS layer.', when: 'Multi-region deployments, failover between regions.', tradeoffs: 'TTL caching makes failover slow; clients ignore TTLs unpredictably.', redFlags: 'Relying on DNS alone for instant regional failover.' },
  { id: 'websocket-scale', name: 'Realtime connections at scale', group: 'Traffic & Edge', summary: 'Long-lived WebSocket/SSE connections need connection gateways and pub/sub fanout.', when: 'Chat, live dashboards, presence, collaborative editing.', tradeoffs: 'Connection state pins users to servers; needs sticky routing or a connection registry.', redFlags: 'Broadcasting via database polling; ignoring reconnect storms after deploys.' },

  // Scaling & Data
  { id: 'caching', name: 'Caching strategies', group: 'Scaling & Data', summary: 'Cache-aside, write-through, write-behind; TTLs, eviction, stampede protection.', when: 'Read-heavy paths, expensive computations, hot keys.', tradeoffs: 'Staleness vs freshness; invalidation complexity grows with write paths.', redFlags: 'Cache with no TTL and no invalidation story; no stampede protection on hot keys.' },
  { id: 'sharding', name: 'Sharding & partitioning', group: 'Scaling & Data', summary: 'Split data across nodes by a partition key (hash, range, directory).', when: 'Single node can no longer hold the data or the write load.', tradeoffs: 'Cross-shard queries and transactions get hard; resharding is painful.', redFlags: 'Shard key that concentrates load (celebrity/hot tenant); sharding before ~1TB / write saturation.' },
  { id: 'replication', name: 'Replication & read scaling', group: 'Scaling & Data', summary: 'Copies of data (leader-follower, multi-leader, quorum) for reads, availability, locality.', when: 'Read-heavy load, HA requirements, geo-local reads.', tradeoffs: 'Replication lag → stale reads; multi-leader → write conflicts.', redFlags: 'Reading your own write from a lagging replica (e.g. after signup).' },
  { id: 'hot-partition', name: 'Hot partitions & skew', group: 'Scaling & Data', summary: 'Uneven key distribution overloads one shard/partition while others idle.', when: 'Any partitioned system: queues, DBs, streams, caches.', tradeoffs: 'Fixes (key salting, splitting) complicate reads and ordering.', redFlags: 'Time-based or tenant-based keys for high-volume writers; ignoring celebrity users.' },
  { id: 'search-indexing', name: 'Search & secondary indexes', group: 'Scaling & Data', summary: 'Inverted indexes (Elasticsearch/OpenSearch) for text/faceted search, fed asynchronously.', when: 'Full-text search, complex filtering the primary DB handles poorly.', tradeoffs: 'Index lag; dual-store consistency; operational weight.', redFlags: 'LIKE %term% on the primary DB at scale; synchronous dual writes with no repair.' },
  { id: 'blob-storage', name: 'Blob/object storage', group: 'Scaling & Data', summary: 'Large binary objects in S3-style storage, metadata in DB, direct presigned upload/download.', when: 'Images, video, files, backups, data lake.', tradeoffs: 'Eventual consistency quirks; lifecycle/cost management needed.', redFlags: 'Files as DB blobs; uploads proxied through app servers.' },
  { id: 'schema-design', name: 'Data modeling & schema design', group: 'Scaling & Data', summary: 'Model entities/relations for the access patterns; normalize until it hurts, denormalize where reads demand.', when: 'Always — the data model outlives the code.', tradeoffs: 'Denormalization speeds reads but multiplies write paths and drift risk.', redFlags: 'Modeling for the ER diagram, not the queries; JSON blob for everything.' },
  { id: 'capacity-estimation', name: 'Capacity estimation', group: 'Scaling & Data', summary: 'Back-of-envelope math: RPS, storage growth, bandwidth, cache size, connection counts.', when: 'Before choosing any component — numbers decide the architecture.', tradeoffs: 'Estimates are wrong; design for 10x, not 1000x.', redFlags: 'No numbers anywhere in a design; sizing by vibes.' },

  // Consistency & Transactions
  { id: 'consistency-models', name: 'Consistency models', group: 'Consistency & Transactions', summary: 'Strong, causal, read-your-writes, eventual — pick per data class, not per system.', when: 'Any replicated or cached data.', tradeoffs: 'Stronger consistency costs latency and availability (CAP/PACELC).', redFlags: '"Eventually consistent" money; demanding strong consistency for like-counts.' },
  { id: 'cap-tradeoff', name: 'CAP / PACELC reasoning', group: 'Consistency & Transactions', summary: 'Under partition choose availability or consistency; else latency vs consistency.', when: 'Multi-node stateful systems, geo-distribution decisions.', tradeoffs: 'It is a spectrum per operation, not a single system label.', redFlags: 'Claiming CA; invoking CAP to excuse missing consistency design.' },
  { id: 'distributed-transactions', name: 'Distributed transactions & atomicity', group: 'Consistency & Transactions', summary: 'Cross-service atomicity via 2PC (rare), or decomposition into sagas/outbox.', when: 'One business action mutates multiple stores/services.', tradeoffs: '2PC blocks and fragiles; sagas trade atomicity for compensations.', redFlags: 'Two independent writes with no compensation or reconciliation path.' },
  { id: 'saga', name: 'Sagas & compensation', group: 'Consistency & Transactions', summary: 'Long-running business flows as steps with compensating actions (orchestrated or choreographed).', when: 'Multi-step flows across services: booking, checkout, onboarding.', tradeoffs: 'Compensations are business logic — some steps cannot be undone.', redFlags: 'Saga with no compensation defined for a step that can fail.' },
  { id: 'outbox', name: 'Transactional outbox / CDC', group: 'Consistency & Transactions', summary: 'Write event + state in one DB transaction; relay publishes from the outbox (or CDC tails the log).', when: 'Reliably publishing events on state change.', tradeoffs: 'At-least-once delivery → consumers must dedupe; relay is new infra.', redFlags: 'Dual-write to DB and broker without outbox — events lost on crash.' },
  { id: 'exactly-once', name: 'Delivery semantics & dedup', group: 'Consistency & Transactions', summary: 'At-most/at-least/effectively-once; exactly-once processing = at-least-once + idempotent consumers.', when: 'Any queue/stream consumer with side effects.', tradeoffs: 'Dedup needs state (keys, windows); ordering constraints limit parallelism.', redFlags: 'Assuming the broker gives exactly-once end-to-end.' },

  // Async & Messaging
  { id: 'queue-backpressure', name: 'Queues & backpressure', group: 'Async & Messaging', summary: 'Buffer bursts, decouple producers/consumers; bound the queue and shed or slow producers when full.', when: 'Bursty load, slow downstreams, work smoothing.', tradeoffs: 'Unbounded queues turn overload into latency and OOM — bound and monitor depth.', redFlags: 'No DLQ, no depth alarm, no consumer scaling story.' },
  { id: 'stream-processing', name: 'Event streams & log-based messaging', group: 'Async & Messaging', summary: 'Append-only partitioned logs (Kafka-style): replay, multiple consumers, ordering per key.', when: 'Event sourcing feeds, analytics pipelines, fanout to many consumers, replay needs.', tradeoffs: 'Heavier ops than a queue; partition-key choice = ordering + skew decisions.', redFlags: 'Kafka for a 10-msg/s job queue; ignoring consumer lag.' },
  { id: 'fanout', name: 'Fanout: push vs pull', group: 'Async & Messaging', summary: 'Precompute per-recipient (push) vs compute on read (pull) vs hybrid for celebrities.', when: 'Feeds, notifications, timelines.', tradeoffs: 'Push = write amplification; pull = expensive reads; hybrid = complexity.', redFlags: 'Pure push fanout with mega-follower accounts.' },
  { id: 'scheduled-jobs', name: 'Schedulers & background jobs', group: 'Async & Messaging', summary: 'Cron/scheduler triggers work via queues; workers execute idempotently with leases.', when: 'Periodic tasks, delayed actions, retries, cleanup.', tradeoffs: 'Exactly-one-runner needs leader election or locks; missed ticks need catch-up logic.', redFlags: 'Two schedulers double-firing; long jobs inside request handlers.' },

  // Reliability
  { id: 'idempotency', name: 'Idempotency', group: 'Reliability', summary: 'Same request applied twice = applied once, via idempotency keys and dedup state.', when: 'Every retryable side effect — payments, orders, emails, webhooks.', tradeoffs: 'Key storage and TTL policy; scoping keys correctly per operation.', redFlags: 'Retries on a charge/send path with no idempotency key — the classic double-charge.' },
  { id: 'timeout-retry', name: 'Timeouts, retries & jitter', group: 'Reliability', summary: 'Every network call gets a timeout; retries only on safe ops, with exponential backoff + jitter and budgets.', when: 'Every remote call, no exceptions.', tradeoffs: 'Aggressive retries amplify outages (retry storms).', redFlags: 'Infinite/default timeouts; retrying non-idempotent calls; synchronized retry waves.' },
  { id: 'circuit-breaker', name: 'Circuit breakers & bulkheads', group: 'Reliability', summary: 'Stop calling a failing dependency (breaker); isolate resource pools so one dependency cannot drown all (bulkhead).', when: 'Calls to flaky or third-party dependencies.', tradeoffs: 'Tuning thresholds; needs fallback behavior defined.', redFlags: 'One thread/connection pool shared by all downstreams; no fallback when open.' },
  { id: 'spof', name: 'Single points of failure', group: 'Reliability', summary: 'Any component whose loss takes the system down; find them, then redundant or degrade gracefully.', when: 'Review every design — draw the failure of each box.', tradeoffs: 'Redundancy costs money and consistency complexity.', redFlags: 'Single cache/broker/LB/NAT instance; redundant app tier in one AZ.' },
  { id: 'multi-region', name: 'Multi-region & DR', group: 'Reliability', summary: 'Active-passive or active-active across regions; RTO/RPO drive the design.', when: 'Region-level availability requirements, data residency, global latency.', tradeoffs: 'Active-active = conflict resolution + 2-3x cost; active-passive = failover drills.', redFlags: 'Multi-region before product-market fit; untested failover.' },
  { id: 'cell-isolation', name: 'Cell-based architecture & blast radius', group: 'Reliability', summary: 'Partition the whole stack into independent cells; a bad deploy or poison tenant hurts one cell.', when: 'Large multi-tenant systems, availability-critical platforms.', tradeoffs: 'Cell routing layer, capacity fragmentation, ops multiplication.', redFlags: 'Shared fate across all tenants at scale; cells that secretly share a database.' },
  { id: 'webhook-reliability', name: 'Webhook & callback reliability', group: 'Reliability', summary: 'Signed, retried, idempotent delivery to third parties with DLQ and replay UI.', when: 'Notifying external systems of events.', tradeoffs: 'Consumers are unreliable — you own retries, ordering caveats, and replay.', redFlags: 'Fire-and-forget POSTs; retries without signatures or dedup keys for receivers.' },
  { id: 'degradation', name: 'Graceful degradation & load shedding', group: 'Reliability', summary: 'Predefined reduced modes: serve stale, disable features, shed low-priority traffic before collapse.', when: 'Any system with overload or dependency-failure scenarios.', tradeoffs: 'Requires product decisions about what degrades first.', redFlags: 'All-or-nothing availability; no priority tiers on traffic.' },

  // Security
  { id: 'authn-authz', name: 'AuthN & AuthZ', group: 'Security', summary: 'Who you are (OIDC/JWT/sessions) vs what you may do (RBAC/ABAC), enforced at a consistent boundary.', when: 'Every system with users or service-to-service calls.', tradeoffs: 'JWT revocation vs statelessness; central gateway vs per-service enforcement.', redFlags: 'AuthZ checks scattered ad hoc; internal services trusting the network.' },
  { id: 'encryption', name: 'Encryption & secrets', group: 'Security', summary: 'TLS in transit, encryption at rest, KMS-managed keys, secrets in a vault not env-committed.', when: 'Always; stricter with PII/payments/health data.', tradeoffs: 'Key rotation and envelope encryption add moving parts.', redFlags: 'Secrets in code/repo; PII in logs; homemade crypto.' },
  { id: 'tenant-isolation', name: 'Multi-tenant isolation', group: 'Security', summary: 'Row-level vs schema vs database-per-tenant; noisy-neighbor and data-leak containment.', when: 'Any SaaS with multiple customers.', tradeoffs: 'Stronger isolation = higher cost and ops; RLS needs discipline.', redFlags: 'tenant_id filtering left to every developer to remember; no per-tenant limits.' },

  // Operations & Cost
  { id: 'observability', name: 'Observability', group: 'Operations & Cost', summary: 'Structured logs, RED/USE metrics, distributed traces, alerts on symptoms not causes.', when: 'Anything in production.', tradeoffs: 'Cardinality and retention cost real money.', redFlags: 'No tracing across services; alerting on CPU instead of user-facing SLOs.' },
  { id: 'deployment-safety', name: 'Deployment & rollback safety', group: 'Operations & Cost', summary: 'Blue-green/canary, feature flags, backward-compatible migrations, instant rollback.', when: 'Every deploy path.', tradeoffs: 'Dual-running versions require compatible schemas and APIs.', redFlags: 'Destructive migration coupled to a deploy; no rollback story.' },
  { id: 'cost-control', name: 'Cost awareness', group: 'Operations & Cost', summary: 'Know the top cost drivers; budget guards; egress, cross-AZ, and per-call pricing shape design.', when: 'Every design — cost is a first-class constraint.', tradeoffs: 'Cheapest option may cap scale; reserved capacity trades flexibility.', redFlags: 'A design that ignores its own bill (chatty cross-region traffic, unbounded LLM calls).' },
  { id: 'overengineering-avoidance', name: 'Simplicity & YAGNI', group: 'Operations & Cost', summary: 'The boring architecture that meets the constraints wins; complexity must buy something measurable.', when: 'Every decision — especially with small teams.', tradeoffs: 'Too simple can mean rewrite-at-10x; state the upgrade path instead.', redFlags: 'Microservices with 3 devs; K8s for one container; event sourcing for CRUD.' },

  // AI Systems
  { id: 'rag-retrieval', name: 'RAG retrieval design', group: 'AI Systems', summary: 'Hybrid retrieval (vector + keyword + filters), reranking, freshness pipeline into the index.', when: 'LLM answers must be grounded in private/changing data.', tradeoffs: 'Recall vs latency vs cost; index freshness lag.', redFlags: 'Pure vector similarity with no reranker or filters; stale index with no refresh path.' },
  { id: 'rag-chunking', name: 'Chunking & embedding strategy', group: 'AI Systems', summary: 'Chunk size/overlap/structure-awareness decide retrieval quality; embed versioning enables reindex.', when: 'Building any RAG ingestion pipeline.', tradeoffs: 'Small chunks = precision but lost context; large = recall noise.', redFlags: 'One-size chunks for code+prose+tables; no metadata on chunks.' },
  { id: 'eval-gates', name: 'Eval gates & regression testing', group: 'AI Systems', summary: 'Golden datasets + LLM/heuristic judges gate prompt, model, and retrieval changes like CI.', when: 'Any LLM feature that ships to users.', tradeoffs: 'Evals cost time/money and drift; still cheaper than silent quality regressions.', redFlags: 'Prompt changes shipped on vibes; no trace of which version answered.' },
  { id: 'prompt-injection-defense', name: 'Prompt injection defense', group: 'AI Systems', summary: 'Treat retrieved/user content as data: privilege separation, tool allowlists, output validation, human gates on side effects.', when: 'LLM sees untrusted content or can call tools.', tradeoffs: 'Sandboxing limits agent usefulness; validation adds latency.', redFlags: 'Model output executed/trusted as instructions; tools with write access and no confirmation.' },
  { id: 'agent-tool-sandboxing', name: 'Agent orchestration & sandboxing', group: 'AI Systems', summary: 'Bounded loops, budgets, checkpoints, least-privilege tools, human approval for irreversible actions.', when: 'Multi-step agents acting on real systems.', tradeoffs: 'Guardrails reduce autonomy; checkpoints add friction.', redFlags: 'Unbounded agent loops; agents sharing one god-token.' },
  { id: 'llm-cost-control', name: 'LLM cost & latency control', group: 'AI Systems', summary: 'Model tiering (small→large), caching, batching, token budgets, per-tenant ceilings, streaming UX.', when: 'Any LLM feature at scale.', tradeoffs: 'Tiering/caching can degrade quality; measure with evals.', redFlags: 'Biggest model for every call; no per-user spend cap; retry loops on paid APIs.' },
  { id: 'vector-db-choice', name: 'Vector store selection & scaling', group: 'AI Systems', summary: 'pgvector vs dedicated stores; ANN index types (HNSW/IVF), filtering, and reindex cost.', when: 'Semantic search beyond a few million vectors or with heavy filters.', tradeoffs: 'Dedicated stores add infra; pgvector keeps one DB but caps scale.', redFlags: 'A new vector DB when pgvector on existing Postgres suffices; ignoring filter selectivity.' },
];

export const CONCEPTS = CONCEPT_CARDS.map((c) => c.id);

export const CONCEPT_GROUP_MAP: Record<string, string[]> = CONCEPT_GROUPS.reduce(
  (acc, g) => {
    acc[g] = CONCEPT_CARDS.filter((c) => c.group === g).map((c) => c.id);
    return acc;
  },
  {} as Record<string, string[]>,
);

// The universal design checklist — what a complete architecture answer covers,
// shown in the Design Reference panel for every problem.
export const DESIGN_CHECKLIST = [
  { step: 'Requirements & constraints', detail: 'Restate functional needs, users, and the hard numbers (RPS, data size, latency SLO, budget, team).' },
  { step: 'Capacity estimation', detail: 'Back-of-envelope: peak RPS, storage/year, bandwidth, cache working set, connections.' },
  { step: 'API & data model', detail: 'Core entities, access patterns, the 3-5 key endpoints or events.' },
  { step: 'High-level shape', detail: 'Clients → edge → services → data. Name what is sync vs async and why.' },
  { step: 'Deep dives where it hurts', detail: 'The 1-2 hardest paths: the write hot path, the consistency boundary, the fanout.' },
  { step: 'Failure walk', detail: 'Kill each box and each dependency: what breaks, what degrades, what data is at risk?' },
  { step: 'Consistency decisions', detail: 'Per data class: strong / read-your-writes / eventual — and where staleness shows.' },
  { step: 'Security boundary', detail: 'AuthN/Z enforcement point, secrets, tenant isolation, injection surfaces (incl. LLM).' },
  { step: 'Observability & operations', detail: 'Golden signals, tracing, deploy/rollback, migration path.' },
  { step: 'Cost & simplicity check', detail: 'Top 3 cost drivers; what you deliberately did NOT build, and the 10x upgrade path.' },
] as const;
