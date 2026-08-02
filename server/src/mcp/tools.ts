// What Loadbearing exposes over MCP.
//
// A chatbot elsewhere — Claude, an agent in an editor, whatever — can look at what is
// drawn on a sheet, change it, run the load engine over the result, and add problems
// to the bank. Not as a screen-scrape: as the same API the app itself uses,
// authenticated by a token you minted and can revoke.
//
// Deliberately separate from any transport. The same table and the same dispatch
// serve the stdio server a client launches locally and the HTTP endpoint the
// deployment exposes, so a capability cannot exist over one and not the other.
//
// Every tool goes through the HTTP API rather than the database. Over stdio that is a
// real call to a running Loadbearing; inside the deployment it is the same Hono app
// answering itself with no socket involved. Either way the rules about what a design
// may contain and what a problem must look like are enforced in exactly one place.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { docFromBlueprint, graphFromDoc, type CanvasDoc } from '@loadbearing/shared';
import { LoadbearingClient, LoadbearingError } from './client.js';
import { renderGraph, renderProblem, renderSim } from './render.js';

export const TOOLS: Tool[] = [
  {
    name: 'list_sheets',
    description:
      'List the design problems and labs available, with level, domain and concepts. A lab starts with an architecture already drawn; a design problem starts blank. Use this to find a sheet id for the other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Only this level, 1 (fundamentals) to 6 (AI systems).' },
        kind: { type: 'string', enum: ['design', 'lab'], description: 'Only blank sheets, or only labs.' },
        search: { type: 'string', description: 'Case-insensitive match on title, domain or concept.' },
      },
    },
  },
  {
    name: 'get_sheet',
    description:
      'The full brief for one sheet: the prompt, requirements, numbers, constraints, the flows it expects, and every load scenario it must survive. For a lab, also the starting architecture. The marking rubric is deliberately not included.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Sheet id, from list_sheets.' } },
      required: ['id'],
    },
  },
  {
    name: 'read_canvas',
    description:
      'What is currently drawn on a sheet: every component with its parameters, every connection, and every flow declared. Read this before changing anything.',
    inputSchema: {
      type: 'object',
      properties: { sheetId: { type: 'string' }, format: { type: 'string', enum: ['prose', 'json'] } },
      required: ['sheetId'],
    },
  },
  {
    name: 'write_canvas',
    description:
      'Replace what is drawn on a sheet with a new document. This overwrites — read_canvas with format "json" first, change what you mean to change, and send the whole thing back. Node ids must be unique; an edge naming a node that is not present is dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        sheetId: { type: 'string' },
        doc: {
          type: 'object',
          description:
            'A canvas document: { nodes: [{id, type, label, annotation, attrs, position:{x,y}}], edges: [{id, from, to, kind, label}], stickies: [], strokes: [], flows: [{id, name, kind, steps, rps, description}] }.',
        },
      },
      required: ['sheetId', 'doc'],
    },
  },
  {
    name: 'place_starting_architecture',
    description:
      'Put a lab\'s starting architecture onto its canvas. A lab is a sheet that begins with a design already drawn and something wrong in it; opening it in the browser places that automatically, but a caller working through the API has to ask. Refuses if anything is already drawn, so it cannot destroy work.',
    inputSchema: {
      type: 'object',
      properties: { sheetId: { type: 'string' } },
      required: ['sheetId'],
    },
  },
  {
    name: 'run_engine',
    description:
      'Run the load engine over what is drawn on a sheet and report what happens: which flows complete, where traffic stops, what saturates, and what it costs per month. Optionally run one of the sheet\'s own scenarios, or a load multiple and a list of components to take offline.',
    inputSchema: {
      type: 'object',
      properties: {
        sheetId: { type: 'string' },
        scenario: {
          type: 'string',
          description: 'Scenario id from get_sheet. Sets the load multiple and the kills for you.',
        },
        rpsMultiplier: { type: 'number', description: 'Multiply every flow\'s baseline load. Default 1.' },
        kill: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component labels or ids to take offline for the run.',
        },
        thirdPartyLatencyMs: { type: 'number', description: 'Extra latency on every third-party call.' },
      },
      required: ['sheetId'],
    },
  },
  {
    name: 'add_sheet',
    description:
      'Add a problem or lab to this account\'s bank. Held to the same shape as everything else: id like "l3-my-problem", a level 1-6, a prompt, functional requirements, non-functional numbers, constraints, concept ids, expected flows, rubric hints, at least two twists and at least two load scenarios. Pass kind:"lab" with a diagram to make it start with an architecture already drawn.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'object', description: 'The whole problem object. See the description for the shape.' },
      },
      required: ['problem'],
    },
  },
  {
    name: 'search_notes',
    description:
      'Search everything written across every sheet and project. Returns the matching notes with where each was written.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Leave empty for the most recent notes.' } },
    },
  },
  {
    name: 'add_note',
    description: 'Write a note against a sheet or a project. Notes sit beside the drawing and are not graded.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['sheet', 'project'] },
        scopeId: { type: 'string', description: 'A sheet id, or a project id.' },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown.' },
      },
      required: ['scope', 'scopeId', 'title'],
    },
  },
];

/**
 * A Server wired to the tools, ready for whichever transport is connecting.
 *
 * One per connection rather than one shared instance. Over stdio there is exactly one
 * connection for the life of the process; over HTTP each request is its own short
 * conversation carrying its own credential. A shared instance would have to be told
 * whose it is on every call, which is the kind of thing that is wrong once and then
 * wrong for everybody.
 */
export function mcpServer(client: LoadbearingClient): Server {
  const server = new Server({ name: 'loadbearing', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      return {
        content: [{ type: 'text' as const, text: await dispatch(client, request.params.name, args) }],
      };
    } catch (e) {
      // Errors come back as content rather than as a protocol error: the caller is a
      // model, and "that sheet id does not exist, here are the ones that do" is
      // something it can act on, where a transport failure is not.
      const message =
        e instanceof LoadbearingError
          ? `${e.message}${e.hint ? `\n\n${e.hint}` : ''}`
          : `${(e as Error).message}`;
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  });

  return server;
}

async function dispatch(
  client: LoadbearingClient,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (tool) {
    case 'list_sheets':
      return listSheets(client, args);
    case 'get_sheet':
      return renderProblem(await client.problem(str(args.id)));
    case 'read_canvas':
      return readCanvas(client, args);
    case 'write_canvas':
      return writeCanvas(client, args);
    case 'place_starting_architecture':
      return placeStarter(client, args);
    case 'run_engine':
      return runEngine(client, args);
    case 'add_sheet':
      return addSheet(client, args);
    case 'search_notes':
      return searchNotes(client, args);
    case 'add_note':
      return addNote(client, args);
    default:
      return `No such tool: ${tool}`;
  }
}

async function listSheets(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const all = await client.problems();
  const search = str(args.search).toLowerCase();
  const shown = all.filter((p) => {
    if (typeof args.level === 'number' && p.level !== args.level) return false;
    if (args.kind && (p.kind ?? 'design') !== args.kind) return false;
    if (!search) return true;
    return `${p.title} ${p.domain} ${p.concepts.join(' ')}`.toLowerCase().includes(search);
  });

  if (shown.length === 0) return `Nothing matches. There are ${all.length} sheets in total.`;

  const byLevel = new Map<number, typeof shown>();
  for (const p of shown) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);

  const lines = [`${shown.length} of ${all.length} sheets.`];
  for (const level of [...byLevel.keys()].sort()) {
    lines.push('', `## Level ${level}`);
    for (const p of byLevel.get(level)!) {
      lines.push(
        `- **${p.title}**${p.kind === 'lab' ? ' [lab]' : ''}${p.custom ? ' [yours]' : ''} — ${p.domain}` +
          `\n  id: \`${p.id}\` · ${p.concepts.join(', ')}`,
      );
    }
  }
  return lines.join('\n');
}

async function readCanvas(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const sheetId = str(args.sheetId);
  const { doc } = await client.design(sheetId);
  if (args.format === 'json') return JSON.stringify(doc ?? emptyDoc(), null, 2);
  const graph = graphFromDoc(doc);
  return `# What is drawn on ${sheetId}\n\n${renderGraph(graph)}`;
}

async function writeCanvas(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const sheetId = str(args.sheetId);
  const doc = args.doc as CanvasDoc | undefined;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) {
    return 'That is not a canvas document — it needs at least a `nodes` array. Call read_canvas with format "json" to see the shape.';
  }
  await client.saveDesign(sheetId, {
    nodes: doc.nodes,
    edges: doc.edges ?? [],
    stickies: doc.stickies ?? [],
    strokes: doc.strokes ?? [],
    flows: doc.flows ?? [],
  });
  const graph = graphFromDoc(doc);
  return `Saved to ${sheetId}.\n\n${renderGraph(graph)}`;
}

async function placeStarter(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const sheetId = str(args.sheetId);
  const problem = await client.problem(sheetId);
  if (!problem.diagram) {
    return `${problem.title} has no starting architecture — it is a blank sheet. Draw one with write_canvas.`;
  }

  const { doc } = await client.design(sheetId);
  if ((doc?.nodes.length ?? 0) > 0) {
    return `${problem.title} already has ${doc!.nodes.length} components drawn on it, so nothing was placed. Read it with read_canvas; if you really mean to start over, write_canvas replaces it.`;
  }

  const placed = docFromBlueprint(problem.diagram);
  await client.saveDesign(sheetId, placed);
  return `Placed the starting architecture on ${sheetId}.\n\n${problem.diagram.caption}\n\n${renderGraph(graphFromDoc(placed))}`;
}

async function runEngine(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const sheetId = str(args.sheetId);
  const { doc } = await client.design(sheetId);
  const graph = graphFromDoc(doc);
  if (graph.nodes.length === 0) {
    // A lab that has never been opened is empty for a reason the caller can fix.
    const problem = await client.problem(sheetId).catch(() => null);
    return problem?.diagram
      ? `Nothing is drawn on ${sheetId} yet. It has a starting architecture — call place_starting_architecture to put it on the sheet, then run this again.`
      : `Nothing is drawn on ${sheetId}, so there is nothing to run.`;
  }
  if (graph.flows.length === 0) {
    return `${sheetId} has components but no declared flows, so the engine has no traffic to offer it. Add at least one flow naming the components a request passes through.`;
  }

  let rpsMultiplier = num(args.rpsMultiplier, 1);
  let kill = strArray(args.kill);
  let thirdPartyLatencyMs = num(args.thirdPartyLatencyMs, 0);
  let heading = `×${rpsMultiplier} load`;

  if (args.scenario) {
    const problem = await client.problem(sheetId);
    const scenario = problem.scenarios.find((s) => s.id === str(args.scenario));
    if (!scenario) {
      return `No scenario "${String(args.scenario)}" on ${sheetId}. It has: ${problem.scenarios.map((s) => s.id).join(', ')}.`;
    }
    rpsMultiplier = scenario.rpsMultiplier;
    kill = scenario.killNodes ?? [];
    thirdPartyLatencyMs = scenario.thirdPartyLatencyMs ?? 0;
    heading = `${scenario.name} — ${scenario.description}\n\nPasses when: ${scenario.passCriteria}`;
  }

  // Kills are given by label in a scenario and by either in a direct call, so both
  // are resolved here rather than making the caller look ids up.
  const killIds = graph.nodes
    .filter((n) => kill.some((k) => k.toLowerCase() === n.id.toLowerCase() || k.toLowerCase() === n.label.toLowerCase()))
    .map((n) => n.id);
  const unmatched = kill.filter(
    (k) => !graph.nodes.some((n) => k.toLowerCase() === n.id.toLowerCase() || k.toLowerCase() === n.label.toLowerCase()),
  );

  const sim = await client.simulate(graph, { rpsMultiplier, killNodeIds: killIds, thirdPartyLatencyMs });
  const notes = unmatched.length
    ? `\n\n_Nothing on this sheet is called ${unmatched.map((u) => `"${u}"`).join(' or ')}, so nothing was taken offline for those._`
    : '';
  return `${heading}\n\n${renderSim(sim, graph)}${notes}`;
}

async function addSheet(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const created = await client.addProblem(args.problem);
  return `Added **${created.title}** as \`${created.id}\`${
    created.kind === 'lab' ? ', with its starting architecture' : ''
  }. It is in this account's bank now and can be opened in the app.`;
}

async function searchNotes(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const { notes } = await client.noteLibrary();
  const terms = str(args.query).toLowerCase().split(/\s+/).filter(Boolean);
  const matched = terms.length
    ? notes.filter((n) => {
        const text = `${n.title} ${n.body} ${n.where.label}`.toLowerCase();
        return terms.every((t) => text.includes(t));
      })
    : notes.slice(0, 20);

  if (matched.length === 0) return `Nothing matches. There are ${notes.length} notes in total.`;
  return matched
    .map((n) => `## ${n.title || 'Untitled'}\n_${n.where.label}${n.where.projectName ? ` · ${n.where.projectName}` : ''}_\n\n${n.body}`)
    .join('\n\n---\n\n');
}

async function addNote(client: LoadbearingClient, args: Record<string, unknown>): Promise<string> {
  const scope = args.scope === 'project' ? 'project' : 'sheet';
  await client.addNote(scope, str(args.scopeId), str(args.title), str(args.body));
  return `Written to ${scope} ${str(args.scopeId)}.`;
}

const emptyDoc = (): CanvasDoc => ({ nodes: [], edges: [], stickies: [], strokes: [], flows: [] });
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
