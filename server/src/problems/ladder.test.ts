// The "Start here" ladder, checked against the real engine.
//
// Two things make a beginner sheet worth having: the design it teaches actually
// passes its gates, and — for a Step up — the Basics answer does NOT, or the step
// teaches nothing. Each sheet's reference answer lives here, not in the bank: it
// is the answer key, and it must never reach the client.

import { describe, expect, it } from 'vitest';
import {
  docFromBlueprint,
  evaluateAllScenarios,
  graphFromDoc,
  matchPath,
  plansFor,
  type BlueprintLike,
  type FlowPlan,
  type GraphDSL,
  type Problem,
} from '@loadbearing/shared';
import { PROBLEM_BY_ID } from './bank.js';
import { STARTER_SHEETS } from './starter.js';

type Box = [key: string, type: BlueprintLike['nodes'][number]['type'], label: string, attrs?: Record<string, number>];
type Wire = [from: string, to: string, kind?: 'sync' | 'async' | 'replication'];

/** A design as boxes and wires, on a plain grid, since only the topology matters here. */
function design(boxes: Box[], wires: Wire[]): BlueprintLike {
  return {
    name: 'answer',
    nodes: boxes.map(([key, type, label, attrs], i) => ({
      key,
      type,
      label,
      annotation: label,
      at: { x: (i % 4) * 220, y: Math.floor(i / 4) * 130 },
      ...(attrs ? { attrs } : {}),
    })),
    edges: wires.map(([from, to, kind]) => ({ from, to, kind: kind ?? 'sync' })),
    flows: [],
  };
}

/**
 * The Basics answer has no CDN, so a Step-up plan that must reach one finds no path
 * in it. A learner would still declare the request; drop the groups the drawing has
 * nothing for, so the naive design is judged on load rather than failing on "no flow".
 */
function relaxed(plan: FlowPlan, graph: GraphDSL): FlowPlan {
  const drawn = new Set(graph.nodes.map((n) => n.type));
  const mustReach = (plan.mustReach ?? []).filter((group) => group.some((t) => drawn.has(t)));
  return { ...plan, mustReach };
}

/** Place a design, then declare every request the way the Flows tab does: by matching its path. */
function placeWithFlows(problem: Problem, d: BlueprintLike, loose = false): { graph: GraphDSL; unmatched: string[] } {
  const graph = graphFromDoc(docFromBlueprint(d));
  graph.flows = [];
  const unmatched: string[] = [];
  for (const plan of plansFor(problem)) {
    const m = matchPath(loose ? relaxed(plan, graph) : plan, graph);
    const steps = m.status === 'found' ? m.path : m.status === 'choose' ? m.paths[0]! : null;
    if (!steps) {
      unmatched.push(plan.name);
      continue;
    }
    graph.flows.push({ id: `f-${plan.name}`, name: plan.name, kind: plan.kind, rps: plan.rps, steps, description: plan.plain });
  }
  return { graph, unmatched };
}

const photoBasics = design(
  [['u', 'client', 'User'], ['app', 'service', 'App server'], ['store', 'blob_store', 'Photo storage']],
  [['u', 'app'], ['app', 'store']],
);
const chatBasics = design(
  [['u', 'client', 'User'], ['app', 'service', 'App server'], ['llm', 'llm', 'LLM'], ['db', 'sql_db', 'Chat history']],
  [['u', 'app'], ['app', 'llm'], ['app', 'db']],
);
const shopBasics = design(
  [
    ['u', 'client', 'User'], ['lb', 'load_balancer', 'Load balancer'],
    ['a', 'service', 'App server A'], ['b', 'service', 'App server B'], ['db', 'sql_db', 'Shop DB'],
  ],
  [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'db'], ['b', 'db']],
);
const emailBasics = design(
  [
    ['u', 'client', 'User'], ['app', 'service', 'App server'], ['db', 'sql_db', 'Users DB'],
    ['q', 'queue', 'Email queue'], ['w', 'worker', 'Email worker'], ['em', 'email_provider', 'Email service'],
  ],
  [['u', 'app'], ['app', 'db'], ['app', 'q', 'async'], ['q', 'w'], ['w', 'em']],
);
const linksBasics = design(
  [['u', 'client', 'User'], ['ls', 'service', 'Link server'], ['db', 'sql_db', 'Links DB']],
  [['u', 'ls'], ['ls', 'db']],
);

/**
 * Why a Step up's Basics answer is allowed to pass, when the engine cannot tell the two
 * apart. Each entry is a lesson the grader judges and the load gates cannot.
 */
const NAIVE_PASSES: Record<string, string> = {
  'l1-start-background-work-step-up':
    'A slow worker only grows the queue, and no gate measures queue backlog; extra workers, retries and the failed-jobs queue are judged by the grader.',
};

const ANSWERS: Record<string, { reference: BlueprintLike; naive?: BlueprintLike }> = {
  'l1-start-photo-upload-basics': { reference: photoBasics },
  'l1-start-photo-upload-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['cdn', 'cdn', 'CDN', { cacheHitRate: 0.9 }], ['app', 'service', 'App server'],
        ['store', 'blob_store', 'Photo storage'], ['q', 'queue', 'Resize queue'], ['w', 'worker', 'Resizer'],
      ],
      [['u', 'cdn'], ['cdn', 'app'], ['app', 'store'], ['app', 'q', 'async'], ['q', 'w'], ['w', 'store']],
    ),
    naive: photoBasics,
  },
  'l1-start-ai-chat-basics': { reference: chatBasics },
  'l1-start-ai-chat-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['rl', 'rate_limiter', 'Rate limiter'], ['app', 'service', 'App server'],
        ['pc', 'prompt_cache', 'Answer cache'], ['llm', 'llm', 'LLM'], ['db', 'sql_db', 'Chat history'],
      ],
      [['u', 'rl'], ['rl', 'app'], ['app', 'pc'], ['pc', 'llm'], ['app', 'db']],
    ),
    naive: chatBasics,
  },
  'l1-start-product-page-basics': {
    reference: design(
      [['u', 'client', 'User'], ['app', 'service', 'App server'], ['db', 'sql_db', 'Products DB']],
      [['u', 'app'], ['app', 'db']],
    ),
  },
  'l1-start-product-page-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['lb', 'load_balancer', 'Load balancer'],
        ['app', 'service', 'App server', { replicas: 10 }], ['c', 'cache', 'Product cache'], ['db', 'sql_db', 'Products DB'],
      ],
      [['u', 'lb'], ['lb', 'app'], ['app', 'c'], ['c', 'db']],
    ),
    naive: design(
      [['u', 'client', 'User'], ['app', 'service', 'App server', { replicas: 10 }], ['db', 'sql_db', 'Products DB']],
      [['u', 'app'], ['app', 'db']],
    ),
  },
  'l1-start-stay-up-basics': { reference: shopBasics },
  'l1-start-stay-up-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['lb', 'load_balancer', 'Load balancer'],
        ['a', 'service', 'App server A'], ['b', 'service', 'App server B'],
        ['db', 'sql_db', 'Shop DB'], ['r', 'read_replica', 'Shop DB replica'],
      ],
      [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'db'], ['b', 'db'], ['a', 'r'], ['b', 'r'], ['db', 'r', 'replication']],
    ),
    naive: shopBasics,
  },
  'l1-start-background-work-basics': { reference: emailBasics },
  'l1-start-background-work-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['app', 'service', 'App server'], ['db', 'sql_db', 'Users DB'],
        ['q', 'queue', 'Email queue'], ['w', 'worker', 'Email workers', { replicas: 2 }],
        ['em', 'email_provider', 'Email service'], ['dlq', 'dead_letter_queue', 'Failed jobs'],
      ],
      [['u', 'app'], ['app', 'db'], ['app', 'q', 'async'], ['q', 'w'], ['w', 'em'], ['w', 'dlq', 'async']],
    ),
    naive: emailBasics,
  },
  'l1-start-short-links-basics': { reference: linksBasics },
  'l1-start-short-links-step-up': {
    reference: design(
      [
        ['u', 'client', 'User'], ['lb', 'load_balancer', 'Load balancer'],
        ['ls', 'service', 'Link server', { replicas: 10 }], ['c', 'cache', 'Link cache'], ['db', 'sql_db', 'Links DB'],
      ],
      [['u', 'lb'], ['lb', 'ls'], ['ls', 'c'], ['c', 'db']],
    ),
    naive: linksBasics,
  },
};

describe('the Start here ladder', () => {
  it('has twelve sheets, two per topic', () => {
    expect(STARTER_SHEETS).toHaveLength(12);
    const topics = new Map<string, string[]>();
    for (const s of STARTER_SHEETS) topics.set(s.track!.topic, [...(topics.get(s.track!.topic) ?? []), s.track!.stage]);
    expect(topics.size).toBe(6);
    expect([...topics.values()].every((stages) => [...stages].sort().join() === 'basics,step-up')).toBe(true);
  });

  it('points every sheet at a sheet that exists', () => {
    for (const s of STARTER_SHEETS) expect(PROBLEM_BY_ID[s.track!.next ?? ''], `${s.id} → ${s.track!.next}`).toBeDefined();
  });

  for (const sheet of STARTER_SHEETS) {
    describe(sheet.id, () => {
      const answer = ANSWERS[sheet.id];

      it('has an answer key', () => {
        expect(answer, `add ${sheet.id} to ANSWERS`).toBeDefined();
      });

      it('finds a path for every request in the intended design', () => {
        expect(placeWithFlows(sheet, answer!.reference).unmatched).toEqual([]);
      });

      it('the intended design passes every gate', () => {
        const verdicts = evaluateAllScenarios(placeWithFlows(sheet, answer!.reference).graph, sheet);
        for (const v of verdicts) expect(v.pass, `${v.name}: ${v.reasons.join(' ')}`).toBe(true);
      });

      if (sheet.track!.stage === 'step-up' && !NAIVE_PASSES[sheet.id]) {
        it('the basics design does not pass the step up', () => {
          const { graph, unmatched } = placeWithFlows(sheet, answer!.naive!, true);
          expect(unmatched, 'the naive design must still declare every request').toEqual([]);
          const verdicts = evaluateAllScenarios(graph, sheet);
          expect(verdicts.some((v) => !v.pass)).toBe(true);
        });
      }
    });
  }
});
