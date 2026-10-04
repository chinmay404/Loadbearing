# 2A — Make the engine tell the truth

Date: 2026-10-04. Part 2 of the redesign is split into 2A (engine bugs, this
document), 2B (component contracts and connection checking while drawing) and 2C
(traffic semantics: cache-aside, read/write split, queues, load balancing). 2A
changes no semantics anyone would argue about: each item is a bug with one
correct answer, found by an audit that ran the built engine.

## The bugs

1. **Traffic stops after eight hops.** `RELAX_ROUNDS = 8` and each round pushes
   traffic one hop further, so anything nine hops from a source receives nothing
   while the run reports success. Probe: client → dns → cdn → waf → lb → gateway
   → service → cache → sql_db gives the database 0 rps.
2. **Latency is averaged across a service's dependencies instead of summed.** The
   headline p50/p99 walk enumerated paths and average them by traffic weight, so
   one, three or six sequential 100 ms database calls all report ~111 ms while
   occupancy (correctly) charges 110 / 311 / 613 ms. Flow latency adds only the
   steps named in the flow, so a service's other calls are invisible to it.
3. **A timeout compares a part's own work, not its response.** `timeoutMs` means
   "how long callers wait for this part", but the check uses the part's own
   latency, so an API with a 200 ms timeout calling a 4 s gateway "succeeds" at
   4 s.
4. **Retries ignore failures below the callee and timeouts.** The retry multiplier
   uses the callee's own drop fraction, so web retrying an API whose database
   fails 80% amplifies nothing, and a callee failing by timeout is never retried.
5. **Flows can skip connections, and flows sharing a source double-count.** Steps
   are never checked against drawn edges, so a flow web → db with no edge reports
   500 completed while the database received nothing. Every flow starting at a
   source reports the source's whole rate as its own offered load, and scenario
   gates sum these.

## The fixes

1. **Rounds follow the drawing.** Rounds = longest acyclic chain from any node + 4,
   at least 8 and at most 64, stopping early once no part's served rate moves by
   more than ε between rounds.
2. **Response time is a recursion, like occupancy.** Each part's response is its
   own latency (service time × queueing multiple) plus, for a service, every
   synchronous dependency in turn (wire + the dependency's response, weighted by
   calls per request); for a router, the weighted average of the backend it picks;
   an async hand-off contributes nothing. A dependency's contribution is capped at
   its timeout, because the caller stops waiting. Exposed on `HopState` as
   `responseMs` and `responseP99Ms`. The headline p50/p99 is the response of each
   source weighted by the traffic it completes. A flow walks its steps, adding
   each step's own latency and the wire to the next step, plus the response of
   that step's *other* synchronous dependencies when the step calls all of them.
3. **Timeouts use the response.** After throughput settles, a waited-on part whose
   `responseMs` exceeds its timeout fails what it served — the existing rule, on
   the right number.
4. **Retries see the whole call.** Each round computes, per part, the probability a
   call to it comes back (its own survival × its dependencies', the existing
   success recursion) with a part past its timeout counting as failing. The next
   round's retry multiplier on an edge uses that. Retries only add load to a slow
   part, which keeps it slow, so this converges.
5. **Flows are checked against the drawing.** A consecutive pair of steps with no
   connection from the first to the second marks the flow broken at that step,
   with a note naming the missing connection and zero completed; a new structural
   rule `flow-skips-a-connection` (error) says the same in Checks. When several
   flows start at the same part, each is offered its own rps × the multiplier
   rather than everything arriving there.

## Verification

Each fix lands test-first: the test is written, run against today's engine and
seen to fail for the stated reason, then the fix makes it pass. The engine's
snapshot ("tripwire") test is updated only after every moved number is reviewed.
All built-in problems' scenario gates and all blueprints are re-run; any whose
verdict changes is listed in the hand-off. `npm test` and `npm run typecheck` stay
green.
