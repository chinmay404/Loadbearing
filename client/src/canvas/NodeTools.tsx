import { useEffect, useState } from 'react';
import type { NodeAttrs } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';
import { NODE_SPEC } from './nodeCatalog';

/**
 * The selected component, editable in place: name, reasoning, and the numbers the
 * simulator reads. The Inspect tab still shows the full arithmetic, but the edits
 * you make constantly — renaming a box, writing why it is there, changing a
 * replica count — should not require crossing the workspace to a different panel.
 *
 * Stacking sits here too, and matters more than on a general-purpose canvas:
 * boundaries are large rectangles drawn behind their contents, so once one is
 * nested in another the stacking order decides which one catches a click.
 */
export function NodeTools() {
  const nodes = useCanvas((s) => s.nodes);
  const restack = useCanvas((s) => s.restack);
  const setLocked = useCanvas((s) => s.setLocked);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const updateNodeAttrs = useCanvas((s) => s.updateNodeAttrs);

  const chosen = nodes.filter((n) => n.selected);
  const single = chosen.length === 1 && chosen[0]!.type === 'arch' ? chosen[0]! : null;
  const archData = single && single.type === 'arch' ? single.data : null;

  const [label, setLabel] = useState('');
  const [annotation, setAnnotation] = useState('');
  useEffect(() => {
    setLabel(archData?.label ?? '');
    setAnnotation(archData?.annotation ?? '');
  }, [single?.id]);

  if (chosen.length === 0) return null;

  const allLocked = chosen.every((n) => n.draggable === false);
  const spec = archData ? NODE_SPEC[archData.archType] : null;
  const fields = spec?.attrFields ?? [];

  return (
    <div
      className="card"
      style={{
        position: 'absolute',
        left: 12,
        bottom: single ? 12 : 132,
        zIndex: 13,
        padding: '7px 9px',
        width: 340,
        display: 'grid',
        gap: 6,
        maxHeight: '58vh',
        overflowY: 'auto',
      }}
    >
      {single && archData ? (
        <>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="stencil grow">{archData.archType.replace(/_/g, ' ')}</span>
            {allLocked && <span className="chip">pinned</span>}
          </div>

          <div>
            <label style={{ fontSize: 9.5 }}>Name</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => updateNodeData(single.id, { label: label.trim() || 'Untitled' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 9.5 }}>Why it is here — the mechanism that matters</label>
            <textarea
              rows={3}
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              onBlur={() => updateNodeData(single.id, { annotation })}
              placeholder={spec?.hint ?? 'What this does, and what breaks without it.'}
            />
          </div>

          {fields.length > 0 && (
            <div className="row wrap" style={{ gap: 4 }}>
              {fields.map((field) => (
                <AttrField
                  key={field}
                  field={field}
                  value={archData.attrs[field]}
                  onChange={(v) => updateNodeAttrs(single.id, { [field]: v } as NodeAttrs)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12 }}>
          <strong>{chosen.length} selected</strong>
          {allLocked && (
            <span className="chip" style={{ marginLeft: 5 }}>
              pinned
            </span>
          )}
        </div>
      )}

      <div className="row wrap" style={{ gap: 3 }}>
        <span className="stencil">order</span>
        <button title="Bring to front (Ctrl+Shift+])" onClick={() => restack('front')}>
          front
        </button>
        <button title="Bring forward (Ctrl+])" onClick={() => restack('forward')}>
          forward
        </button>
        <button title="Send backward (Ctrl+[)" onClick={() => restack('backward')}>
          backward
        </button>
        <button title="Send to back (Ctrl+Shift+[)" onClick={() => restack('back')}>
          back
        </button>
        <span className="grow" />
        <button
          className={allLocked ? 'on' : ''}
          title="Pinned components cannot be dragged or deleted (L)"
          onClick={() => setLocked(!allLocked)}
        >
          {allLocked ? 'Unpin' : 'Pin'}
        </button>
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  capacityRps: 'rps / instance',
  replicas: 'instances',
  latencyMs: 'latency ms',
  cacheHitRate: 'hit rate',
  queueDepthMax: 'max depth',
  multiAz: 'multi-AZ',
  monthlyCost: '$ / month',
};

function AttrField({
  field,
  value,
  onChange,
}: {
  field: keyof NodeAttrs;
  value: number | boolean | undefined;
  onChange: (v: number | boolean) => void;
}) {
  if (field === 'multiAz') {
    return (
      <button className={value ? 'on' : ''} onClick={() => onChange(!value)} title="Spread across zones">
        {LABELS[field]}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-grid', gap: 1 }}>
      <label style={{ fontSize: 9 }}>{LABELS[field] ?? field}</label>
      <input
        type="number"
        value={value === undefined ? '' : Number(value)}
        min={0}
        step={field === 'cacheHitRate' ? 0.05 : 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 78, padding: '2px 4px', fontSize: 11 }}
      />
    </span>
  );
}
