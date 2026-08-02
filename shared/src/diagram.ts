// Turning an authored graph into a picture.
//
// A diagram attached to a problem and the starting architecture of a lab are the
// same data: a `BlueprintLike`, which is already the thing the canvas knows how to
// place. That is the whole trick. One authored graph, two uses — the brief draws it
// read-only so you can see the system being described, and a lab drops the identical
// graph onto your sheet for you to fix.
//
// This module does the part drawing needs and placing does not: work out where every
// box lands once positions are normalised, and route a line between each pair. It is
// deliberately free of React, SVG strings aside, so the geometry can be tested
// without a browser.

import type { BlueprintLike } from './blueprints.js';
import type { ArchNodeType, EdgeKind } from './types.js';

/**
 * Box size in the same units blueprint `at` positions use, chosen to match what a
 * node actually occupies on the canvas (138–228px wide, ~46px tall) so a diagram and
 * the sheet it loads onto have the same proportions.
 */
export const DIAGRAM_NODE_W = 156;
export const DIAGRAM_NODE_H = 46;
/** Breathing room around the outermost boxes, so nothing touches the frame. */
const PAD = 24;

export interface DiagramBox {
  key: string;
  type: ArchNodeType;
  label: string;
  annotation: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Boundaries are containers: drawn first, behind everything they hold. */
  group: boolean;
}

export interface DiagramLink {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** An SVG cubic path, edge of source to edge of target. */
  path: string;
  /** Where the arrowhead points, and the angle it points at, in degrees. */
  head: { x: number; y: number; angle: number };
  /** The curve's midpoint — where a label reads without sitting on a box. */
  mid: { x: number; y: number };
}

export interface DiagramLayout {
  boxes: DiagramBox[];
  links: DiagramLink[];
  width: number;
  height: number;
  /** Ready to hand to an `<svg viewBox>`. */
  viewBox: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Lay out an authored graph.
 *
 * Positions are taken as authored — this is not auto-layout, because the person who
 * wrote the diagram knows which box belongs above which, and a layout algorithm that
 * second-guesses them produces a picture nobody recognises. All this does is
 * normalise the origin, resolve parent offsets, and route the lines.
 */
export function layoutDiagram(source: BlueprintLike): DiagramLayout {
  const authored = new Map(source.nodes.map((n) => [n.key, n]));

  // A child's `at` is relative to its boundary, the way React Flow reads it, so the
  // same numbers place identically here and on the canvas.
  const absolute = new Map<string, Point>();
  const resolve = (key: string, seen: Set<string>): Point => {
    const cached = absolute.get(key);
    if (cached) return cached;
    const node = authored.get(key);
    if (!node) return { x: 0, y: 0 };
    let at = { x: node.at.x, y: node.at.y };
    // A cycle in `parent` would otherwise hang; treat the loop as top level.
    if (node.parent && authored.has(node.parent) && !seen.has(node.parent)) {
      const parent = resolve(node.parent, new Set(seen).add(key));
      at = { x: parent.x + at.x, y: parent.y + at.y };
    }
    absolute.set(key, at);
    return at;
  };

  const raw: DiagramBox[] = source.nodes.map((n) => {
    const at = resolve(n.key, new Set([n.key]));
    const group = n.type === 'group';
    return {
      key: n.key,
      type: n.type,
      label: n.label,
      annotation: n.annotation,
      x: at.x,
      y: at.y,
      w: n.size?.w ?? (group ? 320 : DIAGRAM_NODE_W),
      h: n.size?.h ?? (group ? 200 : DIAGRAM_NODE_H),
      group,
    };
  });

  if (raw.length === 0) {
    return { boxes: [], links: [], width: 0, height: 0, viewBox: '0 0 0 0' };
  }

  const minX = Math.min(...raw.map((b) => b.x));
  const minY = Math.min(...raw.map((b) => b.y));
  const boxes = raw.map((b) => ({ ...b, x: b.x - minX + PAD, y: b.y - minY + PAD }));

  const width = Math.max(...boxes.map((b) => b.x + b.w)) + PAD;
  const height = Math.max(...boxes.map((b) => b.y + b.h)) + PAD;

  const byKey = new Map(boxes.map((b) => [b.key, b]));
  const links: DiagramLink[] = [];
  for (const edge of source.edges) {
    const from = byKey.get(edge.from);
    const to = byKey.get(edge.to);
    // A self-edge has no honest two-point route and no diagram needs one.
    if (!from || !to || from === to) continue;
    links.push(route(from, to, edge.kind, edge.label));
  }

  // Boundaries behind their contents, and larger boxes behind smaller ones, so a
  // group never hides what it contains regardless of authoring order.
  boxes.sort((a, b) => Number(b.group) - Number(a.group) || b.w * b.h - a.w * a.h);

  return { boxes, links, width, height, viewBox: `0 0 ${round(width)} ${round(height)}` };
}

/**
 * Leave whichever side of the source faces the target, and arrive on the facing
 * side of the target. Anything else produces a line that crosses its own box.
 */
function route(from: DiagramBox, to: DiagramBox, kind: EdgeKind, label?: string): DiagramLink {
  const horizontal =
    to.x >= from.x + from.w || to.x + to.w <= from.x
      ? true
      : // Overlapping columns: the honest route is vertical.
        false;

  let start: Point;
  let end: Point;
  let c1: Point;
  let c2: Point;

  if (horizontal) {
    const rightwards = to.x >= from.x + from.w;
    start = { x: rightwards ? from.x + from.w : from.x, y: from.y + from.h / 2 };
    end = { x: rightwards ? to.x : to.x + to.w, y: to.y + to.h / 2 };
    const reach = Math.max(28, Math.abs(end.x - start.x) / 2);
    c1 = { x: start.x + (rightwards ? reach : -reach), y: start.y };
    c2 = { x: end.x + (rightwards ? -reach : reach), y: end.y };
  } else {
    const downwards = to.y >= from.y;
    start = { x: from.x + from.w / 2, y: downwards ? from.y + from.h : from.y };
    end = { x: to.x + to.w / 2, y: downwards ? to.y : to.y + to.h };
    const reach = Math.max(24, Math.abs(end.y - start.y) / 2);
    c1 = { x: start.x, y: start.y + (downwards ? reach : -reach) };
    c2 = { x: end.x, y: end.y + (downwards ? -reach : reach) };
  }

  // The arrowhead follows the curve's own tangent at the end, not the straight line
  // between the boxes, or it points off at an angle on every bend.
  const tangent = { x: end.x - c2.x, y: end.y - c2.y };
  const angle =
    Math.hypot(tangent.x, tangent.y) < 0.01
      ? (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
      : (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;

  return {
    from: from.key,
    to: to.key,
    kind,
    ...(label ? { label } : {}),
    path: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`,
    head: { x: round(end.x), y: round(end.y), angle: round(angle) },
    mid: bezierMidpoint(start, c1, c2, end),
  };
}

/** A cubic at t=0.5 collapses to this, which beats sampling the curve. */
function bezierMidpoint(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: round((p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8),
    y: round((p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8),
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;
