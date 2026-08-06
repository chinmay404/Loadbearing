import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanFiles } from './index.js';
import { blankNoise, fileSource, clientReachable } from './source.js';
import { nextAppPath, nextPagesPath } from './endpoints.js';
import { lookupDep } from './deps.js';
import { composeServiceNames } from './manifests.js';
import { exposuresFromSarif } from './sarif.js';
import { summariseTrace, parseSpans } from './trace.js';
import { inventory, candidateFlows, nodeFromInventory } from './inventory.js';
import { checkAgainstCode, scanFactsForGrader } from './divergence.js';
import type { GraphDSL } from '../types.js';

// ---------------------------------------------------------------- fixtures ---
//
// Four repositories that stand for the four shapes people actually bring: a
// Lovable-style Next.js app with a leak in it, a Python AI toy, an Express
// monolith, and a compose file with real services in it. Each one is asserted
// exactly, because the value of this scanner is entirely in whether its answers
// are right, and "it returned something" is not an assertion.

const NEXT_VIBE_APP = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'my-chat-app',
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        '@supabase/supabase-js': '^2.45.0',
        '@anthropic-ai/sdk': '^0.30.0',
      },
    }),
  },
  { path: 'vercel.json', content: '{"framework":"nextjs"}' },
  {
    path: 'app/api/chat/route.ts',
    content: `import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { message } = await req.json();
  const reply = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 1024, messages: [{ role: 'user', content: message }] });
  await db.from('messages').insert({ body: message });
  return Response.json({ reply });
}
`,
  },
  {
    path: 'lib/db.ts',
    content: `import { createClient } from '@supabase/supabase-js';

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
`,
  },
  {
    path: 'components/Chat.tsx',
    content: `'use client';
import { db } from '../lib/db';

export function Chat() {
  return <div onClick={() => db.from('messages').select()}>chat</div>;
}
`,
  },
  {
    path: '.env',
    content: `NEXT_PUBLIC_SUPABASE_URL=«redacted len=41 shape=url»
SUPABASE_SERVICE_ROLE_KEY=«redacted len=218 shape=jwt»
ANTHROPIC_API_KEY=«redacted len=108 shape=anthropic-key»
`,
  },
];

const PY_AGENT_APP = [
  {
    path: 'requirements.txt',
    content: `fastapi==0.115.0
uvicorn
langgraph>=0.2
openai
chromadb
`,
  },
  {
    path: 'main.py',
    content: `from fastapi import FastAPI, Depends
from langgraph.graph import StateGraph
import openai
import chromadb

app = FastAPI()

@app.post("/ask")
async def ask(q: str):
    # app.get("/not-a-route") in a comment must not become an endpoint
    return {"answer": q}

@app.get("/healthz")
async def healthz():
    return {"ok": True}
`,
  },
];

const EXPRESS_MONOLITH = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'orders-api',
      scripts: { start: 'node src/server.js' },
      dependencies: { express: '^4.19.0', pg: '^8.12.0', ioredis: '^5.4.0', bullmq: '^5.0.0' },
    }),
  },
  {
    path: 'src/server.js',
    content: `const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { Queue } = require('bullmq');

const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/orders', async (req, res) => {
  res.json({ id: 1 });
});
app.get('/orders/:id', async (req, res) => res.json({}));
`,
  },
  { path: '.gitignore', content: 'node_modules\n.env\n' },
];

const COMPOSE_SERVICES = [
  {
    path: 'docker-compose.yml',
    content: `version: "3.9"
services:
  api:
    build:
      context: ./api
    ports:
      - "8080:8080"
  worker:
    build:
      context: ./worker
  db:
    image: postgres:16
  cache:
    image: redis:7
`,
  },
  {
    path: 'api/package.json',
    content: JSON.stringify({ name: 'api', scripts: { start: 'node index.js' }, dependencies: { hono: '^4.0.0' } }),
  },
  {
    path: 'worker/package.json',
    content: JSON.stringify({ name: 'worker', scripts: { start: 'node worker.js' }, dependencies: { bullmq: '^5.0.0' } }),
  },
];

// --------------------------------------------------------------- unit level ---

describe('blankNoise', () => {
  it('removes comments but keeps string literals, because the literal is the answer', () => {
    const out = blankNoise(`// app.get('/ghost')\napp.get('/real');`);
    expect(out).not.toContain('/ghost');
    expect(out).toContain("'/real'");
  });

  it('does not treat a # inside a string as the start of a comment', () => {
    const out = blankNoise(`const anchor = "#top"; const x = 1;`);
    expect(out).toContain('#top');
    expect(out).toContain('const x = 1');
  });

  it('preserves line numbers so evidence points at the right line', () => {
    const src = `/* one\n two\n three */\nconst x = 1;`;
    expect(blankNoise(src).split('\n')).toHaveLength(4);
  });
});

describe('next.js path conventions', () => {
  it('reads a route directory as a URL', () => {
    expect(nextAppPath('app/api/chat/')).toBe('/api/chat');
    expect(nextAppPath('src/app/api/users/[id]/')).toBe('/api/users/:id');
  });

  it('drops route groups, which organise files without appearing in the URL', () => {
    expect(nextAppPath('app/(marketing)/api/lead/')).toBe('/api/lead');
  });

  it('collapses catch-all segments', () => {
    expect(nextAppPath('app/api/proxy/[...path]/')).toBe('/api/proxy/*');
  });

  it('drops the index segment in the pages router', () => {
    expect(nextPagesPath('pages/api/users/index')).toBe('/api/users');
    expect(nextPagesPath('pages/api/users/[id]')).toBe('/api/users/:id');
  });
});

describe('dependency table', () => {
  it('prefers the longest match so a scoped SDK is not shadowed', () => {
    expect(lookupDep('@ai-sdk/anthropic', 'node')?.nodeType).toBe('llm');
  });

  it('keeps ecosystems apart', () => {
    expect(lookupDep('celery', 'node')).toBeNull();
    expect(lookupDep('celery', 'python')?.nodeType).toBe('queue');
  });

  it('prefers an exact match over a prefix', () => {
    expect(lookupDep('redis', 'node')?.label).toBe('Redis');
  });
});

describe('compose parsing', () => {
  it('names every service and reads its image and build context', () => {
    const services = composeServiceNames(COMPOSE_SERVICES[0]!.content);
    expect(services.map((s) => s.name)).toEqual(['api', 'worker', 'db', 'cache']);
    expect(services.find((s) => s.name === 'db')?.image).toBe('postgres:16');
    expect(services.find((s) => s.name === 'api')?.context).toBe('api');
  });
});

describe('client reachability', () => {
  it('finds the chain from a client component to the module holding a secret', () => {
    const reach = clientReachable(fileSource(NEXT_VIBE_APP));
    expect(reach.has('lib/db.ts')).toBe(true);
    expect(reach.get('lib/db.ts')).toEqual(['components/Chat.tsx', 'lib/db.ts']);
  });

  it('never treats a route handler as client code', () => {
    const reach = clientReachable(fileSource(NEXT_VIBE_APP));
    expect(reach.has('app/api/chat/route.ts')).toBe(false);
  });
});

// ------------------------------------------------------------ whole repos ---

describe('a Next.js app of the kind people vibe-code', () => {
  const scan = scanFiles(NEXT_VIBE_APP, { projectName: 'my-chat-app', now: '2026-01-01T00:00:00.000Z' });

  it('calls it static pages plus functions rather than a monolith', () => {
    expect(scan.shape.verdict).toBe('static+functions');
  });

  it('reads the endpoint off the filesystem, so it is observed and not guessed', () => {
    const chat = scan.endpoints.find((e) => e.path === '/api/chat');
    expect(chat?.method).toBe('POST');
    expect(chat?.confidence).toBe('observed');
    expect(chat?.evidence.file).toBe('app/api/chat/route.ts');
  });

  it('sees that the handler has no sign-in check', () => {
    expect(scan.endpoints.find((e) => e.path === '/api/chat')?.authGuard).toBe('none');
  });

  it('knows what the handler reaches, one import hop out', () => {
    const chat = scan.endpoints.find((e) => e.path === '/api/chat');
    const reached = chat!.touches.map((t) => [...scan.datastores, ...scan.ai].find((d) => d.id === t)?.nodeType);
    expect(reached).toContain('llm');
    expect(reached).toContain('sql_db');
  });

  it('finds the service-role key reaching the browser, and proves it with the chain', () => {
    const leak = scan.exposures.find((e) => e.rule === 'secret-reaches-client');
    expect(leak).toBeDefined();
    expect(leak?.severity).toBe('critical');
    expect(leak?.title).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // The proof is the point. A reachability finding without a chain is a rumour.
    expect(leak?.path).toEqual(['components/Chat.tsx', 'lib/db.ts']);
  });

  it('does not accuse the public Supabase URL of being a secret', () => {
    expect(scan.exposures.some((e) => e.title.includes('NEXT_PUBLIC_SUPABASE_URL'))).toBe(false);
  });

  it('warns that nothing caps what the model calls can cost', () => {
    expect(scan.exposures.some((e) => e.rule === 'llm-without-ceiling')).toBe(true);
  });

  it('notices the unguarded endpoint reaching a model, and rates it critical', () => {
    const finding = scan.exposures.find((e) => e.rule === 'unguarded-endpoint');
    expect(finding?.severity).toBe('critical');
    // Middleware this pass cannot attribute to a route means it stays a question.
    expect(finding?.confidence).toBe('inferred');
  });

  it('notices .env is not gitignored', () => {
    expect(scan.exposures.some((e) => e.rule === 'env-file-committed')).toBe(true);
  });

  it('asks about row-level security, because Supabase reaches the browser directly', () => {
    expect(scan.exposures.some((e) => e.rule === 'no-rls-found')).toBe(true);
  });

  it('sorts the critical findings to the top', () => {
    expect(scan.exposures[0]?.severity).toBe('critical');
  });

  it('is reproducible: the same input gives byte-identical output', () => {
    const again = scanFiles(NEXT_VIBE_APP, { projectName: 'my-chat-app', now: '2026-01-01T00:00:00.000Z' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(scan));
  });
});

describe('a Python AI app', () => {
  const scan = scanFiles(PY_AGENT_APP, { now: '2026-01-01T00:00:00.000Z' });

  it('finds both decorated routes', () => {
    expect(scan.endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual(['GET /healthz', 'POST /ask']);
  });

  it('marks Python routes inferred, because line shape is not the filesystem', () => {
    expect(scan.endpoints.every((e) => e.confidence === 'inferred')).toBe(true);
  });

  it('does not invent an endpoint from a route written inside a comment', () => {
    expect(scan.endpoints.some((e) => e.path === '/not-a-route')).toBe(false);
  });

  it('recognises the agent runtime, the model and the vector store', () => {
    const types = scan.ai.map((a) => a.nodeType).sort();
    expect(types).toContain('agent_runtime');
    expect(types).toContain('llm');
    expect(types).toContain('vector_db');
  });

  it('says out loud that some endpoints were matched by shape', () => {
    expect(scan.coverage.notes.some((n) => n.includes('line shape'))).toBe(true);
  });
});

describe('an Express monolith', () => {
  const scan = scanFiles(EXPRESS_MONOLITH, { now: '2026-01-01T00:00:00.000Z' });

  it('calls one deployable serving many routes a monolith', () => {
    expect(scan.shape.verdict).toBe('monolith');
    expect(scan.shape.why).toContain('same process');
  });

  it('finds every registered route', () => {
    expect(scan.endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'GET /health',
      'GET /orders/:id',
      'POST /orders',
    ]);
  });

  it('implies a worker from the queue, and marks it inferred', () => {
    const worker = scan.externals.find((d) => d.nodeType === 'worker');
    expect(worker).toBeDefined();
    expect(worker?.confidence).toBe('inferred');
  });

  it('does not raise the committed-env finding when .gitignore covers it', () => {
    expect(scan.exposures.some((e) => e.rule === 'env-file-committed')).toBe(false);
  });
});

describe('a compose file with real services', () => {
  const scan = scanFiles(COMPOSE_SERVICES, { now: '2026-01-01T00:00:00.000Z' });

  it('counts the services people wrote, not the databases they rented', () => {
    expect(scan.shape.verdict).toBe('services');
    const names = scan.deployables.map((d) => d.name).sort();
    expect(names).toContain('api');
    expect(names).toContain('worker');
    expect(names).not.toContain('db');
    expect(names).not.toContain('cache');
  });
});

// -------------------------------------------------------------------- SARIF ---

describe('SARIF ingest', () => {
  const semgrep = {
    tool: 'semgrep',
    results: [
      {
        ruleId: 'javascript.lang.security.audit.hardcoded-secret',
        level: 'warning',
        message: { text: 'Hardcoded credential detected.' },
        locations: [
          { physicalLocation: { artifactLocation: { uri: './lib/db.ts' }, region: { startLine: 4 } } },
        ],
      },
      {
        ruleId: 'javascript.lang.correctness.unused-var',
        level: 'note',
        message: { text: 'Unused variable.' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'app/page.tsx' }, region: { startLine: 9 } } }],
      },
    ],
  };

  it('promotes a hardcoded credential above whatever level the tool assigned', () => {
    const [first] = exposuresFromSarif([semgrep]);
    expect(first?.severity).toBe('critical');
    expect(first?.source).toBe('semgrep');
  });

  it('normalises paths so evidence links resolve', () => {
    const [first] = exposuresFromSarif([semgrep]);
    expect(first?.evidence[0]?.file).toBe('lib/db.ts');
  });

  it('honours CodeQL security-severity when it is present', () => {
    const [only] = exposuresFromSarif([
      {
        tool: 'codeql',
        results: [
          {
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'Query built from user input.' },
            properties: { 'security-severity': '9.8' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 1 } } }],
          },
        ],
      },
    ]);
    expect(only?.severity).toBe('critical');
    expect(only?.source).toBe('codeql');
  });

  it('never presents somebody else\'s static analysis as observed fact', () => {
    expect(exposuresFromSarif([semgrep]).every((e) => e.confidence === 'inferred')).toBe(true);
  });

  it('collapses the same finding reported twice', () => {
    const doubled = exposuresFromSarif([semgrep, { ...semgrep, tool: 'semgrep' }]);
    expect(doubled).toHaveLength(2);
  });

  it('folds analyzer findings into the scan and records who ran', () => {
    const scan = scanFiles(NEXT_VIBE_APP, { sarif: [semgrep], now: '2026-01-01T00:00:00.000Z' });
    expect(scan.coverage.analyzers).toEqual(['semgrep']);
    expect(scan.exposures.some((e) => e.source === 'semgrep')).toBe(true);
  });
});

// ------------------------------------------------------------------- traces ---

describe('trace ingest', () => {
  const spans = [
    {
      traceId: 't1',
      spanId: 's1',
      name: 'POST /api/chat',
      kind: 'SERVER',
      duration: [2, 500_000_000],
      attributes: { 'http.request.method': 'POST', 'http.route': '/api/chat' },
    },
    {
      traceId: 't1',
      spanId: 's2',
      parentSpanId: 's1',
      name: 'POST',
      kind: 'CLIENT',
      duration: [2, 400_000_000],
      attributes: { 'server.address': 'api.anthropic.com' },
    },
    {
      traceId: 't1',
      spanId: 's3',
      parentSpanId: 's1',
      name: 'pg.query',
      kind: 'CLIENT',
      duration: [0, 12_000_000],
      attributes: { 'db.system': 'postgresql' },
    },
  ];

  it('parses the console exporter\'s seconds-and-nanos duration', () => {
    const parsed = parseSpans(spans);
    expect(parsed[0]?.durationMs).toBeCloseTo(2500, 0);
  });

  it('reads JSON Lines, which is what a file exporter writes', () => {
    const jsonl = spans.map((s) => JSON.stringify(s)).join('\n');
    expect(parseSpans(jsonl)).toHaveLength(3);
  });

  it('reads OTLP nesting too', () => {
    const otlp = { resourceSpans: [{ scopeSpans: [{ spans }] }] };
    expect(parseSpans(otlp)).toHaveLength(3);
  });

  it('names the third party rather than collapsing every outbound call into one box', () => {
    const summary = summariseTrace(spans);
    const llm = summary.components.find((c) => c.nodeType === 'llm');
    expect(llm?.ref).toBe('http:api.anthropic.com');
    expect(llm?.p95Ms).toBeCloseTo(2400, 0);
  });

  it('turns one trace into one request path, entry first', () => {
    const summary = summariseTrace(spans);
    expect(summary.flows[0]?.steps).toEqual([
      'client',
      'http:POST /api/chat',
      'http:api.anthropic.com',
      'db:postgresql',
    ]);
    expect(summary.flows[0]?.kind).toBe('write');
  });

  it('says so when nothing downstream was instrumented', () => {
    const summary = summariseTrace([spans[0]]);
    expect(summary.notes.some((n) => n.includes('single span'))).toBe(true);
  });
});

// ---------------------------------------------------------------- inventory ---

describe('the code view', () => {
  const scan = scanFiles(NEXT_VIBE_APP, { now: '2026-01-01T00:00:00.000Z' });
  const items = inventory(scan);

  it('offers the parts the repo has', () => {
    expect(items.some((i) => i.group === 'data' && i.label.includes('Supabase'))).toBe(true);
    expect(items.some((i) => i.group === 'ai' && i.label.includes('Anthropic'))).toBe(true);
  });

  it('offers nothing the repo does not have, because that is the design', () => {
    const types = items.map((i) => i.node?.type).filter(Boolean);
    for (const absent of ['load_balancer', 'cache', 'queue', 'guardrail', 'cdn', 'rate_limiter']) {
      expect(types).not.toContain(absent);
    }
  });

  it('drags out a node that already carries its mechanism, so it does not start life unannotated', () => {
    const supabase = items.find((i) => i.group === 'data')!;
    const node = nodeFromInventory(supabase)!;
    expect(node.type).toBe('sql_db');
    expect(node.annotation.length).toBeGreaterThan(10);
  });

  it('suggests flows without declaring them', () => {
    const candidates = candidateFlows(scan);
    expect(candidates[0]?.origin).toBe('static');
    // Steps stay empty until a human maps refs onto their own node ids.
    expect(candidates[0]?.steps).toEqual([]);
    expect(candidates[0]?.description).toContain('confirm');
  });

  it('prefers measured flows over guessed ones when a trace exists', () => {
    const trace = summariseTrace([
      { traceId: 't', spanId: 'a', name: 'GET /x', kind: 'SERVER', durationMs: 10, attributes: { 'http.route': '/x', 'http.request.method': 'GET' } },
    ]);
    expect(candidateFlows(scan, trace)[0]?.origin).toBe('trace');
  });
});

// --------------------------------------------------------------- divergence ---

describe('code versus drawing', () => {
  const scan = scanFiles(NEXT_VIBE_APP, { now: '2026-01-01T00:00:00.000Z' });
  const llmId = scan.ai.find((a) => a.nodeType === 'llm')!.id;

  const graph: GraphDSL = {
    nodes: [
      { id: 'api', type: 'serverless_fn', label: 'API', annotation: 'route handlers' },
      { id: 'q', type: 'queue', label: 'Job queue', annotation: 'buffers model work' },
      { id: 'llm', type: 'llm', label: 'Anthropic', annotation: 'claude' },
    ],
    edges: [
      { id: 'e1', from: 'api', to: 'q', kind: 'async', label: 'enqueue' },
      { id: 'e2', from: 'q', to: 'llm', kind: 'async', label: 'consume' },
    ],
    stickies: [],
    flows: [],
  };

  it('says nothing at all when nothing is bound', () => {
    expect(checkAgainstCode({ graph, scan, bindings: [] })).toEqual([]);
  });

  it('catches a queue on the diagram that the code does not go through', () => {
    const findings = checkAgainstCode({
      graph,
      scan,
      bindings: [{ codeRef: `component:${llmId}`, nodeId: 'llm', source: 'static' }],
    });
    const drift = findings.find((f) => f.rule === 'drawn-async-called-sync');
    expect(drift?.severity).toBe('error');
    expect(drift?.message).toContain('waits');
    expect(drift?.nodeIds).toEqual(['llm']);
  });

  it('catches a measured latency the drawing disproves', () => {
    const trace = summariseTrace([
      {
        traceId: 't1',
        spanId: 's1',
        name: 'anthropic',
        kind: 'CLIENT',
        durationMs: 2400,
        attributes: { 'server.address': 'api.anthropic.com' },
      },
    ]);
    const drawn: GraphDSL = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'llm' ? { ...n, attrs: { latencyMs: 50 } } : n)),
    };
    const findings = checkAgainstCode({
      graph: drawn,
      scan,
      trace,
      bindings: [{ codeRef: 'trace:http:api.anthropic.com', nodeId: 'llm', source: 'trace' }],
    });
    expect(findings.some((f) => f.rule === 'measured-slower-than-drawn')).toBe(true);
  });

  it('hands the grader facts and their limits, not prose', () => {
    const facts = scanFactsForGrader(scan, [{ codeRef: 'x', nodeId: 'llm', source: 'static' }]);
    expect(facts).toContain('static+functions');
    expect(facts).toContain('must treat as established');
    expect(facts).toContain('Limits of this scan');
  });
});

// ------------------------------------------------------------- dogfooding ---
//
// The scanner is pointed at Loadbearing itself. A fixture can be quietly shaped to
// pass; this repository cannot, so this is the test that fails when the scanner
// drifts away from reality.

describe('scanning Loadbearing itself', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '..', '..', '..');
  const wanted = [
    'package.json',
    'server/package.json',
    'shared/package.json',
    'client/package.json',
    'vercel.json',
    'server/src/app.ts',
    'server/src/designs/routes.ts',
    'server/src/notes/routes.ts',
  ];
  const files = wanted
    .filter((p) => existsSync(join(repoRoot, p)))
    .map((p) => ({ path: p, content: readFileSync(join(repoRoot, p), 'utf8') }));

  const available = files.length >= 4;

  it.runIf(available)('finds the server and does not count the shared library as deployable', () => {
    const scan = scanFiles(files, { now: '2026-01-01T00:00:00.000Z' });
    expect(scan.deployables.some((d) => d.root === 'server')).toBe(true);
    expect(scan.deployables.some((d) => d.root === 'shared')).toBe(false);
  });

  it.runIf(available)('finds the Hono routes this app really serves', () => {
    const scan = scanFiles(files, { now: '2026-01-01T00:00:00.000Z' });
    const paths = scan.endpoints.map((e) => e.path);
    expect(paths).toContain('/api/health');
    expect(paths.some((p) => p.startsWith('/designs'))).toBe(true);
  });
});
