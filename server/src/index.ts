import { serve } from '@hono/node-server';
import { app } from './app.js';
import { storage } from './storage/index.js';

// Migrations run before the first request rather than lazily on it, so a broken
// DATABASE_URL fails at startup where you will see it.
await storage();

// Deliberately not PORT: this entry point only ever serves local dev, and PORT is
// a variable dev tooling likes to set for the *frontend* — inheriting it once made
// the API try to bind Vite's port. Production uses the Vercel function, not this.
const port = Number(process.env.LOADBEARING_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[loadbearing] server on http://127.0.0.1:${info.port}`);
});

export { app };
