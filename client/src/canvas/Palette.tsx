import { useMemo, useState } from 'react';
import { CATEGORY_ORDER, NODE_CATALOG } from './nodeCatalog';
import { NODE_ICONS } from './icons';
import { useCanvas } from '../state/canvasStore';

export function Palette() {
  const [q, setQ] = useState('');
  const addAtCenter = useCanvas((s) => s.addArchNodeAtCenter);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return NODE_CATALOG;
    return NODE_CATALOG.filter(
      (s) =>
        s.label.toLowerCase().includes(needle) ||
        s.type.includes(needle) ||
        s.hint.toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <div>
      <input
        placeholder="Search components…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      {CATEGORY_ORDER.map((cat) => {
        const items = filtered.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div className="palette-group" key={cat}>
            <h5>{cat}</h5>
            <div className="palette-items">
              {items.map((spec) => {
                const Icon = NODE_ICONS[spec.type];
                return (
                  <div
                    key={spec.type}
                    className="palette-item"
                    title={`${spec.hint}\n\nClick to place, or drag onto the canvas.`}
                    role="button"
                    tabIndex={0}
                    onClick={() => addAtCenter(spec.type)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        addAtCenter(spec.type);
                      }
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/loadbearing-node', spec.type);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <span className="ico" style={{ color: spec.color }}>
                      <Icon size={15} />
                    </span>
                    <span>{spec.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="faint" style={{ fontSize: 11, marginTop: 12 }}>
        Click to place a component, or drag it where you want it. Double-click a node to rename,
        double-click its body to explain your reasoning — the grader reads annotations. Drag from a
        node's edge handle to another node to connect them.
      </p>
    </div>
  );
}
