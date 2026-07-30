import type { EdgeKind } from '@archdojo/shared';
import { useCanvas } from '../state/canvasStore';

const EDGE_LABEL: Record<EdgeKind, string> = {
  sync: 'Sync call',
  async: 'Async event',
  replication: 'Replication',
};

export function CanvasToolbar() {
  const tool = useCanvas((s) => s.tool);
  const setTool = useCanvas((s) => s.setTool);
  const edgeKind = useCanvas((s) => s.edgeKind);
  const setKindTool = useCanvas.setState;
  // Select the stable array and filter during render — returning a fresh array
  // from the selector re-renders forever.
  const selectedEdges = useCanvas((s) => s.edges).filter((e) => e.selected);
  const setEdgeKind = useCanvas((s) => s.setEdgeKind);
  const undo = useCanvas((s) => s.undo);
  const redo = useCanvas((s) => s.redo);
  const canUndo = useCanvas((s) => s.past.length > 0);
  const canRedo = useCanvas((s) => s.future.length > 0);

  const pickKind = (k: EdgeKind) => {
    setKindTool({ edgeKind: k });
    for (const e of selectedEdges) setEdgeKind(e.id, k);
  };

  return (
    <div className="toolbar">
      <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select / move (V)">
        ⬚
      </button>
      <button className={tool === 'sticky' ? 'on' : ''} onClick={() => setTool('sticky')} title="Sticky note (N)">
        ▤
      </button>
      <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="Pen (P)">
        ✎
      </button>
      <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} title="Erase ink (E)">
        ⌫
      </button>
      <span className="sep" />
      {(['sync', 'async', 'replication'] as EdgeKind[]).map((k) => (
        <button
          key={k}
          className={edgeKind === k ? 'on' : ''}
          onClick={() => pickKind(k)}
          title={`${EDGE_LABEL[k]} — new connections use this${selectedEdges.length ? '; also applies to selected edges' : ''}`}
        >
          {k === 'sync' ? '──' : k === 'async' ? '╌╌' : '══'}
        </button>
      ))}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        ↷
      </button>
    </div>
  );
}
