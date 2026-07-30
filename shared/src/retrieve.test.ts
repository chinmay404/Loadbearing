import { describe, expect, it } from 'vitest';
import { PLAYBOOK, PLAYBOOK_BY_ID, PLAYBOOK_IDS } from './playbook.js';
import { knownCitations, renderPlaybook, retrievePlaybook } from './retrieve.js';
import { CONCEPTS } from './concepts.js';
import { ARCH_NODE_TYPES } from './types.js';
import type { GraphDSL, Problem } from './types.js';

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: 'p1',
  title: 'Order service',
  level: 4,
  domain: 'fintech',
  prompt: 'Buyers place orders and we charge the card through Stripe. Occasionally an order is charged twice.',
  functional: ['place an order'],
  nonFunctional: { peakRps: 900, p99Ms: 250 },
  constraints: ['team of 5'],
  concepts: ['idempotency'],
  expectedFlows: ['checkout write path'],
  rubricHints: 'Hunt for a double charge on retry.',
  twists: [],
  scenarios: [],
  ...over,
});

const graph = (over: Partial<GraphDSL> = {}): GraphDSL => ({
  nodes: [],
  edges: [],
  stickies: [],
  flows: [],
  ...over,
});

describe('playbook integrity', () => {
  it('every entry has a unique id, a source, a rule and a failure', () => {
    expect(new Set(PLAYBOOK_IDS).size).toBe(PLAYBOOK.length);
    for (const e of PLAYBOOK) {
      expect(e.id, `${e.id} id`).toMatch(/^[a-z0-9-]+$/);
      expect(e.title.length, `${e.id} title`).toBeGreaterThan(8);
      expect(e.source.length, `${e.id} source`).toBeGreaterThan(8);
      expect(e.rule.length, `${e.id} rule`).toBeGreaterThan(40);
      expect(e.failure.length, `${e.id} failure`).toBeGreaterThan(30);
      expect(e.triggers.length, `${e.id} triggers`).toBeGreaterThan(0);
      expect(e.concepts.length, `${e.id} concepts`).toBeGreaterThan(0);
    }
  });

  it('references only real concept ids and real node types', () => {
    const conceptIds = new Set<string>(CONCEPTS);
    const nodeTypes = new Set<string>(ARCH_NODE_TYPES);
    for (const e of PLAYBOOK) {
      for (const c of e.concepts) expect(conceptIds.has(c), `${e.id} cites concept ${c}`).toBe(true);
      for (const t of e.nodeTypes ?? []) expect(nodeTypes.has(t), `${e.id} cites type ${t}`).toBe(true);
    }
  });

  it('triggers are lowercase, so matching against lowercased text can hit', () => {
    for (const e of PLAYBOOK) {
      for (const t of e.triggers) expect(t, `${e.id}`).toBe(t.toLowerCase());
    }
  });

  it('the id index agrees with the list', () => {
    expect(Object.keys(PLAYBOOK_BY_ID).sort()).toEqual([...PLAYBOOK_IDS].sort());
  });
});

describe('retrievePlaybook', () => {
  it('surfaces idempotency for a double-charge payments problem', () => {
    const got = retrievePlaybook({ problem: problem() });
    expect(got.map((r) => r.entry.id)).toContain('idempotency-keys');
  });

  it('ranks a rubric-concept match above a keyword-only match', () => {
    const got = retrievePlaybook({ problem: problem(), limit: 20 });
    const idem = got.find((r) => r.entry.id === 'idempotency-keys')!;
    const keywordOnly = got.find((r) => !r.entry.concepts.includes('idempotency'));
    expect(idem.score).toBeGreaterThan(keywordOnly!.score);
  });

  it('explains why each entry surfaced', () => {
    const got = retrievePlaybook({ problem: problem() });
    for (const r of got) expect(r.because.length).toBeGreaterThan(0);
    expect(got[0]!.because.join(' ')).toMatch(/rubric concept|mentioned|components/);
  });

  it('uses the components on the canvas as evidence', () => {
    const withCache = retrievePlaybook({
      problem: problem({ concepts: [], prompt: 'A plain service.', rubricHints: 'nothing' }),
      graph: graph({
        nodes: [
          { id: 'c', type: 'cache', label: 'Redis', annotation: '' },
          { id: 'd', type: 'sql_db', label: 'Postgres', annotation: '' },
        ],
      }),
      limit: 20,
    });
    const ids = withCache.map((r) => r.entry.id);
    expect(ids).toContain('cache-invalidation-story');
    expect(withCache.find((r) => r.entry.id === 'cache-invalidation-story')!.because.join(' ')).toMatch(
      /components on the canvas/,
    );
  });

  it('honours the limit and returns nothing when nothing matches', () => {
    expect(retrievePlaybook({ problem: problem(), limit: 3 }).length).toBe(3);
    expect(retrievePlaybook({ text: 'zzzz nothing relevant here zzzz' })).toEqual([]);
    expect(retrievePlaybook({})).toEqual([]);
  });

  it('is deterministic — same input, same order', () => {
    const a = retrievePlaybook({ problem: problem(), limit: 8 }).map((r) => r.entry.id);
    const b = retrievePlaybook({ problem: problem(), limit: 8 }).map((r) => r.entry.id);
    expect(a).toEqual(b);
  });

  it('caps the reward for keyword spam so triggers cannot outrank concepts', () => {
    // "cost" material has many triggers; a single concept match must still win.
    const got = retrievePlaybook({
      problem: problem({
        concepts: ['idempotency'],
        prompt: 'budget cost spend $ per month cheap expensive budget cost spend',
        rubricHints: 'cost budget spend',
      }),
      limit: 20,
    });
    const first = got[0]!;
    expect(first.entry.concepts).toContain('idempotency');
  });

  it('extra concepts (e.g. the due-review queue) steer retrieval', () => {
    const got = retrievePlaybook({
      problem: problem({ concepts: [] }),
      concepts: ['websocket-scale'],
      limit: 20,
    });
    expect(got.map((r) => r.entry.id)).toContain('websocket-fanout');
  });
});

describe('renderPlaybook', () => {
  it('prints the citation key for every entry so citations are checkable', () => {
    const got = retrievePlaybook({ problem: problem(), limit: 3 });
    const text = renderPlaybook(got);
    for (const r of got) expect(text).toContain(`[${r.entry.id}]`);
    expect(text).toContain('source:');
    expect(text).toContain('without it:');
  });

  it('renders nothing for an empty selection', () => {
    expect(renderPlaybook([])).toBe('');
  });

  it('knownCitations lists exactly the keys that were shown', () => {
    const got = retrievePlaybook({ problem: problem(), limit: 4 });
    expect([...knownCitations(got)].sort()).toEqual(got.map((r) => r.entry.id).sort());
  });
});
