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
  addArchNode: (type: ArchNodeType, position: { x: number; y: number }) => string;
  /** Places a node near the middle of what the user is currently looking at. */
  addArchNodeAtCenter: (type: ArchNodeType) => string;
  setViewportCenter: (c: { x: number; y: number }) => void;
  addSticky: (position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<ArchNodeData>) => void;
  updateStickyText: (id: string, text: string) => void;
  updateNodeAttrs: (id: string, patch: NodeAttrs) => void;
  setEdgeKind: (id: string, kind: EdgeKind) => void;
  setEdgeLabel: (id: string, label: string) => void;
  deleteSelection: () => void;

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
  viewportCenter: { x: 300, y: 200 },
  past: [],
  future: [],
  dirty: false,

  loadProblem: (problemId, doc) => {
    if (!doc) {
      set({ ...EMPTY, problemId, past: [], future: [], markup: [], simResult: null, dirty: false });
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
    const edges: Edge[] = doc.edges.map((e) => ({
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
      simResult: null,
      dirty: false,
    });
  },

  reset: () => set({ ...EMPTY, past: [], future: [], markup: [], simResult: null, dirty: true }),

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

  addArchNode: (type, position) => {
    const spec = NODE_SPEC[type];
    const id = uid('n');
    const node: Node<ArchNodeData, 'arch'> = {
      id,
      type: 'arch',
      position,
      ...(type === 'group' ? { style: { width: 300, height: 220 }, zIndex: -1 } : {}),
      data: {
        archType: type,
        label: spec.label,
        annotation: '',
        attrs: { ...spec.defaults },
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

  addArchNodeAtCenter: (type) => {
    const { viewportCenter, nodes } = get();
    // Cascade slightly so repeated clicks do not stack into one pile.
    const offset = (nodes.length % 6) * 26;
    return get().addArchNode(type, {
      x: viewportCenter.x - 80 + offset,
      y: viewportCenter.y - 30 + offset,
    });
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

  deleteSelection: () =>
    set((s) => {
      const doomed = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
      const keptNodes = s.nodes.filter((n) => !n.selected);
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
    set((s) => ({
      markup: [],
      nodes: s.nodes.filter((n) => !(n.type === 'arch' && n.data.ghost)),
    })),

  addGhosts: (suggestions) =>
    set((s) => {
      const existing = s.nodes.filter((n) => n.type === 'arch') as Node<ArchNodeData, 'arch'>[];
      const anchorOf = (id?: string) => existing.find((n) => n.id === id);
      const newNodes: AnyNode[] = [];
      const newEdges: Edge[] = [];
      suggestions.forEach((sg, i) => {
        const anchor = anchorOf(sg.connect_from) ?? anchorOf(sg.connect_to) ?? existing[i % Math.max(1, existing.length)];
        const base = anchor?.position ?? { x: 120, y: 120 };
        const id = uid('g');
        newNodes.push({
          id,
          type: 'arch',
          position: { x: base.x + 220, y: base.y + 90 + i * 40 },
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
      dirty: true,
    })),

  rejectGhost: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    })),

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
