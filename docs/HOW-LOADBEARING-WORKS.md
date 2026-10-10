# How Loadbearing works

A complete description of the product, its data model, the simulation engine, the
cost model, the checks, the course, the review, and the surrounding platform. Written
so that a person (or an AI session) with no prior context can understand and work on
the project. Numbers and names below are taken from the code as of commit `faa1ff1`
(October 2026); where a value is a default, the file that defines it is named so it
can be checked.

---

## 1. What Loadbearing is

Loadbearing teaches software architecture by doing. A learner draws a system on a
canvas (clients, services, databases, caches, queues, load balancers… 109 typed
parts), connects them with typed connections, declares the journeys requests take,
and then pushes simulated traffic through the drawing. A deterministic engine
reports, per part, how busy it is, its latency, what it drops and what it costs a
month. The learner can turn traffic up to 100×, kill any part, slow a third party, and
watch the design hold or break. Structural rules name mistakes in a teaching voice.
Machine-checked scenario "gates" decide pass or fail. An optional LLM review grades a
finished design against a rubric grounded in a cited playbook.

Two audiences:

- **Learners**: university students and people who build with AI but have never run
  anything in production. They follow a course of short lessons and labs.
- **Practitioners**: engineers who draw the system they actually run, scan their own
  repository into the canvas, connect Claude through the MCP connector, and use the
  simulator to answer "will this survive Monday?"

Principles the whole product follows:

- **Arithmetic before opinion.** Everything that can be computed is computed
  deterministically and shown with its working. The LLM is only ever asked for
  judgement, never for facts the engine already has.
- **Never a blank canvas for a beginner.** Labs and lessons arrive with a working
  system that has one gap or one flaw.
- **Budget is the tension.** Monthly cost is always on screen.
- **No points currency.** Progress is mastery and checkpoints, not scores to farm.
- **Every number has a reason.** Gauges show only what the engine computed or what
  follows from it by a documented formula.

---

## 2. Repository layout and stack

TypeScript monorepo with three npm workspaces plus a Vercel function.

```
shared/     The model: types, catalogue, engine, cost, rules, course, scan.
            No React, no HTTP. Runs identically in the browser and on the server.
server/     Hono HTTP API. Auth, problems, scoring (LLM), designs, projects, notes,
            scan, MCP, OAuth. Storage is SQLite (local) or Postgres (deployed).
client/     React 18 + React Flow canvas + zustand state. Plain CSS on custom
            properties. Vite.
api/        index.ts — the Vercel serverless entry that wraps the Hono app.
docs/       Design specs (docs/superpowers/specs), the design handoff, this file.
data/       Local SQLite database (data/loadbearing.sqlite). Holds real accounts.
scripts/    Ingest and maintenance scripts, run by hand.
```

Key files in `shared/src`:

| File | What it holds |
| --- | --- |
| `types.ts` | Every shared type: `GraphDSL`, `CanvasDoc`, `NodeAttrs`, `Flow`, `Problem`, `SimResult`, `ScoreResult`… |
| `families.ts` | The 109 component types → 10 families. |
| `components.ts` | Per-type defaults: capacity, latency, cache hit rate, queue depth. |
| `params.ts` | Which editable parameters each family offers, with labels and hints. |
| `defaults.ts` | What an unset parameter means, and the placeholder shown for it. |
| `engine.ts` | The tick-by-tick traffic engine (`runEngine`). |
| `queueing.ts` | Erlang-C wait and tail multiples. |
| `pools.ts` | Shared machines and connection pools (Little's law). |
| `network.ts` | Latency and egress by placement (same-AZ, cross-region…). |
| `cost.ts` / `pricing.ts` / `skus.ts` | The bill. |
| `simulate.ts` | `simulate(graph, config)` → `SimResult`: flows, verdict, findings, cost, timeline. |
| `compatibility.ts` | `checkTopology(graph)` → structural findings. |
| `scenarios.ts` | `evaluateAllScenarios(graph, problem)` → scenario gate verdicts. |
| `blueprints.ts` / `doc.ts` / `diagram.ts` | Authored starting architectures, and conversions between document shapes. |
| `course/` | Chapters, steps, gates and the pure judge. |
| `scan/` | Repository → inventory, dependencies, endpoints, exposure findings. |
| `playbook.ts` / `retrieve.ts` | The cited reference corpus the review is grounded in. |
| `calibration/` | The snapshot ("tripwire") baseline every engine change is checked against. |

Commands: `npm run dev` (all three, client on 5173, server on 8787), `npm test`,
`npm run typecheck`, `npm run build`.

---

## 3. The core objects

### Parts (nodes)

A part is a `GraphNode`:

```ts
{ id, type: ArchNodeType, label, annotation, attrs: NodeAttrs, parentId? }
```

- `type` is one of 109 catalogue types (`client`, `service`, `sql_db`, `cache`,
  `queue`, `load_balancer`, `cdn`, `blob_store`, `llm`, `vector_db`, `group`…).
- `annotation` is the mechanism in words ("cache-aside, TTL 60s"). The LLM review
  reads it; a box labelled "Cache" with no strategy earns nothing.
- `attrs` are the numbers the engine reads (section 4).
- `parentId` places a part inside a boundary (section 3, Boundaries).

### Connections (edges)

```ts
{ id, from, to, kind: 'sync' | 'async' | 'replication', label,
  share?, retries?, carries?, placement?, payloadKb? }
```

- **sync**: the caller waits. Latency and failure propagate back to the caller.
- **async**: a hand-off (into a queue, an event). The caller does not wait; the
  headline latency stops here.
- **replication**: data moving between stores. Carries no requests.
- `share`: on a service, calls per request down this connection (4 = four queries
  per page; 0.02 = one request in fifty). On a router, the fraction of traffic sent
  this way. Default 1.
- `retries`: how many times the caller retries a failed call.
- `carries`: `read` / `write` / `both`, used to split reads from writes.
- `placement`: `same-host` / `same-az` / `cross-az` / `cross-region` / `internet`,
  which sets wire latency and egress price (`network.ts`).
- `payloadKb`: bytes per request, for egress cost.

### Flows (journeys)

```ts
{ id, name, kind: 'read' | 'write' | 'async' | 'admin', steps: string[], rps, description }
```

A flow is one request's path as an ordered list of node ids, with a baseline rate.
Flows are what turn a box diagram into a design: they are graded step by step, they
drive per-journey latency, and scenario gates evaluate them. Each step must be
reachable from an earlier step over a drawn connection, or the flow is marked broken
at that step.

### Boundaries and machines

A `group` node is a boundary: a region, a VPC, a cell, a team. Parts inside it have
`parentId` set and move with it. A boundary with `attrs.sharedHost: true` is a
**machine**: everything inside shares its CPU (slots = vCPU × 8 × replicas), its
bill, and its fate — kill the machine and everything on it goes down. The palette
offers "Machine" as a preset (4 vCPU, 16 GB). Dropping a part so that its centre is
inside the frame adopts it; the frame grows to fit.

### Documents

- `CanvasDoc` is what is saved: nodes with positions, sizes, z-order and locks;
  edges with geometry (shape, bend points); stickies; pen strokes; flows; an optional
  `scanId` and code bindings. One JSON blob per (user, sheet) in the `designs` table.
- `GraphDSL` is what the engine, the checks and the review see: nodes, edges, flows,
  sticky text. No geometry. `toGraph()` in the client store produces it.
- `BlueprintLike` is how problems author a starting architecture: nodes keyed by
  short names with relative positions, edges by key, flows by key. `docFromBlueprint`
  turns it into a `CanvasDoc`; the client's `insertBlueprint` places it with fresh ids.

---

## 4. The component catalogue

### Families

Every type belongs to one of ten families (`families.ts`). The family decides the
defaults, the parameters offered, the gauge drawn, the cost formula and the engine's
treatment:

| Family | Examples | Engine role |
| --- | --- | --- |
| `origin` | client, mobile_client, scheduler, change_feed | Where traffic starts. Unlimited; never sheds. |
| `routing` | load_balancer, api_gateway, cdn, dns, reverse_proxy, geo_router | **Distributes** its traffic across outbound connections. |
| `compute` | service, monolith, worker, serverless_function, vm | **Fans out**: calls each dependency `share` times per request, sums their response. |
| `datastore` | sql_db, nosql_db, read_replica, blob_store, search_index, warehouse | Serves; has a tank gauge and a connection ceiling. |
| `cache` | cache, cdn_cache | **Absorbs** a hit-rate share; forwards the rest to its origin. |
| `messaging` | queue, stream, pubsub, dlq | **Buffers**: forwards at the rate consumers pull; backlog otherwise. |
| `external` | payment_gateway, third_party_api, email_provider | Hosted elsewhere; elastic; subject to the third-party latency slider. |
| `ai` | llm, embedding_svc, vector_db, guardrail | Compute with low concurrency and token pricing. |
| `control` | observability, secret_manager, feature_flags | Runs beside the system; status light only. |
| `boundary` | group | Furniture, unless it is a machine. |

### Parameters (`NodeAttrs`)

| Key | Meaning |
| --- | --- |
| `capacityRps` | Requests per second one replica can serve. |
| `latencyMs` | Own work per request at zero load (service time). |
| `replicas`, `autoscaleMin`, `autoscaleMax` | How many; an autoscaling group starts at its floor. |
| `concurrency` | Requests in flight per replica. Derived from `vcpu × 8` when vCPU is set. |
| `vcpu`, `memoryGb`, `storageGb`, `workingSetGb` | Size, for cost and for cache coverage. |
| `cacheHitRate` | Share a cache absorbs. Default 0.8, capped by memory ÷ working set. |
| `queueDepthMax` | Backlog a buffer holds before refusing. Default 100,000. |
| `poolSize`, `maxConnections` | Connection ceiling, held open by a pooler / accepted by the store. The smaller binds. |
| `timeoutMs` | How long callers wait for this part before giving up. Only enforced when stated. |
| `runtime` | `thread-pool` (default: a worker held for the whole request), `event-loop` (holds nothing while waiting; limited by CPU), `serverless`. No inspector control yet. |
| `cpuMs` | Mean CPU per request (CPU% ÷ rps), not wall time. An event loop defaults to 2 ms (capped at `latencyMs`); a thread pool has no CPU limit until it is stated. |
| `latencyP99Ms` | Slowest 1% of own work; with `latencyMs` it sets the request engine's spread. Default 2.5 × median. |
| `healthCheckS` | How long a balancer takes to notice a dead backend. Default 10 s. |
| `multiAz` | Spread across zones: doubles cost, survives a zone loss. |
| `trafficRps` | Marks a source and its baseline rate. |
| `elastic` | Runs on a provider's capacity; no utilisation of its own. |
| `rateLimitRps`, `pricePerMillion`, `tokensPerRequest`, `pricePer1kTokens` | Third-party and AI pricing and limits. |
| `monthlyCost` | Overrides the calculated bill with a real invoice figure. |
| `sharedHost` | On a boundary: everything inside runs on this pool. |
| `sku`, `region` | A bound cloud offering and where it lives. |

Defaults per family and per type live in `components.ts` and `engine.ts`:

- Concurrency per replica by family: origin 1, routing 4,000, compute 64,
  datastore 200, cache 1,000, messaging 500, external 32, ai 8, control 1,000.
- Default timeout by family (used only to cap waits, not to fail): origin 30 s,
  routing 5 s, compute 2 s, datastore 1 s, cache 200 ms, messaging 1 s,
  external 10 s, ai 60 s.
- Service time per type from `DEFAULT_LATENCY`, else 20 ms.
- A source with no `trafficRps` offers `DEFAULT_SOURCE_RPS = 100`.

### Custom objects and blueprints

- A user can save any tuned part as their own type ("Save as my type"); it keeps
  its base type so the engine and the rules still understand it (`custom_objects`).
- Subsystems (blueprints) are whole patterns placed at once.
- Templates are a user's own saved selections.

---

## 5. How the canvas manages elements (client)

State lives in one zustand store, `client/src/state/canvasStore.ts`, which React
Flow renders.

- **Nodes and edges** are React Flow objects; the arch data sits in `node.data`
  (`archType`, `label`, `annotation`, `attrs`, `ghost?`, `locked?`). Edge data
  holds `kind`, geometry and the simulator knobs (`share`, `retries`…).
- **Undo/redo** keeps 50 snapshots (`past` / `future`).
- **Autosave**: any change marks the doc dirty; a 900 ms debounce PUTs
  `/api/designs/:problemId`. Last write wins.
- **Placing**: click a palette item (lands at the viewport centre) or drag it.
  Dropping a part on a connection **splices** it in (A→B becomes A→X→B, and flows
  through A→B now pass X).
- **Boundaries**: on drop, `reparentDroppedNodes` adopts a part whose centre is
  inside the smallest containing boundary; positions are rewritten relative to the
  parent so nothing jumps. `previewDrop` lights up the target frame mid-drag.
  `growToFit` enlarges a frame for a part hanging over its edge.
- **Make room** spreads an overlapping layout about its centroid (one undo step).
- **Ghosts**: the review can propose parts; they appear translucent with Accept /
  Dismiss.
- **Markup**: the review pins markers (spof, bottleneck, missing, good, question)
  on parts.
- **Pinning**: a locked part cannot be dragged or deleted.
- **Selection** drives the details editor (right pane on a problem sheet; floating
  card in a project view).
- **Simulation** runs locally on every change while "Run load" is on (60 ms
  debounce), producing `simResult`. "Verify on server" re-runs the identical engine
  on the backend for an authoritative answer.
- **Chaos**: `simConfig` holds `rpsMultiplier` (1–100), `thirdPartyLatencyMs`,
  `killNodeIds`, and optional degradations.

Rendering details that matter:

- Each part is drawn by `ArchNode.tsx` with one of two skins (Instruments or Rack)
  and one gauge per family (traffic sparkline, worker slots, tank, hit-rate ring,
  queue tube, fan-out split, latency vs timeout, status light). Gauges animate
  through CSS variables, so a run never re-renders React per frame.
- Below 60% zoom a part shows a simplified far face.
- Request particles travel the edges on a single canvas (`FlowParticles.tsx`).
- During a run, a Web Client shows a small browser and a Mobile App a small phone
  (`UserView.tsx`), playing page loads drawn from that client's journeys: nine in
  ten at the median, one in ten at the p99, failing as often as the run drops
  requests; a spinner past 1 s, "gave up" past 8 s; the last 20 loads as dots.
- The cost meter in the top-right corner is always on, pricing the drawing at the
  current load even before a run.

---

## 6. The simulation engine

`runEngine(graph, scenario)` in `shared/src/engine.ts`. Pure, deterministic,
offline, no allocation per keystroke beyond a few maps. The same code runs in the
browser and on the server.

### 6.1 Preparation (once per run)

1. **Sources** are parts with `trafficRps`, else parts nothing points into. Sinks
   are parts with no outbound connections.
2. **Paths** are enumerated from each source (up to 60 paths, depth 24); cycles are
   reported, not walked.
3. **Hosts**: for every part, walk `parentId` upward to the first boundary marked
   `sharedHost`. Members of a host share its slots and its outage.
4. **Depth**: the longest acyclic chain decides how many relaxation rounds a tick
   needs (depth + 4, min 8, max 80).

### 6.2 Scenario

```ts
{ id, name, horizonS, loadMultiplier, patterns, outages, latency, overrides, slo }
```

- `patterns`: per-source traffic shape: steady, ramp, spike or burst with
  `baseRps`, `peakMultiple`, `startS`, `durationS`, `periodS`.
- `outages`: `{ nodeId, atS, forS? }`. A dead part serves nothing; a dead machine
  takes its members down; a dead cache is bypassed (reads land on its origin).
- `latency`: extra milliseconds on a part or a whole family (the third-party slider
  adds to every `external`).
- `overrides`: hit rate or capacity multiple on a part for a window (brownouts).
- The report scenario built from the UI knobs runs for `REPORT_HORIZON_S = 150`
  seconds with kills at `OUTAGE_AT_S = 20`; a problem scenario sets its own.

### 6.3 One tick (one simulated second)

Within a tick the engine relaxes to a fixed point over several rounds, because a
caller's capacity depends on its callees' response times, which depend on load,
which depends on the caller.

1. **Offer**: each source offers `baseRps × shape(t) × loadMultiplier`. When several
   declared flows start at one source, each is offered its own share.
2. **Push**: traffic moves one hop per round. Routers split by share (normalised to
   one). Services send `share` calls per request down each sync edge. Caches
   forward `(1 − hitRate)`. Queues forward what their consumers can pull; the rest
   becomes backlog that carries to the next tick. Replication edges carry nothing.
3. **Capacity** per part = `min(statedCapacity × replicas, slots / occupancy)`:
   - Slots = concurrency × replicas (concurrency from `vcpu × 8` when sized).
   - **CPU** (compute and ai): `vcpu × 1000 ÷ cpuMs` per replica. An **event loop**
     has only this limit — waiting on a dependency costs it latency, never capacity
     — and queues for its cores, with the wait counted in CPU time. A **thread pool**
     is held to the smaller of its slots and its CPU, but only once `cpuMs` is
     stated. `firstFailure` says "run out of CPU" when this binds. The rule lives in
     `des/runtime.ts`, which the request engine reads too.
   - **Occupancy** (ms a request holds a slot) = own service time × queue multiple +
     the wire + the response of every synchronous dependency, weighted by calls per
     request. A slow dependency therefore eats the caller's capacity. Occupancy is
     damped between rounds (the step halves when the direction flips) so wide
     fan-outs settle instead of oscillating.
   - A **connection ceiling** (the smaller of `maxConnections` and `poolSize`) caps capacity at
     `ceiling × 1000 / occupancyMs` (Little's law turned round).
   - A **shared machine** divides its slots among members in proportion to their
     demand; members squeezed by it are flagged `hostLimited`.
   - An **autoscaling group** starts at its floor and adds replicas towards 70%
     target utilisation, arriving `AUTOSCALE_LAG_S = 60` seconds late.
   - A **load balancer** keeps sending to a dead backend until a health check
     notices (`healthCheckS`, default 10 s), then moves that share to survivors.
4. **Serve and shed**: admitted = min(arriving, capacity). The rest is dropped at
   that part. Utilisation = arriving ÷ capacity. State: `ok` < 0.7 ≤ `warn` < 0.9 ≤
   `hot`; `saturated` at ≥ 1 or when dropping; `down` when killed.
5. **Queueing**: wait and tail multiples come from Erlang-C with `c` servers
   (`queueing.ts`), clamped at 20× service time. p99 is a real tail multiple, not a
   factor.
6. **Response times** are a recursion: a service's response = own latency + Σ over
   sync dependencies of (wire + dependency response) × calls; a router's = weighted
   average of its backends; an async hand-off contributes nothing; each wait is
   capped at the callee's patience (its timeout).
7. **Timeouts**: a part whose response exceeds a *stated* `timeoutMs` fails what it
   served. Unstated timeouts never fail anything; they only cap waits.
8. **Retries and call success**: per part, the probability a call comes back = own
   survival × its dependencies' (calls below one expose only that fraction; counts
   above one compound, so 80 calls at 99% leave 45%). The next round's retry
   multiplier on an edge uses that, so retries add load exactly where things are
   already failing.
9. **Settled?** The tick exits early once no part's served rate moves more than
   `SETTLED_RPS = 0.01`. A tick whose inputs are identical to the last reuses it.

### 6.4 Outputs

- `ticks[]`: per second offered, completed, lost, p50, p99, success rate, hottest
  part.
- `worst[]` and `final[]`: per-part `HopState` at the worst second (most lost, then
  most stressed, then slowest) and at the end: arriving, admitted, served, dropped,
  capacity, utilisation, latency, backlog, replicas, state, `hostLimited`,
  `elastic`, occupancy, response p50/p99.
- `hosts[]`: each shared machine's slots, used, members' usage, down.
- `failures[]` and `firstFailure`: whoever lost traffic first in path order, with a
  reason in words ("has 10 connections and its callers need 25").
- `peakBacklog`, `retryAmplification`, `sloBreaches`, `recoveredAtS`,
  `bottleneckNodeId`, `assumptions[]`.

`simulate()` in `simulate.ts` turns that into the `SimResult` the UI shows: per-part
numbers at the worst moment, per-flow results (offered, completed, p50, p99,
broken, brokenAt, measured), a one-paragraph verdict, findings in words, the cost
report, and the timeline.

### 6.5 Flows in the engine

Each declared flow's offered load is its share of its source's rate. Its latency
walks every listed step, adding each step's own latency, the wire to the next, and
the response of that step's *other* synchronous dependencies. A flow is broken at the
first consecutive pair of steps with no drawn connection, or at a step that is down
with nothing else serving it. Flows time the whole listed journey even through an
async hand-off; the headline latency stops at the hand-off.

### 6.6 Network and placement

An unannotated edge is same-AZ. `network.ts` adds round-trip latency per placement
(same-host 0, same-AZ, cross-AZ, cross-region by measured pair when both regions are
stated, internet) and the price of bytes leaving a part. The wire is charged twice:
to the latency the reader sees and to the caller's occupancy.

### 6.7 Constants worth knowing

| Constant | Value | Where |
| --- | --- | --- |
| `CONCURRENT_REQUESTS_PER_VCPU` | 8 | engine.ts |
| `WARN_UTILIZATION` / `HOT_UTILIZATION` | 0.7 / 0.9 | components.ts / engine.ts |
| `AUTOSCALE_LAG_S` / target | 60 s / 0.7 | engine.ts |
| `DEFAULT_HEALTH_CHECK_S` | 10 | engine.ts |
| `DEFAULT_QUEUE_DEPTH` | 100,000 | engine.ts |
| `DEFAULT_CACHE_HIT_RATE` | 0.8 | components.ts |
| `CACHE_COVERAGE_EXPONENT` | 0.5 (hit rate ≤ √(memory ÷ working set)) | engine.ts |
| `MAX_WAIT_MULTIPLE` | 20 | queueing.ts |
| Relaxation rounds | depth + 4, 8–80; settle at 0.01 rps | engine.ts |
| `DEFAULT_HORIZON_S` / `TICK_S` | 120 / 1 | engine.ts |

---

## 7. The cost model

`costReport(nodes, served, replicas, hostedBy, edges)` in `cost.ts`. The bill is
calculated from what the run actually carried and the replicas it settled at: a
design that shed half its load is not billed for the half it refused; one that
scaled to fifty replicas is billed for fifty.

Rates (`RATES`, provider-neutral, rounded, not a quote):

| Item | Rate |
| --- | --- |
| vCPU-month | $12 |
| RAM GB-month | $3.50 |
| Durable storage GB-month | $0.12 |
| In-memory cache GB-month | $14 |
| Managed router, flat | $22/month + $0.60 per million requests |
| Managed queue/stream | $0.40 per million messages |
| Control-plane part (observability, secrets) | about $40/month |
| DNS zone | $0.50/month + $0.40 per million lookups ($0.70 geo) |
| Egress | per GB by placement (`network.ts`), billed to the sender |

Per family:

- **compute**: `replicas × (vCPU × $12 + GB × $3.50)`, ×2 for multi-AZ. Defaults
  2 vCPU / 4 GB.
- **datastore**: instances × (vCPU + memory) + storage GB × $0.12, ×2 multi-AZ.
  Defaults 4 vCPU / 16 GB.
- **cache**: `copies × GB × $14`. Default 4 GB.
- **messaging**: messages a month × $0.40/M.
- **routing**: $22 + requests a month × $0.60/M. DNS is billed per *lookup*, not per
  request: resolvers cache for the TTL, so only a fraction of traffic reaches it.
- **external / ai**: `pricePerMillion` or tokens × `pricePer1kTokens`; zero if no
  price is given ("set one to see the bill").
- **control**: $40.
- **origin**: free ("not yours to run").
- **boundary**: free, unless it is a machine, which carries the whole bill of its
  size and its members are billed nothing ("runs on The box").
- **`monthlyCost` override**: replaces the calculation; egress is not added on top
  (a real invoice already includes it).
- **Egress**: `served rps × seconds per month × payloadKb`, divided among a part's
  inbound connections, priced by placement, added to the sender's usage line.

`SECONDS_PER_MONTH = 60 × 60 × 24 × 30`. The report has `lines[]` (each with
`fixedUsd`, `usageUsd`, `totalUsd` and a `basis` sentence explaining the number),
plus totals. Fixed is billed whether traffic arrives; usage follows traffic.

Real SKUs: `skus.ts` and `shared/src/data` can bind a part to a real cloud offering
with provenance (`catalog.ts` records value, source, date and confidence). When a
design is neutral (no provider chosen), none of that applies.

---

## 8. Structural checks

`checkTopology(graph)` in `compatibility.ts` runs locally on every edit, costs
nothing, and returns findings with a severity (`error` "cannot work", `warning`
"would be questioned", `info` "worth noticing"), a message, a fix, the parts
involved and a concept id. Rules:

`client-direct-to-datastore`, `cache-as-system-of-record`, `cdn-behind-app`,
`datastore-calls-service`, `flow-skips-a-connection`, `lb-without-backends`,
`llm-no-cost-ceiling`, `llm-without-guardrail`, `no-auth-boundary`,
`no-flows-declared`, `no-observability`, `orphan-node`, `overengineered-for-scale`,
`pii-unencrypted-third-party`, `queue-without-consumer`, `queue-without-dlq`,
`read-after-write-on-replica`, `replication-between-unlike-stores`,
`search-index-written-synchronously`, `serverless-direct-to-pooled-store`,
`stateful-single-replica`, `sync-into-queue`, `third-party-on-sync-user-path`,
`vector-db-without-embedder`, `warehouse-on-user-path`.

The Checks panel shows one line per finding; the LLM review is handed these as facts
it must respect.

---

## 9. Scenario gates (problems) and gates (course)

### Problem scenarios

A problem's `scenarios[]` each describe a situation and a machine-checkable pass:

```ts
{ id, name, description, rpsMultiplier, killNodes?, thirdPartyLatencyMs?, degrade?,
  passCriteria: string, pass: { maxDroppedPct?, maxP99Ms?, noBrokenFlows? } }
```

`evaluateAllScenarios(graph, problem)` runs each scenario through the engine and
returns `{ scenarioId, pass, reasons[] }`. Kills and degradations are matched
against the drawing by id *or label*, case-insensitively, so a scenario that names
nothing on the sheet is caught by a bank test rather than passing silently. The
brief shows these at the top as "Make these pass" with a ▶ button that plays the
scenario on the canvas. Gates evaluate live as you draw, once a flow is declared.

### Course gates

A course step's gates (`shared/src/course/types.ts`) are stricter and simpler:
`rps`, optional `kill` and `window` (`all` / `after-kill` / `end`), `maxLostPct`,
`maxP99Ms`, `maxBusy { part, pct }`, `reaches { part }`. `judge.ts` is pure
arithmetic: the same design gets the same verdict every time, no model involved.
Progress is recorded only when the server's judge agrees.

---

## 10. Problems, labs and composing

- **Problem bank** (`server/src/problems/bank.ts`): 37 blank-sheet problems across
  six levels (L1 fundamentals 6, L2 scaling 6, L3 reliability 7, L4 data 7, L5
  distributed 6, L6 AI systems 5). Each carries a prompt, functional requirements,
  non-functional numbers (peak rps, p99, availability…), constraints (team, budget,
  stack), concepts, expected flows, rubric hints, twists, scenarios, and an optional
  authored diagram of "the system today".
- **Labs** (`labs.ts`): 7 sheets that arrive with a working, flawed architecture
  already placed (e.g. *The One-Box Storefront*: app, images and Postgres on one
  machine; *Analytics on the Primary*; *One Shard Is On Fire*; *Two Regions, One
  Truth*; *Confidently Wrong RAG*; *The Agent With Root*).
- **Validation** (`validate.ts`): every seed problem must meet a content bar
  (annotations on every part, flows declared, scenarios naming real parts…), and
  tests enforce it.
- **Compose a sheet**: `POST /api/problems/from-brief` turns a scenario in the
  user's words plus their constraints into a problem with rubric, twists and
  scenarios (LLM-assisted, validated). `POST /api/problems/generate` drills a
  concept. Users' own problems live in `problems_custom`.
- **Reference designs**: a model answer can be generated and stored per problem.
- **Concepts** (`concepts.ts`): 45 concept ids (caching, sharding, idempotency,
  circuit-breaker, rag-retrieval…) tag problems, rules and mastery.

---

## 11. The course

`shared/src/course/chapters.ts` defines a prologue and chapters, each a few short
steps converging on a checkpoint. Implemented so far: **Prologue** "What is a
request?" (five steps), **Chapter 1** "One box, one problem", **Chapter 2** "Two of
everything". The planned ladder continues: caching, bytes off the app (CDN, blob
storage), queues, the database, observability, an AI elective, graduation.

Step types: `fill-gap`, `fix-wiring`, `find-bottleneck`, `kill-switch`,
`tune-dial`, `checkpoint`. A step has a starting architecture, one plain
instruction, gates, optional dials (sliders bound to a part's attribute), an
optional ghost (one valid answer, not the only one), and a budget. The lesson view
(`client/src/course/Lesson.tsx`) uses the canvas in `lesson` mode: no HUD, its own
run button, goals and parts tray. The Learn page lists chapters with progress.
Progress: `GET /api/course/progress`, `POST /api/course/steps/:stepId/pass`.

---

## 12. The model review (LLM)

Submitting a sheet (`POST /api/attempts`) asks a model to grade the design. The
pipeline (`server/src/scoring`):

1. The graph is sanitised; the structural findings and the simulation result are
   computed first and handed to the model as facts.
2. Relevant **playbook** entries are retrieved deterministically (`retrieve.ts`)
   and placed in the prompt. The playbook (`playbook.ts`) paraphrases published
   practice with sources (vendor docs, engineering blogs, books, papers, standards);
   findings must cite the entries they rest on, and invented citations are dropped
   server-side.
3. The model returns a `ScoreResult`: an overall score; six dimensions
   (`requirements`, `scalability`, `reliability`, `data_consistency`, `security`,
   `cost_simplicity`), each with score, max and notes; critical failures; SPOFs;
   missing pieces; good calls; Socratic questions; per-concept scores; a model-answer
   summary; teaching blocks; **canvas markup** (markers pinned to parts);
   **suggested additions** (ghost parts); per-flow reviews; risks; "at 10×"; a
   decision summary and alternatives (enough for an ADR).
4. `validateScore` enforces the shape and discards anything that does not fit.
5. The attempt is stored (`attempts`), mastery is updated, and twists can start a
   second round against the same sheet.

Other model-backed endpoints: **Ask** (`/chat`, a coach that knows the sheet),
**Attack** (`/attacks`, adversarial scenarios against the design), **Critique**
(`/critique`, free-form), **Socratic** (`/socratic`, grades a learner's free-text
explanation). Providers: Anthropic, any OpenAI-compatible endpoint, or an offline
fake (`LlmProvider`). Each user brings their own key in Settings; responses are
cached (`llm_cache`). Drawing, simulating and checks never need a model.

---

## 13. Mastery and progress

`server/src/mastery`: per concept, an exponential moving average of attempt scores.
The review interval depends on it: EMA ≥ 0.8 → 14 days, ≥ 0.6 → 7, ≥ 0.4 → 3, else
sooner. `/api/review-queue` lists concepts overdue for a drill; `/api/weakness-target`
picks a problem that exercises the weakest; `/api/stats` and `/api/activity` feed the
Progress page (streak = consecutive days with an attempt).

---

## 14. The platform around the canvas

- **Projects**: a system of your own with several canvases (views). Same canvas,
  same simulator, same checks; no brief and no grader. `projects`,
  `project_canvases`.
- **Repository scan** (`shared/src/scan`, `POST /api/scan`): manifests say what
  exists, dependency files say what it talks to, the filesystem says what it answers
  on, then exposure rules run. Deterministic; no model. The result can be placed on
  a canvas, rows of the code view can be bound to parts, SARIF (Semgrep, CodeQL)
  and traces can be attached (`POST /api/scan/:id/trace`). `docs/repo-scan.md`.
- **Notes**: per sheet, per project, and a library; searchable.
- **Exports**: an attempt as text / ADR (`/api/export/:attemptId`), a brief.
- **Reference and primer**: concept pages (`/api/primer`, `/api/concepts`) and the
  playbook (`/api/playbook`).
- **MCP connector** (`server/src/mcp`): tools `list_sheets`, `get_sheet`,
  `read_canvas`, `write_canvas`, `place_starting_architecture`, `run_engine`,
  `scan_repo`, `get_scan`, `add_trace`, `add_sheet`, `add_note`, `search_notes`.
  Reachable at `/api/mcp` with an API token or via OAuth (`/oauth/*`,
  `/.well-known/*`). This is how Claude Code or Claude Desktop drives Loadbearing.
- **Auth**: username + password, HttpOnly session cookie; API tokens for machines.

---

## 15. Persistence

Tables (SQLite locally in `data/loadbearing.sqlite`, Postgres when `DATABASE_URL`
is set; same schema): `users`, `settings`, `designs` (one JSON `CanvasDoc` per user
and sheet), `attempts` (scores and the sim that accompanied them), `mastery`,
`problems_custom`, `reference_designs`, `projects`, `project_canvases`, `chats`,
`notes`, `api_tokens`, `llm_cache`. Course progress is kept in the per-user
settings row as a map of step id → `{ passedAt, hints }`, so it needs no table of
its own.

The local SQLite file holds real accounts; tests and browser checks use throwaway
accounts and clean up after themselves.

---

## 16. API surface (all under `/api`)

Auth: `register`, `login`, `logout`, `me`, `tokens`. Problems: `GET /problems`,
`GET /problems/:id`, `POST /problems`, `from-brief`, `generate`, `:id/reference`,
`DELETE`. Designs: `GET/PUT /designs/:problemId`. Scoring: `POST /attempts`,
`GET /attempts`, `/chat/:problemId`, `/attacks`, `/critique`, `/socratic`,
`POST /simulate`. Mastery: `/mastery`, `/review-queue`, `/weakness-target`, `/stats`,
`/activity`. Course: `/course/progress`, `/course/steps/:id/pass`. Projects:
`/projects`, `/projects/:id`, `/projects/:id/canvases`, `/canvases/:id`,
`/projects/:id/brief`. Notes: `/notes`, `/notes/library`. Scan: `/scan`, `/scans`,
`/scan/:id`, `/scan/:id/trace`. Reference: `/concepts`, `/primer`, `/playbook`.
Custom objects and templates. Export. Settings. MCP and OAuth. `GET /api/health`
reports storage, whether a model is configured, and advice when `DATABASE_URL` looks
wrong.

---

## 17. The user interface

Pages (top bar): **Learn** (course path), **Problems** (index by level, labs,
"target my weak spots", "review my system"), **Drawing board** (the workspace),
**Compose**, **Projects**, **Progress**, **Notes**, **Reference**, Settings and
the grader model in the avatar menu.

The workspace is three columns: left pane (Brief, Flows, Inspect, Checks, Code,
Notes), the canvas, right pane (Components / Selected, Review, Ask, Attack,
History). Selecting a part replaces the components list with its details. Panes
collapse to a spine and resize by drag.

Design system (`client/src/styles`): light "bench" with a dark toggle, Geist and
Geist Mono, cobalt as the only accent (meaning "you"), green/amber/red reserved for
healthy/straining/failing, plum for async and replication. Tokens are CSS custom
properties; a test fails on any hard-coded colour outside the token file, and
another checks WCAG AA contrast for every text pair in both themes. Two node skins
(Instruments, Rack) and two densities. Motion is CSS transitions and WAAPI; reduced
motion disables particles, shake, blink and movement but keeps fades. A boot screen
and a top loading bar cover slow starts and requests.

---

## 18. Deployment

- Vercel: `vercel.json` builds `client/dist`, routes `/api/*` and `/.well-known/*`
  to the `api/index.ts` function (60 s max), everything else to `index.html`. The
  root `package.json` is `"type": "module"` on purpose; the function imports the ESM
  server.
- Environment: `DATABASE_URL` (Supabase Postgres; use the transaction pooler on
  port 6543, not session mode on 5432, which allows 15 connections),
  `SESSION_SECRET`, optional house LLM key. Without `DATABASE_URL` the server uses
  SQLite.
- Live site: https://loadbearing-server-kwes.vercel.app (repository
  `chinmay404/Loadbearing`, branch `main`).

---

## 19. Testing discipline

- Vitest in each workspace: ~630 shared, ~310 server, ~160 client tests.
  `npm test` runs all; shared is built first because the others import its `dist`.
- Engine tests are written per mechanism, with numbers checkable by hand.
- `shared/src/calibration/baseline.json` is a snapshot of every built-in problem
  and blueprint through the engine; the tripwire test fails when any number moves,
  so engine changes are reviewed number by number.
- Client guards: no hex colours outside tokens; contrast; gauge model per family;
  layout; store behaviour (splice, reparent, undo, round-trips through a saved doc).
- Browser verification is done by driving the real app with a throwaway account,
  because store tests have passed while the canvas was broken.
- Work is test-first: the failing test is seen to fail for the stated reason before
  the fix.

---

## 20. Known gaps and the roadmap

Engine realism still to do ("2C", `docs/superpowers/specs/2026-08-03-engine-realism-design.md`):

- Cache-aside should relieve the database more faithfully; caches should not absorb
  writes.
- Reads and writes should split on fan-out; a read replica should take only reads.
- Queue decoupling should be modelled fully (consumerless queues, competing
  consumers).
- CDNs should offload bytes from the origin.
- The remaining hand-set defaults should come from dated, cited snapshots.

Product work planned: connection contracts enforced while drawing ("2B": valid
targets highlighted, impossible connections refused, edge kinds set automatically);
the rest of the course; challenges (timed incidents, daily challenge, interview
mode); a typed-decision model (Jev) for judging free-text explanations, never
pass/fail; per-student scenario variants and journey replay for assessment; the
load-test loop (predict → k6 → calibrate → track record); a CI gate on
infrastructure PRs; the canvas as a digital twin with drift detection.

---

## 21. Glossary

- **Part / node**: one component on the canvas.
- **Connection / edge**: a typed link between parts.
- **Flow / journey**: one request's ordered path with a baseline rate.
- **Gate**: a machine-checked pass condition on a run.
- **Scenario**: a traffic shape plus kills and slowdowns.
- **Machine**: a boundary whose contents share its CPU and its outage.
- **Sheet**: a problem or lab the learner draws against.
- **Blueprint**: an authored starting architecture.
- **Ghost**: a part proposed by the review, not yet accepted.
- **Occupancy**: how long a request holds a slot, including what it waits on.
- **Slots**: concurrent requests a part or machine can hold in flight.
- **Playbook**: the cited reference corpus the review must ground itself in.
- **Tripwire**: the engine snapshot test that fails when any number moves.
