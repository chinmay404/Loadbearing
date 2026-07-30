// The only place in the server that talks to a model. Two wire formats
// (Anthropic Messages, OpenAI chat/completions) plus a `fake` provider so tests
// and offline dev never touch the network.

import type { LlmConfig } from '@archdojo/shared';
import { fakeResponseFor } from './fake.js';
import { extractJson, LlmJsonError } from './json.js';

const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_BODY_CHARS = 500;

const TIMEOUT_HINT = 'The model took too long — try a smaller/faster model or reduce the design size.';

const REPAIR_PROMPT =
  'Your previous reply could not be parsed as JSON. Reply with ONLY the corrected JSON object — no prose, no code fences.\n\nPrevious reply:\n';

/** A provider call that came back wrong. `hint` is user-facing remediation advice. */
export class LlmHttpError extends Error {
  status: number;
  hint: string;

  constructor(status: number, message: string, hint: string = hintForStatus(status)) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
    this.hint = hint;
  }
}

export interface CompleteOpts {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Maps an HTTP status onto the one sentence that actually helps the user fix it. */
export function hintForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'API key rejected — check the key and that it matches the selected provider.';
  }
  if (status === 404) {
    return 'Endpoint or model not found — check the base URL (it usually ends in /v1) and the model name.';
  }
  if (status === 429) {
    return 'Rate limited — wait a moment, lower the request size, or switch provider.';
  }
  if (status === 400) {
    return 'The provider rejected the request — the model name is probably wrong for this provider.';
  }
  if (status === 408) return TIMEOUT_HINT;
  if (status >= 500 && status < 600) return 'Provider is having problems — retry shortly.';
  return 'Unexpected provider error.';
}

/** One turn: system prompt + user message in, raw assistant text out. */
export async function complete(
  cfg: LlmConfig,
  system: string,
  user: string,
  opts: CompleteOpts = {},
): Promise<string> {
  if (cfg.provider === 'fake') {
    const injected = (globalThis as any).__FAKE_LLM_RESPONSE;
    return injected === undefined ? fakeResponseFor(system, user) : String(injected);
  }

  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const request =
    cfg.provider === 'anthropic'
      ? anthropicRequest(cfg, system, user, maxTokens, temperature)
      : openAiRequest(cfg, system, user, maxTokens, temperature);

  let res: Response;
  try {
    res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isAbort(err)) {
      throw new LlmHttpError(408, `The model did not respond within ${timeoutMs}ms.`, TIMEOUT_HINT);
    }
    throw err;
  }

  if (!res.ok) {
    const body = await safeText(res);
    const truncated = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…` : body;
    throw new LlmHttpError(
      res.status,
      `LLM request failed with HTTP ${res.status}: ${truncated}`,
      hintForStatus(res.status),
    );
  }

  const data = (await res.json().catch(() => null)) as any;
  return cfg.provider === 'anthropic' ? anthropicText(data) : openAiText(data);
}

/** `complete`, but the reply must be JSON. Gets exactly one repair round if it isn't. */
export async function completeJson<T>(
  cfg: LlmConfig,
  system: string,
  user: string,
  opts: CompleteOpts = {},
): Promise<T> {
  const first = await complete(cfg, system, user, opts);
  try {
    return extractJson(first) as T;
  } catch (err) {
    if (!(err instanceof LlmJsonError)) throw err;
    // One repair attempt: hand the mangled reply back and ask for JSON only.
    const repaired = await complete(cfg, system, REPAIR_PROMPT + err.raw, opts);
    return extractJson(repaired) as T; // an LlmJsonError here is final
  }
}

// ---------- wire formats ----------

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function anthropicRequest(
  cfg: LlmConfig,
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): WireRequest {
  return {
    url: `${trimSlash(cfg.baseUrl || DEFAULT_ANTHROPIC_BASE)}/v1/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    },
  };
}

function openAiRequest(
  cfg: LlmConfig,
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): WireRequest {
  if (!cfg.baseUrl || !cfg.baseUrl.trim()) {
    throw new Error(
      'The openai-compatible provider needs a base URL (for example https://api.groq.com/openai/v1). Set it in Settings.',
    );
  }
  return {
    url: `${trimSlash(cfg.baseUrl.trim())}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  };
}

/** Anthropic returns content blocks; concatenate every text block. */
function anthropicText(data: any): string {
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => String(b?.text ?? ''))
    .join('');
  if (!text) {
    throw new LlmHttpError(
      502,
      'The provider returned no text content. Response shape was unexpected.',
      'Unexpected provider error.',
    );
  }
  return text;
}

/** OpenAI-compatible returns choices[0].message.content (string, or content parts). */
function openAiText(data: any): string {
  const choices = data?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmHttpError(
      502,
      'The provider returned no choices. Check that the base URL points at an OpenAI-compatible /v1 endpoint.',
      'Unexpected provider error.',
    );
  }
  const content = choices[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((p: any) => (typeof p === 'string' ? p : String(p?.text ?? ''))).join('')
        : '';
  if (!text) {
    throw new LlmHttpError(
      502,
      'The provider returned an empty message. Response shape was unexpected.',
      'Unexpected provider error.',
    );
  }
  return text;
}

// ---------- helpers ----------

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
