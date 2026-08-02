import { useEffect, useState } from 'react';
import type { ApiToken } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconPlus } from '../ui/UiIcons';

/**
 * Credentials for things that are not this browser.
 *
 * A token is how the MCP server — or a script, or an agent on another machine — acts
 * as this account. It is deliberately not the same thing as a session: a session is a
 * signed cookie that cannot be revoked before it expires, which is fine for a tab you
 * control and unacceptable for a credential sitting in a config file somewhere.
 *
 * The secret is shown once. Nothing stores it, only its hash, so nothing can show it
 * again — which is worth saying plainly rather than letting someone find out by
 * closing the panel.
 */
export function TokensPanel() {
  const setError = useApp((s) => s.setError);
  const setNotice = useApp((s) => s.setNotice);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const reload = () =>
    api
      .apiTokens()
      .then((r) => setTokens(r.tokens))
      .catch((e) => {
        setTokens([]);
        setError({ message: (e as ApiError).message });
      });

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mint = async () => {
    if (!name.trim()) return;
    try {
      setBusy(true);
      const made = await api.createApiToken(name.trim());
      setFresh({ id: made.token.id, secret: made.secret });
      setName('');
      await reload();
    } catch (e) {
      setError({ message: (e as ApiError).message, hint: (e as ApiError).hint });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeApiToken(id);
      setConfirmRevoke(null);
      if (fresh?.id === id) setFresh(null);
      setNotice('Revoked. Anything still holding it stops working immediately.');
      await reload();
    } catch (e) {
      setError({ message: (e as ApiError).message });
    }
  };

  return (
    <div className="card">
      <h4>API tokens</h4>
      <p className="muted" style={{ fontSize: 12.5 }}>
        A token lets something outside this browser act as your account — the MCP server, a script, an
        agent on another machine. It carries the same rights you have, so give one out only where you
        would give out your password, and revoke it the moment you stop needing it.
      </p>

      <div className="row" style={{ marginTop: 8 }}>
        <input
          className="grow"
          value={name}
          placeholder="What will hold it? e.g. Claude Desktop"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void mint()}
        />
        <button className="primary" disabled={busy || !name.trim()} onClick={() => void mint()}>
          {busy ? <span className="spinner" /> : <IconPlus size={15} />} Mint
        </button>
      </div>

      {fresh && (
        <div className="banner warnb" style={{ marginTop: 10 }}>
          <strong>Copy this now.</strong> It is not stored anywhere and cannot be shown again — only its
          hash is kept, so if you lose it, revoke it and mint another.
          <pre className="token-secret mono">{fresh.secret}</pre>
          <button
            onClick={() => {
              void navigator.clipboard
                ?.writeText(fresh.secret)
                .then(() => setNotice('Token copied.'))
                .catch(() => setNotice('Could not reach the clipboard — select it and copy manually.'));
            }}
          >
            Copy
          </button>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <table className="tokens">
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono faint">{t.id}</td>
                <td className="faint">{t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used'}</td>
                <td style={{ textAlign: 'right' }}>
                  {confirmRevoke === t.id ? (
                    <span className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="danger" onClick={() => void revoke(t.id)}>
                        Revoke it
                      </button>
                      <button onClick={() => setConfirmRevoke(null)}>Keep</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmRevoke(t.id)} title="Stop this token working">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="disclose" style={{ marginTop: 10 }}>
        <summary>Pointing a chatbot at this — the MCP server</summary>
        <p className="muted" style={{ fontSize: 12.5 }}>
          The MCP server lets a chatbot read what is on your canvas, change it, run the load engine over
          the result, and add problems to your bank. Build it once with{' '}
          <span className="mono">npm run build:mcp</span>, then add this to your MCP client's config:
        </p>
        <pre className="mono config-block">
{`{
  "mcpServers": {
    "loadbearing": {
      "command": "node",
      "args": ["${mcpPath()}"],
      "env": {
        "LOADBEARING_URL": "${window.location.origin.replace(':5173', ':8787')}",
        "LOADBEARING_TOKEN": "lb_…"
      }
    }
  }
}`}
        </pre>
      </details>
    </div>
  );
}

/**
 * A best guess at where the built server landed, so the config can be copied rather
 * than assembled. It is a hint: the user knows where they cloned the repo.
 */
const mcpPath = (): string => 'D:\\\\path\\\\to\\\\loadbearing\\\\mcp\\\\dist\\\\index.js';

function ago(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(then)) return 'recently';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
