import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmConfig } from '@archdojo/shared';
import { complete, completeJson, LlmHttpError } from './adapter.js';
import { LlmJsonError } from './json.js';

const ANTHROPIC: LlmConfig = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-test' };
const OPENAI: LlmConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b',
  apiKey: 'gsk_test',
};

/** Minimal stand-in for a fetch Response. */
function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function fail(status: number, body: string) {
  return { ok: false, status, text: async () => body, json: async () => JSON.parse(body) };
}

function anthropicReply(text: string) {
  return { content: [{ type: 'text', text }] };
}

function openAiReply(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).__FAKE_LLM_RESPONSE;
});

describe('complete — anthropic', () => {
  it('posts to /v1/messages with the documented headers and body', async () => {
    fetchMock.mockResolvedValue(ok(anthropicReply('hello')));

    const out = await complete(ANTHROPIC, 'SYSTEM', 'USER', { maxTokens: 1234, temperature: 0.9 });

    expect(out).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(init.body)).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 1234,
      temperature: 0.9,
      system: 'SYSTEM',
      messages: [{ role: 'user', content: 'USER' }],
    });
    expect(init.signal).toBeDefined();
  });

  it('defaults max_tokens to 8000 and temperature to 0.3', async () => {
    fetchMock.mockResolvedValue(ok(anthropicReply('x')));
    await complete(ANTHROPIC, 's', 'u');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.max_tokens).toBe(8000);
    expect(body.temperature).toBe(0.3);
  });

  it('honours a custom baseUrl', async () => {
    fetchMock.mockResolvedValue(ok(anthropicReply('x')));
    await complete({ ...ANTHROPIC, baseUrl: 'http://localhost:8787' }, 's', 'u');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8787/v1/messages');
  });

  it('concatenates every text block and ignores non-text blocks', async () => {
    fetchMock.mockResolvedValue(
      ok({
        content: [
          { type: 'text', text: '{"a":' },
          { type: 'thinking', thinking: 'ignore me' },
          { type: 'text', text: '1}' },
        ],
      }),
    );
    expect(await complete(ANTHROPIC, 's', 'u')).toBe('{"a":1}');
  });
});

describe('complete — openai-compatible', () => {
  it('posts to {baseUrl}/chat/completions with bearer auth and system+user messages', async () => {
    fetchMock.mockResolvedValue(ok(openAiReply('pong')));

    const out = await complete(OPENAI, 'SYSTEM', 'USER', { maxTokens: 500, temperature: 0.1 });

    expect(out).toBe('pong');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer gsk_test',
    });
    expect(JSON.parse(init.body)).toEqual({
      model: 'llama-3.3-70b',
      max_tokens: 500,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'USER' },
      ],
    });
  });

  it('throws a clear error when baseUrl is missing', async () => {
    await expect(complete({ ...OPENAI, baseUrl: undefined }, 's', 'u')).rejects.toThrow(/base URL/i);
    await expect(complete({ ...OPENAI, baseUrl: '   ' }, 's', 'u')).rejects.toThrow(/base URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('errors clearly when choices is missing or empty', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await expect(complete(OPENAI, 's', 'u')).rejects.toThrow(/no choices/i);

    fetchMock.mockResolvedValue(ok({ choices: [] }));
    await expect(complete(OPENAI, 's', 'u')).rejects.toThrow(/no choices/i);
  });
});

describe('complete — error mapping', () => {
  it('401 → LlmHttpError with status 401 and the API-key hint', async () => {
    fetchMock.mockResolvedValue(fail(401, '{"error":{"message":"invalid x-api-key"}}'));

    const err = await complete(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err.status).toBe(401);
    expect(err.hint).toBe('API key rejected — check the key and that it matches the selected provider.');
    expect(err.message).toContain('invalid x-api-key');
  });

  it('403 → the same API-key hint', async () => {
    fetchMock.mockResolvedValue(fail(403, 'forbidden'));
    const err = await complete(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.hint).toBe('API key rejected — check the key and that it matches the selected provider.');
  });

  it('429 → the rate-limit hint', async () => {
    fetchMock.mockResolvedValue(fail(429, 'slow down'));
    const err = await complete(OPENAI, 's', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err.status).toBe(429);
    expect(err.hint).toBe('Rate limited — wait a moment, lower the request size, or switch provider.');
  });

  it('404 → the endpoint/model hint', async () => {
    fetchMock.mockResolvedValue(fail(404, 'not found'));
    const err = await complete(OPENAI, 's', 'u').catch((e) => e);
    expect(err.hint).toBe(
      'Endpoint or model not found — check the base URL (it usually ends in /v1) and the model name.',
    );
  });

  it('400 → the bad-model hint', async () => {
    fetchMock.mockResolvedValue(fail(400, 'bad request'));
    const err = await complete(OPENAI, 's', 'u').catch((e) => e);
    expect(err.hint).toBe(
      'The provider rejected the request — the model name is probably wrong for this provider.',
    );
  });

  it('503 → the provider-problems hint', async () => {
    fetchMock.mockResolvedValue(fail(503, 'overloaded'));
    const err = await complete(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err.hint).toBe('Provider is having problems — retry shortly.');
  });

  it('418 → the fallback hint', async () => {
    fetchMock.mockResolvedValue(fail(418, 'teapot'));
    const err = await complete(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err.hint).toBe('Unexpected provider error.');
  });

  it('truncates the echoed response body to 500 characters', async () => {
    fetchMock.mockResolvedValue(fail(500, 'x'.repeat(2000)));
    const err = await complete(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err.message).toContain('x'.repeat(500));
    expect(err.message).not.toContain('x'.repeat(501));
  });

  it('an aborted request becomes a 408 with the timeout hint', async () => {
    const abort = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    fetchMock.mockRejectedValue(abort);

    const err = await complete(ANTHROPIC, 's', 'u', { timeoutMs: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err.status).toBe(408);
    expect(err.hint).toBe(
      'The model took too long — try a smaller/faster model or reduce the design size.',
    );
  });
});

describe('complete — fake provider', () => {
  const FAKE: LlmConfig = { provider: 'fake', model: 'fake', apiKey: '' };

  it('returns __FAKE_LLM_RESPONSE without touching the network', async () => {
    (globalThis as any).__FAKE_LLM_RESPONSE = '{"overall": 42}';
    expect(await complete(FAKE, 's', 'u')).toBe('{"overall": 42}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a canned response for the prompt when nothing is staged', async () => {
    const reply = await complete(FAKE, 'You are a staff engineer running a rigorous architecture design review.', 'u');
    expect(fetchMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(reply) as { overall: number; dimensions: Record<string, unknown> };
    expect(typeof parsed.overall).toBe('number');
    expect(Object.keys(parsed.dimensions)).toContain('reliability');
  });

  it('completeJson reads the staged fake response', async () => {
    (globalThis as any).__FAKE_LLM_RESPONSE = '```json\n{"ok":true}\n```';
    expect(await completeJson(FAKE, 's', 'u')).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('completeJson', () => {
  it('parses a good first reply with a single call', async () => {
    fetchMock.mockResolvedValue(ok(anthropicReply('Here you go: {"a":1}')));
    expect(await completeJson(ANTHROPIC, 's', 'u')).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repairs exactly once and resolves with the parsed object', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(anthropicReply('oops not json')))
      .mockResolvedValueOnce(ok(anthropicReply('{"repaired":true}')));

    const out = await completeJson<{ repaired: boolean }>(ANTHROPIC, 'SYSTEM', 'USER');

    expect(out).toEqual({ repaired: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(second.system).toBe('SYSTEM');
    expect(second.messages[0].content).toContain('could not be parsed as JSON');
    expect(second.messages[0].content).toContain('oops not json');
  });

  it('throws LlmJsonError when both attempts are unparseable', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(anthropicReply('nope')))
      .mockResolvedValueOnce(ok(anthropicReply('still nope')));

    const err = await completeJson(ANTHROPIC, 's', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(LlmJsonError);
    expect((err as LlmJsonError).raw).toBe('still nope');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on transport errors', async () => {
    fetchMock.mockResolvedValue(fail(429, 'slow down'));
    await expect(completeJson(ANTHROPIC, 's', 'u')).rejects.toBeInstanceOf(LlmHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
