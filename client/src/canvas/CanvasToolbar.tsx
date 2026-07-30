import type { EdgeKind } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';
import {
  IconErase,
  IconNote,
  IconPen,
  IconRedo,
  IconSelect,
  IconUndo,
} from '../ui/UiIcons';

const EDGE: { kind: EdgeKind; glyph: string; name: string; why: string }[] = [
  { kind: 'sync', glyph: '───', name: 'Sync call', why: 'The caller waits. Latency and failure propagate straight back to the user.' },
  { kind: 'async', glyph: '╌╌╌', name: 'Async event', why: 'Fire and forget through a broker. Decoupled, at-least-once, eventually consistent.' },
  { kind: 'replication', glyph: '═══', name: 'Replication', why: 'A copy of data flowing between stores. Lag lives on this line.' },
];

export function CanvasToolbar() {
  const tool = useCanvas((s) => s.tool);
  const setTool = useCanvas((s) => s.setTool);
  const edgeKind = useCanvas((s) => s.edgeKind);
  const setKind = useCanvas.setState;
  // Filter outside the selector — a fresh array from a selector re-renders forever.
  const selectedEdges = useCanvas((s) => s.edges).filter((e) => e.selected);
  const setEdgeKind = useCanvas((s) => s.setEdgeKind);
  const undo = useCanvas((s) => s.undo);
  const redo = useCanvas((s) => s.redo);
  const canUndo = useCanvas((s) => s.past.length > 0);
  const canRedo = useCanvas((s) => s.future.length > 0);

  const pickKind = (k: EdgeKind) => {
    setKind({ edgeKind: k });
    for (const e of selectedEdges) setEdgeKind(e.id, k);
  };

  return (
    <div className="toolbar">
      <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select and move — V">
        <IconSelect size={15} />
      </button>
      <button className={tool === 'sticky' ? 'on' : ''} onClick={() => setTool('sticky')} title="Sticky note — N">
        <IconNote size={15} />
      </button>
      <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="Pen — P">
        <IconPen size={15} />
      </button>
      <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} title="Erase ink — E">
        <IconErase size={15} />
      </button>
      <span className="sep" />
      {EDGE.map((e) => (
        <button
          key={e.kind}
          className={edgeKind === e.kind ? 'on' : ''}
          onClick={() => pickKind(e.kind)}
          title={`${e.name} — ${e.why}${selectedEdges.length ? '\n\nAlso applies to the selected connection.' : ''}`}
        >
          <span className="edge-glyph">{e.glyph}</span>
        </button>
      ))}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Undo — Ctrl+Z">
        <IconUndo size={15} />
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo — Ctrl+Shift+Z">
        <IconRedo size={15} />
      </button>
    </div>
  );
}
