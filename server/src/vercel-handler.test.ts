// These tests exist because the bug they cover cannot be caught by running the
// app locally: locally the request stream is intact, and the adapter works. It
// only breaks on a host that parses the body first and hands over `req.body` —
// so the two shapes are simulated here instead of discovered in production.

import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createNodeHandler, readBody, sendResponse, toFetchRequest } from './vercel-handler.js';

/** A request whose stream still holds the bytes, as Node delivers it locally. */
function streamingRequest(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
}): any {
  const stream = Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]);
  return Object.assign(stream, {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/api/health',
    headers: { host: 'example.test', ...(opts.headers ?? {}) },
  });
}

/**
 * A request whose stream has already been drained by the platform, with the
 * parsed result attached. This is the shape that used to hang forever.
 */
function preParsedRequest(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body: unknown;
}): any {
  const stream = Readable.from([]);
  // Drain it, exactly as the platform's own body parser would have.
  stream.resume();
  const req = Object.assign(stream, {
    method: opts.method ?? 'POST',
    url: opts.url ?? '/api/auth/login',
    headers: { host: 'example.test', 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body,
  });
  return markEnded(req);
}

/** `readableEnded` is a getter on Readable, so it has to be redefined, not assigned. */
function markEnded(req: any): any {
  Object.defineProperty(req, 'readableEnded', { value: true, configurable: true });
  return req;
}

function fakeResponse() {
  const headers: Record<string, string | string[]> = {};
  const res: any = {
    statusCode: 0,
    headersSent: false,
    setHeader: (k: string, v: string | string[]) => {
      headers[k.toLowerCase()] = v;
    },
    end: vi.fn(),
  };
  return { res, headers, bodyOf: () => String(res.end.mock.calls[0]?.[0] ?? '') };
}

describe('readBody', () => {
  it('reads a streaming body', async () => {
    const body = await readBody(streamingRequest({ method: 'POST', body: '{"a":1}' }));
    expect(String(body)).toBe('{"a":1}');
  });

  it('uses the parsed body when the platform already consumed the stream', async () => {
    const body = await readBody(preParsedRequest({ body: { username: 'ada', password: 'secret' } }));
    expect(JSON.parse(String(body))).toEqual({ username: 'ada', password: 'secret' });
  });

  it('accepts a parsed body that is a string or a Buffer', async () => {
    expect(String(await readBody(preParsedRequest({ body: '{"a":1}' })))).toBe('{"a":1}');
    expect(String(await readBody(preParsedRequest({ body: Buffer.from('raw') })))).toBe('raw');
  });

  it('treats an empty parsed object as no body', async () => {
    expect(await readBody(preParsedRequest({ body: {} }))).toBeUndefined();
  });

  it('returns immediately for a stream that already ended with nothing attached', async () => {
    expect(await readBody(markEnded(streamingRequest({ method: 'POST' })))).toBeUndefined();
  });

  it('does not hang on an empty stream', async () => {
    expect(await readBody(streamingRequest({ method: 'POST' }))).toBeUndefined();
  });
});

describe('toFetchRequest', () => {
  it('builds an absolute URL from the forwarded host and proto', async () => {
    const request = await toFetchRequest(
      streamingRequest({
        url: '/api/health?x=1',
        headers: { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' },
      }),
    );
    expect(request.url).toBe('https://app.example.com/api/health?x=1');
  });

  it('preserves the path so the app needs no production-only routes', async () => {
    const request = await toFetchRequest(preParsedRequest({ url: '/api/auth/login', body: { a: 1 } }));
    expect(new URL(request.url).pathname).toBe('/api/auth/login');
    expect(request.method).toBe('POST');
  });

  it('carries a pre-parsed body through as readable JSON', async () => {
    const request = await toFetchRequest(preParsedRequest({ body: { username: 'ada' } }));
    await expect(request.json()).resolves.toEqual({ username: 'ada' });
  });

  it('drops a content-length that may no longer match the reserialised body', async () => {
    const request = await toFetchRequest(
      preParsedRequest({ body: { username: 'ada' }, headers: { 'content-length': '999' } }),
    );
    expect(request.headers.get('content-length')).not.toBe('999');
  });

  it('never gives a GET a body', async () => {
    const request = await toFetchRequest(streamingRequest({ method: 'GET' }));
    expect(request.body).toBeNull();
  });
});

describe('sendResponse', () => {
  it('copies status, headers and body', async () => {
    const { res, headers, bodyOf } = fakeResponse();
    await sendResponse(res, new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }));
    expect(res.statusCode).toBe(201);
    expect(headers['content-type']).toBe('application/json');
    expect(bodyOf()).toBe('{"ok":true}');
  });

  it('keeps every set-cookie rather than collapsing them into one', async () => {
    const { res, headers } = fakeResponse();
    const response = new Response(null, { status: 204 });
    response.headers.append('set-cookie', 'a=1; Path=/');
    response.headers.append('set-cookie', 'b=2; Path=/');
    await sendResponse(res, response);
    expect(headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });
});

describe('createNodeHandler', () => {
  it('answers a POST whose body the platform already parsed', async () => {
    const app = {
      fetch: async (request: Request) => {
        const payload = (await request.json()) as { username: string };
        return Response.json({ hello: payload.username }, { status: 200 });
      },
    };
    const { res, bodyOf } = fakeResponse();
    await createNodeHandler(app)(preParsedRequest({ body: { username: 'ada' } }), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(bodyOf())).toEqual({ hello: 'ada' });
  });

  it('reports a failure that happens before the app is reached, as JSON', async () => {
    const app = {
      fetch: () => {
        throw new Error('boom');
      },
    };
    const { res, headers, bodyOf } = fakeResponse();
    await createNodeHandler(app)(streamingRequest({}), res);
    expect(res.statusCode).toBe(500);
    expect(headers['content-type']).toBe('application/json');
    const parsed = JSON.parse(bodyOf()) as { error: { code: string; hint: string } };
    expect(parsed.error.code).toBe('adapter_error');
    expect(parsed.error.hint).toContain('boom');
  });
});
