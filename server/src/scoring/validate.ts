import { CONCEPTS, DIMENSION_KEYS, ARCH_NODE_TYPES } from '@loadbearing/shared';
import type { ScoreResult, GraphDSL, CritiqueResponse } from '@loadbearing/shared';

export class ScoreShapeError extends Error {
  constructor(public problems: string[]) {
    super(`Grader returned an unusable shape: ${problems.join('; ')}`);
    this.name = 'ScoreShapeError';
  }
}

/** Sentinel the client renders as "not assessed" rather than a zero. */
export const NOT_ASSESSED = 'Not assessed — the grader omitted this dimension.';

const CONCEPT_SET = new Set<string>(CONCEPTS);
const NODE_TYPE_SET = new Set<string>(ARCH_NODE_TYPES);
const MARKERS = new Set(['spof', 'missing', 'good', 'question', 'bottleneck']);
const KINDS = new Set(['sync', 'async', 'replication']);

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/**
 * Coerces a raw LLM object into a ScoreResult. Tolerant where tolerance is safe
 * (drops unknown concepts, clamps numbers) and strict where the UI would break
 * (dimensions must exist).
 */
export function validateScore(raw: unknown, graph: GraphDSL): ScoreResult {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) throw new ScoreShapeError(['response was not an object']);
  const o = raw as Record<string, unknown>;

  const rawDims = (o.dimensions ?? {}) as Record<string, { score?: unknown; max?: unknown; notes?: unknown }>;
  const dimensions = {} as ScoreResult['dimensions'];
  const assessed: number[] = [];
  for (const key of DIMENSION_KEYS) {
    const d = rawDims[key];
    if (!d || typeof d !== 'object') {
      // Smaller models sometimes drop a dimension. Say so plainly rather than
      // scoring it zero — an omission is not a failing grade.
      problems.push(`missing dimension "${key}"`);
      dimensions[key] = { score: 0, max: 0, notes: NOT_ASSESSED };
      continue;
    }
    const score = num(d.score, 0, 10, 0);
    dimensions[key] = { score, max: 10, notes: str(d.notes, '') };
    assessed.push(score);
  }
  if (assessed.length === 0) throw new ScoreShapeError(problems);

  // Derive the overall from what was actually assessed, so a dropped dimension
  // does not silently cost the learner sixteen points.
  const avg = assessed.reduce((s, x) => s + x, 0) / assessed.length;
  const overall = num(o.overall, 0, 100, Math.round(avg * 10));

  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const critical_failures = (Array.isArray(o.critical_failures) ? o.critical_failures : [])
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      title: str(f.title, 'Unnamed failure'),
      detail: str(f.detail),
      concept: CONCEPT_SET.has(str(f.concept)) ? str(f.concept) : '',
      severity: (['high', 'medium', 'low'] as const).includes(f.severity as 'high')
        ? (f.severity as 'high' | 'medium' | 'low')
        : 'medium',
    }))
    .filter((f) => f.detail.trim() !== '' || f.title !== 'Unnamed failure');

  const concept_scores: Record<string, number> = {};
  const rawScores = (o.concept_scores ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawScores)) {
    if (!CONCEPT_SET.has(k)) continue;
    concept_scores[k] = num(v, 0, 1, 0);
  }

  const canvas_markup = (Array.isArray(o.canvas_markup) ? o.canvas_markup : [])
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({
      nodeId: str(m.nodeId),
      marker: MARKERS.has(str(m.marker)) ? (str(m.marker) as 'spof') : ('question' as const),
      comment: str(m.comment),
    }))
    .filter((m) => nodeIds.has(m.nodeId) && m.comment.trim() !== '');

  const suggested_additions = (Array.isArray(o.suggested_additions) ? o.suggested_additions : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => {
      const from = str(s.connect_from);
      const to = str(s.connect_to);
      return {
        type: NODE_TYPE_SET.has(str(s.type)) ? (str(s.type) as 'service') : ('service' as const),
        label: str(s.label, 'Suggested component'),
        annotation: str(s.annotation),
        ...(nodeIds.has(from) ? { connect_from: from } : {}),
        ...(nodeIds.has(to) ? { connect_to: to } : {}),
        kind: KINDS.has(str(s.kind)) ? (str(s.kind) as 'sync') : ('sync' as const),
        why: str(s.why),
      };
    });

  const flow_reviews = (Array.isArray(o.flow_reviews) ? o.flow_reviews : [])
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      flowName: str(f.flowName, 'unnamed flow'),
      verdict: (['sound', 'flawed', 'missing'] as const).includes(f.verdict as 'sound')
        ? (f.verdict as 'sound' | 'flawed' | 'missing')
        : 'flawed',
      issues: strArray(f.issues),
    }));

  const verdict_teaching = (Array.isArray(o.verdict_teaching) ? o.verdict_teaching : [])
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      component: str(t.component),
      why: str(t.why),
      breaks_without: str(t.breaks_without),
      rejected_alt: str(t.rejected_alt),
    }))
    .filter((t) => t.component.trim() !== '');

  const risks = (Array.isArray(o.risks) ? o.risks : [])
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      risk: str(r.risk),
      likelihood: (['high', 'medium', 'low'] as const).includes(r.likelihood as 'high')
        ? (r.likelihood as 'high' | 'medium' | 'low')
        : 'medium',
      impact: str(r.impact),
      mitigation: str(r.mitigation),
    }))
    .filter((r) => r.risk.trim() !== '');

  const alternatives = (Array.isArray(o.alternatives) ? o.alternatives : [])
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map((a) => ({ option: str(a.option), why_not: str(a.why_not) }))
    .filter((a) => a.option.trim() !== '');

  return {
    overall: Math.round(overall),
    dimensions,
    critical_failures,
    risks,
    alternatives,
    at_10x: str(o.at_10x),
    decision_summary: str(o.decision_summary),
    spofs: strArray(o.spofs),
    missing: strArray(o.missing),
    good_calls: strArray(o.good_calls),
    socratic_questions: strArray(o.socratic_questions),
    concept_scores,
    model_answer_summary: str(o.model_answer_summary),
    verdict_teaching,
    canvas_markup,
    suggested_additions,
    flow_reviews,
  };
}

export function validateCritique(raw: unknown, graph: GraphDSL): CritiqueResponse {
  if (typeof raw !== 'object' || raw === null) throw new ScoreShapeError(['critique was not an object']);
  const o = raw as Record<string, unknown>;
  const asScore = validateScore(
    {
      dimensions: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 0, max: 10, notes: '' }])),
      canvas_markup: o.canvas_markup,
      suggested_additions: o.suggested_additions,
    },
    graph,
  );
  return {
    answer: str(o.answer, 'The model returned no answer.'),
    canvas_markup: asScore.canvas_markup,
    suggested_additions: asScore.suggested_additions,
  };
}

/** Defensive: geometry and unknown keys must never reach the model. */
export function sanitizeGraph(raw: unknown): GraphDSL {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const nodes = (Array.isArray(o.nodes) ? o.nodes : [])
    .filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null)
    .map((n) => ({
      id: str(n.id),
      type: NODE_TYPE_SET.has(str(n.type)) ? (str(n.type) as 'service') : ('service' as const),
      label: str(n.label),
      annotation: str(n.annotation),
      ...(typeof n.attrs === 'object' && n.attrs !== null ? { attrs: n.attrs as Record<string, never> } : {}),
      ...(str(n.parentId) ? { parentId: str(n.parentId) } : {}),
    }))
    .filter((n) => n.id !== '');
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(o.edges) ? o.edges : [])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      id: str(e.id, `${str(e.from)}->${str(e.to)}`),
      from: str(e.from),
      to: str(e.to),
      kind: KINDS.has(str(e.kind)) ? (str(e.kind) as 'sync') : ('sync' as const),
      label: str(e.label),
    }))
    .filter((e) => ids.has(e.from) && ids.has(e.to));
  const stickies = (Array.isArray(o.stickies) ? o.stickies : [])
    .map((s) => ({ text: str((s as Record<string, unknown>)?.text) }))
    .filter((s) => s.text.trim() !== '');
  const flows = (Array.isArray(o.flows) ? o.flows : [])
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f, i) => ({
      id: str(f.id, `flow-${i}`),
      name: str(f.name, `flow ${i + 1}`),
      kind: (['read', 'write', 'async', 'admin'] as const).includes(f.kind as 'read')
        ? (f.kind as 'read' | 'write' | 'async' | 'admin')
        : ('read' as const),
      steps: strArray(f.steps).filter((s) => ids.has(s)),
      rps: num(f.rps, 0, 10_000_000, 10),
      description: str(f.description),
    }));
  return { nodes: nodes as GraphDSL['nodes'], edges, stickies, flows };
}
