# Engine realism: mechanisms that are documented but not implemented, and numbers with a source

Design, 2026-08-03.

## What is wrong today

The load engine gets the big shapes right — Little's law for capacity, retry
geometric sums, autoscaling that arrives late, backlog that carries between ticks,
a dead cache that is bypassed rather than fatal. What follows is not a rewrite. It
is the list of places where the engine says one thing and does another, plus the
one dimension it omits entirely.

**A caller's capacity does not depend on its dependencies.** This is the largest
gap. `perReplicaCapacity(node, serviceMs)` reads only that node's own
`latencyMs`. Nothing propagates a downstream component's response time back into
its caller's occupancy. The mechanism is nonetheless asserted in three places:
`CONCURRENT_REQUESTS_PER_VCPU`'s comment ("a dependency getting slower costs a
service throughput it never used"), the `concurrency` param hint ("the ceiling a
slow dependency eats into"), and a test named "loses capacity when a dependency
slows it down" which in fact edits the *caller's own* service time by hand. Slow
the payment gateway to 4s — the twist the problem bank ships — and the checkout
API's capacity does not move.

**M/M/1 queueing is applied to multi-replica pools.** `waitMultiple(u)` is
`1/(1-u)`, a single-server formula, applied regardless of replica count. A
twenty-replica group at 90% utilisation reports the same ten-fold latency
multiple as one replica at 90%. This penalises exactly the horizontally-scaled
designs the tool wants to reward.

**p99 is a fudge factor.** `latency x (2.5 + 2u)` is not a percentile of any
distribution. It is a plausible-looking curve.

**The network does not exist.** `GraphEdge` has no latency, no placement, no
region. Same-AZ, cross-AZ, cross-region and cross-internet hops all cost zero
milliseconds and zero dollars. A multi-region active-active design is free to
draw.

**Bandwidth does not exist.** `cost.ts` has no egress rate, so the line that is
frequently largest on a real CDN, media or blob-heavy invoice is absent.

**Cache size is collected and ignored.** `memoryGb` is a cache parameter whose
hint promises "too small and the hit rate you assumed never materialises".
`absorbOf` reads only `cacheHitRate`.

**Connection pools are not modelled.** `connection_pooler` and `db_proxy` are
types carrying an rps number. Pool exhaustion — fifty service replicas holding
twenty connections each against a hundred-connection Postgres — is among the most
common real outage modes and is invisible.

**Reads and writes are not distinguished.** `FlowKind` knows `read` from `write`;
the engine's routing does not, so a `read_replica` absorbs writes.

**Three hundred and thirty numbers have no source.** `DEFAULT_CAPACITY`,
`DEFAULT_LATENCY` and `DEFAULT_COST` are hand-set. The README states that grader
findings must cite the playbook and that invented citation keys are discarded
server-side. The capacity model, whose output the grader is instructed to treat
as fact, has no equivalent discipline.

## Approach

Extract a physics kernel of pure, independently testable modules, leaving
`engine.ts` as the tick orchestrator it wants to be. Then replace the hand-set
catalogue with dated, cited snapshots of published data.

Live API calls at simulation time are rejected. The engine's contract — pure,
deterministic, offline, free on every keystroke — is what lets scenario gates
re-evaluate live and lets the grader treat the numbers as facts. Ingestion runs
by hand, writes committed JSON, and never executes at build or request time.

```
shared/src/
  engine.ts        orchestrator only
  queueing.ts      utilisation + servers -> wait, p50, p99
  network.ts       placement -> RTT ms
  pools.ts         demand + pool size -> admitted, queued, rejected
  catalog.ts       type -> { value, source, measuredAt, confidence }
  data/*.json      generated snapshots, committed, dated
  calibration/     real published systems as graphs with expected ranges
scripts/ingest/    one script per source; run by hand
```

No module below `engine.ts` sees a `GraphDSL`. Each takes plain numbers and
returns plain numbers, which is what allows it to be tested against a
known-correct answer rather than only through a whole drawing. `catalog.ts` is
the only module that reads `data/`. `components.ts` keeps its behavioural
type-sets (`QUEUE_TYPES`, `STATEFUL_TYPES`, `SHEDDING_TYPES`,
`REPLICA_SUBSTITUTES`) and loses only the three numeric tables; those sets encode
behaviour, not measurements.

No discrete-event simulation, no sampling, no RNG. Every mechanism stays a
closed-form expression.

## The mechanisms

### Occupancy

A caller holds a worker for its own work plus everything it synchronously waits
on:

```
occupancy(n) = serviceMs(n) + sum over synchronous out-edges e of
                 share(e) x ( rtt(e) + responseTime(target(e)) )
capacity(n)  = concurrency(n) / occupancy(n) x replicas x shards
```

`responseTime(target)` is the target's *full* latency including its own queue
wait, not its bare service time — the caller waits for the whole response.
Asynchronous edges contribute nothing, because past a hand-off nobody is
waiting.

This is a fixpoint: capacity depends on downstream latency, which depends on
downstream utilisation, which depends on arrivals, which depend on upstream
capacity. It is solved inside the existing `RELAX_ROUNDS` loop, which already
resolves the same shape of mutual dependency for retry amplification.

Two guards. Cycles use a visiting-set, exactly as `succeedsAt` already does.
Runaway is bounded by clamping occupancy at the caller's timeout: a caller that
gives up at 2s does not hold a worker for 8s. The clamp is physically correct as
well as numerically necessary — and the loop must remain *able* to spiral,
because that spiral is the cascading failure the tool exists to teach.

Convergence within `RELAX_ROUNDS` is asserted by test. If deep chains need more
rounds, the constant is raised and the reason recorded.

### Erlang-C

```
c = concurrency x replicas          parallel service channels
a = c x u                           offered load in erlangs
C = ErlangC(c, a)
responseMultiple = 1 + C / (c(1-u))
```

`C` is computed through the iterative Erlang-B recurrence
`B(k) = a.B(k-1) / (k + a.B(k-1))`, not factorials: `c` reaches into the
thousands and `a^c/c!` overflows immediately.

At `c = 1` this reduces exactly to `1/(1-u)`, so single-replica components are
unchanged. At large `c` the knee moves right and sharpens, which is the honest
shape: a 640-slot pool at 80% utilisation has almost no queueing.

p99 becomes:

```
p99  = serviceMs x tailIdle + Wq99
Wq99 = ln(C / 0.01) / (c.mu.(1-u))     when C > 0.01, else 0
```

`Wq99` is the true 99th percentile of M/M/c waiting time. `tailIdle` remains an
empirical constant at 2.5, representing service-time variability — garbage
collection, scheduling, jitter — for which no closed form exists. It is labelled
an estimate rather than presented as derived.

Kingman's G/G/c correction for bursty arrivals is deliberately excluded. M/M/c
assumes Poisson arrivals, which is optimistic, but the scenario system already
models burstiness explicitly through `spike` and `burst` traffic shapes;
a second implicit burstiness factor would double-count it.

### Network

`GraphEdge` gains `placement`, defaulting to `same-az`.

| placement | RTT | confidence |
| --- | --- | --- |
| `same-host` | 0.05 ms | estimate |
| `same-az` | 0.5 ms | documented |
| `cross-az` | 1 ms | documented |
| `cross-region` | region-pair matrix | measured (cloudping.co) |
| `internet` | 40 ms | estimate |

RTT is added to the caller's latency on every synchronous hop, and — through
occupancy — consumes the caller's concurrency. A cross-region synchronous call
does not merely add milliseconds to p99; it costs the caller worker-time per
request, which is where multi-region active-active actually hurts.

Cross-region RTT is looked up by the `region` attribute on each node when both
ends state one, falling back to a single default otherwise.

### Connection pools

`connection_pooler` and `db_proxy` gain `poolSize`; datastores gain
`maxConnections`.

```
connectionsNeeded = arrivals x occupancy / 1000
```

Above `poolSize`, requests queue for a connection under the same M/M/c treatment
with `c = poolSize`, and fail past the acquire timeout.

This generalises the shared-host block already in `runEngine`, which computes
demand in concurrency-seconds against a supply of slots. `pools.ts` absorbs both,
so `engine.ts` gets shorter rather than longer.

### Read/write split

`GraphEdge` gains `carries`, one of `read`, `write` or `both`, defaulting to
`both`. A write flow arriving at a router splits only across edges that carry
writes.

Replication lag is handled in `compatibility.ts` as a structural finding — "this
read-after-write path reads from a replica" — not in the engine. The engine
reports capacity and latency; staleness is a correctness property, and the rule
engine is where correctness findings already live.

### Cache sizing

Caches gain `workingSetGb`. When stated:

```
coverage       = min(1, memoryGb / workingSetGb)
achievableRate = coverage ^ 0.5
effectiveRate  = min(statedHitRate, achievableRate)
```

The exponent encodes that hot keys are hit disproportionately, so 10% coverage
still buys roughly a 32% hit rate. This is a modelled heuristic, labelled as one
in the Inspector, not a measurement. When `workingSetGb` is absent the stated
rate applies unchanged, so no existing design moves.

### Egress

`GraphEdge` gains `payloadKb`. `cost.ts` gains egress rates from `pricing.json`:
roughly $0.09/GB to the internet, $0.01/GB cross-AZ each way, $0.02/GB
cross-region. Billed against the traffic the run actually carried, consistent
with every other line in that module.

## Schema changes

`NodeAttrs` gains `workingSetGb`, `poolSize`, `maxConnections`, `region`.
`GraphEdge` gains `placement`, `carries`, `payloadKb`.

Every field is optional and defaults to current behaviour, so stored graphs load
unchanged and no database migration is required. Occupancy and Erlang-C apply
unconditionally and will change verdicts for existing designs; that is intended.

Node fields are wired into `PARAMS_BY_FAMILY` in the usual way. Edge fields need
a surface in the connection inspector, which already exists for routing, kind,
share and retries.

`SimResult` gains two things its readers must tolerate: a provenance record on
each node's derived defaults, and an egress line in `CostReport`. Both are
additive. The grader, the scenario gates, the checks panel and the canvas all
read `SimResult`, so nothing existing in that shape changes.

## Provenance

Catalogue lookups return a value with its origin:

```ts
interface CatalogValue {
  value: number;
  source: string;        // "benchANT" | "AWS Service Quotas" | "estimate"
  detail?: string;       // "Postgres 16, db.r6g.2xlarge, YCSB-A"
  measuredAt?: string;   // "2026-05"
  confidence: 'measured' | 'documented' | 'estimate';
}
```

Most of the 330 numbers begin as `estimate`. That is the honest starting state,
not a failure: it makes the guesswork visible and produces a ranked backlog of
numbers worth sourcing. The Inspector's existing "shows its arithmetic" panel
displays the confidence tier alongside each default.

Ingestion scripts, one per source, each writing a dated JSON with a header
recording fetch date, source URL and licence:

| script | source | output | licence |
| --- | --- | --- | --- |
| `vantage.ts` | instances.vantage.sh API (free, email key) | `pricing.json` | to verify |
| `aws-quotas.ts` | AWS `list-aws-default-service-quotas` | `quotas.json` | to verify |
| `cloudping.ts` | cloudping.co API | `network.json` | to verify |
| `clickbench.ts` | ClickBench published results | `capacity.json` | Apache-2.0 |

Only ClickBench's licence has been confirmed. Each remaining source's terms are
checked before its script is written, and the finding is recorded in
`data/README.md` next to the fetch date. A source whose terms turn out to
prohibit redistribution takes the same route as benchANT below: cited manual
calibration, not vendored data.

benchANT's database ranking is the best available source for datastore
throughput and p95 latency, but it is licensed CC BY-NC-SA and will **not** be
vendored into this Apache-2.0 repository. It is used as a cited manual
calibration reference, recorded in `data/README.md` with attribution, and the
resulting numbers carry `confidence: 'documented'`. Facts are not copyrightable
but a compiled database can carry rights, and the licence signals intent clearly
enough that the ambiguity is not worth taking on.

TechEmpower was discontinued in March 2026. Its archived `results.json` is
vendored as a frozen snapshot labelled with its final round and date — better
than a guess, and it will not go further out of date.

## Calibration

`calibration/systems.ts` holds five to eight real published systems as graphs
with expected *ranges*:

- an idempotent payment write path with a third-party gateway
- a high-fanout read path against a wide-column store
- a public cloud reference architecture with documented service quotas
- a single-primary relational read path
- a RAG query path with published model time-to-first-token and throughput
- an egress-heavy media delivery path, for the cost model

Each entry is deliberately described by its shape rather than by a company name.
A system only enters the suite once a public, citable source for its numbers has
been found and recorded alongside it; a system whose figures cannot be sourced is
dropped rather than estimated, since an invented ground truth is worse than none.

Assertions are order-of-magnitude, not precision: the right component must be the
bottleneck, and p99 and monthly cost must land within a factor of three.

Alongside these are **ordering assertions**. For each system, a deliberately
worse variant must score worse. This is the property the tool actually claims,
and it holds even where absolute numbers are uncertain.

The suite is written and run against the *current* engine first, and that
baseline is committed. Every subsequent change is then measured as movement
toward or away from ground truth, rather than merely as difference.

## Testing and fixtures

Each module is unit-tested against a known-correct answer: Erlang-C against
published Erlang tables, network RTT against the committed snapshot, pool
admission against Little's law, occupancy against hand-worked chains.

A differential run compares every blueprint and every problem scenario before and
after. Each changed verdict is justified in the diff. Existing numeric
expectations in `engine.test.ts` and `simulate.test.ts` will churn; each updated
expectation carries a one-line reason, because silently re-baselining tests is
how a model erodes.

Blueprints are re-tuned so they still arrive un-broken at their declared load —
a starting position must not be broken on arrival. Problem scenario gates are
left at their current thresholds; they are meant to be hard, and designs
becoming harder to pass is acceptable.

`FAKE_LLM=1` must still carry the whole loop end to end.

## Phasing

Phase 1 changes verdicts and needs no external data: occupancy, Erlang-C,
network placement, connection pools, plus the module extraction and the
calibration baseline. It is shippable alone.

Phase 2 adds read/write split, cache sizing, egress, the catalogue with
provenance, and the ingestion scripts.

## Risks

**Erlang-C makes designs more forgiving.** Removing the M/M/1 penalty on
multi-replica pools will lower latency across most designs, and some problem
gates may become trivially passable. Retuning gates is out of scope by decision;
the differential run reports which gates are affected so the choice can be made
with evidence.

**Occupancy may not converge in eight relaxation rounds.** Deep synchronous
chains create a longer fixpoint. The timeout clamp bounds it, and a convergence
assertion in the test suite catches the case where the bound is doing more work
than it should.

**Network and occupancy together make nearly every design slower.** p99 gates
will fail broadly at first. This is more accurate than what came before, but it
will feel like a regression, and the differential review is where each case is
judged rather than waved through.

**The catalogue's honesty is visible.** Labelling most defaults as estimates is
correct but exposes how much of the model rests on judgement. That is the point,
and it should not be softened by inflating confidence tiers.
