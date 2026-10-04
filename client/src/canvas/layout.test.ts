import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { hasOverlap, spreadLayout } from './layout';

const part = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id,
  type: 'arch',
  position: { x, y },
  measured: { width: 216, height: 155 },
  data: { archType: 'service' },
  ...extra,
});

describe('overlap', () => {
  it('spots two parts on top of each other', () => {
    expect(hasOverlap([part('a', 0, 0), part('b', 210, 0)])).toBe(true);
  });
  it('leaves parts with room alone', () => {
    expect(hasOverlap([part('a', 0, 0), part('b', 280, 0), part('c', 0, 200)])).toBe(false);
  });
  it('does not count a part inside a boundary as overlapping the boundary', () => {
    const group = part('g', 0, 0, { data: { archType: 'group' }, width: 400, height: 300, measured: { width: 400, height: 300 } });
    const child = part('c', 20, 40, { parentId: 'g' });
    expect(hasOverlap([group, child])).toBe(false);
  });
});

describe('making room', () => {
  it('spreads an old 210-pixel grid until the new parts fit', () => {
    const old = [part('a', 0, 0), part('b', 210, 0), part('c', 420, 0), part('d', 0, 120)];
    expect(hasOverlap(old)).toBe(true);
    expect(hasOverlap(spreadLayout(old))).toBe(false);
  });

  it('keeps the drawing centred where it was', () => {
    const old = [part('a', 0, 0), part('b', 420, 0)];
    const centre = (ns: Node[]) => ns.reduce((s, n) => s + n.position.x + 108, 0) / ns.length;
    expect(centre(spreadLayout(old))).toBeCloseTo(centre(old), 0);
  });

  it('grows a boundary and keeps its contents in proportion inside it', () => {
    const group = part('g', 0, 0, { data: { archType: 'group' }, width: 400, height: 300, measured: { width: 400, height: 300 } });
    const child = part('c', 100, 60, { parentId: 'g' });
    const [g, c] = spreadLayout([group, child]);
    expect(g!.width).toBe(528);
    expect(g!.height).toBe(450);
    expect(c!.position).toEqual({ x: 132, y: 90 });
  });
});
