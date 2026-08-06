// MCP over HTTP, driven the way a hosted client drives it.
//
// This is the transport that matters for the deployment, and the one with the most
// room to be subtly wrong: stateless means every request builds a fresh Server, and
// the question that decides whether the whole approach works is whether the SDK will
// answer `tools/list` on a Server that has not seen an `initialize` in ITS lifetime.
// It does, and that is asserted here rather than assumed, because if it ever stops
// being true the failure is every tool call on the deployment and nothing local.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-mcp-http-'));
process.env.LOADBEARING_DB = join(dir, 'mcp-http.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

let token = '';
let cookie = '';

const rpc = async (
  body: unknown,
  init: { token?: string | null; path?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const useToken = init.token === undefined ? token : init.token;
  const res = await app.request(init.path ?? '/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(useToken ? { authorization: `Bearer ${useToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
};

const call = async (name: string, args: Record<string, unknown> = {}, path?: string): Promise<string> => {
  const res = await rpc(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
    path ? { path } : {},
  );
  const result = res.body?.result as { content?: { text?: string }[] } | undefined;
  return result?.content?.[0]?.text ?? JSON.stringify(res.body);
};

beforeAll(async () => {
  const registered = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'httpmcp', password: 'a-long-enough-password' }),
  });
  expect(registered.status).toBe(201);
  cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;

  const minted = await app.request('/api/auth/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'a hosted chatbot' }),
  });
  token = ((await minted.json()) as { secret: string }).secret;
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('the handshake', () => {
  it('answers initialize with a protocol version and the tools capability', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    expect(res.status).toBe(200);
    const result = res.body!.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe('loadbearing');
    expect(result.capabilities).toHaveProperty('tools');
    expect(result.protocolVersion).toBeTruthy();
  });

  it('accepts a notification and says nothing back', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // 202 rather than an empty 200 body, which some clients try to parse.
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });

  it('serves tools/list on a Server that never saw an initialize — the whole stateless bet', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    const tools = (res.body!.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain('run_engine');
    expect(tools).toHaveLength(12);
  });

  it('handles a batch, because JSON-RPC allows one', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', id: 10, method: 'tools/list' },
      { jsonrpc: '2.0', id: 11, method: 'tools/list' },
    ]);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown as unknown[]).length).toBe(2);
  });

  it('refuses the event stream instead of holding a connection open forever', async () => {
    const res = await app.request('/api/mcp', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(405);
  });
});

describe('authentication', () => {
  it('turns away a request with no token, and says how to bring one', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { token: null });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toContain('Grader model');
  });

  it('turns away a token that was never issued', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { token: 'lb_nope_nope' });
    expect(res.status).toBe(401);
  });

  it('accepts the token in the path, for clients that cannot set a header', async () => {
    const text = await call('list_sheets', { level: 1 }, `/api/mcp/${token}`);
    expect(text).toContain('## Level 1');
  });

  it('rejects a path token that is not one of ours', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { token: null, path: '/api/mcp/hunter2' });
    expect(res.status).toBe(401);
  });

  it('stops working the moment the token is revoked', async () => {
    const minted = await app.request('/api/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'doomed' }),
    });
    const made = (await minted.json()) as { token: { id: string }; secret: string };

    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { token: made.secret })).status).toBe(200);
    await app.request(`/api/auth/tokens/${made.token.id}`, { method: 'DELETE', headers: { cookie } });
    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { token: made.secret })).status).toBe(401);
  });
});

describe('tools, in-process', () => {
  it('reaches the rest of the API without a socket', async () => {
    const text = await call('list_sheets', { kind: 'lab', level: 6 });
    expect(text).toContain('l6-lab-the-agent-with-root');
  });

  it('acts as the account that owns the token', async () => {
    await call('add_note', {
      scope: 'sheet',
      scopeId: 'l1-read-heavy-product-api',
      title: 'Written over HTTP',
      body: 'by a hosted chatbot',
    });
    const found = await call('search_notes', { query: 'hosted chatbot' });
    expect(found).toContain('Written over HTTP');

    // And through the normal API, as that user, it is there.
    const listed = await app.request('/api/notes?scope=sheet&scopeId=l1-read-heavy-product-api', {
      headers: { cookie },
    });
    expect(((await listed.json()) as { notes: unknown[] }).notes).toHaveLength(1);
  });

  it('runs a whole lab end to end: place, then break it', async () => {
    expect(await call('place_starting_architecture', { sheetId: 'l1-lab-one-box-storefront' })).toContain(
      'Placed the starting architecture',
    );
    const run = await call('run_engine', { sheetId: 'l1-lab-one-box-storefront', scenario: 'host-lost' });
    expect(run).toContain('The box reboots');
    expect(run).toContain('BROKEN');
  });

  it('reports a tool error as content, so a model can act on it', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'get_sheet', arguments: { id: 'no-such-sheet' } },
    });
    const result = res.body!.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No such problem');
  });
});

describe('malformed input', () => {
  it('answers a body that is not JSON with a parse error, not a crash', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: 'not json at all',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Parse error');
  });

  it('answers an unknown method the way JSON-RPC says to', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 9, method: 'nonsense/method' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error');
  });
});
