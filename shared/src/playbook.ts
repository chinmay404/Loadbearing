// The playbook: the trusted reference the review is grounded in.
//
// A model asked to grade an architecture from memory alone is confident and
// uneven — it invents thresholds, forgets the failure mode that makes a pattern
// necessary, and reasons differently about the same question on two runs. So it
// is not asked to. Relevant entries from this file are retrieved
// deterministically and put in front of it, and its findings must cite the
// entries they rest on.
//
// Every entry paraphrases published, widely-adopted engineering practice and
// names where it comes from, so a learner can go read the original. Nothing here
// is invented for this app; the numbers are the ones the industry actually
// quotes. Keep it that way — an entry that cannot be traced to a real source
// does not belong in a corpus whose whole job is to be trustworthy.

import type { ArchNodeType } from './types.js';

export type SourceKind =
  | 'vendor-doc'
  | 'engineering-blog'
  | 'book'
  | 'paper'
  | 'standard'
  | 'sre-practice';

export interface PlaybookEntry {
  /** Stable citation key. Findings reference these, so never rename one in place. */
  id: string;
  title: string;
  /** Where the practice is documented, specifically enough to go and read it. */
  source: string;
  sourceKind: SourceKind;
  /** Concept card ids this entry grounds. */
  concepts: string[];
  /** Component types the entry has something to say about. */
  nodeTypes?: ArchNodeType[];
  /** Lowercase words matched against the problem text and node labels. */
  triggers: string[];
  /** The prescriptive statement: what a design that respects this does. */
  rule: string;
  /** Quantitative anchors — the figures worth arguing from rather than guessing. */
  numbers?: string;
  /** The failure this exists to prevent. Without this line the rule is cargo cult. */
  failure: string;
}

export const PLAYBOOK: PlaybookEntry[] = [
  // ---------------- correctness under retry ----------------
  {
    id: 'idempotency-keys',
    title: 'Client-supplied idempotency keys on money-moving writes',
    source: 'Stripe API reference, Idempotent requests',
    sourceKind: 'vendor-doc',
    concepts: ['idempotency', 'timeout-retry', 'distributed-transactions'],
    nodeTypes: ['payment_gateway', 'api_gateway', 'service', 'sql_db'],
    triggers: ['payment', 'charge', 'order', 'checkout', 'transfer', 'booking', 'billing', 'invoice'],
    rule: 'The caller generates a unique key per logical operation and sends it with every retry. The server stores the key with the result of the first attempt and replays that stored result for any repeat, so a retry is a lookup rather than a second side effect. Keys are scoped per endpoint and expire after a bounded window (Stripe uses 24 hours).',
    numbers: 'Retention window ~24h is the published norm; the key must be stored in the same transaction as the effect it guards.',
    failure: 'A timeout is indistinguishable from a failure at the client, so it retries and the customer is charged twice. This is the single most common real-world correctness bug in payment paths.',
  },
  {
    id: 'transactional-outbox',
    title: 'Transactional outbox instead of dual writes',
    source: 'Chris Richardson, Microservices Patterns — Transactional Outbox; Debezium outbox documentation',
    sourceKind: 'book',
    concepts: ['outbox', 'distributed-transactions', 'exactly-once', 'consistency-models'],
    nodeTypes: ['sql_db', 'cdc_connector', 'queue', 'event_bus', 'stream'],
    triggers: ['event', 'publish', 'notify', 'order', 'state change', 'downstream', 'sync'],
    rule: 'Write the business row and the outgoing message into the same database transaction, one of them into an outbox table. A separate relay (change-data-capture or a poller) reads the outbox and publishes. The database transaction is the only atomic unit required.',
    failure: 'Writing to the database and then publishing to a broker as two separate operations loses messages whenever the process dies between them — and the gap is invisible in testing because it is a race.',
  },
  {
    id: 'saga-compensation',
    title: 'Sagas need a defined compensation for every step',
    source: 'Garcia-Molina & Salem, Sagas (1987); Chris Richardson, Microservices Patterns — Saga',
    sourceKind: 'paper',
    concepts: ['saga', 'distributed-transactions', 'consistency-models'],
    nodeTypes: ['saga_orchestrator', 'workflow_engine', 'service'],
    triggers: ['multi-step', 'reserve', 'booking', 'checkout', 'onboarding', 'refund', 'cancel'],
    rule: 'Model a multi-service business action as a sequence of local transactions, each with an explicit compensating action, and drive it from an orchestrator or a choreography that persists progress. Order the steps so the hardest-to-undo one is last.',
    failure: 'A saga whose third step has no compensation leaves the system permanently half-committed — stock reserved for an order that was never paid for, and no code path that releases it.',
  },
  {
    id: 'effectively-once',
    title: 'Exactly-once is idempotent producer plus transactional consumer',
    source: 'Apache Kafka documentation — transactions and idempotent producer; Confluent, exactly-once semantics',
    sourceKind: 'vendor-doc',
    concepts: ['exactly-once', 'idempotency', 'stream-processing'],
    nodeTypes: ['stream', 'queue', 'worker', 'event_bus'],
    triggers: ['exactly once', 'duplicate', 'stream', 'kafka', 'event', 'counter', 'aggregate'],
    rule: 'There is no exactly-once delivery over a network. What exists is exactly-once *processing*: at-least-once delivery plus deduplication, achieved by an idempotent producer (sequence numbers per partition) and a consumer that commits its offset and its output in one atomic step. Outside a single system that supports this, make the consumer idempotent instead.',
    failure: 'Designs that claim exactly-once delivery double-count under retry, and the error only appears as slowly drifting totals that nobody can reproduce.',
  },

  // ---------------- async plumbing ----------------
  {
    id: 'dlq-with-replay',
    title: 'Dead-letter queue with a bounded redrive and an alarm',
    source: 'AWS SQS Developer Guide — dead-letter queues and redrive policy',
    sourceKind: 'vendor-doc',
    concepts: ['queue-backpressure', 'webhook-reliability', 'observability'],
    nodeTypes: ['queue', 'dead_letter_queue', 'worker', 'event_bus'],
    triggers: ['queue', 'worker', 'async', 'retry', 'poison', 'job'],
    rule: 'Set a maximum receive count on the main queue; messages that exceed it move to a dead-letter queue. The DLQ has an alarm on depth greater than zero and a documented replay path. A DLQ nobody watches is a silent data-loss buffer.',
    numbers: 'Typical maxReceiveCount is 3–5. Alarm on DLQ depth > 0, not on a threshold.',
    failure: 'Without a DLQ one malformed message blocks the partition forever or is retried indefinitely, consuming the consumer capacity that healthy messages need.',
  },
  {
    id: 'bounded-queues-shed',
    title: 'Bounded queues and explicit load shedding',
    source: 'Google SRE Book — Handling Overload; Netflix concurrency-limits',
    sourceKind: 'sre-practice',
    concepts: ['queue-backpressure', 'degradation', 'timeout-retry'],
    nodeTypes: ['queue', 'load_balancer', 'api_gateway', 'service', 'rate_limiter'],
    triggers: ['overload', 'peak', 'spike', 'burst', 'backpressure', 'throughput'],
    rule: 'Every queue has a maximum depth, and reaching it rejects new work with a clear error rather than buffering. An unbounded queue converts an overload into unbounded latency, which is worse: the client has already given up on responses still being processed.',
    numbers: 'Shed before the queue exceeds roughly the work completable inside the client timeout — a 2s timeout at 500 rps means a useful depth of about 1000.',
    failure: 'Unbounded buffering produces the classic death spiral: latency climbs past the client timeout, clients retry, the retry load makes latency worse, and nothing recovers without a restart.',
  },
  {
    id: 'backoff-with-jitter',
    title: 'Exponential backoff with full jitter, and a retry budget',
    source: 'AWS Architecture Blog — Exponential Backoff and Jitter; Google SRE Book — Addressing Cascading Failures',
    sourceKind: 'vendor-doc',
    concepts: ['timeout-retry', 'circuit-breaker', 'degradation'],
    nodeTypes: ['service', 'worker', 'api_gateway', 'third_party'],
    triggers: ['retry', 'timeout', 'flaky', 'third party', 'upstream', 'failure'],
    rule: 'Retry with exponentially growing delay and full jitter (sleep a random value in [0, cap]), cap the attempts, and cap retries as a fraction of total requests so a struggling dependency is not retried into the ground. Retry only what is safe to retry — which is why idempotency comes first.',
    numbers: 'Three attempts is a common ceiling; a retry budget of about 10% of request volume is the Google SRE guidance.',
    failure: 'Un-jittered backoff synchronises every client into the same retry wave, so the dependency is hit by a periodic thundering herd exactly as it tries to recover.',
  },
  {
    id: 'circuit-breaker',
    title: 'Circuit breaker in front of a dependency that can be slow',
    source: 'Michael Nygard, Release It! — Circuit Breaker; Netflix Hystrix design notes',
    sourceKind: 'book',
    concepts: ['circuit-breaker', 'degradation', 'timeout-retry'],
    nodeTypes: ['service', 'third_party', 'payment_gateway', 'llm', 'service_mesh'],
    triggers: ['third party', 'external', 'dependency', 'slow', 'stripe', 'provider', 'api'],
    rule: 'Track the failure rate of calls to a dependency; past a threshold, stop calling it and fail fast (or serve a fallback) for a cool-off period, then let a trial request decide whether to close again. Pair it with a bulkhead: a bounded pool of concurrent calls, so one slow dependency cannot consume every thread.',
    failure: 'Without a breaker, a dependency that answers in 30s instead of 300ms occupies every worker thread, and a fault in one non-critical feature takes the whole service down.',
  },
  {
    id: 'deadline-propagation',
    title: 'One deadline for the whole request, propagated to every hop',
    source: 'gRPC documentation — deadlines; Google SRE Book — timeouts and cascading failure',
    sourceKind: 'vendor-doc',
    concepts: ['timeout-retry', 'circuit-breaker', 'observability'],
    nodeTypes: ['api_gateway', 'service', 'service_mesh', 'sidecar'],
    triggers: ['latency', 'p99', 'timeout', 'budget', 'chain', 'downstream'],
    rule: 'The edge sets a deadline from the user-facing latency budget and passes the remaining time to every downstream call; each hop refuses work it cannot finish in time. Per-hop timeouts chosen independently always sum to more than the budget.',
    numbers: 'If the user budget is 250ms p99 and the path has three hops, no single hop may be given the full 250ms.',
    failure: 'Independent timeouts mean the system keeps working on requests whose callers have already timed out — burning capacity on results nobody will read.',
  },

  // ---------------- capacity and latency ----------------
  {
    id: 'utilization-knee',
    title: 'Latency explodes as utilization approaches one',
    source: 'Queueing theory (M/M/1 response time); Neil Gunther, Guerrilla Capacity Planning',
    sourceKind: 'book',
    concepts: ['capacity-estimation', 'queue-backpressure', 'cost-control'],
    triggers: ['capacity', 'rps', 'peak', 'utilization', 'headroom', 'scale', 'latency'],
    rule: 'Response time grows as service_time / (1 - utilization). At 50% utilization latency is twice the service time; at 90% it is ten times; at 95% twenty. Size components so peak utilization stays in the 60–75% band, and treat anything above 80% as already failing.',
    numbers: 'u=0.5 → 2x, u=0.8 → 5x, u=0.9 → 10x, u=0.95 → 20x service time.',
    failure: 'Capacity planned to "just fit" peak load produces a system that is technically not overloaded and yet has 10x its expected latency, which users experience as an outage.',
  },
  {
    id: 'tail-at-scale',
    title: 'Design for the tail, not the average',
    source: 'Dean & Barroso, The Tail at Scale (CACM 2013)',
    sourceKind: 'paper',
    concepts: ['capacity-estimation', 'degradation', 'observability'],
    triggers: ['p99', 'latency', 'tail', 'fanout', 'slow', 'percentile'],
    rule: 'A request that fans out to N components waits for the slowest of them, so the parent p99 is set by the children\'s tail, not their mean. Counter it with hedged requests, tied requests, micro-partitioning, and by never sizing from averages.',
    numbers: 'With 100 parallel calls each having a 1% chance of being slow, the odds that at least one is slow are about 63%.',
    failure: 'A design justified by "average response is 20ms" fails its p99 budget the moment it fans out, and the arithmetic that would have shown this was never done.',
  },
  {
    id: 'littles-law',
    title: "Little's law ties concurrency, throughput and latency",
    source: "Little's law (L = λW); Brendan Gregg, Systems Performance",
    sourceKind: 'book',
    concepts: ['capacity-estimation', 'queue-backpressure'],
    triggers: ['concurrency', 'connections', 'threads', 'pool', 'capacity', 'rps'],
    rule: 'Concurrent requests in the system = arrival rate x average residence time. Use it to size thread pools, connection pools and worker counts: 500 rps at 200ms each needs 100 concurrent slots, and no more.',
    numbers: '500 rps x 0.2 s = 100 in-flight requests.',
    failure: 'Pools sized by guesswork are either a bottleneck nobody can find or a memory exhaustion waiting for a traffic spike.',
  },
  {
    id: 'capacity-headroom',
    title: 'Provision for measured peak with real headroom, not for average',
    source: 'AWS Well-Architected Framework — Performance Efficiency and Reliability pillars',
    sourceKind: 'vendor-doc',
    concepts: ['capacity-estimation', 'cost-control', 'spof'],
    triggers: ['peak', 'daily', 'seasonal', 'spike', 'autoscale', 'growth'],
    rule: 'Size from the peak the traffic shape actually produces (daily peaks are commonly 2–4x the daily mean; launches and sales are worse), then keep headroom for the loss of one instance or one zone. Autoscaling reacts in minutes and does not save a system from a step change in seconds.',
    numbers: 'Peak-to-mean of 2–4x is typical for consumer traffic; N+1 per zone is the minimum for a zone-failure-tolerant tier.',
    failure: 'A cluster sized for the mean is saturated every evening, and one sized without N+1 becomes overloaded by the very instance failure it was supposed to survive.',
  },

  // ---------------- caching ----------------
  {
    id: 'cache-stampede',
    title: 'Protect hot keys from stampede on expiry',
    source: 'Vattani, Chierichetti & Lowenstein, Optimal Probabilistic Cache Stampede Prevention (VLDB 2015); Facebook memcache lease mechanism',
    sourceKind: 'paper',
    concepts: ['caching', 'hot-partition', 'queue-backpressure'],
    nodeTypes: ['cache', 'sql_db', 'service'],
    triggers: ['cache', 'hot', 'popular', 'trending', 'viral', 'ttl', 'expiry'],
    rule: 'When a hot key expires, only one request may recompute it: take a lock or lease, coalesce the rest, or refresh probabilistically before expiry. Add jitter to TTLs so keys written together do not expire together.',
    failure: 'A single popular key expiring sends every concurrent reader to the database at once — a self-inflicted load spike at exactly the traffic level where the cache mattered most.',
  },
  {
    id: 'cache-invalidation-story',
    title: 'Every cache needs a named invalidation strategy',
    source: 'Martin Kleppmann, Designing Data-Intensive Applications; AWS ElastiCache caching strategies',
    sourceKind: 'book',
    concepts: ['caching', 'consistency-models'],
    nodeTypes: ['cache', 'cdn', 'materialized_view', 'prompt_cache'],
    triggers: ['cache', 'stale', 'invalidate', 'ttl', 'freshness'],
    rule: 'State which of the three you are doing and what staleness it permits: TTL only (bounded staleness, simplest), write-through (fresh, slower writes), or explicit invalidation on write (fresh, and now every write path must know every cache key). Cache-aside with a TTL is the default; anything stricter must be justified.',
    failure: 'A cache with no TTL and no invalidation serves wrong data forever, and the bug reports arrive weeks later as "the site shows an old price".',
  },
  {
    id: 'cache-not-source-of-truth',
    title: 'A cache is not a system of record',
    source: 'Redis documentation — persistence and durability guarantees',
    sourceKind: 'vendor-doc',
    concepts: ['caching', 'spof', 'consistency-models'],
    nodeTypes: ['cache', 'session_store'],
    triggers: ['redis', 'cache', 'session', 'store', 'durable'],
    rule: 'Anything whose loss is unacceptable must exist in a durable store. A cache may be the fast path to it, never the only copy. If the design cannot survive flushing the cache, it does not have a cache — it has an in-memory database with no durability story.',
    failure: 'A cache eviction, failover, or restart silently deletes data the business needed, and there is nothing to restore from.',
  },

  // ---------------- data ----------------
  {
    id: 'read-your-writes',
    title: 'Read-your-writes after a write, on the leader or from a sticky session',
    source: 'Martin Kleppmann, Designing Data-Intensive Applications — Problems with Replication Lag',
    sourceKind: 'book',
    concepts: ['replication', 'consistency-models', 'cap-tradeoff'],
    nodeTypes: ['read_replica', 'sql_db', 'db_proxy'],
    triggers: ['replica', 'read replica', 'signup', 'profile', 'after saving', 'lag'],
    rule: 'A user who has just written must read their own write. Route the read that immediately follows a write to the leader, or pin that session to a replica known to be caught up. Everything else can read a replica.',
    numbers: 'Replication lag is normally milliseconds and pathologically seconds to minutes under write bursts or long transactions — design for the pathological case.',
    failure: 'The user saves a profile, is redirected, and sees the old values. It looks like data loss, and it is the most common bug introduced by adding read replicas.',
  },
  {
    id: 'index-before-shard',
    title: 'Exhaust vertical, index and replica scaling before sharding',
    source: 'Postgres documentation on indexing and partitioning; widely documented migration experience (e.g. Notion, Figma engineering blogs on when they finally sharded)',
    sourceKind: 'engineering-blog',
    concepts: ['sharding', 'schema-design', 'overengineering-avoidance'],
    nodeTypes: ['sql_db', 'sharded_cluster', 'read_replica'],
    triggers: ['shard', 'partition', 'postgres', 'mysql', 'scale', 'growth', 'rows'],
    rule: 'Shard when a single node can no longer hold the working set or absorb the write rate — not before. First fix the queries and indexes, then add read replicas for read load, then partition by time or tenant inside one database. A modern single Postgres node handles low-thousands of writes per second and terabytes of data.',
    numbers: 'Single-node Postgres commonly serves thousands of writes/sec and multi-TB datasets; sharding decisions below roughly 1TB or a few thousand writes/sec usually mean the query plan was the problem.',
    failure: 'Premature sharding buys cross-shard joins, distributed transactions and a resharding project, in exchange for scale nobody needed — and it is very hard to undo.',
  },
  {
    id: 'partition-key-skew',
    title: 'Choose a partition key by access pattern, then check it for skew',
    source: 'Amazon DynamoDB Developer Guide — partition key design; Kafka partitioning documentation',
    sourceKind: 'vendor-doc',
    concepts: ['sharding', 'hot-partition', 'schema-design'],
    nodeTypes: ['sharded_cluster', 'nosql_db', 'stream', 'queue'],
    triggers: ['tenant', 'shard key', 'partition', 'celebrity', 'skew', 'multi-tenant'],
    rule: 'The partition key must spread load evenly AND keep the rows a query needs together. Test it against the real distribution: one enormous tenant, one celebrity user, or a timestamp key that sends all of today\'s writes to one partition will each defeat an otherwise correct scheme. Salt or split the known hot keys explicitly.',
    failure: 'A tenant-id key gives you one shard at 100% and nine at 5%; a timestamp key gives you one hot partition permanently. Both look fine in a uniform load test.',
  },
  {
    id: 'quorum-rw',
    title: 'Quorum reads and writes: R + W > N',
    source: 'DeCandia et al., Dynamo (SOSP 2007); Cassandra documentation on consistency levels',
    sourceKind: 'paper',
    concepts: ['consistency-models', 'replication', 'cap-tradeoff'],
    nodeTypes: ['nosql_db', 'sharded_cluster'],
    triggers: ['quorum', 'cassandra', 'dynamo', 'consistency', 'replication factor'],
    rule: 'With N replicas, requiring W acknowledged writes and R reads such that R + W > N guarantees a read overlaps a written replica. Choosing R=W=1 buys latency and gives up the guarantee — which is a valid choice, but must be a stated one.',
    numbers: 'N=3, W=2, R=2 is the standard balanced setting.',
    failure: 'Teams that pick "eventual" without doing this arithmetic discover the read path can return data older than a write that was already acknowledged to the user.',
  },
  {
    id: 'cdc-to-index',
    title: 'Feed search indexes and derived stores asynchronously from the log',
    source: 'Debezium documentation; Elasticsearch guidance on indexing from a primary store',
    sourceKind: 'vendor-doc',
    concepts: ['search-indexing', 'outbox', 'stream-processing', 'consistency-models'],
    nodeTypes: ['search_index', 'cdc_connector', 'change_feed', 'materialized_view', 'stream'],
    triggers: ['search', 'elasticsearch', 'index', 'faceted', 'autocomplete', 'derived'],
    rule: 'The primary store owns the write; the search index is derived from its change stream. Accept the lag (usually under a second) and provide a rebuild path from the primary. Never make the user-facing write wait on the index, and never let the index be the only copy.',
    failure: 'Synchronous dual writes to database and index fail apart under partial failure, leaving an index that disagrees with the database and no way to tell which is right.',
  },
  {
    id: 'presigned-blob-upload',
    title: 'Large objects go straight to object storage, metadata to the database',
    source: 'AWS S3 Developer Guide — presigned URLs and multipart upload',
    sourceKind: 'vendor-doc',
    concepts: ['blob-storage', 'capacity-estimation', 'cost-control'],
    nodeTypes: ['blob_store', 'cdn', 'service', 'transcoder'],
    triggers: ['upload', 'image', 'video', 'file', 'attachment', 'photo', 'document'],
    rule: 'Issue a presigned URL and let the client upload directly to object storage; the application only records metadata and reacts to the completion event. Serve reads through a CDN, not through the application.',
    failure: 'Proxying uploads through application servers spends their bandwidth and memory on bytes they do not need to see, and a handful of large uploads starves every other request.',
  },
  {
    id: 'connection-pooler',
    title: 'Put a pooler between many short-lived clients and Postgres',
    source: 'PgBouncer documentation; Supabase and AWS RDS Proxy guidance on connection limits',
    sourceKind: 'vendor-doc',
    concepts: ['capacity-estimation', 'spof'],
    nodeTypes: ['connection_pooler', 'db_proxy', 'sql_db', 'serverless_fn'],
    triggers: ['serverless', 'lambda', 'postgres', 'connections', 'pool', 'too many clients'],
    rule: 'Postgres allocates a process per connection, so its useful concurrency is in the low hundreds. Anything with many short-lived instances — serverless functions especially — must go through a transaction-mode pooler, and must not rely on server-side prepared statements when it does.',
    numbers: 'Default max_connections is around 100; each connection costs several MB of server memory.',
    failure: 'Serverless scale-out opens a connection per invocation and exhausts the database\'s connection slots, so the failure arrives as "too many clients" precisely during the traffic peak.',
  },

  // ---------------- edge and traffic ----------------
  {
    id: 'token-bucket-edge',
    title: 'Rate-limit at the edge with a token bucket, and say so in the response',
    source: 'IETF RFC 6585 (429 Too Many Requests) and draft RateLimit header fields; Cloudflare and Stripe rate-limit documentation',
    sourceKind: 'standard',
    concepts: ['rate-limiting', 'cost-control', 'degradation'],
    nodeTypes: ['rate_limiter', 'api_gateway', 'waf', 'cdn'],
    triggers: ['rate limit', 'abuse', 'public api', 'login', 'search', 'llm', 'expensive'],
    rule: 'Limit per identity (key, user, IP) with a token bucket that permits a burst and bounds the sustained rate, applied before the expensive work. Return 429 with Retry-After so a well-behaved client can back off correctly. Distributed counters need a shared store — that dependency is part of the design.',
    failure: 'Without a limiter, one client\'s bug or one scraper sets your capacity and your bill; with a limiter that returns a bare 500, every client retries immediately and makes it worse.',
  },
  {
    id: 'cdn-in-front',
    title: 'Static and cacheable content is served from the edge, not the origin',
    source: 'AWS CloudFront developer guide; Fastly and Cloudflare caching documentation',
    sourceKind: 'vendor-doc',
    concepts: ['cdn', 'caching', 'cost-control'],
    nodeTypes: ['cdn', 'blob_store', 'load_balancer'],
    triggers: ['global', 'static', 'image', 'video', 'asset', 'worldwide', 'latency'],
    rule: 'The CDN sits in front of everything cacheable, keyed carefully and with explicit cache-control. It is the first component in the request path, not something bolted behind the application. Plan invalidation (versioned URLs beat purges).',
    failure: 'Serving assets from the origin pays intercontinental latency on every request and turns a traffic spike into an origin outage.',
  },
  {
    id: 'websocket-fanout',
    title: 'Realtime fanout needs a connection gateway plus pub/sub, not polling',
    source: 'Discord and Slack engineering write-ups on connection gateways; Redis and NATS pub/sub documentation',
    sourceKind: 'engineering-blog',
    concepts: ['websocket-scale', 'fanout', 'capacity-estimation'],
    nodeTypes: ['websocket_gw', 'event_bus', 'cache', 'service'],
    triggers: ['realtime', 'live', 'websocket', 'presence', 'chat', 'feed', 'subscribe', 'concurrent viewers'],
    rule: 'Terminate long-lived connections on a gateway tier whose only job is connections, keep the subscription registry outside it, and fan messages out through pub/sub. Size the gateway by concurrent connections and messages per second per connection, both of which are independent of request rps.',
    numbers: 'A tuned connection gateway holds tens of thousands to ~100k connections per instance; fanout cost is subscribers x message rate, which is what actually saturates.',
    failure: 'Database polling for updates puts a floor on latency and a multiplier on database load; ignoring reconnect behaviour means a deploy drops every connection at once and they all return in the same second.',
  },
  {
    id: 'reconnect-jitter',
    title: 'Jittered reconnect and staged restarts for long-lived connections',
    source: 'Google SRE Book — Addressing Cascading Failures; AWS builders\' library on retry storms',
    sourceKind: 'sre-practice',
    concepts: ['websocket-scale', 'timeout-retry', 'deployment-safety'],
    nodeTypes: ['websocket_gw', 'load_balancer', 'ci_cd'],
    triggers: ['websocket', 'reconnect', 'deploy', 'restart', 'connection', 'realtime'],
    rule: 'Clients reconnect after a randomised delay, and the server rolls a connection tier in stages rather than all at once. Both halves are required: a staged restart still hurts if clients return instantly and in lockstep.',
    failure: 'A deploy disconnects 400k clients that all reconnect within the same second, and the authentication path — sized for steady state — becomes the outage.',
  },

  // ---------------- reliability ----------------
  {
    id: 'no-single-instance',
    title: 'Every stateful component names its failover, or it is a single point of failure',
    source: 'AWS Well-Architected Framework — Reliability pillar; multi-AZ RDS documentation',
    sourceKind: 'vendor-doc',
    concepts: ['spof', 'multi-region', 'replication'],
    nodeTypes: ['sql_db', 'cache', 'queue', 'session_store', 'load_balancer'],
    triggers: ['availability', 'uptime', '99.9', '99.95', 'failover', 'ha', 'single'],
    rule: 'For each stateful box, state what happens when it dies: who takes over, how failover is triggered, how long it takes, and what is lost. One instance with no standby, or a standby in the same failure domain, does not meet a 99.9%+ target.',
    numbers: '99.9% allows ~43 minutes of downtime per month; 99.95% about 22; 99.99% about 4.',
    failure: 'The design meets its availability number on paper because nobody multiplied the components\' individual availabilities or asked what a zone loss does.',
  },
  {
    id: 'multi-az-before-multi-region',
    title: 'Multi-AZ first; multi-region only for a stated requirement',
    source: 'AWS Well-Architected Framework — Reliability pillar; Google Cloud disaster-recovery planning guide',
    sourceKind: 'vendor-doc',
    concepts: ['multi-region', 'spof', 'cost-control', 'overengineering-avoidance'],
    triggers: ['region', 'global', 'disaster', 'dr', 'availability', 'failover'],
    rule: 'Spreading across availability zones removes the common failure and costs almost nothing architecturally. Active-active across regions means solving write conflicts, data residency and split brain, and roughly doubles the operational surface — take it on only for a written RTO/RPO or a residency requirement.',
    failure: 'A team of five that builds multi-region active-active ships neither region reliably, while the actual risk — one zone going away — was solvable in a day.',
  },
  {
    id: 'rpo-rto-tested',
    title: 'Backups are a restore procedure with a tested time',
    source: 'Google SRE Book — Data Integrity; AWS backup and restore guidance',
    sourceKind: 'sre-practice',
    concepts: ['spof', 'multi-region', 'observability'],
    nodeTypes: ['backup_store', 'sql_db', 'blob_store'],
    triggers: ['backup', 'restore', 'disaster', 'corruption', 'rpo', 'rto', 'retention'],
    rule: 'State the recovery point objective (how much data may be lost) and the recovery time objective (how long recovery may take), then prove both by restoring. Point-in-time recovery protects against the far more common failure — a bad migration or a wrong DELETE — than whole-region loss does.',
    failure: 'Untested backups are discovered to be unreadable, incomplete, or 40 hours slow at exactly the moment they are needed.',
  },
  {
    id: 'graceful-degradation',
    title: 'Name what the system does when a dependency is gone',
    source: 'Netflix engineering on fallbacks and graceful degradation; Google SRE Book — graceful degradation',
    sourceKind: 'engineering-blog',
    concepts: ['degradation', 'circuit-breaker', 'spof'],
    triggers: ['degrade', 'fallback', 'partial', 'unavailable', 'must not fail', 'critical path'],
    rule: 'Classify every dependency as critical or optional, and for each optional one define the degraded behaviour: stale cache, generic response, feature hidden. A failure in recommendations must not fail checkout. Degradation is a designed feature with its own tests, not the absence of error handling.',
    failure: 'Every dependency treated as critical means the system\'s availability is the product of all of them — five 99.9% dependencies give 99.5% at best.',
  },
  {
    id: 'chaos-gameday',
    title: 'Verify failure handling by causing the failure',
    source: 'Netflix Chaos Monkey / Chaos Engineering principles; AWS Fault Injection Service',
    sourceKind: 'engineering-blog',
    concepts: ['spof', 'degradation', 'observability', 'deployment-safety'],
    triggers: ['chaos', 'failover', 'resilience', 'test', 'gameday', 'kill'],
    rule: 'Failover paths that are never exercised do not work. Kill an instance, add latency to a dependency, and fail a zone on purpose — in a controlled window with a hypothesis stated first — and fix what you find.',
    failure: 'The first real execution of the failover path is during the incident, and that is when the missing permission, stale DNS or unreplicated secret is discovered.',
  },

  // ---------------- operations ----------------
  {
    id: 'slo-error-budget',
    title: 'An SLO with an error budget, measured from the user\'s side',
    source: 'Google SRE Book and SRE Workbook — Service Level Objectives',
    sourceKind: 'sre-practice',
    concepts: ['observability', 'deployment-safety', 'cost-control'],
    nodeTypes: ['observability'],
    triggers: ['sla', 'slo', 'availability', 'uptime', 'reliability', 'error rate'],
    rule: 'Pick a small number of user-visible indicators (success rate, latency at a percentile), set a target, and treat the shortfall as a budget: while it holds, ship; when it is spent, reliability work takes priority. Measure where the user is, not inside your own service.',
    failure: 'Without an explicit target, every incident is argued from scratch and "more reliable" competes with "more features" with no way to settle it.',
  },
  {
    id: 'golden-signals',
    title: 'Instrument latency, traffic, errors and saturation — plus tracing',
    source: 'Google SRE Book — Monitoring Distributed Systems (four golden signals); OpenTelemetry documentation',
    sourceKind: 'sre-practice',
    concepts: ['observability'],
    nodeTypes: ['observability', 'service_mesh', 'sidecar'],
    triggers: ['monitor', 'metrics', 'logs', 'trace', 'alert', 'debug', 'dashboard'],
    rule: 'Every service exports the four signals, requests carry a trace id end to end, and logs are structured and correlated to it. Alert on symptoms the user feels, not on causes; every alert has a runbook and a human action.',
    failure: 'A distributed system without tracing cannot answer "which hop was slow", so every latency incident becomes a multi-hour guessing game.',
  },
  {
    id: 'progressive-delivery',
    title: 'Ship progressively with a fast, tested rollback',
    source: 'Google SRE Workbook — canarying releases; Martin Fowler on blue-green deployment and canary release',
    sourceKind: 'sre-practice',
    concepts: ['deployment-safety', 'observability'],
    nodeTypes: ['ci_cd', 'feature_flags', 'load_balancer'],
    triggers: ['deploy', 'release', 'rollout', 'migration', 'flag', 'rollback'],
    rule: 'Route a small share of traffic to the new version, compare its signals against the old, and promote or abort automatically. Keep schema changes backward-compatible in both directions so the previous version still runs — otherwise rollback is not available when you need it.',
    numbers: 'A canary of 1–5% for long enough to see the affected code path is the usual shape.',
    failure: 'An all-at-once deploy with a destructive migration has no way back: the only path is forward through an outage.',
  },
  {
    id: 'runbook-per-alert',
    title: 'Every alert has an owner, a runbook and a human action',
    source: 'Google SRE Book — Being On-Call and Effective Troubleshooting',
    sourceKind: 'sre-practice',
    concepts: ['observability'],
    nodeTypes: ['observability'],
    triggers: ['alert', 'oncall', 'page', 'incident', 'runbook', 'noisy'],
    rule: 'If an alert fires and the responder has nothing to do, delete the alert. Page only on user-visible symptoms or imminent ones; route everything else to a dashboard or a ticket.',
    failure: 'Alert fatigue is a reliability problem: a responder who has learned to ignore pages will ignore the one that mattered.',
  },
  {
    id: 'cost-per-request',
    title: 'Know the unit cost, and put a ceiling on the expensive path',
    source: 'AWS Well-Architected Framework — Cost Optimization pillar',
    sourceKind: 'vendor-doc',
    concepts: ['cost-control', 'llm-cost-control', 'rate-limiting'],
    triggers: ['budget', 'cost', 'spend', '$', 'per month', 'cheap', 'expensive'],
    rule: 'Express cost per request or per tenant, not just per month, so the effect of growth is visible. Anything with unbounded per-request cost — model inference, third-party calls, egress, search — gets a hard ceiling and an alarm before the invoice.',
    failure: 'A design that fits the budget at current volume and scales its cost linearly with an unbounded input is one viral day away from a bill nobody approved.',
  },
  {
    id: 'right-sized-for-team',
    title: 'Judge a design against the team that has to run it',
    source: 'AWS Well-Architected Framework — Operational Excellence; Fowler on YAGNI; Kleppmann on operability',
    sourceKind: 'book',
    concepts: ['overengineering-avoidance', 'cost-control', 'observability'],
    triggers: ['team of', 'no sre', 'small team', 'startup', 'maintain', 'simple', 'headcount'],
    rule: 'Operational complexity is a cost paid every week by the people on call. Each additional stateful system needs upgrades, backups, monitoring and expertise. For a small team, choosing one component that is 80% right beats three that are individually optimal.',
    failure: 'Kafka, Elasticsearch, Cassandra and a service mesh chosen by a team of four means four systems nobody is expert in, and the outage is always in the one that was added "just in case".',
  },

  // ---------------- security ----------------
  {
    id: 'authn-at-edge-authz-in-service',
    title: 'Authenticate at the edge, authorize where the data lives',
    source: 'NIST SP 800-207 Zero Trust Architecture; OWASP API Security Top 10 (broken object-level authorization)',
    sourceKind: 'standard',
    concepts: ['authn-authz', 'tenant-isolation'],
    nodeTypes: ['api_gateway', 'auth', 'identity_provider', 'service', 'iam'],
    triggers: ['auth', 'login', 'user', 'permission', 'role', 'tenant', 'multi-tenant', 'admin'],
    rule: 'The gateway proves who the caller is and rejects anonymous traffic; each service still checks that this caller may touch this specific object. Never treat a network position as authorization.',
    failure: 'Object-level authorization checked only at the edge means changing an id in the URL returns another tenant\'s data — the most commonly exploited API flaw there is.',
  },
  {
    id: 'no-third-party-pii-in-clear',
    title: 'Sensitive data is encrypted, minimised, and tokenised before it leaves',
    source: 'PCI DSS requirements on cardholder data; GDPR data-minimisation principle; AWS KMS documentation',
    sourceKind: 'standard',
    concepts: ['encryption', 'authn-authz', 'tenant-isolation'],
    nodeTypes: ['kms', 'secrets_manager', 'third_party', 'payment_gateway', 'blob_store'],
    triggers: ['pii', 'card', 'pci', 'gdpr', 'personal', 'health', 'hipaa', 'sensitive', 'encrypt'],
    rule: 'Encrypt in transit and at rest, hold keys in a managed KMS, and send third parties the least they need — a token, not the card number. Keeping card data at all pulls the whole system into PCI scope; the usual right answer is to never hold it.',
    failure: 'Sending raw PII to an analytics or model provider is a breach that has already happened by the time it is noticed, and it cannot be undone.',
  },
  {
    id: 'secrets-not-in-code',
    title: 'Secrets come from a manager at runtime, and can be rotated',
    source: 'OWASP Top 10 (A05 security misconfiguration); AWS Secrets Manager and HashiCorp Vault documentation',
    sourceKind: 'standard',
    concepts: ['encryption', 'authn-authz', 'deployment-safety'],
    nodeTypes: ['secrets_manager', 'kms', 'ci_cd'],
    triggers: ['secret', 'api key', 'credential', 'token', 'password', 'rotate', 'env'],
    rule: 'No credential in source control, in an image, or in a log. Load them at runtime from a secret manager with least-privilege access, and design so rotation is routine — because eventually a key does leak, and the question is only how long the exposure lasts.',
    failure: 'A key committed once is in the history forever; without a rotation path the response to a leak is a rewrite instead of a rotation.',
  },
  {
    id: 'audit-trail-immutable',
    title: 'Privileged and financial actions are recorded append-only',
    source: 'PCI DSS logging requirements; SOC 2 audit-trail expectations',
    sourceKind: 'standard',
    concepts: ['authn-authz', 'observability', 'encryption'],
    nodeTypes: ['audit_log', 'ledger_db', 'iam'],
    triggers: ['audit', 'compliance', 'admin', 'money', 'ledger', 'who did', 'regulated'],
    rule: 'Who did what to which record, when, from where — written to a store the acting service cannot rewrite, retained for the compliance window. Application logs are not an audit trail: they are mutable, sampled and dropped.',
    failure: 'After an incident there is no way to establish what an attacker or a misbehaving admin actually touched, which turns a contained problem into a total-loss assumption.',
  },

  // ---------------- AI systems ----------------
  {
    id: 'llm-guardrail-both-ways',
    title: 'Filter what goes into a model and what comes out',
    source: 'OWASP Top 10 for LLM Applications (prompt injection, insecure output handling); NIST AI Risk Management Framework',
    sourceKind: 'standard',
    concepts: ['prompt-injection-defense', 'eval-gates', 'agent-tool-sandboxing'],
    nodeTypes: ['guardrail', 'llm', 'eval_gate', 'agent_runtime'],
    triggers: ['llm', 'model', 'prompt', 'assistant', 'chat', 'agent', 'rag', 'generate'],
    rule: 'Retrieved documents and user text are untrusted input, not instructions: keep them in a data channel, never concatenated into the instruction channel, and never let model output reach a privileged action without a check. Anything an agent can call must be sandboxed and least-privileged, with irreversible actions gated on a human.',
    failure: 'Text inside a retrieved document tells the model to exfiltrate data or call a tool, and it does — prompt injection is the defining vulnerability class of these systems and there is no prompt that reliably prevents it.',
  },
  {
    id: 'rag-grounded-with-citations',
    title: 'Ground answers in retrieved passages and cite them',
    source: 'Lewis et al., Retrieval-Augmented Generation (NeurIPS 2020); vendor RAG guidance (OpenAI, Anthropic, AWS Bedrock)',
    sourceKind: 'paper',
    concepts: ['rag-retrieval', 'rag-chunking', 'eval-gates'],
    nodeTypes: ['vector_db', 'embedding_svc', 'reranker', 'llm'],
    triggers: ['rag', 'knowledge base', 'docs', 'question', 'answer', 'hallucinat', 'support'],
    rule: 'Answer only from retrieved context, attach the passages the answer used, and refuse when retrieval returns nothing relevant. Retrieval quality dominates output quality: chunk on semantic boundaries with overlap, keep a lexical channel alongside the vector one (hybrid search), and rerank before the model sees anything.',
    numbers: 'Chunks in the 200–800 token range with modest overlap are the common starting point; retrieve broadly (tens of candidates) then rerank to a handful.',
    failure: 'A system that answers from the model\'s own weights invents policies that do not exist, and without citations nobody can tell which answers those were.',
  },
  {
    id: 'llm-eval-gate',
    title: 'A prompt or model change ships behind an evaluation set',
    source: 'Published evaluation practice from model vendors (OpenAI Evals, Anthropic evaluation guidance); NIST AI RMF measure function',
    sourceKind: 'vendor-doc',
    concepts: ['eval-gates', 'deployment-safety', 'observability'],
    nodeTypes: ['eval_gate', 'experiment_platform', 'feedback_store', 'ci_cd'],
    triggers: ['prompt', 'model', 'quality', 'accuracy', 'regression', 'eval', 'improve'],
    rule: 'Keep a versioned set of cases with expected properties, score every change against it, and block the ones that regress. Log real traffic and its outcomes so the set keeps growing from actual failures. Prompts are code and belong under the same controls.',
    failure: 'Without an eval set, "the new prompt seems better" is the entire quality process, and each fix silently breaks two cases nobody tested.',
  },
  {
    id: 'llm-cost-and-caching',
    title: 'Bound model spend with caching, routing and a hard ceiling',
    source: 'Anthropic and OpenAI documentation on prompt caching and token pricing; DeepSeek context-caching guidance',
    sourceKind: 'vendor-doc',
    // Tagged narrowly on purpose: with 'caching' and 'cost-control' in this list it
    // out-ranked genuinely relevant material on any problem that mentioned a budget.
    concepts: ['llm-cost-control'],
    nodeTypes: ['prompt_cache', 'model_router', 'llm'],
    triggers: ['llm', 'inference', 'token budget', 'prompt', 'model spend', 'embedding'],
    rule: 'Put the large stable text at the front of the prompt so provider-side prefix caching applies, cache whole responses for repeated identical inputs, route easy requests to a smaller model, and cap tokens per user and per day. Model spend is the one line item that scales with user enthusiasm rather than user count.',
    numbers: 'Prefix caching cuts the input cost of a repeated prompt by roughly an order of magnitude when the prefix is byte-identical.',
    failure: 'Uncapped inference on a public endpoint is an open invitation: the cost of abuse lands on you, and the first sign is the invoice.',
  },
  {
    id: 'vector-index-freshness',
    title: 'State how the index gets updated, and how stale it may be',
    source: 'pgvector and Pinecone documentation on incremental indexing; ANN index rebuild guidance (HNSW/IVF)',
    sourceKind: 'vendor-doc',
    concepts: ['vector-db-choice', 'rag-retrieval', 'search-indexing'],
    nodeTypes: ['vector_db', 'embedding_svc', 'cdc_connector'],
    triggers: ['vector', 'embedding', 'index', 'update', 'fresh', 'documents change'],
    rule: 'Embeddings are derived data: describe the pipeline that keeps them current, the lag it permits, and what happens on a model change (a new embedding model means reindexing everything). At small scale a vector column in the existing database beats a new dependency.',
    failure: 'A knowledge base that changes hourly against an index rebuilt weekly answers confidently from documents that were superseded — and cites them, which makes it worse.',
  },
];

export const PLAYBOOK_BY_ID: Record<string, PlaybookEntry> = Object.fromEntries(
  PLAYBOOK.map((e) => [e.id, e]),
);

export const PLAYBOOK_IDS: string[] = PLAYBOOK.map((e) => e.id);
