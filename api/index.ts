// The whole API as one Vercel function.
//
// Reached through the `/api/(.*)` rewrite in vercel.json. A `[...path].ts`
// catch-all filename routes correctly too; this shape was chosen only because it
// depends on nothing but a rewrite, and the rewrite preserves the original
// request path, so the Hono app that serves local dev needs no second set of
// routes for production.
//
// This file is compiled as ESM only because the ROOT package.json declares
// `"type": "module"` — there is no package.json in this directory, so that one
// governs. Remove it and the build emits CommonJS, which cannot `require` the
// ESM server below.
//
// There is nothing here but the adapter — every route lives in
// `server/src/app.ts`, which is also what `npm run dev` serves.

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
