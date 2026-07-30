import { Hono } from 'hono';
import type { LlmProvider } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';
import { complete } from '../llm/adapter.js';
import { loadLlmConfig, saveLlmConfig, viewSettings } from '../llm/settings.js';

export const settingsRoutes = new Hono<AppEnv>();

const PROVIDERS: LlmProvider[] = ['anthropic', 'openai-compatible', 'fake'];

settingsRoutes.get('/settings', requireUser, async (c) =>
  c.json(await viewSettings(await storage(), c.get('userId'))),
);

settingsRoutes.put('/settings', requireUser, async (c) => {
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

  const store = await storage();
  const userId = c.get('userId');
  await saveLlmConfig(store, userId, {
    provider,
    baseUrl: String(body.baseUrl ?? '').trim(),
    model,
    ...(body.apiKey ? { apiKey: String(body.apiKey) } : {}),
  });
  return c.json(await viewSettings(store, userId));
});

settingsRoutes.post('/settings/test', requireUser, async (c) => {
  try {
    // Generous budget: reasoning models spend most of it thinking before the
    // first visible token, and a 16-token cap makes them look broken.
    const reply = await complete(
      await loadLlmConfig(await storage(), c.get('userId')),
      'You are a connectivity probe. Reply with exactly one word.',
      'Reply with the word pong.',
      { maxTokens: 1024, timeoutMs: 60000 },
    );
    return c.json({ ok: true, reply: reply.trim().slice(0, 100) });
  } catch (err) {
    const e = err as { message?: string; hint?: string; status?: number };
    return c.json({ ok: false, error: e.message ?? 'Unknown error', hint: e.hint ?? '', status: e.status ?? 0 });
  }
});
