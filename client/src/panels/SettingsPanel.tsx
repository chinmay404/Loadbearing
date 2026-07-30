import { useEffect, useState } from 'react';
import type { LlmProvider, SettingsView } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';

interface Preset {
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  note: string;
}

const PRESETS: Preset[] = [
  { name: 'Anthropic', provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-5', note: 'Native API. Strongest reviews.' },
  { name: 'Groq', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', note: 'Very fast, generous free tier. Good default for practice runs.' },
  { name: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: 'Cheap and strong at reasoning. deepseek-reasoner also works.' },
  { name: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', note: 'Any OpenAI chat model.' },
  { name: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4', note: 'One key, many models.' },
  { name: 'Ollama (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:32b', note: 'Offline. No key needed.' },
];

export function SettingsPanel() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('claude-sonnet-5');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void api
      .settings()
      .then((s) => {
        setView(s);
        setProvider(s.provider);
        setBaseUrl(s.baseUrl);
        setModel(s.model);
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    try {
      setBusy(true);
      setMsg(null);
      const s = await api.saveSettings({ provider, baseUrl, model, ...(apiKey ? { apiKey } : {}) });
      setView(s);
      setApiKey('');
      setMsg({ kind: 'info', text: 'Saved. Test the connection to be sure.' });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ kind: 'error', text: `${err.message}${err.hint ? ` — ${err.hint}` : ''}` });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      setBusy(true);
      setMsg(null);
      const r = await api.testSettings();
      setMsg(
        r.ok
          ? { kind: 'info', text: `Connected. The model replied: "${r.reply}"` }
          : { kind: 'error', text: `${r.error}${r.hint ? ` — ${r.hint}` : ''}` },
      );
    } catch (e) {
      const err = e as ApiError;
      setMsg({ kind: 'error', text: `${err.message}${err.hint ? ` — ${err.hint}` : ''}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" style={{ maxWidth: 660 }}>
      <h1>Grader model</h1>
      <p className="faint" style={{ fontSize: 12.5, marginTop: -8 }}>
        Loadbearing talks to whichever model you park here. The key is stored locally in your SQLite file and
        never leaves your machine except in calls to the provider you chose.
      </p>

      {msg && <div className={`banner ${msg.kind === 'error' ? 'error' : 'info'}`}>{msg.text}</div>}

      <div className="card">
        <h4>Quick presets</h4>
        <div className="row wrap" style={{ gap: 5 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              title={p.note}
              onClick={() => {
                setProvider(p.provider);
                setBaseUrl(p.baseUrl);
                setModel(p.model);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 9 }}>
          <label>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
            <option value="anthropic">Anthropic (native)</option>
            <option value="openai-compatible">OpenAI-compatible (Groq, DeepSeek, OpenAI, Ollama…)</option>
            <option value="fake">Offline stub (no real grading — for trying the UI)</option>
          </select>
        </div>

        {provider === 'openai-compatible' && (
          <div style={{ marginBottom: 9 }}>
            <label>Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" />
            <p className="faint" style={{ fontSize: 11, marginTop: 3 }}>
              Usually ends in <span className="mono">/v1</span>.
            </p>
          </div>
        )}

        <div style={{ marginBottom: 9 }}>
          <label>Model</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" />
        </div>

        <div style={{ marginBottom: 9 }}>
          <label>API key {view?.apiKeyMasked ? `(stored: ${view.apiKeyMasked})` : ''}</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={view?.apiKeyMasked ? 'leave blank to keep the stored key' : 'sk-…'}
            autoComplete="off"
          />
          {view?.usingHouseKey && (
            <p className="stencil" style={{ marginTop: 4 }}>
              you are borrowing this instance&apos;s key — save your own to bill your reviews to your own
              account and pick the model that goes with it
            </p>
          )}
        </div>

        <div className="row">
          <button className="primary" onClick={() => void save()} disabled={busy || !model.trim()}>
            {busy ? <span className="spinner" /> : null} Save
          </button>
          <button onClick={() => void test()} disabled={busy}>
            Test connection
          </button>
        </div>
      </div>

      <div className="card">
        <h4>What the grader costs</h4>
        <p className="muted" style={{ fontSize: 12.5 }}>
          One review sends your diagram, the problem and the rubric — roughly 3–6k input tokens and up to
          2k output. That is a fraction of a cent on most providers. The load simulator, mastery tracking
          and the design reference cost nothing: they run locally.
        </p>
      </div>

      <div className="card">
        <h4>Keeping the key out of the database</h4>
        <p className="muted" style={{ fontSize: 12.5 }}>
          If you would rather not store a key at all, set it in the environment before starting the
          server and it takes precedence over anything saved here:
        </p>
        <pre
          className="mono"
          style={{ margin: '6px 0 0', padding: '7px 9px', background: '#0a0d12', border: '1px solid var(--rule)', fontSize: 11, overflowX: 'auto' }}
        >
{`LOADBEARING_PROVIDER=openai-compatible
LOADBEARING_BASE_URL=https://api.groq.com/openai/v1
LOADBEARING_MODEL=llama-3.3-70b-versatile
LOADBEARING_API_KEY=…`}
        </pre>
      </div>
    </div>
  );
}
