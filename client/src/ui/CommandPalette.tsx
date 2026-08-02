import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_ORDER, NODE_SPEC } from '../canvas/nodeCatalog';
import { rank } from '../lib/fuzzy';
import { useApp, type LeftTab, type RightTab } from '../state/appStore';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';

/**
 * Everything you can do, one keystroke away.
 *
 * The palette holds 109 component types and a sheet can hold fifty of them, at which
 * point scrolling a categorised list to find "Vector Database" — or hunting the canvas
 * for the box called "Chunker" — is most of the work. Ctrl+K searches both, plus the
 * commands that otherwise live behind a tab you have to remember the name of.
 *
 * Three kinds of entry, deliberately in this order: components you can place, things
 * already on the sheet you can jump to, and actions. Placing is the most common thing,
 * and a palette that reorders itself by category would make it unpredictable.
 */

type Entry = {
  id: string;
  kind: 'add' | 'goto' | 'action';
  label: string;
  detail: string;
  /** Extra text the matcher can see but the eye does not, like a category name. */
  keywords?: string;
  run: () => void;
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nodes = useCanvas((s) => s.nodes);
  const addAtCenter = useCanvas((s) => s.addArchNodeAtCenter);
  const focusNode = useCanvas((s) => s.focusNode);
  const setSimRunning = useCanvas((s) => s.setSimRunning);
  const simRunning = useCanvas((s) => s.simRunning);
  const undo = useCanvas((s) => s.undo);
  const redo = useCanvas((s) => s.redo);
  const unlockAll = useCanvas((s) => s.unlockAll);
  const selectAll = useCanvas((s) => s.selectAll);

  const setLeftTab = useApp((s) => s.setLeftTab);
  const setRightTab = useApp((s) => s.setRightTab);
  const setView = useApp((s) => s.setView);
  const problem = useApp((s) => s.problem);
  const setNotice = useApp((s) => s.setNotice);

  const entries = useMemo<Entry[]>(() => {
    const placeable = Object.values(NODE_SPEC)
      .filter((spec) => spec.type !== 'group')
      .sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          a.label.localeCompare(b.label),
      )
      .map<Entry>((spec) => ({
        id: `add:${spec.type}`,
        kind: 'add',
        label: spec.label,
        detail: spec.category,
        // The hint is searchable so "stampede" finds the cache without anyone having
        // memorised what the component is called.
        keywords: `${spec.type.replace(/_/g, ' ')} ${spec.hint}`,
        run: () => addAtCenter(spec.type),
      }));

    const onSheet = nodes
      .filter((n) => n.type === 'arch' && !(n.data as ArchNodeData).ghost)
      .map<Entry>((n) => {
        const data = n.data as ArchNodeData;
        return {
          id: `goto:${n.id}`,
          kind: 'goto',
          label: data.label,
          detail: `on this sheet · ${data.archType.replace(/_/g, ' ')}`,
          keywords: data.annotation,
          run: () => {
            // The canvas pans to it — see the subscription in Canvas.tsx — and the
            // inspector is opened because selecting a component and then hunting for
            // its numbers is two steps where one will do.
            focusNode(n.id);
            setLeftTab('inspect');
          },
        };
      });

    const tab = (id: LeftTab, label: string): Entry => ({
      id: `tab:${id}`,
      kind: 'action',
      label: `Open ${label}`,
      detail: 'panel',
      run: () => setLeftTab(id),
    });
    const rightTab = (id: RightTab, label: string): Entry => ({
      id: `rtab:${id}`,
      kind: 'action',
      label: `Open ${label}`,
      detail: 'panel',
      run: () => setRightTab(id),
    });

    const actions: Entry[] = [
      {
        id: 'act:run',
        kind: 'action',
        label: simRunning ? 'Stop the load simulation' : 'Run load',
        detail: 'simulation',
        keywords: 'traffic simulate test',
        run: () => setSimRunning(!simRunning),
      },
      tab('palette', 'components'),
      tab('flows', 'flows'),
      tab('inspect', 'inspector'),
      tab('checks', 'checks'),
      tab('notes', 'notes'),
      tab('brief', 'the brief'),
      rightTab('feedback', 'the review'),
      rightTab('ask', 'the coach'),
      rightTab('history', 'history'),
      { id: 'act:undo', kind: 'action', label: 'Undo', detail: 'Ctrl+Z', run: undo },
      { id: 'act:redo', kind: 'action', label: 'Redo', detail: 'Ctrl+Y', run: redo },
      {
        id: 'act:selectall',
        kind: 'action',
        label: 'Select everything',
        detail: 'Ctrl+A',
        run: selectAll,
      },
      {
        id: 'act:unpin',
        kind: 'action',
        label: 'Unpin everything',
        detail: 'releases pinned components',
        run: () => {
          const freed = unlockAll();
          setNotice(freed > 0 ? `${freed} component${freed === 1 ? '' : 's'} unpinned.` : 'Nothing was pinned.');
        },
      },
      {
        id: 'act:problems',
        kind: 'action',
        label: 'Back to the problem index',
        detail: 'navigate',
        run: () => setView('problems'),
      },
      {
        id: 'act:projects',
        kind: 'action',
        label: 'Go to projects',
        detail: 'navigate',
        run: () => setView('projects'),
      },
      {
        id: 'act:reference',
        kind: 'action',
        label: 'Open the design reference',
        detail: 'navigate',
        run: () => setView('reference'),
      },
    ];

    return [...placeable, ...onSheet, ...actions];
  }, [
    nodes,
    addAtCenter,
    focusNode,
    simRunning,
    setSimRunning,
    setLeftTab,
    setRightTab,
    setView,
    undo,
    redo,
    selectAll,
    unlockAll,
    setNotice,
  ]);

  const results = useMemo(() => {
    const ranked = rank(query, entries, (e) => `${e.label} ${e.keywords ?? ''}`);
    // An empty query is a menu, not a search: show what is on the sheet and the actions
    // first, because placing a component is what the alphabetical list already does.
    if (query.trim() === '') {
      const byUsefulness = [...entries].sort((a, b) => order(a.kind) - order(b.kind));
      return byUsefulness.slice(0, 40).map((item) => ({ item, score: 0, hits: [] as number[] }));
    }
    return ranked.slice(0, 40);
  }, [query, entries]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // The frame delay lets the overlay mount before focus moves into it, without which
    // the first keystroke is swallowed.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlighted row on screen when arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, results]);

  if (!open) return null;

  const choose = (index: number) => {
    const chosen = results[index]?.item;
    if (!chosen) return;
    chosen.run();
    onClose();
  };

  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder={`Search ${entries.length} components, this sheet, and every command…`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(results.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(cursor);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />

        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <p className="faint palette-empty">Nothing matches that.</p>}
          {results.map((r, i) => (
            <button
              key={r.item.id}
              data-active={i === cursor}
              className={`palette-row ${i === cursor ? 'active' : ''}`}
              // Pointer down rather than click: the backdrop closes on pointer down, and
              // a click would arrive after the palette had already gone.
              onPointerDown={(e) => {
                e.stopPropagation();
                choose(i);
              }}
              onPointerEnter={() => setCursor(i)}
            >
              <span className={`palette-kind ${r.item.kind}`}>{VERB[r.item.kind]}</span>
              <span className="palette-label">{r.item.label}</span>
              <span className="palette-detail">{r.item.detail}</span>
            </button>
          ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ move</span>
          <span>↵ choose</span>
          <span>esc close</span>
          {problem && <span className="grow" style={{ textAlign: 'right' }}>{problem.title}</span>}
        </div>
      </div>
    </div>
  );
}

const VERB: Record<Entry['kind'], string> = { add: 'add', goto: 'go to', action: 'do' };

/** With no query typed, what is already on the sheet is likelier than the catalogue. */
const order = (kind: Entry['kind']): number => (kind === 'goto' ? 0 : kind === 'action' ? 1 : 2);
