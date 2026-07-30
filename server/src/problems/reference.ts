// The model answer as an actual diagram. After a review, the learner can ask
// for ONE strong reference design for the problem and watch it carry the same
// load their own design just took. Generated once per problem, then served
// from its own table forever — the reference should not shift between visits.

import type { Hono } from 'hono';
import { ARCH_NODE_TYPES } from '@loadbearing/shared';
import type { GraphDSL } from '@loadbearing/shared';
import { db } from '../db.js';
import { cachedCompleteJson } from '../llm/cache.js';
import { loadLlmConfig } from '../llm/settings.js';
import { sanitizeGraph } from '../scoring/validate.js';
import { findProblem } from './routes.js';

let tableReady = false;

function ensureTable(): void {
  if (tableReady) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS reference_designs (
      problem_id TEXT PRIMARY KEY,
      graph_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  tableReady = true;
}

// Static text first, problem-specific data last — the prompt prefix stays
// byte-identical across problems, so provider-side prefix caching can bite.
const SYSTEM_PROMPT = `You are a principal engineer producing ONE strong reference design for a system design problem. Reply with ONLY a JSON object — no prose, no code fences — in exactly this shape:

{
  "nodes": [
    {
      "id": "kebab-case-id",
      "type": "<one of the allowed node types>",
      "label": "Short Name",
      "annotation": "The mechanism that matters: WHY this component is here and what breaks without it.",
      "attrs": { "replicas": 3, "capacityRps": 500 }
    }
  ],
  "edges": [
    { "id": "a->b", "from": "node-id", "to": "node-id", "kind": "sync", "label": "what travels here" }
  ],
  "flows": [
    {
      "id": "flow-id",
      "name": "exact expected flow name",
      "kind": "read",
      "steps": ["node-id", "node-id", "node-id"],
      "rps": 1200,
      "description": "one line on the path"
    }
  ],
  "stickies": [
    { "text": "Capacity math a reviewer would jot: e.g. 10M DAU x 5 reads/day / 86400s = ~580 rps." }
  ]
}

Rules:
- Node ids are short, unique, kebab-case. Every node carries a label and an annotation naming the mechanism that matters (the trade-off it buys, not a restatement of its type).
- Set "attrs" with realistic "replicas" and "capacityRps" ONLY where the value is load-bearing for the design (the components that would saturate first). Omit attrs elsewhere.
- Edge "kind" is "sync", "async" or "replication". Label every edge with what travels over it.
- Define EXACTLY one flow per expected flow name in the problem, using the exact names given. "kind" is "read", "write", "async" or "admin". "steps" is the ordered list of node ids the request traverses; every step id must exist in "nodes". Derive each flow's "rps" from the problem's stated numbers (DAU, peak multipliers, read/write ratios) — show that arithmetic in the stickies.
- "stickies" holds the 2-3 capacity-math notes a reviewer would jot in the margin: the back-of-envelope sums that justify the rps figures and replica counts.
- The design must MEET the problem's constraints — team size, budget, simplicity. No gold-plating: every component must earn its place under THIS problem's numbers, and a small team must be able to run it.
- The design must be simulatable: flows connected end to end through nodes that exist, with realistic capacities so it holds the problem's stated load.

Allowed node types (use these exact strings): ${ARCH_NODE_TYPES.join(', ')}`;

export function registerReferenceRoutes(r: Hono): void {
  r.post('/problems/:id/reference', async (c) => {
    const problem = findProblem(c.req.param('id'));
    if (!problem) {
      return c.json({ error: { code: 'not_found', message: 'No such problem' } }, 404);
    }

    ensureTable();
    const row = db()
      .prepare('SELECT graph_json FROM reference_designs WHERE problem_id = ?')
      .get(problem.id) as { graph_json: string } | undefined;
    if (row) {
      try {
        const graph = JSON.parse(row.graph_json) as GraphDSL;
        return c.json({ graph, cached: true });
      } catch {
        // A stored row that no longer parses is corrupt — fall through and regenerate.
      }
    }

    const user = JSON.stringify(problem);
    // Generous budget: reasoning models think before they answer, and a
    // truncated reply salvages into a useless fragment. The validate hook keeps
    // any such fragment out of the cache so a retry genuinely retries.
    const { value } = await cachedCompleteJson<unknown>(loadLlmConfig(db()), SYSTEM_PROMPT, user, {
      maxTokens: 9000,
      temperature: 0.3,
      validate: (v) => {
        const g = (v as { graph?: unknown })?.graph ?? v;
        const nodes = (g as { nodes?: unknown })?.nodes;
        const flows = (g as { flows?: unknown })?.flows;
        return Array.isArray(nodes) && nodes.length >= 3 && Array.isArray(flows) && flows.length >= 1;
      },
    });

    // Some models wrap the design in { "graph": ... } — accept both shapes.
    const graph = sanitizeGraph((value as { graph?: unknown })?.graph ?? value);
    if (graph.nodes.length === 0) {
      return c.json(
        {
          error: {
            code: 'bad_reference',
            message:
              'The model returned a reference design with no usable components. Try again — the next attempt will re-ask the model.',
          },
        },
        502,
      );
    }

    db()
      .prepare(
        `INSERT INTO reference_designs (problem_id, graph_json) VALUES (?, ?)
         ON CONFLICT(problem_id) DO UPDATE SET graph_json = excluded.graph_json, created_at = datetime('now')`,
      )
      .run(problem.id, JSON.stringify(graph));

    return c.json({ graph, cached: false });
  });
}
