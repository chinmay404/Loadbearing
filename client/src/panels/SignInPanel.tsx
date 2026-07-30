import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';

/**
 * The whole account system, on one screen.
 *
 * Deliberately minimal: a username, a password, and no email — there is no
 * password-reset flow to build because there is no address to send it to, and
 * losing an account here costs you your practice history, not your money. What
 * the account is really for is keeping one person's drawings, mastery and API key
 * apart from another's.
 */
export function SignInPanel() {
  const signedIn = useApp((s) => s.signedIn);
  const houseKey = useApp((s) => s.houseKey);
  const storageKind = useApp((s) => s.storageKind);
  const setNotice = useApp((s) => s.setNotice);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);

  const go = async () => {
    setProblem(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await api.register({ username, password });
        signedIn(res.username);
        if (res.inherited > 0) {
          setNotice(
            `Welcome. ${res.inherited} rows of practice history from before this install had accounts are now yours.`,
          );
        }
      } else {
        const res = await api.login({ username, password });
        signedIn(res.username);
      }
    } catch (e) {
      const err = e as ApiError;
      setProblem({ message: err.message, ...(err.hint ? { hint: err.hint } : {}) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" style={{ maxWidth: 460 }}>
      <h1>Loadbearing</h1>
      <p className="lede">
        Learn software architecture by drawing it and having the drawing torn apart. Sign in to keep your
        sheets, your review history and your own model key.
      </p>

      <div className="filter-row">
        <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
          Create an account
        </button>
      </div>

      <div className="card">
        <label>Username</label>
        <input
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3–32 characters, letters and digits"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
          }}
        />
        <label style={{ marginTop: 8 }}>Password</label>
        <input
          type="password"
          value={password}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'at least 8 characters' : ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
          }}
        />

        {problem && (
          <div className="banner error" style={{ marginTop: 9 }}>
            <strong>{problem.message}</strong>
            {problem.hint ? <div style={{ fontSize: 12, marginTop: 3 }}>{problem.hint}</div> : null}
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <span className="grow" />
          <button
            className="primary"
            onClick={() => void go()}
            disabled={busy || username.trim().length < 3 || password.length < 1}
          >
            {busy ? <span className="spinner" /> : null}
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </div>

      <div className="card">
        <p className="stencil" style={{ margin: 0 }}>
          {houseKey
            ? 'this instance has a grader key of its own, so you can start straight away — add your own in Grader model to use your account instead'
            : 'after signing in, add your own API key under Grader model — Anthropic, or anything OpenAI-compatible such as Groq, DeepSeek, OpenAI or a local Ollama'}
        </p>
        {storageKind && (
          <p className="stencil" style={{ marginTop: 5, marginBottom: 0 }}>
            storage: {storageKind}
          </p>
        )}
      </div>
    </div>
  );
}
