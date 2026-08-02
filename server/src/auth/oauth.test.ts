// The OAuth flow, walked end to end the way a connector walks it.
//
// This is the one place in the codebase where a mistake hands somebody an account, so
// the tests are mostly about refusal: a redirect URI that was not registered, a code
// replayed by a different client, a verifier that does not match the challenge, an
// approval attempted without a session. The happy path is four steps and gets one
// test; the ways it must not work get the rest.

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'loadbearing-oauth-'));
process.env.LOADBEARING_DB = join(dir, 'oauth.sqlite');
process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
delete process.env.DATABASE_URL;

const { app } = await import('../app.js');

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let cookie = '';

const verifier = () => randomBytes(32).toString('base64url');
const challengeFor = (v: string) => createHash('sha256').update(v).digest('base64url');

const register = async (redirect = REDIRECT): Promise<string> => {
  const res = await app.request('/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
};

const authorizeUrl = (clientId: string, challenge: string, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...extra,
  });
  return `/api/oauth/authorize?${q}`;
};

/** Press Approve, and read the code out of the redirect. */
const approve = async (
  clientId: string,
  challenge: string,
  as: string | null = cookie,
): Promise<{ status: number; location: string | null }> => {
  const res = await app.request('/api/oauth/authorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(as ? { cookie: as } : {}),
    },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'xyz',
      code_challenge: challenge,
    }).toString(),
  });
  return { status: res.status, location: res.headers.get('location') };
};

const exchange = async (body: Record<string, string>) => {
  const res = await app.request('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

beforeAll(async () => {
  const registered = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'oauthuser', password: 'a-long-enough-password' }),
  });
  expect(registered.status).toBe(201);
  cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open for the life of the process.
  }
});

describe('discovery', () => {
  it('describes the protected resource, at both places a client looks', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { resource: string; authorization_servers: string[] };
      expect(body.resource).toMatch(/\/api\/mcp$/);
      expect(body.authorization_servers).toHaveLength(1);
    }
  });

  it('describes the authorization server, and insists on S256', async () => {
    const res = await app.request('/.well-known/oauth-authorization-server');
    const body = (await res.json()) as Record<string, string[] | string>;
    expect(body.registration_endpoint).toMatch(/\/api\/oauth\/register$/);
    expect(body.authorization_endpoint).toMatch(/\/api\/oauth\/authorize$/);
    expect(body.token_endpoint).toMatch(/\/api\/oauth\/token$/);
    // `plain` is in the spec and protects nobody.
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('points an unauthenticated MCP request at the metadata, per RFC 9728', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('oauth-protected-resource');
  });
});

describe('registration', () => {
  it('issues a client_id that carries its own redirect URIs', async () => {
    const clientId = await register();
    expect(clientId.length).toBeGreaterThan(40);
    // Signed, so it survives a round trip through a client we store nothing about.
    const res = await app.request(authorizeUrl(clientId, challengeFor(verifier())), {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });

  it('refuses a registration with no usable redirect', async () => {
    for (const uris of [[], ['not-a-url'], ['ftp://nope']]) {
      const res = await app.request('/api/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: uris }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('refuses a client_id it did not sign', async () => {
    const res = await app.request(authorizeUrl('made.up', challengeFor(verifier())), { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not issued by this server');
  });
});

describe('the authorization page', () => {
  it('names the client and the account, and warns what access means', async () => {
    const res = await app.request(authorizeUrl(await register(), challengeFor(verifier())), {
      headers: { cookie },
    });
    const html = await res.text();
    expect(html).toContain('Claude');
    expect(html).toContain('oauthuser');
    expect(html).toContain('There is no read-only mode');
  });

  it('asks you to sign in rather than failing, when there is no session', async () => {
    const res = await app.request(authorizeUrl(await register(), challengeFor(verifier())));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Sign in first');
  });

  it('refuses a redirect_uri the client never registered', async () => {
    const clientId = await register();
    const url = authorizeUrl(clientId, challengeFor(verifier()), { redirect_uri: 'https://evil.example/steal' });
    const res = await app.request(url, { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not registered');
  });

  it('refuses a request without PKCE', async () => {
    const clientId = await register();
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
    });
    const res = await app.request(`/api/oauth/authorize?${q}`, { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('PKCE');
  });

  it('cannot be approved without a session', async () => {
    const clientId = await register();
    const { status } = await approve(clientId, challengeFor(verifier()), null);
    expect(status).toBe(401);
  });
});

describe('the exchange', () => {
  it('turns an approved code into a working token, and lists it as a token', async () => {
    const clientId = await register();
    const v = verifier();
    const { status, location } = await approve(clientId, challengeFor(v));
    expect(status).toBe(302);

    const back = new URL(location!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    // The state has to come back or the client cannot match the response to its request.
    expect(back.searchParams.get('state')).toBe('xyz');

    const granted = await exchange({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: v,
    });
    expect(granted.status).toBe(200);
    expect(granted.body.token_type).toBe('Bearer');
    expect(granted.body.access_token).toMatch(/^lb_/);

    // It is an ordinary token: it works on the MCP endpoint...
    const used = await app.request('/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${granted.body.access_token ?? ''}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(used.status).toBe(200);

    // ...and it is visible and revocable in the same list as every other token.
    const listed = await app.request('/api/auth/tokens', { headers: { cookie } });
    const { tokens } = (await listed.json()) as { tokens: { name: string }[] };
    expect(tokens.some((t) => t.name.includes('connector'))).toBe(true);
  });

  it('refuses a verifier that does not match the challenge', async () => {
    const clientId = await register();
    const { location } = await approve(clientId, challengeFor(verifier()));
    const granted = await exchange({
      grant_type: 'authorization_code',
      code: new URL(location!).searchParams.get('code')!,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier(),
    });
    expect(granted.status).toBe(400);
    expect(granted.body.error_description).toContain('code_verifier');
  });

  it('refuses a code presented by a different client', async () => {
    const mine = await register();
    const theirs = await register();
    const v = verifier();
    const { location } = await approve(mine, challengeFor(v));
    const granted = await exchange({
      grant_type: 'authorization_code',
      code: new URL(location!).searchParams.get('code')!,
      client_id: theirs,
      redirect_uri: REDIRECT,
      code_verifier: v,
    });
    expect(granted.status).toBe(400);
    expect(granted.body.error_description).toContain('different client');
  });

  it('refuses a code that was not signed here', async () => {
    const granted = await exchange({
      grant_type: 'authorization_code',
      code: 'handmade.code',
      client_id: await register(),
      code_verifier: verifier(),
    });
    expect(granted.status).toBe(400);
    expect(granted.body.error).toBe('invalid_grant');
  });

  it('refuses a redirect_uri that changed between request and exchange', async () => {
    const clientId = await register();
    const v = verifier();
    const { location } = await approve(clientId, challengeFor(v));
    const granted = await exchange({
      grant_type: 'authorization_code',
      code: new URL(location!).searchParams.get('code')!,
      client_id: clientId,
      redirect_uri: 'https://claude.ai/somewhere/else',
      code_verifier: v,
    });
    expect(granted.status).toBe(400);
  });

  it('supports only the authorization code grant', async () => {
    const granted = await exchange({ grant_type: 'password', username: 'oauthuser', password: 'x' });
    expect(granted.status).toBe(400);
    expect(granted.body.error).toBe('unsupported_grant_type');
  });
});
