import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../storage/sqlite.js';
import { isConfigured, loadLlmConfig, saveLlmConfig, viewSettings } from './settings.js';

const originalFakeLlm = process.env.FAKE_LLM;
const originalHouseKey = process.env.LOADBEARING_API_KEY;

afterEach(() => {
  if (originalFakeLlm === undefined) delete process.env.FAKE_LLM;
  else process.env.FAKE_LLM = originalFakeLlm;
  if (originalHouseKey === undefined) delete process.env.LOADBEARING_API_KEY;
  else process.env.LOADBEARING_API_KEY = originalHouseKey;
});

/** An in-memory store with one account, since settings are per-user now. */
async function freshStore() {
  delete process.env.FAKE_LLM;
  delete process.env.LOADBEARING_API_KEY;
  const store = new SqliteStorage(':memory:');
  await store.init();
  const user = await store.createUser('tester', 'scrypt$1$1$1$x$y');
  return { store, userId: user.id };
}

describe('settings defaults', () => {
  it('returns the documented defaults when nothing is stored', async () => {
    const { store, userId } = await freshStore();
    expect(await loadLlmConfig(store, userId)).toEqual({
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5',
      apiKey: '',
    });
    expect(await viewSettings(store, userId)).toEqual({
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5',
      apiKeyMasked: '',
      usingHouseKey: false,
    });
    expect(await isConfigured(store, userId)).toBe(false);
  });
});

describe('saveLlmConfig / viewSettings', () => {
  it('saves then masks the key and never returns it raw', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-ant-api03-SECRETVALUE9xyz',
    });

    const view = await viewSettings(store, userId);
    expect(view.apiKeyMasked).toBe('••••9xyz');
    expect(view.apiKeyMasked).not.toContain('SECRETVALUE');
    expect(JSON.stringify(view)).not.toContain('sk-ant-api03-SECRETVALUE9xyz');
    expect(Object.keys(view).sort()).toEqual([
      'apiKeyMasked',
      'baseUrl',
      'model',
      'provider',
      'usingHouseKey',
    ]);

    // the full key is still available to the server-side adapter
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('sk-ant-api03-SECRETVALUE9xyz');
    expect(await isConfigured(store, userId)).toBe(true);
  });

  it('saving without an apiKey preserves the previously stored key', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'key-AAAA1111' });
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('key-AAAA1111');

    // omitted entirely
    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-opus-5' });
    const cfg = await loadLlmConfig(store, userId);
    expect(cfg.apiKey).toBe('key-AAAA1111');
    expect(cfg.model).toBe('claude-opus-5');

    // present but empty / whitespace
    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-opus-5', apiKey: '' });
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('key-AAAA1111');
    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-opus-5', apiKey: '   ' });
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('key-AAAA1111');

    // a real new key does replace it
    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'key-BBBB2222' });
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('key-BBBB2222');
    expect((await viewSettings(store, userId)).apiKeyMasked).toBe('••••2222');
  });

  it('round-trips an openai-compatible provider with a base URL', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, {
      provider: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b',
      apiKey: 'gsk_abcd',
    });
    expect(await loadLlmConfig(store, userId)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b',
      apiKey: 'gsk_abcd',
    });
    expect((await viewSettings(store, userId)).apiKeyMasked).toBe('••••abcd');
    expect(await isConfigured(store, userId)).toBe(true);
  });

  it('clears the base URL when it is omitted, and trims values', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, {
      provider: 'openai-compatible',
      baseUrl: '  http://localhost:11434/v1  ',
      model: '  qwen  ',
    });
    expect((await loadLlmConfig(store, userId)).baseUrl).toBe('http://localhost:11434/v1');
    expect((await loadLlmConfig(store, userId)).model).toBe('qwen');

    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'claude-sonnet-5' });
    expect((await loadLlmConfig(store, userId)).baseUrl).toBe('');
  });

  it('rejects an unknown provider and stores nothing', async () => {
    const { store, userId } = await freshStore();
    await expect(saveLlmConfig(store, userId, { provider: 'gemini' as any, model: 'x' })).rejects.toThrow(
      /provider/i,
    );
    expect(await store.getSetting(userId, 'llm_provider')).toBeNull();
  });

  it('falls back to the default provider if the stored value is garbage', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, { provider: 'openai-compatible', baseUrl: 'http://x/v1', model: 'm' });
    await store.setSetting(userId, 'llm_provider', 'wat');
    expect((await loadLlmConfig(store, userId)).provider).toBe('anthropic');
  });

  it('anthropic without a key is not configured; openai-compatible needs a base URL', async () => {
    const a = await freshStore();
    await saveLlmConfig(a.store, a.userId, { provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(await isConfigured(a.store, a.userId)).toBe(false);

    const b = await freshStore();
    await saveLlmConfig(b.store, b.userId, { provider: 'openai-compatible', model: 'local-model' });
    expect(await isConfigured(b.store, b.userId)).toBe(false);
    await saveLlmConfig(b.store, b.userId, {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'local-model',
    });
    expect(await isConfigured(b.store, b.userId)).toBe(true);
  });

  it("one user's key is invisible to another", async () => {
    const { store } = await freshStore();
    const alice = await store.createUser('alice', 'h');
    const bob = await store.createUser('bob', 'h');
    await saveLlmConfig(store, alice.id, { provider: 'anthropic', model: 'm', apiKey: 'alice-key-1111' });

    expect((await loadLlmConfig(store, bob.id)).apiKey).toBe('');
    expect((await viewSettings(store, bob.id)).apiKeyMasked).toBe('');
    expect((await loadLlmConfig(store, alice.id)).apiKey).toBe('alice-key-1111');
  });
});

describe('the house key', () => {
  it('fills in for a user who has not saved one, and yields to one who has', async () => {
    const { store, userId } = await freshStore();
    process.env.LOADBEARING_API_KEY = 'house-key-9999';

    let cfg = await loadLlmConfig(store, userId);
    expect(cfg.apiKey).toBe('house-key-9999');
    expect((await viewSettings(store, userId)).usingHouseKey).toBe(true);

    await saveLlmConfig(store, userId, { provider: 'anthropic', model: 'm', apiKey: 'own-key-1234' });
    cfg = await loadLlmConfig(store, userId);
    expect(cfg.apiKey).toBe('own-key-1234');
    expect((await viewSettings(store, userId)).usingHouseKey).toBe(false);
  });
});

describe('FAKE_LLM=1', () => {
  it('forces the fake provider regardless of what is stored', async () => {
    const { store, userId } = await freshStore();
    await saveLlmConfig(store, userId, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-ant-real-key-9999',
    });

    process.env.FAKE_LLM = '1';
    expect(await loadLlmConfig(store, userId)).toEqual({ provider: 'fake', model: 'fake', apiKey: '' });
    expect(await isConfigured(store, userId)).toBe(true);

    delete process.env.FAKE_LLM;
    expect((await loadLlmConfig(store, userId)).provider).toBe('anthropic');
    expect((await loadLlmConfig(store, userId)).apiKey).toBe('sk-ant-real-key-9999');
  });

  it('FAKE_LLM values other than "1" are ignored', async () => {
    const { store, userId } = await freshStore();
    process.env.FAKE_LLM = '0';
    expect((await loadLlmConfig(store, userId)).provider).toBe('anthropic');
  });
});
