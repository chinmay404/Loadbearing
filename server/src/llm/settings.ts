// LLM credentials/model live in each user's settings rows. The API key leaves
// this module in exactly two shapes: the full value inside an LlmConfig
// (server-side only) or masked for display. Never both.

import type { LlmConfig, LlmProvider } from '@loadbearing/shared';
import type { Storage } from '../storage/index.js';

const KEY = {
  provider: 'llm_provider',
  baseUrl: 'llm_base_url',
  model: 'llm_model',
  apiKey: 'llm_api_key',
} as const;

const PROVIDERS: readonly LlmProvider[] = ['anthropic', 'openai-compatible', 'fake'];

const DEFAULTS: Required<LlmConfig> = {
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-sonnet-5',
  apiKey: '',
};

export interface SaveLlmInput {
  provider: LlmProvider;
  baseUrl?: string;
  model: string;
  /** Omitted or empty keeps whatever is already stored — the UI only ever sends a masked key back. */
  apiKey?: string;
}

/**
 * Full config for the adapter. Resolution order, most specific first:
 *   1. `FAKE_LLM=1` — offline stub, for dev and CI.
 *   2. `LOADBEARING_API_KEY` (+ optional PROVIDER / MODEL / BASE_URL) — a key for
 *      the whole instance, so the owner of a deployment can let people try it
 *      without each bringing their own.
 *   3. this user's settings rows, written from the Settings panel.
 */
export async function loadLlmConfig(store: Storage, userId: string): Promise<LlmConfig> {
  if (process.env.FAKE_LLM === '1') {
    return { provider: 'fake', model: 'fake', apiKey: '' };
  }

  const [provider, baseUrl, model, apiKey] = await Promise.all([
    readProvider(store, userId),
    store.getSetting(userId, KEY.baseUrl),
    store.getSetting(userId, KEY.model),
    store.getSetting(userId, KEY.apiKey),
  ]);

  const stored: LlmConfig = {
    provider,
    baseUrl: baseUrl ?? DEFAULTS.baseUrl,
    model: model ?? DEFAULTS.model,
    apiKey: apiKey ?? DEFAULTS.apiKey,
  };

  // A key the user saved themselves wins over the house key: they are paying for
  // it and chose the model that goes with it.
  if (stored.apiKey.trim()) return stored;

  const envKey = process.env.LOADBEARING_API_KEY;
  if (!envKey) return stored;

  const envProvider = process.env.LOADBEARING_PROVIDER;
  return {
    provider: PROVIDERS.includes(envProvider as LlmProvider) ? (envProvider as LlmProvider) : stored.provider,
    baseUrl: process.env.LOADBEARING_BASE_URL ?? stored.baseUrl,
    model: process.env.LOADBEARING_MODEL ?? stored.model,
    apiKey: envKey,
  };
}

/** True when the instance carries a key of its own that users can fall back on. */
export function houseKeyPresent(): boolean {
  return Boolean(process.env.LOADBEARING_API_KEY);
}

export async function saveLlmConfig(store: Storage, userId: string, input: SaveLlmInput): Promise<void> {
  if (!PROVIDERS.includes(input.provider)) {
    throw new Error(`Unknown provider "${input.provider}". Expected one of: ${PROVIDERS.join(', ')}.`);
  }
  await store.setSetting(userId, KEY.provider, input.provider);
  await store.setSetting(userId, KEY.baseUrl, (input.baseUrl ?? '').trim());
  await store.setSetting(userId, KEY.model, input.model.trim());

  const key = (input.apiKey ?? '').trim();
  if (key) await store.setSetting(userId, KEY.apiKey, key);
}

/** Safe-to-serialise view: the key is masked to its last 4 characters. */
export async function viewSettings(
  store: Storage,
  userId: string,
): Promise<{
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  usingHouseKey: boolean;
}> {
  const [provider, baseUrl, model, apiKey] = await Promise.all([
    readProvider(store, userId),
    store.getSetting(userId, KEY.baseUrl),
    store.getSetting(userId, KEY.model),
    store.getSetting(userId, KEY.apiKey),
  ]);
  return {
    provider,
    baseUrl: baseUrl ?? DEFAULTS.baseUrl,
    model: model ?? DEFAULTS.model,
    apiKeyMasked: maskKey(apiKey ?? ''),
    usingHouseKey: !(apiKey ?? '').trim() && houseKeyPresent(),
  };
}

/** Enough settings present that a real call has a chance of working. */
export async function isConfigured(store: Storage, userId: string): Promise<boolean> {
  const cfg = await loadLlmConfig(store, userId);
  if (cfg.provider === 'fake') return true;
  if (!cfg.model.trim()) return false;
  if (cfg.provider === 'anthropic') return cfg.apiKey.trim().length > 0;
  return (cfg.baseUrl ?? '').trim().length > 0; // local OpenAI-compatible servers often need no key
}

export function maskKey(apiKey: string): string {
  if (!apiKey) return '';
  return `••••${apiKey.slice(-4)}`;
}

async function readProvider(store: Storage, userId: string): Promise<LlmProvider> {
  const stored = await store.getSetting(userId, KEY.provider);
  return stored && PROVIDERS.includes(stored as LlmProvider)
    ? (stored as LlmProvider)
    : DEFAULTS.provider;
}
