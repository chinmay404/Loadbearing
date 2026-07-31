// How a failure becomes an HTTP status.
//
// A 401 from this API means one thing to the client — your session is gone — and it
// signs the user out when it sees one. An LLM provider rejecting the configured key
// used to be passed through with the provider's own 401, so an unusable API key
// threw the learner out of the sheet they were drawing and back to the problem
// list. The status is decided in one place; these drive that place through routes
// that raise each kind of failure.
//
// Routes are registered at module scope: Hono freezes its matcher once it has
// served a request, so nothing can be added from inside a test.

import { describe, expect, it } from 'vitest';
import { app } from './app.js';

const raise = (name: string, status: number, message: string) => () => {
  throw Object.assign(new Error(message), { name, status });
};

app.get('/api/test-only/llm-401', raise('LlmHttpError', 401, 'LLM request failed with HTTP 401: invalid x-api-key'));
app.get('/api/test-only/llm-403', raise('LlmHttpError', 403, 'LLM request failed with HTTP 403: forbidden'));
app.get('/api/test-only/llm-429', raise('LlmHttpError', 429, 'LLM request failed with HTTP 429: slow down'));
app.get('/api/test-only/llm-broken', raise('LlmJsonError', 500, 'The model reply could not be parsed as JSON.'));
app.get('/api/test-only/session', raise('HTTPException', 401, 'Sign in first'));

describe('error status mapping', () => {
  it('reports a rejected provider key as a gateway error, message intact', async () => {
    for (const path of ['/api/test-only/llm-401', '/api/test-only/llm-403']) {
      const res = await app.request(path);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('llm_http');
      expect(body.error.message).toMatch(/invalid x-api-key|forbidden/);
    }
  });

  it('passes through other provider statuses, which mean what they say', async () => {
    expect((await app.request('/api/test-only/llm-429')).status).toBe(429);
  });

  it('keeps naming an unparseable reply as such', async () => {
    const res = await app.request('/api/test-only/llm-broken');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('llm_bad_json');
  });

  it('leaves a genuine session failure as a 401', async () => {
    expect((await app.request('/api/test-only/session')).status).toBe(401);
  });
});
