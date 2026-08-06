// The canvas store is plain JavaScript, so it can be driven directly — no DOM, no
// React, no synthetic drag events. That matters: React Flow drags are pointer
// gestures, so the interactions that are most worth covering (splice into an edge,
// move into a boundary, restack, pin) are exactly the ones a scripted click cannot
// reach. Testing the store instead tests the logic and skips the theatre.

import { beforeEach, describe, expect, it } from 'vitest';
import { sizeOf, useCanvas } from './canvasStore';

const store = () => useCanvas.getState();

/** Places a component and returns its id. */
const place = (type: Parameters<ReturnType<typeof store>['addArchNode']>[0], x: number, y: number) =>
  store().addArchNode(type, { x, y });

/**
 * React Flow's measurement pass, as it actually arrives: a `dimensions` change
 * with no `setAttributes`, which records what the DOM measured and nothing more.
 * This is all an unresized component ever gets.
 */
function measure(id: string, w: number, h: number) {
  store().onNodesChange([{ id, type: 'dimensions', dimensions: { width: w, height: h } }]);
}

/**
 * A drag of the resize handle, as NodeResizer actually reports it: `setAttributes`
 * makes React Flow write an explicit `width`/`height` on the node. It does NOT
 * touch `style` — an earlier version of these tests faked the resize by setting
 * `style` directly, which is why they passed while resizing was in fact broken.
 */
function resize(id: string, w: number, h: number) {
  store().onNodesChange([
    { id, type: 'dimensions', resizing: true, setAttributes: true, dimensions: { width: w, height: h } },
  ]);
  store().onNodesChange([{ id, type: 'dimensions', resizing: false, dimensions: { width: w, height: h } }]);
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

describe('reshaping a connection', () => {
  const connect = () => {
    const a = place('service', 0, 0);
    const b = place('sql_db', 600, 0);
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    return { a, b, edgeId: store().edges[0]!.id };
  };

  it('changes the routing style without touching what connects to what', () => {
    const { a, b, edgeId } = connect();
    store().setEdgeShape(edgeId, 'straight');
    const e = store().edges[0]!;
    expect((e.data as { shape?: string }).shape).toBe('straight');
    expect((e.data as { kind?: string }).kind).toBe('sync');
    expect([e.source, e.target]).toEqual([a, b]);
  });

  it('adds bends and keeps them in path order, not click order', () => {
    const { edgeId } = connect();
    // Add the far bend first, then a nearer one: the nearer must end up first.
    expect(store().addEdgeBend(edgeId, { x: 450, y: 120 })).toBe(0);
    expect(store().addEdgeBend(edgeId, { x: 150, y: 120 })).toBe(0);
    const points = (store().edges[0]!.data as { points: { x: number }[] }).points;
    expect(points.map((p) => p.x)).toEqual([150, 450]);
  });

  it('returns the index it inserted at, so the same gesture can drag it', () => {
    const { edgeId } = connect();
    store().addEdgeBend(edgeId, { x: 150, y: 60 });
    // A second bend further along belongs after the first, and says so.
    const index = store().addEdgeBend(edgeId, { x: 500, y: 60 });
    expect(index).toBe(1);
    store().moveEdgeBend(edgeId, index, { x: 500, y: 200 });
    const points = (store().edges[0]!.data as { points: { y: number }[] }).points;
    expect(points[1]!.y).toBe(200);
    expect(points[0]!.y).toBe(60);
  });

  it('moves and removes a single bend', () => {
    const { edgeId } = connect();
    store().addEdgeBend(edgeId, { x: 300, y: 100 });
    store().moveEdgeBend(edgeId, 0, { x: 320, y: 40 });
    expect((store().edges[0]!.data as { points: { y: number }[] }).points[0]!.y).toBe(40);

    store().removeEdgeBend(edgeId, 0);
    expect((store().edges[0]!.data as { points: unknown[] }).points).toEqual([]);
  });

  it('straightens away every bend at once', () => {
    const { edgeId } = connect();
    store().addEdgeBend(edgeId, { x: 200, y: 100 });
    store().addEdgeBend(edgeId, { x: 400, y: -100 });
    store().clearEdgeBends(edgeId);
    expect((store().edges[0]!.data as { points: unknown[] }).points).toEqual([]);
  });

  it('round-trips shape and bends through a saved document', () => {
    const { edgeId } = connect();
    store().setEdgeShape(edgeId, 'curved');
    store().addEdgeBend(edgeId, { x: 300, y: 90 });

    const doc = store().toDoc();
    const saved = doc.edges[0]!;
    expect(saved.shape).toBe('curved');
    expect(saved.points).toEqual([{ x: 300, y: 90 }]);

    store().loadProblem('test', doc);
    const reloaded = store().edges[0]!.data as { shape?: string; points?: unknown[] };
    expect(reloaded.shape).toBe('curved');
    expect(reloaded.points).toEqual([{ x: 300, y: 90 }]);
  });

  it('keeps geometry out of what the grader is shown', () => {
    const { edgeId } = connect();
    store().setEdgeShape(edgeId, 'curved');
    store().addEdgeBend(edgeId, { x: 300, y: 90 });

    const graphEdge = store().toGraph().edges[0]! as unknown as Record<string, unknown>;
    expect(graphEdge.points).toBeUndefined();
    expect(graphEdge.shape).toBeUndefined();
    // What it does carry is the part that means something.
    expect(graphEdge.kind).toBe('sync');
  });
});

describe('boundaries', () => {
  it('adopts a component dropped inside it, and keeps it where it looked', () => {
    const group = place('group', 100, 100);
    resize(group, 300, 220);
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
    resize(group, 300, 220);
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
    resize(outer, 800, 600);
    const inner = place('group', 100, 100);
    resize(inner, 200, 200);
    store().reparentDroppedNodes([inner]);
    expect(node(inner)!.parentId).toBe(outer);

    const svc = place('service', 150, 150);
    measure(svc, 100, 40);
    store().reparentDroppedNodes([svc]);
    expect(node(svc)!.parentId).toBe(inner);
  });

  it('never puts a boundary inside itself or its own contents', () => {
    const group = place('group', 0, 0);
    resize(group, 600, 600);
    const child = place('group', 50, 50);
    resize(child, 400, 400);
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
    resize(group, 400, 400);
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

describe('loading a document', () => {
  // A new project view is stored as `{}` by the server. Assuming a full document
  // threw on the first open of every new view, and the workspace reported that as a
  // failure to load.
  it('accepts a document with nothing in it yet', () => {
    expect(() => store().loadProblem('fresh', {} as never)).not.toThrow();
    expect(store().nodes).toEqual([]);
    expect(store().edges).toEqual([]);
    expect(store().problemId).toBe('fresh');
  });

  it('accepts a document carrying only some of its sections', () => {
    const partial = { nodes: [{ id: 'a', type: 'service', label: 'A', annotation: '', position: { x: 0, y: 0 } }] };
    expect(() => store().loadProblem('partial', partial as never)).not.toThrow();
    expect(store().nodes.map((n) => n.id)).toEqual(['a']);
    expect(store().edges).toEqual([]);
  });
});

describe('a resized boundary', () => {
  it('saves the size it was dragged to, not the size it spawned at', () => {
    const group = place('group', 40, 40);
    resize(group, 640, 480);

    const saved = store().toDoc().nodes.find((n) => n.id === group);
    expect(saved?.size).toEqual({ w: 640, h: 480 });
  });

  it('comes back that size after a reload', () => {
    const group = place('group', 40, 40);
    resize(group, 640, 480);

    // Exactly what a page load does: serialise, then hydrate from the document.
    store().loadProblem('test', store().toDoc());
    expect(sizeOf(node(group)!)).toEqual({ w: 640, h: 480 });
  });

  it('adopts a component dropped in the area it was enlarged to cover', () => {
    const group = place('group', 0, 0);
    resize(group, 700, 500);
    // Well outside the 300x220 it spawned at, so this only works if the drop test
    // reads the size the boundary actually has.
    const svc = place('service', 500, 380);
    measure(svc, 168, 64);

    expect(store().reparentDroppedNodes([svc]).attached).toBe(1);
    expect(node(svc)!.parentId).toBe(group);
  });

  it('keeps a resized note at its size too', () => {
    const sticky = store().addSticky({ x: 0, y: 0 });
    resize(sticky, 320, 240);

    store().loadProblem('test', store().toDoc());
    expect(sizeOf(node(sticky)!)).toEqual({ w: 320, h: 240 });
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

  it('releases everything at once, whatever is selected', () => {
    const a = place('service', 0, 0);
    const b = place('cache', 200, 0);
    const c = place('sql_db', 400, 0);
    select(a, b);
    store().setLocked(true);
    expect(store().nodes.filter((n) => n.draggable === false).length).toBe(2);

    // Nothing is selected now — pinning cleared it — and the release must still work.
    expect(store().nodes.some((n) => n.selected)).toBe(false);
    expect(store().unlockAll()).toBe(2);
    expect(store().nodes.filter((n) => n.draggable === false).length).toBe(0);
    for (const id of [a, b, c]) expect(node(id)!.selectable).not.toBe(false);
  });

  it('releasing nothing is a no-op rather than an edit', () => {
    place('service', 0, 0);
    const before = store().past.length;
    expect(store().unlockAll()).toBe(0);
    expect(store().past.length).toBe(before);
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

// Bindings: "this drawn component IS that piece of code".
//
// The primitive the whole scan feature turns on, so the store has to keep it
// honest — one node stands for one piece of code, and a binding must never
// outlive the node it points at.
describe('bindings between the drawing and the code', () => {
  beforeEach(() => store().loadProblem('test', null));

  it('starts empty, so the code-versus-drawing checks stay silent', () => {
    expect(store().bindings).toEqual([]);
    expect(store().scanId).toBeNull();
  });

  it('binds a node to a code reference', () => {
    const id = place('sql_db', 0, 0);
    store().bindNode('component:sql-db-supabase-postgres', id);
    expect(store().bindings).toEqual([
      { codeRef: 'component:sql-db-supabase-postgres', nodeId: id, source: 'static' },
    ]);
  });

  it('replaces rather than accumulates when the same code is bound twice', () => {
    const first = place('sql_db', 0, 0);
    const second = place('sql_db', 0, 0);
    store().bindNode('component:db', first);
    store().bindNode('component:db', second);
    expect(store().bindings).toHaveLength(1);
    expect(store().bindings[0]!.nodeId).toBe(second);
  });

  it('never lets one node stand for two different pieces of code', () => {
    const id = place('llm', 0, 0);
    store().bindNode('component:anthropic', id);
    store().bindNode('component:openai', id);
    expect(store().bindings).toHaveLength(1);
    expect(store().bindings[0]!.codeRef).toBe('component:openai');
  });

  it('drops bindings whose node is gone when the document is written', () => {
    const kept = place('sql_db', 0, 0);
    const removed = place('llm', 0, 0);
    store().bindNode('component:db', kept);
    store().bindNode('component:llm', removed);
    store().onNodesChange([{ type: 'remove', id: removed }]);

    const doc = store().toDoc();
    expect(doc.bindings).toEqual([{ codeRef: 'component:db', nodeId: kept, source: 'static' }]);
  });

  it('round-trips the scan and its bindings through a saved document', () => {
    const id = place('sql_db', 0, 0);
    store().setScanId('nightly-abc');
    store().bindNode('component:db', id);

    const doc = store().toDoc();
    store().loadProblem('test', doc);

    expect(store().scanId).toBe('nightly-abc');
    expect(store().bindings).toEqual([{ codeRef: 'component:db', nodeId: id, source: 'static' }]);
  });

  it('forgets both when a different sheet is opened', () => {
    store().setScanId('nightly-abc');
    store().bindNode('component:db', place('sql_db', 0, 0));
    store().loadProblem('other', null);
    expect(store().scanId).toBeNull();
    expect(store().bindings).toEqual([]);
  });
});
