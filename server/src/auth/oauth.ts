// Just enough OAuth for an MCP connector to sign in.
//
// Claude's custom-connector dialog does not offer a field for a bearer token. It
// takes a URL, probes it for OAuth metadata, registers itself as a client, and sends
// you through an authorization page. Without all of that it reports that it could not
// register with "loadbearing's sign-in service", which is an accurate description of
// a sign-in service that did not exist.
//
// So this is one: discovery, dynamic client registration, authorization code with
// PKCE, and a token endpoint. What it deliberately is NOT is a general-purpose
// identity provider. It has exactly one job — let a chatbot you are already signed in
// to become a token that acts as you — and the flow ends by minting an ordinary API
// token, the same kind the settings panel makes, listed and revoked in the same place.
// Nothing about a connector is special once it is connected.
//
// Nothing is stored. A registered client and an authorization code are both signed
// blobs the client carries for us, which on a serverless host is the difference
// between two tables with expiry sweeps and no tables at all.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { storage } from '../storage/index.js';
import { mintToken } from './apiToken.js';
import { requireUser, tokenFrom, type AppEnv } from './middleware.js';
import { signPayload, verifyPayload, verifyToken } from './session.js';

export const oauthRoutes = new Hono<AppEnv>();

/** An authorization code is exchanged within seconds or not at all. */
const CODE_TTL_MS = 5 * 60_000;

/** Where the MCP endpoint lives, as the resource being protected. */
const RESOURCE_PATH = '/api/mcp';

const origin = (url: string): string => new URL(url).origin;

interface RegisteredClient {
  /** Redirect targets this client registered. An exact match is required later. */
  r: string[];
  /** What it called itself, shown on the consent screen. */
  n: string;
  at: number;
  /**
   * Makes each registration distinct.
   *
   * Without it the client_id is a pure function of (redirects, name, millisecond), so
   * two clients registering identically in the same millisecond get the same identity
   * — which a test caught by doing exactly that. Harmless in itself, since they also
   * share the redirect URIs that bound where a code can be sent, but two registrations
   * are two clients and should not silently be one.
   */
  k: string;
}

interface AuthCode {
  u: string;
  /** The client_id it was issued to; a code is not transferable. */
  c: string;
  r: string;
  /** PKCE challenge, S256 only. */
  ch: string;
  e: number;
}

const pack = (value: unknown): string =>
  signPayload(Buffer.from(JSON.stringify(value)).toString('base64url'));

function unpack<T>(signed: string | undefined): T | null {
  const payload = verifyPayload(signed);
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

// ---- discovery ------------------------------------------------------------
//
// Served from the root, not from /api, because that is where the specs say to look
// and a client will not go hunting. Getting here at all required a rewrite fix: the
// SPA catch-all was answering these with index.html and a 200, so a client asking for
// JSON metadata received a web page and reported a registration failure.

/** RFC 9728: what this resource is, and who issues tokens for it. */
const protectedResource = (c: { req: { url: string }; json: (b: unknown) => Response }) =>
  c.json({
    resource: `${origin(c.req.url)}${RESOURCE_PATH}`,
    authorization_servers: [origin(c.req.url)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['loadbearing'],
  });

oauthRoutes.get('/.well-known/oauth-protected-resource', protectedResource);
// Clients append the resource path when the resource is not at the root.
oauthRoutes.get('/.well-known/oauth-protected-resource/api/mcp', protectedResource);

const authorizationServer = (c: { req: { url: string }; json: (b: unknown) => Response }) => {
  const base = origin(c.req.url);
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    // S256 only. `plain` exists in the spec and protects nobody.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['loadbearing'],
  });
};

oauthRoutes.get('/.well-known/oauth-authorization-server', authorizationServer);
oauthRoutes.get('/.well-known/openid-configuration', authorizationServer);

// ---- dynamic client registration ------------------------------------------

/**
 * Anyone may register, and registration stores nothing.
 *
 * The client_id IS the registration: a signed blob holding the redirect URIs. It
 * cannot be forged, it cannot be enumerated, and there is no row to expire. What it
 * does not do is let this server revoke one client without revoking all of them —
 * acceptable, because the thing worth revoking is the token at the end, which is a
 * real row in the same table as every other token.
 */
oauthRoutes.post('/oauth/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    redirect_uris?: unknown;
    client_name?: unknown;
  };
  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    : [];
  if (uris.length === 0) {
    return c.json(
      { error: 'invalid_redirect_uri', error_description: 'At least one http(s) redirect_uri is required.' },
      400,
    );
  }

  const client: RegisteredClient = {
    r: uris,
    n: String(body.client_name ?? 'an MCP client').slice(0, 80),
    at: Date.now(),
    k: randomBytes(9).toString('base64url'),
  };
  const clientId = pack(client);
  return c.json(
    {
      client_id: clientId,
      client_name: client.n,
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(client.at / 1000),
    },
    201,
  );
});

// ---- authorization --------------------------------------------------------

interface AuthorizeParams {
  clientId: string;
  client: RegisteredClient;
  redirectUri: string;
  state: string;
  challenge: string;
}

/**
 * A refusal, and where possible the one action that ends it.
 *
 * Most of these are a client behaving badly and the message is for whoever is reading
 * the logs. One of them is not: an unverifiable client_id happens to people who did
 * everything right, and telling them only that it cannot be granted leaves them with
 * a dead connector and no next move.
 */
interface Denial {
  message: string;
  remedy?: string;
}

const deny = (message: string): Denial => ({ message });

const isDenial = (value: AuthorizeParams | Denial): value is Denial => 'message' in value;

/**
 * Does this client_id at least look like one we minted?
 *
 * The payload is ours to read even when the signature is not ours to trust: it is
 * base64url JSON, so a client_id signed with a secret we no longer hold still decodes,
 * while one that was typed in by hand or truncated in transit does not. That is the
 * whole difference between the two remedies below, and it is legible from the value
 * itself without storing anything.
 */
function looksMinted(clientId: string): boolean {
  const cut = clientId.lastIndexOf('.');
  if (cut <= 0) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(clientId.slice(0, cut), 'base64url').toString('utf8'),
    ) as Partial<RegisteredClient>;
    return Array.isArray(parsed.r) && typeof parsed.n === 'string';
  } catch {
    return false;
  }
}

/**
 * A client_id that will not verify, explained.
 *
 * This is the failure that stranded a real connector, so it gets the diagnosis rather
 * than a shrug. A connector registers once per address and remembers the answer
 * forever: it does not re-register when an authorize request is refused, because the
 * refusal is an HTML page in a popup and not an error it parses. So whatever this page
 * says is the entire recovery procedure, and the log line is the only trace a
 * serverless host will keep of which of the two happened.
 */
function denyUnknownClient(clientId: string): Denial {
  const minted = looksMinted(clientId);
  console.log(
    `[loadbearing] oauth: refused a client_id of ${clientId.length} chars — ${
      minted ? 'our shape, but the signature does not match this secret' : 'not our shape at all'
    }`,
  );

  if (minted) {
    return {
      message:
        'That client_id was issued here, but not with the signing secret this deployment is using now.',
      remedy:
        'LOADBEARING_SESSION_SECRET has changed since this client registered, which invalidates every registration signed with the old one. Remove the connector in Claude and add it again — it registered once and has no way to notice that the answer went stale.',
    };
  }
  return {
    message: 'That client_id was not issued by this server.',
    remedy:
      'Remove the connector in Claude and add it again, leaving both OAuth fields empty. Claude registers itself and is handed a client_id; one filled in by hand cannot work, because nothing on this side ever issued it.',
  };
}

function readAuthorizeParams(query: Record<string, string | undefined>): AuthorizeParams | Denial {
  const clientId = query.client_id ?? '';
  const client = unpack<RegisteredClient>(clientId);
  if (!client) return denyUnknownClient(clientId);

  const redirectUri = query.redirect_uri ?? client.r[0]!;
  // Exact match, no prefix matching: a redirect URI is where a credential gets sent.
  if (!client.r.includes(redirectUri)) return deny('That redirect_uri was not registered by this client.');

  if ((query.response_type ?? 'code') !== 'code') return deny('Only the authorization code flow is supported.');
  if (query.code_challenge_method !== 'S256') {
    return deny('PKCE with S256 is required. A client that cannot do that cannot connect.');
  }
  const challenge = query.code_challenge ?? '';
  if (challenge.length < 20) return deny('A code_challenge is required.');

  return { clientId, client, redirectUri, state: query.state ?? '', challenge };
}

/** The refusal as the page a popup will show. */
const refuse = (
  // `html` is Hono's, which may hand back a promise; both call sites are async and
  // return it either way.
  c: { html: (body: string, status: 400) => Response | Promise<Response> },
  denial: Denial,
): Response | Promise<Response> =>
  c.html(
    page(
      'This request cannot be granted',
      `<p>${escape(denial.message)}</p>${denial.remedy ? `<p class="warn">${escape(denial.remedy)}</p>` : ''}`,
    ),
    400,
  );

/**
 * The consent screen.
 *
 * Server-rendered rather than a route in the app, because it has to work inside
 * whatever popup the client opened and must not depend on the SPA booting, loading a
 * session, and routing. It is also the one page in this codebase where a mistake
 * hands somebody an account, so it is small enough to read in one sitting.
 */
oauthRoutes.get('/oauth/authorize', async (c) => {
  const parsed = readAuthorizeParams(c.req.query());
  if (isDenial(parsed)) return refuse(c, parsed);

  const userId = verifyToken(tokenFrom(c));
  const user = userId ? await (await storage()).getUserById(userId) : null;
  if (!user) {
    // Not a redirect to the sign-in page: this window is a popup with a query string
    // that must survive, and sending it through a client-side router is how that gets
    // lost. Sign in in the main window, come back, press the button.
    return c.html(
      page(
        'Sign in first',
        `<p>You are not signed in to Loadbearing in this browser, so there is no account to connect.</p>
         <p>Open <a href="${escape(origin(c.req.url))}" target="_blank" rel="noreferrer">Loadbearing</a>,
         sign in, then reload this page.</p>`,
      ),
      200,
    );
  }

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escape(value)}">`;

  return c.html(
    page(
      'Connect to Loadbearing',
      `<p><strong>${escape(parsed.client.n)}</strong> wants to act as <strong>${escape(user.username)}</strong>.</p>
       <p class="warn">It will be able to do anything you can: read and change every sheet you have drawn,
       add problems, and read every note you have written. There is no read-only mode.</p>
       <p>Approving creates an ordinary API token. It appears under <em>Grader model → API tokens</em>,
       and revoking it there disconnects this client immediately.</p>
       <form method="post" action="/api/oauth/authorize">
         ${hidden('client_id', parsed.clientId)}
         ${hidden('redirect_uri', parsed.redirectUri)}
         ${hidden('state', parsed.state)}
         ${hidden('code_challenge', parsed.challenge)}
         <button type="submit">Approve</button>
       </form>`,
    ),
  );
});

/** The approval itself. Requires the session, so a stray POST achieves nothing. */
oauthRoutes.post('/oauth/authorize', requireUser, async (c) => {
  const form = await c.req.parseBody();
  const parsed = readAuthorizeParams({
    client_id: String(form.client_id ?? ''),
    redirect_uri: String(form.redirect_uri ?? ''),
    state: String(form.state ?? ''),
    code_challenge: String(form.code_challenge ?? ''),
    code_challenge_method: 'S256',
  });
  if (isDenial(parsed)) return refuse(c, parsed);

  const code: AuthCode = {
    u: c.get('userId'),
    c: parsed.clientId,
    r: parsed.redirectUri,
    ch: parsed.challenge,
    e: Date.now() + CODE_TTL_MS,
  };

  const target = new URL(parsed.redirectUri);
  target.searchParams.set('code', pack(code));
  if (parsed.state) target.searchParams.set('state', parsed.state);
  return c.redirect(target.toString(), 302);
});

// ---- token ----------------------------------------------------------------

oauthRoutes.post('/oauth/token', async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const grant = String(form.grant_type ?? '');
  if (grant !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  const code = unpack<AuthCode>(String(form.code ?? ''));
  if (!code) return c.json({ error: 'invalid_grant', error_description: 'That code was not issued here.' }, 400);
  if (code.e < Date.now()) {
    return c.json({ error: 'invalid_grant', error_description: 'That code has expired.' }, 400);
  }
  if (String(form.client_id ?? '') !== code.c) {
    return c.json({ error: 'invalid_grant', error_description: 'That code belongs to a different client.' }, 400);
  }
  if (form.redirect_uri !== undefined && String(form.redirect_uri) !== code.r) {
    return c.json({ error: 'invalid_grant', error_description: 'redirect_uri does not match the request.' }, 400);
  }

  // PKCE. Without this, anyone who intercepts the redirect owns the account.
  const verifier = String(form.code_verifier ?? '');
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const expected = Buffer.from(code.ch);
  const given = Buffer.from(computed);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return c.json({ error: 'invalid_grant', error_description: 'code_verifier does not match.' }, 400);
  }

  const client = unpack<RegisteredClient>(code.c);
  const minted = mintToken();
  await (await storage()).createApiToken(code.u, {
    id: minted.id,
    // Named for what it is, so the tokens list explains itself: somebody looking at
    // it a month from now should not have to work out where this came from.
    name: `${client?.n ?? 'MCP client'} (connector)`,
    hash: minted.hash,
  });

  return c.json({
    access_token: minted.secret,
    token_type: 'Bearer',
    scope: 'loadbearing',
  });
});

// ---- the page ---------------------------------------------------------------

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Self-contained: this renders in a popup that will not have loaded the app. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} — Loadbearing</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#121110; color:#ede9e1;
         font:14px/1.6 'Segoe UI',system-ui,sans-serif; padding:24px }
  main { max-width:460px; border:1px solid #322e29; border-radius:2px; background:#1a1917; padding:22px 24px }
  h1 { font-size:16px; margin:0 0 12px; letter-spacing:.01em }
  p { margin:0 0 10px; color:#a09a90 }
  .warn { color:#e2913c }
  strong { color:#ede9e1 }
  a { color:#cfa349 }
  button { margin-top:14px; font:inherit; font-weight:600; padding:8px 18px; cursor:pointer;
           background:#cfa349; color:#121110; border:0; border-radius:2px }
  button:hover { background:#dbb66a }
</style></head>
<body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}
