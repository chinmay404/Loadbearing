// The MCP server, driven the way a client drives it.
//
// Not by calling the handler functions directly — that would test my dispatch table
// and nothing else. This spawns the built server as a child process, speaks the
// stdio protocol at it over a pipe, and points it at a real Loadbearing running in
// the same test. Everything in between is exercised: the framing, the tool schemas,
// the HTTP client, token authentication, and the renderers.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// Run the entry point through tsx: the server workspace is not compiled, and a build
// step before every test run is a cost paid on every unrelated change.
const TSX = join(here, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'loadbearing-mcp-'));
process.env.LOADBEARING_DB = join(dir, 'mcp.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

// The server package is a sibling workspace, so this reaches into its source the
// same way the built binary reaches into its dist.
const { app } = (await import('../app.js')) as { app: { fetch: (req: Request) => Promise<Response> } };

let http: HttpServer;
let baseUrl = '';
let token = '';
let child: ChildProcessWithoutNullStreams;
let nextId = 1;
const pending = new Map<number, (value: unknown) => void>();

/** One JSON-RPC round trip over the child's stdio. */
function call(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value as Record<string, unknown>);
    });
  });
}

/** The text a tool returned, which is what a model would actually see. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = (await call('tools/call', { name, arguments: args })) as {
    result?: { content?: { text?: string }[] };
    error?: { message?: string };
  };
  if (res.error) throw new Error(res.error.message);
  return res.result?.content?.[0]?.text ?? '';
}

beforeAll(async () => {
  // A real socket, because the MCP server is a separate process and cannot be handed
  // an in-memory app object.
  http = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request(`http://localhost${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(body && req.method !== 'GET' ? { body } : {}),
        });
        const answer = await app.fetch(request);
        res.writeHead(answer.status, Object.fromEntries(answer.headers));
        res.end(Buffer.from(await answer.arrayBuffer()));
      })();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  // An account and a token, exactly as a person would make them.
  const registered = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'mcpuser', password: 'a-long-enough-password' }),
  });
  expect(registered.status).toBe(201);
  const cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;

  const minted = await fetch(`${baseUrl}/api/auth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'the test' }),
  });
  token = ((await minted.json()) as { secret: string }).secret;

  child = spawn(process.execPath, [TSX, join(here, 'stdio.ts')], {
    env: { ...process.env, LOADBEARING_URL: baseUrl, LOADBEARING_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let cut: number;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === 'number') pending.get(message.id)?.(message);
    }
  });

  const init = (await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0' },
  })) as { result?: { serverInfo?: { name: string } } };
  expect(init.result?.serverInfo?.name).toBe('loadbearing');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
}, 40000);

afterAll(async () => {
  child?.kill();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('the protocol', () => {
  it('advertises every tool with a schema', async () => {
    const res = (await call('tools/list')) as { result?: { tools?: { name: string; inputSchema: unknown }[] } };
    const tools = res.result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_note',
      'add_sheet',
      'add_trace',
      'get_scan',
      'get_sheet',
      'list_sheets',
      'place_starting_architecture',
      'read_canvas',
      'run_engine',
      'scan_repo',
      'search_notes',
      'write_canvas',
    ]);
    for (const t of tools) expect(t.inputSchema).toHaveProperty('type', 'object');
  });
});

describe('reading the bank', () => {
  it('lists sheets grouped by level, with ids a follow-up call can use', async () => {
    const text = await tool('list_sheets', { level: 1 });
    expect(text).toContain('## Level 1');
    expect(text).toContain('l1-read-heavy-product-api');
    expect(text).not.toContain('## Level 4');
  });

  it('finds labs on their own, and marks them', async () => {
    const text = await tool('list_sheets', { kind: 'lab' });
    expect(text).toContain('[lab]');
    expect(text).toContain('l1-lab-one-box-storefront');
    // A blank sheet is not a lab.
    expect(text).not.toContain('l1-read-heavy-product-api');
  });

  it('searches titles, domains and concepts', async () => {
    expect(await tool('list_sheets', { search: 'shortener' })).toContain('URL Shortener');
    expect(await tool('list_sheets', { search: 'no-such-thing-here' })).toContain('Nothing matches');
  });

  it('gives a full brief, including a lab\'s starting architecture', async () => {
    const text = await tool('get_sheet', { id: 'l1-lab-one-box-storefront' });
    expect(text).toContain('Lab · level 1');
    expect(text).toContain('## Starting architecture');
    expect(text).toContain('App VM');
    expect(text).toContain('Scenarios it must survive');
    // The marking scheme is not handed over.
    expect(text).not.toContain('Watch for');
  });

  it('says so plainly when the sheet does not exist', async () => {
    expect(await tool('get_sheet', { id: 'nonsense' })).toContain('No such problem');
  });
});

describe('the canvas', () => {
  const sheet = 'l1-read-heavy-product-api';

  it('starts empty and says so', async () => {
    expect(await tool('read_canvas', { sheetId: sheet })).toContain('The sheet is empty.');
  });

  it('takes a design, and reads it back as prose', async () => {
    const doc = {
      nodes: [
        {
          id: 'n1',
          type: 'client',
          label: 'Shoppers',
          annotation: '',
          attrs: { trafficRps: 100 },
          position: { x: 0, y: 0 },
        },
        {
          id: 'n2',
          type: 'service',
          label: 'Catalog API',
          annotation: 'Reads product rows.',
          attrs: { replicas: 2, vcpu: 2, latencyMs: 40 },
          position: { x: 200, y: 0 },
        },
        {
          id: 'n3',
          type: 'sql_db',
          label: 'Postgres',
          annotation: '',
          attrs: { latencyMs: 10 },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', kind: 'sync', label: '' },
        { id: 'e2', from: 'n2', to: 'n3', kind: 'sync', label: 'query' },
      ],
      stickies: [],
      strokes: [],
      flows: [
        { id: 'f1', name: 'product read', kind: 'read', steps: ['n1', 'n2', 'n3'], rps: 100, description: '' },
      ],
    };
    const written = await tool('write_canvas', { sheetId: sheet, doc });
    expect(written).toContain('Saved to');
    expect(written).toContain('Catalog API');

    const read = await tool('read_canvas', { sheetId: sheet });
    expect(read).toContain('**Shoppers** `client` (id: n1) — SOURCE of 100 rps');
    expect(read).toContain('Shoppers → Catalog API');
    expect(read).toContain('**product read** [read] 100 rps: Shoppers → Catalog API → Postgres');
  });

  it('hands back raw JSON when asked, so an edit can be round-tripped', async () => {
    const json = await tool('read_canvas', { sheetId: sheet, format: 'json' });
    const parsed = JSON.parse(json) as { nodes: unknown[]; flows: unknown[] };
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.flows).toHaveLength(1);
  });

  it('refuses something that is not a document rather than wiping the sheet', async () => {
    expect(await tool('write_canvas', { sheetId: sheet, doc: { hello: 'there' } })).toContain(
      'not a canvas document',
    );
    // And the real design is untouched.
    expect(await tool('read_canvas', { sheetId: sheet })).toContain('Catalog API');
  });
});

describe('the engine', () => {
  const sheet = 'l1-read-heavy-product-api';

  it('runs over what is drawn and reports where it hurts', async () => {
    const text = await tool('run_engine', { sheetId: sheet });
    expect(text).toContain('## Load run');
    expect(text).toContain('product read');
    expect(text).toContain('### Cost');
  });

  it('runs one of the sheet\'s own scenarios, with its pass criteria stated', async () => {
    const text = await tool('run_engine', { sheetId: sheet, scenario: 'tv-spot-spike' });
    expect(text).toContain('TV spot spike');
    expect(text).toContain('Passes when:');
    // 10x on a two-replica service is not going to be comfortable.
    expect(text).toMatch(/never made it|utilised/);
  });

  it('names the scenarios it has when given one it does not', async () => {
    const text = await tool('run_engine', { sheetId: sheet, scenario: 'not-a-scenario' });
    expect(text).toContain('tv-spot-spike');
  });

  it('takes a component offline by label', async () => {
    const text = await tool('run_engine', { sheetId: sheet, kill: ['Postgres'] });
    expect(text).toContain('BROKEN');
  });

  it('says when a kill matched nothing, instead of silently running unchanged', async () => {
    const text = await tool('run_engine', { sheetId: sheet, kill: ['Cassandra'] });
    expect(text).toContain('Nothing on this sheet is called "Cassandra"');
  });

  it('explains an empty sheet rather than reporting a healthy system', async () => {
    const text = await tool('run_engine', { sheetId: 'l1-image-upload-service' });
    expect(text).toContain('Nothing is drawn');
  });
});

describe('a lab through the API alone', () => {
  const lab = 'l1-lab-one-box-storefront';

  it('starts empty, and says the architecture is there to be placed', async () => {
    // The browser places it on first open. Nothing outside a browser does, and a
    // caller told only "nothing is drawn" would reasonably conclude the lab is broken.
    const text = await tool('run_engine', { sheetId: lab });
    expect(text).toContain('place_starting_architecture');
  });

  it('places it, and the drawing matches the picture in the brief', async () => {
    const placed = await tool('place_starting_architecture', { sheetId: lab });
    expect(placed).toContain('Placed the starting architecture');
    expect(placed).toContain('App VM');
    expect(placed).toContain('Shoppers → DNS');

    const read = await tool('read_canvas', { sheetId: lab });
    expect(read).toContain('SOURCE of 900 rps');
    expect(read).toContain('**product browse**');
  });

  it('then fails its own gates, which is the whole exercise', async () => {
    const text = await tool('run_engine', { sheetId: lab, scenario: 'host-lost' });
    expect(text).toContain('The box reboots');
    expect(text).toContain('BROKEN');
  });

  it('refuses to overwrite a sheet that has been worked on', async () => {
    const again = await tool('place_starting_architecture', { sheetId: lab });
    expect(again).toContain('already has');
    expect(again).toContain('nothing was placed');
  });

  it('says so when the sheet is not a lab at all', async () => {
    const text = await tool('place_starting_architecture', { sheetId: 'l1-image-upload-service' });
    expect(text).toContain('blank sheet');
  });
});

describe('adding a sheet', () => {
  const problem = {
    id: 'l3-agent-authored',
    title: 'Something An Agent Wrote',
    level: 3,
    domain: 'devtools',
    prompt:
      'A long enough prompt to clear the validator, describing a system with real numbers and a real constraint that makes the interesting decision hard.',
    functional: ['Do the thing', 'Do the other thing', 'Report on both'],
    nonFunctional: { peakRps: 500, p99Ms: 200, availability: '99.9%' },
    constraints: ['Small team', 'No new datastore'],
    concepts: ['caching', 'idempotency', 'timeout-retry', 'observability'],
    expectedFlows: ['the read', 'the write'],
    rubricHints: 'Watch for a design that adds a cache with no invalidation path and calls the problem solved.',
    twists: ['Traffic triples', 'The dependency gets slower'],
    scenarios: [
      { id: 's1', name: 'Spike', description: 'Ten times the load', rpsMultiplier: 10, passCriteria: 'Stays up' },
      { id: 's2', name: 'Loss', description: 'The cache goes', rpsMultiplier: 1, passCriteria: 'Degrades' },
    ],
  };

  it('accepts a well-formed problem and puts it in the bank', async () => {
    expect(await tool('add_sheet', { problem })).toContain('l3-agent-authored');
    expect(await tool('list_sheets', { search: 'agent wrote' })).toContain('[yours]');
    expect(await tool('get_sheet', { id: 'l3-agent-authored' })).toContain('Something An Agent Wrote');
  });

  it('never overwrites: the same id twice makes a second sheet', async () => {
    const again = await tool('add_sheet', { problem });
    expect(again).toContain('l3-agent-authored-');
  });

  it('rejects a problem that is missing its substance, and says what is missing', async () => {
    const text = await tool('add_sheet', { problem: { id: 'x', level: 2, prompt: 'too short' } });
    expect(text).toContain('not a usable problem');
    expect(text).toMatch(/prompt too short|no valid concept/);
  });
});

describe('notes', () => {
  it('writes one and finds it again', async () => {
    expect(await tool('add_note', {
      scope: 'sheet',
      scopeId: 'l1-read-heavy-product-api',
      title: 'Cache key must include region',
      body: 'Otherwise an EU shopper sees a US price.',
    })).toContain('Written to sheet');

    const found = await tool('search_notes', { query: 'region' });
    expect(found).toContain('Cache key must include region');
    expect(found).toContain('Read-Heavy Product Catalog API');
  });

  it('says nothing matches rather than returning everything', async () => {
    expect(await tool('search_notes', { query: 'zzzz' })).toContain('Nothing matches');
  });
});

describe('when things are wrong', () => {
  it('reports an unreachable server as unreachable, not as a bad request', async () => {
    const lost = spawn(process.execPath, [TSX, join(here, 'stdio.ts')], {
      env: { ...process.env, LOADBEARING_URL: 'http://127.0.0.1:1', LOADBEARING_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const text = await new Promise<string>((resolve) => {
      let buffer = '';
      lost.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split('\n')) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { id?: number; result?: { content?: { text?: string }[] } };
          if (message.id === 2) resolve(message.result?.content?.[0]?.text ?? '');
        }
      });
      lost.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'v', version: '0' } } })}\n`,
      );
      lost.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_sheets', arguments: {} } })}\n`,
      );
    });
    lost.kill();
    expect(text).toContain('Cannot reach Loadbearing');
  }, 20000);

  it('refuses to start without a token, rather than failing on every call', async () => {
    const naked = spawn(process.execPath, [TSX, join(here, 'stdio.ts')], {
      env: { ...process.env, LOADBEARING_URL: baseUrl, LOADBEARING_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    let stderr = '';
    naked.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const code = await new Promise<number>((resolve) => naked.on('exit', (c) => resolve(c ?? 0)));
    expect(code).toBe(1);
    expect(stderr).toContain('LOADBEARING_TOKEN');
  }, 20000);

  it('rejects a revoked token the moment it is revoked', async () => {
    // A second server holding a token that is about to stop existing.
    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'revokee', password: 'a-long-enough-password' }),
    });
    const cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;
    const minted = await fetch(`${baseUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'doomed' }),
    });
    const made = (await minted.json()) as { token: { id: string }; secret: string };

    const ok = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${made.secret}` } });
    expect(ok.status).toBe(200);

    await fetch(`${baseUrl}/api/auth/tokens/${made.token.id}`, { method: 'DELETE', headers: { cookie } });
    const after = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${made.secret}` } });
    expect(after.status).toBe(401);
  });
});

// Scanning a repository, driven the way an agent drives it.
//
// The interesting assertions are not "did it parse" but the two promises the
// feature makes to somebody handing over private source: that a live credential is
// refused before it is sent anywhere, and that what comes back is checkable.
describe('scanning a repository', () => {
  const VIBE_APP = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'nightly',
        scripts: { dev: 'next dev' },
        dependencies: { next: '^15.0.0', '@supabase/supabase-js': '^2.45.0', '@anthropic-ai/sdk': '^0.30.0' },
      }),
    },
    { path: 'vercel.json', content: '{}' },
    {
      path: 'app/api/chat/route.ts',
      content: [
        "import Anthropic from '@anthropic-ai/sdk';",
        "import { db } from '@/lib/db';",
        '',
        'export async function POST(req: Request) {',
        "  await db.from('messages').insert({});",
        '  return Response.json({});',
        '}',
      ].join('\n'),
    },
    {
      path: 'lib/db.ts',
      content: [
        "import { createClient } from '@supabase/supabase-js';",
        'export const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);',
      ].join('\n'),
    },
    {
      path: 'components/Chat.tsx',
      content: ["'use client';", "import { db } from '../lib/db';", 'export const Chat = () => null;'].join('\n'),
    },
  ];

  it('refuses to send a payload that still holds a live key, and sends nothing', async () => {
    const text = await tool('scan_repo', {
      projectName: 'leaky',
      files: [
        { path: 'lib/x.ts', content: 'const key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";' },
      ],
    });
    expect(text).toContain('Refusing to send');
    expect(text).toContain('anthropic-key');
    expect(text).toContain('Nothing has been sent');

    // And it really did not store anything: the scan list is still empty.
    expect(await tool('get_scan')).toContain('No repositories have been scanned');
  });

  it('reports what the repository contains, with a file and line for each claim', async () => {
    const text = await tool('scan_repo', { projectName: 'nightly', files: VIBE_APP });
    expect(text).toContain('static+functions');
    expect(text).toContain('POST /api/chat');
    expect(text).toContain('app/api/chat/route.ts:');
    expect(text).toContain('Supabase Postgres');
    expect(text).toContain('Anthropic API');
  });

  it('names the leak and prints the chain that proves it', async () => {
    const text = await tool('scan_repo', { projectName: 'nightly', files: VIBE_APP });
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY can reach the browser');
    expect(text).toContain('Chain: components/Chat.tsx → lib/db.ts');
  });

  it('keeps the scan, and lists it afterwards', async () => {
    const text = await tool('scan_repo', { projectName: 'nightly', files: VIBE_APP });
    const id = /Scan id: `([^`]+)`/.exec(text)?.[1];
    expect(id).toBeTruthy();
    expect(await tool('get_scan', { id })).toContain('POST /api/chat');
    expect(await tool('get_scan')).toContain('nightly');
  });

  it('turns a trace into measured service times', async () => {
    const scanText = await tool('scan_repo', { projectName: 'nightly', files: VIBE_APP });
    const id = /Scan id: `([^`]+)`/.exec(scanText)?.[1]!;
    const spans = [
      {
        traceId: 't1',
        spanId: 's1',
        name: 'POST /api/chat',
        kind: 'SERVER',
        durationMs: 2500,
        attributes: { 'http.route': '/api/chat', 'http.request.method': 'POST' },
      },
      {
        traceId: 't1',
        spanId: 's2',
        parentSpanId: 's1',
        name: 'POST',
        kind: 'CLIENT',
        durationMs: 2400,
        attributes: { 'server.address': 'api.anthropic.com' },
      },
    ];
    const text = await tool('add_trace', { scanId: id, spans });
    expect(text).toContain('api.anthropic.com');
    expect(text).toContain('p95 2400ms');
    expect(text).toContain('→');
  });

  it('says plainly when there is nothing to scan', async () => {
    expect(await tool('scan_repo', { files: [] })).toContain('No files were sent');
  });
});
