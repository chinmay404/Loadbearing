// Turns retrieved playbook entries into the block of text that goes into a
// prompt, plus the source list the UI shows next to the review.
//
// This is the seam that makes the grader non-self-sufficient by design: it is
// told to reason from these entries and to cite them, rather than from whatever
// it happens to remember about idempotency keys today.

import { knownCitations, renderPlaybook, retrievePlaybook } from '@loadbearing/shared';
import type { GraphDSL, Problem, RetrievedEntry } from '@loadbearing/shared';

export interface ReferenceBrief {
  /** Prompt-ready text. Empty when nothing was relevant. */
  text: string;
  /** Citation keys the model is allowed to use. */
  allowed: Set<string>;
  /** For the client: what was consulted and why. */
  sources: {
    id: string;
    title: string;
    source: string;
    sourceKind: string;
    because: string[];
  }[];
  entries: RetrievedEntry[];
}

const HEADER = `TRUSTED REFERENCE MATERIAL — established practice, retrieved for this problem.
Reason from these entries rather than from memory. Where one applies, follow it and cite its
key in the finding's "refs". Where you disagree with one, say so explicitly and give the
reason — silent divergence is the failure mode this section exists to prevent. Cite ONLY the
keys listed here.`;

export function referenceBriefFor(input: {
  problem?: Problem;
  graph?: GraphDSL;
  text?: string;
  concepts?: string[];
  limit?: number;
}): ReferenceBrief {
  const entries = retrievePlaybook(input);
  if (entries.length === 0) {
    return { text: '', allowed: new Set(), sources: [], entries };
  }
  return {
    text: `${HEADER}\n\n${renderPlaybook(entries)}`,
    allowed: knownCitations(entries),
    sources: entries.map(({ entry, because }) => ({
      id: entry.id,
      title: entry.title,
      source: entry.source,
      sourceKind: entry.sourceKind,
      because,
    })),
    entries,
  };
}
