import { useEffect, useState } from 'react';
import {
  GROUP_LABEL,
  GROUP_ORDER,
  defaultFor,
  paramsFor,
  placeholderFor,
  type ArchNodeType,
  type NodeAttrs,
  type ParamGroup,
  type ParamSpec,
} from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { MACHINE_PRESET, NODE_SPEC } from './nodeCatalog';
import { NODE_ICONS } from './icons';
import { gaugeModel, statusNote } from './gauge';

/**
 * The selected component, editable in place: name, reasoning, and the numbers the
 * simulator reads. The Inspect tab still shows the full arithmetic, but the edits
 * you make constantly — renaming a box, writing why it is there, changing a
 * replica count — should not require crossing the workspace to a different panel.
 *
 * It reads top to bottom as: what this is, how it is doing, why you put it here,
 * and the few numbers that size it. Everything else is folded under More settings,
 * and every setting is named in words with its unit and the real default shown —
 * a grid of "In flight / Their limit / $ / M calls" boxes told nobody anything.
 */
export function NodeTools({ docked = false }: { docked?: boolean }) {
  const nodes = useCanvas((s) => s.nodes);
  const restack = useCanvas((s) => s.restack);
  const setLocked = useCanvas((s) => s.setLocked);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const updateNodeAttrs = useCanvas((s) => s.updateNodeAttrs);
  const deselectAll = useCanvas((s) => s.deselectAll);
  const simResult = useCanvas((s) => s.simResult);
  const killedIds = useCanvas((s) => s.simConfig.killNodeIds);

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
  const isMachine = !!archData?.attrs.sharedHost;
  // Same schema as the inspector, so a component offers the same knobs in both places.
  const fields = archData ? paramsFor(archData.archType) : [];
  const main = fields.filter((f) => MAIN_GROUPS.includes(f.group));
  const more = fields.filter((f) => !MAIN_GROUPS.includes(f.group));
  const moreSet = archData ? more.filter((f) => archData.attrs[f.key] !== undefined).length : 0;
  const Icon = archData ? NODE_ICONS[isMachine ? 'vm' : archData.archType] : null;

  const sim = single ? simResult?.nodes.find((n) => n.nodeId === single.id) : undefined;
  const model =
    archData && single && sim
      ? gaugeModel({ type: archData.archType, attrs: archData.attrs, sim, killed: killedIds.includes(single.id), outDegree: 0 })
      : null;
  const status = model && archData ? statusNote(model, sim, archData.attrs) : null;
  const setAttr = (key: ParamSpec['key'], v: number | boolean | undefined) =>
    single && updateNodeAttrs(single.id, { [key]: v } as NodeAttrs);

  return (
    <div className={`part-sheet${docked ? ' docked' : ''}`}>
      {single && archData ? (
        <>
          <div className="ps-head">
            <span className="ps-tile">{Icon && <Icon size={17} />}</span>
            <div className="ps-title">
              <input
                className="ps-name"
                aria-label="Name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => updateNodeData(single.id, { label: label.trim() || 'Untitled' })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <span className="ps-kind">
                {/* The same short type the part shows on the canvas, not its default name again. */}
                {isMachine ? 'machine' : archData.archType.replace(/_/g, ' ')}
                {allLocked && ' · pinned'}
              </span>
            </div>
            <button className="ps-close" onClick={deselectAll} aria-label={docked ? 'Back to components' : 'Close'} title={docked ? 'Back to components' : 'Close'}>
              ×
            </button>
          </div>

          {spec && <p className="ps-what">{firstSentence(isMachine ? MACHINE_PRESET.hint : spec.hint)}</p>}

          {status && model && (
            <div className="ps-status" data-health={model.health}>
              <b>{status.title}</b>
              <span>{status.body}</span>
              {status.limit && <em>{status.limit}</em>}
            </div>
          )}

          <label className="ps-label" htmlFor="ps-why">
            Why it is here
          </label>
          <textarea
            id="ps-why"
            className="ps-why"
            rows={2}
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            onBlur={() => updateNodeData(single.id, { annotation })}
            placeholder="What it does here, and what breaks without it."
          />

          {main.length > 0 && <FieldGroups specs={main} type={archData.archType} attrs={archData.attrs} onChange={setAttr} />}

          {more.length > 0 && (
            <details className="ps-more">
              <summary>
                More settings
                <span>{moreSet > 0 ? `${moreSet} changed` : more.length}</span>
              </summary>
              <FieldGroups specs={more} type={archData.archType} attrs={archData.attrs} onChange={setAttr} />
            </details>
          )}
        </>
      ) : (
        <div className="ps-head">
          <div className="ps-title">
            <strong>{chosen.length} selected</strong>
            {allLocked && <span className="ps-kind">pinned</span>}
          </div>
          <button className="ps-close" onClick={deselectAll} aria-label="Close" title="Close">
            ×
          </button>
        </div>
      )}

      <div className="ps-foot">
        <button
          className={allLocked ? 'on' : ''}
          title="Pinned components cannot be dragged or deleted (L)"
          onClick={() => setLocked(!allLocked)}
        >
          {allLocked ? 'Unpin' : 'Pin'}
        </button>
        <span className="ps-order" role="group" aria-label="Stacking order">
          <button title="Send to back (Ctrl+Shift+[)" aria-label="Send to back" onClick={() => restack('back')}>
            ⤓
          </button>
          <button title="Send backward (Ctrl+[)" aria-label="Send backward" onClick={() => restack('backward')}>
            ↓
          </button>
          <button title="Bring forward (Ctrl+])" aria-label="Bring forward" onClick={() => restack('forward')}>
            ↑
          </button>
          <button title="Bring to front (Ctrl+Shift+])" aria-label="Bring to front" onClick={() => restack('front')}>
            ⤒
          </button>
        </span>
        <span className="grow" />
        {single && archData && (
          <SaveAsObject name={label} baseType={archData.archType} note={annotation} attrs={archData.attrs} />
        )}
      </div>
    </div>
  );
}

/** Sizing first; how it behaves, failure and money are a click away. */
const MAIN_GROUPS: ParamGroup[] = ['traffic', 'size', 'scaling'];

function firstSentence(s: string): string {
  const i = s.search(/[.!?](\s|$)/);
  return i > 0 ? s.slice(0, i + 1) : s;
}

function FieldGroups({
  specs,
  type,
  attrs,
  onChange,
}: {
  specs: ParamSpec[];
  type: ArchNodeType;
  attrs: NodeAttrs;
  onChange: (key: ParamSpec['key'], v: number | boolean | undefined) => void;
}) {
  return (
    <>
      {GROUP_ORDER.filter((g) => specs.some((s) => s.group === g)).map((g) => (
        <section className="ps-group" key={g}>
          <h6>{GROUP_LABEL[g]}</h6>
          {specs
            .filter((s) => s.group === g)
            .map((s) => (
              <AttrField key={s.key} spec={s} type={type} attrs={attrs} onChange={(v) => onChange(s.key, v)} />
            ))}
        </section>
      ))}
    </>
  );
}

/**
 * One setting as a row: its plain name, the value (blank shows the real default the
 * engine will use), and its unit. What it means appears under it while you edit it,
 * not in a tooltip nobody finds.
 */
function AttrField({
  spec,
  type,
  attrs,
  onChange,
}: {
  spec: ParamSpec;
  type: ArchNodeType;
  attrs: NodeAttrs;
  onChange: (v: number | boolean | undefined) => void;
}) {
  const id = `ps-${spec.key}`;
  const value = attrs[spec.key];
  if (spec.kind === 'toggle') {
    return (
      <div className="ps-row">
        <label htmlFor={id}>{spec.label}</label>
        <button
          id={id}
          role="switch"
          aria-checked={!!value}
          className={`ps-switch${value ? ' on' : ''}`}
          onClick={() => onChange(!value)}
        >
          <i />
        </button>
        <p className="ps-hint">{spec.hint}</p>
      </div>
    );
  }
  // Fractions are edited as percentages: "hit rate 85%" is how people say it.
  const fraction = spec.kind === 'fraction';
  const fallback = defaultFor(type, spec.key, attrs);
  const placeholder =
    fraction && typeof fallback === 'number' ? String(Math.round(fallback * 100)) : placeholderFor(type, spec.key, attrs);
  const shown = typeof value === 'number' ? (fraction ? Math.round(value * 100) : value) : '';
  return (
    <div className="ps-row">
      <label htmlFor={id}>{spec.label}</label>
      <span className="ps-input">
        <input
          id={id}
          type="number"
          value={shown}
          min={fraction ? 0 : (spec.min ?? 0)}
          max={fraction ? 100 : spec.max}
          step={fraction ? 1 : (spec.step ?? 1)}
          placeholder={placeholder}
          onChange={(e) => {
            if (e.target.value === '') return onChange(undefined);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(fraction ? n / 100 : n);
          }}
        />
        {/* Always present, so every box lines up whether or not it has a unit. */}
        <span className="ps-unit">{fraction ? '%' : (spec.unit ?? '')}</span>
      </span>
      <p className="ps-hint">{spec.hint}</p>
    </div>
  );
}

/**
 * Turns the component you have just tuned into one of your own types, so the next
 * time you need a layout-aware chunker you pick it rather than rebuilding it.
 *
 * The base type travels with it, which is what keeps it a real component: the
 * simulator, the structural rules and the grader all still see a chunker.
 */
function SaveAsObject({
  name,
  baseType,
  note,
  attrs,
}: {
  name: string;
  baseType: ArchNodeType;
  note: string;
  attrs: NodeAttrs;
}) {
  const setNotice = useApp((s) => s.setNotice);
  const setError = useApp((s) => s.setError);
  const bumpObjects = useApp((s) => s.bumpCustomObjects);
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="ghost"
      disabled={busy || !name.trim()}
      title="Keep this as one of your own component types, available in the palette on every sheet"
      onClick={() => {
        setBusy(true);
        void api
          .saveCustomObject({ name: name.trim(), baseType, note, attrs })
          .then((o) => {
            bumpObjects();
            setNotice(`"${o.name}" saved as one of your objects — it is in the palette now.`);
          })
          .catch((e) => setError({ message: (e as ApiError).message, hint: (e as ApiError).hint }))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? <span className="spinner" /> : null} Save as my type
    </button>
  );
}
