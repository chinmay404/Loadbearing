import { afterEach, describe, expect, it } from 'vitest';
import { getDb, getSetting } from '../db.js';
import { isConfigured, loadLlmConfig, saveLlmConfig, viewSettings } from './settings.js';

const originalFakeLlm = process.env.FAKE_LLM;

afterEach(() => {
  if (originalFakeLlm === undefined) delete process.env.FAKE_LLM;
  else process.env.FAKE_LLM = originalFakeLlm;
});

function freshDb() {
  delete process.env.FAKE_LLM;
  return getDb(':memory:');
}

describe('settings defaults', () => {
  it('returns the documented defaults when nothing is stored', () => {
    const db = freshDb();
    expect(loadLlmConfig(db)).toEqual({
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5',
      apiKey: '',
    });
    expect(viewSettings(db)).toEqual({
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-sonnet-5',
      apiKeyMasked: '',
    });
    expect(isConfigured(db)).toBe(false);
  });
});

describe('saveLlmConfig / viewSettings', () => {
  it('saves then masks the key and never returns it raw', () => {
    const db = freshDb();
    saveLlmConfig(db, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-ant-api03-SECRETVALUE9xyz',
    });

    const view = viewSettings(db);
    expect(view.apiKeyMasked).toBe('••••9xyz');
    expect(view.apiKeyMasked).not.toContain('SECRETVALUE');
    expect(JSON.stringify(view)).not.toContain('sk-ant-api03-SECRETVALUE9xyz');
    expect(Object.keys(view).sort()).toEqual(['apiKeyMasked', 'baseUrl', 'model', 'provider']);

    // the full key is still available to the server-side adapter
    expect(loadLlmConfig(db).apiKey).toBe('sk-ant-api03-SECRETVALUE9xyz');
    expect(isConfigured(db)).toBe(true);
  });

  it('saving without an apiKey preserves the previously stored key', () => {
    const db = freshDb();
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'key-AAAA1111' });
    expect(loadLlmConfig(db).apiKey).toBe('key-AAAA1111');

    // omitted entirely
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-opus-5' });
    let cfg = loadLlmConfig(db);
    expect(cfg.apiKey).toBe('key-AAAA1111');
    expect(cfg.model).toBe('claude-opus-5');

    // present but empty / whitespace
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-opus-5', apiKey: '' });
    expect(loadLlmConfig(db).apiKey).toBe('key-AAAA1111');
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-opus-5', apiKey: '   ' });
    expect(loadLlmConfig(db).apiKey).toBe('key-AAAA1111');

    // a real new key does replace it
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'key-BBBB2222' });
    expect(loadLlmConfig(db).apiKey).toBe('key-BBBB2222');
    expect(viewSettings(db).apiKeyMasked).toBe('••••2222');
  });

  it('round-trips an openai-compatible provider with a base URL', () => {
    const db = freshDb();
    saveLlmConfig(db, {
      provider: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b',
      apiKey: 'gsk_abcd',
    });
    expect(loadLlmConfig(db)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b',
      apiKey: 'gsk_abcd',
    });
    expect(viewSettings(db).apiKeyMasked).toBe('••••abcd');
    expect(isConfigured(db)).toBe(true);
  });

  it('clears the base URL when it is omitted, and trims values', () => {
    const db = freshDb();
    saveLlmConfig(db, { provider: 'openai-compatible', baseUrl: '  http://localhost:11434/v1  ', model: '  qwen  ' });
    expect(loadLlmConfig(db).baseUrl).toBe('http://localhost:11434/v1');
    expect(loadLlmConfig(db).model).toBe('qwen');

    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(loadLlmConfig(db).baseUrl).toBe('');
  });

  it('rejects an unknown provider and stores nothing', () => {
    const db = freshDb();
    expect(() => saveLlmConfig(db, { provider: 'gemini' as any, model: 'x' })).toThrow(/provider/i);
    expect(getSetting(db, 'llm_provider')).toBeNull();
  });

  it('falls back to the default provider if the stored value is garbage', () => {
    const db = freshDb();
    saveLlmConfig(db, { provider: 'openai-compatible', baseUrl: 'http://x/v1', model: 'm' });
    db.prepare(`UPDATE settings SET value='wat' WHERE key='llm_provider'`).run();
    expect(loadLlmConfig(db).provider).toBe('anthropic');
  });

  it('anthropic without a key is not configured; openai-compatible needs a base URL', () => {
    const db = freshDb();
    saveLlmConfig(db, { provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(isConfigured(db)).toBe(false);

    const db2 = freshDb();
    saveLlmConfig(db2, { provider: 'openai-compatible', model: 'local-model' });
    expect(isConfigured(db2)).toBe(false);
    saveLlmConfig(db2, { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'local-model' });
    expect(isConfigured(db2)).toBe(true);
  });
});

describe('FAKE_LLM=1', () => {
  it('forces the fake provider regardless of what is stored', () => {
    const db = freshDb();
    saveLlmConfig(db, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-ant-real-key-9999',
    });

    process.env.FAKE_LLM = '1';
    expect(loadLlmConfig(db)).toEqual({ provider: 'fake', model: 'fake', apiKey: '' });
    expect(isConfigured(db)).toBe(true);

    delete process.env.FAKE_LLM;
    expect(loadLlmConfig(db).provider).toBe('anthropic');
    expect(loadLlmConfig(db).apiKey).toBe('sk-ant-real-key-9999');
  });

  it('FAKE_LLM values other than "1" are ignored', () => {
    const db = freshDb();
    process.env.FAKE_LLM = '0';
    expect(loadLlmConfig(db).provider).toBe('anthropic');
  });
});
