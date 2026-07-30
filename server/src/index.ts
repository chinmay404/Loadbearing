import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from './db.js';
import { isConfigured } from './llm/settings.js';
import { problemRoutes } from './problems/routes.js';
import { scoringRoutes } from './scoring/routes.js';
import { masteryRoutes } from './mastery/routes.js';
import { settingsRoutes } from './settings/routes.js';
import { designRoutes } from './designs/routes.js';
import { exportRoutes } from './export/routes.js';

const app = new Hono();

app.use('*', cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

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

app.get('/api/health', (c) =>
  c.json({ ok: true, llmConfigured: isConfigured(db()), fake: process.env.FAKE_LLM === '1' }),
);

app.route('/api', problemRoutes);
app.route('/api', scoringRoutes);
app.route('/api', masteryRoutes);
app.route('/api', settingsRoutes);
app.route('/api', designRoutes);
app.route('/api', exportRoutes);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[loadbearing] server on http://127.0.0.1:${info.port}`);
});

export { app };
