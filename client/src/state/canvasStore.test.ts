// The canvas store is plain JavaScript, so it can be driven directly — no DOM, no
// React, no synthetic drag events. That matters: React Flow drags are pointer
// gestures, so the interactions that are most worth covering (splice into an edge,
// move into a boundary, restack, pin) are exactly the ones a scripted click cannot
// reach. Testing the store instead tests the logic and skips the theatre.

import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvas } from './canvasStore';

const store = () => useCanvas.getState();

/** Places a component and returns its id. */
const place = (type: Parameters<ReturnType<typeof store>['addArchNode']>[0], x: number, y: number) =>
  store().addArchNode(type, { x, y });

/**
 * React Flow supplies measurements; without a renderer the tests provide them.
 * Both `style` and `measured` are set because a resized boundary carries its size
 * in `style` (NodeResizer writes it there) and that is what the store reads first.
 */
function measure(id: string, w: number, h: number) {
  useCanvas.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === id
        ? { ...n, style: { ...(n.style ?? {}), width: w, height: h }, measured: { width: w, height: h } }
        : n,
    ),
  }));
}

function select(...ids: string[]) {
  const wanted = new Set(ids);
  useCanvas.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: wanted.has(n.id) })) }));
}

const node = (id: string) => useCanvas.getState().nodes.find((n) => n.id === id);

beforeEach(() => {
  store().loadProblem('test', null);
});

describe('splicing a component into a connection', () => {
  it('replaces one edge with two and keeps the connection kind', () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 400, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    const edgeId = store().edges[0]!.id;
    store().setEdgeKind(edgeId, 'async');
    store().setEdgeLabel(edgeId, 'writes');

    const mid = place('queue', 200, 0);
    expect(store().spliceNodeIntoEdge(edgeId, mid)).toBe(true);

    const edges = store().edges;
    expect(edges.length).toBe(2);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [a, mid],
      [mid, b],
    ]);
    for (const e of edges) expect((e.data as { kind: string }).kind).toBe('async');
    // The label describes what travels, so it stays on the first hop only.
    expect(edges[0]!.label).toBe('writes');
    expect(edges[1]!.label).toBeUndefined();
  });

  it('rewrites any flow that walked the pair it was inserted between', () => {
    const a = place('client', 0, 0);
    const b = place('service', 200, 0);
    const c = place('sql_db', 400, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    store().onConnect({ source: b, target: c, sourceHandle: null, targetHandle: null });
    const flow = store().addFlow();
    store().updateFlow(flow, { steps: [a, b, c] });

    const bc = store().edges.find((e) => e.source === b && e.target === c)!.id;
    const inserted = place('cache', 300, 0);
    store().spliceNodeIntoEdge(bc, inserted);

    expect(store().flows[0]!.steps).toEqual([a, b, inserted, c]);
  });

  it('refuses to splice a component into an edge it already touches', () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 400, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    const edgeId = store().edges[0]!.id;
    expect(store().spliceNodeIntoEdge(edgeId, a)).toBe(false);
    expect(store().edges.length).toBe(1);
  });
});

describe('re-pointing and disconnecting', () => {
  it('keeps the edge id, kind and label when an endpoint moves', () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 400, 0);
    const c = place('read_replica', 400, 200);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    const edge = store().edges[0]!;
    store().setEdgeKind(edge.id, 'replication');
    store().setEdgeLabel(edge.id, 'stream');

    expect(store().reconnectEdge(edge.id, { source: a, target: c, sourceHandle: null, targetHandle: null })).toBe(true);
    const after = store().edges[0]!;
    expect(after.id).toBe(edge.id);
    expect(after.target).toBe(c);
    expect(after.label).toBe('stream');
    expect((after.data as { kind: string }).kind).toBe('replication');
  });

  it('refuses a duplicate connection and a self-connection', () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 400, 0);
    const c = place('cache', 400, 200);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    store().onConnect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    const first = store().edges[0]!;

    // Pointing the first edge at c would duplicate the second.
    expect(store().reconnectEdge(first.id, { source: a, target: c, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(store().reconnectEdge(first.id, { source: a, target: a, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(store().edges.length).toBe(2);
  });
});

describe('boundaries', () => {
  it('adopts a component dropped inside it, and keeps it where it looked', () => {
    const group = place('group', 100, 100);
    measure(group, 300, 220);
    const svc = place('service', 150, 150);
    measure(svc, 168, 64);

    const result = store().reparentDroppedNodes([svc]);
    expect(result.attached).toBe(1);
    expect(node(svc)!.parentId).toBe(group);
    // Stored relative to the parent, so its absolute position is unchanged.
    expect(node(svc)!.position).toEqual({ x: 50, y: 50 });
  });

  it('releases a component dragged out of it', () => {
    const group = place('group', 100, 100);
    measure(group, 300, 220);
    const svc = place('service', 150, 150);
    measure(svc, 168, 64);
    store().reparentDroppedNodes([svc]);
    expect(node(svc)!.parentId).toBe(group);

    // Move it far outside, as a drag would, then drop.
    useCanvas.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === svc ? { ...n, position: { x: 900, y: 900 } } : n)),
    }));
    const result = store().reparentDroppedNodes([svc]);
    expect(result.detached).toBe(1);
    expect(node(svc)!.parentId).toBeUndefined();
    // Back to absolute coordinates: 100 + 900.
    expect(node(svc)!.position).toEqual({ x: 1000, y: 1000 });
  });

  it('picks the innermost boundary when they are nested', () => {
    const outer = place('group', 0, 0);
    measure(outer, 800, 600);
    const inner = place('group', 100, 100);
    measure(inner, 200, 200);
    store().reparentDroppedNodes([inner]);
    expect(node(inner)!.parentId).toBe(outer);

    const svc = place('service', 150, 150);
    measure(svc, 100, 40);
    store().reparentDroppedNodes([svc]);
    expect(node(svc)!.parentId).toBe(inner);
  });

  it('never puts a boundary inside itself or its own contents', () => {
    const group = place('group', 0, 0);
    measure(group, 600, 600);
    const child = place('group', 50, 50);
    measure(child, 400, 400);
    store().reparentDroppedNodes([child]);
    expect(node(child)!.parentId).toBe(group);

    // Dropping the outer boundary while it sits over its own child must not
    // reparent it into that child.
    const before = node(group)!.parentId;
    store().reparentDroppedNodes([group]);
    expect(node(group)!.parentId).toBe(before);
  });

  it('lists a parent before its children, which React Flow requires', () => {
    const svc = place('service', 150, 150);
    measure(svc, 100, 40);
    const group = place('group', 100, 100);
    measure(group, 400, 400);
    store().reparentDroppedNodes([svc]);

    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(group)).toBeLessThan(ids.indexOf(svc));
  });

  it('a boundary keeps its handles as a connectable component', () => {
    const a = place('group', 0, 0);
    const b = place('group', 500, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    expect(store().edges.length).toBe(1);
  });
});

describe('stacking and pinning', () => {
  it('brings the selection to the front and sends it to the back', () => {
    const a = place('service', 0, 0);
    const b = place('service', 100, 0);
    select(b);
    store().restack('front');
    expect(node(b)!.zIndex!).toBeGreaterThan(node(a)!.zIndex ?? 0);

    store().restack('back');
    expect(node(b)!.zIndex!).toBeLessThan(node(a)!.zIndex ?? 0);
  });

  it('steps one place at a time', () => {
    const a = place('service', 0, 0);
    select(a);
    store().restack('forward');
    store().restack('forward');
    expect(node(a)!.zIndex).toBe(2);
    store().restack('backward');
    expect(node(a)!.zIndex).toBe(1);
  });

  it('a boundary starts behind everything else', () => {
    const group = place('group', 0, 0);
    const svc = place('service', 0, 0);
    expect(node(group)!.zIndex!).toBeLessThan(node(svc)!.zIndex ?? 0);
  });

  it('pinning makes a component unselectable, undraggable and undeletable', () => {
    const a = place('service', 0, 0);
    select(a);
    store().setLocked(true);

    const pinned = node(a)!;
    expect(pinned.selectable).toBe(false);
    expect(pinned.draggable).toBe(false);
    expect(pinned.deletable).toBe(false);
    // And it drops out of the selection, or it would sit highlighted and inert.
    expect(pinned.selected).toBe(false);
    expect((pinned.data as { locked?: boolean }).locked).toBe(true);
  });

  it('a pinned component survives Delete', () => {
    const a = place('service', 0, 0);
    const b = place('cache', 200, 0);
    select(a);
    store().setLocked(true);
    select(a, b);
    store().deleteSelection();

    expect(node(a)).toBeDefined();
    expect(node(b)).toBeUndefined();
  });

  it('unlocks from its own id, since it can no longer be selected', () => {
    const a = place('service', 0, 0);
    select(a);
    store().setLocked(true);
    store().unlockNode(a);

    const freed = node(a)!;
    expect(freed.selectable).toBe(true);
    expect(freed.draggable).toBe(true);
    expect((freed.data as { locked?: boolean }).locked).toBe(false);
  });

  it('round-trips pinning and stacking through a saved document', () => {
    const a = place('service', 0, 0);
    select(a);
    // Order first: pinning drops the component out of the selection, so a pinned
    // component cannot be restacked until it is released. That is deliberate.
    store().restack('front');
    select(a);
    store().setLocked(true);

    const doc = store().toDoc();
    const saved = doc.nodes.find((n) => n.id === a)!;
    expect(saved.locked).toBe(true);
    expect(typeof saved.z).toBe('number');

    store().loadProblem('test', doc);
    const reloaded = node(a)!;
    expect(reloaded.draggable).toBe(false);
    expect(reloaded.selectable).toBe(false);
  });
});

describe('templates from a selection', () => {
  it('captures the selected components, their edges and enclosed flows, relative to the group', () => {
    const a = place('service', 300, 300);
    const b = place('sql_db', 500, 340);
    const outside = place('cache', 900, 900);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    store().onConnect({ source: b, target: outside, sourceHandle: null, targetHandle: null });
    const inside = store().addFlow();
    store().updateFlow(inside, { name: 'inside', steps: [a, b] });
    const crossing = store().addFlow();
    store().updateFlow(crossing, { name: 'crossing', steps: [a, b, outside] });

    select(a, b);
    const t = store().selectionAsTemplate('my pattern', 'note')!;

    expect(t.name).toBe('my pattern');
    expect(t.nodes.map((n) => n.key).sort()).toEqual([a, b].sort());
    // Positions are relative to the selection's own top-left.
    expect(t.nodes.find((n) => n.key === a)!.at).toEqual({ x: 0, y: 0 });
    expect(t.nodes.find((n) => n.key === b)!.at).toEqual({ x: 200, y: 40 });
    // Only edges with both ends inside, and only flows entirely inside.
    expect(t.edges.length).toBe(1);
    expect(t.flows.map((f) => f.name)).toEqual(['inside']);
  });

  it('falls back to the whole sheet when nothing is selected', () => {
    place('service', 0, 0);
    place('cache', 100, 0);
    select();
    expect(store().selectionAsTemplate('all', '')!.nodes.length).toBe(2);
  });

  it('placing a template twice produces two independent copies', () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 200, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    select(a, b);
    const t = store().selectionAsTemplate('pair', '')!;

    store().loadProblem('test', null);
    const firstIds = store().insertBlueprint(t);
    const secondIds = store().insertBlueprint(t);

    expect(firstIds.length).toBe(2);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(store().edges.length).toBe(2);
    // Each copy's edge joins its own nodes, not the other copy's.
    for (const e of store().edges) {
      const sameCopy =
        (firstIds.includes(e.source) && firstIds.includes(e.target)) ||
        (secondIds.includes(e.source) && secondIds.includes(e.target));
      expect(sameCopy).toBe(true);
    }
  });
});
