# Dynamic simulation: traffic that starts somewhere and ends somewhere

Design, 2026-07-31.

## What is wrong today

`simulate()` walks **hand-authored step lists**. A `Flow` carries an `rps` number
and an ordered array of node ids, and the engine visits those ids in order. Three
consequences, which are exactly the complaints:

- **The slider multiplies an abstraction.** `rpsMultiplier` scales the number typed
  into a flow. Nothing enters the system and nothing leaves it, so the edges drawn
  on the canvas carry no load and a wrong connection is invisible to the test.
- **Every component has the same seven knobs.** One flat `NodeAttrs`
  (`capacityRps`, `replicas`, `latencyMs`, `cacheHitRate`, `queueDepthMax`,
  `multiAz`, `monthlyCost`) serves all 108 types. 43 types — including
  `load_balancer` — expose `multiAz`, which is not a decision anyone makes about a
  managed load balancer.
- **Cost is an opinion.** `monthlyCost` is typed by hand and summed. Changing
  replicas, storage or redundancy does not change it.

## The model

### Sources and sinks

A **source** emits traffic. A node is a source when it is marked one, or when its
type can originate traffic (`client`, `mobile_client`, `scheduler`,
`batch_scheduler`, `change_feed`, `webhook_dispatcher`) and nothing connects into
it. Each source has an emission rate in rps; the slider multiplies every source.

A **sink** is where a request's journey ends: a node with no outgoing
request-carrying edge, or one marked terminal. Replication edges never carry
request traffic — a follower receiving writes is not a request path.

Paths are **derived** from the edges, never authored. Named `Flow`s stay for the
brief, the grader and the export, but they no longer drive the simulation.

### Propagation

Each family decides what a component does with the traffic arriving at it:

- **Routers distribute.** A load balancer, CDN, DNS, gateway or proxy splits its
  arrivals across its outbound edges — by explicit edge `share` when set, evenly
  otherwise. One outbound edge means pass-through.
- **Compute fans out.** A service calling auth, a cache and a database calls each
  of them once per request, so every outbound edge receives the full arrival rate,
  scaled by edge `share` when only some requests need that call.
- **Caches absorb.** The edge from a cache to its origin carries
  `(1 - hitRate)` of arrivals. A dead cache is **bypassed**, not fatal: it passes
  traffic through and the origin then receives the full volume, which is the
  thundering-herd lesson.
- **Queues buffer.** The outbound edge carries what consumers can pull; the rest
  becomes backlog until `queueDepthMax`, then sheds.

### Solving it

1. **Offered load.** Depth-first from every source, with a per-path visited set so
   cycles terminate, accumulating arrival rates per node. This alone answers "this
   database is offered 8k rps".
2. **Service factors.** Each node can serve `min(1, capacity / offered)` of what
   arrives. Reduced throughput upstream lowers offered load downstream, so iterate
   to a fixed point — monotone decreasing, so it converges in a few rounds, and
   bounded so it always terminates.
3. **Latency.** After convergence, per-node latency is its base service time
   amplified by its utilisation. A path's latency sums its synchronous hops; an
   async edge ends the caller's wait, so work behind a queue does not inflate the
   response the user sees.

Deterministic and pure, like the engine it replaces: same graph and config always
produce the identical result, with no clock and no randomness.

## Parameters per family

A minimal common ground — `replicas`, `latencyMs` — plus what actually applies:

| Family | Parameters beyond the common ground |
| --- | --- |
| `origin` | emission rps, think time |
| `routing` | capacity rps, egress GB (no `multiAz`: a managed router is redundant by construction) |
| `compute` | vCPU and memory per replica, autoscale ceiling, capacity rps |
| `datastore` | storage GB, shards, read replicas, `multiAz` |
| `cache` | memory GB, hit rate |
| `messaging` | queue depth, consumers, retention hours |
| `external` | latency, price per million calls, rate limit |
| `ai` | tokens per request, price per 1k tokens, concurrency |
| `control` | off the request path: cost only |

`multiAz` exists only where zone placement is a real decision — datastores and
self-managed compute.

## Cost, calculated

Cost has a provisioned part and a usage part, and the usage part comes from the
simulation, so load and cost move together:

- compute: `replicas x (vCPU x rate + GB x rate)`, doubled for multi-AZ
- datastore: instances x base + `storageGb x rate`, doubled for multi-AZ
- cache: `memoryGb x rate x replicas`
- messaging, external, ai: monthly requests derived from simulated rps x unit price
- routing: base + egress

Rates live in one provider-neutral table, rounded and cited as approximate. A
hand-typed `monthlyCost` becomes an override, shown as such, so existing sheets
keep their numbers.

## Showing the failure

- Per-node utilisation on the canvas, the shed traffic labelled, and the
  first failing hop pinned with one sentence saying why.
- A trace listing each derived path: offered, completed, lost, and where.
- Particle density driven by real simulated rps, stopping at the failure.

## Agent-generated edge cases

The model proposes, the engine judges. `POST /scenarios/generate` asks the LLM for
scenarios as **structured configs** — name, hypothesis, load multiplier, nodes to
kill, latency to inject, parameter overrides, what it expects to break, and the
pass criterion. Node ids are validated against the graph. The local engine then
runs each one deterministically and reports pass or fail with the trace. No LLM
call is involved in running a test, and the same scenario always gives the same
verdict.

## Migration and testing

`simulate()` keeps its signature and result shape, implemented on top of the new
engine, so the grader, the scenario gates and the checks panel keep working while
the UI moves over. Source emission falls back to the rps on existing authored
flows, so old sheets simulate sensibly without being edited.

The 30 existing engine tests encode the old contract (flows drive the model).
Those that assert domain truths — cache bypass degrades rather than kills,
determinism, no input mutation, SPOF and backpressure findings — are kept and
re-pointed at the new engine. Those that assert "the authored step list is what
runs" are replaced by tests of the new contract: traffic enters at a source, splits
at a router, fans out at a service, is absorbed by a cache, sheds at a saturated
hop, and terminates at a sink.

## Order of work

1. The engine: sources, sinks, propagation, the slider that drives it.
2. Parameters per family and calculated cost.
3. The failure visualisation.
4. The agent's scenarios and edge cases.

Each lands as its own commit.
