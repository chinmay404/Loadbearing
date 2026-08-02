// The stored drawing, reduced to the graph everything else reasons about.
//
// A CanvasDoc is what the client saves: components and connections, plus where they
// sit, how big they are, which bends a line has, what was drawn in pen. A GraphDSL
// is what the engine, the grader and the checks read: components and connections,
// and nothing about where anything is.
//
// The client has always done this narrowing in its store, which was fine while the
// client was the only thing that needed it. It is not any more — anything holding a
// saved document and wanting to run the engine over it needs the same reduction, and
// a second copy of it would be a second answer to "is geometry part of the design".

import type { BlueprintLike } from './blueprints.js';
import { layoutDiagram } from './diagram.js';
import type { CanvasDoc, GraphDSL } from './types.js';

/**
 * Geometry out, meaning in.
 *
 * Every section is treated as optional: a newly created project view is stored as
 * `{}`, which is a legitimate empty document, and an edge whose endpoints are no
 * longer on the sheet is dropped rather than carried — a connection to a component
 * that does not exist is not a connection.
 */
export function graphFromDoc(doc: CanvasDoc | null | undefined): GraphDSL {
  if (!doc) return { nodes: [], edges: [], stickies: [], flows: [] };

  const nodes = (doc.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    annotation: n.annotation,
    ...(n.attrs ? { attrs: n.attrs } : {}),
    ...(n.parentId ? { parentId: n.parentId } : {}),
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges = (doc.edges ?? [])
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? '',
      ...(e.share !== undefined ? { share: e.share } : {}),
      ...(e.retries !== undefined ? { retries: e.retries } : {}),
    }));

  return {
    nodes,
    edges,
    stickies: (doc.stickies ?? []).map((s) => ({ text: s.text })),
    // A flow that steps through a deleted component is not a path any more, so its
    // missing steps go — the same rule the edges follow.
    flows: (doc.flows ?? []).map((f) => ({ ...f, steps: f.steps.filter((s) => ids.has(s)) })),
  };
}

/**
 * An authored graph as a canvas document, ready to save.
 *
 * The client places a lab's starting architecture through the canvas store, which
 * knows about viewports and selection and undo. Nothing outside a browser has any of
 * that, and a caller holding only the API — the MCP server, a script — could
 * previously read a lab's brief, see the architecture in it, and have no way to put
 * it on the sheet. This is that missing step, and it produces the same positions the
 * brief renders, so the drawing matches the picture it came from.
 *
 * Ids are stable and derived from the authored keys rather than random, so placing
 * the same architecture twice produces the same document instead of a second copy
 * with different ids.
 */
export function docFromBlueprint(source: BlueprintLike): CanvasDoc {
  const layout = layoutDiagram(source);
  const at = new Map(layout.boxes.map((b) => [b.key, b]));
  const authored = new Map(source.nodes.map((n) => [n.key, n]));
  const id = (key: string) => `n-${key}`;

  return {
    nodes: source.nodes.map((n) => {
      const box = at.get(n.key);
      const inside = Boolean(n.parent && authored.has(n.parent));
      return {
        id: id(n.key),
        type: n.type,
        label: n.label,
        annotation: n.annotation,
        ...(n.attrs ? { attrs: n.attrs } : {}),
        ...(inside ? { parentId: id(n.parent!) } : {}),
        // A child is positioned relative to its boundary, the way React Flow reads
        // it; everything else takes the absolute position the layout worked out.
        position: inside ? { x: n.at.x, y: n.at.y } : { x: box?.x ?? n.at.x, y: box?.y ?? n.at.y },
        ...(n.size ? { size: n.size } : {}),
        ...(n.type === 'group' ? { z: -1 } : {}),
      };
    }),
    edges: source.edges.map((e, i) => ({
      id: `e-${i}`,
      from: id(e.from),
      to: id(e.to),
      kind: e.kind,
      label: e.label ?? '',
    })),
    stickies: [],
    strokes: [],
    flows: source.flows.map((f, i) => ({
      id: `f-${i}`,
      name: f.name,
      kind: f.kind,
      steps: f.steps.map(id),
      rps: f.rps,
      description: f.description,
    })),
  };
}
