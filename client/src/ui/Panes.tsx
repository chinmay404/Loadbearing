import type { ReactNode } from 'react';
import { usePanels } from './usePanels';

/**
 * The three-column workspace, with side panels you can collapse and drag.
 *
 * They were fixed at 316px and 372px. On a sheet with fifty components that is most of
 * the room the drawing needed, and there was no way to get it back — which is what
 * makes a large design feel like a mess rather than a design.
 *
 * Collapsed, a panel leaves a spine you click to bring it back, so nothing is ever
 * hidden without a way out. Both panels live here rather than in each workspace, so the
 * problem sheet and a project view cannot drift apart.
 */
export function Panes({
  left,
  right,
  children,
  leftLabel = 'panel',
  rightLabel = 'panel',
}: {
  left: ReactNode;
  right: ReactNode;
  children: ReactNode;
  /** Shown on the spine when collapsed, so you know what you are reopening. */
  leftLabel?: string;
  rightLabel?: string;
}) {
  const { leftOpen, rightOpen, columns, toggle, startResize } = usePanels();

  return (
    <div className="workspace" style={{ gridTemplateColumns: columns }}>
      {leftOpen ? (
        <aside className="pane">
          {left}
          <div
            className="pane-resize left"
            onPointerDown={(e) => startResize('left', e)}
            onDoubleClick={() => toggle('left')}
            title="Drag to resize · double-click to collapse"
          />
          <button className="pane-collapse left" onClick={() => toggle('left')} title="Collapse this panel">
            ‹
          </button>
        </aside>
      ) : (
        <aside className="pane spine">
          <button onClick={() => toggle('left')} title={`Show the ${leftLabel}`}>
            <span>{leftLabel}</span>
          </button>
        </aside>
      )}

      <div className="canvas-wrap">{children}</div>

      {rightOpen ? (
        <aside className="pane right">
          {right}
          <div
            className="pane-resize right"
            onPointerDown={(e) => startResize('right', e)}
            onDoubleClick={() => toggle('right')}
            title="Drag to resize · double-click to collapse"
          />
          <button className="pane-collapse right" onClick={() => toggle('right')} title="Collapse this panel">
            ›
          </button>
        </aside>
      ) : (
        <aside className="pane right spine">
          <button onClick={() => toggle('right')} title={`Show the ${rightLabel}`}>
            <span>{rightLabel}</span>
          </button>
        </aside>
      )}
    </div>
  );
}
