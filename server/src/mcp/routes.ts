// MCP over HTTP, served by the deployment.
//
// A local stdio server is the easy half and it only helps somebody sitting at the
// machine that has the checkout. What a hosted chatbot needs — Claude's custom
// connectors, ChatGPT — is a URL, so this mounts the same tools at /api/mcp.
//
// Stateless on purpose. Each POST carries one JSON-RPC message, gets its own Server
// and its own credential, and is answered and forgotten. That is not a compromise
// for the serverless host so much as an admission of what it is: there is no process
// to keep a session in, and pretending otherwise would mean a session store, a
// cleanup problem, and an outage the first time two requests landed on different
// instances.
//
// The transport underneath is a dozen lines rather than the SDK's HTTP transport,
// which wants Node's req/res and a session lifecycle. The SDK still owns every piece
// of protocol semantics — initialize, capabilities, tool schemas, error shapes —
// through the Server it is connected to. Only the pipe is ours.

import { Hono } from 'hono';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { storage } from '../storage/index.js';
import { looksLikeApiToken, userForToken } from '../auth/apiToken.js';
import type { AppEnv } from '../auth/middleware.js';
import { LoadbearingClient } from './client.js';
import { mcpServer } from './tools.js';

export const mcpRoutes = new Hono<AppEnv>();

/**
 * One message in, at most one message out.
 *
 * A notification — `notifications/initialized`, say — produces no reply, which is why
 * the resolved value is nullable rather than a message that was invented to have
 * something to return.
 */
class SingleShotTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  private resolve!: (message: JSONRPCMessage | null) => void;
  private settled = false;
  readonly reply: Promise<JSONRPCMessage | null>;

  constructor() {
    this.reply = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.resolve(message);
  }

  async close(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.resolve(null);
  }

  /**
   * Hand the incoming message to the connected Server and wait for its answer.
   *
   * A notification has no id and gets no response, so waiting for one is waiting
   * forever — which is exactly what happened until a test sent
   * `notifications/initialized` and the request hung until it was killed. Deliver it
   * and return; nothing is coming.
   *
   * The timeout is for the other direction: a request the Server somehow never
   * answers would hold the function open until the platform killed it, and a
   * JSON-RPC error saying so is more use than a gateway timeout with no body.
   */
  async deliver(message: JSONRPCMessage, timeoutMs = 30_000): Promise<JSONRPCMessage | null> {
    const isNotification = !('id' in message);
    this.onmessage?.(message);
    if (isNotification) return null;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<JSONRPCMessage>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            jsonrpc: '2.0',
            id: (message as { id: string | number }).id,
            error: { code: -32603, message: `The server did not answer within ${timeoutMs}ms.` },
          } as JSONRPCMessage),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([this.reply, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The credential, from wherever this client was able to put it.
 *
 * A header is the right place and some clients cannot set one: Claude's custom
 * connector dialog takes a URL and OAuth, with nowhere to type a bearer token. So a
 * token in the path is accepted too. It is a real trade — a URL ends up in logs,
 * browser history and screenshots in a way a header does not — which is why the
 * settings panel says so rather than offering it as an equal option.
 */
function tokenFor(header: string | undefined, fromPath: string | undefined): string | null {
  if (header && /^bearer /i.test(header)) {
    const value = header.slice(7).trim();
    if (looksLikeApiToken(value)) return value;
  }
  if (fromPath && looksLikeApiToken(fromPath)) return fromPath;
  return null;
}

const unauthorised = {
  jsonrpc: '2.0' as const,
  id: null,
  error: {
    code: -32001,
    message:
      'No valid Loadbearing API token. Send one as `Authorization: Bearer lb_…`, or use the /api/mcp/<token> URL if your client cannot set headers. Mint a token under Grader model → API tokens.',
  },
};

async function handle(c: {
  req: {
    header: (name: string) => string | undefined;
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
    url: string;
  };
  json: (body: unknown, status?: number) => Response;
}): Promise<Response> {
  const challenge = (): Response => {
    const base = new URL(c.req.url).origin;
    const res = c.json(unauthorised, 401);
    res.headers.set(
      'www-authenticate',
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    );
    return res;
  };

  const token = tokenFor(c.req.header('authorization'), c.req.param('token'));
  if (!token) return challenge();

  const store = await storage();
  const userId = await userForToken(store, token);
  if (!userId) return challenge();

  const body = (await c.req.json().catch(() => null)) as JSONRPCMessage | JSONRPCMessage[] | null;
  if (!body || typeof body !== 'object') {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  // A batch is legal JSON-RPC and no MCP client has sent one here yet; handling it as
  // a sequence costs four lines and is better than a confident 400.
  const incoming = Array.isArray(body) ? body : [body];
  const origin = new URL(c.req.url).origin;
  const replies: JSONRPCMessage[] = [];

  for (const message of incoming) {
    const transport = new SingleShotTransport();
    // The app answering itself: no socket, no second function invocation, and the
    // credential travels as the same bearer header any other caller would send.
    const client = new LoadbearingClient(origin, token, async (request) => appRef!.fetch(request));
    const server = mcpServer(client);
    await server.connect(transport);
    const reply = await transport.deliver(message);
    await server.close();
    if (reply) replies.push(reply);
  }

  // Nothing to say: a notification was all that arrived. 202 rather than an empty
  // 200 body, which some clients try to parse.
  if (replies.length === 0) return new Response(null, { status: 202 });
  return c.json(Array.isArray(body) ? replies : replies[0]);
}

mcpRoutes.post('/mcp', (c) => handle(c));
mcpRoutes.post('/mcp/:token', (c) => handle(c));

/**
 * The GET half of the Streamable HTTP transport opens a server-to-client stream for
 * messages nobody asked for. This server has none to send — every answer is a reply —
 * so it says so plainly instead of holding a connection open forever.
 */
const noStream = (c: { json: (b: unknown, s?: number) => Response }) =>
  c.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'This server is request/response only; there is no event stream.' },
    },
    405,
  );

mcpRoutes.get('/mcp', noStream);
mcpRoutes.get('/mcp/:token', noStream);
mcpRoutes.delete('/mcp', (c) => c.json({ ok: true }));
mcpRoutes.delete('/mcp/:token', (c) => c.json({ ok: true }));

/**
 * The app, so a tool call can be answered in-process.
 *
 * Set by app.ts after construction rather than imported: routes.ts is imported BY
 * app.ts, and importing it back would be a cycle whose failure mode is an undefined
 * export at module-evaluation time — a crash on the first request rather than a
 * compile error.
 */
let appRef: { fetch: (request: Request) => Response | Promise<Response> } | null = null;

export function useAppForMcp(app: { fetch: (request: Request) => Response | Promise<Response> }): void {
  appRef = app;
}
