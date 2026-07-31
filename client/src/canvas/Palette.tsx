import { useEffect, useMemo, useState } from 'react';
import type { CustomObject } from '@loadbearing/shared';
import { CATEGORY_ORDER, NODE_CATALOG, NODE_SPEC } from './nodeCatalog';
import { api } from '../lib/api';
import { useApp } from '../state/appStore';
import { NODE_ICONS } from './icons';
import { useCanvas } from '../state/canvasStore';
import { BlueprintPanel } from '../panels/BlueprintPanel';

/**
 * Everything you can add to the sheet: single components, or whole subsystems.
 * One tab rather than two, because "what can I put on this canvas" is one
 * question and the answer differs only in size.
 */
export function Palette() {
  const [mode, setMode] = useState<'parts' | 'subsystems'>('parts');
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
      <div className="filter-row">
        <button className={mode === 'parts' ? 'on' : ''} onClick={() => setMode('parts')}>
          Components
        </button>
        <button className={mode === 'subsystems' ? 'on' : ''} onClick={() => setMode('subsystems')}>
          Subsystems
        </button>
      </div>

      {mode === 'subsystems' && <BlueprintPanel />}
      {mode === 'parts' && (
      <>
      <MyObjects />
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
        node's edge handle to another node to connect them — boundaries have handles too, so one
        group can connect to another.
      </p>
      </>
      )}
    </div>
  );
}

/**
 * The user's own component types, at the top of the palette where their own
 * vocabulary belongs.
 *
 * The catalogue names categories, not every variant: there is one chunker, but a
 * fixed-size, a recursive, a layout-aware and a sentence-window chunker are
 * different decisions with different failure modes. Naming those is the job of the
 * person who knows which ones matter, so this is where they keep them.
 */
function MyObjects() {
  const version = useApp((s) => s.customObjectsVersion);
  const bump = useApp((s) => s.bumpCustomObjects);
  const setNotice = useApp((s) => s.setNotice);
  const addAtCenter = useCanvas((s) => s.addArchNodeAtCenter);
  const [objects, setObjects] = useState<CustomObject[] | null>(null);

  useEffect(() => {
    void api
      .customObjects()
      .then(setObjects)
      .catch(() => setObjects([]));
  }, [version]);

  if (!objects || objects.length === 0) {
    return (
      <p className="stencil" style={{ marginTop: 0, marginBottom: 10 }}>
        tip: tune a component, then <em>save as my own object</em> to keep it as your own type — a
        layout-aware chunker, your standard gateway
      </p>
    );
  }

  return (
    <div className="palette-group">
      <h5>Mine</h5>
      <div className="palette-items">
        {objects.map((o) => {
          const spec = NODE_SPEC[o.baseType];
          const Icon = NODE_ICONS[o.baseType];
          return (
            <div
              key={o.id}
              className="palette-item"
              title={`${o.note || spec.hint}\n\nBehaves as: ${spec.label}`}
              role="button"
              tabIndex={0}
              onClick={() => addAtCenter(o.baseType, { label: o.name, annotation: o.note, attrs: o.attrs })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  addAtCenter(o.baseType, { label: o.name, annotation: o.note, attrs: o.attrs });
                }
              }}
              draggable
              onDragStart={(e) => {
                // The drop handler only carries a type, so a dragged custom object
                // lands as its base type and is renamed on click instead.
                e.dataTransfer.setData('application/loadbearing-node', o.baseType);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className="ico" style={{ color: spec.color }}>
                <Icon size={15} />
              </span>
              <span>{o.name}</span>
              <span className="grow" />
              <button
                className="ghost"
                title="Forget this object"
                style={{ padding: '0 4px', fontSize: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  void api.deleteCustomObject(o.id).then(() => {
                    bump();
                    setNotice(`Forgot "${o.name}".`);
                  });
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
