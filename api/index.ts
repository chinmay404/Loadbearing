// The whole API as one Vercel function.
//
// Reached through the `/api/(.*)` rewrite in vercel.json, which preserves the
// original request path, so the Hono app that serves local dev needs no second
// set of routes for production.
//
// This file is compiled as ESM only because the ROOT package.json declares
// `"type": "module"` — there is no package.json in this directory, so that one
// governs. Remove it and the build emits CommonJS, which cannot `require` the
// ESM server below.
//
// The adapter is ours rather than a library's because the platform parses the
// request body before handing it over, and an adapter that reads the raw stream
// instead waits forever for a body that already arrived. See vercel-handler.ts.

import { app } from '../server/src/app.js';
import { createNodeHandler } from '../server/src/vercel-handler.js';

export default createNodeHandler(app);
