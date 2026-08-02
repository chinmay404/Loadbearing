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
  const [entry, setEntry] = useState<string | null>(null);

  // Where the built server is, straight from the machine running it.
  useEffect(() => {
    void api
      .health()
      .then((h) => setEntry(h.mcpEntry ?? null))
      .catch(() => setEntry(null));
  }, []);

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

      <ConnectSteps secret={fresh?.secret ?? null} entry={entry} />
    </div>
  );
}

type Client = 'claude-connector' | 'chatgpt' | 'claude-desktop' | 'claude-code';

const CLIENTS: { id: Client; label: string; hosted: boolean }[] = [
  { id: 'claude-connector', label: 'Claude · connector', hosted: true },
  { id: 'chatgpt', label: 'ChatGPT', hosted: true },
  { id: 'claude-desktop', label: 'Claude Desktop', hosted: false },
  { id: 'claude-code', label: 'Claude Code', hosted: false },
];

/**
 * Everything needed to connect one client, ready to copy.
 *
 * Written as steps with the real values already in them rather than as documentation
 * with placeholders. A snippet containing `lb_…` and `your-deployment` is a snippet
 * somebody has to assemble by hand, and assembling by hand is where it goes wrong —
 * so the token appears in full while it still exists, and the address is a field you
 * can correct once instead of a string to find and replace in four places.
 */
function ConnectSteps({ secret, entry }: { secret: string | null; entry: string | null }) {
  const setNotice = useApp((s) => s.setNotice);
  const [client, setClient] = useState<Client>('claude-connector');
  // Remembered because it is the one thing this page cannot know: a browser on
  // localhost has no idea what the deployment is called.
  const [host, setHost] = useState(
    () => window.localStorage.getItem(HOST_KEY) ?? apiOrigin(),
  );

  const setAndRemember = (value: string) => {
    setHost(value);
    window.localStorage.setItem(HOST_KEY, value);
  };

  const base = host.replace(/\/+$/, '');
  const token = secret ?? 'lb_YOUR_TOKEN';
  const chosen = CLIENTS.find((c) => c.id === client)!;
  const local = base.includes('localhost') || base.includes('127.0.0.1');

  const copy = (what: string, label: string) => {
    void navigator.clipboard
      ?.writeText(what)
      .then(() => setNotice(`${label} copied.`))
      .catch(() => setNotice('Could not reach the clipboard — select it and copy manually.'));
  };

  const steps = buildSteps(client, base, token, entry);

  return (
    <div className="connect">
      <span className="section-label">Connect a chatbot</span>

      <div className="filter-row" style={{ marginBottom: 8 }}>
        {CLIENTS.map((c) => (
          <button key={c.id} className={client === c.id ? 'on' : ''} onClick={() => setClient(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <label className="connect-host">
        <span className="stencil">
          {chosen.hosted ? 'Address the chatbot should call' : 'Address the server should talk to'}
        </span>
        <input value={host} onChange={(e) => setAndRemember(e.target.value)} spellCheck={false} />
      </label>

      {chosen.hosted && local && (
        <div className="banner warnb">
          <strong>That address is only reachable from this machine.</strong> A hosted chatbot runs on
          somebody else's servers and cannot see your localhost — put your deployed address in the field
          above and these steps will update.
        </div>
      )}

      {!secret && (
        <div className="banner info">
          Mint a token above and these steps will fill in with it. A token already minted cannot be shown
          again, so the snippets below say <span className="mono">lb_YOUR_TOKEN</span> until you make one.
        </div>
      )}

      <ol className="connect-steps">
        {steps.map((step, i) => (
          <li key={i}>
            <p>{step.text}</p>
            {step.code && (
              <div className="connect-code">
                <pre className="mono config-block">{step.code}</pre>
                <button onClick={() => copy(step.code!, step.copyLabel ?? 'Copied')}>Copy</button>
              </div>
            )}
            {step.warn && <p className="connect-warn">{step.warn}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface Step {
  text: string;
  code?: string;
  copyLabel?: string;
  warn?: string;
}

const TOKEN_IN_URL_WARNING =
  'That URL is now the whole credential — anything holding it can act as you, and a URL ends up in logs, browser history and screenshots in a way a header never does. Use a token minted for this and nothing else, and revoke it when you are done.';

function buildSteps(client: Client, base: string, token: string, entry: string | null): Step[] {
  const path = `${base}/api/mcp/${token}`;
  const plain = `${base}/api/mcp`;
  const stdioEntry = entry ?? '/path/to/loadbearing/server/src/mcp/stdio.ts';

  switch (client) {
    case 'claude-connector':
      return [
        {
          text: 'In Claude, open Settings → Connectors and choose "Add custom connector".',
        },
        {
          text: 'Name it Loadbearing, and paste this as the remote MCP server URL.',
          code: path,
          copyLabel: 'Connector URL',
          warn: TOKEN_IN_URL_WARNING,
        },
        {
          text: 'Leave the OAuth fields empty — the token in the URL is the authentication — and press Add. The tools appear under the connector menu in a new conversation.',
        },
        {
          text: 'Try it by asking: "list the labs in Loadbearing, then run the engine on the one-box storefront".',
        },
      ];

    case 'chatgpt':
      return [
        {
          text: 'ChatGPT can set request headers, so the token does not have to go in the URL. Add a connector pointing at:',
          code: plain,
          copyLabel: 'Server URL',
        },
        {
          text: 'Give it this authorization header.',
          code: `Authorization: Bearer ${token}`,
          copyLabel: 'Header',
        },
        {
          text: 'If the connector form has no place for a header, use this URL instead and leave auth empty.',
          code: path,
          copyLabel: 'URL with token',
          warn: TOKEN_IN_URL_WARNING,
        },
      ];

    case 'claude-desktop':
      return [
        {
          text: 'Claude Desktop launches the server as a process rather than calling a URL. Open Settings → Developer → Edit Config.',
        },
        {
          text: 'Paste this. The path is already filled in for this machine; nothing needs building first.',
          code: desktopConfig(stdioEntry, base, token),
          copyLabel: 'Config',
        },
        {
          text: 'Quit Claude Desktop completely — from the tray, not just the window — and start it again.',
        },
        {
          text: 'Loadbearing must be running at the address in the config, otherwise every tool will report that it cannot reach it.',
        },
      ];

    case 'claude-code':
      return [
        {
          text: 'One command, from anywhere.',
          code: `claude mcp add loadbearing -e LOADBEARING_URL=${base} -e LOADBEARING_TOKEN=${token} -- npx tsx ${quote(stdioEntry)}`,
          copyLabel: 'Command',
        },
        {
          text: 'Check it registered with: claude mcp list',
          code: 'claude mcp list',
          copyLabel: 'Command',
        },
      ];
  }
}

/** JSON.stringify does the Windows backslashes, which hand-assembly gets wrong. */
function desktopConfig(entry: string, origin: string, token: string): string {
  return `{
  "mcpServers": {
    "loadbearing": {
      "command": "npx",
      "args": ${JSON.stringify(['tsx', entry])},
      "env": {
        "LOADBEARING_URL": ${JSON.stringify(origin)},
        "LOADBEARING_TOKEN": ${JSON.stringify(token)}
      }
    }
  }
}`;
}

/** A path with a space in it is the normal case on Windows, not an edge case. */
const quote = (path: string): string => (/\s/.test(path) ? `"${path}"` : path);

const HOST_KEY = 'loadbearing.mcp.host';

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

/** Where the API is. In dev the client is on 5173 and the server on 8787. */
const apiOrigin = (): string => window.location.origin.replace(':5173', ':8787');

