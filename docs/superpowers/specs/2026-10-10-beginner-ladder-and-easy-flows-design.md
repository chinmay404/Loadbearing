# Beginner ladder and flows that set themselves up

Date: 2026-10-10. Status: approved in conversation, awaiting spec review.

## Why

A learner new to architecture found the problem bank unusable as a starting point:

- **The first rung is too high.** The first Level 1 sheet (`l1-read-heavy-product-api`) expects
  region-aware cache keys, invalidation, stampede protection and working-set math. That is a
  mid-level interview, and the Learn course stops at chapter 2 ("Two of everything"), so nothing
  bridges the two.
- **The briefs are written for experts.** They are long, full of jargon, and phrased as a staff
  engineer briefing a peer.
- **Flows are confusing.** Declaring one takes five unexplained decisions: a name, a kind, an rps,
  a guarantee, and steps chosen from a dropdown.

The coach has already been changed to explain instead of quizzing; that change is done and is not
part of this spec.

**Success:** a beginner can open the first sheet, understand what is asked without outside help,
draw it with the hints, have the requests set up without typing, and get a score that reflects
whether they learned the one idea the sheet teaches.

## Part 1 — The "Start here" ladder

### Content

There are six topics, each with two sheets. Every sheet stays at `level: 1`, carries a `track`,
and uses an id of the form `l1-start-<topic>-basics` or `l1-start-<topic>-step-up`, so the
existing id rule `^l[1-6]-` still holds.

| Topic | Basics: one idea | Step up: one new pressure | `next` |
|---|---|---|---|
| photo-upload | Keep photos in object storage, not on the app server or in the database | 2,000 views/s: put a CDN in front; resize in the background with a queue and a worker | `l1-image-upload-service` |
| ai-chat | A chat app is an app server calling an LLM; the LLM is slow and costs money per call | The same questions repeat: cache the answers, and cap spend with a rate limiter | `l6-llm-gateway-cost-latency` |
| product-page | A product page is read from a database through an app server | Reads outgrow the database: add cache-aside with a TTL, and update the cache when a price changes | `l1-read-heavy-product-api` |
| stay-up | One server dies: two servers behind a load balancer | The database dies: add a replica and fail over to it | `l2-autoscaled-campaign-tier` |
| background-work | Send the welcome email from a queue and a worker so signup does not wait | The email provider fails: add retries with backoff and a failed-jobs (dead-letter) queue | `l1-signup-email-verification` |
| short-links | Create a short link and redirect it, stored in one database | Millions of clicks: redirect from a cache and count clicks asynchronously | `l2-url-shortener-50k-rps` |

### Writing rules for these sheets

- **Prompt:** at most 5 sentences, with 1–2 numbers and no unexplained jargon.
- **Numbers:** small and round: tens to low thousands of rps.
- **Size:** the intended design is 3–5 boxes for Basics and 5–7 for Step up.
- **Hints:** 3–5 per sheet, phrased as a question followed by a pointer. Optionally a hint carries a
  `ghost` (one component) for "Show me".
- **Glossary:** an entry for every technical term that appears in the prompt or the hints.
- **Flow plans:** a `flowPlan` for every expected flow.
- **Scenarios:** at least one per sheet, and they must be passable by the intended design under the
  real engine (enforced by a test; see Testing).
- **Twists:** at least one. On a Basics sheet the first twist is the Step-up pressure.

### Problems page

A **Start here** section appears above the level tiers, with one row per topic:
`Topic — [Basics] → [Step up] → next sheet title`. Each card shows done/not-done from attempts,
the same way existing cards do. The track sheets are not repeated in the L1 tier, but the L1
filter still shows them.

## Part 2 — The beginner sheet

### Data (`shared/src/types.ts`)

New optional fields on `Problem`:

```ts
track?: { topic: string; stage: 'basics' | 'step-up'; next?: string };
learn?: string;                 // one line: what this sheet teaches
hints?: { text: string; ghost?: { type: NodeType; label: string; annotation?: string } }[];
glossary?: { term: string; meaning: string }[];
flowPlans?: FlowPlan[];         // see Part 3
```

`ProblemSummary` gains `track`, and `summarize()` in `server/src/problems/routes.ts` copies it.
`validateProblem` keeps `track`, `learn`, `hints`, `glossary` and `flowPlans` when they are well
formed and drops them otherwise. That keeps custom and composed sheets compatible; composing
beginner sheets is out of scope.

### Seed audit (`server/src/problems/validate.ts`)

`auditSeedProblem` applies a lighter rule set when `track` is present:

- **Lower minimums:** functional ≥ 2, nonFunctional ≥ 2, constraints ≥ 1, concepts ≥ 2,
  expectedFlows ≥ 1, twists ≥ 1, scenarios ≥ 1.
- **Beginner fields required:**
  - `learn` is non-empty.
  - There are 3–5 `hints`.
  - There are ≥ 2 `glossary` entries.
  - There is a `flowPlan` for every expected flow.
  - `track.next` resolves to a bank problem.

Every other rule (id pattern, prompt ≥ 120 chars, rubricHints ≥ 80 chars, known concepts,
scenario passCriteria) is unchanged.

### Brief tab (`client/src/panels/BriefPanel.tsx`)

When `track` is present the order is:

1. Tags and title.
2. **What you'll learn** (`learn`).
3. **The situation**: the full prompt. These prompts are short, so there is no "read the full story" fold.
4. **Words used here**: glossary chips. Clicking one shows its meaning inline.
5. **Give me a hint**: reveals the next hint. A hint with a ghost shows **Show me**, which calls
   the existing `addGhosts`. How many hints are revealed is kept per sheet in the client store,
   so leaving the tab does not reset it.
6. **Requests to handle**: links to the Flows tab (Part 3).
7. **Make these pass**: scenario gates, as today.
8. Number tiles, functional ("It must"), constraints ("Rules").
9. A **Next:** link to `track.next` at the bottom.

Sheets without `track` render exactly as they do today.

### Grading and coaching (`server/src/scoring/prompt.ts`)

- `renderProblem` prints `level 1/6 — beginner sheet (<stage>)` and the `learn` line when `track`
  is present.
- `buildScoringPrompt` adds a **BEGINNER SHEET** block to the user message when `track` is
  present. That block says:
  - Grade against the one idea in `learn`.
  - A design that gets that idea right scores at least 7/10 on the dimensions it touches and at
    least 65 overall, even if it ignores advanced concerns.
  - Do not list advanced absences (observability, multi-region, auth hardening) as critical
    failures.
  - Write every note in plain words and define any term on first use.

  The system prompt stays byte-identical so provider prefix caching still hits.
- The teaching coach receives the sheet's `learn`, hints and glossary in its user message, so its
  explanations line up with the sheet.

## Part 3 — Flows that set themselves up

### Flow plans (`shared/src/flowPlans.ts`, new, pure)

```ts
interface FlowPlan {
  name: string;          // matches an expectedFlows entry
  kind: FlowKind;
  rps: number;
  plain: string;         // one sentence: what this request is, for a beginner
  mustReach?: NodeType[][]; // each inner list = "the path passes through one of these types"
}
```

- `plansFor(problem)` returns `problem.flowPlans` when present. Otherwise it derives one plan per
  `expectedFlows` name:
  - `kind` is guessed from the name:
    - `write`: upload, write, create, update, delete, checkout, pay, send, import.
    - `async`: job, worker, background, generation, export, nightly, process.
    - `admin`: admin.
    - Otherwise `read`.
  - `rps` is 100, `plain` is empty, and there is no `mustReach`.
- `candidatePaths(graph)` enumerates request paths using the engine's existing path walk
  (`engine.ts` `prepare()` / `EngineResult.paths`) from entry points. It is capped the same way
  and excludes ghosts.
- `matchPath(plan, paths)` keeps the paths that satisfy every `mustReach` group and returns:
  - `{ status: 'found', path }` when exactly one shortest path matches;
  - `{ status: 'choose', paths }` when several match (or when there is no `mustReach` and any
    paths exist);
  - `{ status: 'none' }`.
- `isStale(flow, graph)` is true when the flow's steps no longer form a connected path in the
  graph, using the same rule the simulator applies (each step needs an edge from an earlier step).

### Flows tab (`client/src/panels/FlowPanel.tsx`)

The tab is titled **Requests your system must handle**, with one line of explanation:
"A request path is the route one kind of request takes through your boxes. The load test pushes
traffic down these paths."

For each plan there is a card:

- **Header:** the name, the kind and rps (both editable inline), and the `plain` sentence.
- **Path status:**
  - **found:** shows `User → App server → Object storage` and a **Use this** button. Pressing it
    creates or updates the flow with those steps, the plan's kind and rps, and the plan's name
    (so expected-flow coverage matches).
  - **choose:** lists up to 4 detected paths, each a one-click button.
  - **none:** "Not connected yet — draw an arrow from the user to the next box."
  - When the flow exists and `isStale` is true: "Your drawing changed — **Update path**."
  - When the flow exists and is current: the path, plus the simulator result chips as today.
- **Edit by hand** (collapsed): today's editor (name, kind, rps, guarantee, step dropdown),
  unchanged.

Flows the learner added that match no plan are listed below the cards with today's editor.
The canvas store API (`addFlow`, `updateFlow`, step functions) is unchanged; the panel only
calls it.

## Out of scope

- Composing beginner sheets through Compose or MCP `add_sheet`. The fields validate, but there is
  no authoring UI.
- The hidden review model answer and the Socratic questions on the review. A separate follow-up.
- New Learn-course chapters.
- MCP `get_sheet` exposing hints or the glossary.

## Testing

- **`shared`:**
  - `flowPlans.test.ts`: kind guessing; `matchPath` found, choose and none; `mustReach` groups;
    `isStale` after an edge is removed.
- **`server`:**
  - `bank.test.ts`: new counts (56 problems; level 1 = 19) and every track sheet passes the
    beginner audit.
  - A new **ladder test** that places each track sheet's reference design (an `answer` diagram
    kept in the test file, not shipped to the client) and checks that every scenario gate passes
    and that `matchPath` finds every plan's path.
  - `validate.test.ts`: the new fields survive `validateProblem`, and malformed ones are dropped.
  - `prompt.test.ts`: the beginner block appears only for track sheets, and the system prompt is
    identical with and without it.
- **`client`:** a unit test for the Start-here grouping.
- **In the running app (scratch database, throwaway account):** open Start here, then on the
  Basics photo sheet:
  1. Reveal the hints.
  2. Use "Show me".
  3. Draw the design.
  4. Accept the found path.
  5. Run load and see the gates pass.
  6. Change an edge and see "Update path".
  7. Open an existing L1 sheet and see the derived cards with path choices.
