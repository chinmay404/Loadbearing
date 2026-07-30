# Loadbearing

Learn software architecture the only way it sticks: by drawing designs against hard problems and
having them torn apart. A local web app — your machine, your data, your choice of grader model.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The server runs on 127.0.0.1:8787.

To try the UI without a model, open **Grader model** and pick "Offline stub". For real reviews,
pick a provider and paste a key (see below).

## The loop

0. **Or write your own sheet.** *Compose a sheet* takes a scenario in your words plus the constraints
   you are actually under — team size, budget, compliance, the numbers you know — and turns it into a
   problem with a rubric, twists and load scenarios. Use it to drill a topic, or to have a system you
   really run reviewed against its real numbers.
1. **Pick a problem.** 25 hand-written problems across six levels — from caching a read-heavy API up
   to multi-region active-active data, exactly-once billing, cell-based tenant isolation and AI
   systems (RAG with eval gates, agent sandboxing, LLM cost control). Each one carries real numbers
   (RPS, data size, p99 budget), hard constraints (team size, monthly budget, existing stack) and the
   tension that makes it hard.
2. **Draw the design.** Click or drag from a palette of 27 typed components. Connections are typed
   too: sync call, async event, replication. Annotate every box with the *mechanism* that matters
   ("idempotency key = order_id", "cache-aside, TTL 60s, coalesce on miss") — the grader reads
   annotations, and a box labelled "Cache" with no strategy earns nothing. Sticky notes and a
   freehand pen are there for the reasoning that does not fit in a box.
3. **Declare your flows.** A flow is one request's journey: `Client → ALB → API → Redis → Postgres`,
   with a baseline RPS and a kind (read/write/async/admin). This is what turns a box diagram into a
   design, and it is graded step by step.
4. **Run load before you submit.** A deterministic capacity model pushes your flows through your
   components: utilization, queueing latency, drops, queue depth, monthly cost. Drag the load slider
   to 50×. Kill a component and watch flows re-route through redundant siblings — or break. Kill the
   cache and watch the whole read volume land on your database. No tokens spent; it all runs locally.

   Every component **shows its arithmetic** in the Inspector — capacity as *per-replica × replicas*,
   utilization as *arriving ÷ capacity*, latency as *service time ÷ (1 − utilization)*, and exactly
   how much traffic is being shed. **Verify on server** recomputes the whole run in the backend so a
   number you are about to defend does not depend on whatever is loaded in your browser tab.

   The **Checks** tab is separate and free: deterministic structural review of how components fit
   together. A client wired straight into Postgres, a queue nobody consumes, a replication edge into
   a cache, an LLM with no guardrail or spend ceiling, a load balancer with one backend — caught while
   you draw, before a model is ever asked for an opinion.
4½. **Scenario gates.** Every load scenario on the sheet is a machine-checked pass/fail gate,
   evaluated live by the capacity model as you draw — "TV spot spike: FAIL — 34% of traffic dropped
   (gate: at most 1%)". Making them green costs nothing, and the grader receives the gate results as
   facts it must respect.

5. **Submit for review.** The grader scores six dimensions (requirements, scalability, reliability,
   data & consistency, security, cost & simplicity — overengineering loses points too), names the
   concrete failures ("a client retry on POST /charge with no idempotency key charges twice"), finds
   your SPOFs, reviews each flow, keeps a three-row risk register, says what changes first at ten
   times the load, and asks Socratic questions before it will show you a model answer. It also
   **draws on your canvas**: markers pinned to your components, plus ghost nodes you can accept
   with one click.
5½. **Answer the follow-up questions.** The review's Socratic questions have answer boxes: write a
   sentence or two naming the mechanism, and the grader marks it strong / partial / miss with feedback
   — and it moves your concept mastery, so dodging the questions shows on the dashboard. You can also
   open the model answer **as a diagram** and watch it carry the same load your design just took.

6. **Take the twist.** A constraint changes — the payment provider's p99 jumps to 4s, traffic goes
   20×, a region dies — and you adapt the same diagram for round two, graded on the adaptation.
6½. **Round diffs.** On a twist round the grader receives the exact computed diff of what you changed,
   so it judges the adaptation itself — and History shows the diff and the score delta between rounds.

7. **Watch mastery build.** Concepts go stale on a spaced-repetition clock (strong ones rest 14 days,
   weak ones a single day); overdue concepts surface as a "Due for review" strip with a one-click
   **Start today's drill** that generates a problem around your three most overdue. Every review scores the concepts it saw; a per-concept exponential moving
   average feeds a radar and heatmap, and "Train my weakness" generates a fresh problem aimed at your
   three weakest concepts. Any attempt exports as a Markdown post-mortem (with a Mermaid diagram) into
   your Obsidian vault.

## For work, not just practice

- **Review a system you actually own.** Problem index → *Review my system*. Describe your production
  service in a paragraph — traffic, data, constraints — and it becomes a sheet with a rubric built
  from your own numbers. Draw what you really run, then have it argued with.
- **ADRs.** Any review writes a full Architecture Decision Record: context and constraints, the
  decision, alternatives weighed and why they lose, consequences per component, a risk table with
  mitigations, and the at-10× note. Straight into your vault, or copied for a PR description.
- **Take the diagram with you.** Copy as Mermaid for a README or PR, or download `.drawio` with
  positions intact for people who do not have Loadbearing.
- **Ctrl+K** to add any component by name — faster than hunting a palette of sixty.

## Bring your own model

Settings → **Grader model**. Two wire formats cover essentially everything:

| Provider | Setting |
| --- | --- |
| Anthropic | provider `anthropic`, model e.g. `claude-sonnet-5` |
| Groq | base URL `https://api.groq.com/openai/v1` |
| DeepSeek | base URL `https://api.deepseek.com/v1` |
| OpenAI | base URL `https://api.openai.com/v1` |
| OpenRouter | base URL `https://openrouter.ai/api/v1` |
| Ollama (local, no key) | base URL `http://localhost:11434/v1` |

The key is stored in your local SQLite file and is never returned to the browser after saving. One
review costs roughly 3–6k input tokens and up to 2k output — a fraction of a cent on most providers.
The simulator, mastery tracking and design reference cost nothing.

Prefer not to store a key at all? Environment variables win over anything saved in the app:

```bash
LOADBEARING_PROVIDER=openai-compatible LOADBEARING_BASE_URL=https://api.groq.com/openai/v1 LOADBEARING_MODEL=llama-3.3-70b-versatile LOADBEARING_API_KEY=your-key npm run dev
```

## Design reference

45 concept cards in 8 groups — what it is, when to reach for it, what it costs, how it gets misused —
plus the 10-step checklist a complete architecture answer covers. This is the same vocabulary the
grader scores against, so studying it is studying the rubric.

## Layout

```
shared/     types, the concept taxonomy, and the simulation engine (pure, 28 tests)
server/     Hono API: problem bank, scoring prompts, LLM adapters, SQLite, vault export
client/     Vite + React + React Flow canvas, panels, dashboard
data/       loadbearing.sqlite  (gitignored — your attempts and mastery live here)
docs/       the design spec and implementation plan
```

## Tests

```bash
npm test
npx vitest run --root shared
```

60 server tests, 28 simulator tests. `FAKE_LLM=1` runs the whole loop with a canned grader.

## Keyboard

`V` select · `N` sticky note · `P` pen · `E` erase ink · `Delete` remove selection ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo / redo
