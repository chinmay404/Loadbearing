import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type {
  ArchNodeType,
  BlueprintLike,
  CanvasDoc,
  CanvasMarkup,
  EdgeKind,
  Flow,
  FlowKind,
  GraphDSL,
  NodeAttrs,
  SimConfig,
  SimResult,
  SuggestedAddition,
} from '@loadbearing/shared';
import { NODE_SPEC } from '../canvas/nodeCatalog';

export type Tool = 'select' | 'pen' | 'eraser' | 'sticky';

export interface ArchNodeData extends Record<string, unknown> {
  archType: ArchNodeType;
  label: string;
  annotation: string;
  attrs: NodeAttrs;
  /** Set when this node came from an AI suggestion and has not been accepted yet. */
  ghost?: { why: string };
  /**
   * Mirrors the React Flow interaction flags. Duplicated into data on purpose: a
   * custom node component is not given `draggable`/`selectable`, so without this
   * the node itself cannot draw its own lock badge — and the badge is the only way
   * back once a locked node has stopped being selectable.
   */
  locked?: boolean;
}

export interface StickyData extends Record<string, unknown> {
  text: string;
}

export type AnyNode = Node<ArchNodeData, 'arch'> | Node<StickyData, 'sticky'>;

export interface Stroke {
  points: [number, number][];
  color: string;
}

interface Snapshot {
  nodes: AnyNode[];
  edges: Edge[];
  flows: Flow[];
  strokes: Stroke[];
}

interface CanvasState extends Snapshot {
  problemId: string | null;
  tool: Tool;
  edgeKind: EdgeKind;
  penColor: string;
  simResult: SimResult | null;
  simConfig: SimConfig;
  simRunning: boolean;
  /** Which engine produced simResult: the local copy, or the server's. */
  simSource: 'local' | 'server';
  markup: CanvasMarkup[];
  /** Node ids that entered the drawing by accepting an AI suggestion. */
  aiAccepted: string[];
  viewportCenter: { x: number; y: number };
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;

  // lifecycle
  loadProblem: (problemId: string, doc: CanvasDoc | null) => void;
  reset: () => void;

  // graph editing
  onNodesChange: (changes: NodeChange<AnyNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  addArchNode: (
    type: ArchNodeType,
    position: { x: number; y: number },
    overrides?: { label?: string; annotation?: string; attrs?: NodeAttrs },
  ) => string;
  /** Places a node near the middle of what the user is currently looking at. */
  addArchNodeAtCenter: (
    type: ArchNodeType,
    overrides?: { label?: string; annotation?: string; attrs?: NodeAttrs },
  ) => string;
  setViewportCenter: (c: { x: number; y: number }) => void;
  addSticky: (position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<ArchNodeData>) => void;
  updateStickyText: (id: string, text: string) => void;
  updateNodeAttrs: (id: string, patch: NodeAttrs) => void;
  setEdgeKind: (id: string, kind: EdgeKind) => void;
  setEdgeLabel: (id: string, label: string) => void;
  deleteSelection: () => void;
  /** Drag one end of an existing edge onto a different component. */
  reconnectEdge: (edgeId: string, next: Connection) => boolean;
  /** Drop the edge entirely, leaving both components in place. */
  detachEdge: (edgeId: string) => void;
  /** Puts an existing component in the middle of an edge: A→B becomes A→X→B. */
  spliceNodeIntoEdge: (edgeId: string, nodeId: string) => boolean;
  /** Creates a component of `type` on the edge's midpoint and splices it in. */
  insertNodeOnEdge: (edgeId: string, type: ArchNodeType) => string | null;
  /**
   * Puts a component inside a boundary, or takes it out, based on where it was
   * dropped. Once inside, moving the boundary moves everything in it.
   */
  reparentDroppedNodes: (ids: string[]) => { attached: number; detached: number };
  /** Set while the component picker is being used to fill a gap in an edge. */
  edgeInsertTarget: string | null;
  setEdgeInsertTarget: (edgeId: string | null) => void;

  /** Drops a prebuilt subsystem or saved template onto the sheet, fully editable. */
  insertBlueprint: (blueprint: BlueprintLike) => string[];
  /** Turns the current selection (or the whole sheet) into a reusable template. */
  selectionAsTemplate: (name: string, summary: string) => BlueprintLike | null;

  // stacking and pinning
  /** Moves the selection in the stacking order. 'front'/'back' jump; ±1 steps. */
  restack: (where: 'front' | 'back' | 'forward' | 'backward') => void;
  /**
   * Pins or releases the selection. A pinned component cannot be selected, dragged
   * or deleted — clicks pass through it — so it is released from its own badge.
   */
  setLocked: (locked: boolean) => void;
  unlockNode: (id: string) => void;
  toggleLockOnSelection: () => void;

  // flows
  addFlow: () => string;
  updateFlow: (id: string, patch: Partial<Flow>) => void;
  removeFlow: (id: string) => void;
  appendFlowStep: (flowId: string, nodeId: string) => void;
  removeFlowStep: (flowId: string, index: number) => void;

  // freeform
  setTool: (t: Tool) => void;
  addStroke: (s: Stroke) => void;
  eraseStrokeAt: (x: number, y: number, radius: number) => void;
  clearStrokes: () => void;

  // ai + sim
  setMarkup: (m: CanvasMarkup[]) => void;
  clearAi: () => void;
  addGhosts: (suggestions: SuggestedAddition[]) => void;
  acceptGhost: (id: string) => void;
  rejectGhost: (id: string) => void;
  acceptAllGhosts: () => void;
  rejectAllGhosts: () => void;
  /** Removes every AI-accepted component again — the "put it back how I had it" button. */
  revertAiChanges: () => void;
  setSimResult: (r: SimResult | null, source?: 'local' | 'server') => void;
  setSimConfig: (patch: Partial<SimConfig>) => void;
  setSimRunning: (v: boolean) => void;
  toggleKillNode: (id: string) => void;

  // history
  undo: () => void;
  redo: () => void;
  markClean: () => void;

  // serialization
  toGraph: () => GraphDSL;
  toDoc: () => CanvasDoc;
}

let seq = 0;
const uid = (prefix: string) => `${prefix}${(seq += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const EMPTY: Snapshot = { nodes: [], edges: [], flows: [], strokes: [] };

const snap = (s: CanvasState): Snapshot => ({
  nodes: s.nodes,
  edges: s.edges,
  flows: s.flows,
  strokes: s.strokes,
});

const edgeStyle = (kind: EdgeKind): Partial<Edge> => ({
  type: 'arch',
  animated: kind === 'async',
  data: { kind },
});

const kindOf = (e: Edge): EdgeKind => ((e.data as { kind?: EdgeKind } | undefined)?.kind ?? 'sync');

/** Boundaries live behind the components they contain, unless moved deliberately. */
const GROUP_Z = -1;

const sizeOf = (n: AnyNode): { w: number; h: number } => ({
  w: Number(n.style?.width ?? n.measured?.width ?? 168),
  h: Number(n.style?.height ?? n.measured?.height ?? 64),
});

/**
 * Where a node actually sits on the sheet. A child's stored position is relative
 * to its parent, so anything comparing two nodes' locations has to walk the chain.
 */
export function absolutePosition(node: AnyNode, all: AnyNode[]): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const seen = new Set<string>([node.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = all.find((n) => n.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

const isGroup = (n: AnyNode): boolean => n.type === 'arch' && n.data.archType === 'group';

/**
 * The innermost boundary containing a point. Innermost, because boundaries nest —
 * an AI stack inside a VPC — and dropping into the outer one when you aimed at the
 * inner one is the wrong answer.
 */
function groupContaining(
  all: AnyNode[],
  point: { x: number; y: number },
  excludeIds: Set<string>,
): AnyNode | null {
  const candidates = all.filter((n) => isGroup(n) && !excludeIds.has(n.id));
  let best: AnyNode | null = null;
  let bestArea = Infinity;
  for (const g of candidates) {
    const at = absolutePosition(g, all);
    const { w, h } = sizeOf(g);
    if (point.x < at.x || point.y < at.y || point.x > at.x + w || point.y > at.y + h) continue;
    const area = w * h;
    if (area < bestArea) {
      best = g;
      bestArea = area;
    }
  }
  return best;
}

/** Every descendant of a node, so a boundary is never dropped inside itself. */
function descendantIds(all: AnyNode[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of all) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * React Flow requires a parent to appear before its children in the node array,
 * so any change to parentage has to reorder. Depth-first by parent chain, stable
 * within a depth so nothing else shifts.
 */
function orderForParents(nodes: AnyNode[]): AnyNode[] {
  const depth = (n: AnyNode): number => {
    let d = 0;
    let parentId = n.parentId;
    const seen = new Set<string>([n.id]);
    while (parentId && !seen.has(parentId) && d < 20) {
      seen.add(parentId);
      const parent = nodes.find((x) => x.id === parentId);
      if (!parent) break;
      d += 1;
      parentId = parent.parentId;
    }
    return d;
  };
  return nodes
    .map((n, i) => ({ n, i, d: depth(n) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.n);
}

const zOf = (n: AnyNode): number =>
  typeof n.zIndex === 'number'
    ? n.zIndex
    : n.type === 'arch' && n.data.archType === 'group'
      ? GROUP_Z
      : 0;

/**
 * A declared flow is an ordered list of node ids, so inserting a component
 * between two of them has to update the flow too — otherwise the request path
 * the simulator uses still skips the component that was just put in its way,
 * and the numbers quietly stop describing the drawing.
 */
function spliceFlowSteps(flows: Flow[], from: string, to: string, middle: string): Flow[] {
  return flows.map((f) => {
    const steps: string[] = [];
    for (let i = 0; i < f.steps.length; i += 1) {
      steps.push(f.steps[i]!);
      if (f.steps[i] === from && f.steps[i + 1] === to) steps.push(middle);
    }
    return steps.length === f.steps.length ? f : { ...f, steps };
  });
}

export const useCanvas = create<CanvasState>((set, get) => ({
  ...EMPTY,
  problemId: null,
  tool: 'select',
  edgeKind: 'sync',
  penColor: '#cfa349',
  simResult: null,
  simConfig: { rpsMultiplier: 1, killNodeIds: [], thirdPartyLatencyMs: 0 },
  simRunning: false,
  simSource: 'local',
  markup: [],
  aiAccepted: [],
  viewportCenter: { x: 300, y: 200 },
  past: [],
  future: [],
  dirty: false,

  loadProblem: (problemId, doc) => {
    if (!doc) {
      set({ ...EMPTY, problemId, past: [], future: [], markup: [], aiAccepted: [], simResult: null, dirty: false });
      return;
    }
    const nodes: AnyNode[] = [
      ...doc.nodes.map(
        (n) =>
          ({
            id: n.id,
            type: 'arch',
            position: n.position,
            ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
            ...(n.size ? { style: { width: n.size.w, height: n.size.h } } : {}),
            // A boundary defaults behind everything so components sit inside it,
            // but a saved order always wins — the user may have deliberately
            // pulled one forward.
            zIndex: typeof n.z === 'number' ? n.z : n.type === 'group' ? GROUP_Z : 0,
            ...(n.locked ? { draggable: false, deletable: false, selectable: false } : {}),
            data: {
              archType: n.type,
              label: n.label,
              annotation: n.annotation,
              attrs: n.attrs ?? {},
            },
          }) as Node<ArchNodeData, 'arch'>,
      ),
      ...doc.stickies.map(
        (s) =>
          ({
            id: s.id,
            type: 'sticky',
            position: s.position,
            data: { text: s.text },
          }) as Node<StickyData, 'sticky'>,
      ),
    ];
    // Dropping an AI-suggested component used to leave its edges behind, and a
    // saved document carries them forever. An edge with a missing end is not a
    // connection, so it does not survive a load.
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = doc.edges
      .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label || undefined,
        ...edgeStyle(e.kind),
      }));
    set({
      problemId,
      nodes,
      edges,
      flows: doc.flows ?? [],
      strokes: doc.strokes ?? [],
      past: [],
      future: [],
      markup: [],
      aiAccepted: [],
      simResult: null,
      dirty: false,
    });
  },

  reset: () => set({ ...EMPTY, past: [], future: [], markup: [], aiAccepted: [], simResult: null, dirty: true }),

  onNodesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    // Selection and React Flow's own measurement passes are not edits. Treating
    // them as edits makes a stale tab autosave over a design it never touched.
    const meaningful = changes.some(
      (c) =>
        c.type === 'remove' ||
        c.type === 'add' ||
        c.type === 'replace' ||
        (c.type === 'position' && c.dragging === false) ||
        (c.type === 'dimensions' && c.resizing === true),
    );
    if (structural) set((s) => ({ past: [...s.past.slice(-49), snap(s)], future: [] }));
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), ...(meaningful ? { dirty: true } : {}) }));
  },

  onEdgesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    const meaningful = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    if (structural) set((s) => ({ past: [...s.past.slice(-49), snap(s)], future: [] }));
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), ...(meaningful ? { dirty: true } : {}) }));
  },

  onConnect: (c) =>
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      edges: addEdge({ ...c, id: uid('e'), ...edgeStyle(s.edgeKind) }, s.edges),
      dirty: true,
    })),

  addArchNode: (type, position, overrides) => {
    const spec = NODE_SPEC[type];
    const id = uid('n');
    const node: Node<ArchNodeData, 'arch'> = {
      id,
      type: 'arch',
      position,
      ...(type === 'group' ? { style: { width: 300, height: 220 }, zIndex: GROUP_Z } : {}),
      data: {
        archType: type,
        label: overrides?.label ?? spec.label,
        annotation: overrides?.annotation ?? '',
        attrs: { ...spec.defaults, ...(overrides?.attrs ?? {}) },
      },
    };
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      nodes: [...s.nodes, node],
      dirty: true,
    }));
    return id;
  },

  addArchNodeAtCenter: (type, overrides) => {
    const { viewportCenter, nodes } = get();
    // Cascade slightly so repeated clicks do not stack into one pile.
    const offset = (nodes.length % 6) * 26;
    return get().addArchNode(
      type,
      { x: viewportCenter.x - 80 + offset, y: viewportCenter.y - 30 + offset },
      overrides,
    );
  },

  setViewportCenter: (viewportCenter) => set({ viewportCenter }),

  addSticky: (position) => {
    const node: Node<StickyData, 'sticky'> = {
      id: uid('s'),
      type: 'sticky',
      position,
      data: { text: '' },
    };
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      nodes: [...s.nodes, node],
      dirty: true,
    }));
  },

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && n.type === 'arch' ? { ...n, data: { ...n.data, ...patch } } : n,
      ) as AnyNode[],
      dirty: true,
    })),

  updateStickyText: (id, text) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id && n.type === 'sticky' ? { ...n, data: { text } } : n)) as AnyNode[],
      dirty: true,
    })),

  updateNodeAttrs: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && n.type === 'arch'
          ? { ...n, data: { ...n.data, attrs: { ...n.data.attrs, ...patch } } }
          : n,
      ) as AnyNode[],
      dirty: true,
    })),

  setEdgeKind: (id, kind) =>
    set((s) => ({
      edges: s.edges.map((e) => (e.id === id ? { ...e, ...edgeStyle(kind) } : e)),
      dirty: true,
    })),

  setEdgeLabel: (id, label) =>
    set((s) => ({
      edges: s.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)),
      dirty: true,
    })),

  /**
   * Moving an endpoint keeps the edge's identity — its kind and its label travel
   * with it — because re-pointing a connection is an edit to that connection,
   * not a delete and a redraw.
   */
  reconnectEdge: (edgeId, next) => {
    if (!next.source || !next.target || next.source === next.target) return false;
    let ok = false;
    set((s) => {
      const old = s.edges.find((e) => e.id === edgeId);
      if (!old) return {};
      const duplicate = s.edges.some(
        (e) => e.id !== edgeId && e.source === next.source && e.target === next.target,
      );
      if (duplicate) return {};
      ok = true;
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        edges: s.edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                source: next.source!,
                target: next.target!,
                sourceHandle: next.sourceHandle ?? null,
                targetHandle: next.targetHandle ?? null,
              }
            : e,
        ),
        dirty: true,
      };
    });
    return ok;
  },

  detachEdge: (edgeId) =>
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      edges: s.edges.filter((e) => e.id !== edgeId),
      dirty: true,
    })),

  spliceNodeIntoEdge: (edgeId, nodeId) => {
    let ok = false;
    set((s) => {
      const edge = s.edges.find((e) => e.id === edgeId);
      if (!edge || edge.source === nodeId || edge.target === nodeId) return {};
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== 'arch') return {};
      ok = true;
      const kind = kindOf(edge);
      // The label describes what travels over the connection, so it stays on the
      // first hop and the second is left unlabelled rather than duplicated.
      const first: Edge = {
        id: uid('e'),
        source: edge.source,
        target: nodeId,
        ...(edge.label ? { label: edge.label } : {}),
        ...edgeStyle(kind),
      };
      const second: Edge = {
        id: uid('e'),
        source: nodeId,
        target: edge.target,
        ...edgeStyle(kind),
      };
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        edges: [...s.edges.filter((e) => e.id !== edgeId), first, second],
        flows: spliceFlowSteps(s.flows, edge.source, edge.target, nodeId),
        dirty: true,
      };
    });
    return ok;
  },

  insertNodeOnEdge: (edgeId, type) => {
    const { edges, nodes } = get();
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return null;
    const from = nodes.find((n) => n.id === edge.source);
    const to = nodes.find((n) => n.id === edge.target);
    if (!from || !to) return null;

    // Sit on the midpoint, nudged clear of the line so the new box does not
    // land underneath the edge it was inserted into.
    const mid = {
      x: (from.position.x + to.position.x) / 2,
      y: (from.position.y + to.position.y) / 2 + 70,
    };
    const id = get().addArchNode(type, mid);
    get().spliceNodeIntoEdge(edgeId, id);
    return id;
  },

  edgeInsertTarget: null,
  setEdgeInsertTarget: (edgeInsertTarget) => set({ edgeInsertTarget }),

  reparentDroppedNodes: (ids) => {
    let attached = 0;
    let detached = 0;
    set((s) => {
      let nodes = s.nodes;
      for (const id of ids) {
        const node = nodes.find((n) => n.id === id);
        if (!node) continue;

        const at = absolutePosition(node, nodes);
        const { w, h } = sizeOf(node);
        const centre = { x: at.x + w / 2, y: at.y + h / 2 };
        // A boundary cannot go inside itself or anything it already contains.
        const target = groupContaining(nodes, centre, descendantIds(nodes, id));
        const currentParent = node.parentId ?? null;
        const nextParent = target?.id ?? null;
        if (currentParent === nextParent) continue;

        // The stored position is relative to the parent, so it has to be
        // recomputed or the component jumps the moment it changes hands.
        const parentAt = target ? absolutePosition(target, nodes) : { x: 0, y: 0 };
        const position = { x: at.x - parentAt.x, y: at.y - parentAt.y };
        if (nextParent) attached += 1;
        else detached += 1;

        nodes = nodes.map((n) =>
          n.id === id
            ? ({
                ...n,
                position,
                ...(nextParent ? { parentId: nextParent } : { parentId: undefined }),
              } as AnyNode)
            : n,
        );
      }
      if (attached === 0 && detached === 0) return {};
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        nodes: orderForParents(nodes),
        dirty: true,
      };
    });
    return { attached, detached };
  },

  insertBlueprint: (blueprint) => {
    const { viewportCenter, nodes: existing } = get();
    // Land clear of whatever is already drawn rather than on top of it: a
    // blueprint dropped over an existing design is worse than no blueprint.
    const rightEdge = existing.reduce((max, n) => Math.max(max, n.position.x + 200), -Infinity);
    const originX = Number.isFinite(rightEdge)
      ? Math.max(viewportCenter.x - 300, rightEdge + 90)
      : viewportCenter.x - 300;
    const originY = viewportCenter.y - 120;

    // Blueprint keys are local, so every id is rewritten — inserting the same
    // blueprint twice has to produce two independent copies.
    const idFor = new Map(blueprint.nodes.map((n) => [n.key, uid('n')]));

    const newNodes: Node<ArchNodeData, 'arch'>[] = blueprint.nodes.map((n) => {
      const spec = NODE_SPEC[n.type];
      return {
        id: idFor.get(n.key)!,
        type: 'arch',
        position: { x: originX + n.at.x, y: originY + n.at.y },
        selected: true,
        zIndex: n.type === 'group' ? GROUP_Z : 0,
        ...(n.parent && idFor.has(n.parent)
          ? { parentId: idFor.get(n.parent)!, extent: 'parent' as const }
          : {}),
        ...(n.size ? { style: { width: n.size.w, height: n.size.h } } : {}),
        data: {
          archType: n.type,
          label: n.label,
          annotation: n.annotation,
          attrs: { ...spec.defaults, ...(n.attrs ?? {}) },
        },
      };
    });

    const newEdges: Edge[] = blueprint.edges.flatMap((e) => {
      const from = idFor.get(e.from);
      const to = idFor.get(e.to);
      if (!from || !to) return [];
      return [
        {
          id: uid('e'),
          source: from,
          target: to,
          ...(e.label ? { label: e.label } : {}),
          ...edgeStyle(e.kind),
        },
      ];
    });

    const newFlows: Flow[] = blueprint.flows.map((f) => ({
      id: uid('f'),
      name: f.name,
      kind: f.kind,
      steps: f.steps.map((k) => idFor.get(k)).filter((x): x is string => Boolean(x)),
      rps: f.rps,
      description: f.description,
    }));

    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...newNodes] as AnyNode[],
      edges: [...s.edges, ...newEdges],
      flows: [...s.flows, ...newFlows],
      dirty: true,
    }));

    return newNodes.map((n) => n.id);
  },

  selectionAsTemplate: (name, summary) => {
    const s = get();
    const chosen = s.nodes.filter(
      (n): n is Node<ArchNodeData, 'arch'> => n.type === 'arch' && !n.data.ghost && Boolean(n.selected),
    );
    // Nothing selected means "save the whole sheet", which is what you want the
    // first time you build a pattern you like.
    const source =
      chosen.length > 0
        ? chosen
        : (s.nodes.filter(
            (n): n is Node<ArchNodeData, 'arch'> => n.type === 'arch' && !n.data.ghost,
          ) as Node<ArchNodeData, 'arch'>[]);
    if (source.length === 0) return null;

    // Positions are stored relative to the group's own top-left, so the template
    // lands wherever it is next dropped rather than at its original coordinates.
    const minX = Math.min(...source.map((n) => n.position.x));
    const minY = Math.min(...source.map((n) => n.position.y));
    const included = new Set(source.map((n) => n.id));

    return {
      name,
      summary,
      nodes: source.map((n) => ({
        key: n.id,
        type: n.data.archType,
        label: n.data.label,
        annotation: n.data.annotation,
        at: { x: Math.round(n.position.x - minX), y: Math.round(n.position.y - minY) },
        attrs: n.data.attrs,
        ...(n.style?.width && n.style?.height
          ? { size: { w: Number(n.style.width), h: Number(n.style.height) } }
          : {}),
        ...(n.parentId && included.has(n.parentId) ? { parent: n.parentId } : {}),
      })),
      edges: s.edges
        .filter((e) => included.has(e.source) && included.has(e.target))
        .map((e) => ({
          from: e.source,
          to: e.target,
          kind: kindOf(e),
          ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
        })),
      // Only flows entirely inside the selection: a flow with steps outside it
      // would arrive somewhere else as a path with holes in it.
      flows: s.flows
        .filter((f) => f.steps.length > 0 && f.steps.every((step) => included.has(step)))
        .map((f) => ({
          name: f.name,
          kind: f.kind,
          steps: [...f.steps],
          rps: f.rps,
          description: f.description ?? '',
        })),
    };
  },

  restack: (where) =>
    set((s) => {
      const chosen = s.nodes.filter((n) => n.selected);
      if (chosen.length === 0) return {};
      const all = s.nodes.map(zOf);
      const top = Math.max(0, ...all);
      const bottom = Math.min(0, ...all);
      const move = (n: AnyNode): number => {
        const z = zOf(n);
        if (where === 'front') return top + 1;
        if (where === 'back') return bottom - 1;
        return where === 'forward' ? z + 1 : z - 1;
      };
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        nodes: s.nodes.map((n) => (n.selected ? { ...n, zIndex: move(n) } : n)) as AnyNode[],
        dirty: true,
      };
    }),

  setLocked: (locked) =>
    set((s) => {
      if (!s.nodes.some((n) => n.selected)) return {};
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        // A pinned component drops out of selection entirely, so a click passes
        // through it to whatever is behind — which is the whole point of pinning a
        // background boundary. It also stops being selected right now, or it would
        // sit highlighted with no way to act on it.
        nodes: s.nodes.map((n) =>
          n.selected
            ? {
                ...n,
                draggable: !locked,
                deletable: !locked,
                selectable: !locked,
                selected: locked ? false : n.selected,
                ...(n.type === 'arch'
                  ? { data: { ...(n.data as ArchNodeData), locked } as ArchNodeData }
                  : {}),
              }
            : n,
        ) as AnyNode[],
        dirty: true,
      };
    }),

  unlockNode: (id) =>
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      nodes: s.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              draggable: true,
              deletable: true,
              selectable: true,
              ...(n.type === 'arch'
                ? { data: { ...(n.data as ArchNodeData), locked: false } as ArchNodeData }
                : {}),
            }
          : n,
      ) as AnyNode[],
      dirty: true,
    })),

  toggleLockOnSelection: () => {
    const chosen = get().nodes.filter((n) => n.selected);
    if (chosen.length === 0) return;
    // Only unpinned things can be selected now, so this keystroke always pins.
    get().setLocked(true);
  },

  deleteSelection: () =>
    set((s) => {
      // A pinned component survives Delete — that is most of what pinning is for.
      const doomed = new Set(
        s.nodes.filter((n) => n.selected && n.deletable !== false).map((n) => n.id),
      );
      const keptNodes = s.nodes.filter((n) => !doomed.has(n.id));
      const keptEdges = s.edges.filter(
        (e) => !e.selected && !doomed.has(e.source) && !doomed.has(e.target),
      );
      const flows = s.flows.map((f) => ({ ...f, steps: f.steps.filter((x) => !doomed.has(x)) }));
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        nodes: keptNodes,
        edges: keptEdges,
        flows,
        markup: s.markup.filter((m) => !doomed.has(m.nodeId)),
        dirty: true,
      };
    }),

  addFlow: () => {
    const id = uid('f');
    const flow: Flow = {
      id,
      name: `flow ${get().flows.length + 1}`,
      kind: 'read',
      steps: [],
      rps: 100,
      description: '',
    };
    set((s) => ({ flows: [...s.flows, flow], dirty: true }));
    return id;
  },

  updateFlow: (id, patch) =>
    set((s) => ({ flows: s.flows.map((f) => (f.id === id ? { ...f, ...patch } : f)), dirty: true })),

  removeFlow: (id) => set((s) => ({ flows: s.flows.filter((f) => f.id !== id), dirty: true })),

  appendFlowStep: (flowId, nodeId) =>
    set((s) => ({
      flows: s.flows.map((f) => (f.id === flowId ? { ...f, steps: [...f.steps, nodeId] } : f)),
      dirty: true,
    })),

  removeFlowStep: (flowId, index) =>
    set((s) => ({
      flows: s.flows.map((f) =>
        f.id === flowId ? { ...f, steps: f.steps.filter((_, i) => i !== index) } : f,
      ),
      dirty: true,
    })),

  setTool: (tool) => set({ tool }),

  addStroke: (stroke) =>
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      strokes: [...s.strokes, stroke],
      dirty: true,
    })),

  eraseStrokeAt: (x, y, radius) =>
    set((s) => {
      const hit = (st: Stroke) =>
        st.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= radius ** 2);
      const strokes = s.strokes.filter((st) => !hit(st));
      if (strokes.length === s.strokes.length) return {};
      return { past: [...s.past.slice(-49), snap(s)], future: [], strokes, dirty: true };
    }),

  clearStrokes: () => set((s) => ({ past: [...s.past.slice(-49), snap(s)], strokes: [], dirty: true })),

  setMarkup: (markup) => set({ markup }),

  clearAi: () =>
    set((s) => {
      // The ghosts' edges have to go with them, or the saved document keeps
      // connections pointing at components that no longer exist.
      const doomed = new Set(
        s.nodes.filter((n) => n.type === 'arch' && n.data.ghost).map((n) => n.id),
      );
      return {
        markup: [],
        nodes: s.nodes.filter((n) => !doomed.has(n.id)),
        edges: s.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
      };
    }),

  addGhosts: (suggestions) =>
    set((s) => {
      const existing = s.nodes.filter(
        (n) => n.type === 'arch' && !(n.data as ArchNodeData).ghost,
      ) as Node<ArchNodeData, 'arch'>[];
      // Proposals get their own column to the right of the drawing, spaced far
      // enough apart that five suggestions never pile into one unreadable stack.
      const GHOST_SPACING = 190;
      const baseX = existing.length
        ? Math.max(...existing.map((n) => n.position.x)) + 300
        : s.viewportCenter.x + 140;
      const baseY = existing.length
        ? Math.min(...existing.map((n) => n.position.y))
        : s.viewportCenter.y - 100;
      const newNodes: AnyNode[] = [];
      const newEdges: Edge[] = [];
      suggestions.forEach((sg, i) => {
        const id = uid('g');
        newNodes.push({
          id,
          type: 'arch',
          position: { x: baseX, y: baseY + i * GHOST_SPACING },
          data: {
            archType: sg.type,
            label: sg.label,
            annotation: sg.annotation,
            attrs: { ...(NODE_SPEC[sg.type]?.defaults ?? {}) },
            ghost: { why: sg.why },
          },
        } as Node<ArchNodeData, 'arch'>);
        if (sg.connect_from) {
          newEdges.push({
            id: uid('ge'),
            source: sg.connect_from,
            target: id,
            ...edgeStyle(sg.kind),
            style: { strokeDasharray: '3 4', opacity: 0.7 },
          });
        }
        if (sg.connect_to) {
          newEdges.push({
            id: uid('ge'),
            source: id,
            target: sg.connect_to,
            ...edgeStyle(sg.kind),
            style: { strokeDasharray: '3 4', opacity: 0.7 },
          });
        }
      });
      return { nodes: [...s.nodes, ...newNodes], edges: [...s.edges, ...newEdges] };
    }),

  acceptGhost: (id) =>
    set((s) => ({
      past: [...s.past.slice(-49), snap(s)],
      future: [],
      nodes: s.nodes.map((n) => {
        if (n.id !== id || n.type !== 'arch') return n;
        const { ghost: _ghost, ...rest } = n.data;
        return { ...n, data: rest as ArchNodeData };
      }) as AnyNode[],
      edges: s.edges.map((e) =>
        e.source === id || e.target === id ? { ...e, style: undefined } : e,
      ),
      aiAccepted: [...s.aiAccepted, id],
      dirty: true,
    })),

  rejectGhost: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    })),

  acceptAllGhosts: () =>
    set((s) => {
      const ids = s.nodes
        .filter((n) => n.type === 'arch' && (n.data as ArchNodeData).ghost)
        .map((n) => n.id);
      if (ids.length === 0) return {};
      const idSet = new Set(ids);
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        nodes: s.nodes.map((n) => {
          if (!idSet.has(n.id) || n.type !== 'arch') return n;
          const { ghost: _ghost, ...rest } = n.data;
          return { ...n, data: rest as ArchNodeData };
        }) as AnyNode[],
        edges: s.edges.map((e) =>
          idSet.has(e.source) || idSet.has(e.target) ? { ...e, style: undefined } : e,
        ),
        aiAccepted: [...s.aiAccepted, ...ids],
        dirty: true,
      };
    }),

  rejectAllGhosts: () =>
    set((s) => {
      const idSet = new Set(
        s.nodes.filter((n) => n.type === 'arch' && (n.data as ArchNodeData).ghost).map((n) => n.id),
      );
      if (idSet.size === 0) return {};
      return {
        nodes: s.nodes.filter((n) => !idSet.has(n.id)),
        edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      };
    }),

  revertAiChanges: () =>
    set((s) => {
      const doomed = new Set(s.aiAccepted);
      if (doomed.size === 0) return {};
      return {
        past: [...s.past.slice(-49), snap(s)],
        future: [],
        nodes: s.nodes.filter((n) => !doomed.has(n.id)),
        edges: s.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
        flows: s.flows.map((f) => ({ ...f, steps: f.steps.filter((x) => !doomed.has(x)) })),
        markup: s.markup.filter((m) => !doomed.has(m.nodeId)),
        aiAccepted: [],
        dirty: true,
      };
    }),

  setSimResult: (simResult, source = 'local') => set({ simResult, simSource: source }),
  setSimConfig: (patch) => set((s) => ({ simConfig: { ...s.simConfig, ...patch } })),
  setSimRunning: (simRunning) => set({ simRunning }),

  toggleKillNode: (id) =>
    set((s) => {
      const killed = s.simConfig.killNodeIds.includes(id);
      return {
        simConfig: {
          ...s.simConfig,
          killNodeIds: killed
            ? s.simConfig.killNodeIds.filter((x) => x !== id)
            : [...s.simConfig.killNodeIds, id],
        },
      };
    }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return { ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future.slice(0, 49)], dirty: true };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return { ...next, past: [...s.past, snap(s)], future: s.future.slice(1), dirty: true };
    }),

  markClean: () => set({ dirty: false }),

  toGraph: () => {
    const s = get();
    const arch = s.nodes.filter(
      (n): n is Node<ArchNodeData, 'arch'> => n.type === 'arch' && !n.data.ghost,
    );
    const ids = new Set(arch.map((n) => n.id));
    return {
      nodes: arch.map((n) => ({
        id: n.id,
        type: n.data.archType,
        label: n.data.label,
        annotation: n.data.annotation,
        attrs: n.data.attrs,
        ...(n.parentId ? { parentId: n.parentId } : {}),
      })),
      edges: s.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({
          id: e.id,
          from: e.source,
          to: e.target,
          kind: ((e.data as { kind?: EdgeKind } | undefined)?.kind ?? 'sync') as EdgeKind,
          label: typeof e.label === 'string' ? e.label : '',
        })),
      stickies: s.nodes
        .filter((n): n is Node<StickyData, 'sticky'> => n.type === 'sticky')
        .map((n) => ({ text: n.data.text }))
        .filter((x) => x.text.trim() !== ''),
      flows: s.flows.map((f) => ({ ...f, steps: f.steps.filter((x) => ids.has(x)) })),
    };
  },

  toDoc: () => {
    const s = get();
    return {
      nodes: s.nodes
        .filter((n): n is Node<ArchNodeData, 'arch'> => n.type === 'arch' && !n.data.ghost)
        .map((n) => ({
          id: n.id,
          type: n.data.archType,
          label: n.data.label,
          annotation: n.data.annotation,
          attrs: n.data.attrs,
          position: n.position,
          ...(n.parentId ? { parentId: n.parentId } : {}),
          ...(n.style?.width && n.style?.height
            ? { size: { w: Number(n.style.width), h: Number(n.style.height) } }
            : {}),
          ...(typeof n.zIndex === 'number' ? { z: n.zIndex } : {}),
          ...(n.draggable === false || n.data.locked ? { locked: true } : {}),
        })),
      edges: s.edges.map((e) => ({
        id: e.id,
        from: e.source,
        to: e.target,
        kind: ((e.data as { kind?: EdgeKind } | undefined)?.kind ?? 'sync') as EdgeKind,
        label: typeof e.label === 'string' ? e.label : '',
      })),
      stickies: s.nodes
        .filter((n): n is Node<StickyData, 'sticky'> => n.type === 'sticky')
        .map((n) => ({ id: n.id, text: n.data.text, position: n.position })),
      strokes: s.strokes,
      flows: s.flows,
    };
  },
}));

export const FLOW_KINDS: FlowKind[] = ['read', 'write', 'async', 'admin'];
