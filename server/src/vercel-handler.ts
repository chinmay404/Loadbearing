// Node request/response <-> Fetch Request/Response, for the Vercel function.
//
// Why this exists rather than an off-the-shelf adapter: on Vercel the platform's
// Node helpers read the request body themselves and hand it over as `req.body`.
// An adapter that builds a Fetch Request by wrapping the raw stream then gives
// Hono a body that never arrives, so `await c.req.json()` never settles — and a
// promise that never settles is not an error you can catch. It is a 60-second
// gateway timeout on every POST, while every GET looks perfectly healthy.
//
// So the body is taken from whichever source actually has it, the stream is never
// awaited once it has ended, and the read is bounded. Three independent reasons a
// request cannot hang here.

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Vercel adds `body` to the request after parsing it. Nothing else does. */
type NodeRequest = IncomingMessage & { body?: unknown };

/** Long enough for any payload this app sends, short enough to never be the timeout. */
const BODY_READ_TIMEOUT_MS = 15_000;

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function toFetchRequest(req: NodeRequest): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();

  const forwardedHost = header(req, 'x-forwarded-host');
  const host = forwardedHost ?? header(req, 'host') ?? 'localhost';
  const proto = header(req, 'x-forwarded-proto') ?? 'https';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const one of value) headers.append(key, one);
    else headers.set(key, value);
  }

  let body: Buffer | string | undefined;
  if (!BODYLESS.has(method)) {
    body = await readBody(req);
    // The length may no longer match: a parsed-and-reserialised body can differ
    // from the bytes that arrived. Let the Request compute it.
    headers.delete('content-length');
    headers.delete('transfer-encoding');
  }

  // A Buffer is a Uint8Array at runtime but not an accepted BodyInit to the type
  // checker, so hand over a plain view of the same bytes.
  const init: RequestInit =
    body === undefined
      ? { method, headers }
      : { method, headers, body: typeof body === 'string' ? body : new Uint8Array(body) };

  return new Request(url, init);
}

/**
 * The body, from the parsed copy if the platform made one, otherwise from the
 * stream — and never from a stream that has already ended.
 */
export async function readBody(req: NodeRequest): Promise<Buffer | string | undefined> {
  const parsed = req.body;
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) return parsed;
    if (typeof parsed === 'string') return parsed;
    // An empty object is what Vercel leaves for a request that had no body.
    if (typeof parsed === 'object' && Object.keys(parsed as object).length === 0) return undefined;
    return JSON.stringify(parsed);
  }

  if (req.readableEnded || req.destroyed) return undefined;

  const chunks: Buffer[] = [];
  const collect = (async () => {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
  })();

  let timer: NodeJS.Timeout | undefined;
  const bounded = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Request body did not arrive within ${BODY_READ_TIMEOUT_MS}ms.`)),
      BODY_READ_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([collect, bounded]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  // set-cookie is the one header that may legitimately repeat, and joining the
  // values with a comma silently discards every cookie after the first.
  const setCookies =
    typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (response.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue;
    res.setHeader(key, value);
  }
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);

  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** The handler Vercel invokes. */
export function createNodeHandler(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  return async (req: NodeRequest, res: ServerResponse): Promise<void> => {
    try {
      const response = await app.fetch(await toFetchRequest(req));
      await sendResponse(res, response);
    } catch (err) {
      // Reaching here means the failure was outside the app's own error handling,
      // so it has to be reported here or it becomes an opaque platform 500.
      const message = (err as Error).message || 'Unknown error';
      console.error(`[loadbearing] request failed before the app could answer: ${message}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      res.end(
        JSON.stringify({
          error: {
            code: 'adapter_error',
            message: 'The request could not be handed to the application.',
            hint: message,
          },
        }),
      );
    }
  };
}

function header(req: NodeRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
