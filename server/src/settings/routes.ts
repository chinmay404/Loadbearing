import { Hono } from 'hono';
import type { LlmProvider } from '@archdojo/shared';
import { db } from '../db.js';
import { complete } from '../llm/adapter.js';
import { loadLlmConfig, saveLlmConfig, viewSettings } from '../llm/settings.js';

export const settingsRoutes = new Hono();

const PROVIDERS: LlmProvider[] = ['anthropic', 'openai-compatible', 'fake'];

settingsRoutes.get('/settings', (c) => c.json(viewSettings(db())));

settingsRoutes.put('/settings', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  const provider = PROVIDERS.includes(body.provider as LlmProvider)
    ? (body.provider as LlmProvider)
    : 'anthropic';
  const model = String(body.model ?? '').trim();
  if (!model) return c.json({ error: { code: 'bad_request', message: 'Model name is required.' } }, 400);

  saveLlmConfig(db(), {
    provider,
    baseUrl: String(body.baseUrl ?? '').trim(),
    model,
    ...(body.apiKey ? { apiKey: String(body.apiKey) } : {}),
  });
  return c.json(viewSettings(db()));
});

settingsRoutes.post('/settings/test', async (c) => {
  try {
    const reply = await complete(
      loadLlmConfig(db()),
      'You are a connectivity probe. Reply with exactly one word.',
      'Reply with the word pong.',
      { maxTokens: 16, timeoutMs: 30000 },
    );
    return c.json({ ok: true, reply: reply.trim().slice(0, 100) });
  } catch (err) {
    const e = err as { message?: string; hint?: string; status?: number };
    return c.json({ ok: false, error: e.message ?? 'Unknown error', hint: e.hint ?? '', status: e.status ?? 0 });
  }
});
