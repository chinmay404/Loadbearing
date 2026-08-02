import { ARCH_NODE_TYPES, CONCEPTS } from '@loadbearing/shared';
import type { LoadScenario, Problem, ProblemDiagram } from '@loadbearing/shared';

const CONCEPT_SET = new Set<string>(CONCEPTS);
const NODE_TYPE_SET = new Set<string>(ARCH_NODE_TYPES);
const EDGE_KINDS = new Set(['sync', 'async', 'replication']);
const FLOW_KINDS = new Set(['read', 'write', 'async', 'admin']);

export class ProblemShapeError extends Error {
  constructor(public problems: string[]) {
    super(`Generated problem was unusable: ${problems.join('; ')}`);
    this.name = 'ProblemShapeError';
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

export function validateProblem(raw: unknown): Problem {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) throw new ProblemShapeError(['not an object']);
  const o = raw as Record<string, unknown>;

  const id = str(o.id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) problems.push('missing id');

  const levelNum = Math.round(Number(o.level));
  const level = (levelNum >= 1 && levelNum <= 6 ? levelNum : 3) as Problem['level'];

  const prompt = str(o.prompt).trim();
  if (prompt.length < 40) problems.push('prompt too short to be a real problem');

  const concepts = strArray(o.concepts).filter((c) => CONCEPT_SET.has(c));
  if (concepts.length === 0) problems.push('no valid concept ids');

  const functional = strArray(o.functional);
  if (functional.length === 0) problems.push('no functional requirements');

  const nonFunctional: Record<string, string | number> = {};
  const rawNf = (o.nonFunctional ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawNf)) {
    if (typeof v === 'number' || typeof v === 'string') nonFunctional[k] = v;
  }

  const twists = strArray(o.twists);
  if (twists.length === 0) problems.push('no twists');

  const scenarios: LoadScenario[] = (Array.isArray(o.scenarios) ? o.scenarios : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s, i) => {
      const mult = Number(s.rpsMultiplier);
      const latency = Number(s.thirdPartyLatencyMs);
      return {
        id: str(s.id, `scenario-${i + 1}`),
        name: str(s.name, `Scenario ${i + 1}`),
        description: str(s.description),
        rpsMultiplier: Number.isFinite(mult) && mult > 0 ? Math.min(mult, 1000) : 1,
        killNodes: strArray(s.killNodes),
        thirdPartyLatencyMs: Number.isFinite(latency) ? Math.max(0, Math.min(latency, 60000)) : 0,
        passCriteria: str(s.passCriteria),
      };
    });

  if (problems.length) throw new ProblemShapeError(problems);

  // A diagram is optional and never worth failing a problem over: a brief with no
  // picture is a brief, whereas a brief rejected because an agent got one edge
  // endpoint wrong is nothing at all.
  const diagram = validateDiagram(o.diagram);
  const kind = o.kind === 'lab' && diagram ? ('lab' as const) : ('design' as const);

  return {
    ...(diagram ? { diagram, kind } : {}),
    id,
    title: str(o.title, id),
    level,
    domain: str(o.domain, 'general'),
    prompt,
    functional,
    nonFunctional,
    constraints: strArray(o.constraints),
    concepts,
    expectedFlows: strArray(o.expectedFlows),
    rubricHints: str(o.rubricHints),
    twists,
    scenarios,
    custom: true,
  };
}

/**
 * Salvage a diagram, or return nothing.
 *
 * The rule throughout is drop rather than reject: an unknown node type, an edge to a
 * key that does not exist, a flow step naming a box nobody drew — each of those is
 * discarded on its own, and the rest of the picture survives. Only a diagram with
 * fewer than two nodes left is worthless, because a single box is not an
 * architecture.
 */
export function validateDiagram(raw: unknown): ProblemDiagram | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  const nodes: ProblemDiagram['nodes'] = [];
  for (const item of rawNodes) {
    if (typeof item !== 'object' || item === null) continue;
    const n = item as Record<string, unknown>;
    const key = str(n.key).trim();
    const type = str(n.type).trim();
    if (!key || !NODE_TYPE_SET.has(type)) continue;
    if (nodes.some((existing) => existing.key === key)) continue;
    const at = (n.at ?? {}) as Record<string, unknown>;
    const size = (n.size ?? {}) as Record<string, unknown>;
    nodes.push({
      key,
      type: type as ProblemDiagram['nodes'][number]['type'],
      label: str(n.label, key),
      annotation: str(n.annotation),
      at: { x: num(at.x), y: num(at.y) },
      ...(num(size.w) > 0 && num(size.h) > 0
        ? { size: { w: num(size.w), h: num(size.h) } }
        : {}),
      ...(typeof n.parent === 'string' ? { parent: n.parent } : {}),
      ...(typeof n.attrs === 'object' && n.attrs !== null
        ? { attrs: n.attrs as ProblemDiagram['nodes'][number]['attrs'] }
        : {}),
    });
  }
  if (nodes.length < 2) return undefined;

  const keys = new Set(nodes.map((n) => n.key));
  // A parent naming a box that did not survive would place the child at the origin.
  for (const n of nodes) if (n.parent && !keys.has(n.parent)) delete n.parent;

  const edges = (Array.isArray(o.edges) ? o.edges : [])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .filter((e) => keys.has(str(e.from)) && keys.has(str(e.to)) && EDGE_KINDS.has(str(e.kind)))
    .map((e) => ({
      from: str(e.from),
      to: str(e.to),
      kind: str(e.kind) as ProblemDiagram['edges'][number]['kind'],
      ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
    }));

  const flows = (Array.isArray(o.flows) ? o.flows : [])
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: str(f.name, 'flow'),
      kind: (FLOW_KINDS.has(str(f.kind)) ? str(f.kind) : 'read') as ProblemDiagram['flows'][number]['kind'],
      steps: strArray(f.steps).filter((s) => keys.has(s)),
      rps: Math.max(0, num(f.rps)),
      description: str(f.description),
    }))
    // A one-step flow is not a path through anything.
    .filter((f) => f.steps.length >= 2);

  const caption = str(o.caption).trim();
  return { name: str(o.name, caption || 'Starting architecture'), caption, nodes, edges, flows };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Used by the bank test: a stricter check for hand-written seed content. */
export function auditSeedProblem(p: Problem): string[] {
  const issues: string[] = [];
  if (!/^l[1-6]-[a-z0-9-]+$/.test(p.id)) issues.push(`${p.id}: id should look like l3-flash-sale`);
  if (!p.id.startsWith(`l${p.level}-`)) issues.push(`${p.id}: id prefix does not match level ${p.level}`);
  if (p.prompt.trim().length < 120) issues.push(`${p.id}: prompt is thin`);
  if (p.functional.length < 3) issues.push(`${p.id}: fewer than 3 functional requirements`);
  if (Object.keys(p.nonFunctional).length < 3) issues.push(`${p.id}: fewer than 3 non-functional numbers`);
  if (p.constraints.length < 2) issues.push(`${p.id}: fewer than 2 constraints`);
  if (p.concepts.length < 4) issues.push(`${p.id}: fewer than 4 rubric concepts`);
  for (const c of p.concepts) if (!CONCEPT_SET.has(c)) issues.push(`${p.id}: unknown concept "${c}"`);
  if (p.expectedFlows.length < 2) issues.push(`${p.id}: fewer than 2 expected flows`);
  if (p.rubricHints.trim().length < 80) issues.push(`${p.id}: rubricHints too vague`);
  if (p.twists.length < 2) issues.push(`${p.id}: fewer than 2 twists`);
  if (p.scenarios.length < 2) issues.push(`${p.id}: fewer than 2 load scenarios`);
  for (const s of p.scenarios) {
    if (!s.passCriteria.trim()) issues.push(`${p.id}/${s.id}: missing passCriteria`);
    if (!(s.rpsMultiplier > 0)) issues.push(`${p.id}/${s.id}: rpsMultiplier must be > 0`);
  }
  issues.push(...auditSeedDiagram(p));
  return issues;
}

/**
 * A lab's diagram is not decoration — it is the sheet you start on, and a broken one
 * puts a broken design on somebody's canvas. So it is checked the way the problem
 * text is: every reference resolves, every box says something, and the thing is
 * actually connected rather than a scatter of unrelated components.
 */
function auditSeedDiagram(p: Problem): string[] {
  const issues: string[] = [];
  if (p.kind === 'lab' && !p.diagram) issues.push(`${p.id}: a lab with no starting architecture`);
  const d = p.diagram;
  if (!d) return issues;

  if (!d.caption.trim()) issues.push(`${p.id}: diagram has no caption`);
  if (d.nodes.length < 3) issues.push(`${p.id}: diagram has fewer than 3 components`);

  const keys = new Set<string>();
  for (const n of d.nodes) {
    if (keys.has(n.key)) issues.push(`${p.id}: duplicate diagram key "${n.key}"`);
    keys.add(n.key);
    if (!NODE_TYPE_SET.has(n.type)) issues.push(`${p.id}: unknown component type "${n.type}"`);
    if (n.parent && !keys.has(n.parent) && !d.nodes.some((o) => o.key === n.parent)) {
      issues.push(`${p.id}: "${n.key}" is inside "${n.parent}", which is not in the diagram`);
    }
    // The annotation is where the defect lives; a box without one teaches nothing.
    if (n.type !== 'group' && !n.annotation.trim() && !isPlainEdgeComponent(n.type)) {
      issues.push(`${p.id}: "${n.key}" has no annotation`);
    }
  }

  const connected = new Set<string>();
  for (const e of d.edges) {
    if (!keys.has(e.from)) issues.push(`${p.id}: edge from unknown "${e.from}"`);
    if (!keys.has(e.to)) issues.push(`${p.id}: edge to unknown "${e.to}"`);
    connected.add(e.from);
    connected.add(e.to);
  }
  for (const n of d.nodes) {
    // A boundary is connected through its members, not by an edge of its own.
    if (n.type === 'group' || d.nodes.some((o) => o.parent === n.key)) continue;
    if (n.parent) continue;
    if (!connected.has(n.key)) issues.push(`${p.id}: "${n.key}" is drawn but connected to nothing`);
  }

  for (const f of d.flows) {
    if (f.steps.length < 2) issues.push(`${p.id}: flow "${f.name}" is not a path`);
    for (const s of f.steps) {
      if (!keys.has(s)) issues.push(`${p.id}: flow "${f.name}" steps through unknown "${s}"`);
    }
  }
  if (p.kind === 'lab' && d.flows.length < 2) {
    issues.push(`${p.id}: a lab should arrive with at least 2 flows already declared`);
  }
  // Without a source the engine has nothing to offer the design, and every gate on
  // the sheet would read zero the moment it loaded.
  if (p.kind === 'lab' && !d.nodes.some((n) => (n.attrs?.trafficRps ?? 0) > 0)) {
    issues.push(`${p.id}: no component in the diagram is where traffic starts`);
  }
  return issues;
}

/** Plumbing whose presence is the whole statement; a note would only repeat the label. */
const isPlainEdgeComponent = (type: string): boolean =>
  type === 'load_balancer' || type === 'dns' || type === 'cdn';
