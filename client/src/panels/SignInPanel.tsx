import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconMark } from '../ui/UiIcons';

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

  const ready = !busy && username.trim().length >= 3 && password.length >= 1;

  return (
    <>
      <section className="gate-form">
        <div className="gate-inner">
          <div className="brand gate-brand">
            <IconMark size={22} />
            Loadbearing
          </div>
          <h1>Learn architecture by building it.</h1>
          <p className="lede">
            Draw a system, push real traffic through it and watch exactly where it breaks. Then fix it — and have
            the fix argued with.
          </p>

          <div className="seg" role="tablist" aria-label="Account">
            <span className="seg-ind" style={{ transform: mode === 'login' ? 'translateX(0)' : 'translateX(100%)' }} />
            <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'on' : ''}
              onClick={() => setMode('register')}
            >
              Create an account
            </button>
          </div>

          <form
            className="gate-fields"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void go();
            }}
          >
            <div>
              <label htmlFor="lb-user">Username</label>
              <input
                id="lb-user"
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3–32 letters and digits"
              />
            </div>
            <div>
              <label htmlFor="lb-pass">Password</label>
              <input
                id="lb-pass"
                type="password"
                value={password}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 8 characters' : ''}
              />
            </div>

            {problem && (
              <div className="banner error" style={{ boxShadow: 'none', margin: 0 }}>
                <strong>{problem.message}</strong>
                {problem.hint ? <div style={{ marginTop: 3 }}>{problem.hint}</div> : null}
              </div>
            )}

            <button className="primary gate-submit" type="submit" disabled={!ready}>
              {busy ? <span className="spinner" /> : null}
              {mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="gate-note">
            {houseKey
              ? 'This instance has a grader model of its own, so reviews work straight away. Add your own key later to use your account instead.'
              : 'No email, nothing to verify. After signing in, add a grader model — Anthropic, or anything OpenAI-compatible such as Groq, DeepSeek, OpenAI or a local Ollama. Drawing and simulating need no key at all.'}
            {storageKind ? <span className="mono"> · storage: {storageKind}</span> : null}
          </p>
        </div>
      </section>
      <GateArt />
    </>
  );
}

/**
 * A system working, on the right of the sign-in: requests leave the shoppers,
 * the cache answers most of them, the rest reach Postgres. Decoration on a page
 * seen once, so it may move — and stops for anyone who asked for less motion.
 */
function GateArt() {
  return (
    <aside className="gate-art" aria-hidden="true">
      <div className="gate-bench">
        <svg viewBox="0 0 520 340" className="gate-svg">
          <path id="g-ua" className="g-cable" d="M140 190 C 165 194, 175 194, 196 190" />
          <path id="g-ac" className="g-cable" d="M270 160 C 270 110, 300 86, 330 86" />
          <path id="g-ad" className="g-cable" d="M344 190 C 372 196, 384 196, 402 190" />
          {[0, 0.3, 0.6, 0.9, 1.2].map((d) => (
            <circle key={`u${d}`} r="3" className="g-dot">
              <animateMotion dur="1.5s" begin={`${d}s`} repeatCount="indefinite">
                <mpath href="#g-ua" />
              </animateMotion>
            </circle>
          ))}
          {[0.15, 0.45, 0.75, 1.05, 1.35].map((d) => (
            <circle key={`c${d}`} r="3" className="g-dot">
              <animateMotion dur="1.5s" begin={`${d}s`} repeatCount="indefinite">
                <mpath href="#g-ac" />
              </animateMotion>
            </circle>
          ))}
          {[0.5].map((d) => (
            <circle key={`d${d}`} r="3" className="g-dot">
              <animateMotion dur="1.5s" begin={`${d}s`} repeatCount="indefinite">
                <mpath href="#g-ad" />
              </animateMotion>
            </circle>
          ))}
        </svg>
        <div className="g-node" style={{ left: '4%', top: '47%' }}>
          <b>Shoppers</b>
          <span className="mono">1,200/s</span>
        </div>
        <div className="g-node" style={{ left: '38%', top: '47%' }}>
          <b>Product API</b>
          <span className="mono">37% busy</span>
          <i className="g-meter" style={{ ['--v' as string]: '0.37' }} />
        </div>
        <div className="g-node" style={{ left: '63%', top: '16%' }}>
          <b>Redis</b>
          <span className="mono">92% hits</span>
          <i className="g-meter" style={{ ['--v' as string]: '0.03' }} />
        </div>
        <div className="g-node" style={{ left: '77%', top: '47%' }}>
          <b>Postgres</b>
          <span className="mono">12% busy</span>
          <i className="g-meter" style={{ ['--v' as string]: '0.12' }} />
        </div>
        <div className="g-verdict">
          <span className="g-pill">Lunch rush · pass</span>
          <span className="mono">0% dropped · $470 / month</span>
        </div>
      </div>
    </aside>
  );
}
