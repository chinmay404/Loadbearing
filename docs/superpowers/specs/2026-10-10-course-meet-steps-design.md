# Spec: "Meet the part" steps and course chapters 3–7

Date: 2026-10-10
Status: Approved in conversation; Phase A ready to plan

Read `docs/HOW-LOADBEARING-WORKS.md` section 11 (the course) and
`docs/design-handoff/11-content-inventory.md` ("The chapter ladder") first.

---

## 1. Why

The course has a Prologue, Chapter 1 and Chapter 2. Each chapter introduces a part
(a load balancer, say) by dropping the learner straight into a step that uses it.
The canvas only shows a part from the outside: a box, a gauge, dots going in and out.
A learner meeting a cache for the first time cannot see *what it does* — that it is
a short list of saved answers, that each answer has a timer, that a small one forgets,
that a copy can be out of date.

We add a short theory step at the start of every chapter that opens the new part up
and shows it working, then continue the ladder through chapters 3–7.

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where theory lives | A new step type, `meet`, first in each chapter | Keeps the one-step-at-a-time loop; progress, path and resume already work per step. |
| What it shows | An animated *inside view* of the part, in 4–5 short beats | The canvas already shows the outside. The inside is what is missing. |
| Where its numbers come from | The engine's own exported formulas | What the learner sees in theory must match what the simulator does to them two steps later ("every number has a reason"). |
| How it completes | One prediction question at the end | Something to get right, not a "Next" button to click through. No points. |
| Required or skippable | **Skippable**: answering correctly without watching counts as done | Matches the existing rule that a first-try pass counts as complete. |
| Scope | Phase A = mechanism + cache scene + all of chapter 3. Phases B–E = one chapter each | Proves the pattern on one chapter before repeating it four times. |

Rejected:
- **A text-only concept card.** Already exists as hint level 2; it does not show anything moving.
- **Running the theory on the real canvas with the request engine.** Most faithful,
  but the canvas cannot show a part's internals (the key list, the timers, the
  backlog line), and the request engine is still behind a flag.
- **Making theory required.** People who already know caching would be made to sit
  through it; the first-try rule says they shouldn't.

## 3. The `meet` step

### 3.1 Data (`shared/src/course/types.ts`)

`Step` becomes a union. The existing interface is renamed `PracticeStep`, unchanged.

```ts
export type Step = PracticeStep | MeetStep;

export interface MeetStep {
  id: string;
  chapter: string;
  type: 'meet';
  /** At most six words: "Meet the cache". */
  title: string;
  /** One sentence: why this part is about to matter. */
  story: string;
  /** Which client scene draws it. */
  scene: SceneId;
  /** In order. The scene reads `id` to know what to show. */
  beats: Beat[];
  /** The question that completes the step. */
  check: Check;
  /** One sentence, shown after the pass. */
  lesson: string;
}

export type SceneId = 'cache' | 'cdn' | 'queue' | 'replica' | 'watch';

export interface Beat {
  id: string;
  /** At most five words. */
  title: string;
  /** One sentence, plain words. */
  caption: string;
}

export interface Check {
  question: string;
  /** 2–4 choices, short. */
  options: string[];
  /** Index into options. */
  answer: number;
  /** One sentence shown on a correct answer. */
  because: string;
  /** Beat replayed on a wrong answer. */
  replay: string;
}
```

`StepType` gains `'meet'`. Everything that reads practice-only fields (`start`,
`gates`, `solution`, `dials`…) narrows on `step.type !== 'meet'` first:
`judgeStep`, `startGraph`, the honesty tests, `Lesson.tsx`, `LearnPath.tsx`.

`Chapter.steps` keeps its order; the `meet` step is first.

### 3.2 Judging

`shared/src/course/judge.ts` gains:

```ts
export function judgeMeet(step: MeetStep, answer: number): { passed: boolean; replay: string | null };
```

Pure: `passed` is `answer === step.check.answer`; on a wrong answer `replay` is the
beat to go back to.

`POST /api/course/steps/:stepId/pass` accepts `{ answer: number }` for a `meet` step
and `{ graph, hints }` for any other, as today. A `meet` step with a missing or wrong
answer returns 422 `not_passed`, the same shape as a failing design. Progress is
stored the same way (`hints: 0`).

### 3.3 Scene numbers

Each scene computes what it shows with functions exported from `shared`, called on
small synthetic nodes, never with hand-tuned animation constants. For the cache:

- Hit rate = `effectiveHitRate(node)` — the requested rate capped by
  `(memoryGb ÷ workingSetGb) ^ 0.5`, the engine's own coverage heuristic.
- Database share of reads = `1 − hit rate`.
- Average answer time = `hit × cacheLatency + (1 − hit) × (cacheLatency + dbLatency)`,
  using catalogue defaults from `components.ts`.

The dots in the animation are drawn at that hit rate (a seeded sequence, so the same
settings look the same every time). The visible key list is illustration — which
key gets evicted is not modelled by the engine and must not be presented as if it were.

A test asserts each scene's headline numbers equal the engine's for the same
settings.

### 3.4 The lesson screen for a `meet` step (`client/src/course/`)

- New `MeetLesson.tsx`, chosen by `Lesson.tsx` when `step.type === 'meet'`. Same
  header (back, kind chip, title, story) as a practice step. No canvas, no parts tray,
  no budget, no run button.
- The scene sits where the canvas would be. Beats are a numbered row above it; one
  caption under the row. "Next" moves on; any beat can be clicked.
- Each beat may expose at most one control (a slider, or one action button such as
  "Change a price" or "Kill the cache").
- The check is available from the first beat ("Know this already? Answer the
  question"). Correct → `because` line, pass is posted, the next step slides up.
  Wrong → "Not quite" and the scene jumps to `replay`.
- `prefers-reduced-motion`: no travelling dots; the scene shows the same counts as
  static numbers and a still diagram per beat.
- New files: `client/src/course/scenes/index.ts` (SceneId → component) and one file
  per scene, `CacheScene.tsx` first. Scenes are SVG plus `requestAnimationFrame`, in
  the canvas's existing palette tokens; light and dark both checked.
- The concept card in the hints of the chapter's practice steps gets a "See it again"
  link that opens the `meet` step.
- `LearnPath.tsx` shows `meet` steps with their own kind label ("Meet") and an
  open-book mark instead of the step number.

### 3.5 The cache scene, beat by beat

Shop app → Cache → Database, dots for requests. Green = hit, amber = miss,
red = stale answer.

| Beat | Title | Caption (draft) | Control |
| --- | --- | --- | --- |
| `ask` | Same question, asked again | Every product page asks the database for the same thing, and it looks it up on disk each time. | — (cache off) |
| `keep` | Keep the answer close | A cache is a small list of answers kept in memory beside the app. Ask it first: a hit is fast, a miss goes on to the database and the answer is saved on the way back. | — |
| `size` | Too small forgets | A cache only holds what fits in its memory. Drag its size and watch how much still reaches the database. | Memory slider |
| `stale` | Old answers go stale | A cached answer is a copy. Change a price and the cache keeps giving the old one until its time runs out. | "Change a price" + TTL slider |
| `dies` | When the cache dies | Turn the cache off at full traffic. Every question goes straight to the database at once. | "Kill the cache" |

Check: *"200 product views a second, the cache answers 9 in 10. The cache restarts.
For a moment, how many a second reach the database?"* — 20 · 100 · **200** · 0.
Because: *"With the cache gone nothing absorbs the reads, so the database gets all
200 — ten times what it was sized for."* Replay: `dies`.

## 4. The chapters

Every chapter is: one `meet` step, four or five practice steps, one checkpoint, on
Pocket Market. Every practice step keeps today's honesty rules (fails as given,
passes with its stored solution; observe steps show something actually going wrong;
every wire visible). The numbers below are the authoring brief; the implementation
tunes them until those tests pass, and the step text is updated to match.

### Chapter 3 — Don't ask twice (Phase A)

Unlocks `cache`. Concepts `caching`, `cache-aside`.

| # | Type | Title | What happens | Judged by |
| --- | --- | --- | --- | --- |
| 3-0 | meet | Meet the cache | Section 3.5 | The check |
| 3-1 | find-bottleneck | The same question, 200 times | 200 product views/s; app has room, the database does not. Predict, then run. | Observe |
| 3-2 | fill-gap | Ask the cache first | Add a cache between app and database. | 200 req/s ≤ 1% lost; database ≤ 70% busy; uses a cache |
| 3-3 | tune-dial | A cache big enough | Cache memory dial against a stated working set; budget stops "max it out". | 300 req/s ≤ 1% lost; database ≤ 60% busy; under budget |
| 3-4 | kill-switch | When the cache restarts | Cache killed at 10 s at full traffic; the database floods. | Observe |
| 3-5 | fix-wiring | Orders kept in the cache | Writes go to the cache with nothing durable behind them. Rewire so orders reach the database. | Clears `cache-as-system-of-record`; orders reach the database |
| 3-6 | checkpoint | Catalogue sale day | Shop with no cache; add and size one, survive a short cache restart. | Quiet day; sale peak; cache restart (`forS`) with a loss cap; under budget |

### Chapter 4 — Bytes don't belong in your app (Phase B)

Unlocks `blob_store`, `cdn`. Concepts `blob-storage`, `cdn`. Scene `cdn`: a photo
crossing the world from one server vs. served from a nearby edge copy; egress cost
ticking per GB.

Steps: images fill the app's workers (find-bottleneck) → move images to blob storage
(fill-gap) → CDN in front, not behind the app (fix-wiring, clears `cdn-behind-app`) →
cut the egress bill (tune-dial: CDN hit rate / placement) → checkpoint "Product
photos go viral".

### Chapter 5 — Work you can do later (Phase C)

Unlocks `queue`, `worker`, `dlq`. Concepts `async`, `queue-backpressure`. Scene
`queue`: envelopes joining a line, workers taking them; arrival rate vs. drain rate
sets whether the line grows; a poison message going round forever until a dead-letter
queue takes it.

Steps: a slow email provider holds up checkout (find-bottleneck with third-party
latency) → hand the email to a queue (fill-gap, async edge) → the queue fills because
nothing reads it; add a worker (fill-gap, clears `queue-without-consumer`) → workers
enough to drain the rush (tune-dial) → add a dead-letter queue (fill-gap, clears `queue-without-dlq`)
→ checkpoint "Order confirmation flood".

### Chapter 6 — The database is the hard part (Phase D)

Unlocks `read_replica`. Concepts `replication`, `consistency-models`. Scene
`replica`: writes land on the primary and stream to the replica a moment later; a
user reads their own just-placed order from the replica and it is not there yet.

Steps: reads swamp the primary (find-bottleneck) → add a replica for reads only
(fill-gap, `carries: 'read'`) → "my order vanished" (fix-wiring, clears
`read-after-write-on-replica`) → the replica dies, reads fall back (kill-switch) →
checkpoint "Reports on the live database".

### Chapter 7 — Nobody is watching (Phase E)

Unlocks `api_gateway`, `observability`. Concepts `authn-authz`, `observability`.
Scene `watch`: the same failure with and without signals — a dark system where
the learner guesses, then one with request counts, latency and errors per part
lighting up the culprit; then an unauthenticated request walking straight to the
database vs. being stopped at the gateway.

Steps: requests reach the app with no one checking who sent them (fix-wiring, clears
`no-auth-boundary`) → add observability (fill-gap, clears `no-observability`) → a
slow dependency only visible with signals (find-bottleneck) → checkpoint "The
One-Box Storefront": a course step whose starting design is taken from the existing
lab of that name (`labs.ts`), with its own gates, so it is judged like every other
step.

The design handoff's step-level judging rule holds: no step asserts one blessed
graph shape; gates, findings and `uses` decide.

## 5. Out of scope

- The graduation screen (`docs/design-handoff/07-screen-graduation.md`).
- The AI elective chapter.
- Chapter unlock by mastery threshold (today chapters unlock by order; unchanged).
- Moving scenes onto the request engine (revisit when it leaves its flag).

## 6. Testing

- `course.test.ts`: honesty tests run over practice steps only; new tests that every
  `meet` step has 3–6 beats, a `replay` naming one of its beats, an in-range
  `answer`, and a `scene` with a registered component.
- `judge.test`: `judgeMeet` right / wrong / out of range.
- `routes.test.ts`: a `meet` step passes with the right answer, 422s with a wrong or
  missing one, and a practice step still needs a graph.
- Scene number test: the cache scene's hit rate, database share and average time
  equal the engine's for the same memory / working set.
- In the running app (not just tests): open chapter 3 from the Learn page, play every
  beat, answer wrong (replays `dies`), answer right (passes, next step opens), skip
  straight to the question on a fresh account, reduced motion, dark mode. Use a
  throwaway account, never the real local one.

## 7. Phases

| Phase | Contents | Done when |
| --- | --- | --- |
| A | `meet` type, judge, route, `MeetLesson`, scene registry, `CacheScene`, chapter 3, LearnPath + hint link | Chapter 3 playable end to end in the running app; all tests green |
| B | `CdnScene`, chapter 4 | Same |
| C | `QueueScene`, chapter 5 | Same |
| D | `ReplicaScene`, chapter 6 | Same |
| E | `WatchScene`, chapter 7 (checkpoint = One-Box Storefront) | Same |

Each phase gets its own short plan when it starts; the `meet` mechanism is not
reopened after Phase A unless a scene genuinely needs something new.
