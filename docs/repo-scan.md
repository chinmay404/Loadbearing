# Scanning a repository

*Everything about the feature that reads someone's codebase and turns it into a sheet. Written to be read start to finish, in plain language.*

---

## 1. What problem this solves

Someone builds an app with an AI coding assistant. It works on their laptop. Then they want to put it on the internet, and they stop — because the question is no longer "does it work" but "what breaks, and what leaks."

They do not need an architecture lecture. They need someone to look at **their** app and go through it with them.

So: they show us the code, we tell them what is actually in it, and then **they design the production version themselves** while the app checks their work against the code they wrote.

The last part is the important one. We do **not** draw their architecture for them. If we did, there would be nothing left to learn.

---

## 2. How someone uses it, start to finish

**Step 1 — Send the code.** Two ways in:

- **Through their coding agent.** They say "scan my repo into Loadbearing" to Cursor, Claude Code, or whatever they use. The agent follows the `loadbearing-scan` skill, collects the right files, removes every secret, and calls the `scan_repo` tool. Their code never goes anywhere except to their own Loadbearing.
- **By hand.** Anything that can make an HTTP request can `POST /api/scan`.

**Step 2 — We read it.** In under a second, with no AI involved. We work out what gets deployed, what URLs it answers on, what it stores things in, who it calls, what AI it uses, and what would go wrong if it were public tomorrow.

**Step 3 — They look at what we found.** The **Code** tab on any sheet. Every single thing we claim has a file and a line number next to it, and clicking a row shows the actual lines of their code we based it on. They can tell us we are wrong.

**Step 4 — They design.** They add their own app's parts to the canvas from the list. Everything *around* those parts — the cache, the queue, the rate limit, the second copy of the server, the backups — is theirs to think of. Those are not in the list, because they are not in the code.

**Step 5 — Everything checks itself, for free.** The simulator pushes traffic through the drawing. The 22 structural rules run. And a new set of rules compares the **drawing** against the **code** — which is where sentences like this come from:

> You drew a queue between the API and the model, but your handler calls it directly and waits for the answer. One of the two is wrong.

**Step 6 — The grader argues with them.** It receives the scan as facts it is not allowed to contradict, so it can no longer be talked into praising a design the code does not implement.

---

## 3. How we actually read the code

Three different techniques, and we use the cheapest one that works.

### Next.js — no code reading at all

In Next.js the **folder names are the answer.** A file at `app/api/chat/route.ts` that exports `POST` means the app answers `POST /api/chat`. There is nothing to interpret. We handle:

| What we see | What it means |
|---|---|
| `app/api/chat/route.ts` exporting `POST` | `POST /api/chat` |
| `app/api/users/[id]/route.ts` | `/api/users/:id` |
| `app/api/proxy/[...path]/route.ts` | `/api/proxy/*` |
| `app/(marketing)/api/lead/route.ts` | `/api/lead` — folders in brackets organise files but do not appear in the URL |
| `pages/api/users/index.ts` | `/api/users` |
| any file starting with `'use server'` | a server action — a hidden POST endpoint people forget to protect |

This is exact, so we label these findings **observed**.

### JavaScript and TypeScript — careful pattern matching

We strip out every comment first. This matters more than it sounds: without it, a comment saying *"don't call `app.get('/admin')` here"* becomes a reported endpoint that does not exist. We keep the text inside quotes, because that text is usually the answer we are looking for.

Then we find:

- route registrations: `app.get('/x')`, `router.post('/y')` (Express, Hono, Fastify)
- what each file imports
- which files say `'use client'`
- every place the code reads an environment variable

### The import trail — how we prove a secret leaks

This is the most valuable thing the scanner does.

We build a map of which file imports which. Then we start from every file the browser runs — anything marked `'use client'`, anything under `components/` — and follow the arrows.

If that trail reaches a file that reads a secret, the secret is in the browser. And we can print the exact route it took:

```
components/Chat.tsx → lib/db.ts
```

That is not a guess someone can argue with. That is why the rule exists.

Route handlers, `middleware.ts` and `*.server.ts` are treated as server-only no matter what, so one stray `'use client'` line cannot flip the whole map upside down.

### Python — matching the decorator lines

`@app.post("/ask")`, `@router.get("/x")` and `@app.route("/y", methods=["POST"])` are regular enough that reading the line works about 99% of the time. It is not the filesystem, so we mark every Python endpoint **inferred**, and the scan says so out loud in its notes.

### Everything else

Go, Rails, Java, anything we do not handle — you still get the deployables and the databases from the manifests. You do not get the routes, and the scan tells you that rather than quietly returning a short list.

---

## 4. What we never send, and never keep

The scan carries someone's private source code. Two promises, both enforced in code and not just in documentation.

### Secrets are removed before anything is sent

The agent skill requires four things before the payload exists:

**1. `.env` files become names only.**

```
BEFORE   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
AFTER    SUPABASE_SERVICE_ROLE_KEY=«redacted len=218 shape=jwt»
```

**2. A key written into source keeps its line and loses its value.**

```
BEFORE   const client = new Anthropic({ apiKey: "sk-ant-api03-QYt…" });
AFTER    const client = new Anthropic({ apiKey: "«redacted shape=anthropic-key»" });
```

This one is deliberate and worth understanding. A key pasted into source code **is a finding** — we want to report it. Replacing only the value means the finding survives and the secret does not.

**3. Connection strings keep their shape and lose their credentials.**

```
BEFORE   postgres://admin:hunter2@db.abc.supabase.co:5432/postgres
AFTER    postgres://«user»:«pw»@«host».supabase.co:5432/postgres
```

**4. Some files are never sent at all** — `.pem`, `.key`, `.p12`, `credentials.json`, `.ssh/`, `.aws/`. They are listed as skipped, so the person knows they exist.

There are then **two more nets** behind that, because a model can forget a rule:

- The **MCP tool checks the payload itself** before it goes anywhere. If it finds something that looks like a live key — `sk-ant-`, `ghp_`, `AKIA`, a JWT, a private key block — it refuses, names the file, and sends nothing.
- The **server refuses** any path that looks like key material, whatever the sender claims about it.

### Only evidence lines are kept

The files are read in memory and dropped when the request finishes. What is stored is at most **five lines per finding**. Someone who scans a private repository has left a handful of lines behind, not a copy of their codebase.

### Size limits, all of which report themselves

| Limit | Value |
|---|---|
| Files | 400 |
| Total payload | 1.5 MB |
| One file | 120 KB, then truncated |
| Scans kept per account | 20, newest first |

Anything dropped or truncated is listed in the scan's coverage. **A partial scan that does not say it is partial reads exactly like a complete one** — that is how a missing finding turns into a wrong answer.

---

## 5. What you get back

### The shape of the system

Not an opinion — a count of what is written down.

| Verdict | When |
|---|---|
| `monolith` | one deployable, many routes, all in one process |
| `services` | several separately deployable pieces, or several services in a compose file |
| `static+functions` | one Next.js app on Vercel — pages plus one function per route |
| `unknown` | no manifest found, usually meaning the scan started in the wrong folder |

Databases declared in a compose file (a `postgres:16` image, a `redis:7` image) are **not** counted as services someone built. They are rented infrastructure, and they show up as datastores instead.

A package with only `tsc` scripts is a library, not a deployable. We learned this by pointing the scanner at Loadbearing itself and watching it report `shared/` as a service.

### The inventory — the Code tab

Five groups, in the order a person reads them:

1. **What gets deployed**
2. **What it answers on** — every endpoint, whether it checks who is calling, what it reaches
3. **What it stores things in**
4. **Who it calls**
5. **What it thinks with** — models, agents, vector stores

Every row shows its evidence when clicked. Rows we are not certain about say **inferred**.

Rows with an **Add** button drop onto the canvas already carrying an annotation written from the code — *"Postgres reached through the Supabase JS client"* — because an unannotated box scores nothing with the grader, and a component that arrives already failing that would teach the wrong lesson immediately.

**There is no Add button for a load balancer, a cache, a queue, a rate limiter or a guardrail.** They are not in the list at all. That is the whole point.

### The exposure list

Sorted worst first. Each one has: how bad, what is wrong, why it matters, how to fix it, where in the code, and — for anything about reachability — the chain that proves it.

---

## 6. Every rule we check, in plain language

### Our own rules (free, instant, run on every scan)

| Rule | Fires when | Severity |
|---|---|---|
| `secret-reaches-client` | A secret-looking variable is read in a file the browser can reach. **Only ever raised with the import chain that proves it.** | critical |
| `public-env-holds-secret` | A `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_` variable has a name suggesting a credential. These are baked into the browser bundle by the framework. | critical |
| `hardcoded-secret` | A key, token or password is written into source as a literal. | critical |
| `unguarded-endpoint` | An endpoint has no sign-in check and reaches a database or a model. Critical when it is a model — that is how a hobby project runs up a four-figure bill overnight. | critical / high |
| `llm-without-ceiling` | The code calls a model and nothing anywhere limits the rate or the spend. | high |
| `env-file-committed` | A `.env` file exists and `.gitignore` does not exclude it. Everything it has ever held is in git history. | high |
| `cors-wildcard` | CORS allows every origin. With cookie sessions, another site can make requests as the signed-in user. | medium |
| `no-rls-found` | Supabase is used and no migration enables row-level security. The anon key reaches the database straight from the browser. | high / medium |
| `sql-string-built` | A SQL statement is assembled by joining strings. | high |

Names deliberately **not** treated as secrets: `ANON_KEY`, `PUBLISHABLE`, `PUBLIC_KEY`, `CLIENT_ID`, and anything ending `_URL`, `_HOST` or `_REGION`. Accusing someone's public Supabase URL of being a leak is the fastest way to lose their trust in everything else on the list.

### Drawing versus code (only when something is bound)

| Rule | Fires when |
|---|---|
| `drawn-async-called-sync` | A model or service is drawn behind a queue, but the handler calls it inline and waits. |
| `drawn-protection-not-in-code` | A rate limiter, guardrail or WAF is on the diagram and nothing in the repository implements it. *A protection that exists only on the diagram is the most expensive kind — it stops anyone looking for the real one.* |
| `endpoints-not-represented` | Endpoints touching data have no guard and are nowhere on the diagram. |
| `measured-slower-than-drawn` | A trace measured a p95 more than 3× what the drawing assumes. Every number downstream is being computed from a figure the app has already disproved. |
| `datastore-missing-from-drawing` | The code talks to a database and nothing like it is drawn. |

**With nothing bound, none of these fire.** That is correct: with no stated correspondence between a box and a piece of code, there is no contradiction to report, and inventing one would mean accusing someone of a mismatch they never claimed.

---

## 7. Semgrep and CodeQL

Both can be used. Neither is run by Loadbearing.

They run **on the user's own machine**, under the user's own licence, and send us their results as **SARIF** — a standard format both produce. We fold them into the same list as our own findings, because the person reading it does not care which program noticed.

This is not a technicality, it is the only arrangement that is legal:

- **CodeQL** is free for open-source codebases and academic research. Analysing closed-source code needs a commercial licence. Our users' repositories are private by definition, so a hosted product that ran CodeQL for them would need to buy that licence. Instead, the skill pulls the results GitHub code scanning has **already produced** on the user's own repository:

  ```bash
  gh api "/repos/{owner}/{repo}/code-scanning/analyses" --jq '.[0].id'
  gh api "/repos/{owner}/{repo}/code-scanning/analyses/{id}" -H "Accept: application/sarif+json" > codeql.sarif
  ```

  A 403 or 404 just means code scanning is not switched on. That is normal, not an error.

- **Semgrep**'s engine is LGPL-2.1 and free to use. But its maintained rule packs moved to a licence that excludes exactly our situation — non-competing, non-SaaS. So the user runs it locally with whatever rules they like:

  ```bash
  semgrep --config auto --sarif --output semgrep.sarif --quiet .
  ```

Findings from either tool are always marked **inferred**, never observed. Somebody else's static analysis is a strong signal, but it is still static analysis — it does not know which code paths actually run in production.

SARIF results are capped at 400 per tool and 60 after merging, worst first. A `--config auto` run on a busy repository returns thousands of results, and a wall of lint noise buries the four findings that would actually have got somebody hacked.

---

## 8. Traces — the v2 half

Static analysis can tell you a handler imports the Anthropic SDK. It cannot tell you the call takes 2.4 seconds and blocks the request. **That second fact decides the entire design.**

OpenTelemetry gives it to you for free, with no code changes and no vendor:

```bash
OTEL_TRACES_EXPORTER=console node --require @opentelemetry/auto-instrumentations-node/register server.js
```

Python:

```bash
OTEL_TRACES_EXPORTER=console opentelemetry-instrument python main.py
```

The user runs their app the way they already do, clicks around for a minute, and sends whatever the exporter printed. We accept it in any of the three shapes it comes in: console output pasted verbatim, JSON Lines, or OTLP JSON.

Each trace becomes a request path with real numbers:

```
POST /api/chat                          412ms
├─ HTTP POST api.anthropic.com          2400ms   ← the real problem
├─ pg SELECT messages                     12ms
└─ HTTP POST supabase.co/storage          88ms
```

Identical paths across many traces collapse into one flow carrying the sample count and the percentiles — *"this happened 40 times and the 95th percentile was 3.1 seconds"* is an argument; one example is an anecdote.

**What a trace is allowed to set:** the service time of a bound component, and whether a third party is elastic.

**What it is not allowed to set:** capacity. Sixty seconds of one person clicking says nothing about how many requests per second something can serve, and a made-up capacity would flow straight into the utilisation arithmetic the entire simulator rests on.

---

## 9. Bindings

A binding is one sentence: **"this box on the canvas IS that piece of code."**

```ts
{ codeRef: 'component:llm-anthropic-api', nodeId: 'n38naf', source: 'static' }
```

Created automatically when a row is added from the Code tab. Three things become possible the moment one exists:

1. The **simulator** can use a measured service time instead of a catalogue default.
2. The **checks** can compare the drawing against the code.
3. The **grader** gets the correspondence as a fact rather than an assumption.

Rules the store enforces: one node stands for one piece of code (binding the same code twice moves it rather than duplicating it), and a binding never outlives the node it points at — dead bindings are dropped when the document is saved, so undo, lasso-delete and every other way a node can disappear are all covered in one place instead of three.

Bindings and the scan id live on the canvas document, so there is no new table and a sheet can never point at a scan that was deleted from under it.

---

## 10. The API

### `POST /api/scan`

```jsonc
{
  "projectName": "my-app",
  "files": [ { "path": "app/api/chat/route.ts", "content": "…redacted…" } ],
  "sarif": [ { "tool": "semgrep", "results": [ /* SARIF result objects */ ] } ],
  "meta": {
    "filesSeen": 412,
    "truncated": ["app/page.tsx"],
    "skipped": ["service-account.json"],
    "dropped": []
  }
}
```

Returns `201` with `{ id, scan, inventory, candidateFlows }`.

Paths must be repo-relative with forward slashes and no leading `./`. An absolute path leaks the user's folder layout and breaks the evidence links in the UI.

### The rest

| Route | What it does |
|---|---|
| `GET /api/scans` | Every scan on this account, newest first |
| `GET /api/scan/:id` | One scan, its inventory, its suggested flows, and its trace if there is one |
| `POST /api/scan/:id/trace` | Attach OpenTelemetry spans |

### MCP tools

| Tool | What it does |
|---|---|
| `scan_repo` | Send a repository. Refuses to send anything containing a live-looking credential. |
| `get_scan` | One scan, or the list with no id |
| `add_trace` | Attach spans to a scan |

---

## 11. What this cannot do

Stated plainly, because a scanner that hides its blind spots is worse than one with fewer features.

- **It does not know which code actually runs.** `touches` means "this module is in scope in this handler", not "this is called on every request". That is why suggested flows are suggestions and have to be accepted.
- **It cannot always tell whether an endpoint is guarded.** Middleware protecting some routes and not others needs matcher analysis we do not do. When middleware exists, the guard is reported as `unknown` rather than `none`, and the unguarded-endpoint finding is always marked *needs checking*.
- **Python routes are matched by line shape.** About 99% right, which is not 100%.
- **A dependency that is declared but never imported** is still reported — as inferred. It might be a leftover, or it might be used somewhere we did not collect.
- **RLS is checked by reading migrations.** If no SQL was collected we say we could not check, rather than saying it is fine.
- **Only public repositories can be scanned by URL.** Private ones go through the agent, which is better anyway: the code never leaves the machine.

---

## 12. Adding support for a new framework

Almost always one row in `shared/src/scan/deps.ts`:

```ts
{
  match: '@planetscale/database',
  nodeType: 'sql_db',
  label: 'PlanetScale MySQL',
  mechanism: 'serverless driver over HTTP',
  group: 'datastore',
  eco: 'node',
}
```

- `match` ending in `*` is a prefix. The longest match wins; an exact match beats a prefix.
- `eco` keeps ecosystems apart, so the Python `celery` cannot match a Node manifest.
- `implies` adds companions — a queue implies a worker.
- `mechanism` states **what the code does**, never what the design should do. "Postgres via the Supabase client" is a fact; "use connection pooling" is advice, and putting advice in an annotation would mean the grader is marking its own homework.

A new web framework is one row in `FRAMEWORKS` plus, if it registers routes in an unusual way, a pattern in `endpoints.ts`.

---

## 13. Where everything lives

```
shared/src/scan/
  types.ts        the shapes — RepoScan, Detected, Exposure, Binding, TraceSpan
  source.ts       the only thing that touches "files": list() and read()
  deps.ts         dependency name -> canvas component (the lookup table)
  manifests.ts    what gets deployed, and the monolith question
  endpoints.ts    the HTTP surface
  exposure.ts     the security rules
  sarif.ts        Semgrep and CodeQL results, normalised
  trace.ts        OpenTelemetry spans -> flows with real numbers
  inventory.ts    scan -> the Code tab, and rows -> canvas nodes
  divergence.ts   drawing versus code, and the facts handed to the grader
  index.ts        scanRepo() — puts the passes in order
  scan.test.ts    58 tests, including scanning Loadbearing itself

server/src/scan/routes.ts       receiving, limiting, refusing, storing
server/src/mcp/tools.ts         scan_repo, get_scan, add_trace
client/src/panels/ScanPanel.tsx the Code tab
.claude/skills/loadbearing-scan/SKILL.md   what the coding agent follows
```

The scanner is a pure function of a file list. It runs in a serverless function, in a test, and — if it ever needs to — in a browser, without changing a line.

---

## 14. Why the scanner is pointed at Loadbearing itself

The last two tests scan this repository and check the answers.

A fixture can be quietly shaped until it passes. A real monorepo cannot. That test is the reason we found out that `shared/` was being reported as a deployable service, because it has a script called `dev` that runs `tsc --watch`.

That was a real bug, found the only way it could have been.
