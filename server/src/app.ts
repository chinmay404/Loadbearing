// The Hono app, with no server attached. `index.ts` serves it for local dev and
// `api/index.ts` hands it to Vercel — both need the same routes, and neither
// should be the one that defines them.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { storage } from './storage/index.js';
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

// Resolves the session for every route, so public ones can still personalise.
app.use('/api/*', attachUser);

app.onError((err, c) => {
  const e = err as Error & { status?: number; hint?: string; problems?: string[]; raw?: string };
  const status = typeof e.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500;
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

app.get('/api/health', async (c) => {
  const store = await storage();
  const userId = c.get('userId');
  return c.json({
    ok: true,
    storage: store.kind,
    signedIn: Boolean(userId),
    ...(userId ? { username: c.get('username') } : {}),
    llmConfigured: userId ? await isConfigured(store, userId) : houseKeyPresent(),
    houseKey: houseKeyPresent(),
    fake: process.env.FAKE_LLM === '1',
  });
});

app.route('/api', authRoutes);
app.route('/api', problemRoutes);
app.route('/api', scoringRoutes);
app.route('/api', masteryRoutes);
app.route('/api', settingsRoutes);
app.route('/api', designRoutes);
app.route('/api', exportRoutes);
app.route('/api', playbookRoutes);
