import type { EdgeKind } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';
import { usePrefs } from '../ui/prefs';
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
  const skin = usePrefs((s) => s.nodeSkin);
  const setSkin = usePrefs((s) => s.setNodeSkin);

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
      <span className="sep" />
      {/* How the parts are drawn. Same gauges, same numbers — a matter of taste. */}
      <button
        className={skin === 'instruments' ? 'on' : ''}
        onClick={() => setSkin('instruments')}
        title="Instruments — every part as a clean gauge"
        aria-pressed={skin === 'instruments'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
          <path d="M8 15a4 4 0 0 1 8 0" />
          <path d="M12 15l2-2.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={skin === 'rack' ? 'on' : ''}
        onClick={() => setSkin('rack')}
        title="Rack — every part as a piece of hardware"
        aria-pressed={skin === 'rack'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <rect x="7" y="8.5" width="10" height="5" rx="1" />
          <circle cx="5.3" cy="7.2" r=".6" fill="currentColor" />
          <circle cx="18.7" cy="16.8" r=".6" fill="currentColor" />
          <path d="M8 16.5h3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
