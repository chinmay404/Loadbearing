# Meet steps + Chapter 3 (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `meet` theory step (an animated inside view of a part, a few beats, one question) and ship Chapter 3 "Don't ask twice" — a cache theory step plus six practice steps — playable end to end.

**Architecture:** `Step` becomes a union of the existing `PracticeStep` and a new `MeetStep`. A `meet` step is judged by `judgeMeet` (pure, shared) and recorded by the existing pass endpoint. Scene numbers come from a pure model in `shared/src/course/scenes.ts` that calls the engine's `effectiveHitRate`; the client draws them in a scene component chosen by a registry. Chapter 3 needs one judge extension: a gate can give a named source its own rate (`Gate.sources`).

**Tech Stack:** TypeScript monorepo (npm workspaces), vitest, Hono server, React 18 + zustand client, plain CSS on custom properties.

**Spec:** `docs/superpowers/specs/2026-10-10-course-meet-steps-design.md`

## Global Constraints

- Work in an isolated git worktree. Another session is committing engine work in the main checkout (`D:\Architecure learen`, branch `flow-runtime`); never edit files there.
- Course copy: title at most six words; story one sentence; beat title at most five words; beat caption one sentence; plain words.
- A `meet` step has 3–6 beats, 2–4 check options, an in-range `answer`, and `replay` naming one of its own beats.
- Theory is skippable: a correct answer passes the step without watching any beat.
- Scene numbers come from `shared` functions, never hand-tuned animation constants. The key list, TTL and stale prices in the cache scene are illustration (the engine does not model eviction order or staleness) and must not be presented as engine output.
- `prefers-reduced-motion: reduce` → no travelling dots; the same numbers shown still.
- No points, no scores. Progress is recorded only when the server's judge agrees.
- Every practice step: fails as given, passes with its stored solution (or, for `observe` steps, shows a gate actually failing); every starting wire visible. Existing tests in `shared/src/course/course.test.ts` enforce this.
- Verification in the running app uses a throwaway database in the scratchpad, never `data/loadbearing.sqlite` (it holds the real `sirius` account).
- Commit messages follow the repo's style (a plain sentence, no `feat:` prefix) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A `meet` step opened by a learner who is **not signed in** — expect the scene and the question to work, a correct answer shows the pass card, and nothing is posted (same as practice steps today). Pinned in Task 7 (guard on `username`) and checked in Task 9.
2. A pass request for a `meet` step with **a non-integer, string, missing or out-of-range `answer`** — expect 422 `not_passed`, never 500 and never a recorded pass. Pinned in Task 5.
3. A pass request for a `meet` step **sending a graph instead of an answer** (an old client), and a practice step sending an answer — expect 422 and 400 respectively. Pinned in Task 5.
4. **Two traffic sources** in a gate (Chapter 3 has Browsers and Buyers): a source not named in `sources` must still get `rps`; existing single-source steps must judge exactly as before. Pinned in Task 1.
5. A learner who **drags the memory dial to its maximum** on the sizing step and checkpoint — expect a budget fail, not a pass. Pinned in Task 4.

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `shared/src/course/types.ts` | modify | `Gate.sources`; `PracticeStep`, `MeetStep`, `Beat`, `Check`, `SceneId`; `Step` union |
| `shared/src/course/judge.ts` | modify | per-source rates in `gateScenario`; `judgeMeet`; `judgeStep`/`startGraph` take `PracticeStep` |
| `shared/src/course/scenes.ts` | create | pure scene models (`cacheScene`, `isHit`, `CACHE_SCENE`) |
| `shared/src/course/index.ts` | modify | export `scenes.js` |
| `shared/src/course/chapters.ts` | modify | Chapter 3 |
| `shared/src/course/course.test.ts` | modify | narrow honesty tests to practice steps; meet-step shape tests |
| `shared/src/course/judge.test.ts` | create | `judgeMeet`, `Gate.sources` |
| `shared/src/course/scenes.test.ts` | create | scene numbers equal the engine's |
| `server/src/course/routes.ts` | modify | accept `{ answer }` for `meet` steps |
| `server/src/course/routes.test.ts` | modify | meet-step pass cases |
| `client/src/lib/api.ts` | modify | `passMeet` |
| `client/src/course/useCourse.ts` | modify | `STEP_KIND.meet`, `meetFor(chapter)` |
| `client/src/course/Lesson.tsx` | modify | dispatch to `MeetLesson`; "See it again" link in hints |
| `client/src/course/MeetLesson.tsx` | create | the theory step screen |
| `client/src/course/scenes/index.ts` | create | `SceneId` → component registry |
| `client/src/course/scenes/CacheScene.tsx` | create | the cache inside view |
| `client/src/course/LearnPath.tsx` | modify | book mark for `meet` steps; "more chapters" card text |
| `client/src/styles/course.css` | modify | meet + scene styles |
| `.claude/launch.json` (worktree copy) | modify | a `course-dev` config on a throwaway DB |

---

### Task 1: A gate can give a named source its own rate

**Files:**
- Modify: `shared/src/course/types.ts` (the `Gate` interface)
- Modify: `shared/src/course/judge.ts` (`gateScenario`)
- Create: `shared/src/course/judge.test.ts`

**Interfaces:**
- Produces: `Gate.sources?: Record<string, number>` — requests per second for sources named by authored key; every other source sends `Gate.rps`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/course/judge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gateScenario, idOfKey } from './judge.js';
import type { GraphDSL } from '../types.js';

const graph: GraphDSL = {
  nodes: [
    { id: idOfKey('views'), type: 'client', label: 'Browsers', annotation: '', attrs: { trafficRps: 200 } },
    { id: idOfKey('buyers'), type: 'client', label: 'Buyers', annotation: '', attrs: { trafficRps: 5 } },
    { id: idOfKey('app'), type: 'service', label: 'App', annotation: '', attrs: {} },
  ],
  edges: [],
  flows: [],
  stickies: [],
};

describe('gateScenario', () => {
  it('sends the gate rate from every source nobody named', () => {
    const s = gateScenario(graph, { id: 'g', label: 'g', rps: 300 });
    expect(s.patterns[idOfKey('views')]).toEqual({ shape: 'steady', baseRps: 300 });
    expect(s.patterns[idOfKey('buyers')]).toEqual({ shape: 'steady', baseRps: 300 });
  });

  it('gives a named source its own rate', () => {
    const s = gateScenario(graph, { id: 'g', label: 'g', rps: 300, sources: { buyers: 5 } });
    expect(s.patterns[idOfKey('views')]).toEqual({ shape: 'steady', baseRps: 300 });
    expect(s.patterns[idOfKey('buyers')]).toEqual({ shape: 'steady', baseRps: 5 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --workspace shared run test -- src/course/judge.test.ts`
Expected: the second test FAILS (`baseRps` is 300, expected 5); TypeScript may also flag `sources` as unknown.

- [ ] **Step 3: Implement**

In `shared/src/course/types.ts`, inside `interface Gate`, after `rps: number;`:

```ts
  /** A source's own rate, by authored key: "buyers send 5 a second". Others send `rps`. */
  sources?: Record<string, number>;
```

In `shared/src/course/judge.ts`, replace the loop in `gateScenario`:

```ts
  const patterns: Scenario['patterns'] = {};
  const named = new Map(Object.entries(gate.sources ?? {}).map(([key, rps]) => [idOfKey(key), rps]));
  for (const n of graph.nodes) {
    if (familyOf(n.type) === 'origin') patterns[n.id] = { shape: 'steady', baseRps: named.get(n.id) ?? gate.rps };
  }
```

- [ ] **Step 4: Run tests**

Run: `npm --workspace shared run test -- src/course`
Expected: PASS, including every existing course test (single-source steps are unchanged).

- [ ] **Step 5: Commit**

```bash
git add shared/src/course/types.ts shared/src/course/judge.ts shared/src/course/judge.test.ts
git commit -m "Let a course gate send a different rate from each named source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `meet` step type and its judge

**Files:**
- Modify: `shared/src/course/types.ts`
- Modify: `shared/src/course/judge.ts`
- Modify: `shared/src/course/judge.test.ts`
- Modify: `shared/src/course/course.test.ts`

**Interfaces:**
- Consumes: Task 1's `Gate`.
- Produces:
  - `type StepType = 'meet' | 'fill-gap' | 'fix-wiring' | 'find-bottleneck' | 'kill-switch' | 'tune-dial' | 'checkpoint'`
  - `interface PracticeStep` (today's `Step`, with `type: Exclude<StepType, 'meet'>`)
  - `interface MeetStep { id; chapter; type: 'meet'; title; story; scene: SceneId; beats: Beat[]; check: Check; lesson }`
  - `type SceneId = 'cache' | 'cdn' | 'queue' | 'replica' | 'watch'`
  - `interface Beat { id: string; title: string; caption: string }`
  - `interface Check { question: string; options: string[]; answer: number; because: string; replay: string }`
  - `type Step = PracticeStep | MeetStep`
  - `const isMeet = (s: Step): s is MeetStep`
  - `judgeMeet(step: MeetStep, answer: unknown): { passed: boolean; replay: string | null }`
  - `judgeStep(step: PracticeStep, graph)`, `startGraph(step: PracticeStep)` — signatures narrowed.

- [ ] **Step 1: Write the failing tests**

Append to `shared/src/course/judge.test.ts`:

```ts
import { judgeMeet } from './judge.js';
import type { MeetStep } from './types.js';

const meet: MeetStep = {
  id: 't-0',
  chapter: 't',
  type: 'meet',
  title: 'Meet the thing',
  story: 'A test step.',
  scene: 'cache',
  beats: [
    { id: 'a', title: 'A', caption: 'First.' },
    { id: 'b', title: 'B', caption: 'Second.' },
    { id: 'c', title: 'C', caption: 'Third.' },
  ],
  check: { question: 'Which?', options: ['one', 'two', 'three'], answer: 2, because: 'Three.', replay: 'b' },
  lesson: 'Done.',
};

describe('judgeMeet', () => {
  it('passes the right answer', () => {
    expect(judgeMeet(meet, 2)).toEqual({ passed: true, replay: null });
  });
  it('sends a wrong answer back to the beat that explains it', () => {
    expect(judgeMeet(meet, 0)).toEqual({ passed: false, replay: 'b' });
  });
  it.each([[-1], [3], [1.5], ['2'], [null], [undefined]])('refuses %p', (answer) => {
    expect(judgeMeet(meet, answer).passed).toBe(false);
  });
});
```

Append to `shared/src/course/course.test.ts` (and add `isMeet` to its import from `./types.js`… `isMeet` lives in `types.ts`):

```ts
describe('every meet step can be finished', () => {
  const meets = steps.filter(isMeet);
  it.each(meets.map((s) => [s.id, s] as const))('%s', (_id, step) => {
    expect(step.beats.length).toBeGreaterThanOrEqual(3);
    expect(step.beats.length).toBeLessThanOrEqual(6);
    expect(new Set(step.beats.map((b) => b.id)).size).toBe(step.beats.length);
    expect(step.check.options.length).toBeGreaterThanOrEqual(2);
    expect(step.check.options.length).toBeLessThanOrEqual(4);
    expect(Number.isInteger(step.check.answer)).toBe(true);
    expect(step.check.answer).toBeGreaterThanOrEqual(0);
    expect(step.check.answer).toBeLessThan(step.check.options.length);
    expect(step.beats.map((b) => b.id)).toContain(step.check.replay);
    // Theory opens a chapter; it is never dropped in the middle of one.
    const chapter = COURSE.find((c) => c.id === step.chapter)!;
    expect(chapter.steps[0]).toBe(step);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm --workspace shared run test -- src/course`
Expected: FAIL — `judgeMeet`, `MeetStep`, `isMeet` do not exist.

- [ ] **Step 3: Implement the types**

In `shared/src/course/types.ts`:

1. Replace the `StepType` line:

```ts
export type StepType = 'meet' | 'fill-gap' | 'fix-wiring' | 'find-bottleneck' | 'kill-switch' | 'tune-dial' | 'checkpoint';
```

2. Rename `export interface Step {` to `export interface PracticeStep {` and change its `type: StepType;` to:

```ts
  type: Exclude<StepType, 'meet'>;
```

3. After `PracticeStep`, add:

```ts
/** Which client scene draws a meet step. */
export type SceneId = 'cache' | 'cdn' | 'queue' | 'replica' | 'watch';

/** One moment of a meet step. The scene reads `id` to know what to show. */
export interface Beat {
  id: string;
  /** At most five words. */
  title: string;
  /** One sentence, plain words. */
  caption: string;
}

/** The question that finishes a meet step. */
export interface Check {
  question: string;
  /** Two to four short choices. */
  options: string[];
  /** Index into options. */
  answer: number;
  /** One sentence shown on a right answer. */
  because: string;
  /** The beat a wrong answer goes back to. */
  replay: string;
}

/**
 * A look inside the part a chapter introduces, before the learner uses it. No
 * canvas and no traffic: a few beats of a moving picture, then one question.
 */
export interface MeetStep {
  id: string;
  chapter: string;
  type: 'meet';
  /** At most six words: "Meet the cache". */
  title: string;
  /** One sentence: why this part is about to matter. */
  story: string;
  scene: SceneId;
  beats: Beat[];
  check: Check;
  /** One sentence, shown after the pass. */
  lesson: string;
}

export type Step = PracticeStep | MeetStep;

export const isMeet = (step: Step): step is MeetStep => step.type === 'meet';
```

- [ ] **Step 4: Implement `judgeMeet` and narrow the judge**

In `shared/src/course/judge.ts`:

1. Change the type import to:

```ts
import type { Gate, GateResult, MeetStep, PartRef, Patch, PracticeStep, StepVerdict } from './types.js';
```

2. Change `export function judgeStep(step: Step, graph: GraphDSL)` to `export function judgeStep(step: PracticeStep, graph: GraphDSL)` and `export function startGraph(step: Step)` to `export function startGraph(step: PracticeStep)`.

3. Add after `judgeStep`:

```ts
/**
 * Whether a meet step's question was answered. Pure: the server runs the same
 * check, so a request that only says "passed" records nothing.
 */
export function judgeMeet(step: MeetStep, answer: unknown): { passed: boolean; replay: string | null } {
  const passed = typeof answer === 'number' && Number.isInteger(answer) && answer === step.check.answer;
  return { passed, replay: passed ? null : step.check.replay };
}
```

- [ ] **Step 5: Narrow the existing honesty tests**

In `shared/src/course/course.test.ts`:

1. Add imports: `import { isMeet, type PracticeStep } from './types.js';`
2. Replace `const steps = COURSE.flatMap((c) => c.steps);` with:

```ts
const steps = COURSE.flatMap((c) => c.steps);
const practice = steps.filter((s): s is PracticeStep => !isMeet(s));
```

3. In the `every step is honest`, `every step refers to things that exist` and `every wire a step starts with can be seen` blocks, replace `steps` with `practice` in each `it.each(...)` source. Where a test looks a step up with `STEP_BY_ID['2-3']!` or `STEP_BY_ID['p-5']!`, cast it: `STEP_BY_ID['2-3'] as PracticeStep`.

- [ ] **Step 6: Run the whole shared suite and typecheck**

Run: `npm --workspace shared run test` then `npm run build:shared`
Expected: all PASS; the build has no type errors. (The meet-shape test runs over zero steps until Task 4; that is fine.)

- [ ] **Step 7: Commit**

```bash
git add shared/src/course
git commit -m "A course step can be a look inside a part, finished by one question

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The cache scene's numbers come from the engine

**Files:**
- Create: `shared/src/course/scenes.ts`
- Create: `shared/src/course/scenes.test.ts`
- Modify: `shared/src/course/index.ts`

**Interfaces:**
- Consumes: `effectiveHitRate(node: GraphNode): number` from `shared/src/engine.ts`; `gateScenario`, `idOfKey` from `./judge.js`; `runEngine` from `../engine.js`.
- Produces:
  - `CACHE_SCENE: { rps: 200; workingSetGb: 4; cacheMs: 1; dbMs: 40 }` (also used by Chapter 3's helper values)
  - `cacheScene(i: { rps: number; memoryGb: number; workingSetGb: number; cacheMs: number; dbMs: number; alive: boolean }): { hitRate: number; dbRps: number; avgMs: number }`
  - `isHit(n: number, hitRate: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `shared/src/course/scenes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runEngine } from '../engine.js';
import type { GraphDSL } from '../types.js';
import { gateScenario, idOfKey } from './judge.js';
import { CACHE_SCENE, cacheScene, isHit } from './scenes.js';

const node = (key: string, type: GraphDSL['nodes'][number]['type'], attrs = {}) => ({ id: idOfKey(key), type, label: key, annotation: '', attrs });

describe('cacheScene', () => {
  it.each([0.5, 1, 2, 4])('with %d GB, shows the share of reads the engine sends to the database', (memoryGb) => {
    const shown = cacheScene({ ...CACHE_SCENE, memoryGb, alive: true });
    const graph: GraphDSL = {
      nodes: [
        node('views', 'client', { trafficRps: CACHE_SCENE.rps }),
        node('app', 'service', { vcpu: 8, latencyMs: 20 }),
        node('cache', 'cache', { memoryGb, workingSetGb: CACHE_SCENE.workingSetGb }),
        node('db', 'sql_db', { vcpu: 8, latencyMs: CACHE_SCENE.dbMs }),
      ],
      edges: [
        ['views', 'app'],
        ['app', 'cache'],
        ['cache', 'db'],
      ].map(([a, b]) => ({ id: `${a}-${b}`, from: idOfKey(a!), to: idOfKey(b!), kind: 'sync' as const, label: '' })),
      flows: [],
      stickies: [],
    };
    const run = runEngine(graph, gateScenario(graph, { id: 's', label: 's', rps: CACHE_SCENE.rps }));
    const reached = run.final.find((h) => h.nodeId === idOfKey('db'))!.servedRps;
    expect(shown.dbRps).toBeCloseTo(reached, 0);
  });

  it('sends everything to the database when the cache is gone', () => {
    expect(cacheScene({ ...CACHE_SCENE, memoryGb: 2, alive: false })).toEqual({ hitRate: 0, dbRps: 200, avgMs: 40 });
  });

  it('answers faster the more it remembers', () => {
    const small = cacheScene({ ...CACHE_SCENE, memoryGb: 0.5, alive: true });
    const big = cacheScene({ ...CACHE_SCENE, memoryGb: 4, alive: true });
    expect(big.hitRate).toBeGreaterThan(small.hitRate);
    expect(big.avgMs).toBeLessThan(small.avgMs);
  });
});

describe('isHit', () => {
  it('spreads hits evenly at the rate asked for', () => {
    const hits = Array.from({ length: 100 }, (_, n) => isHit(n, 0.7)).filter(Boolean).length;
    expect(hits).toBe(70);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --workspace shared run test -- src/course/scenes.test.ts`
Expected: FAIL — cannot resolve `./scenes.js`.

- [ ] **Step 3: Implement**

Create `shared/src/course/scenes.ts`:

```ts
import { effectiveHitRate } from '../engine.js';
import type { GraphNode } from '../types.js';

/**
 * What the meet steps' moving pictures show, computed with the engine's own
 * arithmetic — so the theory a learner watches is the same physics that judges
 * them two steps later. Anything a scene draws that the engine does not model
 * (which key is evicted, a price going stale) is illustration and is labelled so.
 */

/** The cache scene's world: the same shop and database as chapter 3. */
export const CACHE_SCENE = { rps: 200, workingSetGb: 4, cacheMs: 1, dbMs: 40 } as const;

export interface CacheSceneInput {
  rps: number;
  memoryGb: number;
  workingSetGb: number;
  cacheMs: number;
  dbMs: number;
  /** False when the cache is off or dead: every read goes to the database. */
  alive: boolean;
}

export interface CacheSceneNumbers {
  hitRate: number;
  dbRps: number;
  avgMs: number;
}

export function cacheScene(i: CacheSceneInput): CacheSceneNumbers {
  if (!i.alive || !(i.memoryGb > 0)) return { hitRate: 0, dbRps: i.rps, avgMs: i.dbMs };
  const node: GraphNode = {
    id: 'scene-cache',
    type: 'cache',
    label: 'Cache',
    annotation: '',
    attrs: { memoryGb: i.memoryGb, workingSetGb: i.workingSetGb },
  };
  const hitRate = effectiveHitRate(node);
  return { hitRate, dbRps: i.rps * (1 - hitRate), avgMs: i.cacheMs + (1 - hitRate) * i.dbMs };
}

/** Whether the nth request is a hit, spread evenly — the same picture every time. */
export const isHit = (n: number, hitRate: number): boolean => Math.floor((n + 1) * hitRate) > Math.floor(n * hitRate);
```

In `shared/src/course/index.ts`, add a line:

```ts
export * from './scenes.js';
```

- [ ] **Step 4: Run tests**

Run: `npm --workspace shared run test -- src/course`
Expected: PASS. If the engine comparison is off by more than rounding, do **not** adjust the scene with a fudge factor — read how the engine forwards cache misses (`absorbOf` in `engine.ts`) and make `cacheScene` call the same function.

- [ ] **Step 5: Commit**

```bash
git add shared/src/course/scenes.ts shared/src/course/scenes.test.ts shared/src/course/index.ts
git commit -m "The cache picture counts with the engine's own hit rate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Chapter 3, "Don't ask twice"

**Files:**
- Modify: `shared/src/course/chapters.ts`
- Modify: `shared/src/course/course.test.ts` (budget-at-max test)

**Interfaces:**
- Consumes: `Gate.sources` (Task 1), `MeetStep` (Task 2), `CACHE_SCENE` (Task 3). The budget test also needs `applyPatch`, `judgeStep`, `startGraph` (already imported in `course.test.ts`) and `PracticeStep` (imported in Task 2).
- Produces: steps `3-0` … `3-6` in `STEP_BY_ID`; `COURSE = [prologue, chapter1, chapter2, chapter3]`.

The numbers below were measured against the current engine (catalogue app 8 vCPU / 20 ms, database 1 vCPU / 40 ms, buyers 5 req/s): no cache at 200 views/s loses ~2.4% with the database first to fail; cache memory vs a 4 GB working set gives hit rates 0.35 / 0.50 / 0.71 / 0.80 at 0.5 / 1 / 2 / 3 GB; at 300 views/s the database is 96% / 78% / 46% / 33% busy; monthly cost is $247 / $254 / $268 / $282 for 0.5 / 1 / 2 / 3 GB. If the engine on your branch disagrees (another session is changing it), re-tune the numbers so the tests pass and keep the stories true to the new numbers.

- [ ] **Step 1: Add the meet-step budget test (fails until the chapter exists)**

Append to `shared/src/course/course.test.ts`:

```ts
describe('chapter 3', () => {
  it('opens with a look inside the cache', () => {
    expect(STEP_BY_ID['3-0']?.type).toBe('meet');
  });

  // Maxing out the memory dial must not be the answer: the budget says so.
  it.each(['3-3', '3-6'])('%s fails its budget with the dial at the top', (id) => {
    const step = STEP_BY_ID[id] as PracticeStep;
    const dial = step.dials!.find((d) => d.attr === 'memoryGb')!;
    const solved = applyPatch(startGraph(step), step.solution);
    const maxed = applyPatch(solved, { set: [{ key: dial.key, attrs: { memoryGb: dial.max } }] });
    expect(judgeStep(step, maxed).budget.pass).toBe(false);
  });
});
```

Run: `npm --workspace shared run test -- src/course`
Expected: FAIL — `3-0` is undefined.

- [ ] **Step 2: Write the chapter**

In `shared/src/course/chapters.ts`, add `import { CACHE_SCENE } from './scenes.js';` and `import type { Chapter, Gate, MeetStep } from './types.js';` (replacing the existing types import), then insert before `export const COURSE`:

```ts
// ----------------------------------------------------------------- chapter 3 --

/**
 * The shop split in two: browsing reads the catalogue, buying writes orders. The
 * split is what lets a cache sit on the read path while orders still go straight
 * to the database.
 */
const market = (views: number, cache?: NodeAttrs) => [
  part('views', 'client', 'Browsers', 0, 0, { trafficRps: views }),
  part('buyers', 'client', 'Buyers', 0, 1, { trafficRps: 5 }),
  part('cat', 'service', 'Catalogue app', 1, 0, { vcpu: 8, latencyMs: 20 }),
  part('co', 'service', 'Checkout app', 1, 1, { vcpu: 1, latencyMs: 50 }),
  part('db', 'sql_db', 'Shop DB', 3, 0.5, { vcpu: 1, latencyMs: CACHE_SCENE.dbMs }),
  ...(cache ? [part('cache', 'cache', 'Cache', 2, 0, { workingSetGb: CACHE_SCENE.workingSetGb, ...cache })] : []),
];
const direct: [string, string][] = [
  ['views', 'cat'],
  ['cat', 'db'],
  ['buyers', 'co'],
  ['co', 'db'],
];
const cached: [string, string][] = [
  ['views', 'cat'],
  ['cat', 'cache'],
  ['cache', 'db'],
  ['buyers', 'co'],
  ['co', 'db'],
];
/** Buyers keep their own small rate whatever the browsers do. */
const views = (gate: Omit<Gate, 'sources'>): Gate => ({ ...gate, sources: { buyers: 5 } });
const memoryDial = { key: 'cache', attr: 'memoryGb' as const, label: 'Memory', unit: 'GB', min: 0.5, max: 4, step: 0.5 };

const meetCache: MeetStep = {
  id: '3-0',
  chapter: 'ch3',
  type: 'meet',
  title: 'Meet the cache',
  story: 'A sale is coming. First, look inside the part that will carry it.',
  scene: 'cache',
  beats: [
    { id: 'ask', title: 'Same question, asked again', caption: 'Every product page asks the database for the same thing, and it looks it up on disk each time.' },
    { id: 'keep', title: 'Keep the answer close', caption: 'A cache keeps recent answers in memory beside the app: a hit comes straight back, a miss goes on to the database and is saved on the way back.' },
    { id: 'size', title: 'Too small forgets', caption: 'A cache only remembers what fits in its memory, so drag its size and watch how much still reaches the database.' },
    { id: 'stale', title: 'Old answers go stale', caption: 'A cached answer is a copy, so when a price changes the cache keeps giving the old one until its time runs out.' },
    { id: 'dies', title: 'When the cache dies', caption: 'Turn the cache off at full traffic and every question goes to the database at once.' },
  ],
  check: {
    question: '200 product views a second, and the cache answers 8 in 10, so the database gets 40. The cache restarts. For that moment, how many a second reach the database?',
    options: ['40', '160', '200', 'None'],
    answer: 2,
    because: 'With the cache gone nothing absorbs the reads, so the database gets all 200, five times what it was carrying.',
    replay: 'dies',
  },
  lesson: 'A cache is a fast copy of answers you already have. It saves work until it forgets, and then all the work comes back.',
};

const chapter3: Chapter = {
  id: 'ch3',
  number: 3,
  title: "Don't ask twice",
  promise: 'How to stop asking the database the same question.',
  unlocks: ['cache'],
  steps: [
    meetCache,
    {
      id: '3-1',
      chapter: 'ch3',
      type: 'find-bottleneck',
      title: 'The same question, 200 times',
      story: 'A sale banner went up, and 200 people a second are browsing the same few products.',
      task: 'Click the part you think fails first, then run it.',
      start: design('3-1', market(200), direct),
      parts: [],
      predict: true,
      observe: true,
      budget: 400,
      gates: [views({ id: 'browse', label: '200 views/s · at most 1% lost', rps: 200, maxLostPct: 1 })],
      hints: {
        question: 'Which part does the slowest work for each product page?',
        concept: 'Each page asks the database for about 40 ms of work. One vCPU gives it 8 workers, so it tops out near 200 a second.',
      },
      lesson: 'The database answers the same question over and over. That is work you can stop doing.',
      solution: {},
    },
    {
      id: '3-2',
      chapter: 'ch3',
      type: 'fill-gap',
      title: 'Ask the cache first',
      story: 'Most of those 200 questions are about the same twenty products.',
      task: 'Put a cache between the catalogue app and the database.',
      start: design('3-2', market(200), direct),
      parts: ['cache'],
      budget: 400,
      uses: [{ type: 'cache', label: 'Product pages go through a cache' }],
      gates: [
        views({
          id: 'browse',
          label: '200 views/s · database under 70% busy',
          rps: 200,
          maxLostPct: 1,
          maxBusy: { part: { key: 'db' }, pct: 70 },
        }),
      ],
      hints: {
        question: 'If the answer was the same a second ago, why ask the database again?',
        concept: 'A cache keeps recent answers in memory. The app asks it first, and only a miss goes on to the database.',
        ghost: { type: 'cache', label: 'Cache', between: ['cat', 'db'] },
      },
      lesson: 'A cache answers the repeat questions, so the database only sees the new ones.',
      solution: {
        add: [{ key: 'cache', type: 'cache', label: 'Cache' }],
        disconnect: [['cat', 'db']],
        connect: [
          ['cat', 'cache'],
          ['cache', 'db'],
        ],
      },
    },
    {
      id: '3-3',
      chapter: 'ch3',
      type: 'tune-dial',
      title: 'A cache big enough',
      story: 'The catalogue is 4 GB, the cache was bought with half a gigabyte, and the big sale brings 300 views a second.',
      task: 'Give the cache enough memory to keep the database under half busy.',
      start: design('3-3', market(300, { memoryGb: 0.5 }), cached),
      parts: [],
      dials: [memoryDial],
      budget: 275,
      gates: [
        views({
          id: 'sale',
          label: '300 views/s · database under 50% busy',
          rps: 300,
          maxLostPct: 1,
          maxBusy: { part: { key: 'db' }, pct: 50 },
        }),
      ],
      hints: {
        question: 'How much of the catalogue does the cache hold, and how often do people ask for the rest?',
        concept: 'People ask for a few popular products far more than the rest, so a cache holding half the catalogue answers about 7 in 10. Every gigabyte is paid for each month.',
      },
      lesson: 'A cache only helps as much as it remembers. Size it to what people ask for, not to everything.',
      solution: { set: [{ key: 'cache', attrs: { memoryGb: 2 } }] },
    },
    {
      id: '3-4',
      chapter: 'ch3',
      type: 'kill-switch',
      title: 'When the cache restarts',
      story: 'Ten seconds into the 300-a-second sale, the cache restarts.',
      task: 'Run it and watch what reaches the database.',
      start: design('3-4', market(300, { memoryGb: 2 }), cached),
      parts: [],
      observe: true,
      budget: 400,
      gates: [
        views({
          id: 'restart',
          label: 'Cache dies at 10 s · at most 1% lost after',
          rps: 300,
          horizonS: 30,
          kill: { key: 'cache', atS: 10 },
          window: 'after-kill',
          maxLostPct: 1,
        }),
      ],
      hints: {
        question: 'Where do the questions the cache used to answer go now?',
        concept: 'With the cache gone, the database gets every question at once: more than three times what it was carrying.',
      },
      lesson: 'A cache hides load. When it goes, the load comes back all at once.',
      solution: {},
    },
    {
      id: '3-5',
      chapter: 'ch3',
      type: 'fix-wiring',
      title: 'Orders kept in the cache',
      story: 'To make checkout faster, orders were sent to the cache, and a restart would lose every one.',
      task: 'Wire the checkout app so orders go to the database.',
      start: design('3-5', market(50, { memoryGb: 2 }), [
        ['views', 'cat'],
        ['cat', 'cache'],
        ['cache', 'db'],
        ['buyers', 'co'],
        ['co', 'cache'],
      ]),
      parts: [],
      budget: 400,
      clears: ['cache-as-system-of-record'],
      gates: [views({ id: 'orders', label: '50 views/s · at most 1% lost', rps: 50, maxLostPct: 1 })],
      hints: {
        question: 'If the cache restarts, where does an order still exist?',
        concept: 'A cache is allowed to forget. Anything you cannot lose is written to the database first; the cache only keeps copies for reading.',
      },
      lesson: 'Write to the database. Read through the cache.',
      solution: { disconnect: [['co', 'cache']], connect: [['co', 'db']] },
    },
    {
      id: '3-6',
      chapter: 'ch3',
      type: 'checkpoint',
      title: 'Catalogue sale day',
      story: 'The yearly sale: quiet in the morning, 300 views a second at noon, and one cache restart while it is busy.',
      task: 'Wire in the cache and size it, under budget.',
      // The cache waits below the row, unwired, so the learner places it on the path.
      start: design(
        '3-6',
        [...market(50), { ...part('cache', 'cache', 'Cache', 2, 1.75, { memoryGb: 0.5, workingSetGb: CACHE_SCENE.workingSetGb }) }],
        direct,
      ),
      parts: [],
      dials: [memoryDial],
      budget: 275,
      clears: ['cache-as-system-of-record'],
      gates: [
        views({ id: 'quiet', label: 'Quiet morning · 50 views/s · at most 0.5% lost', rps: 50, maxLostPct: 0.5 }),
        views({
          id: 'noon',
          label: 'Noon · 300 views/s · database under 60% busy',
          rps: 300,
          maxLostPct: 1,
          maxBusy: { part: { key: 'db' }, pct: 60 },
        }),
        views({
          id: 'restart',
          label: 'Cache restarts for 5 s · at most 2% lost',
          rps: 200,
          horizonS: 30,
          kill: { key: 'cache', atS: 10, forS: 5 },
          maxLostPct: 2,
        }),
      ],
      hints: {
        question: 'Where did the cache sit in this chapter, and how big did it need to be?',
        concept: 'Between the catalogue app and the database, holding about half the catalogue. The checkout still writes straight to the database.',
      },
      lesson: 'Cache the reads, write to the database, and make sure the database lives through the cache restarting.',
      solution: {
        disconnect: [['cat', 'db']],
        connect: [
          ['cat', 'cache'],
          ['cache', 'db'],
        ],
        set: [{ key: 'cache', attrs: { memoryGb: 2 } }],
      },
    },
  ],
};
```

Change the course list and index:

```ts
export const COURSE: Chapter[] = [prologue, chapter1, chapter2, chapter3];
```

- [ ] **Step 3: Run the course tests**

Run: `npm --workspace shared run test -- src/course`
Expected: PASS — every practice step fails as given and passes solved; `3-1` and `3-4` show a gate failing; `3-0` passes the meet-shape test; the dial-at-max budget test fails the budget; every starting wire is visible.

If a step fails its honesty test, change the step's numbers (rates, sizes, busy caps, budget), not the tests, and keep the story and labels saying the same numbers.

- [ ] **Step 4: Commit**

```bash
git add shared/src/course/chapters.ts shared/src/course/course.test.ts
git commit -m "Chapter 3: a look inside the cache, then six steps of not asking twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The server records a meet step only on the right answer

**Files:**
- Modify: `server/src/course/routes.ts`
- Modify: `server/src/course/routes.test.ts`

**Interfaces:**
- Consumes: `judgeMeet`, `isMeet`, `PracticeStep` from `@loadbearing/shared`. Uses step `'3-0'` from Task 4.
- Produces: `POST /api/course/steps/:stepId/pass` with body `{ answer: number }` for a meet step → `200 { ok, verdict: { passed, replay }, progress }` or `422 { error: { code: 'not_passed' }, verdict }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/course/routes.test.ts` (inside the file, after the existing `describe` blocks):

```ts
const answer = (as: string, stepId: string, body: unknown) =>
  app.request(`/api/course/steps/${stepId}/pass`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as },
    body: JSON.stringify(body),
  });

describe('a meet step', () => {
  const meet = STEP_BY_ID['3-0']! as MeetStep;

  it.each([
    ['a wrong answer', { answer: (meet.check.answer + 1) % meet.check.options.length }],
    ['no answer', {}],
    ['a string', { answer: String(meet.check.answer) }],
    ['a fraction', { answer: meet.check.answer + 0.5 }],
    ['out of range', { answer: 99 }],
    ['a design instead of an answer', { graph: { nodes: [], edges: [] } }],
  ])('is not recorded for %s', async (_what, body) => {
    const res = await answer(other, meet.id, body);
    expect(res.status).toBe(422);
    expect((await progress(other)).steps[meet.id]).toBeUndefined();
  });

  it('is recorded for the right answer', async () => {
    const res = await answer(cookie, meet.id, { answer: meet.check.answer });
    expect(res.status).toBe(200);
    expect((await progress(cookie)).steps[meet.id]).toMatchObject({ hints: 0 });
  });

  it('still needs a design for a practice step', async () => {
    const res = await answer(cookie, 'p-1', { answer: 0 });
    expect(res.status).toBe(400);
  });
});
```

Add `type MeetStep` to the `@loadbearing/shared` import at the top. Where the existing tests read `step.solution` from `STEP_BY_ID['p-1']!`, cast: `STEP_BY_ID['p-1'] as PracticeStep` (add `type PracticeStep` to the import).

- [ ] **Step 2: Run to see them fail**

Run: `npm run build:shared && npm --workspace server run test -- src/course/routes.test.ts`
Expected: the right-answer test FAILS with 400 (the route demands a graph).

- [ ] **Step 3: Implement**

Replace the body of the `post('/course/steps/:stepId/pass', …)` handler in `server/src/course/routes.ts`, and the import line, with:

```ts
import { STEP_BY_ID, isMeet, judgeMeet, judgeStep, type GraphDSL } from '@loadbearing/shared';
```

```ts
async function record(userId: string, stepId: string, hints: number): Promise<Progress> {
  const progress = await read(userId);
  const earlier = progress.steps[stepId];
  // The first pass is the one that counts; a later, cleaner one only improves the hints.
  progress.steps[stepId] = earlier
    ? { passedAt: earlier.passedAt, hints: Math.min(earlier.hints, hints) }
    : { passedAt: new Date().toISOString(), hints };
  await (await storage()).setSetting(userId, PROGRESS_KEY, JSON.stringify(progress));
  return progress;
}

courseRoutes.post('/course/steps/:stepId/pass', requireUser, async (c) => {
  const step = STEP_BY_ID[c.req.param('stepId')];
  if (!step) return c.json({ error: { code: 'not_found', message: 'There is no such step.' } }, 404);

  const body = (await c.req.json().catch(() => null)) as { graph?: unknown; hints?: unknown; answer?: unknown } | null;
  const userId = c.get('userId');

  // A look inside a part is finished by its question, not by a design.
  if (isMeet(step)) {
    const verdict = judgeMeet(step, body?.answer);
    if (!verdict.passed) {
      return c.json({ error: { code: 'not_passed', message: 'That is not the answer yet.' }, verdict }, 422);
    }
    return c.json({ ok: true, verdict, progress: await record(userId, step.id, 0) });
  }

  const graph = asGraph(body?.graph);
  if (!graph) {
    return c.json({ error: { code: 'bad_request', message: 'Send the design as { graph: { nodes, edges } }.' } }, 400);
  }

  const verdict = judgeStep(step, graph);
  if (!verdict.passed) {
    return c.json(
      { error: { code: 'not_passed', message: 'This design does not pass the step yet.' }, verdict },
      422,
    );
  }

  const hints = Math.max(0, Math.min(3, Math.round(Number(body?.hints) || 0)));
  return c.json({ ok: true, verdict, progress: await record(userId, step.id, hints) });
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run build:shared && npm --workspace server run test -- src/course && npm --workspace server run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/course
git commit -m "Record a look inside a part only when its question is answered right

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The client knows about meet steps

**Files:**
- Modify: `client/src/lib/api.ts` (next to `passStep`, ~line 412)
- Modify: `client/src/course/useCourse.ts`
- Modify: `client/src/course/LearnPath.tsx`
- Modify: `client/src/course/Lesson.tsx` (only the type narrowing and dispatch; the meet screen comes in Task 7)

**Interfaces:**
- Consumes: `isMeet`, `MeetStep`, `PracticeStep` from `@loadbearing/shared`.
- Produces:
  - `api.passMeet(stepId: string, answer: number): Promise<{ ok: true; progress: CourseProgress }>`
  - `STEP_KIND.meet = 'Meet a part'`
  - `meetFor(step: Step): MeetStep | undefined` — the meet step that opens this step's chapter.
  - `Lesson` renders `<MeetLesson step={step} />` for meet steps (component created in Task 7; until then a placeholder export is fine only within this task's commit if Task 7 follows immediately — prefer doing Tasks 6 and 7 in one sitting).

- [ ] **Step 1: API**

In `client/src/lib/api.ts`, after `passStep`:

```ts
  passMeet: (stepId: string, answer: number) =>
    req<{ ok: true; progress: CourseProgress }>(`/course/steps/${encodeURIComponent(stepId)}/pass`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
```

- [ ] **Step 2: useCourse**

In `client/src/course/useCourse.ts`, change the import to `import { COURSE, isMeet, type Chapter, type MeetStep, type Step } from '@loadbearing/shared';`, add `meet: 'Meet a part',` as the first entry of `STEP_KIND`, and add:

```ts
/** The look inside a part that opens this step's chapter, if it has one. */
export function meetFor(step: Step): MeetStep | undefined {
  const first = COURSE.find((c) => c.id === step.chapter)?.steps[0];
  return first && isMeet(first) && first.id !== step.id ? first : undefined;
}
```

Also add `'cache-as-system-of-record': 'Orders are saved in the database',` to `RULE_GOAL` only if it is missing (it is present today — leave it).

- [ ] **Step 3: LearnPath**

In `client/src/course/LearnPath.tsx`:

1. Import `IconManual` from `'../ui/UiIcons'`.
2. In the step dot, add a branch before the checkpoint branch:

```tsx
                  ) : step.type === 'meet' ? (
                    <IconManual size={14} />
```

3. Change the "soon" card to:

```tsx
              <h2>Files, queues, replicas and more</h2>
              <p>Four more chapters are on the way.</p>
```

and its number from `3+` to `4+`.

- [ ] **Step 4: Lesson dispatch and narrowing**

In `client/src/course/Lesson.tsx`:

1. Add `isMeet` and `type PracticeStep` to the shared import; import `{ MeetLesson } from './MeetLesson'`.
2. In `Lesson()`, replace the last line with:

```tsx
  return isMeet(step) ? <MeetLesson key={step.id} step={step} /> : <LessonFor key={step.id} step={step} />;
```

3. Change `function LessonFor({ step }: { step: Step })` and `function PartsTray({ step }: { step: Step })` to take `PracticeStep`, and `type: Step['parts'][number]` to `PracticeStep['parts'][number]`. Remove `Step` from the import if now unused.

- [ ] **Step 5: Typecheck** (after Task 7 creates `MeetLesson.tsx`)

Run: `npm run build:shared && npm --workspace client run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit** — together with Task 7 (the dispatch needs the screen).

---

### Task 7: The meet screen and the cache scene

**Files:**
- Create: `client/src/course/MeetLesson.tsx`
- Create: `client/src/course/scenes/index.ts`
- Create: `client/src/course/scenes/CacheScene.tsx`
- Modify: `client/src/styles/course.css`
- Modify: `client/src/course/Lesson.tsx` (hint link)

**Interfaces:**
- Consumes: `judgeMeet`, `cacheScene`, `isHit`, `CACHE_SCENE`, `MeetStep`, `SceneId`, `COURSE` from shared; `api.passMeet`, `useCourse`, `stepAfter`, `STEP_KIND`, `meetFor` from Task 6.
- Produces:
  - `interface SceneProps { beat: string; still: boolean }`
  - `SCENES: Partial<Record<SceneId, (p: SceneProps) => JSX.Element>>`

- [ ] **Step 1: Scene registry**

Create `client/src/course/scenes/index.ts`:

```ts
import type { JSX } from 'react';
import type { SceneId } from '@loadbearing/shared';
import { CacheScene } from './CacheScene';

/** What every scene is told: which beat is showing, and whether to hold still. */
export interface SceneProps {
  beat: string;
  /** prefers-reduced-motion: show the numbers, no travelling dots. */
  still: boolean;
}

/** One moving picture per part a chapter introduces. Later chapters add theirs. */
export const SCENES: Partial<Record<SceneId, (p: SceneProps) => JSX.Element>> = {
  cache: CacheScene,
};
```

- [ ] **Step 2: The cache scene**

Create `client/src/course/scenes/CacheScene.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { CACHE_SCENE, cacheScene, isHit } from '@loadbearing/shared';
import type { SceneProps } from './index';

/**
 * The inside of a cache: the app asks, the cache answers what it remembers, the
 * database answers the rest. The counts are the engine's; the list of saved
 * answers, their timers and the stale price are illustration, and say so.
 */

type Kind = 'hit' | 'miss' | 'stale';
interface Dot {
  n: number;
  kind: Kind;
  born: number;
}

const APP = { x: 70, y: 150 };
const CACHE = { x: 330, y: 70 };
const DB = { x: 590, y: 150 };
const HOP_MS = 380;
const EVERY_MS = 240;
const PRODUCTS = ['Lamp', 'Mug', 'Scarf', 'Kettle', 'Plant', 'Tote'];

/** What each beat starts with; the learner's own changes win until the beat changes. */
const PRESET: Record<string, { memoryGb: number; alive: boolean }> = {
  ask: { memoryGb: 0, alive: true },
  keep: { memoryGb: 2, alive: true },
  size: { memoryGb: 0.5, alive: true },
  stale: { memoryGb: 2, alive: true },
  dies: { memoryGb: 2, alive: true },
};

const route = (kind: Kind, through: boolean) =>
  !through ? [APP, DB, APP] : kind === 'miss' ? [APP, CACHE, DB, CACHE, APP] : [APP, CACHE, APP];

function at(points: { x: number; y: number }[], t: number) {
  const seg = Math.min(points.length - 2, Math.floor(t));
  const f = t - seg;
  const a = points[seg]!;
  const b = points[seg + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function CacheScene({ beat, still }: SceneProps) {
  const preset = PRESET[beat] ?? PRESET.keep!;
  const [memoryGb, setMemory] = useState(preset.memoryGb);
  const [alive, setAlive] = useState(preset.alive);
  const [ttl, setTtl] = useState(10);
  const [priceChangedAt, setPriceChangedAt] = useState<number | null>(null);
  const [dots, setDots] = useState<Dot[]>([]);
  const [now, setNow] = useState(() => performance.now());
  const count = useRef(0);

  useEffect(() => {
    setMemory(preset.memoryGb);
    setAlive(preset.alive);
    setPriceChangedAt(null);
  }, [beat, preset.memoryGb, preset.alive]);

  const on = alive && memoryGb > 0;
  const nums = cacheScene({ ...CACHE_SCENE, memoryGb, alive: on });

  // The stale window: after a price change, hits on the cached copy are wrong until the TTL runs out.
  const staleUntil = priceChangedAt === null ? 0 : priceChangedAt + ttl * 1000;

  useEffect(() => {
    if (still) return;
    const spawn = window.setInterval(() => {
      const n = count.current++;
      const t = performance.now();
      const hit = on && isHit(n, nums.hitRate);
      const kind: Kind = hit ? (t < staleUntil && n % 3 === 0 ? 'stale' : 'hit') : 'miss';
      setDots((d) => [...d.filter((x) => t - x.born < HOP_MS * 4), { n, kind, born: t }]);
    }, EVERY_MS);
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.clearInterval(spawn);
      cancelAnimationFrame(raf);
    };
  }, [still, on, nums.hitRate, staleUntil]);

  const slots = Math.max(0, Math.min(PRODUCTS.length, Math.round((memoryGb / CACHE_SCENE.workingSetGb) * PRODUCTS.length)));
  const dbBusy = Math.min(1, nums.dbRps / CACHE_SCENE.rps);
  const staleLeft = Math.max(0, Math.ceil((staleUntil - now) / 1000));

  return (
    <div className="scene scene-cache">
      <svg viewBox="0 0 660 260" role="img" aria-label="The app asks the cache first; misses go on to the database.">
        <line className="scene-wire" x1={APP.x} y1={APP.y} x2={CACHE.x} y2={CACHE.y} />
        <line className="scene-wire" x1={CACHE.x} y1={CACHE.y} x2={DB.x} y2={DB.y} />
        <line className="scene-wire faint" x1={APP.x} y1={APP.y + 14} x2={DB.x} y2={DB.y + 14} />

        <g className="scene-part" transform={`translate(${APP.x - 55},${APP.y - 30})`}>
          <rect width="110" height="60" rx="10" />
          <text x="55" y="35">Catalogue app</text>
        </g>
        <g className={`scene-part cache${on ? '' : alive ? ' off' : ' dead'}`} transform={`translate(${CACHE.x - 60},${CACHE.y - 30})`}>
          <rect width="120" height="60" rx="10" />
          <text x="60" y="30">Cache</text>
          <text className="sub" x="60" y="47">{!alive ? 'dead' : memoryGb > 0 ? `${memoryGb} GB in memory` : 'off'}</text>
        </g>
        <g className="scene-part db" transform={`translate(${DB.x - 55},${DB.y - 30})`}>
          <rect width="110" height="60" rx="10" />
          <text x="55" y="35">Shop DB</text>
          <rect className="scene-meter" x="0" y="70" width="110" height="7" rx="3.5" />
          <rect className={`scene-meter-fill${dbBusy > 0.9 ? ' hot' : ''}`} x="0" y="70" width={110 * dbBusy} height="7" rx="3.5" />
        </g>

        {!still &&
          dots.map((d) => {
            const t = (now - d.born) / HOP_MS;
            const pts = route(d.kind, on);
            if (t >= pts.length - 1) return null;
            const p = at(pts, t);
            return <circle key={d.n} className={`scene-dot ${d.kind}`} cx={p.x} cy={p.y} r="5" />;
          })}
      </svg>

      <div className="scene-shelf" aria-label="What the cache remembers (illustration)">
        {PRODUCTS.map((name, i) => (
          <div key={name} className={`scene-slot${i < slots && on ? '' : ' empty'}${priceChangedAt !== null && i === 0 && staleLeft > 0 ? ' stale' : ''}`}>
            {i < slots && on ? (
              <>
                <b>{name}</b>
                <span className="mono">{i === 0 && priceChangedAt !== null && staleLeft > 0 ? `old price · ${staleLeft}s` : `${ttl}s`}</span>
              </>
            ) : null}
          </div>
        ))}
        <span className="scene-note">Illustration: which answers are kept is a picture, not a measurement.</span>
      </div>

      <dl className="scene-stats">
        <div>
          <dt>Cache answers</dt>
          <dd className="mono">{Math.round(nums.hitRate * 100)}%</dd>
        </div>
        <div>
          <dt>Database gets</dt>
          <dd className="mono">
            {Math.round(nums.dbRps)} of {CACHE_SCENE.rps}/s
          </dd>
        </div>
        <div>
          <dt>Average answer</dt>
          <dd className="mono">{Math.round(nums.avgMs)} ms</dd>
        </div>
      </dl>

      <div className="scene-controls">
        {beat === 'size' && (
          <label className="dial">
            <span className="dial-top">
              <span>Cache · Memory</span>
              <b className="mono">{memoryGb} GB</b>
            </span>
            <input type="range" min={0.5} max={4} step={0.5} value={memoryGb} onChange={(e) => setMemory(Number(e.target.value))} />
          </label>
        )}
        {beat === 'stale' && (
          <>
            <label className="dial">
              <span className="dial-top">
                <span>Keep each answer for</span>
                <b className="mono">{ttl} s</b>
              </span>
              <input type="range" min={2} max={30} step={1} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
            </label>
            <button className="ghost" onClick={() => setPriceChangedAt(performance.now())}>
              Change the lamp's price
            </button>
          </>
        )}
        {beat === 'dies' && (
          <button className="ghost" onClick={() => setAlive((a) => !a)}>
            {alive ? 'Kill the cache' : 'Bring the cache back'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The meet screen**

Create `client/src/course/MeetLesson.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { COURSE, judgeMeet, type MeetStep } from '@loadbearing/shared';
import { api } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconBack } from '../ui/UiIcons';
import { SCENES } from './scenes';
import { STEP_KIND, stepAfter, useCourse } from './useCourse';

/**
 * A look inside the part a chapter introduces: a few beats of a moving picture,
 * then one question. Someone who already knows it can answer straight away.
 */
export function MeetLesson({ step }: { step: MeetStep }) {
  const setView = useApp((s) => s.setView);
  const setNotice = useApp((s) => s.setNotice);
  const username = useApp((s) => s.username);
  const open = useCourse((s) => s.open);
  const passed = useCourse((s) => s.passed);
  const progress = useCourse((s) => s.progress);

  const [beat, setBeat] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const chapter = COURSE.find((c) => c.id === step.chapter)!;
  const index = chapter.steps.indexOf(step);
  const Scene = SCENES[step.scene];
  const current = step.beats[beat]!;
  const done = result === 'right';
  const after = stepAfter(step);

  const answer = () => {
    if (picked === null) return;
    const v = judgeMeet(step, picked);
    if (!v.passed) {
      setResult('wrong');
      const i = step.beats.findIndex((b) => b.id === v.replay);
      if (i >= 0) setBeat(i);
      return;
    }
    setResult('right');
    if (!progress[step.id] && username) {
      void api
        .passMeet(step.id, picked)
        .then((r) => passed(r.progress.steps))
        .catch(() => setNotice('Your pass could not be saved just now. Answer it again later to count it.'));
    }
  };

  const goNext = () => {
    if (after && after.chapter === step.chapter) open(after.id);
    else setView('learn');
  };

  const passCard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) passCard.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, [done, still]);

  return (
    <div className="lesson-shell">
      <aside className="lesson-card" data-density="roomy">
        <div className="lesson-top">
          <button className="ghost" onClick={() => setView('learn')} title="Back to the path">
            <IconBack size={15} /> Path
          </button>
          <span className="lesson-where">
            Chapter {chapter.number} · {index + 1} of {chapter.steps.length}
          </span>
        </div>
        <div className="lesson-pips" aria-hidden="true">
          {chapter.steps.map((s) => (
            <i key={s.id} className={progress[s.id] ? 'done' : s.id === step.id ? 'cur' : ''} />
          ))}
        </div>

        <span className="chip spec lesson-kind">{STEP_KIND.meet}</span>
        <h1>{step.title}</h1>
        <p className="lesson-story">{step.story}</p>

        <ol className="meet-beats">
          {step.beats.map((b, i) => (
            <li key={b.id}>
              <button className={i === beat ? 'on' : ''} aria-current={i === beat ? 'step' : undefined} onClick={() => setBeat(i)}>
                <span className="mono">{i + 1}</span> {b.title}
              </button>
            </li>
          ))}
        </ol>
        <p className="meet-caption" aria-live="polite">
          {current.caption}
        </p>
        {beat < step.beats.length - 1 && (
          <button className="ghost meet-next" onClick={() => setBeat(beat + 1)}>
            Next: {step.beats[beat + 1]!.title}
          </button>
        )}

        {!done && (
          <section className="meet-check">
            <p className="meet-q">
              <b>{beat === step.beats.length - 1 ? 'Your turn.' : 'Know this already?'}</b> {step.check.question}
            </p>
            <div className="meet-options" role="radiogroup">
              {step.check.options.map((o, i) => (
                <button
                  key={o}
                  role="radio"
                  aria-checked={picked === i}
                  className={picked === i ? 'on' : ''}
                  onClick={() => {
                    setPicked(i);
                    setResult(null);
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
            <button className="primary" onClick={answer} disabled={picked === null}>
              Check
            </button>
            {result === 'wrong' && <p className="lesson-nudge">Not quite. Watch “{current.title}” again, then try once more.</p>}
          </section>
        )}

        {done && (
          <div className="pass-card" ref={passCard}>
            <div className="pass-head">
              <span className="pass-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <b>Got it</b>
            </div>
            <p>{step.check.because}</p>
            <p>{step.lesson}</p>
            <button className="primary" onClick={goNext}>
              {after && after.chapter === step.chapter ? `Next: ${after.title}` : 'Back to the path'}
            </button>
          </div>
        )}
      </aside>

      <section className="lesson-bench meet-bench">{Scene ? <Scene beat={current.id} still={still} /> : null}</section>
    </div>
  );
}
```

- [ ] **Step 4: "See it again" in practice-step hints**

In `client/src/course/Lesson.tsx`, import `meetFor` from `./useCourse`; in `LessonFor` add `const meet = meetFor(step);` and inside the hint box, after the concept paragraph:

```tsx
            {hints > 1 && meet && (
              <button className="link" onClick={() => open(meet.id)}>
                See “{meet.title}” again
              </button>
            )}
```

- [ ] **Step 5: Styles**

Append to `client/src/styles/course.css`:

```css
/* ------------------------------------------------------------ meet steps -- */

.meet-beats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.meet-beats button {
  width: 100%;
  text-align: left;
  font-size: var(--t-13);
  color: var(--fg-2);
  padding: 6px 10px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  background: none;
}
.meet-beats button.on {
  color: var(--fg);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.meet-caption {
  margin: 0;
  font-size: var(--t-15);
  line-height: 1.55;
  color: var(--fg);
}
.meet-next {
  align-self: flex-start;
}
.meet-check {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.meet-q {
  margin: 0;
  font-size: var(--t-14);
  line-height: 1.55;
}
.meet-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.meet-options button {
  border-radius: var(--r-pill);
  border: 1px solid var(--line-2);
  background: var(--surface);
  padding: 6px 14px;
  font-size: var(--t-13);
}
.meet-options button.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--fg);
}
.meet-bench {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow-y: auto;
}

.scene {
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.scene svg {
  width: 100%;
  height: auto;
}
.scene-wire {
  stroke: var(--line-2);
  stroke-width: 1.5;
}
.scene-wire.faint {
  stroke-dasharray: 4 5;
  stroke: var(--line);
}
.scene-part rect:first-child {
  fill: var(--surface);
  stroke: var(--line-2);
  stroke-width: 1.2;
}
.scene-part text {
  text-anchor: middle;
  font-size: 13px;
  fill: var(--fg);
}
.scene-part text.sub {
  font-size: 11px;
  fill: var(--muted);
}
.scene-part.cache rect:first-child {
  stroke: var(--accent);
}
.scene-part.cache.off rect:first-child {
  stroke: var(--line);
  stroke-dasharray: 4 4;
}
.scene-part.cache.dead rect:first-child {
  stroke: var(--fail);
}
.scene-meter {
  fill: var(--surface-2);
}
.scene-meter-fill {
  fill: var(--load);
}
.scene-meter-fill.hot {
  fill: var(--fail);
}
.scene-dot.hit {
  fill: var(--pass);
}
.scene-dot.miss {
  fill: var(--load);
}
.scene-dot.stale {
  fill: var(--fail);
}
.scene-shelf {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}
.scene-slot {
  min-height: 44px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-2);
  background: var(--surface);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  font-size: var(--t-12);
}
.scene-slot.empty {
  border-style: dashed;
  background: none;
}
.scene-slot.stale {
  border-color: var(--fail);
  color: var(--fail);
}
.scene-note {
  grid-column: 1 / -1;
  font-size: var(--t-12);
  color: var(--muted);
}
.scene-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.scene-stats div {
  background: var(--surface-2);
  border-radius: var(--r-md);
  padding: 10px 12px;
}
.scene-stats dt {
  font-size: var(--t-12);
  color: var(--muted);
}
.scene-stats dd {
  margin: 2px 0 0;
  font-size: var(--t-17);
  color: var(--fg);
}
.scene-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}
.scene-controls .dial {
  flex: 1;
  min-width: 220px;
}
@media (max-width: 720px) {
  .scene-shelf {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

If `button.link` has no style in `base.css`, use `className="ghost"` instead.

- [ ] **Step 6: Typecheck, lint, client tests**

Run: `npm run build:shared && npm --workspace client run typecheck && npm --workspace client run test`
Expected: no type errors; `styles/contrast.test.ts` and `tokens.test.ts` still pass (they read the token files; the new rules only consume existing tokens).

- [ ] **Step 7: Commit (Tasks 6 + 7 together)**

```bash
git add client/src
git commit -m "A look inside the cache, played beat by beat before chapter 3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-suite check

**Files:** none new.

- [ ] **Step 1: Run everything**

Run: `npm test` then `npm run typecheck`
Expected: all workspaces PASS. Paste the summary lines into the task notes. If the calibration snapshot (`shared/src/calibration`) fails, that is not caused by this plan (no engine code changed) — stop and report it rather than updating the snapshot.

---

### Task 9: Drive it in the running app

**Files:**
- Modify: `.claude/launch.json` in the worktree — add a config:

```json
    {
      "name": "course-dev",
      "runtimeExecutable": "cmd",
      "runtimeArgs": [
        "/c",
        "set LOADBEARING_PORT=8789&& set LOADBEARING_CLIENT_PORT=5175&& set LOADBEARING_DB=<scratchpad>\\course-meet.sqlite&& npm run dev"
      ],
      "port": 5175
    }
```

Replace `<scratchpad>` with the session scratchpad directory. Never point it at `data/loadbearing.sqlite`.

- [ ] **Step 1:** `preview_start` `course-dev`; register a throwaway account (e.g. `meet-check-1`).
- [ ] **Step 2:** On a fresh account the Learn page shows chapter 3 locked. To reach it without playing chapters 0–2, pass their steps through the API with each step's stored solution (a small script calling `POST /api/course/steps/:id/pass` with `applyPatch(startGraph(step), step.solution)` as the authenticated user), then reload the Learn page. Confirm chapter 3 shows "Meet the cache" with the book mark.
- [ ] **Step 3:** Open "Meet the cache". Play beats 1–5: beat 1 shows the cache off and every dot going straight to the database; beat 2 shows green hits returning from the cache; beat 3's slider moves "Cache answers" from 35% (0.5 GB) to 80% (3+ GB); beat 4's "Change the lamp's price" turns the lamp slot and some dots red until the timer runs out; beat 5's "Kill the cache" fills the database meter and shows "Database gets 200 of 200/s". Check the console for errors (`read_console_messages`).
- [ ] **Step 4:** Pick a wrong answer → "Not quite", the scene jumps to beat 5. Pick 200 → "Got it", pass card, `Next: The same question, 200 times`. Reload the Learn page: 3-0 shows done.
- [ ] **Step 5:** Skipping: with a second throwaway account at the same point, open the step and answer correctly on beat 1 → passes.
- [ ] **Step 6:** Play 3-1 to 3-6 in the UI with the intended solutions (predict the database on 3-1; place the cache and rewire on 3-2; dial 2 GB on 3-3; watch 3-4; rewire checkout on 3-5; wire + 2 GB on 3-6) and confirm each passes; on 3-3 drag to 4 GB and confirm the budget goal fails. On 3-2, open hints twice and confirm "See “Meet the cache” again" opens the meet step.
- [ ] **Step 7:** `resize_window` with `colorScheme: 'dark'` and check the scene; emulate reduced motion (`javascript_tool` cannot set it — instead check the code path by temporarily forcing `still` in devtools, or confirm via the static rendering that no dots render when `still` is true). Reset the viewport to `desktop` afterwards.
- [ ] **Step 8:** Screenshot the meet step on beat 3 and the 3-6 pass card as proof. Commit the launch config only if the user wants it kept; otherwise leave it uncommitted.
