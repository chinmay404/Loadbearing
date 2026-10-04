import type { Node } from '@xyflow/react';

/**
 * Parts grew when they gained gauges. Layouts authored for the old boxes — the
 * blueprints, the labs, everything anyone has saved — were spaced for something
 * about 150×80, and now hold something about 216×155. Spreading an authored layout
 * by this much keeps its shape and gives the new parts their room.
 */
export const SPREAD = { x: 1.32, y: 1.5 } as const;

/** Size a node is drawn at, falling back to the new part's footprint before it has been measured. */
function sizeOf(n: Node): { w: number; h: number } {
  return {
    w: Number(n.measured?.width ?? n.width ?? 216),
    h: Number(n.measured?.height ?? n.height ?? 155),
  };
}

/**
 * Do any two top-level parts sit on each other? Boundaries are left out — a group
 * is meant to contain things — and so are parts inside one, which belong to it.
 */
export function hasOverlap(nodes: Node[], margin = 0): boolean {
  const boxes = nodes
    .filter((n) => !n.parentId && n.type !== 'sticky' && (n.data as { archType?: string })?.archType !== 'group')
    .map((n) => ({ ...n.position, ...sizeOf(n) }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (
        a.x < b.x + b.w - margin &&
        b.x < a.x + a.w - margin &&
        a.y < b.y + b.h - margin &&
        b.y < a.y + a.h - margin
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Spread a layout about the centre of what is drawn. Top-level parts move away from
 * the centroid; parts inside a boundary keep their place within it, scaled with it;
 * boundaries grow by the same factor so their contents still fit.
 */
export function spreadLayout<N extends Node>(nodes: N[], factor: { x: number; y: number } = SPREAD): N[] {
  const top = nodes.filter((n) => !n.parentId);
  if (top.length === 0) return nodes;
  const cx = top.reduce((sum, n) => sum + n.position.x + sizeOf(n).w / 2, 0) / top.length;
  const cy = top.reduce((sum, n) => sum + n.position.y + sizeOf(n).h / 2, 0) / top.length;

  return nodes.map((n) => {
    const { w, h } = sizeOf(n);
    const isGroup = (n.data as { archType?: string })?.archType === 'group';
    const grown =
      isGroup && n.width !== undefined && n.height !== undefined
        ? { width: Math.round(n.width * factor.x), height: Math.round(n.height * factor.y) }
        : {};
    if (n.parentId) {
      return { ...n, ...grown, position: { x: Math.round(n.position.x * factor.x), y: Math.round(n.position.y * factor.y) } };
    }
    // Move the part's centre, not its corner, so parts of different sizes stay aligned.
    const midX = n.position.x + w / 2;
    const midY = n.position.y + h / 2;
    const nw = isGroup && grown.width !== undefined ? grown.width : w;
    const nh = isGroup && grown.height !== undefined ? grown.height : h;
    return {
      ...n,
      ...grown,
      position: {
        x: Math.round(cx + (midX - cx) * factor.x - nw / 2),
        y: Math.round(cy + (midY - cy) * factor.y - nh / 2),
      },
    };
  });
}
