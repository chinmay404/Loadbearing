import { useCallback, useEffect, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type FinalConnectionState,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { checkConnection } from '@loadbearing/shared';
import type { ArchNodeType } from '@loadbearing/shared';
import { ArchNode } from './ArchNode';
import { StickyNode } from './StickyNode';
import { ArchEdge } from './ArchEdge';
import { PenLayer } from './PenLayer';
import { FlowParticles } from './FlowParticles';
import { CanvasToolbar } from './CanvasToolbar';
import { SimHud } from './SimHud';
import { TitleBlock } from './TitleBlock';
import { QuickAdd } from './QuickAdd';
import { AiBar } from './AiBar';
import { EdgeTools } from './EdgeTools';
import { NodeTools } from './NodeTools';
import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

const nodeTypes: NodeTypes = { arch: ArchNode, sticky: StickyNode };
const edgeTypes: EdgeTypes = { arch: ArchEdge };

/**
 * Which drawn connection passes under a point, in flow coordinates.
 *
 * Asked of the DOM rather than recomputed: the edges are smooth-step paths with
 * corners, so re-deriving their geometry here would drift from what the user can
 * see. React Flow renders every edge inside the viewport's transform, so the
 * SVG's own user space IS flow space, and the wide invisible interaction stroke
 * it draws for hit-testing gives the tolerance for free.
 */
function edgeUnderPoint(p: { x: number; y: number }): string | null {
  if (typeof DOMPoint === 'undefined') return null;
  const point = new DOMPoint(p.x, p.y);
  const groups = document.querySelectorAll<SVGGElement>('.react-flow__edge');
  for (const g of groups) {
    const id = g.getAttribute('data-id');
    if (!id) continue;
    const path =
      g.querySelector<SVGPathElement>('path.react-flow__edge-interaction') ??
      g.querySelector<SVGPathElement>('path.react-flow__edge-path');
    if (!path) continue;
    try {
      if (path.isPointInStroke(point)) return id;
    } catch {
      // Older engines reject a DOMPoint here; skipping the check just means the
      // splice gesture is unavailable, not that dragging breaks.
      return null;
    }
  }
  return null;
}

function CanvasInner() {
  const wrap = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const setViewportCenter = useCanvas((s) => s.setViewportCenter);
  const edgeKind = useCanvas((s) => s.edgeKind);
  const toGraph = useCanvas((s) => s.toGraph);
  const setNotice = useApp((s) => s.setNotice);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const onNodesChange = useCanvas((s) => s.onNodesChange);
  const onEdgesChange = useCanvas((s) => s.onEdgesChange);
  const onConnect = useCanvas((s) => s.onConnect);
  const addArchNode = useCanvas((s) => s.addArchNode);
  const addSticky = useCanvas((s) => s.addSticky);
  const reconnect = useCanvas((s) => s.reconnectEdge);
  const detachEdge = useCanvas((s) => s.detachEdge);
  const spliceNodeIntoEdge = useCanvas((s) => s.spliceNodeIntoEdge);
  const setEdgeInsertTarget = useCanvas((s) => s.setEdgeInsertTarget);
  const restack = useCanvas((s) => s.restack);
  const toggleLock = useCanvas((s) => s.toggleLockOnSelection);
  const reparent = useCanvas((s) => s.reparentDroppedNodes);
  const deleteSelection = useCanvas((s) => s.deleteSelection);
  const undo = useCanvas((s) => s.undo);
  const redo = useCanvas((s) => s.redo);
  const tool = useCanvas((s) => s.tool);
  const setTool = useCanvas((s) => s.setTool);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '[')) {
        // Ctrl+] / Ctrl+[ step through the stack; add Shift to jump to either end.
        e.preventDefault();
        const forward = e.key === ']';
        restack(e.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'l') toggleLock();
      else if (e.key === 'v') setTool('select');
      else if (e.key === 'p') setTool('pen');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'n') setTool('sticky');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelection, setTool, restack, toggleLock]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/loadbearing-node') as ArchNodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = addArchNode(type, { x: position.x - 80, y: position.y - 30 });
      // Dropped inside a boundary means inside it, not merely on top of it.
      reparent([id]);
    },
    [addArchNode, reparent, screenToFlowPosition],
  );

  // Keep the store's idea of "the middle of the screen" fresh, so palette clicks
  // drop components into view rather than off in the distance.
  const syncCenter = useCallback(() => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const c = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    setViewportCenter(c);
  }, [screenToFlowPosition, setViewportCenter]);

  useEffect(() => {
    syncCenter();
  }, [syncCenter]);

  /**
   * Teach at the moment of the mistake. The connection is still made — being told
   * why it is wrong beats being blocked and left guessing — but the reason surfaces
   * immediately instead of waiting for the Checks tab.
   */
  const onConnectChecked = useCallback(
    (c: Connection) => {
      onConnect(c);
      const graph = toGraph();
      const from = graph.nodes.find((n) => n.id === c.source);
      const to = graph.nodes.find((n) => n.id === c.target);
      if (!from || !to) return;
      const worst = checkConnection(from, to, edgeKind).find((f) => f.severity === 'error');
      if (worst) setNotice(`${worst.message} — ${worst.fix}`);
    },
    [onConnect, toGraph, edgeKind, setNotice],
  );

  /**
   * Re-pointing a connection. The edge keeps its id, its kind and its label —
   * this is an edit to an existing connection, not a delete and a redraw — and
   * the same compatibility check runs as when it was first drawn.
   */
  const reconnected = useRef(false);
  const onReconnect = useCallback(
    (oldEdge: Edge, next: Connection) => {
      const ok = reconnect(oldEdge.id, next);
      reconnected.current = true;
      if (!ok) {
        setNotice('That connection already exists (or points a component at itself), so nothing moved.');
        return;
      }
      const graph = toGraph();
      const from = graph.nodes.find((n) => n.id === next.source);
      const to = graph.nodes.find((n) => n.id === next.target);
      if (!from || !to) return;
      const kind = (oldEdge.data as { kind?: typeof edgeKind } | undefined)?.kind ?? edgeKind;
      const worst = checkConnection(from, to, kind).find((f) => f.severity === 'error');
      if (worst) setNotice(`${worst.message} — ${worst.fix}`);
    },
    [reconnect, toGraph, edgeKind, setNotice],
  );

  /** Dragging an endpoint onto blank paper disconnects it — the obvious gesture. */
  const onReconnectStart = useCallback(() => {
    reconnected.current = false;
  }, []);

  const onReconnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, edge: Edge, _handle: unknown, state: FinalConnectionState) => {
      if (reconnected.current || state.isValid) return;
      detachEdge(edge.id);
      setNotice('Disconnected. Both components are still on the sheet — reconnect from either handle.');
    },
    [detachEdge, setNotice],
  );

  /**
   * Drop a component on top of a connection and it is spliced into it: A→B
   * becomes A→X→B, and any declared flow that walked A→B now walks through X.
   * This is the fast way to add a cache, a queue or a gateway to a path that
   * already exists, which is most of what editing an architecture consists of.
   */
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      // Wherever it landed, first decide which boundary it now belongs to. Moving
      // a boundary afterwards has to take its contents with it, and that only
      // happens if they are actually its children.
      const moved = nodes.filter((n) => n.selected).map((n) => n.id);
      const { attached, detached } = reparent(moved.length > 0 ? moved : [node.id]);
      if (attached > 0) {
        setNotice(
          `Now inside that boundary — moving the boundary moves ${attached === 1 ? 'it' : 'them'} too.`,
        );
      } else if (detached > 0) {
        setNotice('Taken out of the boundary.');
      }

      if (node.type !== 'arch') return;
      if ((node.data as { archType?: string } | undefined)?.archType === 'group') return;
      // Already wired into something? Then the drag was a move, not an insert.
      const touching = edges.some((e) => e.source === node.id || e.target === node.id);
      if (touching) return;

      const center = {
        x: node.position.x + (node.measured?.width ?? 168) / 2,
        y: node.position.y + (node.measured?.height ?? 64) / 2,
      };
      const edgeId = edgeUnderPoint(center);
      if (!edgeId) return;
      const target = edges.find((e) => e.id === edgeId);
      if (!target || target.source === node.id || target.target === node.id) return;
      if (spliceNodeIntoEdge(edgeId, node.id)) {
        setNotice('Spliced into that connection — the path now runs through this component.');
      }
    },
    [edges, nodes, reparent, spliceNodeIntoEdge, setNotice],
  );

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (tool !== 'sticky') return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addSticky({ x: position.x - 75, y: position.y - 35 });
      setTool('select');
    },
    [tool, screenToFlowPosition, addSticky, setTool],
  );

  return (
    <div className="canvas-wrap" ref={wrap} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectChecked}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={(_e, edge) => setEdgeInsertTarget(edge.id)}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onPaneClick={onPaneClick}
        onMoveEnd={syncCenter}
        onInit={syncCenter}
        panOnDrag={tool === 'select'}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: 'arch' }}
        connectionRadius={28}
        reconnectRadius={14}
        minZoom={0.2}
        maxZoom={2.2}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        {/* Blueprint ruling: a fine grid inside a coarse one, like drafting paper. */}
        <Background id="fine" variant={BackgroundVariant.Lines} gap={16} lineWidth={0.4} color="#1d1b18" />
        <Background id="coarse" variant={BackgroundVariant.Lines} gap={96} lineWidth={0.6} color="#272320" />
        <Controls showInteractive={false} position="top-right" />
        <MiniMap
          pannable
          zoomable
          style={{ background: '#1a1917', border: '1px solid #322e29', borderRadius: 2 }}
          maskColor="rgb(18 17 16 / 0.72)"
          nodeColor="#3a352f"
        />
      </ReactFlow>
      <FlowParticles />
      <PenLayer />
      <CanvasToolbar />
      <TitleBlock />
      <SimHud />
      <AiBar />
      <EdgeTools />
      <NodeTools />
      <QuickAdd />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
