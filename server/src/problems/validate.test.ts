// What survives an authored diagram arriving from somewhere untrusted.
//
// The problem generator and, shortly, anything speaking to this over MCP can attach a
// diagram to a problem. That diagram becomes a real sheet on somebody's canvas, so
// the rule is salvage rather than reject: throw away the one edge that points at
// nothing, keep the picture. Rejecting the whole problem because a model mistyped a
// node type would trade a small flaw for no problem at all.

import { describe, expect, it } from 'vitest';
import { validateDiagram, validateProblem } from './validate.js';

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
