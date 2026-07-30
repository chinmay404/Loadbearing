// Retrieval over the playbook. Deterministic on purpose: the same problem and
// the same drawing must always pull the same references, or a review could pass
// on Tuesday and fail on Wednesday for reasons the learner cannot see.
//
// No embeddings, no vector store, no network call. The corpus is small and its
// entries are already tagged with the concepts and component types they apply
// to, which is a stronger signal than similarity over prose would be.

import { PLAYBOOK, type PlaybookEntry } from './playbook.js';
import type { GraphDSL, Problem } from './types.js';

/** How much each kind of evidence is worth. Concepts are the strongest signal. */
const W_CONCEPT = 4;
const W_NODE_TYPE = 3;
const W_TRIGGER = 1.5;
/** One entry cannot win on keyword spam alone. */
const MAX_TRIGGER_SCORE = 4.5;

export interface RetrievedEntry {
  entry: PlaybookEntry;
  score: number;
  /** Why it surfaced — shown in the UI so the selection is never a black box. */
  because: string[];
}

export interface RetrieveInput {
  problem?: Problem;
  graph?: GraphDSL;
  /** Extra free text to match against, e.g. the learner's question. */
  text?: string;
  /** Concepts to weight up regardless of the problem, e.g. the due-review queue. */
  concepts?: string[];
  limit?: number;
}

/**
 * The words of a problem and a drawing, lowercased, for trigger matching. Node
 * labels and flow names are included because they carry the domain vocabulary
 * the problem statement sometimes leaves out.
 */
function haystack(input: RetrieveInput): string {
  const parts: string[] = [];
  const p = input.problem;
  if (p) {
    parts.push(p.title, p.domain, p.prompt, p.rubricHints);
    parts.push(...p.functional, ...p.constraints, ...p.expectedFlows);
    for (const [k, v] of Object.entries(p.nonFunctional)) parts.push(`${k} ${v}`);
    for (const s of p.scenarios) parts.push(s.name, s.description);
  }
  const g = input.graph;
  if (g) {
    for (const n of g.nodes) parts.push(n.label, n.annotation ?? '');
    for (const e of g.edges) parts.push(e.label ?? '');
    for (const f of g.flows ?? []) parts.push(f.name, f.description ?? '');
    for (const s of g.stickies ?? []) parts.push(s.text);
  }
  if (input.text) parts.push(input.text);
  return parts.join(' \n ').toLowerCase();
}

export function retrievePlaybook(input: RetrieveInput): RetrievedEntry[] {
  const limit = input.limit ?? 6;
  const text = haystack(input);
  const wantedConcepts = new Set([...(input.problem?.concepts ?? []), ...(input.concepts ?? [])]);
  const presentTypes = new Set((input.graph?.nodes ?? []).map((n) => n.type));

  const scored: RetrievedEntry[] = [];
  for (const entry of PLAYBOOK) {
    let score = 0;
    const because: string[] = [];

    const conceptHits = entry.concepts.filter((c) => wantedConcepts.has(c));
    if (conceptHits.length > 0) {
      score += W_CONCEPT * conceptHits.length;
      because.push(`rubric concept: ${conceptHits.join(', ')}`);
    }

    const typeHits = (entry.nodeTypes ?? []).filter((t) => presentTypes.has(t));
    if (typeHits.length > 0) {
      score += W_NODE_TYPE * typeHits.length;
      because.push(`components on the canvas: ${typeHits.join(', ')}`);
    }

    const triggerHits = entry.triggers.filter((t) => text.includes(t));
    if (triggerHits.length > 0) {
      score += Math.min(MAX_TRIGGER_SCORE, W_TRIGGER * triggerHits.length);
      because.push(`mentioned: ${triggerHits.slice(0, 4).join(', ')}`);
    }

    if (score > 0) scored.push({ entry, score, because });
  }

  // Ties break on id so the order is stable across runs and processes.
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, limit);
}

/**
 * The retrieved entries as prompt text. Ids are printed because the model is
 * required to cite them, and a citation is only checkable if the key is visible.
 */
export function renderPlaybook(entries: RetrievedEntry[]): string {
  if (entries.length === 0) return '';
  const blocks = entries.map(({ entry }) => {
    const lines = [
      `[${entry.id}] ${entry.title}`,
      `  practice: ${entry.rule}`,
      entry.numbers ? `  numbers: ${entry.numbers}` : '',
      `  without it: ${entry.failure}`,
      `  source: ${entry.source}`,
    ];
    return lines.filter(Boolean).join('\n');
  });
  return blocks.join('\n\n');
}

/** Citation keys that exist, for stripping invented ones out of model output. */
export function knownCitations(entries: RetrievedEntry[]): Set<string> {
  return new Set(entries.map((e) => e.entry.id));
}
