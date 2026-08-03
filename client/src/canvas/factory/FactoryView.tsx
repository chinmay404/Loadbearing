import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasMarkup, SimNodeResult } from '@loadbearing/shared';
import { useCanvas, type ArchNodeData } from '../../state/canvasStore';
import { NODE_SPEC } from '../nodeCatalog';
import {
  BELT_W,
  BELT_Z,
  STATION_D,
  STATION_W,
  UNIT,
  azimuthFor,
  bandColor,
  bandFor,
  beltSeconds,
  boundsOf,
  fitScale,
  flatnessFor,
  heightFor,
  pileFor,
  platesFor,
  shade,
  FACE_FRONT,
  FACE_SIDE,
  FACE_TOP,
} from './projection';
import './factory.css';

const INK3 = '#23211e';
const MONO = "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', ui-monospace, monospace";

/**
 * The plant.
 *
 * This is a second *renderer* over the same graph, never a second data model —
 * the nodes, the edges and the simulator's numbers are the ones the flat canvas
 * is already showing, read straight out of the store. That is what keeps the two
 * views from drifting apart, and it is why the tilt control is a continuum
 * rather than a switch between two screens: at tilt 0 this is a floor plan, at
 * 30 it is an isometric factory, and nothing underneath has changed.
 *
 * Built out of CSS 3D transforms rather than a WebGL scene. Three divs make a
 * box, the whole floor is one `rotateX/rotateZ`, and labels counter-rotate to
 * face the viewer. No renderer to keep alive, no shader to debug, and it
 * inherits the app's own colours for free.
 */
export function FactoryView() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const sim = useCanvas((s) => s.simResult);
  const killed = useCanvas((s) => s.simConfig.killNodeIds);
  const tilt = useCanvas((s) => s.viewTilt);
  const focus = useCanvas((s) => s.focusNodeId);
  const markup = useCanvas((s) => s.markup);
  // `focusNode` selects as well as focuses, so a click on a station opens the same
  // Inspector — with the same annotation field, the same knobs and the same shown
  // arithmetic — that clicking the flat node opens. Tilting the floor must never
  // cost an advanced user access to a component's detail.
  const focusNode = useCanvas((s) => s.focusNode);

  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setView({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const plant = useMemo(
    () => buildPlant(nodes, edges, sim?.nodes ?? [], killed, markup),
    [nodes, edges, sim, killed, markup],
  );

  const elevation = tilt * 2;
  const azimuth = azimuthFor(tilt);
  const flatness = flatnessFor(tilt);
  const scale = fitScale(plant.bounds, view);

  const originX = (plant.bounds.minX + plant.bounds.maxX) / 2;
  const originY = (plant.bounds.minY + plant.bounds.maxY) / 2;

  if (plant.stations.length === 0) {
    return (
      <div className="fx-wrap" ref={wrap}>
        <div className="fx-empty">
          <div className="fx-empty-title">Nothing on the floor yet.</div>
          <div className="fx-empty-sub">
            Drop a component on the canvas and it becomes a station here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-wrap" ref={wrap}>
      <div
        className="fx-scene"
        style={{
          left: view.w / 2,
          top: view.h / 2,
          transform: `scale3d(${scale},${scale},${scale}) rotateX(${elevation}deg) rotateZ(${azimuth}deg)`,
        }}
      >
        <div
          className="fx-floor"
          style={{
            left: plant.bounds.minX - originX,
            top: plant.bounds.minY - originY,
            width: plant.bounds.maxX - plant.bounds.minX,
            height: plant.bounds.maxY - plant.bounds.minY,
          }}
        />

        {/* The perimeter. A fence with a gate where something authenticates, and a
            visible hole where nothing does — so the opening is legible before any
            finding names it. */}
        <Fence bounds={plant.bounds} originX={originX} originY={originY} guarded={plant.guarded} />

        {/* Bays first: a boundary is painted on the concrete, so everything else
            stands on top of it. */}
        {plant.bays.map((bay) => (
          <div
            key={bay.id}
            className="fx-bay"
            style={{
              left: bay.x - originX,
              top: bay.y - originY,
              width: bay.w,
              height: bay.h,
            }}
          >
            <span className="fx-bay-label">{bay.label}</span>
          </div>
        ))}

        {plant.belts.map((b) => (
          <Belt key={b.id} belt={b} originX={originX} originY={originY} />
        ))}

        {plant.stations.map((st) => (
          <Station
            key={st.id}
            st={st}
            originX={originX}
            originY={originY}
            flatness={flatness}
            focused={focus === st.id}
            onSelect={() => focusNode(st.id)}
          />
        ))}

        {plant.stations.map((st) =>
          st.pile === 0 ? null : <Pile key={`pile-${st.id}`} st={st} originX={originX} originY={originY} />,
        )}

        {/* Labels last, and counter-rotated: text is never part of the 3D scene,
            so a dense plant stays readable at any tilt. */}
        {plant.stations.map((st) => (
          <Billboard
            key={`bb-${st.id}`}
            st={st}
            originX={originX}
            originY={originY}
            azimuth={azimuth}
            elevation={elevation}
            flatness={flatness}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces ---

interface StationView {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  util: number;
  height: number;
  band: ReturnType<typeof bandFor>;
  meta: string;
  dead: boolean;
  pile: number;
  replicas: number;
  /**
   * The mechanism the user wrote on the box — "cache-aside, TTL 60s, coalesce on
   * miss". The grader reads annotations and an unannotated box earns nothing, so
   * this is the most load-bearing text on the canvas. It travels into the plant
   * rather than being left behind in the flat view.
   */
  annotation: string;
  ghost: boolean;
  locked: boolean;
  /** Grader markers pinned to this component. */
  marks: number;
}

interface BayView {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BeltView {
  id: string;
  x: number;
  y: number;
  len: number;
  angle: number;
  color: string;
  plates: number;
  seconds: number;
  jam: boolean;
  drops: number;
  dim: boolean;
  kind: string;
}

function Station({
  st,
  originX,
  originY,
  flatness,
  focused,
  onSelect,
}: {
  st: StationView;
  originX: number;
  originY: number;
  flatness: number;
  focused: boolean;
  onSelect: () => void;
}) {
  const band = bandColor(st.util);
  const brighten = st.band === 'strained' || st.band === 'saturated' || st.band === 'shedding';
  const jitter = st.band === 'saturated' || st.band === 'shedding';
  const pct = `${Math.min(100, st.util * 100)}%`;

  return (
    <div
      className={`fx-station${jitter && !st.dead ? ' fx-jitter' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${st.label}, ${Math.round(st.util * 100)}% utilised, ${st.replicas} replica${st.replicas === 1 ? '' : 's'}${st.dead ? ', offline' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        left: st.x - originX,
        top: st.y - originY,
        width: STATION_W,
        height: STATION_D,
        opacity: st.dead ? 0.32 : 1,
      }}
    >
      {/* front face — the one carrying the readable band */}
      <div
        className="fx-face"
        style={{
          width: STATION_W,
          height: st.height,
          background: shade(INK3, FACE_FRONT),
          transform: `translateY(${STATION_D}px) rotateX(90deg)`,
        }}
      >
        <div
          className="fx-band"
          style={{ height: pct, background: band, opacity: st.dead ? 0.25 : 0.82 }}
        />
      </div>

      {/* side face */}
      <div
        className="fx-face"
        style={{
          width: st.height,
          height: STATION_D,
          background: shade(INK3, FACE_SIDE),
          transform: `translateX(${STATION_W}px) rotateY(-90deg)`,
        }}
      >
        <div
          className="fx-band fx-band-x"
          style={{ width: pct, background: band, opacity: st.dead ? 0.25 : 0.58 }}
        />
      </div>

      {/* top */}
      <div
        className="fx-top"
        style={{
          width: STATION_W,
          height: STATION_D,
          background: shade(INK3, FACE_TOP),
          borderColor: focused ? '#cfa349' : brighten ? '#423d36' : '#322e29',
          transform: `translateZ(${st.height}px)`,
        }}
      >
        <div className="fx-stripe" style={{ background: st.dead ? '#4a463f' : st.color }} />
        {/* At tilt 0 the extruded faces are edge-on and invisible, so the flat bar
            carries the same number. It fades out as the plant stands up. */}
        <div className="fx-flatbar" style={{ opacity: flatness }}>
          <div style={{ width: pct, height: '100%', background: band }} />
        </div>
        <div className="fx-toplabel" style={{ opacity: flatness }}>
          {st.label}
        </div>
      </div>
    </div>
  );
}

function Belt({ belt, originX, originY }: { belt: BeltView; originX: number; originY: number }) {
  const plates = [];
  for (let i = 0; i < belt.plates; i += 1) {
    plates.push(
      <span
        key={i}
        className="fx-plate"
        style={{
          background: belt.color,
          animationName: belt.jam ? 'fx-ride-jam' : 'fx-ride',
          animationDuration: `${belt.seconds}s`,
          animationDelay: `-${(i * belt.seconds) / belt.plates}s`,
          ['--fx-len' as string]: `${Math.max(0, belt.len - 12)}px`,
        }}
      />,
    );
  }
  const drops = [];
  for (let i = 0; i < belt.drops; i += 1) {
    drops.push(
      <span
        key={`d${i}`}
        className="fx-drop"
        style={{
          animationDuration: `${belt.seconds * 1.7}s`,
          animationDelay: `-${(i * belt.seconds * 1.7) / belt.drops}s`,
          ['--fx-len' as string]: `${Math.max(0, belt.len - 12)}px`,
        }}
      />,
    );
  }

  return (
    <div
      className={`fx-belt${belt.kind === 'async' ? ' fx-belt-async' : ''}${belt.kind === 'replication' ? ' fx-belt-repl' : ''}`}
      style={{
        left: belt.x - originX,
        top: belt.y - originY - BELT_W / 2,
        width: belt.len,
        height: BELT_W,
        opacity: belt.dim ? 0.16 : 1,
        transform: `translateZ(${belt.kind === 'replication' ? -3 : BELT_Z}px) rotate(${belt.angle}deg)`,
      }}
    >
      {plates}
      {drops}
    </div>
  );
}

/**
 * Queue depth as a physical pile beside the station.
 *
 * This is the single thing the factory framing buys outright: a queue stops
 * being a number and becomes unfinished work with nowhere to go. Add a replica,
 * watch the pile shrink, and backpressure has been taught without the word.
 */
function Pile({ st, originX, originY }: { st: StationView; originX: number; originY: number }) {
  const units = [];
  const cols = Math.min(6, Math.ceil(Math.sqrt(st.pile)));
  for (let i = 0; i < st.pile; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const h = 7 + ((r + c) % 3) * 2;
    units.push(
      <div
        key={i}
        className="fx-wip"
        style={{ left: c * 12, top: r * 12 }}
      >
        <div
          className="fx-wip-top"
          style={{ background: shade(st.color, 0.62), transform: `translateZ(${h}px)` }}
        />
        <div
          className="fx-wip-face"
          style={{ background: shade(st.color, 0.4), height: h }}
        />
      </div>
    );
  }
  return (
    <div
      className="fx-pile"
      style={{ left: st.x - originX + STATION_W + 14, top: st.y - originY + 8 }}
    >
      {units}
    </div>
  );
}

function Billboard({
  st,
  originX,
  originY,
  azimuth,
  elevation,
  flatness,
}: {
  st: StationView;
  originX: number;
  originY: number;
  azimuth: number;
  elevation: number;
  flatness: number;
}) {
  const shedding = st.band === 'shedding';
  return (
    <div
      className="fx-bb"
      style={{
        left: st.x - originX + STATION_W / 2,
        top: st.y - originY + STATION_D / 2,
        // Cross-faded against the in-box label, which carries the same name when the
        // plant is lying flat. Exactly one of the two is ever visible: floating a
        // label above a box that already has one written on it collides at tilt 0.
        opacity: 1 - flatness,
        transform: `translate3d(0,0,${st.height + 20}px) rotateZ(${-azimuth}deg) rotateX(${-elevation}deg)`,
      }}
    >
      <div className="fx-bb-inner">
        <div className="fx-bb-name" style={{ color: st.dead ? '#726c63' : '#ede9e1' }}>
          {st.label}
          {st.ghost ? <span className="fx-badge fx-badge-ghost">suggested</span> : null}
          {st.locked ? (
            <span className="fx-badge" title="pinned — release from the flat view">
              pinned
            </span>
          ) : null}
          {st.marks > 0 ? (
            <span className="fx-badge fx-badge-mark" title={`${st.marks} grader marker(s)`}>
              {st.marks}
            </span>
          ) : null}
        </div>
        <div
          className="fx-bb-meta"
          style={{ fontFamily: MONO, color: shedding ? '#d9534b' : st.dead ? '#726c63' : '#a09a90' }}
        >
          {st.dead ? 'offline' : st.meta}
          {shedding ? '  SHEDDING' : ''}
        </div>
        {/* The annotation is what the grader actually reads, so a box with no
            mechanism on it has to look unfinished here too — not merely quiet. */}
        {st.annotation ? (
          <div className="fx-bb-note">{truncate(st.annotation, 64)}</div>
        ) : (
          <div className="fx-bb-note fx-bb-note-empty">no mechanism noted</div>
        )}
      </div>
    </div>
  );
}

function Fence({
  bounds,
  originX,
  originY,
  guarded,
}: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  originX: number;
  originY: number;
  guarded: boolean;
}) {
  const l = bounds.minX - originX;
  const t = bounds.minY - originY;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const walls = [
    { key: 'n', left: l, top: t, width: w, transform: 'rotateX(90deg)' },
    { key: 's', left: l, top: t + h, width: w, transform: 'rotateX(90deg)' },
    { key: 'w', left: l, top: t, width: h, transform: 'rotateY(-90deg) rotateZ(90deg)', vertical: true },
    { key: 'e', left: l + w, top: t, width: h, transform: 'rotateY(-90deg) rotateZ(90deg)', vertical: true },
  ];
  return (
    <>
      {walls.map((wall) => (
        <div
          key={wall.key}
          className={`fx-fence${guarded ? ' fx-fence-gate' : ' fx-fence-open'}`}
          style={{
            left: wall.left,
            top: wall.top,
            width: wall.width,
            transform: wall.transform,
            transformOrigin: '0 0',
          }}
        />
      ))}
    </>
  );
}

// ------------------------------------------------------------------ model ----

/**
 * Turn the drawing plus the simulator's numbers into a plant.
 *
 * Station positions come from the node's own place on the canvas rather than
 * from a fresh layout: the point of the tilt control is that you are looking at
 * the same drawing from a different angle, and re-laying it out would break that
 * promise the moment somebody tilted back to flat.
 */
function buildPlant(
  nodes: ReturnType<typeof useCanvas.getState>['nodes'],
  edges: ReturnType<typeof useCanvas.getState>['edges'],
  simNodes: SimNodeResult[],
  killedIds: string[],
  markup: CanvasMarkup[],
) {
  const byId = new Map(simNodes.map((n) => [n.nodeId, n]));
  const markCount = new Map<string, number>();
  for (const m of markup) markCount.set(m.nodeId, (markCount.get(m.nodeId) ?? 0) + 1);

  /**
   * A node inside a boundary is positioned relative to it, so the plant has to walk
   * the parent chain the way React Flow does. Reading `position` straight off a
   * grouped node piles every bay's contents up near the origin — which is exactly
   * the bug you get for free if you assume the canvas is flat.
   */
  const absolute = (id: string): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    let cursor: string | undefined = id;
    const seen = new Set<string>();
    let depth = 0;
    while (cursor && !seen.has(cursor) && depth < 20) {
      seen.add(cursor);
      depth += 1;
      const node = nodes.find((n) => n.id === cursor);
      if (!node) break;
      x += node.position.x;
      y += node.position.y;
      cursor = node.parentId;
    }
    return { x, y };
  };

  const isGroup = (n: (typeof nodes)[number]) =>
    n.type === 'arch' && (n.data as ArchNodeData).archType === 'group';

  // Boundaries are floor bays, not machines: they hold stations rather than doing
  // work, and the simulator has nothing to say about them.
  const bays: BayView[] = nodes.filter(isGroup).map((n) => {
    const at = absolute(n.id);
    return {
      id: n.id,
      label: (n.data as ArchNodeData).label || 'Boundary',
      x: at.x,
      y: at.y,
      w: Number(n.width ?? n.measured?.width ?? 300),
      h: Number(n.height ?? n.measured?.height ?? 220),
    };
  });

  const arch = nodes.filter((n) => n.type === 'arch' && !isGroup(n));

  const stations: StationView[] = arch.map((n) => {
    const data = n.data as ArchNodeData;
    const spec = NODE_SPEC[data.archType];
    const r = byId.get(n.id);
    const at = absolute(n.id);
    const dead = killedIds.includes(n.id);
    const util = r && !r.unlimited && !r.elastic ? r.utilization : 0;
    const dropping = !!r && r.droppedRps > 0.01;
    const replicas = r?.replicas ?? (data.attrs?.replicas as number | undefined) ?? 1;
    const cap = r?.capacityRps ?? 0;

    const meta = !r
      ? 'not simulated'
      : r.unlimited || r.elastic
        ? `${fmt(r.incomingRps)} rps`
        : `${Math.round(util * 100)}% · ${replicas} × ${fmt(cap / Math.max(1, replicas))} rps`;

    return {
      id: n.id,
      label: data.label || spec?.label || data.archType,
      color: spec?.color ?? '#a09a90',
      x: at.x,
      y: at.y,
      util,
      height: heightFor(dead ? 0 : util),
      band: bandFor(util, dropping),
      meta,
      dead,
      pile: dead ? 0 : pileFor(r?.queueDepth ?? 0),
      replicas,
      annotation: data.annotation ?? '',
      ghost: !!data.ghost,
      locked: !!data.locked,
      marks: markCount.get(n.id) ?? 0,
    };
  });

  const centres = new Map(
    stations.map((s) => [s.id, { x: s.x + STATION_W / 2, y: s.y + STATION_D / 2 }]),
  );

  const belts: BeltView[] = [];
  for (const e of edges) {
    const a = centres.get(e.source);
    const b = centres.get(e.target);
    if (!a || !b) continue;
    const target = stations.find((s) => s.id === e.target);
    const source = stations.find((s) => s.id === e.source);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) continue;
    const r = byId.get(e.target);
    const carried = r?.incomingRps ?? 0;
    const dropped = r?.droppedRps ?? 0;
    const kind = (e.data?.kind as string) ?? 'sync';

    belts.push({
      id: e.id,
      x: a.x,
      y: a.y,
      len,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      color: source?.color ?? '#a09a90',
      plates: platesFor(carried),
      seconds: beltSeconds(r?.latencyMs ?? 20),
      jam: (target?.util ?? 0) >= 0.85,
      // Drops are only ever drawn because the engine computed them. Faking one
      // would be the single lie that matters in this whole view.
      drops: dropped > 0.01 ? Math.max(1, Math.min(4, Math.round((dropped / Math.max(1, carried)) * 8))) : 0,
      dim: !!source?.dead || !!target?.dead,
      kind,
    });
  }

  // The fence has a gate when something on the drawing establishes who the caller
  // is, and a visible hole when nothing does.
  const guarded = arch.some((n) => {
    const t = (n.data as ArchNodeData).archType;
    return t === 'waf' || t === 'api_gateway' || t === 'auth' || t === 'reverse_proxy';
  });

  return {
    stations,
    belts,
    bays,
    guarded,
    // Bays count toward the floor's extent, or a boundary drawn wider than its
    // contents would run off the edge of the concrete.
    bounds: boundsOf([
      ...stations.map((s) => ({ x: s.x, y: s.y })),
      ...bays.flatMap((b) => [
        { x: b.x, y: b.y },
        { x: b.x + b.w - STATION_W, y: b.y + b.h - STATION_D },
      ]),
    ]),
  };
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}
