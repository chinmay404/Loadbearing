# Engine Physics Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the load engine model the four mechanisms it currently documents but does not implement — dependency occupancy, multi-server queueing, network distance, and connection pools — with each mechanism extracted as a pure, independently testable module.

**Architecture:** `engine.ts` stays the tick orchestrator. Four new modules under `shared/src/` own one formula family each, take plain numbers, return plain numbers, and never see a `GraphDSL`. A committed golden snapshot of today's engine output makes every behavioural change visible as a reviewed diff rather than a silent drift.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, npm workspaces. No new runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** Every mechanism is closed-form arithmetic.
- **Purity.** No clock, no `Math.random`, no mutation of inputs. Identical `(graph, scenario)` must give an identical result including string order.
- **Bounded.** Every loop has a ceiling; cyclic graphs must terminate.
- **ESM import specifiers end in `.js`** even for TypeScript sources (`./queueing.js`).
- **New `NodeAttrs` / `GraphEdge` fields are optional** and default to current behaviour. No database migration.
- **`shared/src/index.ts` does not re-export `components.ts`** — follow that precedent for any module whose exported names could collide.
- Test command for this package: `npm --workspace shared run test`.
- Full suite: `npm test` (builds shared first). Typecheck: `npm run typecheck`.
- Commit after every task. Never re-baseline a test expectation without a one-line reason in the commit body.

---

### Task 1: Golden snapshot of today's engine

The spec requires the current engine's behaviour to be captured **before** anything changes, so each later task's diff is reviewable. This is the differential harness.

**Files:**
- Create: `shared/src/calibration/snapshot.ts`
- Create: `shared/src/calibration/snapshot.test.ts`
- Create: `shared/src/calibration/baseline.json` (generated)

**Interfaces:**
- Consumes: `BLUEPRINTS` from `../blueprints.js`, `simulate` from `../simulate.js`
- Produces: `snapshotAll(): Snapshot`, `type Snapshot = Record<string, BlueprintSnapshot>`

- [ ] **Step 1: Write the snapshot builder**

```ts
// shared/src/calibration/snapshot.ts
//
// A frozen record of what the engine says today, so that every change to the
// physics shows up as a reviewable diff instead of a silent drift. This is not a
// correctness test — the numbers here are not known to be right. It is a tripwire.

import { BLUEPRINTS, BLUEPRINT_BY_ID } from '../blueprints.js';
import { simulate } from '../simulate.js';
import type { GraphDSL } from '../types.js';

export interface BlueprintSnapshot {
  verdict: string;
  bottleneckNodeId: string | null;
  totalDroppedRps: number;
  monthlyCost: number;
  flows: { name: string; offeredRps: number; completedRps: number; p50Ms: number; p99Ms: number; broken: boolean }[];
  nodes: { nodeId: string; utilization: number; latencyMs: number; capacityRps: number }[];
}

export type Snapshot = Record<string, BlueprintSnapshot>;

/** The same conversion the client does when a blueprint is placed. */
export function blueprintGraph(id: string): GraphDSL {
  const b = BLUEPRINT_BY_ID[id]!;
  return {
    nodes: b.nodes.map((n) => ({
      id: n.key,
      type: n.type,
      label: n.label,
      annotation: n.annotation,
      ...(n.attrs ? { attrs: n.attrs } : {}),
    })),
    edges: b.edges.map((e, i) => ({
      id: `e${i}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? '',
    })),
    stickies: [],
    flows: b.flows.map((f, i) => ({
      id: `f${i}`,
      name: f.name,
      kind: f.kind,
      steps: f.steps,
      rps: f.rps,
      description: f.description,
    })),
  };
}

export function snapshotAll(): Snapshot {
  const out: Snapshot = {};
  // Sorted so the file is stable across runs regardless of declaration order.
  for (const b of [...BLUEPRINTS].sort((x, y) => x.id.localeCompare(y.id))) {
    const sim = simulate(blueprintGraph(b.id), {
      rpsMultiplier: 1,
      killNodeIds: [],
      thirdPartyLatencyMs: 0,
    });
    out[b.id] = {
      verdict: sim.verdict,
      bottleneckNodeId: sim.bottleneckNodeId,
      totalDroppedRps: sim.totalDroppedRps,
      monthlyCost: sim.monthlyCost,
      flows: sim.flows
        .map((f) => ({
          name: f.name,
          offeredRps: f.offeredRps,
          completedRps: f.completedRps,
          p50Ms: f.p50Ms,
          p99Ms: f.p99Ms,
          broken: f.broken,
        }))
        .sort((a, z) => a.name.localeCompare(z.name)),
      nodes: sim.nodes
        .map((n) => ({
          nodeId: n.nodeId,
          utilization: n.utilization,
          latencyMs: n.latencyMs,
          capacityRps: n.capacityRps,
        }))
        .sort((a, z) => a.nodeId.localeCompare(z.nodeId)),
    };
  }
  return out;
}
```

- [ ] **Step 2: Write the test that generates and guards the baseline**

```ts
// shared/src/calibration/snapshot.test.ts
import { describe, expect, it } from 'vitest';
import { snapshotAll } from './snapshot.js';

describe('engine baseline', () => {
  it('matches the committed snapshot', async () => {
    // Vitest writes the file on first run and compares on every run after.
    // A deliberate physics change updates it with `-u` AND a reason in the commit.
    await expect(JSON.stringify(snapshotAll(), null, 2)).toMatchFileSnapshot(
      './baseline.json',
    );
  });

  it('is deterministic across runs', () => {
    expect(JSON.stringify(snapshotAll())).toBe(JSON.stringify(snapshotAll()));
  });
});
```

- [ ] **Step 3: Run to generate the baseline**

Run: `npm --workspace shared run test -- calibration/snapshot`
Expected: PASS, and `shared/src/calibration/baseline.json` now exists and is non-empty.

- [ ] **Step 4: Verify the baseline actually captured something**

Run: `node -e "const s=require('./shared/src/calibration/baseline.json'); const k=Object.keys(s); console.log(k.length, 'blueprints'); if(k.length===0) process.exit(1)"`
Expected: prints a non-zero blueprint count.

- [ ] **Step 5: Commit**

```bash
git add shared/src/calibration
git commit -m "A tripwire on the engine's current answers

Not a claim that these numbers are right. A claim that if they change,
somebody decided to change them."
```

---

### Task 2: Erlang-C queueing module

**Files:**
- Create: `shared/src/queueing.ts`
- Create: `shared/src/queueing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `erlangC(servers: number, offeredLoad: number): number`
  - `responseMultiple(utilization: number, servers: number): number`
  - `waitP99Ms(utilization: number, servers: number, serviceMs: number): number`
  - `const MAX_WAIT_MULTIPLE = 20`
  - `const ERLANG_MAX_SERVERS = 512`
  - `const TAIL_MULTIPLE_IDLE = 2.5`

- [ ] **Step 1: Write the failing tests**

```ts
// shared/src/queueing.test.ts
//
// Queueing is the one part of the engine with a known-correct answer, so these
// tests assert against published Erlang values rather than against the engine's
// own opinion.

import { describe, expect, it } from 'vitest';
import { erlangC, responseMultiple, waitP99Ms, MAX_WAIT_MULTIPLE } from './queueing.js';

describe('erlangC', () => {
  it('is the M/M/1 utilisation when there is one server', () => {
    // For c=1, Erlang-C reduces to a: the probability of waiting is the
    // utilisation itself.
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 6);
    expect(erlangC(1, 0.9)).toBeCloseTo(0.9, 6);
  });

  it('matches the published value for two servers at half load', () => {
    // Textbook M/M/2, a=1: C = 1/3.
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 6);
  });

  it('matches the published value for ten servers at 80% load', () => {
    // c=10, a=8 is a standard Erlang table entry: C ~= 0.4092.
    expect(erlangC(10, 8)).toBeCloseTo(0.4092, 3);
  });

  it('is zero-ish when servers hugely outnumber the load', () => {
    expect(erlangC(100, 1)).toBeLessThan(1e-6);
  });
});

describe('responseMultiple', () => {
  it('reduces exactly to the M/M/1 formula at one server', () => {
    // This is the regression guard: single-replica components must not move.
    for (const u of [0, 0.1, 0.5, 0.7, 0.9, 0.95]) {
      expect(responseMultiple(u, 1)).toBeCloseTo(1 / (1 - u), 6);
    }
  });

  it('is far gentler with many servers at the same utilisation', () => {
    // The whole point: 10 replicas at 80% is nothing like 1 replica at 80%.
    expect(responseMultiple(0.8, 1)).toBeCloseTo(5, 6);
    expect(responseMultiple(0.8, 10)).toBeCloseTo(1.2046, 3);
  });

  it('never returns less than one', () => {
    expect(responseMultiple(0, 8)).toBeGreaterThanOrEqual(1);
  });

  it('clamps at saturation rather than dividing by zero', () => {
    expect(responseMultiple(1, 4)).toBe(MAX_WAIT_MULTIPLE);
    expect(responseMultiple(1.5, 4)).toBe(MAX_WAIT_MULTIPLE);
  });

  it('treats a nonsensical server count as a single server', () => {
    expect(responseMultiple(0.5, 0)).toBeCloseTo(2, 6);
    expect(responseMultiple(0.5, Number.NaN)).toBeCloseTo(2, 6);
  });
});

describe('waitP99Ms', () => {
  it('is zero when queueing is negligible', () => {
    expect(waitP99Ms(0.1, 100, 50)).toBe(0);
  });

  it('matches the closed form for ten servers at 80%', () => {
    // C = 0.40918, mu = 1/50 per ms, c.mu.(1-u) = 0.04
    // ln(C/0.01)/0.04 = ln(40.918)/0.04 = 92.8ms
    expect(waitP99Ms(0.8, 10, 50)).toBeCloseTo(92.8, 0);
  });

  it('grows as utilisation rises', () => {
    expect(waitP99Ms(0.9, 10, 50)).toBeGreaterThan(waitP99Ms(0.8, 10, 50));
  });

  it('is zero for a free or nonsensical service time', () => {
    expect(waitP99Ms(0.8, 10, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --workspace shared run test -- queueing`
Expected: FAIL — `Failed to resolve import "./queueing.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/src/queueing.ts
//
// How long a request waits, given how busy a thing is and how many of it there are.
//
// The engine used to answer this with 1/(1-u) for every component. That is the
// M/M/1 response multiple: correct for ONE server, and badly wrong for twenty.
// A twenty-replica group at 90% utilisation was told its latency was ten times its
// service time, the same as a single replica at 90% — which penalises exactly the
// horizontally-scaled designs the tool exists to reward.
//
// Erlang-C is the multi-server generalisation, and at c=1 it reduces to the old
// formula exactly, so nothing single-replica moves.

/** Queue wait is clamped here: past this the number stops meaning anything. */
export const MAX_WAIT_MULTIPLE = 20;

/**
 * How much worse the slowest 1% is than the average, with nothing queueing at all.
 *
 * Not 1, and not derived: the service time is itself a distribution, and garbage
 * collection, scheduling and network jitter all land here. No closed form gives
 * this, so it stays an openly-labelled empirical constant while the queueing part
 * of the tail becomes a real percentile.
 */
export const TAIL_MULTIPLE_IDLE = 2.5;

/**
 * Iteration ceiling for the Erlang-B recurrence, which is O(servers).
 *
 * Beyond a few hundred parallel channels the probability of waiting at any
 * utilisation below saturation is already indistinguishable from zero, so more
 * servers change the answer by less than rounding — while costing a linear pass
 * inside the engine's relaxation loop. Capping here is a performance decision with
 * no measurable effect on the result.
 */
export const ERLANG_MAX_SERVERS = 512;

const clampServers = (servers: number): number => {
  if (!Number.isFinite(servers) || servers < 1) return 1;
  return Math.min(Math.floor(servers), ERLANG_MAX_SERVERS);
};

/**
 * Probability that an arriving request has to wait at all.
 *
 * Computed through the Erlang-B recurrence rather than the textbook
 * `a^c/c!` expression, which overflows to Infinity well before the server counts
 * this engine sees: a service with 64 workers on 10 replicas is 640 channels.
 *
 *   B(0) = 1
 *   B(k) = a.B(k-1) / (k + a.B(k-1))
 *   C    = B(c) / (1 - u(1 - B(c)))
 */
export function erlangC(servers: number, offeredLoad: number): number {
  const c = clampServers(servers);
  const a = Math.max(0, offeredLoad);
  if (a <= 0) return 0;

  let b = 1;
  for (let k = 1; k <= c; k += 1) {
    b = (a * b) / (k + a * b);
  }

  const u = a / c;
  if (u >= 1) return 1;
  const denominator = 1 - u * (1 - b);
  if (denominator <= 0) return 1;
  return Math.min(1, b / denominator);
}

/**
 * Response time as a multiple of service time: 1 + Wq/S.
 *
 * At c=1 this is exactly 1/(1-u), which is what the engine did before, so single
 * replica components are unchanged by construction.
 */
export function responseMultiple(utilization: number, servers: number): number {
  if (!Number.isFinite(utilization) || utilization <= 0) return 1;
  if (utilization >= 1) return MAX_WAIT_MULTIPLE;

  const c = clampServers(servers);
  const a = c * utilization;
  const c_erlang = erlangC(c, a);
  const multiple = 1 + c_erlang / (c * (1 - utilization));
  return Math.min(Math.max(1, multiple), MAX_WAIT_MULTIPLE);
}

/**
 * The 99th percentile of time spent waiting for a server, in milliseconds.
 *
 * For M/M/c the waiting time is exponential above an atom at zero:
 *   P(W > t) = C.exp(-c.mu.(1-u).t)
 * so the 99th percentile is ln(C/0.01) / (c.mu.(1-u)), and zero whenever fewer
 * than 1% of requests wait at all.
 */
export function waitP99Ms(utilization: number, servers: number, serviceMs: number): number {
  if (!Number.isFinite(serviceMs) || serviceMs <= 0) return 0;
  if (!Number.isFinite(utilization) || utilization <= 0) return 0;
  if (utilization >= 1) return serviceMs * MAX_WAIT_MULTIPLE;

  const c = clampServers(servers);
  const c_erlang = erlangC(c, c * utilization);
  if (c_erlang <= 0.01) return 0;

  const mu = 1 / serviceMs;
  const rate = c * mu * (1 - utilization);
  if (rate <= 0) return serviceMs * MAX_WAIT_MULTIPLE;
  return Math.min(Math.log(c_erlang / 0.01) / rate, serviceMs * MAX_WAIT_MULTIPLE);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --workspace shared run test -- queueing`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add shared/src/queueing.ts shared/src/queueing.test.ts
git commit -m "Erlang-C, so twenty replicas stop queueing like one

1/(1-u) is a single-server formula and the engine applied it to every
component regardless of replica count. At c=1 this reduces to exactly
that, so nothing single-replica moves; at c=10 and 80% busy it is 1.20
instead of 5."
```

---

### Task 3: Wire queueing into the engine

**Files:**
- Modify: `shared/src/engine.ts` — delete `waitMultiple` (line ~430), delete the local `TAIL_MULTIPLE_IDLE` (line ~289), import from `./queueing.js`
- Modify: `shared/src/simulate.ts:195` — it imports `TAIL_MULTIPLE_IDLE` from `./engine.js`
- Modify: `shared/src/calibration/baseline.json` — regenerated
- Test: `shared/src/engine.test.ts`

**Interfaces:**
- Consumes: `responseMultiple`, `waitP99Ms`, `TAIL_MULTIPLE_IDLE` from `./queueing.js` (Task 2)
- Produces: `HopState` gains `servers: number` — the parallel channel count used for queueing, so the report can show it.

- [ ] **Step 1: Write the failing test**

```ts
// Append to shared/src/engine.test.ts

describe('queueing depends on how many channels a thing has', () => {
  // concurrency 1 makes each replica a single server, so the arithmetic below is
  // hand-checkable and ties directly to the queueing unit tests. Real components
  // hold many requests at once, which is exactly why this change is broad.
  const busy = (replicas: number) => {
    const perReplica = 10; // 1 in flight / 100ms
    const g = graph(
      [
        node('web', 'client', { trafficRps: perReplica * replicas * 0.8 }),
        node('api', 'service', { concurrency: 1, latencyMs: 100, replicas }),
      ],
      [edge('web', 'api')],
    );
    return hop(runEngine(g, scenario()), 'api');
  };

  it('a single channel at 80% queues exactly like M/M/1', () => {
    // 100ms x 1/(1-0.8) = 500ms, which is what the old formula gave.
    expect(busy(1).latencyMs).toBeCloseTo(500, 0);
    expect(busy(1).servers).toBe(1);
  });

  it('ten channels at the same 80% barely queue at all', () => {
    // responseMultiple(0.8, 10) = 1.2046 => 120.5ms, not 500ms.
    expect(busy(10).latencyMs).toBeCloseTo(120.5, 0);
    expect(busy(10).servers).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace shared run test -- engine`
Expected: FAIL — `ten replicas at the same 80%` expects <115 but gets 500; `servers` is undefined.

- [ ] **Step 3: Replace the formula in `engine.ts`**

Delete the `TAIL_MULTIPLE_IDLE` constant block (around line 280-289) and the `waitMultiple` function (around line 429-434). Add to the imports at the top:

```ts
import {
  MAX_WAIT_MULTIPLE,
  responseMultiple,
  waitP99Ms,
  TAIL_MULTIPLE_IDLE,
} from './queueing.js';
```

Re-export so `simulate.ts` and any other consumer keep working unchanged:

```ts
export { TAIL_MULTIPLE_IDLE, MAX_WAIT_MULTIPLE } from './queueing.js';
```

Add `servers` to `HopState`:

```ts
export interface HopState {
  // ... existing fields ...
  /** Parallel service channels used for queueing: concurrency x replicas x shards. */
  servers: number;
}
```

Add a helper next to `perReplicaCapacity`:

```ts
/**
 * Parallel service channels. Capacity is `channels / serviceMs`, so the channel
 * count and the capacity are the same statement — which is why queueing must be
 * computed from this rather than from the replica count. Ten replicas of a
 * 64-worker service is 640 channels, not 10.
 */
function serversOf(node: GraphNode, replicas: number): number {
  const concurrency = num(node.attrs?.concurrency, concurrencyFor(node));
  const shards = Math.max(1, Math.floor(num(node.attrs?.shards, 1)));
  return Math.max(1, Math.round(concurrency * replicas * shards));
}
```

Add `servers` to `NodeRuntime` and set it where the runtime is built (in the `for (const node of prep.nodes)` loop that calls `runtime.set`):

```ts
        servers: serversOf(node, replicas),
```

Replace the latency line (around line 992):

```ts
      r.latencyMs = r.bypassed ? 0 : r.serviceMs * responseMultiple(r.utilization, r.servers);
```

Replace the two tail computations. In the path-latency loop (around line 1112):

```ts
          tail += r.latencyMs + waitP99Ms(r.utilization, r.servers, r.serviceMs)
            + r.serviceMs * (TAIL_MULTIPLE_IDLE - 1);
```

And add `servers` to the `HopState` literal in the `states` map (around line 1139):

```ts
        servers: r.servers,
```

- [ ] **Step 4: Update `simulate.ts` to use the real percentile**

In `flowResults` (around line 195), replace:

```ts
      p99 += hop.latencyMs * (TAIL_MULTIPLE_IDLE + 2 * Math.min(1, hop.utilization));
```

with:

```ts
      // Service-time variability (an estimate) plus the true M/M/c queueing
      // percentile (a closed form), rather than one factor standing for both.
      p99 += hop.latencyMs + waitP99Ms(hop.utilization, hop.servers, hop.latencyMs);
```

and change its import line to pull `waitP99Ms` and `TAIL_MULTIPLE_IDLE` from `./queueing.js`.

- [ ] **Step 5: Run the new test**

Run: `npm --workspace shared run test -- engine`
Expected: PASS on the three new cases.

- [ ] **Step 6: Run the whole shared suite and review the fallout**

Run: `npm --workspace shared run test`
Expected: the snapshot test FAILS, and many existing numeric expectations in `engine.test.ts` / `simulate.test.ts` fail. This is the intended blast radius, and it is **wide**.

Be clear about why, because it is easy to expect the wrong thing here. The channel count is `concurrency x replicas x shards`, **not** the replica count. A service with 64 workers on a single replica is a 64-server queue, not a one-server queue. So the old `1/(1-u)` was wrong for almost every component in the catalogue, not merely for the replicated ones, and almost every latency number in the suite will now come down.

The invariant to check is therefore narrower than "single-replica is unchanged". It is:

- Anything whose channel count is genuinely 1 — `human_review`, or a component explicitly given `concurrency: 1` — must be **byte-identical**.
- Everything else should get **faster**, never slower.
- Nothing should move from a lower utilisation to a higher one; this task does not touch capacity at all.

A latency that went *up*, or a utilisation that changed, is a bug in this task rather than a baseline to accept.

- [ ] **Step 7: Update expectations and regenerate the baseline**

Run: `npm --workspace shared run test -- -u`
Then confirm: `npm --workspace shared run test`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add shared/src
git commit -m "The engine counts its channels before it queues

A service with 64 workers is a 64-server queue. 1/(1-u) is the formula for
one, and it was applied to everything — so this moves almost every latency
number in the suite downward, not just the replicated ones. Components
genuinely holding one request at a time are byte-identical, because
Erlang-C at c=1 is exactly 1/(1-u).

p99 is now a real M/M/c percentile plus a labelled estimate for
service-time spread, rather than one invented factor standing for both.

Baseline regenerated: latency down broadly, utilisation untouched."
```

---

### Task 4: Network placement module and schema

**Files:**
- Create: `shared/src/network.ts`
- Create: `shared/src/network.test.ts`
- Modify: `shared/src/types.ts` — add `placement` to `GraphEdge`, `region` to `NodeAttrs`
- Modify: `shared/src/index.ts` — export `./network.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Placement = 'same-host' | 'same-az' | 'cross-az' | 'cross-region' | 'internet'`
  - `rttMs(placement: Placement | undefined, fromRegion?: string, toRegion?: string): number`
  - `inferPlacement(fromRegion?: string, toRegion?: string): Placement`
  - `const DEFAULT_PLACEMENT: Placement = 'same-az'`

- [ ] **Step 1: Add the schema fields**

In `shared/src/types.ts`, add to `NodeAttrs` (after `multiAz`):

```ts
  /**
   * Where this runs, e.g. 'us-east-1'. Decides cross-region distance when two
   * connected components name different regions.
   */
  region?: string;
```

Add to `GraphEdge` (after `retries`):

```ts
  /**
   * How far apart the two ends are. Distance is not free: it adds to the caller's
   * latency AND holds its worker for longer, which is where a cross-region
   * synchronous call actually hurts. Defaults to same-az, so an unannotated
   * drawing behaves as it always did.
   */
  placement?: import('./network.js').Placement;
```

- [ ] **Step 2: Write the failing tests**

```ts
// shared/src/network.test.ts
import { describe, expect, it } from 'vitest';
import { rttMs, inferPlacement, DEFAULT_PLACEMENT } from './network.js';

describe('rttMs', () => {
  it('defaults to same-az when nothing is stated', () => {
    expect(rttMs(undefined)).toBe(rttMs(DEFAULT_PLACEMENT));
  });

  it('gets more expensive the further apart things are', () => {
    expect(rttMs('same-host')).toBeLessThan(rttMs('same-az'));
    expect(rttMs('same-az')).toBeLessThan(rttMs('cross-az'));
    expect(rttMs('cross-az')).toBeLessThan(rttMs('cross-region'));
  });

  it('uses the measured pair when both regions are known', () => {
    const measured = rttMs('cross-region', 'us-east-1', 'eu-west-1');
    expect(measured).toBeGreaterThan(50);
    expect(measured).toBeLessThan(120);
  });

  it('is symmetric', () => {
    expect(rttMs('cross-region', 'us-east-1', 'eu-west-1')).toBe(
      rttMs('cross-region', 'eu-west-1', 'us-east-1'),
    );
  });

  it('falls back to a generic figure for an unknown pair', () => {
    expect(rttMs('cross-region', 'moon-north-1', 'us-east-1')).toBeGreaterThan(0);
  });

  it('is zero-cost for a same-region pair even if marked cross-region', () => {
    // Two boxes in the same region are not far apart, whatever the edge claims.
    expect(rttMs('cross-region', 'us-east-1', 'us-east-1')).toBe(rttMs('same-az'));
  });
});

describe('inferPlacement', () => {
  it('is the default when neither end names a region', () => {
    expect(inferPlacement(undefined, undefined)).toBe(DEFAULT_PLACEMENT);
  });

  it('is same-az within one region', () => {
    expect(inferPlacement('us-east-1', 'us-east-1')).toBe('same-az');
  });

  it('is cross-region across two', () => {
    expect(inferPlacement('us-east-1', 'eu-west-1')).toBe('cross-region');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm --workspace shared run test -- network`
Expected: FAIL — cannot resolve `./network.js`.

- [ ] **Step 4: Write the implementation**

```ts
// shared/src/network.ts
//
// What distance costs.
//
// Until now an edge was free: two boxes in the same rack and two boxes on opposite
// sides of the planet contributed identically to a request's latency, which is
// zero. That made multi-region active-active free to draw, and it is the one thing
// about multi-region that is definitely not free.
//
// The numbers below are round. Same-AZ and cross-AZ come from provider
// documentation; cross-region pairs are measured. A reader who knows better can
// state a region on both ends and get the measured pair instead.

export type Placement = 'same-host' | 'same-az' | 'cross-az' | 'cross-region' | 'internet';

export const DEFAULT_PLACEMENT: Placement = 'same-az';

/** Round-trip milliseconds by placement, before any region pair is consulted. */
export const PLACEMENT_RTT_MS: Record<Placement, number> = {
  /** Loopback or unix socket. Not zero, but close enough that it rounds to it. */
  'same-host': 0.05,
  /** Within one availability zone. */
  'same-az': 0.5,
  /** Between zones in one region — provider-documented single-digit milliseconds. */
  'cross-az': 1,
  /** Overridden by the measured pair whenever both ends name a region. */
  'cross-region': 70,
  /** A client on the public internet reaching an edge. */
  internet: 40,
};

/**
 * Measured round-trip times between regions, milliseconds.
 *
 * A deliberately small starting set covering the pairs that appear in the problem
 * bank's multi-region sheets. Keys are sorted-and-joined so one entry serves both
 * directions; distance is symmetric and storing it twice invites the two halves to
 * disagree.
 */
export const REGION_RTT_MS: Record<string, number> = {
  'ap-southeast-1|us-east-1': 215,
  'ap-southeast-1|eu-west-1': 175,
  'eu-central-1|us-east-1': 90,
  'eu-west-1|us-east-1': 75,
  'eu-west-1|us-west-2': 130,
  'us-east-1|us-east-2': 12,
  'us-east-1|us-west-2': 62,
};

const pairKey = (a: string, b: string): string => [a, b].sort().join('|');

/** What placement two regions imply, when the edge itself does not say. */
export function inferPlacement(fromRegion?: string, toRegion?: string): Placement {
  if (!fromRegion || !toRegion) return DEFAULT_PLACEMENT;
  return fromRegion === toRegion ? 'same-az' : 'cross-region';
}

/**
 * Round-trip milliseconds for one hop.
 *
 * A stated region pair always wins over the placement label: if both ends say
 * `us-east-1`, they are not far apart however the edge is annotated, and if they
 * say different regions the measured distance beats the generic 70.
 */
export function rttMs(
  placement: Placement | undefined,
  fromRegion?: string,
  toRegion?: string,
): number {
  if (fromRegion && toRegion) {
    if (fromRegion === toRegion) return PLACEMENT_RTT_MS['same-az'];
    const measured = REGION_RTT_MS[pairKey(fromRegion, toRegion)];
    if (measured !== undefined) return measured;
    return PLACEMENT_RTT_MS['cross-region'];
  }
  return PLACEMENT_RTT_MS[placement ?? DEFAULT_PLACEMENT];
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm --workspace shared run test -- network`
Expected: PASS.

- [ ] **Step 6: Export it**

Add to `shared/src/index.ts`, after the `families.js` line:

```ts
export * from './network.js';
export * from './queueing.js';
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add shared/src/network.ts shared/src/network.test.ts shared/src/types.ts shared/src/index.ts
git commit -m "Distance exists

An edge cost zero milliseconds whether it crossed a rack or an ocean,
which made multi-region the one architecture with no downside. Placement
defaults to same-az, so nothing already drawn changes until it says
otherwise."
```

---

### Task 5: Dependency occupancy

The headline mechanism. A caller holds a worker for its own work **plus** everything it synchronously waits on, so a slow dependency costs its caller throughput.

**Files:**
- Modify: `shared/src/engine.ts`
- Test: `shared/src/engine.test.ts`

**Interfaces:**
- Consumes: `rttMs`, `inferPlacement` from `./network.js` (Task 4); `responseMultiple` from `./queueing.js` (Task 2)
- Produces: `HopState` gains `occupancyMs: number` — own service time plus synchronous downstream wait.

- [ ] **Step 1: Write the failing test**

```ts
// Append to shared/src/engine.test.ts

describe('a caller pays for what it waits on', () => {
  const chain = (dbMs: number) =>
    graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        // 8 concurrent slots. Alone it would serve 8/0.010 = 800 rps.
        node('api', 'service', { vcpu: 1, latencyMs: 10 }),
        node('db', 'sql_db', { latencyMs: dbMs, capacityRps: 100000 }),
      ],
      [edge('api', 'db'), edge('web', 'api')],
    );

  it('a fast dependency leaves the caller near its own limit', () => {
    // 10ms own + ~10ms db + 0.5ms wire => ~20.5ms occupancy => ~390 rps.
    const api = hop(runEngine(chain(10), scenario()), 'api');
    expect(api.capacityRps).toBeGreaterThan(350);
    expect(api.capacityRps).toBeLessThan(420);
  });

  it('a slow dependency costs the caller throughput it never used', () => {
    // Same 8 workers, now held ~510ms each: roughly 16 rps.
    const api = hop(runEngine(chain(500), scenario()), 'api');
    expect(api.capacityRps).toBeLessThan(25);
    expect(api.capacityRps).toBeGreaterThan(10);
  });

  it('reports the occupancy it charged', () => {
    const api = hop(runEngine(chain(500), scenario()), 'api');
    expect(api.occupancyMs).toBeGreaterThan(500);
  });

  it('does not charge the caller for asynchronous hand-offs', () => {
    // Nobody waits past a hand-off, so a slow consumer costs the producer nothing.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 100 }),
        node('api', 'service', { vcpu: 1, latencyMs: 10 }),
        node('q', 'queue'),
      ],
      [edge('api', 'q', { kind: 'async' }), edge('web', 'api')],
    );
    const api = hop(runEngine(g, scenario()), 'api');
    expect(api.occupancyMs).toBeCloseTo(10, 0);
  });

  it('never charges more than the caller is willing to wait', () => {
    // A 2s timeout means the worker is released at 2s, not held for 30.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 1 }),
        node('api', 'service', { vcpu: 1, latencyMs: 10, timeoutMs: 2000 }),
        node('slow', 'third_party', { latencyMs: 30000, capacityRps: 100000 }),
      ],
      [edge('api', 'slow'), edge('web', 'api')],
    );
    expect(hop(runEngine(g, scenario()), 'api').occupancyMs).toBeLessThanOrEqual(2000);
  });

  it('terminates on a cycle instead of recursing forever', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 10 }),
        node('a', 'service', { latencyMs: 10 }),
        node('b', 'service', { latencyMs: 10 }),
      ],
      [edge('web', 'a'), edge('a', 'b'), edge('b', 'a')],
    );
    expect(() => runEngine(g, scenario())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace shared run test -- engine`
Expected: FAIL — capacity is ~800 regardless of `dbMs`, and `occupancyMs` is undefined.

- [ ] **Step 3: Implement occupancy in `engine.ts`**

Add `occupancyMs` to `HopState` and to `NodeRuntime`:

```ts
  /** Own service time plus everything synchronously waited on, ms. */
  occupancyMs: number;
```

Initialise it to `serviceMs` where `NodeRuntime` is built (`occupancyMs: serviceMs,`), and add `occupancyMs: round(r.occupancyMs),` to the `HopState` literal in the `states` map.

Add this function above `runEngine`:

```ts
/**
 * A caller holds a worker for its own work AND for everything it waits on. That
 * relationship is why a payment provider slowing to four seconds takes out a
 * checkout API that is nowhere near its request limit — and it is the mechanism
 * this engine documented in three places and did not implement.
 *
 * Solved by walking the graph downward from each node, memoised per pass. Cycles
 * return the node's own service time rather than recursing, and every result is
 * capped at what the caller is prepared to wait: a caller that gives up at two
 * seconds does not hold a worker for thirty.
 */
function computeOccupancy(prep: Prepared, runtime: Map<string, NodeRuntime>): void {
  const memo = new Map<string, number>();

  const responseOf = (nodeId: string, visiting: Set<string>): number => {
    const r = runtime.get(nodeId);
    if (!r) return 0;
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return r.serviceMs;

    visiting.add(nodeId);
    let downstream = 0;
    for (const e of prep.out.get(nodeId) ?? []) {
      // Past a hand-off nobody is waiting, so it costs the caller nothing.
      if (e.kind === 'async') continue;
      const target = runtime.get(e.to);
      if (!target) continue;
      const share = Math.min(1, num(e.share, 1));
      const wire = rttMs(
        e.placement ?? inferPlacement(r.node.attrs?.region, target.node.attrs?.region),
        r.node.attrs?.region,
        target.node.attrs?.region,
      );
      downstream += share * (wire + responseOf(e.to, visiting));
    }
    visiting.delete(nodeId);

    const occupancy = Math.min(
      r.serviceMs + downstream,
      num(r.node.attrs?.timeoutMs, defaultTimeoutFor(r.node, r.family)),
    );
    r.occupancyMs = occupancy;
    // What the CALLER above experiences is this node's queued response, not its
    // bare occupancy — so the wait it is already suffering propagates upward.
    const response = occupancy * responseMultiple(r.utilization, r.servers);
    memo.set(nodeId, response);
    return response;
  };

  for (const node of prep.nodes) responseOf(node.id, new Set());
}
```

Change `perReplicaCapacity` to take occupancy rather than raw service time — rename its second parameter and its callers:

```ts
function perReplicaCapacity(node: GraphNode, occupancyMs: number): number {
  const explicit = node.attrs?.capacityRps;
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  if (occupancyMs <= 0) return DEFAULT_CAPACITY[node.type] ?? 500;
  const concurrency = num(node.attrs?.concurrency, concurrencyFor(node));
  const shards = Math.max(1, Math.floor(num(node.attrs?.shards, 1)));
  return (concurrency / (occupancyMs / 1000)) * shards;
}
```

Inside the relaxation loop, immediately **before** the shared-host block (the `for (const [hostId, memberIds] of prep.hosted)` loop), recompute occupancy and capacity from it. The ordering matters and is load-bearing: the shared-host block — and the connection pools added in Task 7 — measure demand in concurrency-seconds, which needs `occupancyMs` to already be correct for this round.

```ts
      // Occupancy first: capacity depends on what each caller is waiting for, and
      // what it is waiting for depends on how busy that thing is. Same fixpoint
      // the retry multiplier already relies on, resolved by the same rounds.
      computeOccupancy(prep, runtime);
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        if (r.down || PASSIVE_FAMILIES.has(r.family) || r.node.attrs?.elastic === true) continue;
        if (typeof r.node.attrs?.capacityRps === 'number' && r.node.attrs.capacityRps > 0) continue;
        r.capacity = Math.max(0, perReplicaCapacity(r.node, r.occupancyMs) * r.replicas);
      }
```

Add the network import at the top of `engine.ts`:

```ts
import { rttMs, inferPlacement } from './network.js';
```

- [ ] **Step 4: Run the new tests**

Run: `npm --workspace shared run test -- engine`
Expected: PASS on all six new cases.

- [ ] **Step 5: Assert the relaxation actually converges**

```ts
// Append to shared/src/engine.test.ts

it('settles rather than oscillating on a deep synchronous chain', () => {
  const nodes = [node('web', 'client', { trafficRps: 50 })];
  const edges = [edge('web', 's0')];
  for (let i = 0; i < 10; i += 1) {
    nodes.push(node(`s${i}`, 'service', { vcpu: 1, latencyMs: 20 }));
    if (i > 0) edges.push(edge(`s${i - 1}`, `s${i}`));
  }
  const g = graph(nodes, edges);
  // Two runs of the same input must agree exactly: if relaxation had not
  // converged, tick-to-tick state would leak and the last tick would wander.
  const a = runEngine(g, scenario({ horizonS: 30 }));
  const b = runEngine(g, scenario({ horizonS: 30 }));
  expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
  const lastTwo = a.ticks.slice(-2);
  expect(lastTwo[0]!.p99Ms).toBeCloseTo(lastTwo[1]!.p99Ms, 6);
});
```

Run: `npm --workspace shared run test -- engine`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and review the fallout**

Run: `npm --workspace shared run test`
Expected: the snapshot fails and several blueprint flows now carry higher latency and lower capacity. Read each diff. A design whose capacity dropped because it calls something slow is **correct**; a design whose capacity dropped with no synchronous dependency is a bug in this task.

- [ ] **Step 7: Update expectations, regenerate baseline, typecheck**

Run: `npm --workspace shared run test -- -u`
Then: `npm --workspace shared run test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add shared/src
git commit -m "The slow dependency finally costs its caller something

CONCURRENT_REQUESTS_PER_VCPU said it. The concurrency param hint said it.
A test was named after it. Nothing did it: perReplicaCapacity read only a
node's own latencyMs, so slowing a payment gateway to four seconds left
the checkout API's capacity untouched.

Capacity now divides concurrency by occupancy — own work plus every
synchronous call, wire time included — resolved in the relaxation loop
that already existed for retries, capped at the caller's timeout so the
death spiral terminates."
```

---

### Task 6: Network latency on the request path

Occupancy already charges the wire to the caller's *capacity*. This task adds it to reported *latency*, which is a separate code path.

**Files:**
- Modify: `shared/src/engine.ts` — the path-latency loop (~line 1096)
- Test: `shared/src/engine.test.ts`

**Interfaces:**
- Consumes: `rttMs`, `inferPlacement` from `./network.js` (Task 4)
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```ts
// Append to shared/src/engine.test.ts

describe('the wire shows up in the reported latency', () => {
  const twoHop = (placement?: 'same-az' | 'cross-region') =>
    graph(
      [
        node('web', 'client', { trafficRps: 1 }),
        node('api', 'service', { latencyMs: 10, capacityRps: 100000 }),
        node('db', 'sql_db', { latencyMs: 10, capacityRps: 100000 }),
      ],
      [edge('web', 'api'), edge('api', 'db', placement ? { placement } : {})],
    );

  it('adds almost nothing within a zone', () => {
    const p50 = last(runEngine(twoHop('same-az'), scenario()).ticks).p50Ms;
    expect(p50).toBeGreaterThan(20);
    expect(p50).toBeLessThan(22);
  });

  it('adds the real distance across regions', () => {
    const near = last(runEngine(twoHop('same-az'), scenario()).ticks).p50Ms;
    const far = last(runEngine(twoHop('cross-region'), scenario()).ticks).p50Ms;
    expect(far - near).toBeGreaterThan(60);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace shared run test -- engine`
Expected: FAIL — `far - near` is 0.

- [ ] **Step 3: Add the wire to the path walk**

In the path-latency loop in `runEngine`, inside the `if (!link) continue;` block, after the async check, add the hop cost. Replace:

```ts
        if (link.kind === 'async') waiting = false;
```

with:

```ts
        if (waiting) {
          const nextRuntime = runtime.get(next);
          const wire = rttMs(
            link.placement ??
              inferPlacement(r.node.attrs?.region, nextRuntime?.node.attrs?.region),
            r.node.attrs?.region,
            nextRuntime?.node.attrs?.region,
          );
          latency += wire;
          tail += wire;
        }
        if (link.kind === 'async') waiting = false;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace shared run test -- engine`
Expected: PASS.

- [ ] **Step 5: Add the wire to the named-flow report**

In `shared/src/simulate.ts`, `flowResults` walks `journey.steps` without consulting edges. Add the hop cost between consecutive steps. After the `for (const stepId of journey.steps)` loop's existing body, thread the previous node so the wire between them can be charged:

```ts
    let previousId: string | undefined;
    for (const stepId of journey.steps) {
      const hop = byId.get(stepId);
      if (!hop) {
        notes.push(`${stepId} is named in this flow but not in the drawing.`);
        continue;
      }
      if (previousId !== undefined) {
        const link = graph.edges.find((e) => e.from === previousId && e.to === stepId);
        const from = nodesById.get(previousId);
        const to = nodesById.get(stepId);
        const wire = rttMs(
          link?.placement ?? inferPlacement(from?.attrs?.region, to?.attrs?.region),
          from?.attrs?.region,
          to?.attrs?.region,
        );
        p50 += wire;
        p99 += wire;
      }
      previousId = stepId;
      // ... existing survival / latency accumulation unchanged ...
    }
```

Add `import { rttMs, inferPlacement } from './network.js';` and make `nodesById` available inside `flowResults` by passing it in from `report`.

- [ ] **Step 6: Run the full suite, update, regenerate**

Run: `npm --workspace shared run test`
Expected: snapshot and some latency expectations fail — every flow is now slightly slower, and any cross-region flow much slower.

Run: `npm --workspace shared run test -- -u`
Then: `npm --workspace shared run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src
git commit -m "Latency reports include the wire it travelled

Occupancy already charged the caller for distance. This is the other half:
the number shown to the reader. Every flow gets marginally slower and a
cross-region hop gets 70ms slower, which is the point."
```

---

### Task 7: Connection pools

**Files:**
- Create: `shared/src/pools.ts`
- Create: `shared/src/pools.test.ts`
- Modify: `shared/src/types.ts` — add `poolSize`, `maxConnections` to `NodeAttrs`
- Modify: `shared/src/params.ts` — expose them
- Modify: `shared/src/engine.ts` — replace the inline shared-host block, add pool admission
- Modify: `shared/src/index.ts` — export `./pools.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PoolDemand { arrivingRps: number; occupancyMs: number }`
  - `slotsNeeded(demand: PoolDemand): number`
  - `admit(demandRps: number, slotsNeeded: number, slotsAvailable: number): { admittedRps: number; rejectedRps: number }`
  - `shareOut(demands: number[], supply: number): number[]`

- [ ] **Step 1: Write the failing tests**

```ts
// shared/src/pools.test.ts
//
// A pool is the same arithmetic wherever it appears: demand measured in
// concurrency-seconds against a supply measured in slots. Shared worker pools and
// database connection pools differ only in what the slots are called.

import { describe, expect, it } from 'vitest';
import { slotsNeeded, admit, shareOut } from './pools.js';

describe('slotsNeeded', () => {
  it('is Little’s law: arrivals times how long each is held', () => {
    // 100 rps each held 200ms needs 20 concurrent slots.
    expect(slotsNeeded({ arrivingRps: 100, occupancyMs: 200 })).toBeCloseTo(20, 6);
  });

  it('is zero when nothing arrives', () => {
    expect(slotsNeeded({ arrivingRps: 0, occupancyMs: 200 })).toBe(0);
  });

  it('is zero for instantaneous work', () => {
    expect(slotsNeeded({ arrivingRps: 100, occupancyMs: 0 })).toBe(0);
  });
});

describe('admit', () => {
  it('lets everything through when the pool is big enough', () => {
    expect(admit(100, 20, 50)).toEqual({ admittedRps: 100, rejectedRps: 0 });
  });

  it('admits proportionally when the pool is too small', () => {
    // Needs 40 slots, has 20: half the traffic gets a connection.
    expect(admit(100, 40, 20)).toEqual({ admittedRps: 50, rejectedRps: 50 });
  });

  it('rejects everything when there is no pool at all', () => {
    expect(admit(100, 40, 0)).toEqual({ admittedRps: 0, rejectedRps: 100 });
  });

  it('treats an unbounded pool as no constraint', () => {
    expect(admit(100, 40, Number.POSITIVE_INFINITY)).toEqual({
      admittedRps: 100,
      rejectedRps: 0,
    });
  });
});

describe('shareOut', () => {
  it('leaves everyone alone when supply covers demand', () => {
    expect(shareOut([10, 20], 50)).toEqual([10, 20]);
  });

  it('squeezes everyone by the same factor, playing no favourites', () => {
    // 30 wanted, 15 available: everyone gets half.
    expect(shareOut([10, 20], 15)).toEqual([5, 10]);
  });

  it('gives nothing to anyone when there is nothing', () => {
    expect(shareOut([10, 20], 0)).toEqual([0, 0]);
  });

  it('handles an empty pool of members', () => {
    expect(shareOut([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --workspace shared run test -- pools`
Expected: FAIL — cannot resolve `./pools.js`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/src/pools.ts
//
// Anything with a fixed number of slots, and what happens when more work wants one
// than there are.
//
// Two things in this engine have that shape and used to be modelled separately or
// not at all: a boundary declared a shared host, where six pipeline stages compete
// for one worker group's machines, and a connection pool in front of a database,
// where fifty service replicas holding twenty connections each meet a Postgres
// instance that accepts a hundred. The second is among the most common real
// outages and was entirely invisible.
//
// The quantity that composes is concurrency, not requests per second: components
// sharing a pool have different service times, and a parser held for 2.5 seconds
// costs the pool far more per request than a chunker held for 20ms.

export interface PoolDemand {
  arrivingRps: number;
  /** How long each request holds its slot — own work plus what it waits on. */
  occupancyMs: number;
}

/** Little's law: concurrent slots required to sustain this arrival rate. */
export function slotsNeeded(demand: PoolDemand): number {
  const rps = Math.max(0, demand.arrivingRps);
  const ms = Math.max(0, demand.occupancyMs);
  if (rps <= 0 || ms <= 0) return 0;
  return rps * (ms / 1000);
}

/**
 * What gets a slot and what is turned away.
 *
 * Proportional rather than first-come: at steady state a pool that can serve half
 * the demand serves half of it, and which specific requests lose is not something
 * a deterministic model should pretend to know.
 */
export function admit(
  demandRps: number,
  needed: number,
  available: number,
): { admittedRps: number; rejectedRps: number } {
  const rps = Math.max(0, demandRps);
  if (!Number.isFinite(available)) return { admittedRps: rps, rejectedRps: 0 };
  if (available <= 0) return { admittedRps: 0, rejectedRps: rps };
  if (needed <= available || needed <= 0) return { admittedRps: rps, rejectedRps: 0 };
  const admitted = rps * (available / needed);
  return { admittedRps: admitted, rejectedRps: rps - admitted };
}

/**
 * Divide a fixed supply between competing members. Everyone is squeezed by the
 * same factor: a pool does not choose favourites.
 */
export function shareOut(demands: readonly number[], supply: number): number[] {
  const total = demands.reduce((sum, d) => sum + Math.max(0, d), 0);
  if (total <= 0) return demands.map(() => 0);
  if (!Number.isFinite(supply)) return demands.map((d) => Math.max(0, d));
  if (supply <= 0) return demands.map(() => 0);
  if (total <= supply) return demands.map((d) => Math.max(0, d));
  const factor = supply / total;
  return demands.map((d) => Math.max(0, d) * factor);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --workspace shared run test -- pools`
Expected: PASS.

- [ ] **Step 5: Add the schema fields**

In `shared/src/types.ts`, `NodeAttrs`:

```ts
  /**
   * Connections this pooler or proxy holds open. Above it, callers queue for a
   * connection rather than for the database.
   */
  poolSize?: number;
  /**
   * Connections this datastore accepts before refusing. Postgres defaults to 100,
   * which fifty serverless replicas will exhaust without noticing.
   */
  maxConnections?: number;
```

In `shared/src/params.ts`, add the two specs and wire them in:

```ts
const POOL_SIZE: ParamSpec = {
  key: 'poolSize',
  label: 'Connections held open',
  hint: 'The pool in front of the store. Callers above this queue for a connection, not for the data.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const MAX_CONNECTIONS: ParamSpec = {
  key: 'maxConnections',
  label: 'Connections it accepts',
  hint: 'What the store itself allows. Fifty replicas holding twenty each will exhaust a hundred without ever hitting a request limit.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};
```

Add `POOL_SIZE` to the `routing` list and `MAX_CONNECTIONS` to the `datastore` list in `PARAMS_BY_FAMILY`.

- [ ] **Step 6: Write the engine test**

```ts
// Append to shared/src/engine.test.ts

describe('connection pools run out', () => {
  it('a store refuses what its connection limit cannot hold', () => {
    // 500 rps each holding a connection for 50ms needs 25 connections.
    // The store accepts 10, so 60% of the traffic never gets one.
    const g = graph(
      [
        node('web', 'client', { trafficRps: 500 }),
        node('api', 'service', { capacityRps: 100000, latencyMs: 1 }),
        node('db', 'sql_db', { latencyMs: 50, capacityRps: 100000, maxConnections: 10 }),
      ],
      [edge('web', 'api'), edge('api', 'db')],
    );
    const db = hop(runEngine(g, scenario()), 'db');
    expect(db.droppedRps).toBeGreaterThan(250);
    expect(db.servedRps).toBeCloseTo(200, -1);
  });

  it('leaves a store alone when nobody stated a limit', () => {
    const g = graph(
      [
        node('web', 'client', { trafficRps: 500 }),
        node('api', 'service', { capacityRps: 100000, latencyMs: 1 }),
        node('db', 'sql_db', { latencyMs: 50, capacityRps: 100000 }),
      ],
      [edge('web', 'api'), edge('api', 'db')],
    );
    expect(hop(runEngine(g, scenario()), 'db').droppedRps).toBe(0);
  });
});
```

- [ ] **Step 7: Wire pools into the engine**

Add `import { slotsNeeded, admit, shareOut } from './pools.js';` to `engine.ts`.

Replace the shared-host block (around lines 934-955) with the `shareOut` version:

```ts
      for (const [hostId, memberIds] of prep.hosted) {
        const host = prep.hostOf.get(memberIds[0] ?? '');
        if (!host) continue;
        const supply = hostSlots(host, scaledReplicas.get(hostId));
        if (!Number.isFinite(supply) || supply <= 0) continue;

        const members = memberIds
          .map((id) => runtime.get(id))
          .filter((r): r is NodeRuntime => r !== undefined);
        const demands = members.map((r) =>
          slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs }),
        );
        const granted = shareOut(demands, supply);
        members.forEach((r, i) => {
          if (granted[i]! >= demands[i]! - EPSILON) return;
          const factor = demands[i]! > 0 ? granted[i]! / demands[i]! : 0;
          r.capacity = Math.min(r.capacity, r.arriving * factor);
          r.hostLimited = true;
        });
      }

      // A datastore's connection ceiling is a second, independent limit: a store can
      // be nowhere near its request capacity and still refuse callers because it has
      // no connection left to give them.
      for (const node of prep.nodes) {
        const r = runtime.get(node.id)!;
        const ceiling = r.node.attrs?.maxConnections ?? r.node.attrs?.poolSize;
        if (typeof ceiling !== 'number' || ceiling <= 0) continue;
        const needed = slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs });
        const { admittedRps } = admit(r.arriving, needed, ceiling);
        r.capacity = Math.min(r.capacity, admittedRps);
      }
```

Extend `reasonFor` so the finding names the real cause:

```ts
  const ceiling = r.node.attrs?.maxConnections ?? r.node.attrs?.poolSize;
  if (typeof ceiling === 'number' && ceiling > 0) {
    const needed = slotsNeeded({ arrivingRps: r.arriving, occupancyMs: r.occupancyMs });
    if (needed > ceiling) {
      return `${r.node.label} has ${ceiling} connections and its callers need ${Math.ceil(needed)} — they are queueing for a connection, not for the data.`;
    }
  }
```

Place that check immediately after the `hostLimited` branch and before the shed-limit branch.

- [ ] **Step 8: Run the tests**

Run: `npm --workspace shared run test -- engine pools`
Expected: PASS.

- [ ] **Step 9: Export, full suite, typecheck**

Add `export * from './pools.js';` to `shared/src/index.ts`.

Run: `npm --workspace shared run test -- -u`
Then: `npm --workspace shared run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add shared/src
git commit -m "Pools, which is where real systems actually die

Demand in concurrency-seconds against a supply in slots — the same shape
the shared-host block already used, so it moves into pools.ts and the
engine gets shorter. What is new is that a datastore can state how many
connections it accepts, which makes the classic outage arithmetic instead
of folklore."
```

---

### Task 8: Re-tune blueprints and review the whole diff

The spec's fixture policy: blueprints are starting positions and must not arrive broken; problem gates keep their thresholds.

**Files:**
- Modify: `shared/src/blueprints.ts` (as needed)
- Modify: `shared/src/calibration/baseline.json`

**Interfaces:**
- Consumes: everything from Tasks 2-7.
- Produces: nothing new.

- [ ] **Step 1: Find the blueprints that now arrive broken**

Run: `npm --workspace shared run test -- blueprints`
Expected: some `simulates without throwing and carries its declared load` cases fail.

- [ ] **Step 2: Fix each by sizing, not by weakening the test**

For each failing blueprint, the fix is in `blueprints.ts` — raise `replicas`, `vcpu`, `autoscaleMin`, or add a `maxConnections` large enough to be honest. Do **not** relax the assertion; the invariant that a starting position works is the point.

Record in the commit body which blueprint needed what, and why the new size is defensible.

- [ ] **Step 3: Diff the baseline and read every changed line**

Run: `git diff shared/src/calibration/baseline.json`

For each blueprint whose numbers moved, confirm the direction makes sense:
- multi-replica components: latency **down** (Erlang-C)
- anything with a synchronous dependency: capacity **down**, latency **up** (occupancy)
- every flow: p50 **up** slightly (the wire)
- single-replica leaf components with no dependencies: **unchanged**

The last one is the strongest check. If an isolated single-replica component moved, something is wrong.

- [ ] **Step 4: Run the whole repository suite**

Run: `npm test`
Expected: PASS across shared, server and client.

- [ ] **Step 5: Confirm the end-to-end loop still works**

Run: `FAKE_LLM=1 npm --workspace server run test`
Expected: PASS.

- [ ] **Step 6: Report which problem gates changed verdict**

Write a short note into the commit body listing any problem scenario whose pass/fail flipped. Per the spec these thresholds are **not** retuned — but which ones moved is information the author needs.

- [ ] **Step 7: Commit**

```bash
git add shared/src
git commit -m "Blueprints sized for an engine that charges for distance

A starting position that arrives broken teaches the wrong thing on the
first screen, so each one is resized rather than the assertion relaxed.
Problem gates keep their thresholds; the ones that flipped are listed
below for a decision that is not mine to make."
```

---

## Out of scope for this plan

Deliberately deferred to a second plan, per the spec's phasing:

- Read/write split (`carries` on edges) and the replication-lag structural rule
- Cache `workingSetGb` and the coverage-derived hit rate
- Egress and `payloadKb` in the cost model
- `catalog.ts`, the `data/` snapshots, provenance in the Inspector, and the ingest scripts
- Real-world calibration systems with citable published numbers
- Everything in `2026-08-03-provider-environment-design.md`

## Self-review notes

- **Spec coverage.** Occupancy (Task 5), Erlang-C and p99 (Tasks 2-3), network (Tasks 4, 6), pools (Task 7), calibration baseline (Task 1), fixture policy (Task 8). The spec's `catalog.ts`, read/write split, cache sizing and egress are listed as out of scope above rather than silently dropped.
- **Type consistency.** `occupancyMs`, `servers`, `poolSize`, `maxConnections`, `placement` and `region` are each defined once and referred to by the same name throughout. `perReplicaCapacity`'s second parameter is renamed from `serviceMs` to `occupancyMs` in Task 5, which is the only signature change to an existing function.
- **The `-u` steps are not rubber stamps.** Each is preceded by a review step naming what the change should look like, and Task 8 Step 3 states the specific invariant that catches a wrong implementation.
- **Corrected during review:** an earlier draft of Task 3 claimed single-replica components would be unchanged. They will not be. The channel count is `concurrency x replicas x shards`, so a 64-worker service on one replica is a 64-server queue and its latency drops too. The reassurance was false and the test that encoded it (`vcpu: 1`, expecting 500ms) would have failed at 128ms. Both are fixed, and the real invariant — only genuinely single-channel components stay identical — is now what Task 3 Step 6 checks.
- **Ordering constraint made explicit.** Occupancy must be computed before the shared-host block, not merely before serving, because that block and the Task 7 pool block both consume `occupancyMs`.
