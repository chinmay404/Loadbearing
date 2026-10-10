// What survives an authored diagram arriving from somewhere untrusted.
//
// The problem generator and, shortly, anything speaking to this over MCP can attach a
// diagram to a problem. That diagram becomes a real sheet on somebody's canvas, so
// the rule is salvage rather than reject: throw away the one edge that points at
// nothing, keep the picture. Rejecting the whole problem because a model mistyped a
// node type would trade a small flaw for no problem at all.

import { describe, expect, it } from 'vitest';
import { auditSeedProblem, validateDiagram, validateProblem } from './validate.js';

const twoNodes = [
  { key: 'a', type: 'client', label: 'Users', annotation: '', at: { x: 0, y: 0 } },
  { key: 'b', type: 'service', label: 'API', annotation: '', at: { x: 200, y: 0 } },
];

describe('validateDiagram', () => {
  it('returns nothing for anything that is not an object', () => {
    for (const junk of [null, undefined, 'a diagram', 42, []]) {
      expect(validateDiagram(junk)).toBeUndefined();
    }
  });

  it('returns nothing when fewer than two components survive, since one box is not an architecture', () => {
    expect(validateDiagram({ caption: 'x', nodes: [twoNodes[0]] })).toBeUndefined();
    expect(
      validateDiagram({ caption: 'x', nodes: [twoNodes[0], { key: 'b', type: 'not_a_thing' }] }),
    ).toBeUndefined();
  });

  it('drops an unknown component type but keeps the rest of the picture', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: [...twoNodes, { key: 'c', type: 'quantum_db', label: 'Q', at: { x: 400, y: 0 } }],
    });
    expect(out!.nodes.map((n) => n.key)).toEqual(['a', 'b']);
  });

  it('drops a duplicate key rather than letting two boxes answer to one name', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: [...twoNodes, { key: 'a', type: 'cache', label: 'Other A', at: { x: 0, y: 200 } }],
    });
    expect(out!.nodes).toHaveLength(2);
  });

  it('drops edges pointing at components that are not there', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: twoNodes,
      edges: [
        { from: 'a', to: 'b', kind: 'sync' },
        { from: 'a', to: 'ghost', kind: 'sync' },
        { from: 'a', to: 'b', kind: 'telepathy' },
      ],
    });
    expect(out!.edges).toEqual([{ from: 'a', to: 'b', kind: 'sync' }]);
  });

  it('clears a parent that did not survive, which would otherwise place the child at the origin', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: [
        ...twoNodes,
        { key: 'c', type: 'worker', label: 'W', at: { x: 30, y: 30 }, parent: 'nonexistent' },
      ],
    });
    expect(out!.nodes.find((n) => n.key === 'c')!.parent).toBeUndefined();
  });

  it('keeps a flow only when its steps are a real path through the drawn graph', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: twoNodes,
      flows: [
        { name: 'good', kind: 'read', steps: ['a', 'b'], rps: 10, description: '' },
        { name: 'ghost step', kind: 'read', steps: ['a', 'nope'], rps: 10, description: '' },
        { name: 'not a path', kind: 'read', steps: ['a'], rps: 10, description: '' },
      ],
    });
    expect(out!.flows.map((f) => f.name)).toEqual(['good']);
  });

  it('coerces a nonsense flow kind rather than dropping the flow', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: twoNodes,
      flows: [{ name: 'f', kind: 'sideways', steps: ['a', 'b'], rps: -5, description: '' }],
    });
    expect(out!.flows[0]!.kind).toBe('read');
    expect(out!.flows[0]!.rps).toBe(0);
  });

  it('replaces non-finite coordinates with zero instead of producing a NaN layout', () => {
    const out = validateDiagram({
      caption: 'x',
      nodes: [
        { key: 'a', type: 'client', label: 'A', at: { x: Infinity, y: 'over there' } },
        twoNodes[1],
      ],
    });
    expect(out!.nodes[0]!.at).toEqual({ x: 0, y: 0 });
  });
});

describe('a problem carrying a diagram', () => {
  const base = {
    id: 'l2-agent-authored',
    level: 2,
    prompt: 'A long enough prompt to pass the length check on generated problems, easily.',
    functional: ['do a thing'],
    concepts: ['caching'],
    twists: ['a twist'],
    nonFunctional: { peakRps: 10 },
  };

  it('keeps a usable diagram and honours kind: lab', () => {
    const out = validateProblem({
      ...base,
      kind: 'lab',
      diagram: { caption: 'today', nodes: twoNodes, edges: [{ from: 'a', to: 'b', kind: 'sync' }] },
    });
    expect(out.kind).toBe('lab');
    expect(out.diagram!.nodes).toHaveLength(2);
  });

  it('refuses to call something a lab when its architecture did not survive', () => {
    const out = validateProblem({ ...base, kind: 'lab', diagram: { caption: 'x', nodes: [] } });
    expect(out.kind).toBeUndefined();
    expect(out.diagram).toBeUndefined();
  });

  it('accepts a problem with no diagram at all, which is most of them', () => {
    expect(validateProblem(base).diagram).toBeUndefined();
  });
});

describe('beginner fields', () => {
  const base = {
    id: 'l1-start-x-basics',
    title: 'X',
    level: 1,
    prompt: 'You are building a small app that needs somewhere to keep photos people upload every day.',
    concepts: ['blob-storage', 'capacity-estimation'],
    functional: ['upload a photo', 'view a photo'],
    twists: ['views jump'],
    expectedFlows: ['upload a photo'],
  };

  it('keeps well-formed beginner fields', () => {
    const p = validateProblem({
      ...base,
      track: { topic: 'photo-upload', stage: 'basics', next: 'l1-start-x-step-up' },
      learn: 'Photos belong in object storage.',
      hints: [{ text: 'Where do photos live?', ghost: { type: 'blob_store', label: 'Photo storage' } }],
      glossary: [{ term: 'object storage', meaning: 'a cheap place for files' }],
      flowPlans: [{ name: 'upload a photo', kind: 'write', rps: 20, plain: 'A user sends a photo.', mustReach: [['blob_store']] }],
    });
    expect(p.track).toEqual({ topic: 'photo-upload', stage: 'basics', next: 'l1-start-x-step-up' });
    expect(p.learn).toBe('Photos belong in object storage.');
    expect(p.hints).toEqual([{ text: 'Where do photos live?', ghost: { type: 'blob_store', label: 'Photo storage' } }]);
    expect(p.glossary).toHaveLength(1);
    expect(p.flowPlans?.[0]?.mustReach).toEqual([['blob_store']]);
  });

  it('drops malformed beginner fields rather than rejecting the sheet', () => {
    const p = validateProblem({
      ...base,
      track: { topic: '', stage: 'expert' },
      hints: [{ text: '' }, { text: 'ok', ghost: { type: 'not_a_type', label: 'x' } }],
      glossary: [{ term: 'x' }],
      flowPlans: [{ name: 'upload a photo', kind: 'teleport', rps: -5, plain: 'p', mustReach: [['nope'], ['cdn']] }],
    });
    expect(p.track).toBeUndefined();
    expect(p.hints).toEqual([{ text: 'ok' }]);
    expect(p.glossary).toBeUndefined();
    // A bad kind is guessed from the name and a bad rate falls back to the default: a
    // plan at 0 rps would declare a flow that sends nothing and passes every gate.
    expect(p.flowPlans).toEqual([{ name: 'upload a photo', kind: 'write', rps: 100, plain: 'p', mustReach: [['cdn']] }]);
  });
});

describe('the seed audit for beginner sheets', () => {
  const sheet = {
    id: 'l1-start-photo-upload-basics',
    title: 'Photo Upload: Basics',
    level: 1 as const,
    domain: 'social',
    prompt: 'You are building a small photo-sharing app. People upload photos and look at them later, about 20 uploads and 100 views every second.',
    functional: ['upload', 'view'],
    nonFunctional: { uploadRps: 20, viewRps: 100 },
    constraints: ['one developer'],
    concepts: ['blob-storage', 'capacity-estimation'],
    expectedFlows: ['upload a photo'],
    rubricHints: 'This sheet teaches one idea: photo bytes go to object storage, not the app server disk or a database.',
    twists: ['views jump'],
    scenarios: [{ id: 's', name: 'S', description: 'd', rpsMultiplier: 2, passCriteria: 'keeps working' }],
    track: { topic: 'photo-upload', stage: 'basics' as const },
    learn: 'Photos belong in object storage.',
    hints: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    glossary: [{ term: 'a', meaning: 'b' }, { term: 'c', meaning: 'd' }],
    flowPlans: [{ name: 'upload a photo', kind: 'write' as const, rps: 20, plain: 'p' }],
  };

  it('accepts a sheet that meets the lighter bar', () => {
    expect(auditSeedProblem(sheet)).toEqual([]);
  });

  it('requires the beginner fields', () => {
    const issues = auditSeedProblem({ ...sheet, learn: '', hints: [{ text: 'a' }], glossary: [], flowPlans: [] });
    expect(issues).toEqual([
      'l1-start-photo-upload-basics: beginner sheet needs a learn line',
      'l1-start-photo-upload-basics: beginner sheet needs 3-5 hints',
      'l1-start-photo-upload-basics: beginner sheet needs at least 2 glossary entries',
      'l1-start-photo-upload-basics: no flow plan for "upload a photo"',
    ]);
  });

  it('keeps the full bar for every other sheet', () => {
    const { track: _t, ...plain } = sheet;
    expect(auditSeedProblem(plain)).toContain('l1-start-photo-upload-basics: fewer than 3 functional requirements');
  });
});
