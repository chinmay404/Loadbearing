// The Hono app, with no server attached. `index.ts` serves it for local dev and
// `api/index.ts` hands it to Vercel — both need the same routes, and neither
// should be the one that defines them.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { storage } from './storage/index.js';
import { adviseOnConnectionString } from './storage/advice.js';
import { attachUser, type AppEnv } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { houseKeyPresent, isConfigured } from './llm/settings.js';
import { problemRoutes } from './problems/routes.js';
import { scoringRoutes } from './scoring/routes.js';
import { masteryRoutes } from './mastery/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { designRoutes } from './designs/routes.js';
import { exportRoutes } from './export/routes.js';
import { playbookRoutes } from './reference/routes.js';
import { templateRoutes } from './templates/routes.js';
import { projectRoutes } from './projects/routes.js';
import { noteRoutes } from './notes/routes.js';
import { mcpRoutes, useAppForMcp } from './mcp/routes.js';
import { oauthRoutes } from './auth/oauth.js';

export const app = new Hono<AppEnv>();

// The client is served from the same origin in production, so CORS only has to
// cover the Vite dev server. Credentials are on because the session is a cookie.
app.use(
  '*',
  cors({
    origin: (origin) => (/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin) ? origin : ''),
    credentials: true,
  }),
);

/**
 * One line per request with its duration. On a serverless host the only window
 * into a stalled call is the log, and a 60-second gateway timeout says nothing
 * about which step took the 60 seconds.
 */
app.use('/api/*', async (c, next) => {
  const started = Date.now();
  const path = new URL(c.req.url).pathname;
  try {
    await next();
    console.log(`[loadbearing] ${c.req.method} ${path} -> ${c.res.status} in ${Date.now() - started}ms`);
  } catch (err) {
    console.log(`[loadbearing] ${c.req.method} ${path} -> threw after ${Date.now() - started}ms`);
    throw err;
  }
});

// Resolves the session for every route, so public ones can still personalise.
app.use('/api/*', attachUser);

app.onError((err, c) => {
  const e = err as Error & { status?: number; hint?: string; problems?: string[]; raw?: string };
  const upstream = typeof e.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500;
  // 401 from this API means one thing to the client — your session is gone — and it
  // signs the user out when it sees one. A provider rejecting the configured API
  // key is a different failure, so it must not borrow that status: an unusable key
  // used to throw the learner out of the sheet they were drawing. The provider's
  // own message and hint still come through; only the status is ours.
  const borrowedAuthFailure = e.name === 'LlmHttpError' && (upstream === 401 || upstream === 403);
  const status = borrowedAuthFailure ? 502 : upstream;
  const code = e.name === 'LlmJsonError' ? 'llm_bad_json' : e.name === 'LlmHttpError' ? 'llm_http' : e.name;
  console.error(`[loadbearing] ${code}: ${e.message}`);
  return c.json(
    {
      error: {
        code,
        message: e.message || 'Unexpected server error',
        ...(e.hint ? { hint: e.hint } : {}),
        ...(e.problems ? { problems: e.problems } : {}),
        ...(e.raw ? { raw: String(e.raw).slice(0, 4000) } : {}),
      },
    },
    status as 500,
  );
});

/**
 * A health check that dies of the thing it is meant to report on is useless, so
 * this one never throws: a database it cannot reach becomes a field in the
 * answer. It is the first thing to look at on a fresh deployment.
 */
app.get('/api/health', async (c) => {
  const userId = c.get('userId');
  let kind: string | null = null;
  let storageError: string | null = null;
  let llmConfigured = houseKeyPresent();

  try {
    const store = await storage();
    kind = store.kind;
    if (userId) llmConfigured = await isConfigured(store, userId);
  } catch (err) {
    storageError = redact((err as Error).message || String(err));
  }

  // Computed from the URL rather than from the failed connection, so it is
  // available whether the connection succeeded, failed, or exhausted a pool.
  const url = process.env.DATABASE_URL?.trim();
  const advice = url ? adviseOnConnectionString(url, Boolean(process.env.VERCEL)) : null;

  return c.json({
    ok: storageError === null,
    storage: kind,
    ...(storageError ? { storageError } : {}),
    ...(advice ? { storageAdvice: advice } : {}),
    databaseUrlSet: Boolean(process.env.DATABASE_URL?.trim()),
    sessionSecretSet: Boolean(process.env.LOADBEARING_SESSION_SECRET?.trim()),
    signedIn: Boolean(userId),
    ...(userId ? { username: c.get('username') } : {}),
    llmConfigured,
    houseKey: houseKeyPresent(),
    fake: process.env.FAKE_LLM === '1',
    ...(mcpEntry() ? { mcpEntry: mcpEntry() } : {}),
  });
});

/**
 * Where the built MCP server is on this machine, so the config to paste into a
 * chatbot can be a real config rather than one with a path to fill in.
 *
 * Found by walking up from this module rather than from the working directory: the
 * dev server runs with its cwd inside `server/`, which produced a confident and
 * entirely wrong `server/mcp/dist/index.js`. Existence is checked too, so a
 * checkout that has never run `npm run build:mcp` says nothing rather than pointing
 * at a file that is not there.
 *
 * Local only. On a deployment there is no checkout to point at, and a filesystem
 * path in a public response is a small thing to give away for no benefit.
 */
function mcpEntry(): string | null {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return null;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up += 1) {
    const candidate = join(dir, 'server', 'src', 'mcp', 'stdio.ts');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Never let a connection string's password reach a response body. */
function redact(message: string): string {
  return message.replace(/\/\/[^:/@\s]+:[^@\s]+@/g, '//***:***@').slice(0, 300);
}

app.route('/api', authRoutes);
app.route('/api', problemRoutes);
app.route('/api', scoringRoutes);
app.route('/api', masteryRoutes);
app.route('/api', settingsRoutes);
app.route('/api', designRoutes);
app.route('/api', exportRoutes);
app.route('/api', playbookRoutes);
app.route('/api', templateRoutes);
app.route('/api', projectRoutes);
app.route('/api', noteRoutes);
app.route('/api', mcpRoutes);
// Discovery lives at the root because that is where the specs say to look; the
// endpoints it points at live under /api like everything else.
app.route('/', oauthRoutes);
app.route('/api', oauthRoutes);

// Lets an MCP tool call reach the rest of the API in-process. Handed over here
// rather than imported by the MCP module, which app.ts already imports.
useAppForMcp(app);
