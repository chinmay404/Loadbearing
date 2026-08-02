// Geometry, tested without a browser.
//
// The interesting failures in a diagram are all spatial: a line that leaves the wrong
// side of a box and crosses it, an arrowhead pointing along the straight line between
// two boxes rather than along the curve it is attached to, a child of a boundary
// placed as though the boundary were at the origin. None of those throw. They just
// look wrong, and looking wrong is the only thing a diagram can get wrong.

import { describe, expect, it } from 'vitest';
import type { BlueprintLike } from './blueprints.js';
import { DIAGRAM_NODE_H, DIAGRAM_NODE_W, layoutDiagram } from './diagram.js';

const node = (key: string, x: number, y: number, extra: Partial<BlueprintLike['nodes'][number]> = {}) => ({
  key,
  type: 'service' as const,
  label: key,
  annotation: '',
  at: { x, y },
  ...extra,
});

const graph = (
  nodes: BlueprintLike['nodes'],
  edges: BlueprintLike['edges'] = [],
): BlueprintLike => ({ name: 'test', nodes, edges, flows: [] });

/** The single point a path ends at, parsed back out of the SVG command. */
const endOf = (path: string) => {
  const numbers = path.split(/[^-\d.]+/).filter(Boolean).map(Number);
  return { x: numbers[numbers.length - 2]!, y: numbers[numbers.length - 1]! };
};
const startOf = (path: string) => {
  const numbers = path.split(/[^-\d.]+/).filter(Boolean).map(Number);
  return { x: numbers[0]!, y: numbers[1]! };
};

describe('layout', () => {
  it('is empty for an empty graph rather than producing a NaN viewBox', () => {
    const out = layoutDiagram(graph([]));
    expect(out.viewBox).toBe('0 0 0 0');
    expect(out.boxes).toEqual([]);
  });

  it('normalises negative positions so nothing lands outside the frame', () => {
    const out = layoutDiagram(graph([node('a', -400, -300), node('b', 0, 0)]));
    for (const box of out.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(out.width);
      expect(box.y + box.h).toBeLessThanOrEqual(out.height);
    }
  });

  it('keeps authored positions rather than laying the graph out again', () => {
    const out = layoutDiagram(graph([node('a', 0, 0), node('b', 210, 0), node('c', 210, 120)]));
    const at = (k: string) => out.boxes.find((b) => b.key === k)!;
    expect(at('b').x - at('a').x).toBe(210);
    expect(at('c').y - at('b').y).toBe(120);
    expect(at('c').x).toBe(at('b').x);
  });

  it('reads a child position as relative to its boundary, the way the canvas does', () => {
    const out = layoutDiagram(
      graph([
        node('pool', 0, 0, { type: 'group', label: 'Autoscaling group', size: { w: 400, h: 220 } }),
        node('web', 30, 60, { parent: 'pool' }),
      ]),
    );
    const pool = out.boxes.find((b) => b.key === 'pool')!;
    const web = out.boxes.find((b) => b.key === 'web')!;
    expect(web.x).toBe(pool.x + 30);
    expect(web.y).toBe(pool.y + 60);
    // And having been offset, the child is actually inside its boundary.
    expect(web.x + web.w).toBeLessThanOrEqual(pool.x + pool.w);
    expect(web.y + web.h).toBeLessThanOrEqual(pool.y + pool.h);
  });

  it('draws boundaries before what they contain, so a group never covers its members', () => {
    const out = layoutDiagram(
      graph([
        node('web', 30, 60, { parent: 'pool' }),
        node('pool', 0, 0, { type: 'group', size: { w: 400, h: 220 } }),
      ]),
    );
    expect(out.boxes[0]!.key).toBe('pool');
  });

  it('survives a parent cycle instead of recursing forever', () => {
    const out = layoutDiagram(
      graph([node('a', 10, 10, { parent: 'b' }), node('b', 20, 20, { parent: 'a' })]),
    );
    expect(out.boxes).toHaveLength(2);
    expect(out.boxes.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
  });
});

describe('routing', () => {
  it('leaves the right side and arrives on the left when the target is to the right', () => {
    const out = layoutDiagram(graph([node('a', 0, 0), node('b', 300, 0)], [{ from: 'a', to: 'b', kind: 'sync' }]));
    const a = out.boxes.find((x) => x.key === 'a')!;
    const b = out.boxes.find((x) => x.key === 'b')!;
    const { path } = out.links[0]!;
    expect(startOf(path)).toEqual({ x: a.x + DIAGRAM_NODE_W, y: a.y + DIAGRAM_NODE_H / 2 });
    expect(endOf(path)).toEqual({ x: b.x, y: b.y + DIAGRAM_NODE_H / 2 });
  });

  it('reverses both ends when the target is to the left', () => {
    const out = layoutDiagram(graph([node('a', 300, 0), node('b', 0, 0)], [{ from: 'a', to: 'b', kind: 'sync' }]));
    const a = out.boxes.find((x) => x.key === 'a')!;
    const b = out.boxes.find((x) => x.key === 'b')!;
    const { path } = out.links[0]!;
    expect(startOf(path).x).toBe(a.x);
    expect(endOf(path).x).toBe(b.x + DIAGRAM_NODE_W);
  });

  it('goes vertically when the boxes share a column, rather than sideways through itself', () => {
    const out = layoutDiagram(graph([node('a', 0, 0), node('b', 0, 200)], [{ from: 'a', to: 'b', kind: 'async' }]));
    const a = out.boxes.find((x) => x.key === 'a')!;
    const b = out.boxes.find((x) => x.key === 'b')!;
    const { path } = out.links[0]!;
    expect(startOf(path)).toEqual({ x: a.x + DIAGRAM_NODE_W / 2, y: a.y + DIAGRAM_NODE_H });
    expect(endOf(path)).toEqual({ x: b.x + DIAGRAM_NODE_W / 2, y: b.y });
  });

  it('points the arrowhead along the curve, not along the line between the boxes', () => {
    // A target far below and slightly right: the straight line is steep, but the curve
    // arrives horizontally because it leaves and enters on the horizontal.
    const out = layoutDiagram(graph([node('a', 0, 0), node('b', 300, 400)], [{ from: 'a', to: 'b', kind: 'sync' }]));
    expect(out.links[0]!.head.angle).toBe(0);
  });

  it('puts the label midpoint between the two boxes, not on top of either', () => {
    const out = layoutDiagram(
      graph([node('a', 0, 0), node('b', 400, 0)], [{ from: 'a', to: 'b', kind: 'sync', label: 'read' }]),
    );
    const a = out.boxes.find((x) => x.key === 'a')!;
    const b = out.boxes.find((x) => x.key === 'b')!;
    const { mid } = out.links[0]!;
    expect(mid.x).toBeGreaterThan(a.x + a.w);
    expect(mid.x).toBeLessThan(b.x);
  });

  it('drops an edge to a node that is not in the graph instead of drawing to nowhere', () => {
    const out = layoutDiagram(graph([node('a', 0, 0)], [{ from: 'a', to: 'ghost', kind: 'sync' }]));
    expect(out.links).toEqual([]);
  });

  it('drops a self-edge, which has no two-point route', () => {
    const out = layoutDiagram(graph([node('a', 0, 0)], [{ from: 'a', to: 'a', kind: 'sync' }]));
    expect(out.links).toEqual([]);
  });

  it('carries the edge kind through, because a replication link is not a request', () => {
    const out = layoutDiagram(
      graph(
        [node('a', 0, 0), node('b', 300, 0)],
        [{ from: 'a', to: 'b', kind: 'replication', label: 'streaming' }],
      ),
    );
    expect(out.links[0]!.kind).toBe('replication');
    expect(out.links[0]!.label).toBe('streaming');
  });
});
