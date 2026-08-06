---
name: loadbearing-scan
description: Use when sending a codebase to Loadbearing to be turned into a design sheet — "scan my repo", "send this project to Loadbearing", "review my app's architecture". Covers exactly which files to collect, the redaction rules that must run before anything leaves the machine, how to attach Semgrep and CodeQL results as SARIF, and how to verify the scan landed.
---

# Sending a repo to Loadbearing

Loadbearing turns a real codebase into a design sheet: it lists what the project
actually contains — deployables, endpoints, datastores, external services, AI pieces,
and what is exposed — and the person then designs the production architecture around
it. Your job is to collect the evidence and send it. The server does the analysis.

**You are not being asked to analyse the code.** Do not summarise, do not infer the
architecture, do not decide whether it is a monolith. Send files; the scanner is
deterministic and its answers must be reproducible from the same input.

## The one rule that matters

**No secret value ever leaves the machine.** Not in a file, not in an example, not
"just this once because it is a test key". Redaction (step 3) runs before the payload
is assembled, not after. If you are unsure whether something is a secret, redact it —
a redacted non-secret costs nothing, and the scanner only needs the *shape*.

---

## Step 1 — Locate and identify

Find the repo root (the directory holding `.git`, or the outermost `package.json` /
`pyproject.toml`). Then read the manifests to know what you are dealing with. Do not
guess the stack from directory names.

If the working directory is not a repo, stop and say so. Do not scan a home directory.

## Step 2 — Collect

Two collection passes. Both are capped; caps are limits, not targets.

### 2a. Always include, if present

| Group | Paths |
|---|---|
| Node manifests | `package.json`, `*/package.json`, `*/*/package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json` |
| Python manifests | `requirements*.txt`, `pyproject.toml`, `Pipfile`, `environment.yml` |
| Deploy | `Dockerfile*`, `docker-compose*.y*ml`, `vercel.json`, `netlify.toml`, `Procfile`, `fly.toml`, `railway.json`, `render.yaml`, `serverless.yml`, `k8s/**/*.y*ml`, `.github/workflows/*.y*ml` |
| Framework config | `next.config.*`, `middleware.*`, `nuxt.config.*`, `astro.config.*`, `vite.config.*` |
| Schema | `prisma/schema.prisma`, `drizzle/**/*.ts`, `supabase/**/*.sql`, `migrations/**/*.sql`, `alembic/**/*.py` |
| Env **names only** | `.env`, `.env.*`, `.env.example` — see step 3 |
| Route files by convention | `app/**/route.{ts,tsx,js,jsx}`, `pages/api/**/*.{ts,js}`, `app/**/layout.tsx`, `app/**/page.tsx` |

`app/**/page.tsx` and `layout.tsx` are collected **for their first 20 lines only** —
the scanner needs the `'use client'` directive and the import list to work out what
reaches the browser. Truncate them.

### 2b. Include by content

Search the repo for these patterns and include any file that matches. This is what
keeps the payload small: a 400-file project usually yields 30–60 relevant files.

```
app\.(get|post|put|patch|delete|use|all)\(     # Express / Hono / Fastify
router\.(get|post|put|patch|delete)\(
@(app|router)\.(get|post|put|patch|delete|route)\(   # FastAPI / Flask
createClient|supabase|prisma|drizzle|mongoose|pg\.Pool|psycopg
redis|ioredis|bullmq|celery|rabbitmq|kafka|sqs
anthropic|openai|@ai-sdk|langchain|langgraph|llamaindex|crewai|autogen
pinecone|chromadb|qdrant|weaviate|pgvector|faiss
stripe|resend|nodemailer|twilio|sendgrid|s3|cloudinary
process\.env\.|os\.environ|os\.getenv
'use server'|'use client'
```

### Never include

`node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `out/`, `venv/`, `__pycache__/`,
`coverage/`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`), test
fixtures, `*.min.js`, `*.map`, and any binary or media file.

### Caps

| Limit | Value | On exceeding |
|---|---|---|
| Files | 200 | Keep manifests and deploy config first, then route files, then the rest. Record what you dropped. |
| Total payload | 600 KB after redaction | Same priority order. |
| Per file | 400 lines | Send first 300 and last 100, with `…truncated…` between. Record it. |

Everything dropped or truncated goes in `meta`. The scanner reports coverage to the
user, and a silently partial scan reads as a complete one — which is how a missing
finding becomes a wrong answer.

## Step 3 — Redact, before the payload exists

Run all four rules over every file's content.

**1. Env files: names only.** Never the value. Replace each line with the key and a
shape tag, so the scanner can still reason about what the app expects:

```
BEFORE   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
AFTER    SUPABASE_SERVICE_ROLE_KEY=«redacted len=218 shape=jwt»
```

**2. Hardcoded secrets in source: replace the value, keep the line.** This is the
important one — a key pasted into source *is a finding*, and the finding survives
redaction while the secret does not:

```
BEFORE   const client = new Anthropic({ apiKey: "sk-ant-api03-QYt…" });
AFTER    const client = new Anthropic({ apiKey: "«redacted shape=anthropic-key»" });
```

Patterns to catch: `sk-`, `sk-ant-`, `ghp_`, `gho_`, `github_pat_`, `AKIA`, `ASIA`,
`AIza`, `xox[baprs]-`, `eyJ` (JWT), `-----BEGIN … PRIVATE KEY-----`, and any string
literal over 32 chars that is base64/hex and assigned to a name containing `key`,
`token`, `secret`, `password`, or `dsn`.

**3. Connection strings: keep the shape, drop the credentials.**

```
BEFORE   postgres://admin:hunter2@db.abcdefg.supabase.co:5432/postgres
AFTER    postgres://«user»:«pw»@«host».supabase.co:5432/postgres
```

The host suffix stays because it identifies the provider, which the scanner needs.

**4. Never send** `.pem`, `.key`, `.p12`, `.keystore`, `credentials.json`,
`service-account*.json`, `.npmrc`, `.pypirc`, `.aws/`, `.ssh/` — not even redacted.
List them in `meta.skipped` so the user knows they exist.

After redaction, grep your own payload once for `sk-`, `eyJ`, `AKIA`, `ghp_`. A hit
means rule 2 missed a shape. Fix it and re-check before sending.

## Step 4 — Attach static analysis (optional, best-effort)

Loadbearing does not run these. You run them locally, under the user's own licence,
and attach the SARIF. **Ask the user before running either** — both take minutes and
Semgrep downloads rules on first use. If either fails or is not installed, carry on;
the scan works without them and reports `analyzers: []`.

**Semgrep** — the engine is LGPL-2.1 and free to run:

```bash
semgrep --config auto --sarif --output semgrep.sarif --quiet .
```

**CodeQL** — do **not** run the CLI on a private repo; that needs a commercial
licence. Instead pull existing GitHub code-scanning alerts, which are free on public
repos and included with Advanced Security on private ones:

```bash
gh api "/repos/{owner}/{repo}/code-scanning/analyses" --jq '.[0].id'
gh api "/repos/{owner}/{repo}/code-scanning/analyses/{id}" -H "Accept: application/sarif+json" > codeql.sarif
```

A 403 or 404 means code scanning is not enabled. That is normal and not an error —
say so once and move on.

**Cap SARIF at 400 results per tool**, highest severity first. Strip `codeFlows` and
`relatedLocations`; the scanner uses `ruleId`, `level`, `message.text`, and the
primary `physicalLocation` only.

## Step 5 — Send

Prefer the `scan_repo` MCP tool. Payload:

```jsonc
{
  "projectName": "my-app",            // required — repo directory name
  "sheetId": "…",                     // optional; omit to create a new sheet
  "files": [
    { "path": "app/api/chat/route.ts", "content": "…redacted…" }
  ],
  "sarif": [
    { "tool": "semgrep", "version": "1.x", "results": [ /* SARIF result objects */ ] }
  ],
  "meta": {
    "filesSeen": 412,                 // total files in repo, before filtering
    "filesSent": 47,
    "truncated": ["app/page.tsx"],
    "skipped": ["service-account.json"],
    "dropped": [],                    // dropped for caps — empty is meaningful
    "redactions": 6,
    "analyzers": ["semgrep"]          // omit a tool that did not run
  }
}
```

Paths are **relative to the repo root**, forward slashes, no leading `./`. An absolute
path leaks the user's directory layout and breaks evidence links in the UI.

If the MCP tool is unavailable, POST the same body to `/api/scan` with a bearer token
read from config rather than pasted into a shell command, so it stays out of history:

```js
const token = JSON.parse(readFileSync(CONFIG, 'utf8')).mcpServers.loadbearing.env.LOADBEARING_TOKEN;
await fetch('http://localhost:8787/api/scan', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
```

**Tokens are per database.** A token minted on localhost does not exist in the
deployment's Postgres, and the rejection reads `That API token is not valid — it may
have been revoked`, which is misleading. Confirm which instance the user means before
sending; the same trap is documented in [loadbearing-sheets](../loadbearing-sheets/SKILL.md).

## Step 6 — Verify by reading back

A 201 means the payload parsed, not that the scan is useful. Read the returned
`RepoScan` and check:

| Assert | Else |
|---|---|
| `deployables.length > 0` | no manifest was found — you are probably not at the repo root |
| `endpoints.length > 0` **or** the app genuinely has no HTTP surface | your content-pattern pass missed the route files |
| every `datastores[]` entry has `evidence[]` | something was inferred from a dependency that is imported but unused — fine, but say so |
| `coverage.partial === false` | caps bit; tell the user what was dropped and offer to re-send a narrower slice |

Then report to the user in plain terms: what was found, what was redacted, what was
skipped, and what the scan could not see. **Tell them the redaction count** — people
are right to want to know what left their machine.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `deployables: []` | scanned a subdirectory | find the `.git` root and re-run |
| Endpoints found but `touches: []` everywhere | handler files sent, their imported db/llm modules not | widen the content pass to `lib/`, `utils/`, `services/` |
| Scan says "no HTTP surface" on a Next.js app | `app/**/route.ts` glob missed a `src/app/` layout | check for `src/app/` and `src/pages/` too |
| Payload rejected as too large | lockfile or `.next/` slipped through | re-check the never-include list |
| `analyzers: []` when Semgrep was run | SARIF attached under the wrong key or as a raw file | `sarif[].results` must be the SARIF `results` array, not the whole document |
