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
  type EdgeTypes,
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
import { useCanvas } from '../state/canvasStore';
import { useApp } from '../state/appStore';

const nodeTypes: NodeTypes = { arch: ArchNode, sticky: StickyNode };
const edgeTypes: EdgeTypes = { arch: ArchEdge };

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
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'v') setTool('select');
      else if (e.key === 'p') setTool('pen');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'n') setTool('sticky');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelection, setTool]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/loadbearing-node') as ArchNodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addArchNode(type, { x: position.x - 80, y: position.y - 30 });
    },
    [addArchNode, screenToFlowPosition],
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
