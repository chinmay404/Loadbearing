// The whole API as one Vercel function.
//
// A catch-all filename rather than `index.ts` plus a rewrite: this way the
// function receives `/api/health` as `/api/health`, so the Hono app that serves
// local dev needs no second set of routes for production. There is nothing here
// but the adapter — every route lives in `server/src/app.ts`, which is also what
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
