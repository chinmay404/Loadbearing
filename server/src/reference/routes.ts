// The reference library, readable. The grader cites these keys, so the learner
// has to be able to look one up and read the practice for themselves — a
// citation you cannot follow is just an assertion with extra steps.

import { Hono } from 'hono';
import { PLAYBOOK, PLAYBOOK_BY_ID, retrievePlaybook } from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { attachUser, type AppEnv } from '../auth/middleware.js';
import { findProblem } from '../problems/routes.js';
import {
  PRIMER_ATTRIBUTION,
  PRIMER_SECTIONS,
  primerSection,
  searchPrimer,
} from './primer/index.js';

export const playbookRoutes = new Hono<AppEnv>();

playbookRoutes.get('/playbook', (c) => c.json(PLAYBOOK));

playbookRoutes.get('/playbook/:id', (c) => {
  const entry = PLAYBOOK_BY_ID[c.req.param('id')];
  if (!entry) return c.json({ error: { code: 'not_found', message: 'No such reference' } }, 404);
  return c.json(entry);
});

/**
 * What the grader would be shown for a given problem. Exposed so the learner can
 * see the material BEFORE submitting — the corpus is a study aid, not a secret.
 */
playbookRoutes.post('/playbook/relevant', attachUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    problemId?: string;
    graph?: unknown;
    text?: string;
    limit?: number;
  };
  const userId = c.get('userId');
  const problem = body.problemId
    ? await findProblem(await storage(), userId ?? '', String(body.problemId))
    : undefined;
  const graph = (typeof body.graph === 'object' && body.graph !== null ? body.graph : undefined) as
    | Parameters<typeof retrievePlaybook>[0]['graph']
    | undefined;

  const entries = retrievePlaybook({
    ...(problem ? { problem } : {}),
    ...(graph ? { graph } : {}),
    ...(body.text ? { text: String(body.text) } : {}),
    limit: Math.max(1, Math.min(20, Math.round(body.limit ?? 8))),
  });
  return c.json(
    entries.map(({ entry, score, because }) => ({
      id: entry.id,
      title: entry.title,
      source: entry.source,
      sourceKind: entry.sourceKind,
      rule: entry.rule,
      numbers: entry.numbers ?? '',
      failure: entry.failure,
      concepts: entry.concepts,
      score,
      because,
    })),
  );
});

// ---- the System Design Primer -------------------------------------------
//
// Vendored, not linked. A reference that only works when GitHub is reachable is a
// reference you stop reaching for, and the whole point of having it here is that it
// is one keystroke away while you are drawing rather than a tab you went and found.
// Public, like the rest of the reference material: it is somebody else's writing,
// published under a licence that says to share it, and nothing about it is yours.

playbookRoutes.get('/primer', (c) =>
  c.json({
    attribution: PRIMER_ATTRIBUTION,
    sections: PRIMER_SECTIONS.map(({ slug, title, subheadings, summary }) => ({
      slug,
      title,
      subheadings,
      summary,
    })),
  }),
);

playbookRoutes.get('/primer/search', (c) => {
  const q = c.req.query('q') ?? '';
  return c.json({ query: q, hits: searchPrimer(q) });
});

playbookRoutes.get('/primer/:slug', (c) => {
  const section = primerSection(c.req.param('slug'));
  if (!section) {
    return c.json({ error: { code: 'not_found', message: 'No such primer section' } }, 404);
  }
  return c.json({ ...section, attribution: PRIMER_ATTRIBUTION });
});
