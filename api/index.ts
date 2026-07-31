// The whole API as one Vercel function.
//
// Reached through the `/api/(.*)` rewrite in vercel.json rather than a
// `[...path].ts` catch-all filename. A bracketed filename left the router not
// matching `/api/auth/login` at all, and this pattern has no such ambiguity: the
// rewrite preserves the original request path, so the Hono app that serves local
// dev needs no second set of routes for production. There is nothing here but
// the adapter — every route lives in `server/src/app.ts`, which is also what
// `npm run dev` serves.

import { handle } from '@hono/node-server/vercel';
import { app } from '../server/src/app.js';

export const config = {
  api: {
    // Hono reads the raw body itself; letting Vercel parse it first would consume
    // the stream and every POST would arrive empty.
    bodyParser: false,
  },
};

export default handle(app);
