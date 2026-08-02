// A thin client for the Loadbearing HTTP API, holding an API token.
//
// The MCP server talks to a running Loadbearing rather than to its database. That is
// deliberate: every rule about what a design may contain, what a problem must look
// like and how the engine behaves lives behind those routes, and a second process
// reaching around them would be a second implementation of all of it, free to drift.

import type { CanvasDoc, GraphDSL, LibraryNote, Problem, ProblemSummary, SimConfig, SimResult } from '@loadbearing/shared';

export class LoadbearingError extends Error {
  constructor(
    message: string,
    public status: number,
    public hint?: string,
  ) {
    super(message);
    this.name = 'LoadbearingError';
  }
}

interface ApiErrorBody {
  error?: { message?: string; hint?: string };
}

/** How a request actually gets made. Swappable so the deployment can answer itself. */
export type Fetcher = (input: Request) => Promise<Response>;

export class LoadbearingClient {
  /**
   * @param fetchImpl Defaults to the network. Inside the deployment the Hono app is
   * passed instead, so a tool call is a function call rather than a request the
   * server makes to itself over a socket — which would need to know its own public
   * URL, would spend a second function invocation, and would fail in exactly the
   * situations where the first one already had trouble.
   */
  constructor(
    private baseUrl: string,
    private token: string,
    private fetchImpl: Fetcher = (request) => fetch(request),
  ) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        new Request(`${this.baseUrl}/api${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.token}`,
            ...(init.headers ?? {}),
          },
        }),
      );
    } catch (e) {
      // The most common failure by far, and one whose default message ("fetch
      // failed") tells the caller nothing about what to do.
      throw new LoadbearingError(
        `Cannot reach Loadbearing at ${this.baseUrl}.`,
        0,
        `Is it running? ${(e as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
      throw new LoadbearingError(
        body.error?.message ?? `${res.status} from ${path}`,
        res.status,
        body.error?.hint,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  whoAmI = () => this.req<{ username: string }>('/auth/me');

  problems = () => this.req<ProblemSummary[]>('/problems');

  problem = (id: string) => this.req<Problem>(`/problems/${encodeURIComponent(id)}`);

  addProblem = (problem: unknown) =>
    this.req<Problem>('/problems', { method: 'POST', body: JSON.stringify(problem) });

  design = (problemId: string) =>
    this.req<{ doc: CanvasDoc | null }>(`/designs/${encodeURIComponent(problemId)}`);

  /** The document IS the body — GET wraps it in `{ doc }`, PUT does not. */
  saveDesign = (problemId: string, doc: CanvasDoc) =>
    this.req<{ ok: true }>(`/designs/${encodeURIComponent(problemId)}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    });

  simulate = (graph: GraphDSL, config: Partial<SimConfig>) =>
    this.req<SimResult>('/simulate', { method: 'POST', body: JSON.stringify({ graph, config }) });

  noteLibrary = () => this.req<{ notes: LibraryNote[] }>('/notes/library');

  addNote = (scope: 'sheet' | 'project', scopeId: string, title: string, body: string) =>
    this.req<{ id: string }>('/notes', {
      method: 'POST',
      body: JSON.stringify({ scope, scopeId, title, body }),
    });
}
