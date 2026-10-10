# Spec: Request-level simulation engine (DES) for Loadbearing

Date: 2026-10-10
Status: Phases 0–2 done; phase 2b next
Revision: 2 — review folded in (section 13 lists what changed and why)

Read `docs/HOW-LOADBEARING-WORKS.md` first. Read `loadtest/RESULTS.md` second.
Work test-first, as the repo already does: write the failing test, see it fail for
the stated reason, then fix.

---

## 1. Why

The first calibration (`loadtest/RESULTS.md`) compared the engine with a real stack
(nginx → Node → Redis 80% hit + Postgres, run with k6):

| | Starts dropping | p99 at ~30% load |
| --- | --- | --- |
| Real stack | ~7,000 rps | ~2–5 ms |
| Engine, sizes only | 165 rps (40× low) | 128 ms (50× high) |
| Engine, sizes + measured service times | 5,250 rps | 5.7 ms |

Three problems were found:

1. **Defaults are far off.** `service` defaults to 40 ms. A thin Node handler is ~0.4 ms.
2. **Wrong model for event-loop servers.** The engine holds one slot for the whole
   request, including the time spent waiting on Redis/Postgres. Node does not hold
   anything while it waits. Its limit is CPU time per request. The near-right
   answer in row 3 is a coincidence.
3. **Connection ceiling picks the wrong limit.** With both `maxConnections` (100) and
   `poolSize` (10) stated, the engine uses 100. The binding limit is the smaller one.

The current engine (`runEngine`) works with rates per second and Erlang-C formulas.
That is fast, but it cannot show effects that come from single requests meeting each
other: bursts inside one second, timeouts that chain, retry storms, connection-pool
waits. We add a second engine that follows each request.

### 1.1 The CPU figure is not one number

`RESULTS.md` gives three figures that do not agree:

- 0.16 ms CPU per request (16% of a core at 1,000 rps) → ceiling 6,250 rps.
- 90% of a core at 5,000 rps → 0.18 ms per request → ceiling ~5,550 rps.
- The real stack held 7,000 rps at 99.2% ok — above both ceilings.

So CPU per request **falls as load rises** (syscalls and parsing amortise across a
busy event loop). A fixed `cpuMs` gives a hard ceiling of `cores ÷ cpuMs`, and can
only match the real knee if `cpuMs` is tuned to it. The reality baseline (test 8)
therefore uses the low-load figure, 0.16 ms, and says so in its test name. Before
tightening its tolerance, re-run the lab with an uncounted warm-up step and three
repeats, and record CPU per request at every step.

## 2. Decision

Options considered:

- **A. Only fix the current flow engine.** Cheapest. Still cannot show request-level
  effects (retry storms, chained timeouts).
- **B. Replace the flow engine with a request engine.** Most faithful, but loses the
  instant feedback while drawing, and is a big-bang change.
- **C. Keep both (chosen).** Flow engine = instant preview while drawing.
  Request engine = the answer when the user presses Play. Both read the same
  `GraphDSL` and return the same result shape. Tests compare them.

Chosen: **C**, built in phases, behind a flag, starting with a few part families.

## 3. Goals and non-goals

Goals:
- A deterministic, seeded, request-by-request discrete-event engine in `shared/`.
- Same input (`GraphDSL` + scenario) and same output shape as `runEngine`, so
  `simulate()`, the canvas, gauges and cost meter need no change.
- Correct runtime model: async (event-loop) vs thread-pool compute.
- Reproduce the real stack from `RESULTS.md` within the tolerances in section 9.

Non-goals (for now):
- Replacing `runEngine`.
- All 109 types. Start with the families listed in section 6.
- WebAssembly / Rust. Only if the benchmark in section 8 fails.
- New UI, apart from running the new engine on Play.

## 4. Repo constraints to respect

- `shared/` has no React and no HTTP. It runs the same in browser and server.
- No new dependency in `shared/`. The seeded RNG and the heap are small; write them
  in-house.
- The tripwire test (`shared/src/calibration/baseline.json`) must keep passing for
  the flow engine. The request engine gets its own baseline.
- Engine tests use numbers that can be checked by hand.

## 5. New part attributes

Add to `NodeAttrs` (optional, with defaults in `defaults.ts`, labels in `params.ts`):

| Key | Meaning | Applies to |
| --- | --- | --- |
| `runtime` | `'event-loop' \| 'thread-pool' \| 'serverless'` | compute, ai |
| `cpuMs` | CPU time one request uses on this part (not wall time) | compute, ai, datastore |
| `latencyP99Ms` | Optional. With `latencyMs` (median), defines the spread of service time | all serving families |

Meaning:
- `latencyMs` stays as "own work per request at zero load, median" (wall time).
- `cpuMs` is the part of that work that holds a CPU core. The rest of `latencyMs`
  (`latencyMs − cpuMs`) is a **pure delay that holds nothing** — no core, no slot
  beyond what the runtime already holds.
- If `cpuMs` is unset, use `latencyMs` (all of the work is CPU) and record an
  assumption.
- **When CPU is spent:** half of `cpuMs` before the first dependency call, half after
  the last reply. With no dependencies, all of it in one piece.
- Service time is sampled from a **log-normal** with median `latencyMs`. Draw **one**
  factor per visit and scale both `latencyMs` and `cpuMs` by it, so a slow request is
  slow in CPU too. If `latencyP99Ms` is unset, use a default spread
  (`p99 / median = 2.5`, the same `TAIL_MULTIPLE_IDLE` the flow engine uses) and
  record it in `assumptions[]`.

**`event-loop` means an async runtime that can use all of `vcpu`** (Node cluster, Go,
Netty, Python asyncio with workers). One plain Node process uses one core whatever
`vcpu` says; model that as `vcpu: 1` per replica. The label in `params.ts` says this.

**Defaults (decided):**
- `runtime` for `service`: **`thread-pool`**. It is today's model (slot held for the
  whole request), so existing problem results only move where the new CPU limit
  binds. Event-loop is chosen explicitly.
- `cpuMs` for `service`: **2 ms**, listed in `assumptions[]` as a middle value
  between the measured 0.4 ms minimal handler and a heavy app. Replace it with a
  measured heavier handler from the reality lab later.

## 6. Engine design

### 6.1 Files

```
shared/src/des/
  rng.ts        seeded PRNG (mulberry32), no Math.random
  dist.ts       exponential, log-normal (from median + p99), bernoulli
  heap.ts       binary min-heap of events, ordered by time then sequence number
  stats.ts      log-bucket latency histogram, per-second aggregation, percentiles
  model.ts      build runtime parts and edges from GraphDSL (+ scenario)
  parts/        one behaviour file per family: origin, routing, compute,
                datastore, cache, external
  engine.ts     runDes(graph, scenario, { seed }) → same type runEngine returns
  index.ts
```

### 6.2 Core loop

```
clock = 0
put first arrival of each source in the heap
while heap not empty and clock < horizon:
    event = heap.pop()          // earliest time; ties broken by sequence number
    clock = event.time
    handle(event)               // may push new events
```

No fixed ticks inside the loop. Per-second numbers are collected by `stats.ts`
for the timeline (`ticks[]`), so the output matches the flow engine.

### 6.3 Request object

```ts
{ id, flowId, sourceId, startedAt, attempt, stack: Frame[], path?: string[] }
// Frame = { partId, edgeId?, deadline?, waitingFor: number }
```

`stack` holds the call chain, so a reply returns to the right caller.

**Routing follows authored flows.** When the request's flow lists `steps`, the
request follows those steps; edge `share` is used only where no flow says (and for
graphs with no flows). Otherwise per-flow p99 would mix in requests that wandered
off the flow's path (a "write" landing on the read replica).

### 6.4 Event types

`ARRIVE` (new request at a source), `ENTER` (request reaches a part),
`WORK_DONE` (part finished its own work), `CALL` (part calls a dependency),
`REPLY` (dependency answered), `TIMEOUT` (caller gave up), `RETRY`,
`OUTAGE_START` / `OUTAGE_END`, `HEALTH_CHECK`, `SAMPLE` (once per second, for stats).

### 6.5 Behaviour per family (v1)

**origin**: requests arrive as a Poisson process (random gaps, exponential) at
`baseRps × shape(t) × loadMultiplier`, using the existing scenario `patterns`.
If several flows start at one source, pick the flow by its share. The origin is the
**client**, and the client has a give-up time (section 6.6).

**routing**: pick a backend by edge `share` (as probability). Keep sending to a dead
backend until `healthCheckS` passes, then remove it, like the flow engine.

**compute**:
- `event-loop`: `vcpu × replicas` cores with one FIFO run queue. A request holds a
  core only for its CPU pieces (section 5). While it waits on a dependency or on its
  non-CPU delay it holds **no** core and **no** slot.
- `thread-pool`: `concurrency × replicas` slots, held for the whole request,
  including waits on dependencies. **And** `vcpu × replicas` cores: a thread holding a
  slot still queues for a core for its CPU pieces. Capacity is therefore
  `min(slots ÷ holding time, cores ÷ cpuMs)`.
- Calls per request on an edge: `share` = 4 → 4 calls; `share` = 0.3 → one call with
  probability 0.3; `share` = 2.5 → 2 calls, plus a third with probability 0.5.
  Calls on one request go one after another (sequential) in v1.

**datastore**: `vcpu` servers with a FIFO queue, service time from `dist.ts`.
Connection limit: a caller holds a connection for the whole call. The binding limit
is the smallest stated of `maxConnections` and `poolSize` (both on the store node,
as `types.ts` defines them today — `poolSize` is the pooler in front of the store).
Requests without a free connection wait in a pool queue.
*Later:* a per-caller pool (`poolSize` on the caller, limit
`min(maxConnections, Σ callers poolSize × caller replicas)`) needs the attribute to
move or a new one; that is a separate decision, not v1.

**cache**: hit with probability `cacheHitRate` (respect the existing coverage cap
`√(memory ÷ working set)`). Miss → call its origin. Dead cache → every read goes to
the origin.

**external**: elastic. Service time from `dist.ts` plus `thirdPartyLatencyMs`.
Respect `rateLimitRps` (excess fails).

**messaging, ai, control, boundary**: not in v1. Fall back to the flow engine's
behaviour or skip with a clear `assumptions[]` line. Machines (`sharedHost`) come in
a later phase: members share the machine's cores.

### 6.6 Edges, timeouts, retries

- `sync`: caller waits for the reply. `async`: caller does not wait; the request
  continues on its own (latency of the flow stops at the hand-off, as today).
  `replication`: carries no requests.
- Wire time from `network.ts` by `placement`. `PLACEMENT_RTT_MS` is already a
  **round trip**: add **half** of it on the way out and half on the way back.
- **Timeouts (decided):** if a part has a stated `timeoutMs`, its caller gives up at
  that time and the request fails there. Unstated per-part timeouts never fail
  anything, as in the flow engine. **The client has a give-up time** of
  `CLIENT_TIMEOUT_MS = 30,000` at the source, listed in `assumptions[]`: the person
  using the system is the someone who says how long they will wait. This keeps a
  queue from growing a wait without limit.
- **Retries**: on failure or timeout, the caller retries up to the edge's `retries`
  times. v1 has no backoff (immediate retry), so retry storms are visible. Backoff
  and jitter come later as edge attributes.
- **Bounded queues**: every queue has a limit (`queueDepthMax` or a family default).
  When full, the request is dropped at that part.

### 6.7 Outages and overrides

Use the existing scenario fields: `outages`, `latency`, `overrides`,
`loadMultiplier`, `horizonS`. A dead part fails every request that reaches it.
Requests already inside it when it dies fail.

## 7. Output

`runDes` returns the **same type** as `runEngine`: `ticks[]`, `worst[]`, `final[]`,
`hosts[]`, `failures[]`, `firstFailure`, `peakBacklog`, `retryAmplification`,
`sloBreaches`, `recoveredAtS`, `bottleneckNodeId`, `assumptions[]`.

Mapping notes:
- p50/p99 come from real per-request times, kept in **log-bucket histograms** (2%
  wide buckets) per second, not sorted arrays: bounded memory, no sort, and the
  bucketing removes float noise from the output.
- `utilisation` = busy core-time (or slot-time) ÷ available, per second.
- `capacityRps` per part has no direct DES meaning; fill it from the same
  arithmetic the flow engine uses (servers ÷ service time), documented as such.
- `firstFailure` = the first part (in time) that dropped or timed out a request,
  with a reason in words, like today.
- Cost: reuse `costReport` with the served rates and replicas from the run.

Add `engine: 'flow' | 'request'` to the simulation config. `simulate()` picks the
engine. Default stays `'flow'` until phase 4.

## 8. Determinism and speed

- Same graph + scenario + seed → **byte-identical** result **within one JS engine
  (V8: Node and Chrome)**. Test it. JavaScript does not require `Math.log`/`Math.exp`
  to be bit-identical across engines, and sampling needs both, so Firefox/Safari
  results are compared after the existing output rounding, not byte for byte.
- Different seed → slightly different result. Test it.
- Ties in the heap: break by a sequence number, never by object order.
- **Benchmark (phase 1, before more features):** 7,000 rps for 60 s on the reference
  stack must finish in **under 5 s** in Node on a normal laptop. If it fails, stop
  and report numbers; do not optimise blindly.
- **Scale beyond the benchmark.** The bank has designs at up to 45,000 rps and the
  app runs 150 s (`REPORT_HORIZON_S`): ~80 M events, over 10× the benchmark. Plan,
  decided before phase 4:
  - `maxEvents` budget per run (default sized to ~5 s). When the projected count
    exceeds it, run a **scaled copy**: divide every source rate and every part's
    servers/connections by `k`, keep service times, and multiply served rates back
    by `k`. Utilisation and queueing are preserved for parts with many servers;
    parts with few servers are left unscaled. Say so in `assumptions[]`.
  - Stream `ticks` from the worker as each second completes, so the timeline starts
    playing at once and total run time matters less.
- In the client, run the request engine in a **Web Worker** so the page never freezes.

## 9. Tests (write these first, in this order)

1. **RNG + determinism**: same seed → same sequence; different seed → different.
2. **M/M/1**: one server, Poisson arrivals λ, **exponential** service μ (the
   datastore normally uses log-normal; the test passes a distribution override).
   Mean wait in queue must be close to `λ / (μ × (μ − λ))` for 3 seeds. Run at
   ρ ≈ 0.6 with a warm-up period discarded, long enough (≥ 2 × 10⁵ customers) that a
   ±5% tolerance is honest. Hand check of the formula: λ = 50/h, μ = 60/h → 5 minutes.
3. **M/M/c**: compare mean wait with Erlang-C from `queueing.ts`.
4. **Event-loop capacity**: 1 vCPU, `cpuMs` 0.16, 1 ms wait on a database →
   saturates near 6,250 rps (start dropping between 5,800 and 6,600). "Starts
   dropping" = success below 99% over a 30 s hold, as in the k6 runs.
5. **Thread-pool holds slots**: 1 vCPU, `cpuMs` 0.16, **4 slots**, a 1 ms dependency
   → holding time ≈ 1.16 ms, slot limit ≈ 3,450 rps, below the CPU limit of 6,250.
   (With 8 slots the slot limit is ~6,900 and CPU binds first, so 8 slots cannot show
   it.)
6. **Connection limit**: `poolSize` 10 and `maxConnections` 100 on one store → the
   limit is 10.
7. **Retry storm**: kill the cache at t = 20 s at a load the database can only carry
   with the cache, with a stated `timeoutMs` on the database. Assert that with
   `retries: 2` the attempts reaching the database per offered request (the
   amplification) exceed 1.5, and the requests served end-to-end are **fewer** than
   with `retries: 0`. "Arrivals rise" alone is true after one failure and proves
   nothing.
8. **Reality baseline** (from `loadtest/RESULTS.md`, measured sizes and service
   times, `cpuMs` 0.16 from the low-load measurement — see 1.1): starts dropping
   between 6,000 and 7,500 rps; p99 at 3,000 rps within 2× of the measured 5.4 ms.
9. **Flow vs request**: run both engines on every built-in problem and blueprint.
   Report the differences as a table. Do not fail on this yet. Expect large gaps
   where defaults differ (`cpuMs`); report them separately from model gaps.
10. **Request-engine tripwire**: snapshot like `calibration/baseline.json`.

## 10. Phases

Each phase is one PR, with its tests green and the tripwire unchanged.

- **Phase 0: fix the flow engine's connection limit** (problem 3). Small, separate.
- **Phase 1: core**. `rng`, `dist`, `heap`, `stats`, core loop, origin + datastore,
  M/M/1 and M/M/c tests, determinism tests, benchmark. Stop and report the benchmark.
- **Phase 2: compute + runtime**. New attributes, event-loop vs thread-pool, cache.
  Tests 4, 5, 6. Reality baseline (test 8) must pass.
- **Phase 2b: runtime fix in the flow engine (decided: yes).** Event-loop capacity
  `= cores ÷ cpuMs` in `runEngine`, checked against the request engine. Without it
  the preview says "fine" while Play says "broken at a 40× lower load". This moves
  the tripwire; read the diff.
- **Phase 3: failures**. Routing with health checks, external, timeouts, retries,
  outages, bounded queues, flow-step routing. Test 7. Output mapped to the
  `runEngine` result type. `engine` flag in the config.
- **Phase 4: in the app**. Web Worker with streamed ticks, event budget and scaled
  copies (section 8). Play uses the request engine; drawing still uses the flow
  engine. Test 9 report. Browser check with a throwaway account.
- **Later**: machines (`sharedHost`), messaging, autoscaling with lag, backoff and
  jitter, per-caller connection pools, ranges from many seeds ("breaks between X and
  Y"), more measured defaults from the reality lab.

## 11. Decisions (formerly open questions)

1. Default `runtime` for `service`: **thread-pool** (section 5).
2. Default `cpuMs` for `service`: **2 ms**, documented; measure later (section 5).
3. Unstated timeouts: **never fail per part; the client gives up at 30 s**
   (section 6.6).
4. Runtime fix in the flow engine: **yes, phase 2b**.
5. Benchmark budget: **5 s is acceptable in a Web Worker with streamed ticks**; high
   rates use the event budget and scaled copies (section 8).

## 12. Done means

- All tests in section 9 pass (test 9 as a report).
- The reality baseline passes for the right reason: the limit at the knee is Node CPU,
  shown in `firstFailure`.
- Same seed gives the same result in Node and Chrome.
- No change to the flow engine's tripwire, apart from phases 0 and 2b.

## 13. What changed in revision 2

| Was | Now | Why |
| --- | --- | --- |
| Test 5 with 8 slots | 4 slots | 8 / 1.16 ms ≈ 6,900 rps > CPU limit 6,250, so CPU bound first |
| Thread-pool = slots only | slots **and** cores | Threads holding a slot still compete for cores |
| Fixed knee "predicted" by 0.16 ms | Section 1.1 | The three CPU figures disagree; CPU/request falls with load |
| `poolSize` "of the caller" | On the store, as `types.ts` defines it | The attribute is the pooler in front of the store today |
| Wire time "added both ways" | Half RTT each way | `PLACEMENT_RTT_MS` is already a round trip |
| Benchmark only | Event budget, scaled copies, streamed ticks | 45,000 rps × 150 s ≈ 80 M events |
| Routing by edge share | Flow steps first | Per-flow p99 needs requests to stay on their flow |
| Byte-identical browser and server | Within V8; rounded elsewhere | `Math.log`/`exp` are not bit-specified |
| `vcpu` cores for event-loop | Defined as an async runtime | One Node process uses one core |
| CPU timing unstated | Half before calls, half after; one sampled factor | Needed to be implementable and consistent |
| M/M/1 at ρ 0.83, log-normal service | ρ 0.6, exponential override, warm-up | Noise at high ρ makes a 5% check flaky |
| Test 7 "arrivals rise" | Amplification > 1.5 and goodput falls | The old assertion is true after one failure |
| Open questions | Decided (section 11) | |

## 14. Phase 1 result (2026-10-10)

- `shared/src/des/`: `rng`, `dist`, `heap`, `stats`, `model`, `engine`; `runDes` exported.
  Every part is a queue of `vcpu × replicas` cores holding a core for its whole own
  work; routers pick one backend by share; calls follow `share`; wire is half the
  round trip each way. Result is `DesResult` (own shape) until phase 3.
- M/M/1 (ρ 0.6, 3 seeds): mean wait 1.498 / 1.516 / 1.502 ms against 1.5 ms.
  M/M/c (c 4, 75%): 0.505 / 0.525 / 0.512 ms against Erlang-C 0.509 ms.
- **Benchmark** (`node scripts/bench-des.mjs`): 7,000 rps × 60 s on the reference
  topology = 420 k requests, 4.87 M events (11.6 per request), best of 3 **1.0 s**
  (runs 1.0–1.4 s), ~4.8 M events/s, 13 MB heap. **Passes the 5 s budget.**
- Projection for section 8: 45,000 rps × 150 s ≈ 78 M events ≈ 16 s at this rate,
  so the event budget and scaled copies are still needed for phase 4.

## 15. Phase 2 result (2026-10-10)

- `NodeAttrs` gains `runtime`, `cpuMs` (a **mean**, as CPU% ÷ rps measures it) and
  `latencyP99Ms`. Defaults live in `des/runtime.ts`, read by both the engine and the
  inspector. `cpuMs` and `latencyP99Ms` are inspector fields; `runtime` has no
  control yet (`ParamKind` has no choice-of-values kind) and is set in JSON, sheets
  or MCP until phase 4.
- A visit: token (thread-pool worker or store connection) → half the CPU on a core
  → the non-CPU rest, holding no core → calls → the other half → token back. One
  log-normal factor per visit scales wall and CPU; CPU is normalised so it averages
  `cpuMs`. Routers, caches and outside services take time and hold no core (v1).
  A fractional vCPU is one core at that speed.
- Until phase 3, overload shows as `completionRatio` < 0.99 (completions ÷ arrivals
  after warm-up), because queues are unbounded and nothing times out.
- Test 4 (event loop): keeps up at 6,200, behind at 6,400; CPU utilisation =
  rps × 0.16 ms (0.928 at 5,800). Test 5 (4-slot thread pool): keeps up at 3,200,
  behind at 3,400 with the core at 53%. Test 6: exactly 200 rps through 10
  connections either way round; 500 with no limit. Cache: misses = 1 − effective
  hit rate, coverage cap respected.
- **Test 8 (reality baseline) passes:** keeps up at 6,000, behind from 6,400 (real
  ~7,000; ~10% low, as section 1.1 predicts from 0.16 ms); Node at 100% CPU is the
  busiest part; p99 at 3,000 rps 4.16 ms against 5.4 ms measured. Postgres is next
  at 78–86% busy, because its whole 0.65 ms is taken as CPU — a measured `cpuMs`
  for it would move that.
- Note: drawn as a thread pool with 8 slots, the same stack also keeps up at 3,000
  rps: 8 ÷ ~0.9 ms of holding is above the 6,250 CPU limit, so CPU binds either way
  here. The baseline checks that the limit is Node CPU; tests 4 and 5 are what
  separate the runtimes.
- Benchmark: 7,000 rps × 60 s, 5.87 M events (14.0 per request), best 0.82 s.
- Checked in the running app with a throwaway account (deleted afterwards): a
  compute part's inspector shows "CPU per request" 2 and "Slowest 1% of own work"
  100 for its 40 ms of own work.
