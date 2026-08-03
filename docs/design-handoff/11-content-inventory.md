# 11 — Content inventory

**Use this content in the mockups. Do not write placeholder text.**

Everything here was read out of the running codebase. The copy is already written in the
product's voice, the numbers are already calibrated, and mockups built on real content expose
layout problems that lorem ipsum hides — a five-line finding wraps differently from *"Lorem
ipsum dolor sit."*

---

## Components — real specs

From `client/src/canvas/nodeCatalog.ts`. Format: label · category · colour · capacity per
replica · default replicas · latency · the real hint text.

| Label | Category | Colour | Per replica | Reps | Latency | Hint (use verbatim) |
| --- | --- | --- | --- | --- | --- | --- |
| Web Client | Edge & Traffic | `#e0bd6c` | — | — | — | Where traffic originates — the browser your users actually hold. |
| CDN | Edge & Traffic | `#cfa349` | 200,000 rps | 1 | — | Serves static and cacheable content from the edge, so most requests never reach you. |
| Load Balancer | Edge & Traffic | `#d9b45f` | 50,000 rps | 2 | 1 ms | Spreads traffic over healthy replicas and hides instance failures from callers. |
| API Gateway | Edge & Traffic | `#e3c47a` | 10,000 rps | 2 | 5 ms | One front door: routing, authn, quotas and versioning applied before any service sees the call. |
| WAF | Edge & Traffic | `#c8a555` | 40,000 rps | 2 | 3 ms | Blocks injection, bots and L7 floods at the perimeter, before a request can reach your app. |
| Reverse Proxy | Edge & Traffic | `#b98d31` | 40,000 rps | 2 | 2 ms | Terminates TLS and fronts your origins — routing, compression and connection reuse in one cheap hop. |
| Service | Compute | `#c9703f` | 500 rps | 2 | 40 ms | A stateless unit of business logic you can scale horizontally and deploy on its own. |
| Cache | Data | `#a8b56b` | 80,000 rps | 1 | — | Absorbs hot reads in memory; the hit rate is exactly how much load your database never sees. |
| SQL Database | Data | `#9aa95f` | 3,000 rps | 1 | 8 ms | Transactions, joins and real constraints. Usually your first bottleneck and your first SPOF. |
| Read Replica | Data | `#8d9c54` | 3,000 rps | 2 | 8 ms | Moves read load off the primary and gives it a failover target — reads are slightly stale by design. |
| Message Queue | Async | `#6fa271` | 20,000 rps | 1 | — | Decouples producer from consumer and buffers spikes — the backlog absorbs what capacity cannot. |
| Worker | Async | `#84b586` | 200 rps | 4 | 120 ms | Drains a queue in the background so slow work never blocks a user request. |
| LLM | AI | `#c06a9e` | 20 rps | 1 | 1200 ms | Slow, expensive and non-deterministic per call — cache, stream tokens and cap concurrency. |

**Categories, in palette order:** Edge & Traffic · Compute · Data · Async · Integration ·
Media · AI · Security · Ops · Layout. There are 108 component types in total.

Note the hue logic: the palette walks gold → orange → olive → sage → plum across the
categories, which is why the canvas stays inside the drafting-table warmth no matter what is
on it.

---

## Findings — real copy, verbatim

From `shared/src/compatibility.ts`. This voice is the product's biggest asset. Use these
sentences in the mockups exactly as written; they are the correct length, and their length is a
layout constraint.

**`lb-without-backends`** — the chapter 2 finding, use this one on the micro-step mock:
> Load Balancer balances across one instance — one instance behind a load balancer is an extra
> hop and an extra thing to fail, not redundancy; when that instance dies the balancer keeps
> forwarding to a corpse.

**`stateful-single-replica`**
> API carries "product browse" on a single instance, and it holds state — so losing it is not a
> degraded response, it is the flow being down until someone restores it.

**`client-direct-to-datastore`**
> Put a service or an api_gateway between them: the client calls an authenticated endpoint you
> own, and only that endpoint talks to the store.

**`cache-as-system-of-record`**
> Nothing durable sits behind Cache, which makes it the system of record — and a cache is
> allowed to forget: one eviction, one restart, and that data is gone with no way to rebuild it.

**`queue-without-consumer`**
> Message Queue accepts messages and nothing consumes them, so it is a buffer that only ever
> fills — the work is not deferred, it is discarded once the depth limit is reached.

**`queue-without-dlq`**
> Message Queue has consumers but nowhere to put a message they cannot process, so the first bad
> payload is retried forever at the head of the queue — or dropped silently, which is worse
> because nobody finds out.

**`cdn-behind-app`**
> CDN sits behind Service, so every byte is served by your own compute before the CDN ever sees
> it — the edge cache is downstream of the thing it was supposed to shield.

**`read-after-write-on-replica`**
> The flow 'product browse' reads from Read Replica, a follower, while this design also writes. A
> user who reads straight after their own write can be served a copy that has not caught up yet.

**`orphan-node`**
> Cache is on the canvas but nothing connects to it and no flow names it, so it plays no part in
> the design as drawn — a reviewer cannot tell what you meant it to do.

**`no-flows-declared`**
> No flows are declared, so this is an inventory of components rather than a design — nothing
> states what actually happens when a user does something.

**`no-observability`**
> 9 components and nothing collecting metrics, logs or traces — when this misbehaves in
> production the fastest available answer will be a guess.

**`overengineered-for-scale`**
> 7 separate services for a peak of 900 rps — every one of them is a deploy, a dashboard, a
> network hop and a partial-failure mode you are paying for with no load that requires them.

Other real rule ids for locked/advanced content: `sync-into-queue` ·
`datastore-calls-service` · `replication-between-unlike-stores` ·
`serverless-direct-to-pooled-store` · `search-index-written-synchronously` ·
`warehouse-on-user-path` · `no-auth-boundary` · `llm-without-guardrail` ·
`llm-no-cost-ceiling` · `vector-db-without-embedder` · `pii-unencrypted-third-party`.

---

## The chapter ladder

Proposed content for the seven chapters. Concept ids and rule ids are real; the step titles are
the authoring brief.

| # | Chapter | Promise line | Concepts | Findings the steps clear |
| --- | --- | --- | --- | --- |
| 1 | One box, one problem | What "in production" actually means, and what dies when there is only one of something | `spof`, `capacity-estimation` | `stateful-single-replica`, `orphan-node` |
| 2 | Two of everything | Why a second copy is worthless without something in front of it | `load-balancing`, `redundancy` | `lb-without-backends`, `stateful-single-replica` |
| 3 | Don't ask twice | How to stop asking the database the same question | `caching`, `cache-aside` | `cache-as-system-of-record` |
| 4 | Bytes don't belong in your app | Why images should never touch your own compute | `cdn`, `blob-storage` | `cdn-behind-app` |
| 5 | Work you can do later | How to accept work now and finish it afterwards | `queue-backpressure`, `async` | `queue-without-consumer`, `queue-without-dlq` |
| 6 | The database is the hard part | Reads and writes want different things | `replication`, `consistency-models` | `read-after-write-on-replica` |
| 7 | Nobody is watching | Why you cannot fix what you cannot see, and who is allowed in | `observability`, `authn-authz` | `no-observability`, `no-auth-boundary` |

Chapter 7's checkpoint is the real lab **"The One-Box Storefront"**, which already exists in the
product.

## A real micro-step — chapter 2, step 3

Use this on the micro-step mockup.

- **Brief:** *"Your API is one instance. Traffic tripled this morning."*
- **Canvas as given:** Web Client → API (94% utilised) → SQL Database (31%), plus a dashed gap
  below the API.
- **Palette:** Load Balancer · API (second replica) · Cache *(locked, ch.3)* · CDN *(locked, ch.4)*
- **Findings:** `stateful-single-replica` (open), `lb-without-backends` (open)
- **Gate:** `Morning surge — FAIL · 34% dropped (max 1%)`
- **Budget:** `$412 / $900`

## Concept groups — the radar's eight axes

Traffic & Edge · Scaling & Data · Consistency & Transactions · Async & Messaging · Reliability ·
Security · Operations & Cost · AI Systems

45 concept cards live across these groups. Real concept ids for chips: `spof`, `caching`,
`cache-aside`, `cdn`, `blob-storage`, `load-balancing`, `capacity-estimation`, `replication`,
`consistency-models`, `queue-backpressure`, `saga`, `idempotency`, `authn-authz`, `exactly-once`,
`webhook-reliability`, `circuit-breaker`, `prompt-injection-defense`, `llm-cost-control`,
`rag-retrieval`, `overengineering-avoidance`.

## Real problem titles — for the cockpit grid

| Level | Title | Domain |
| --- | --- | --- |
| 1 | Read-Heavy Product Catalog API | e-commerce |
| 1 | User Image Upload and Delivery | media |
| 1 | Paginated Activity Feed API | social |
| 1 | Page-View Counter for Publishers | analytics |
| 2 | URL Shortener at 50k RPS | infrastructure |
| 2 | Session Store for a Logged-In Product | infrastructure |
| 2 | Realtime Leaderboard for a Mobile Game | gaming |
| 2 | Team File Sharing with Shareable Links | productivity |
| 3 | Flash-Sale Checkout Without Overselling | e-commerce |
| 3 | Outbound Webhook Delivery Platform | infrastructure |
| 3 | The Payment Charge Path | fintech |
| 3 | Seat Reservation for Live Events | ticketing |
| 1 | Lab: The One-Box Storefront | e-commerce |

25 hand-written problems span six levels, plus labs.

## Real scenario names — for gate chips

`tv-spot-spike` · `cache-down` · `dinner-rush` · `worker-loss` · `viral-burst` ·
`aggregator-stall` · `campaign-blast` · `shard-loss` · `login-storm` · `tournament-peak` ·
`download-spike` · `drop-moment` · `provider-slow` · `psp-degraded` · `queue-loss` ·
`enterprise-onboarding` · `host-lost`

Display names are human: *Morning TV slot*, *The box reboots*, *Enterprise onboarding*.

**Gate chip string format — always state what happened and what was allowed:**

```
⬢ TV spot spike — FAIL · 34% dropped (max 1%)
⬢ TV spot spike — PASS · 0.2% dropped (max 1%)
⬡ The box reboots — not run
⬢ Friday peak — FAIL · p99 612ms (max 300ms)
```

Never a bare `FAIL`.

## Real numbers for mockups

Taken from the existing level-1 lab, so they hang together:

```
peak            900 rps
writes           25 rps
p99 budget      300 ms
image egress    1.2 TB/month
availability    99.9% — currently nowhere near it
budget          $180/month → at most $900/month
team            two engineers, neither has run a database failover
spike           12× for 30 minutes, scheduled
```
