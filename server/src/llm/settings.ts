// LLM credentials/model live in the settings table. The API key leaves this
// module in exactly two shapes: the full value inside an LlmConfig (server-side
// only) or masked for display. Never both.

import type { LlmConfig, LlmProvider } from '@loadbearing/shared';
import { getSetting, setSetting, type Db } from '../db.js';

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
 *   2. `LOADBEARING_API_KEY` (+ optional PROVIDER / MODEL / BASE_URL) — env wins, so a
 *      key can be supplied per-run and never touch the database or a backup.
 *   3. the settings table, written from the UI.
 */
export function loadLlmConfig(db: Db): LlmConfig {
  if (process.env.FAKE_LLM === '1') {
    return { provider: 'fake', model: 'fake', apiKey: '' };
  }

  const stored: LlmConfig = {
    provider: readProvider(db),
    baseUrl: getSetting(db, KEY.baseUrl) ?? DEFAULTS.baseUrl,
    model: getSetting(db, KEY.model) ?? DEFAULTS.model,
    apiKey: getSetting(db, KEY.apiKey) ?? DEFAULTS.apiKey,
  };

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

/** True when a key is coming from the environment rather than the database. */
export function keyFromEnv(): boolean {
  return Boolean(process.env.LOADBEARING_API_KEY);
}

export function saveLlmConfig(db: Db, input: SaveLlmInput): void {
  if (!PROVIDERS.includes(input.provider)) {
    throw new Error(`Unknown provider "${input.provider}". Expected one of: ${PROVIDERS.join(', ')}.`);
  }
  setSetting(db, KEY.provider, input.provider);
  setSetting(db, KEY.baseUrl, (input.baseUrl ?? '').trim());
  setSetting(db, KEY.model, input.model.trim());

  const key = (input.apiKey ?? '').trim();
  if (key) setSetting(db, KEY.apiKey, key);
}

/** Safe-to-serialise view: the key is masked to its last 4 characters. */
export function viewSettings(db: Db): {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
} {
  const apiKey = getSetting(db, KEY.apiKey) ?? '';
  return {
    provider: readProvider(db),
    baseUrl: getSetting(db, KEY.baseUrl) ?? DEFAULTS.baseUrl,
    model: getSetting(db, KEY.model) ?? DEFAULTS.model,
    apiKeyMasked: maskKey(apiKey),
  };
}

/** Enough settings present that a real call has a chance of working. */
export function isConfigured(db: Db): boolean {
  const cfg = loadLlmConfig(db);
  if (cfg.provider === 'fake') return true;
  if (!cfg.model.trim()) return false;
  if (cfg.provider === 'anthropic') return cfg.apiKey.trim().length > 0;
  return (cfg.baseUrl ?? '').trim().length > 0; // local OpenAI-compatible servers often need no key
}

export function maskKey(apiKey: string): string {
  if (!apiKey) return '';
  return `••••${apiKey.slice(-4)}`;
}

function readProvider(db: Db): LlmProvider {
  const stored = getSetting(db, KEY.provider);
  return stored && PROVIDERS.includes(stored as LlmProvider)
    ? (stored as LlmProvider)
    : DEFAULTS.provider;
}
