// Where the drawing and the code disagree.
//
// This is the single most useful sentence the feature can produce, and it only
// becomes possible once a node is bound to a piece of code: "you drew a queue
// between the API and the model, but the bound handler calls it inline and waits."
// Without bindings it would be guesswork; with them it is arithmetic.
//
// Findings come out as TopologyFinding, the same shape the twenty-two structural
// rules already emit, so the Checks tab renders them with no changes and the
// grader receives them in the slot it already respects. A new panel would have
// been easier and would have taught the learner that these are a different, softer
// kind of truth. They are not.

import type { GraphDSL, GraphNode } from '../types.js';
import type { Severity, TopologyFinding } from '../compatibility.js';
import { BUFFER_TYPES } from '../compatibility.js';
import type { Binding, RepoScan, TraceSummary } from './types.js';

export interface DivergenceInput {
  graph: GraphDSL;
  scan: RepoScan;
  bindings: Binding[];
  trace?: TraceSummary;
}

/**
 * Compare what is drawn against what was scanned.
 *
 * Every rule here needs a binding to fire. An unbound canvas produces no findings
 * at all, which is correct: without the correspondence there is no claim to make,
 * and inventing one would mean accusing somebody of a mismatch between their
 * drawing and a piece of code they never said it represented.
 */
export function checkAgainstCode(input: DivergenceInput): TopologyFinding[] {
  const { graph, scan, bindings, trace } = input;
  const out: TopologyFinding[] = [];
  if (bindings.length === 0) return out;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const boundNode = (codeRef: string): GraphNode | undefined => {
    const b = bindings.find((x) => x.codeRef === codeRef);
    return b ? nodeById.get(b.nodeId) : undefined;
  };

  const add = (
    severity: Severity,
    rule: string,
    message: string,
    fix: string,
    nodeIds: string[],
    concept?: string,
  ) => out.push({ severity, rule, message, fix, nodeIds, edgeIds: [], ...(concept ? { concept } : {}) });

  // 1 ------------------------------------------- drawn async, called synchronously ---
  //
  // The mismatch that matters most on a vibe-coded AI app: the design shows a queue
  // in front of the model, the code awaits it inside the request.
  for (const ai of scan.ai) {
    const node = boundNode(`component:${ai.id}`);
    if (!node) continue;
    const upstream = graph.edges.filter((e) => e.to === node.id);
    const buffered = upstream.some((e) => {
      const from = nodeById.get(e.from);
      return e.kind === 'async' || (from ? BUFFER_TYPES.has(from.type) : false);
    });
    if (!buffered) continue;

    const calledInline = scan.endpoints.some((e) => e.touches.includes(ai.id));
    if (calledInline) {
      add(
        'error',
        'drawn-async-called-sync',
        `${node.label} is drawn behind a queue, but your handler calls it directly and waits for the answer.`,
        'Either move the call behind the queue in code — enqueue, return an id, deliver the result later — or redraw it as the synchronous call it currently is. The design and the code cannot both be right.',
        [node.id],
        'async-messaging',
      );
    }
  }

  // 2 ---------------------------------------------- drawn protection that is absent ---
  for (const node of graph.nodes) {
    if (node.type !== 'rate_limiter' && node.type !== 'guardrail' && node.type !== 'waf') continue;
    const bound = bindings.some((b) => b.nodeId === node.id);
    if (bound) continue;
    const existsInCode = [...scan.externals, ...scan.ai, ...scan.datastores].some(
      (d) => d.nodeType === node.type,
    );
    if (existsInCode) continue;
    add(
      'warning',
      'drawn-protection-not-in-code',
      `${node.label} is on the diagram, but nothing in the scanned repository implements it.`,
      'Add it in code before you rely on it, or take it off the drawing. A protection that exists only on the diagram is the most expensive kind — it stops anyone looking for the real one.',
      [node.id],
    );
  }

  // 3 --------------------------------------------- endpoints that were never drawn ---
  const drawnEntry = graph.nodes.filter((n) => n.type === 'service' || n.type === 'monolith' || n.type === 'serverless_fn');
  const boundEndpoints = new Set(
    bindings.filter((b) => b.codeRef.startsWith('endpoint:')).map((b) => b.codeRef.slice('endpoint:'.length)),
  );
  const unguarded = scan.endpoints.filter((e) => e.authGuard === 'none' && e.touches.length > 0);
  if (drawnEntry.length > 0 && unguarded.length > 0 && boundEndpoints.size > 0) {
    const missing = unguarded.filter((e) => !boundEndpoints.has(e.id));
    if (missing.length > 0) {
      add(
        'info',
        'endpoints-not-represented',
        `${missing.length} endpoint(s) that touch your data have no sign-in check and are not represented on the diagram: ${missing.slice(0, 3).map((e) => `${e.method} ${e.path}`).join(', ')}${missing.length > 3 ? '…' : ''}.`,
        'A design that only draws the paths you remembered will only protect the paths you remembered. Bind them or draw them.',
        drawnEntry.map((n) => n.id),
      );
    }
  }

  // 4 ---------------------------------------------- measured latency vs the drawing ---
  if (trace) {
    for (const observed of trace.components) {
      const node = boundNode(`trace:${observed.ref}`) ?? boundNode(observed.ref);
      if (!node) continue;
      const drawn = node.attrs?.latencyMs;
      if (typeof drawn !== 'number' || drawn <= 0) continue;
      // Only shout when the drawing is optimistic by a lot. A design that assumed
      // slower than reality is conservative, not wrong.
      if (observed.p95Ms > drawn * 3 && observed.p95Ms - drawn > 100) {
        add(
          'error',
          'measured-slower-than-drawn',
          `${node.label} is drawn at ${drawn}ms, but your own trace measured a 95th percentile of ${observed.p95Ms}ms across ${observed.calls} call(s).`,
          `Set the service time to what you measured. Every latency and utilisation number downstream of this box is currently computed from a figure your application has already disproved.`,
          [node.id],
          'latency-budget',
        );
      }
    }
  }

  // 5 ------------------------------------------- a datastore in code, absent on paper ---
  for (const store of scan.datastores) {
    if (store.confidence !== 'observed') continue;
    const bound = bindings.some((b) => b.codeRef === `component:${store.id}`);
    if (bound) continue;
    const drawnSameType = graph.nodes.some((n) => n.type === store.nodeType);
    if (drawnSameType) continue;
    add(
      'warning',
      'datastore-missing-from-drawing',
      `Your code talks to ${store.label}, and nothing like it is on the diagram.`,
      'Draw it. A design that omits a datastore omits its backups, its connection limit and its blast radius along with it.',
      [],
    );
  }

  return out;
}

/**
 * The facts the grader must respect, rendered for a prompt.
 *
 * Deliberately plain text and deliberately short: this sits alongside the
 * simulator output and the gate results in the same block, and a wall of scan
 * detail would crowd out the numbers the model is worse at inventing.
 */
export function scanFactsForGrader(scan: RepoScan, bindings: Binding[] = []): string {
  const lines: string[] = [];
  lines.push(`Scanned repository: ${scan.projectName}.`);
  lines.push(`Shape: ${scan.shape.verdict} — ${scan.shape.why}`);
  if (scan.endpoints.length) {
    const unguarded = scan.endpoints.filter((e) => e.authGuard === 'none').length;
    lines.push(
      `${scan.endpoints.length} endpoint(s) found; ${unguarded} with no sign-in check detected.`,
    );
  }
  const named = (list: { label: string }[]) => list.map((d) => d.label).join(', ') || 'none';
  lines.push(`Datastores in code: ${named(scan.datastores)}.`);
  lines.push(`External services in code: ${named(scan.externals)}.`);
  lines.push(`AI components in code: ${named(scan.ai)}.`);

  const critical = scan.exposures.filter((e) => e.severity === 'critical');
  if (critical.length) {
    lines.push('');
    lines.push('Exposures found by deterministic analysis, which you must treat as established:');
    for (const e of critical.slice(0, 8)) {
      lines.push(`- [${e.severity}] ${e.title} (${e.source}, ${e.confidence})`);
    }
  }
  if (bindings.length) {
    lines.push('');
    lines.push(
      `${bindings.length} component(s) on the canvas are bound to specific code. Where the drawing contradicts the scan, say so plainly rather than praising the drawing.`,
    );
  }
  if (scan.coverage.partial || scan.coverage.notes.length) {
    lines.push('');
    lines.push('Limits of this scan — do not assert beyond them:');
    for (const n of scan.coverage.notes) lines.push(`- ${n}`);
  }
  return lines.join('\n');
}
