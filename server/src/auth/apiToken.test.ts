// API tokens: minting, presenting, and revoking.
//
// The security-relevant claims are all negative — a revoked token stops working, a
// token cannot read another account, a near-miss secret is not "close enough" — so
// they are what this mostly asserts. The rest is that a token is a full substitute
// for a session on every route, because a half-authenticated caller is worse than
// an unauthenticated one.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-tokens-'));
process.env.LOADBEARING_DB = join(dir, 'tokens.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');
const { mintToken, parseToken, looksLikeApiToken } = await import('./apiToken.js');

let cookie = '';
let otherCookie = '';

const signUp = async (username: string) => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-long-enough-password' }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
};

const mint = async (name: string, as = cookie): Promise<{ id: string; secret: string }> => {
  const res = await app.request('/api/auth/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: { id: string }; secret: string };
  return { id: body.token.id, secret: body.secret };
};

/** As an agent would: bearer header, no cookie anywhere. */
const asToken = (secret: string) => ({ authorization: `Bearer ${secret}` });

beforeAll(async () => {
  cookie = await signUp('tokenowner');
  otherCookie = await signUp('tokenstranger');
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('minting', () => {
  it('produces a prefixed, three-part token that parses back', () => {
    const minted = mintToken();
    expect(minted.secret.startsWith('lb_')).toBe(true);
    expect(looksLikeApiToken(minted.secret)).toBe(true);
    const parsed = parseToken(minted.secret)!;
    expect(parsed.id).toBe(minted.id);
    expect(parsed.secret.length).toBeGreaterThan(20);
  });

  it('never produces the same token twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintToken().secret));
    expect(seen.size).toBe(200);
  });

  it('refuses anything malformed rather than guessing at it', () => {
    for (const junk of ['', 'lb_', 'lb_only-two', 'nope_a_b', 'lb_a_b_c', 'a'.repeat(60)]) {
      expect(parseToken(junk)).toBeNull();
    }
  });

  it('wants a name, because revoking the right one later depends on it', async () => {
    const res = await app.request('/api/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('shows the secret once and never again', async () => {
    const { id, secret } = await mint('Claude Desktop');
    expect(secret).toContain(id);

    const listed = await app.request('/api/auth/tokens', { headers: { cookie } });
    const { tokens } = (await listed.json()) as { tokens: { id: string; name: string }[] };
    const mine = tokens.find((t) => t.id === id)!;
    expect(mine.name).toBe('Claude Desktop');
    // Not the secret, not the hash, not a fragment of either.
    expect(JSON.stringify(mine)).not.toContain(secret.split('_')[2]);
  });
});

describe('presenting a token', () => {
  it('is a full substitute for a session, with no cookie at all', async () => {
    const { secret } = await mint('agent');
    const me = await app.request('/api/auth/me', { headers: asToken(secret) });
    expect(me.status).toBe(200);
    expect((await me.json()) as { username: string }).toEqual({ username: 'tokenowner' });

    // And on a route that reads real data, not just the session.
    const notes = await app.request('/api/notes?scope=sheet&scopeId=x', { headers: asToken(secret) });
    expect(notes.status).toBe(200);
  });

  it('acts as its owner and nobody else', async () => {
    const { secret } = await mint('agent-2');
    await app.request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...asToken(secret) },
      body: JSON.stringify({ scope: 'sheet', scopeId: 'shared-id', title: 'From the agent', body: '' }),
    });

    const mine = await app.request('/api/notes?scope=sheet&scopeId=shared-id', { headers: { cookie } });
    expect(((await mine.json()) as { notes: unknown[] }).notes).toHaveLength(1);
    // The other account has its own sheet of the same id, and cannot see this.
    const theirs = await app.request('/api/notes?scope=sheet&scopeId=shared-id', { headers: { cookie: otherCookie } });
    expect(((await theirs.json()) as { notes: unknown[] }).notes).toHaveLength(0);
  });

  it('rejects a secret that is wrong by one character', async () => {
    const { secret } = await mint('agent-3');
    const tampered = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    const res = await app.request('/api/auth/me', { headers: asToken(tampered) });
    expect(res.status).toBe(401);
  });

  it('rejects a real secret presented under someone else\'s token id', async () => {
    const first = await mint('agent-4');
    const second = await mint('agent-5');
    const swapped = `lb_${first.id}_${second.secret.split('_')[2]}`;
    expect((await app.request('/api/auth/me', { headers: asToken(swapped) })).status).toBe(401);
  });

  it('rejects an id that was never issued', async () => {
    expect((await app.request('/api/auth/me', { headers: asToken('lb_nosuchid_nosuchsecret') })).status).toBe(401);
  });

  it('says which credential failed, so a bad token is not read as a lapsed login', async () => {
    const res = await app.request('/api/auth/me', { headers: asToken('lb_nosuchid_nosuchsecret') });
    const body = (await res.json()) as { error: { hint: string } };
    expect(body.error.hint).toContain('API token');
  });

  it('records that it was used', async () => {
    const { id, secret } = await mint('agent-6');
    const before = await app.request('/api/auth/tokens', { headers: { cookie } });
    const beforeRow = ((await before.json()) as { tokens: { id: string; lastUsedAt: string }[] }).tokens.find(
      (t) => t.id === id,
    )!;
    expect(beforeRow.lastUsedAt).toBe('');

    await app.request('/api/auth/me', { headers: asToken(secret) });

    const after = await app.request('/api/auth/tokens', { headers: { cookie } });
    const afterRow = ((await after.json()) as { tokens: { id: string; lastUsedAt: string }[] }).tokens.find(
      (t) => t.id === id,
    )!;
    expect(afterRow.lastUsedAt).not.toBe('');
  });
});

describe('revoking', () => {
  it('stops the token working immediately', async () => {
    const { id, secret } = await mint('doomed');
    expect((await app.request('/api/auth/me', { headers: asToken(secret) })).status).toBe(200);

    const gone = await app.request(`/api/auth/tokens/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(gone.status).toBe(200);

    expect((await app.request('/api/auth/me', { headers: asToken(secret) })).status).toBe(401);
  });

  it('leaves the other tokens alone', async () => {
    const keep = await mint('keeper');
    const drop = await mint('dropped');
    await app.request(`/api/auth/tokens/${drop.id}`, { method: 'DELETE', headers: { cookie } });
    expect((await app.request('/api/auth/me', { headers: asToken(keep.secret) })).status).toBe(200);
  });

  it('is not something another account can do to your token', async () => {
    const { id, secret } = await mint('not-yours');
    const attempt = await app.request(`/api/auth/tokens/${id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(attempt.status).toBe(404);
    expect((await app.request('/api/auth/me', { headers: asToken(secret) })).status).toBe(200);
  });

  it('cannot be used to enumerate: an unknown id is the same 404 as somebody else\'s', async () => {
    const res = await app.request('/api/auth/tokens/completely-made-up', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });

  it('needs an account of its own — a token list is not public', async () => {
    expect((await app.request('/api/auth/tokens')).status).toBe(401);
  });
});
