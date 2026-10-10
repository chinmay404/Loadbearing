# Beginner Ladder and Easy Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Start here" ladder of 12 beginner sheets with hints, glossary and gentle grading, and replace hand-built flows with request cards whose path is read from the learner's arrows.

**Architecture:** New optional `Problem` fields (`track`, `learn`, `hints`, `glossary`, `flowPlans`) carry the beginner content. They are validated on the server, shown by `BriefPanel`, grouped by a pure `startHereRows` helper in the Problems page, and passed to the grader as a user-message block. A new pure module `shared/src/flowPlans.ts` turns a problem into request plans and matches each plan to a path from the engine's own path walk. `FlowPanel` renders one card per plan on top of the unchanged canvas-store flow API.

**Tech Stack:** TypeScript monorepo (npm workspaces `shared`, `server`, `client`), Vitest, Hono server, React 18 with Zustand.

**Spec:** `docs/superpowers/specs/2026-10-10-beginner-ladder-and-easy-flows-design.md`

## Global Constraints

- Beginner sheets have `level: 1`, carry `track`, and use ids `l1-start-<topic>-basics` / `l1-start-<topic>-step-up` (the existing `^l[1-6]-` rule still holds).
- Topics, in display order: `photo-upload`, `ai-chat`, `product-page`, `stay-up`, `background-work`, `short-links`.
- Prompts are at most 5 sentences, with 1–2 numbers and no unexplained jargon. There are 3–5 hints and ≥ 2 glossary entries, plus one `flowPlan` per expected flow.
- The grader's **system** prompt must stay byte-identical for a sheet with and without `track` (provider prefix caching). The beginner instructions go in the **user** message.
- The canvas-store flow API (`addFlow`, `updateFlow`, `removeFlow`, `appendFlowStep`, `removeFlowStep`) is unchanged.
- Sheets without `track` render exactly as before in the Brief tab.
- Real data lives in `data/loadbearing.sqlite`. Verify in the browser only with the `scratch` launch config and a throwaway account.
- Commit messages follow the repo's style (an imperative sentence about the behaviour) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A learner draws two app servers behind a load balancer.** `matchPath` finds two equally short paths and must offer a choice, never crash or pick silently. *(Task 1 test "offers a choice between equally short paths".)*
2. **A learner deletes a box that an accepted flow passes through.** The card must say "Your drawing changed", not show a stale path as current. *(Task 1 test "a step that is gone breaks the path".)*
3. **An existing L1 sheet with names only.** Plans are derived with a guessed kind and 100 rps; a name such as "nightly catalog import" must come out `async`, not `write`. *(Task 1 kind-guess table.)*
4. **A composed or custom sheet sends malformed beginner fields** (a hint with no text, a `mustReach` with an unknown type). They are dropped, never rejected and never passed through. *(Task 2 test "drops malformed beginner fields".)*
5. **The Step-up sheet must actually need the step up.** The Basics design must fail at least one Step-up gate, or the ladder teaches nothing. *(Task 4 ladder test "the basics design does not pass the step up".)*

---

### Task 0: Commit the teaching coach

The coach rewrite from the previous session is uncommitted (`server/src/scoring/prompt.ts`, `routes.ts`, the two test files, `client/src/panels/AskPanel.tsx`, `docs/HOW-LOADBEARING-WORKS.md`).

- [ ] **Step 1: Run the scoring tests**

Run: `npm --workspace server run test -- src/scoring`
Expected: PASS

- [ ] **Step 2: Commit only those files**

```bash
git add server/src/scoring/prompt.ts server/src/scoring/routes.ts server/src/scoring/prompt.test.ts server/src/scoring/chat.test.ts client/src/panels/AskPanel.tsx docs/HOW-LOADBEARING-WORKS.md
git commit -m "Teach in plain words instead of answering questions with questions"
```

---

### Task 1: Types and flow plans (shared)

**Files:**
- Modify: `shared/src/types.ts` (the `Problem` interface ~line 441; `ProblemSummary` ~line 506)
- Modify: `shared/src/engine.ts` (add `requestPaths` next to `entryPoints`, ~line 777)
- Create: `shared/src/flowPlans.ts`
- Modify: `shared/src/index.ts` (export the new module)
- Test: `shared/src/flowPlans.test.ts`

**Interfaces:**
- Produces:
  - Types: `ProblemTrack`, `ProblemHint`, `GlossaryEntry`, `FlowPlan`.
  - `requestPaths(graph: GraphDSL): PathReport[]`.
  - `guessFlowKind(name: string): FlowKind`.
  - `plansFor(problem: Pick<Problem, 'expectedFlows' | 'flowPlans'>): FlowPlan[]`.
  - `candidatePaths(graph: GraphDSL): string[][]`.
  - `type PathMatch = { status: 'found'; path: string[] } | { status: 'choose'; paths: string[][] } | { status: 'none' }`.
  - `matchPath(plan: FlowPlan, graph: GraphDSL): PathMatch`.
  - `isPathBroken(steps: string[], graph: GraphDSL): boolean`.
  - `sameFlowName(a: string, b: string): boolean`.

- [ ] **Step 1: Add the types**

In `shared/src/types.ts`, directly above `export interface Problem {`:

```ts
/** Where a beginner sheet sits on the "Start here" ladder. */
export interface ProblemTrack {
  /** One of the ladder topics, e.g. 'photo-upload'. */
  topic: string;
  stage: 'basics' | 'step-up';
  /** The sheet to open after this one. */
  next?: string;
}

/** One hint on a beginner sheet, revealed one at a time. */
export interface ProblemHint {
  text: string;
  /** "Show me": the one component this hint is about, placed as a ghost. */
  ghost?: { type: ArchNodeType; label: string; annotation?: string };
}

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

/**
 * One request the design must handle, filled in for the learner so declaring a
 * flow is a confirmation rather than five unexplained decisions.
 */
export interface FlowPlan {
  /** Matches an `expectedFlows` entry, so coverage still counts. */
  name: string;
  kind: FlowKind;
  rps: number;
  /** One sentence a beginner can read: what this request is. */
  plain: string;
  /**
   * How to recognise this request's path in a drawing: each inner list is "the path
   * passes through one of these types". Absent = any path from where traffic starts.
   */
  mustReach?: ArchNodeType[][];
}
```

Inside `export interface Problem`, after `custom?: boolean;`:

```ts
  /** Present only on "Start here" sheets. */
  track?: ProblemTrack;
  /** One line: what this sheet teaches. */
  learn?: string;
  hints?: ProblemHint[];
  glossary?: GlossaryEntry[];
  /** Pre-filled requests; derived from `expectedFlows` when absent. */
  flowPlans?: FlowPlan[];
```

Change `ProblemSummary` to:

```ts
export type ProblemSummary = Pick<
  Problem,
  'id' | 'title' | 'level' | 'domain' | 'concepts' | 'custom' | 'kind' | 'track'
>;
```

- [ ] **Step 2: Expose the engine's path walk**

In `shared/src/engine.ts`, directly after `entryPoints`:

```ts
/**
 * Every request path from where traffic starts, walked exactly as the engine walks
 * them. Exported so a flow can be read off the drawing instead of typed in.
 */
export function requestPaths(graph: GraphDSL): PathReport[] {
  return prepare(graph).paths;
}
```

- [ ] **Step 3: Write the failing tests**

Create `shared/src/flowPlans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GraphDSL, GraphNode } from './types.js';
import { guessFlowKind, isPathBroken, matchPath, plansFor, sameFlowName } from './flowPlans.js';

const node = (id: string, type: GraphNode['type']): GraphNode => ({ id, type, label: id, annotation: '' });
const graph = (nodes: GraphNode[], edges: [string, string][]): GraphDSL => ({
  nodes,
  edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, kind: 'sync' })),
  stickies: [],
  flows: [],
});

describe('guessFlowKind', () => {
  it.each([
    ['image upload', 'write'],
    ['merchandiser price update', 'write'],
    ['image deletion', 'write'],
    ['nightly catalog import', 'async'],
    ['derivative generation', 'async'],
    ['admin refund', 'admin'],
    ['product detail read', 'read'],
    ['feed page', 'read'],
  ])('%s → %s', (name, kind) => {
    expect(guessFlowKind(name)).toBe(kind);
  });
});

describe('plansFor', () => {
  it('uses an authored plan when one matches the name, ignoring case and spaces', () => {
    const plans = plansFor({
      expectedFlows: ['Upload a photo'],
      flowPlans: [{ name: 'upload a photo ', kind: 'write', rps: 20, plain: 'A user sends a photo.' }],
    });
    expect(plans).toEqual([{ name: 'upload a photo ', kind: 'write', rps: 20, plain: 'A user sends a photo.' }]);
  });

  it('derives a plan for a name that has none', () => {
    expect(plansFor({ expectedFlows: ['image upload'] })).toEqual([
      { name: 'image upload', kind: 'write', rps: 100, plain: '' },
    ]);
  });
});

describe('matchPath', () => {
  const photo = graph(
    [node('u', 'client'), node('app', 'service'), node('store', 'blob_store'), node('q', 'queue'), node('w', 'worker')],
    [['u', 'app'], ['app', 'store'], ['app', 'q'], ['q', 'w']],
  );

  it('finds the one path that reaches what the request needs, cut where it gets there', () => {
    const m = matchPath({ name: 'upload', kind: 'write', rps: 20, plain: '', mustReach: [['blob_store']] }, photo);
    expect(m).toEqual({ status: 'found', path: ['u', 'app', 'store'] });
  });

  it('honours every group, in the order the path reaches them', () => {
    const m = matchPath({ name: 'thumb', kind: 'async', rps: 20, plain: '', mustReach: [['queue'], ['worker']] }, photo);
    expect(m).toEqual({ status: 'found', path: ['u', 'app', 'q', 'w'] });
  });

  it('says none when nothing drawn reaches it', () => {
    const m = matchPath({ name: 'view', kind: 'read', rps: 20, plain: '', mustReach: [['cdn']] }, photo);
    expect(m).toEqual({ status: 'none' });
  });

  it('offers a choice between equally short paths', () => {
    const twoServers = graph(
      [node('u', 'client'), node('lb', 'load_balancer'), node('a', 'service'), node('b', 'service'), node('db', 'sql_db')],
      [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'db'], ['b', 'db']],
    );
    const m = matchPath({ name: 'read', kind: 'read', rps: 50, plain: '', mustReach: [['sql_db']] }, twoServers);
    expect(m.status).toBe('choose');
    if (m.status === 'choose') expect(m.paths).toHaveLength(2);
  });

  it('with no mustReach, offers every distinct path to choose from', () => {
    const m = matchPath({ name: 'x', kind: 'read', rps: 1, plain: '' }, photo);
    expect(m.status).toBe('choose');
  });

  it('says none on an empty canvas', () => {
    expect(matchPath({ name: 'x', kind: 'read', rps: 1, plain: '' }, graph([], []))).toEqual({ status: 'none' });
  });
});

describe('isPathBroken', () => {
  const g = graph([node('u', 'client'), node('app', 'service'), node('db', 'sql_db')], [['u', 'app'], ['app', 'db']]);

  it('accepts a path the drawing still carries', () => {
    expect(isPathBroken(['u', 'app', 'db'], g)).toBe(false);
  });

  it('accepts a step called by an earlier step, not only the one before (API → cache, API → db)', () => {
    const fan = graph(
      [node('u', 'client'), node('api', 'service'), node('c', 'cache'), node('db', 'sql_db')],
      [['u', 'api'], ['api', 'c'], ['api', 'db']],
    );
    expect(isPathBroken(['u', 'api', 'c', 'db'], fan)).toBe(false);
  });

  it('a step that is gone breaks the path', () => {
    expect(isPathBroken(['u', 'app', 'gone'], g)).toBe(true);
  });

  it('a step nothing earlier calls breaks the path', () => {
    expect(isPathBroken(['u', 'db'], g)).toBe(true);
  });

  it('an empty flow is not broken, just empty', () => {
    expect(isPathBroken([], g)).toBe(false);
  });
});

describe('sameFlowName', () => {
  it('ignores case and surrounding space', () => {
    expect(sameFlowName(' Upload a photo', 'upload a photo')).toBe(true);
    expect(sameFlowName('upload', 'view')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npm --workspace shared run test -- flowPlans`
Expected: FAIL. `./flowPlans.js` cannot be resolved.

- [ ] **Step 5: Implement**

Create `shared/src/flowPlans.ts`:

```ts
// Requests a sheet asks for, and where they go in a drawing.
//
// Declaring a flow used to be five unexplained decisions — a name, a kind, a
// rate, a guarantee, and steps picked from a dropdown in order. A sheet already
// knows the first three, and the drawing already says the last one: the arrows
// are the path. This turns "declare a flow" into "confirm the path we found".

import { requestPaths } from './engine.js';
import type { FlowKind, FlowPlan, GraphDSL, Problem } from './types.js';

/** What an underived plan assumes, and what a new flow defaults to anyway. */
export const DEFAULT_PLAN_RPS = 100;
/** More than this many paths is a list nobody reads. */
const MAX_CHOICES = 4;

const KIND_WORDS: [FlowKind, RegExp][] = [
  ['admin', /\badmin/],
  ['async', /\b(job|jobs|worker|background|generation|export|nightly|process|processing|resize|fan-?out|digest|reindex)/],
  ['write', /(upload|writ|creat|updat|delet|checkout|pay|send|import|post|submit|reserv|charge|register|sign ?up|shorten)/],
];

export function guessFlowKind(name: string): FlowKind {
  const n = name.toLowerCase();
  for (const [kind, re] of KIND_WORDS) if (re.test(n)) return kind;
  return 'read';
}

export const sameFlowName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One plan per expected flow: the authored one when it exists, a guessed one when not. */
export function plansFor(problem: Pick<Problem, 'expectedFlows' | 'flowPlans'>): FlowPlan[] {
  const authored = problem.flowPlans ?? [];
  return problem.expectedFlows.map(
    (name) =>
      authored.find((p) => sameFlowName(p.name, name)) ?? {
        name,
        kind: guessFlowKind(name),
        rps: DEFAULT_PLAN_RPS,
        plain: '',
      },
  );
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Distinct request paths of two or more steps, from where traffic starts. */
export function candidatePaths(graph: GraphDSL): string[][] {
  const out: string[][] = [];
  for (const { nodeIds } of requestPaths(graph)) {
    if (nodeIds.length >= 2 && !out.some((p) => same(p, nodeIds))) out.push(nodeIds);
  }
  return out;
}

export type PathMatch =
  | { status: 'found'; path: string[] }
  | { status: 'choose'; paths: string[][] }
  | { status: 'none' };

/**
 * The path in the drawing this request takes.
 *
 * A path qualifies when it passes through one type from every `mustReach` group;
 * it is cut just after the last group is reached, because an upload ends at the
 * storage it writes to even if the drawing carries on past it. The shortest
 * qualifying paths win; one is "found", several are offered as a choice.
 */
export function matchPath(plan: FlowPlan, graph: GraphDSL): PathMatch {
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const groups = plan.mustReach ?? [];
  const fits: string[][] = [];
  for (const path of candidatePaths(graph)) {
    let end = 1;
    let ok = true;
    for (const group of groups) {
      const at = path.findIndex((id) => group.includes(typeOf.get(id)!));
      if (at < 0) {
        ok = false;
        break;
      }
      end = Math.max(end, at);
    }
    if (!ok) continue;
    const steps = groups.length ? path.slice(0, end + 1) : path;
    if (!fits.some((f) => same(f, steps))) fits.push(steps);
  }
  if (fits.length === 0) return { status: 'none' };
  if (groups.length === 0) return { status: 'choose', paths: fits.slice(0, MAX_CHOICES) };
  const shortest = Math.min(...fits.map((f) => f.length));
  const best = fits.filter((f) => f.length === shortest);
  return best.length === 1
    ? { status: 'found', path: best[0]! }
    : { status: 'choose', paths: best.slice(0, MAX_CHOICES) };
}

/**
 * True when a flow's steps no longer describe a path in the drawing — a step was
 * deleted, or nothing earlier in the flow calls it. The same rule the simulator
 * applies, so the card and the load run never disagree.
 */
export function isPathBroken(steps: string[], graph: GraphDSL): boolean {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return steps.some(
    (id, i) =>
      !ids.has(id) ||
      (i > 0 && !graph.edges.some((e) => e.to === id && steps.slice(0, i).includes(e.from))),
  );
}
```

In `shared/src/index.ts`, add the line `export * from './flowPlans.js';`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm --workspace shared run test -- flowPlans`
Expected: PASS. If "offers a choice between equally short paths" returns `found`, `requestPaths` is collapsing the two branches. Print `candidatePaths(twoServers)` and fix `candidatePaths`, not the test.

- [ ] **Step 7: Run the whole shared suite and typecheck**

Run: `npm --workspace shared run test` and then `npm run typecheck`
Expected: PASS for both.

- [ ] **Step 8: Commit**

```bash
git add shared/src/types.ts shared/src/engine.ts shared/src/flowPlans.ts shared/src/flowPlans.test.ts shared/src/index.ts
git commit -m "Read a request's path off the drawing instead of having it typed in"
```

---

### Task 2: Validation, audit and the summary (server)

**Files:**
- Modify: `server/src/problems/validate.ts` (`validateProblem` return ~line 73; `auditSeedProblem` ~line 166)
- Modify: `server/src/problems/routes.ts:41-49` (`summarize`)
- Test: `server/src/problems/validate.test.ts`

**Interfaces:**
- Consumes: the types from Task 1.
- Produces:
  - `validateProblem` keeps `track`, `learn`, `hints`, `glossary` and `flowPlans`.
  - `auditSeedProblem(p)` applies beginner rules when `p.track` is set.
  - `/api/problems` summaries carry `track`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/problems/validate.test.ts`. Use its existing imports; add `auditSeedProblem` to the import from `./validate.js` if missing.

```ts
describe('beginner fields', () => {
  const base = {
    id: 'l1-start-x-basics',
    title: 'X',
    level: 1,
    prompt: 'You are building a small app that needs somewhere to keep photos people upload every day.',
    concepts: ['blob-storage', 'capacity-estimation'],
    functional: ['upload a photo', 'view a photo'],
    twists: ['views jump'],
    expectedFlows: ['upload a photo'],
  };

  it('keeps well-formed beginner fields', () => {
    const p = validateProblem({
      ...base,
      track: { topic: 'photo-upload', stage: 'basics', next: 'l1-start-x-step-up' },
      learn: 'Photos belong in object storage.',
      hints: [{ text: 'Where do photos live?', ghost: { type: 'blob_store', label: 'Photo storage' } }],
      glossary: [{ term: 'object storage', meaning: 'a cheap place for files' }],
      flowPlans: [{ name: 'upload a photo', kind: 'write', rps: 20, plain: 'A user sends a photo.', mustReach: [['blob_store']] }],
    });
    expect(p.track).toEqual({ topic: 'photo-upload', stage: 'basics', next: 'l1-start-x-step-up' });
    expect(p.learn).toBe('Photos belong in object storage.');
    expect(p.hints).toEqual([{ text: 'Where do photos live?', ghost: { type: 'blob_store', label: 'Photo storage' } }]);
    expect(p.glossary).toHaveLength(1);
    expect(p.flowPlans?.[0]?.mustReach).toEqual([['blob_store']]);
  });

  it('drops malformed beginner fields rather than rejecting the sheet', () => {
    const p = validateProblem({
      ...base,
      track: { topic: '', stage: 'expert' },
      hints: [{ text: '' }, { text: 'ok', ghost: { type: 'not_a_type', label: 'x' } }],
      glossary: [{ term: 'x' }],
      flowPlans: [{ name: 'upload a photo', kind: 'teleport', rps: -5, plain: 'p', mustReach: [['nope'], ['cdn']] }],
    });
    expect(p.track).toBeUndefined();
    expect(p.hints).toEqual([{ text: 'ok' }]);
    expect(p.glossary).toBeUndefined();
    expect(p.flowPlans).toEqual([{ name: 'upload a photo', kind: 'read', rps: 0, plain: 'p', mustReach: [['cdn']] }]);
  });
});

describe('the seed audit for beginner sheets', () => {
  const sheet = {
    id: 'l1-start-photo-upload-basics',
    title: 'Photo Upload: Basics',
    level: 1 as const,
    domain: 'social',
    prompt: 'You are building a small photo-sharing app. People upload photos and look at them later, about 20 uploads a second.',
    functional: ['upload', 'view'],
    nonFunctional: { uploadRps: 20, viewRps: 100 },
    constraints: ['one developer'],
    concepts: ['blob-storage', 'capacity-estimation'],
    expectedFlows: ['upload a photo'],
    rubricHints: 'This sheet teaches one idea: photo bytes go to object storage, not the app server disk or a database.',
    twists: ['views jump'],
    scenarios: [{ id: 's', name: 'S', description: 'd', rpsMultiplier: 2, passCriteria: 'keeps working' }],
    track: { topic: 'photo-upload', stage: 'basics' as const },
    learn: 'Photos belong in object storage.',
    hints: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    glossary: [{ term: 'a', meaning: 'b' }, { term: 'c', meaning: 'd' }],
    flowPlans: [{ name: 'upload a photo', kind: 'write' as const, rps: 20, plain: 'p' }],
  };

  it('accepts a sheet that meets the lighter bar', () => {
    expect(auditSeedProblem(sheet)).toEqual([]);
  });

  it('requires the beginner fields', () => {
    const issues = auditSeedProblem({ ...sheet, learn: '', hints: [{ text: 'a' }], glossary: [], flowPlans: [] });
    expect(issues).toEqual([
      'l1-start-photo-upload-basics: beginner sheet needs a learn line',
      'l1-start-photo-upload-basics: beginner sheet needs 3-5 hints',
      'l1-start-photo-upload-basics: beginner sheet needs at least 2 glossary entries',
      'l1-start-photo-upload-basics: no flow plan for "upload a photo"',
    ]);
  });

  it('keeps the full bar for every other sheet', () => {
    const { track: _t, ...plain } = sheet;
    expect(auditSeedProblem(plain)).toContain('l1-start-photo-upload-basics: fewer than 3 functional requirements');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --workspace server run test -- src/problems/validate.test.ts`
Expected: FAIL. `p.track` is undefined, and the audit reports the full-bar issues for the beginner sheet.

- [ ] **Step 3: Implement validation**

In `server/src/problems/validate.ts`, add below `strArray`:

```ts
const STAGES = new Set(['basics', 'step-up']);

/** Beginner-sheet fields: each kept when well formed, dropped (never rejected) when not. */
function beginnerFields(o: Record<string, unknown>): Partial<Problem> {
  const out: Partial<Problem> = {};

  const t = (o.track ?? {}) as Record<string, unknown>;
  if (str(t.topic).trim() && STAGES.has(str(t.stage))) {
    out.track = {
      topic: str(t.topic).trim(),
      stage: str(t.stage) as 'basics' | 'step-up',
      ...(str(t.next).trim() ? { next: str(t.next).trim() } : {}),
    };
  }

  if (str(o.learn).trim()) out.learn = str(o.learn).trim();

  const hints = (Array.isArray(o.hints) ? o.hints : [])
    .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null && str(h.text).trim() !== '')
    .map((h) => {
      const g = (h.ghost ?? {}) as Record<string, unknown>;
      const ghost =
        NODE_TYPE_SET.has(str(g.type)) && str(g.label).trim()
          ? {
              type: str(g.type) as ArchNodeType,
              label: str(g.label).trim(),
              ...(str(g.annotation).trim() ? { annotation: str(g.annotation).trim() } : {}),
            }
          : undefined;
      return { text: str(h.text).trim(), ...(ghost ? { ghost } : {}) };
    });
  if (hints.length) out.hints = hints;

  const glossary = (Array.isArray(o.glossary) ? o.glossary : [])
    .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
    .filter((g) => str(g.term).trim() && str(g.meaning).trim())
    .map((g) => ({ term: str(g.term).trim(), meaning: str(g.meaning).trim() }));
  if (glossary.length) out.glossary = glossary;

  const plans = (Array.isArray(o.flowPlans) ? o.flowPlans : [])
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && str(p.name).trim() !== '')
    .map((p) => {
      const reach = (Array.isArray(p.mustReach) ? p.mustReach : [])
        .map((group) => strArray(group).filter((t) => NODE_TYPE_SET.has(t)))
        .filter((group) => group.length > 0);
      return {
        name: str(p.name).trim(),
        kind: (FLOW_KINDS.has(str(p.kind)) ? str(p.kind) : 'read') as FlowKind,
        rps: Math.max(0, num(p.rps)),
        plain: str(p.plain).trim(),
        ...(reach.length ? { mustReach: reach as ArchNodeType[][] } : {}),
      };
    });
  if (plans.length) out.flowPlans = plans;

  return out;
}
```

Change the type import line to:

```ts
import type { ArchNodeType, FlowKind, LoadScenario, Problem, ProblemDiagram } from '@loadbearing/shared';
```

In `validateProblem`'s return object, add `...beginnerFields(o),` directly after `custom: true,`.

- [ ] **Step 4: Implement the audit**

Replace the minimum-count lines in `auditSeedProblem`, from `if (p.functional.length < 3)` through `if (p.scenarios.length < 2)`, with:

```ts
  // A beginner sheet teaches one idea with a handful of boxes; holding it to the
  // full bar would force exactly the clutter it exists to avoid.
  const min = p.track
    ? { functional: 2, numbers: 2, constraints: 1, concepts: 2, flows: 1, twists: 1, scenarios: 1 }
    : { functional: 3, numbers: 3, constraints: 2, concepts: 4, flows: 2, twists: 2, scenarios: 2 };
  if (p.functional.length < min.functional) issues.push(`${p.id}: fewer than ${min.functional} functional requirements`);
  if (Object.keys(p.nonFunctional).length < min.numbers) issues.push(`${p.id}: fewer than ${min.numbers} non-functional numbers`);
  if (p.constraints.length < min.constraints) issues.push(`${p.id}: fewer than ${min.constraints} constraints`);
  if (p.concepts.length < min.concepts) issues.push(`${p.id}: fewer than ${min.concepts} rubric concepts`);
  for (const c of p.concepts) if (!CONCEPT_SET.has(c)) issues.push(`${p.id}: unknown concept "${c}"`);
  if (p.expectedFlows.length < min.flows) issues.push(`${p.id}: fewer than ${min.flows} expected flows`);
  if (p.rubricHints.trim().length < 80) issues.push(`${p.id}: rubricHints too vague`);
  if (p.twists.length < min.twists) issues.push(`${p.id}: fewer than ${min.twists} twists`);
  if (p.scenarios.length < min.scenarios) issues.push(`${p.id}: fewer than ${min.scenarios} load scenarios`);
```

These messages read "fewer than 3 functional requirements" for normal sheets, the same text as before. Directly before `issues.push(...auditSeedDiagram(p));`, add:

```ts
  if (p.track) {
    if (!p.learn?.trim()) issues.push(`${p.id}: beginner sheet needs a learn line`);
    const hints = p.hints?.length ?? 0;
    if (hints < 3 || hints > 5) issues.push(`${p.id}: beginner sheet needs 3-5 hints`);
    if ((p.glossary?.length ?? 0) < 2) issues.push(`${p.id}: beginner sheet needs at least 2 glossary entries`);
    for (const f of p.expectedFlows) {
      if (!p.flowPlans?.some((plan) => plan.name.trim().toLowerCase() === f.trim().toLowerCase())) {
        issues.push(`${p.id}: no flow plan for "${f}"`);
      }
    }
  }
```

- [ ] **Step 5: Carry `track` in the summary**

In `server/src/problems/routes.ts` `summarize`, add `...(p.track ? { track: p.track } : {}),` after `kind: p.kind,`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm --workspace server run test -- src/problems`
Expected: PASS, and `bank.test.ts` is still green because no sheet has `track` yet.

- [ ] **Step 7: Commit**

```bash
git add server/src/problems/validate.ts server/src/problems/validate.test.ts server/src/problems/routes.ts
git commit -m "Let a sheet carry a ladder position, hints, a glossary and its requests"
```

---

### Task 3: Gentle grading and a coach that knows the sheet (server)

**Files:**
- Modify: `server/src/scoring/prompt.ts` (`renderProblem` ~line 136, `buildScoringPrompt` ~line 315)
- Test: `server/src/scoring/prompt.test.ts`

**Interfaces:**
- Consumes: `Problem.track`, `learn`, `hints`, `glossary`.
- Produces: `renderProblem` output and the scoring user message include the beginner content when `track` is set.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/scoring/prompt.test.ts`. Extend the import to `import { buildCritiquePrompt, buildScoringPrompt } from './prompt.js';`.

```ts
describe('beginner sheets', () => {
  const beginner: Problem = {
    ...problem,
    level: 1,
    track: { topic: 'photo-upload', stage: 'basics' },
    learn: 'Photos belong in object storage, not on the app server.',
    hints: [{ text: 'Where do the photo files live?' }],
    glossary: [{ term: 'object storage', meaning: 'a cheap place to keep files' }],
  };

  it('tells the grader to judge the one idea, in plain words', () => {
    const { user } = buildScoringPrompt({ problem: beginner, graph });
    expect(user).toContain('BEGINNER SHEET');
    expect(user).toContain('Photos belong in object storage, not on the app server.');
    expect(user).toContain('at least 65 overall');
  });

  it('keeps the system prompt byte-identical, so the cached prefix still hits', () => {
    expect(buildScoringPrompt({ problem: beginner, graph }).system).toBe(
      buildScoringPrompt({ problem, graph }).system,
    );
  });

  it('says nothing about beginners on an ordinary sheet', () => {
    expect(buildScoringPrompt({ problem, graph }).user).not.toContain('BEGINNER SHEET');
  });

  it('gives the coach the sheet’s lesson, hints and words', () => {
    const { user } = buildCritiquePrompt(beginner, graph, 'Where do I start?');
    expect(user).toContain('What this sheet teaches: Photos belong in object storage');
    expect(user).toContain('Where do the photo files live?');
    expect(user).toContain('object storage — a cheap place to keep files');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm --workspace server run test -- src/scoring/prompt.test.ts`
Expected: FAIL. No `BEGINNER SHEET` and no lesson text.

- [ ] **Step 3: Implement**

In `renderProblem`, replace the first two lines of the returned template, `PROBLEM (level ${p.level}/6, domain: ${p.domain})` and `Title: ${p.title}`, with:

```ts
  return `PROBLEM (level ${p.level}/6${p.track ? ` — beginner sheet, ${p.track.stage}` : ''}, domain: ${p.domain})
Title: ${p.title}
${renderLesson(p)}
```

Then add above `renderProblem`:

```ts
/** A beginner sheet's lesson, hints and words, so the grader and coach teach the same thing. */
function renderLesson(p: Problem): string {
  if (!p.track) return '';
  const lines = [`What this sheet teaches: ${p.learn ?? ''}`];
  if (p.hints?.length) lines.push(`Hints the learner can reveal, in order:\n${p.hints.map((h, i) => `  ${i + 1}. ${h.text}`).join('\n')}`);
  if (p.glossary?.length) lines.push(`Words defined on the sheet:\n${p.glossary.map((g) => `  - ${g.term} — ${g.meaning}`).join('\n')}`);
  return `${lines.join('\n')}\n`;
}

/** Goes in the user message: the system prefix must not change per sheet kind. */
function renderBeginnerRules(p: Problem): string {
  if (!p.track) return '';
  return `
BEGINNER SHEET — grade it as one
This sheet teaches exactly one idea: "${p.learn ?? ''}"
- Judge the design against that idea and the stated numbers. A design that gets the idea right scores
  at least 7/10 on the dimensions it touches and at least 65 overall, even if it ignores advanced concerns.
- Do not list advanced absences (observability, multi-region, auth hardening, idempotency, rate limiting
  — unless this sheet teaches it) under critical_failures or missing. At most one may appear in at_10x.
- Write every note, failure and question in plain words, and define a technical term the first time you
  use it. socratic_questions should be easy questions about this sheet's one idea.
`;
}
```

In `buildScoringPrompt`, change the start of `const user = \`${renderProblem(problem)}` to:

```ts
  const user = `${renderProblem(problem)}
${renderBeginnerRules(problem)}${twistBlock}
```

Here the existing `${twistBlock}` line moves into this template; it is not duplicated.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm --workspace server run test -- src/scoring`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/prompt.ts server/src/scoring/prompt.test.ts
git commit -m "Grade a beginner sheet on the one idea it teaches"
```

---

### Task 4: The twelve sheets and the ladder test (server)

**Files:**
- Create: `server/src/problems/starter.ts` (exports `STARTER_SHEETS: Problem[]`)
- Modify: `server/src/problems/bank.ts:2211` (`PROBLEM_BANK = [...STARTER_SHEETS, ...DESIGN_PROBLEMS, ...LABS]`, import `STARTER_SHEETS`)
- Modify: `server/src/problems/bank.test.ts` (counts; next-link check)
- Create: `server/src/problems/ladder.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `matchPath`, `plansFor`.
  - From shared: `evaluateAllScenarios`, `graphFromDoc`, `docFromBlueprint`.
  - From Task 2: the audit.
- Produces: 12 sheets in `PROBLEM_BANK`, starter sheets first.

**Engine facts that decide the numbers.** These are from `shared/src/components.ts` `DEFAULT_CAPACITY` (rps per replica):

| Component | Capacity (rps per replica) |
|---|---|
| `service` | 500 |
| `worker` | 300 |
| `sql_db` | 3,000 |
| `read_replica` | 3,000 |
| `blob_store` | 5,000 |
| `cdn` | 200,000 |
| `cache` | 80,000 (hit rate 0.8) |
| `prompt_cache` | 50,000 |
| `queue` | 20,000 |
| `dead_letter_queue` | 20,000 |
| `load_balancer` | 50,000 |
| `llm` | 20 |
| `email_provider` | 500 |
| `third_party` | 200 |

Other rules:
- A scenario with no `pass` is gated on "no broken flow, ≤ 1% dropped".
- At `rpsMultiplier ≤ 1`, a numeric `p99Ms` in `nonFunctional` also applies. **Do not put a numeric `p99Ms` on these sheets.**
- `killNodes` match by label substring or type substring; `degrade` matches exact label or id.
- Routers split traffic evenly across outbound edges unless the edges declare `carries`. **The engine routes per box, not per flow.**

**Sheet content.** The rules for each sheet:

- **Prose:** the prompt, functional requirements, hints, glossary and `rubricHints` follow the spec's writing rules (Global Constraints).
- **Reference and naive designs:** the reference design is the intended answer. The naive design is the Basics answer, used as the Step-up's "does it need the step up?" check.
- **Two flows from the same client:** both designs are drawn so that each flow's path is found, because two flows from the same client share that client's traffic.
- **Step-up diagram:** each Step-up sheet ships a `diagram` captioned "Where the Basics sheet left you" containing the naive design. The learner can place it and build on it.

| id | learn | expected flows → plan (kind, rps, mustReach) | reference design (edges) | naive design | scenarios |
|---|---|---|---|---|---|
| `l1-start-photo-upload-basics` | Photos belong in object storage, not on the app server's disk or in a database. | `upload a photo` (write, 20, [[blob_store]]); `view a photo` (read, 100, [[blob_store]]) | User(client)→App server(service)→Photo storage(blob_store) | — | `busy-evening` ×2 |
| `l1-start-photo-upload-step-up` | Serve popular files from a CDN, and do slow work like resizing in the background. | `upload a photo` (write, 40, [[service,monolith,serverless_fn],[blob_store]]); `view a photo` (read, 1500, [[cdn],[blob_store]]); `make a thumbnail` (async, 40, [[queue],[worker]]) | User→CDN→Photo storage; User→App server→Photo storage; App server→Resize queue(queue, async)→Resizer(worker)→Photo storage | basics design | `viral-photo` ×2; `resizers-down` ×1 kill `worker`, pass `{ maxDroppedPct: 5 }` |
| `l1-start-ai-chat-basics` | A chat app is an app server calling an LLM, and the LLM is the slow, expensive part. | `send a chat message` (write, 8, [[llm]]) | User→App server→LLM(llm); App server→Chat history(sql_db) | — | `lunch-rush` ×2 |
| `l1-start-ai-chat-step-up` | When the same questions repeat, cache the answers so the LLM is only asked once. | `send a chat message` (write, 50, [[prompt_cache, cache],[llm]]) | User→Rate limiter(rate_limiter)→App server→Answer cache(prompt_cache)→LLM | basics design | `launch-day` ×1 (50/s, so the LLM at 20/s must be shielded); `twice-as-busy` ×1.5 |
| `l1-start-product-page-basics` | A product page is read from a database through an app server, and reads far outnumber writes. | `view a product` (read, 200, [[sql_db]]); `change a price` (write, 5, [[sql_db]]) | User→App server→Products DB(sql_db) | — | `sale-day` ×2 |
| `l1-start-product-page-step-up` | Put a cache in front of the database for reads, and refresh it when a price changes. | `view a product` (read, 2400, [[cache],[sql_db]]); `change a price` (write, 10, [[sql_db]]) | User→Load balancer→App server (`replicas: 6`)→Product cache(cache)→Products DB | basics design with App server `replicas: 6` | `big-sale` ×1.5 (3,600 reads/s: over the DB's 3,000 without the cache) |
| `l1-start-stay-up-basics` | Run two of everything that matters: two app servers behind a load balancer. | `view the shop` (read, 300, [[sql_db]]) | User→Load balancer→App server A, App server B→Shop DB | User→App server→Shop DB | `rush-hour` ×2 (600 rps: over one server's 500) |
| `l1-start-stay-up-step-up` | Keep a copy of the database ready to take over when the main one fails. | `view the shop` (read, 300, [[sql_db, read_replica]]) | basics reference + Shop DB ==replication==> Shop DB replica(read_replica), LB routes reads through both servers to DB and replica | basics reference | `database-lost` ×1 kill `sql_db`, pass `{ maxDroppedPct: 50 }` (reads survive on the replica) |
| `l1-start-background-work-basics` | Do slow side jobs, like sending email, in the background with a queue and a worker. | `sign up` (write, 30, [[sql_db]]); `send the welcome email` (async, 30, [[queue],[worker]]) | User→App server→Users DB; App server→Email queue(queue, async)→Email worker(worker)→Email service(email_provider) | — | `slow-email` ×1, `thirdPartyLatencyMs: 3000`, pass `{ maxP99Ms: 400 }` |
| `l1-start-background-work-step-up` | Retry failed jobs, and park the ones that keep failing where someone can look at them. | `sign up` (write, 60, [[sql_db]]); `send the welcome email` (async, 60, [[queue],[worker]]) | basics reference + Email worker→Failed jobs(dead_letter_queue, async) | basics reference | `launch-signups` ×4 (240/s: the worker's 300 holds); `email-down` ×1 kill `email`, pass `{ maxP99Ms: 400, maxDroppedPct: 60 }` (signup unaffected) |
| `l1-start-short-links-basics` | A short link is a tiny lookup: save a code once, read it on every click. | `make a short link` (write, 10, [[sql_db]]); `open a short link` (read, 300, [[sql_db]]) | User→Link server(service)→Links DB(sql_db) | — | `shared-on-social` ×2 |
| `l1-start-short-links-step-up` | Serve hot links from a cache, and count clicks in the background so redirects stay fast. | `open a short link` (read, 2000, [[cache]]); `count a click` (async, 2000, [[queue],[worker]]) | User→Load balancer→Link server (`replicas: 6`)→Link cache(cache)→Links DB; Link server→Click queue(queue, async)→Click counter(worker, `replicas: 8`)→Links DB | basics design with Link server `replicas: 6` | `goes-viral` ×1.5 |

**Settled during execution:** `ladder.test.ts` and the rulings in the ledger are the record. These rows changed from the table above:

| Sheet | What changed |
|---|---|
| Photo Step up | User → CDN → App server (CDN `cacheHitRate: 0.9`, because a CDN absorbs nothing in this engine until its hit rate is set; a hint tells the learner). One scenario, `viral-photo` ×1.2. |
| AI basics | 6 questions a second. |
| Product Step up | App server `replicas: 10`. |
| Stay-up Step up | Both servers also wired to the replica. `database-lost` kills `sql_db` under the default gate. |
| Background-work Step up | 200 sign-ups a second, 2 workers, and `email-down` kills `email_provider`. Its Basics answer is allowed to pass (`NAIVE_PASSES`), because queue backlog is not gated. |
| Short-links Basics | 150 opens a second. |
| Short-links Step up | Load balancer, link server `replicas: 10` and a cache. Click counting was dropped. |

`track.next` values:
- Each Basics sheet points to its Step up.
- Each Step up points to the existing problem:
  - photo-upload: `l1-image-upload-service`
  - ai-chat: `l6-llm-gateway-cost-latency`
  - product-page: `l1-read-heavy-product-api`
  - stay-up: `l2-autoscaled-campaign-tier`
  - background-work: `l1-signup-email-verification`
  - short-links: `l2-url-shortener-50k-rps`

Concepts per sheet (2–4, all from `CONCEPT_CARDS`):

| Topic | Basics | Step up |
|---|---|---|
| photo | `blob-storage`, `capacity-estimation` | `cdn`, `queue-backpressure`, `blob-storage` |
| ai-chat | `llm-cost-control`, `capacity-estimation` | `caching`, `llm-cost-control`, `rate-limiting` |
| product | `schema-design`, `capacity-estimation` | `caching`, `load-balancing` |
| stay-up | `load-balancing`, `spof` | `replication`, `spof` |
| background | `queue-backpressure`, `timeout-retry` | `timeout-retry`, `queue-backpressure`, `degradation` |
| short-links | `schema-design`, `capacity-estimation` | `caching`, `queue-backpressure`, `load-balancing` |

- [ ] **Step 1: Write the ladder test first**

Create `server/src/problems/ladder.test.ts`:

```ts
// The "Start here" ladder, checked against the real engine.
//
// Two things make a beginner sheet worth having: the design it teaches actually
// passes its gates, and — for a Step up — the Basics answer does NOT, or the step
// teaches nothing. Each sheet's reference answer lives here, not in the bank: it
// is the answer key, and it must never reach the client.

import { describe, expect, it } from 'vitest';
import {
  docFromBlueprint,
  evaluateAllScenarios,
  graphFromDoc,
  matchPath,
  plansFor,
  type BlueprintLike,
  type GraphDSL,
  type Problem,
} from '@loadbearing/shared';
import { PROBLEM_BY_ID } from './bank.js';
import { STARTER_SHEETS } from './starter.js';

type Box = [key: string, type: BlueprintLike['nodes'][number]['type'], label: string, attrs?: Record<string, number>];
type Wire = [from: string, to: string, kind?: 'sync' | 'async' | 'replication'];

/** A design as boxes and wires; laid out on a plain grid, since only the topology matters here. */
function design(boxes: Box[], wires: Wire[]): BlueprintLike {
  return {
    name: 'answer',
    nodes: boxes.map(([key, type, label, attrs], i) => ({
      key,
      type,
      label,
      annotation: label,
      at: { x: (i % 4) * 220, y: Math.floor(i / 4) * 130 },
      ...(attrs ? { attrs } : {}),
    })),
    edges: wires.map(([from, to, kind]) => ({ from, to, kind: kind ?? 'sync' })),
    flows: [],
  };
}

/** Place a design, then declare every request the way the Flows tab would: by matching its path. */
function placeWithFlows(problem: Problem, d: BlueprintLike): { graph: GraphDSL; unmatched: string[] } {
  const graph = graphFromDoc(docFromBlueprint(d));
  graph.flows = [];
  const unmatched: string[] = [];
  for (const plan of plansFor(problem)) {
    const m = matchPath(plan, graph);
    const steps = m.status === 'found' ? m.path : m.status === 'choose' ? m.paths[0]! : null;
    if (!steps) {
      unmatched.push(plan.name);
      continue;
    }
    graph.flows.push({ id: `f-${plan.name}`, name: plan.name, kind: plan.kind, rps: plan.rps, steps, description: plan.plain });
  }
  return { graph, unmatched };
}

const ANSWERS: Record<string, { reference: BlueprintLike; naive?: BlueprintLike }> = {
  // Filled in Step 3, one entry per sheet in STARTER_SHEETS, from the plan's table.
};

describe('the Start here ladder', () => {
  it('has twelve sheets, two per topic', () => {
    expect(STARTER_SHEETS).toHaveLength(12);
    const topics = new Map<string, string[]>();
    for (const s of STARTER_SHEETS) topics.set(s.track!.topic, [...(topics.get(s.track!.topic) ?? []), s.track!.stage]);
    expect([...topics.values()].every((stages) => stages.sort().join() === 'basics,step-up')).toBe(true);
  });

  it('points every sheet at a sheet that exists', () => {
    for (const s of STARTER_SHEETS) expect(PROBLEM_BY_ID[s.track!.next ?? ''], `${s.id} → ${s.track!.next}`).toBeDefined();
  });

  for (const sheet of STARTER_SHEETS) {
    describe(sheet.id, () => {
      const answer = ANSWERS[sheet.id];

      it('has an answer key', () => {
        expect(answer, `add ${sheet.id} to ANSWERS`).toBeDefined();
      });

      it('finds a path for every request in the intended design', () => {
        expect(placeWithFlows(sheet, answer!.reference).unmatched).toEqual([]);
      });

      it('the intended design passes every gate', () => {
        const verdicts = evaluateAllScenarios(placeWithFlows(sheet, answer!.reference).graph, sheet);
        for (const v of verdicts) expect(v.pass, `${v.name}: ${v.reasons.join(' ')}`).toBe(true);
      });

      if (sheet.track!.stage === 'step-up') {
        it('the basics design does not pass the step up', () => {
          const verdicts = evaluateAllScenarios(placeWithFlows(sheet, answer!.naive!).graph, sheet);
          expect(verdicts.some((v) => !v.pass)).toBe(true);
        });
      }
    });
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm --workspace server run test -- src/problems/ladder.test.ts`
Expected: FAIL. `./starter.js` cannot be resolved.

- [ ] **Step 3: Fill in `ANSWERS` from the table**

Add one entry per row of the table above. For example, the first two:

```ts
  'l1-start-photo-upload-basics': {
    reference: design(
      [['u', 'client', 'User'], ['app', 'service', 'App server'], ['store', 'blob_store', 'Photo storage']],
      [['u', 'app'], ['app', 'store']],
    ),
  },
  'l1-start-photo-upload-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['cdn', 'cdn', 'CDN'], ['app', 'service', 'App server'],
        ['store', 'blob_store', 'Photo storage'], ['q', 'queue', 'Resize queue'], ['w', 'worker', 'Resizer'],
      ],
      [['u', 'cdn'], ['cdn', 'store'], ['u', 'app'], ['app', 'store'], ['app', 'q', 'async'], ['q', 'w'], ['w', 'store']],
    ),
    naive: design(
      [['u', 'client', 'User'], ['app', 'service', 'App server'], ['store', 'blob_store', 'Photo storage']],
      [['u', 'app'], ['app', 'store']],
    ),
  },
```

Write the remaining ten the same way, from each row's "reference design" and "naive design" columns.

- [ ] **Step 4: Write `starter.ts`**

Create `server/src/problems/starter.ts`, exporting `STARTER_SHEETS: Problem[]` with the 12 sheets in topic order (Basics then Step up). The first sheet, written out in full, is the template for the other eleven:

```ts
// "Start here": the beginner ladder. One idea per sheet, a handful of boxes, small
// round numbers, and nothing a newcomer has to look up — every technical word on
// the sheet is in its glossary. Each topic is a Basics sheet and a Step up that
// adds one pressure the Basics answer cannot take, then hands on to the full
// problem on the same topic. ladder.test.ts holds the answer key and proves both.

import type { Problem } from '@loadbearing/shared';
import { COL, diagram, ROW } from './diagrams.js';

export const STARTER_SHEETS: Problem[] = [
  {
    id: 'l1-start-photo-upload-basics',
    title: 'Photo Upload: Basics',
    level: 1,
    domain: 'social',
    track: { topic: 'photo-upload', stage: 'basics', next: 'l1-start-photo-upload-step-up' },
    learn: "Photos belong in object storage, not on the app server's disk or in a database.",
    prompt:
      "You are building a small photo-sharing app. People pick a photo on their phone and upload it, and later they and their friends look at it. At the busiest time of day about 20 photos are uploaded and 100 are viewed every second, and each photo is about 3MB. The first idea was to save photos on the app server's own disk, but that disk fills up and is wiped if the server is replaced. Design where the photos go, and how they get there and back.",
    functional: [
      'Upload a photo and get back an id for it',
      'Show a photo by its id',
      'Keep every photo safe even if an app server is replaced',
    ],
    nonFunctional: { uploadRps: 20, viewRps: 100, photoSize: '3MB each' },
    constraints: ['One developer, so keep it to a handful of boxes'],
    concepts: ['blob-storage', 'capacity-estimation'],
    expectedFlows: ['upload a photo', 'view a photo'],
    flowPlans: [
      { name: 'upload a photo', kind: 'write', rps: 20, plain: 'A user picks a photo and sends it to your app, which stores it.', mustReach: [['blob_store']] },
      { name: 'view a photo', kind: 'read', rps: 100, plain: 'Someone opens the app and a stored photo is fetched and shown.', mustReach: [['blob_store']] },
    ],
    hints: [
      {
        text: "Where should the photo files live? Not on the app server's disk — it can be wiped. Look for a storage box made for files.",
        ghost: { type: 'blob_store', label: 'Photo storage', annotation: 'object storage, one file per photo id' },
      },
      {
        text: 'Who receives the upload from the phone? Draw the user, then the app server they talk to, with an arrow from the user to it.',
        ghost: { type: 'service', label: 'App server', annotation: 'receives uploads and saves them to photo storage' },
      },
      { text: 'Connect the app server to the photo storage with an arrow, so it can save and fetch photos.' },
      { text: 'Open the Flows tab: both requests should now show a path. Press "Use this" on each, then run load.' },
    ],
    glossary: [
      { term: 'object storage', meaning: 'a service built to keep files cheaply and safely, like a giant hard drive you reach over the internet (for example Amazon S3).' },
      { term: 'app server', meaning: 'the program that runs your code and answers requests from the app.' },
      { term: 'requests per second (rps)', meaning: 'how many times per second someone asks your system to do something.' },
    ],
    rubricHints:
      'This sheet teaches one idea: photo files go to object storage (blob store), not the app server disk and not a database column. Reward a design with a client, an app server and a blob store wired together. Treat photos stored in a SQL database or on local disk as the one real mistake, and explain why in plain words.',
    twists: ['A photo goes viral and is viewed 1,500 times a second — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'busy-evening',
        name: 'Busy evening',
        description: 'Everyone uploads and scrolls after dinner: twice the usual traffic.',
        rpsMultiplier: 2,
        passCriteria: 'Uploads and views keep working with almost nothing dropped.',
      },
    ],
  },
  // …the other eleven sheets, written the same way from the plan's table.
];
```

Every Step-up sheet also carries the Basics answer as its `diagram`. For example:

```ts
    diagram: diagram('Where the Basics sheet left you', {
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'phone app', at: { x: 0, y: 0 } },
        { key: 'app', type: 'service', label: 'App server', annotation: 'receives uploads, serves photos', at: { x: COL, y: 0 } },
        { key: 'store', type: 'blob_store', label: 'Photo storage', annotation: 'one file per photo id', at: { x: COL * 2, y: 0 } },
      ],
      edges: [{ from: 'u', to: 'app', kind: 'sync' }, { from: 'app', to: 'store', kind: 'sync' }],
      flows: [],
    }),
```

(`ROW` is imported for the step-up diagrams that need a second row.)

- [ ] **Step 5: Wire the sheets into the bank**

In `server/src/problems/bank.ts`, add `import { STARTER_SHEETS } from './starter.js';` and change the export to `export const PROBLEM_BANK: Problem[] = [...STARTER_SHEETS, ...DESIGN_PROBLEMS, ...LABS];`. Keep the existing annotation if there is one.

In `server/src/problems/bank.test.ts`, change the first test to expect 56 sheets and `{ 1: 19, 2: 6, 3: 7, 4: 9, 5: 8, 6: 7 }`. Rename it to `'has 56 sheets with unique ids and the intended level spread'`.

- [ ] **Step 6: Run the ladder and bank tests, and tune until green**

Run: `npm --workspace server run test -- src/problems`
Expected: PASS.

When a gate disagrees, read the verdict's `reasons`, then decide which side is wrong:

| Symptom | Fix |
|---|---|
| **The reference design fails.** | The numbers are wrong, not the design. Lower the scenario's `rpsMultiplier` or the plan's `rps` until the intended design passes with headroom. Never delete the scenario or add `maxDroppedPct: 100`. |
| **The naive design passes a Step up.** | Raise the pressure (rps or multiplier) until the Basics answer fails and the reference still passes. If no number does that, the engine cannot express the lesson; tell the user rather than ship a vacuous gate. |
| **A path is unmatched.** | Fix the `mustReach` groups or the reference wiring. |

Update the table in this plan with the numbers you settle on.

- [ ] **Step 7: Run the whole server suite**

Run: `npm --workspace server run test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/problems/starter.ts server/src/problems/bank.ts server/src/problems/bank.test.ts server/src/problems/ladder.test.ts docs/superpowers/plans/2026-10-10-beginner-ladder-and-easy-flows.md
git commit -m "Add a Start here ladder: twelve sheets, each proven against the engine"
```

---

### Task 5: "Start here" on the Problems page (client)

**Files:**
- Create: `client/src/panels/startHere.ts`
- Test: `client/src/panels/startHere.test.ts`
- Modify: `client/src/panels/ProblemBrowser.tsx` (grouping ~line 94; render before the tiers ~line 271)
- Modify: `client/src/styles/pages.css` (append ladder styles)

**Interfaces:**
- Consumes: `ProblemSummary.track` (Task 1, populated by Task 2).
- Produces:
  - `startHereRows(problems: ProblemSummary[]): StartRow[]`
  - `interface StartRow { topic: string; title: string; basics?: ProblemSummary; stepUp?: ProblemSummary; next?: ProblemSummary }`
  - `TOPIC_ORDER: string[]`

- [ ] **Step 1: Write the failing test**

Create `client/src/panels/startHere.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ProblemSummary } from '@loadbearing/shared';
import { startHereRows } from './startHere';

const sheet = (id: string, track?: ProblemSummary['track']): ProblemSummary => ({
  id,
  title: id,
  level: 1,
  domain: 'x',
  concepts: [],
  ...(track ? { track } : {}),
});

describe('startHereRows', () => {
  const problems = [
    sheet('l1-image-upload-service'),
    sheet('l1-start-ai-chat-basics', { topic: 'ai-chat', stage: 'basics', next: 'l1-start-ai-chat-step-up' }),
    sheet('l1-start-photo-upload-step-up', { topic: 'photo-upload', stage: 'step-up', next: 'l1-image-upload-service' }),
    sheet('l1-start-photo-upload-basics', { topic: 'photo-upload', stage: 'basics', next: 'l1-start-photo-upload-step-up' }),
  ];

  it('makes one row per topic, in the ladder order, with both stages and where it leads', () => {
    const rows = startHereRows(problems);
    expect(rows.map((r) => r.topic)).toEqual(['photo-upload', 'ai-chat']);
    expect(rows[0]).toMatchObject({
      title: 'Photo upload',
      basics: { id: 'l1-start-photo-upload-basics' },
      stepUp: { id: 'l1-start-photo-upload-step-up' },
      next: { id: 'l1-image-upload-service' },
    });
    expect(rows[1]!.stepUp).toBeUndefined();
  });

  it('is empty when no sheet is on the ladder', () => {
    expect(startHereRows([sheet('a'), sheet('b')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm --workspace client run test -- startHere`
Expected: FAIL. The module cannot be resolved.

- [ ] **Step 3: Implement**

Create `client/src/panels/startHere.ts`:

```ts
import type { ProblemSummary } from '@loadbearing/shared';

/** The ladder, easiest topic first. A topic not listed sorts after these, by name. */
export const TOPIC_ORDER = ['photo-upload', 'ai-chat', 'product-page', 'stay-up', 'background-work', 'short-links'];

const TOPIC_TITLE: Record<string, string> = {
  'photo-upload': 'Photo upload',
  'ai-chat': 'AI chat',
  'product-page': 'Product page',
  'stay-up': "Don't fall over",
  'background-work': "Don't make users wait",
  'short-links': 'Short links',
};

export interface StartRow {
  topic: string;
  title: string;
  basics?: ProblemSummary;
  stepUp?: ProblemSummary;
  /** The full problem the Step up hands on to. */
  next?: ProblemSummary;
}

export function startHereRows(problems: ProblemSummary[]): StartRow[] {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const rows = new Map<string, StartRow>();
  for (const p of problems) {
    if (!p.track) continue;
    const row = rows.get(p.track.topic) ?? { topic: p.track.topic, title: TOPIC_TITLE[p.track.topic] ?? p.track.topic };
    if (p.track.stage === 'basics') row.basics = p;
    else {
      row.stepUp = p;
      if (p.track.next) row.next = byId.get(p.track.next);
    }
    rows.set(p.track.topic, row);
  }
  const rank = (t: string) => (TOPIC_ORDER.includes(t) ? TOPIC_ORDER.indexOf(t) : TOPIC_ORDER.length);
  return [...rows.values()].sort((a, b) => rank(a.topic) - rank(b.topic) || a.topic.localeCompare(b.topic));
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm --workspace client run test -- startHere`
Expected: PASS

- [ ] **Step 5: Render it in the Problems page**

In `client/src/panels/ProblemBrowser.tsx`:

1. Add `import { startHereRows } from './startHere';`.
2. Change the `byLevel` line so ladder sheets are not repeated in the tiers:
   ```ts
   const byLevel = [1, 2, 3, 4, 5, 6].map((l) => ({ l, items: shown.filter((p) => p.level === l && !p.track) }));
   const ladder = level === 'all' || level === 1 ? (kind === 'lab' ? [] : startHereRows(problems)) : [];
   ```
3. Directly after the "Where you left off" block and before `{byLevel.map(`, insert:
   ```tsx
      {ladder.length > 0 && (
        <div className="tier start-here">
          <div className="tier-head">
            <span className="lvl l1">★</span>
            <h3>Start here</h3>
            <span className="count">one idea per sheet — Basics, then Step up</span>
          </div>
          <div className="ladder">
            {ladder.map((row) => (
              <div className="ladder-row" key={row.topic}>
                <div className="ladder-topic">{row.title}</div>
                {[row.basics, row.stepUp].map((p, i) =>
                  p ? (
                    <button key={p.id} className="plate ladder-step" onClick={() => void open(p.id)} disabled={busy === p.id}>
                      <span className="stencil">{i === 0 ? 'Basics' : 'Step up'}</span>
                      <span className="t">{p.title.replace(/:\s*(Basics|Step Up)$/i, '')}</span>
                      {done[p.id] !== undefined && <span className={`best ${done[p.id]! >= 80 ? 'hi' : done[p.id]! >= 60 ? 'mid' : 'lo'}`}>{done[p.id]}</span>}
                    </button>
                  ) : (
                    <span key={i} />
                  ),
                )}
                {row.next ? (
                  <button className="link-btn ladder-next" onClick={() => void open(row.next!.id)}>
                    then → {row.next.title}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
   ```
4. Change the lede paragraph's first sentence to: `New to this? Start at the top: each Start here sheet teaches one idea with a few boxes.` Keep the rest.

Append to `client/src/styles/pages.css`:

```css
/* ----------------------------------------------------------- start here ---- */
/* The beginner ladder: a topic, its two sheets, and where it leads. */
.ladder { display: flex; flex-direction: column; gap: 8px; }
.ladder-row {
  display: grid;
  grid-template-columns: 150px 1fr 1fr auto;
  gap: 8px;
  align-items: stretch;
}
.ladder-topic { align-self: center; font-weight: 600; }
.ladder-step { display: flex; flex-direction: column; gap: 3px; text-align: left; position: relative; }
.ladder-next { align-self: center; white-space: nowrap; }
@media (max-width: 720px) {
  .ladder-row { grid-template-columns: 1fr 1fr; }
  .ladder-topic, .ladder-next { grid-column: 1 / -1; }
}
```

- [ ] **Step 6: Typecheck and run the client tests**

Run: `npm run typecheck` and then `npm --workspace client run test`
Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add client/src/panels/startHere.ts client/src/panels/startHere.test.ts client/src/panels/ProblemBrowser.tsx client/src/styles/pages.css
git commit -m "Put a Start here ladder above Level 1"
```

---

### Task 6: The beginner Brief (client)

**Files:**
- Modify: `client/src/state/appStore.ts` (state and actions for revealed hints)
- Modify: `client/src/panels/BriefPanel.tsx`
- Modify: `client/src/styles/pages.css` (append brief styles)

**Interfaces:**
- Consumes:
  - From Task 1: `Problem.track`, `learn`, `hints`, `glossary`.
  - From the canvas store: `addGhosts(SuggestedAddition[])`.
  - From the app store: `setLeftTab('flows')`.
- Produces: `useApp` gains `hintsShown: Record<string, number>` and `showHint: (problemId: string) => void`.

- [ ] **Step 1: Add the hint state**

In `client/src/state/appStore.ts`:
- In `interface AppState`, add:
  ```ts
  /** How many hints are revealed, per sheet — so leaving the Brief does not hide them again. */
  hintsShown: Record<string, number>;
  showHint: (problemId: string) => void;
  ```
- In the initial state, next to `chatFor: null,`, add `hintsShown: {},`.
- With the other actions, add:
  ```ts
  showHint: (problemId) =>
    set((s) => ({ hintsShown: { ...s.hintsShown, [problemId]: (s.hintsShown[problemId] ?? 0) + 1 } })),
  ```
- If there is a sign-out reset that clears `chatFor: null` (~line 232), add `hintsShown: {},` there as well.

- [ ] **Step 2: Render the beginner sections**

In `client/src/panels/BriefPanel.tsx`:

1. Add the hooks next to the existing ones:
   ```ts
   const hintsShown = useApp((s) => (s.problem ? s.hintsShown[s.problem.id] ?? 0 : 0));
   const showHint = useApp((s) => s.showHint);
   const setLeftTab = useApp((s) => s.setLeftTab);
   const openProblemById = useApp((s) => s.openProblem);
   const addGhosts = useCanvas((s) => s.addGhosts);
   const [openTerm, setOpenTerm] = useState<string | null>(null);
   ```
2. After `if (!problem) return null;`, add `const beginner = Boolean(problem.track);`.
3. Directly after the `brief-title` `<h3>` (and after the twist banner), insert:
   ```tsx
      {beginner && problem.learn && (
        <p className="brief-learn">
          <span className="stencil">what you'll learn</span>
          {problem.learn}
        </p>
      )}

      {beginner && (
        <>
          <section className="brief-story">
            <h4>The situation</h4>
            <p>{problem.prompt}</p>
          </section>

          {problem.glossary && problem.glossary.length > 0 && (
            <section className="brief-words">
              <h4>Words used here</h4>
              <div className="row wrap" style={{ gap: 4 }}>
                {problem.glossary.map((g) => (
                  <button
                    key={g.term}
                    className={`chip${openTerm === g.term ? ' on' : ''}`}
                    onClick={() => setOpenTerm(openTerm === g.term ? null : g.term)}
                    aria-expanded={openTerm === g.term}
                  >
                    {g.term}
                  </button>
                ))}
              </div>
              {openTerm && (
                <p className="brief-word-meaning">
                  <b>{openTerm}</b> — {problem.glossary.find((g) => g.term === openTerm)?.meaning}
                </p>
              )}
            </section>
          )}

          {problem.hints && problem.hints.length > 0 && (
            <section className="brief-hints">
              <h4>Hints</h4>
              <ol>
                {problem.hints.slice(0, hintsShown).map((h, i) => (
                  <li key={i}>
                    {h.text}
                    {h.ghost && (
                      <button
                        className="link-btn"
                        onClick={() =>
                          addGhosts([
                            {
                              type: h.ghost!.type,
                              label: h.ghost!.label,
                              annotation: h.ghost!.annotation ?? '',
                              kind: 'sync',
                              why: h.text,
                            },
                          ])
                        }
                      >
                        Show me
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {hintsShown < problem.hints.length ? (
                <button onClick={() => showHint(problem.id)}>
                  {hintsShown === 0 ? 'Give me a hint' : 'Next hint'} ({hintsShown}/{problem.hints.length})
                </button>
              ) : (
                <span className="faint" style={{ fontSize: 12 }}>That's every hint. Ask the coach if you are stuck.</span>
              )}
            </section>
          )}

          <section className="brief-list">
            <h4>Requests to handle</h4>
            <button onClick={() => setLeftTab('flows')}>Set them up in Flows →</button>
          </section>
        </>
      )}
   ```
4. Wrap the existing "The situation" section (with `splitStory`) in `{!beginner && ( … )}`, so a beginner sheet does not show the situation twice.
5. Wrap the existing "Flows to declare" section in `{!beginner && ( … )}` as well.
6. Directly before the final `</div>`, add:
   ```tsx
      {problem.track?.next && (
        <section className="brief-next">
          <button className="primary" onClick={() => void api.problem(problem.track!.next!).then(openProblemById)}>
            Next sheet →
          </button>
        </section>
      )}
   ```
   and add `import { api } from '../lib/api';` at the top. `AskPanel` imports it the same way.

Append to `client/src/styles/pages.css`:

```css
/* -------------------------------------------------------- beginner brief ---- */
.brief-learn { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 10px; font-size: var(--t-13); }
.brief-word-meaning { font-size: 12.5px; margin: 6px 0 0; }
.brief-hints ol { margin: 0 0 8px; padding-left: 18px; font-size: 12.5px; }
.brief-hints li { margin-bottom: 5px; }
.brief-hints .link-btn { margin-left: 6px; }
.brief-next { margin-top: 12px; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add client/src/state/appStore.ts client/src/panels/BriefPanel.tsx client/src/styles/pages.css
git commit -m "Give a beginner sheet its lesson, words and hints one at a time"
```

---

### Task 7: Request cards in the Flows tab (client)

**Files:**
- Modify: `client/src/panels/FlowPanel.tsx` (rewrite around the existing editor)

**Interfaces:**
- Consumes:
  - From Task 1: `plansFor`, `matchPath`, `isPathBroken`, `sameFlowName`, `FlowPlan`, `PathMatch`.
  - From the canvas store: `flows`, `nodes`, `edges`, `toGraph`, `addFlow`, `updateFlow`, `removeFlow`, `appendFlowStep`, `removeFlowStep`, `simResult`.
- Produces: no new exports.

- [ ] **Step 1: Restructure the panel**

Rewrite `client/src/panels/FlowPanel.tsx`:

- Move today's per-flow card body into a `FlowEditor` component. That body is everything inside `<div className="card" key={flow.id}>`: the name, kind, rps and guarantee inputs, the step chips, the "+ add next step…" select, and the result chips. Its props are `{ flow: Flow; archNodes; labelOf; result? }`, and it reads the store actions itself. Its markup and behaviour are unchanged.
- Keep `KIND_HINT` as it is.
- Build the new panel on top of it:

```tsx
export function FlowPanel() {
  const flows = useCanvas((s) => s.flows);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const toGraph = useCanvas((s) => s.toGraph);
  const addFlow = useCanvas((s) => s.addFlow);
  const updateFlow = useCanvas((s) => s.updateFlow);
  const sim = useCanvas((s) => s.simResult);
  const problem = useApp((s) => s.problem);

  const archNodes = nodes.filter(
    (n): n is Extract<typeof n, { type: 'arch' }> => n.type === 'arch' && !(n.data as ArchNodeData).ghost,
  );
  const labelOf = (id: string) => archNodes.find((n) => n.id === id)?.data.label ?? '?';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => toGraph(), [nodes, edges, toGraph]);
  const plans = useMemo(() => (problem ? plansFor(problem) : []), [problem]);

  /** Declare (or re-point) the flow for a plan. Values the learner already edited are kept. */
  const usePath = (plan: FlowPlan, steps: string[]) => {
    const existing = flows.find((f) => sameFlowName(f.name, plan.name));
    const id = existing?.id ?? addFlow();
    updateFlow(id, {
      name: plan.name,
      steps,
      ...(existing ? {} : { kind: plan.kind, rps: plan.rps, description: plan.plain }),
    });
  };

  const extra = flows.filter((f) => !plans.some((p) => sameFlowName(p.name, f.name)));

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Requests your system must handle</h4>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        A request path is the route one kind of request takes through your boxes. Draw arrows from the user
        onward and the path is found for you; the load test pushes traffic down these paths.
      </p>

      {plans.map((plan) => (
        <RequestCard
          key={plan.name}
          plan={plan}
          flow={flows.find((f) => sameFlowName(f.name, plan.name))}
          match={matchPath(plan, graph)}
          graph={graph}
          archNodes={archNodes}
          labelOf={labelOf}
          result={sim?.flows.find((r) => r.flowId === flows.find((f) => sameFlowName(f.name, plan.name))?.id)}
          onUse={(steps) => usePath(plan, steps)}
        />
      ))}

      {extra.length > 0 && <h4>Your other flows</h4>}
      {extra.map((flow) => (
        <FlowEditor key={flow.id} flow={flow} archNodes={archNodes} labelOf={labelOf} result={sim?.flows.find((r) => r.flowId === flow.id)} />
      ))}

      <button onClick={() => addFlow()} style={{ marginTop: 6 }}>
        + Add a flow by hand
      </button>
    </div>
  );
}

function RequestCard({
  plan, flow, match, graph, archNodes, labelOf, result, onUse,
}: {
  plan: FlowPlan;
  flow?: Flow;
  match: PathMatch;
  graph: GraphDSL;
  archNodes: ArchNode[];
  labelOf: (id: string) => string;
  result?: SimResult['flows'][number];
  onUse: (steps: string[]) => void;
}) {
  const [handOpen, setHandOpen] = useState(false);
  const route = (steps: string[]) => steps.map(labelOf).join(' → ');
  const declared = flow && flow.steps.length > 0;
  const broken = declared && isPathBroken(flow!.steps, graph);

  return (
    <div className="card request-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{plan.name}</strong>
        <span className="chip spec">
          {flow?.kind ?? plan.kind} · {flow?.rps ?? plan.rps}/s
        </span>
      </div>
      {plan.plain && <p className="faint" style={{ fontSize: 12, margin: '4px 0 6px' }}>{plan.plain}</p>}

      {declared && !broken && (
        <div className="request-path ok">
          <span className="mono">{route(flow!.steps)}</span>
          {result && (
            <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
              <span className={`chip ${result.broken ? 'bad' : 'good'}`}>{result.broken ? `breaks at ${result.brokenAt}` : 'completes'}</span>
              <span className="chip">{Math.round(result.completedRps)}/{Math.round(result.offeredRps)} rps</span>
              <span className="chip spec">p99 {Math.round(result.p99Ms)}ms</span>
            </div>
          )}
        </div>
      )}

      {(!declared || broken) && (
        <div className="request-path">
          {broken && <p className="warn-text">Your drawing changed — this path no longer exists.</p>}
          {match.status === 'found' && (
            <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
              <span className="mono">{route(match.path)}</span>
              <span className="faint">found in your drawing</span>
              <button className="primary" onClick={() => onUse(match.path)}>
                {broken ? 'Update path' : 'Use this'}
              </button>
            </div>
          )}
          {match.status === 'choose' && (
            <div className="col" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>Which route does this request take?</span>
              {match.paths.map((p) => (
                <button key={p.join('>')} style={{ textAlign: 'left' }} onClick={() => onUse(p)}>
                  <span className="mono">{route(p)}</span>
                </button>
              ))}
            </div>
          )}
          {match.status === 'none' && (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Not connected yet — draw an arrow from the user to the next box{plan.mustReach ? ', on to where this request has to end up' : ''}.
            </p>
          )}
        </div>
      )}

      {flow && (
        <details open={handOpen} onToggle={(e) => setHandOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="faint" style={{ fontSize: 12 }}>Edit by hand</summary>
          {handOpen && <FlowEditor flow={flow} archNodes={archNodes} labelOf={labelOf} result={result} />}
        </details>
      )}
    </div>
  );
}
```

Imports for the file:

```ts
import { useMemo, useState } from 'react';
import {
  isPathBroken,
  matchPath,
  plansFor,
  sameFlowName,
  type Flow,
  type FlowKind,
  type FlowPlan,
  type GraphDSL,
  type PathMatch,
  type SimResult,
} from '@loadbearing/shared';
import { FLOW_KINDS, useCanvas, type ArchNodeData } from '../state/canvasStore';
import { useApp } from '../state/appStore';
```

Define `type ArchNode = Extract<ReturnType<typeof useCanvas.getState>['nodes'][number], { type: 'arch' }>;` at the top of the file. If that `Extract` does not typecheck against the store's node union, use the node type the store exports for arch nodes; check `canvasStore.ts` for an exported `ArchNode` or `Node<ArchNodeData, 'arch'>`.

- Remove the old "Still undeclared" banner: its job is now done by the cards.
- The "Flows to declare" chips are gone from the beginner Brief (Task 6). On ordinary sheets they stay as they are.

Append to `client/src/styles/pages.css`:

```css
.request-card .request-path { margin: 4px 0 6px; font-size: 12.5px; }
.request-card .request-path.ok .mono { color: var(--good, inherit); }
.request-card .warn-text { margin: 0 0 4px; font-size: 12px; color: var(--warn, inherit); }
```

Use the token names the stylesheet actually defines; check `base.css` for the good and warn colours.

- [ ] **Step 2: Typecheck and run all tests**

Run: `npm run typecheck` and then `npm test`
Expected: PASS for both.

- [ ] **Step 3: Commit**

```bash
git add client/src/panels/FlowPanel.tsx client/src/styles/pages.css
git commit -m "Set up each request from the arrows already drawn"
```

---

### Task 8: Docs, and proof in the running app

**Files:**
- Modify: `docs/HOW-LOADBEARING-WORKS.md` (problem bank and flows sections)
- Modify: `README.md` (step 1 problem count; step 3 flows wording)

- [ ] **Step 1: Update the docs**

- `README.md`, step 1: replace "25 hand-written problems across six levels" with "A **Start here** ladder of 12 beginner sheets (one idea each, with hints and a glossary), then 44 hand-written problems across six levels".
- `README.md`, step 3: replace the first sentence with "**Declare your flows.** Each request the sheet asks for arrives filled in — name, kind, rate — and its path is read off the arrows you drew; you confirm it with one click, or edit it by hand."
- `HOW-LOADBEARING-WORKS.md`: add a short paragraph where the bank is described, naming `starter.ts`, the `track` field and `ladder.test.ts`. In the flows section, name `shared/src/flowPlans.ts` (`plansFor`, `matchPath`, `isPathBroken`).

- [ ] **Step 2: Verify in the running app**

Start the `scratch` launch config (`preview_start {name: "scratch"}`). Register a throwaway account through `/api/auth/register` and set the offline stub with `PUT /api/settings {provider:'fake', model:'fake'}`. Then:

1. On the Problems page, the **Start here** section shows six topic rows, and the L1 tier no longer lists the starter sheets.
2. Open *Photo Upload: Basics*. Check that the Brief shows the "What you'll learn" line, the glossary chips (click one and its meaning appears), and **Give me a hint** revealing hints one at a time. **Show me** places a ghost.
3. Draw User → App server → Photo storage. In Flows, both cards show the path with **Use this**. Press both. The gates in the Brief go green after running load.
4. Delete the arrow App server → Photo storage. Both cards show "Your drawing changed", with no path offered.
5. Open `l1-image-upload-service`. The Flows tab shows four derived cards, with path choices once something is drawn.
6. `read_console_messages` with `onlyErrors: true` returns nothing.
7. Take a screenshot of the Start here section and one of the Flows tab as proof. Stop the preview.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/HOW-LOADBEARING-WORKS.md
git commit -m "Describe the Start here ladder and flows read from the drawing"
```
