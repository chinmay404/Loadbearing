# ArchDojo

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
5. **Submit for review.** The grader scores six dimensions (requirements, scalability, reliability,
   data & consistency, security, cost & simplicity — overengineering loses points too), names the
   concrete failures ("a client retry on POST /charge with no idempotency key charges twice"), finds
   your SPOFs, reviews each flow, and asks Socratic questions before it will show you a model answer.
   It also **draws on your canvas**: markers pinned to your components, plus ghost nodes you can
   accept with one click.
6. **Take the twist.** A constraint changes — the payment provider's p99 jumps to 4s, traffic goes
   20×, a region dies — and you adapt the same diagram for round two, graded on the adaptation.
7. **Watch mastery build.** Every review scores the concepts it saw; a per-concept exponential moving
   average feeds a radar and heatmap, and "Train my weakness" generates a fresh problem aimed at your
   three weakest concepts. Any attempt exports as a Markdown post-mortem (with a Mermaid diagram) into
   your Obsidian vault.

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

## Design reference

45 concept cards in 8 groups — what it is, when to reach for it, what it costs, how it gets misused —
plus the 10-step checklist a complete architecture answer covers. This is the same vocabulary the
grader scores against, so studying it is studying the rubric.

## Layout

```
shared/     types, the concept taxonomy, and the simulation engine (pure, 28 tests)
server/     Hono API: problem bank, scoring prompts, LLM adapters, SQLite, vault export
client/     Vite + React + React Flow canvas, panels, dashboard
data/       archdojo.sqlite  (gitignored — your attempts and mastery live here)
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
