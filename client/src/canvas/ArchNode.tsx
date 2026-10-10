import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeResizer, Position, useConnection, useStore, type NodeProps, type Node } from '@xyflow/react';
import { familyOf, type Family } from '@loadbearing/shared';
import { NODE_ICONS } from './icons';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';
import { usePrefs } from '../ui/prefs';
import { fmtInt, fmtMs, gaugeModel, statusNote, type GaugeModel, type StatusNote } from './gauge';
import { FarFace, InstrumentGauge, RackLeds, RackScreen } from './faces';
import { UserView } from './UserView';
import { blockedReason } from './connectRules';

const MARKER_GLYPH: Record<string, string> = {
  spof: '!',
  bottleneck: '▲',
  missing: '+',
  good: '✓',
  question: '?',
};

/** Below this zoom the detail is unreadable, so a part shows its far face instead. */
export const FAR_ZOOM = 0.6;

/** The stamp on a rack module's faceplate. */
const MODEL_CODE: Record<Family, string> = {
  origin: 'SRC',
  routing: 'RTR',
  compute: 'SVC',
  datastore: 'DB',
  cache: 'KV',
  messaging: 'MQ',
  external: 'EXT',
  ai: 'AI',
  control: 'CTL',
  boundary: '',
};

/** The sizing that matters before anything has run. */
function configLine(data: ArchNodeData): string {
  const a = data.attrs ?? {};
  const out: string[] = [];
  if (a.autoscaleMax && a.autoscaleMax > 1) out.push(`×${a.autoscaleMin ?? a.replicas ?? 1}–${a.autoscaleMax}`);
  else if (a.replicas && a.replicas > 1) out.push(`×${a.replicas}`);
  if (a.capacityRps) out.push(`${a.capacityRps >= 1000 ? `${a.capacityRps / 1000}k` : a.capacityRps} rps`);
  if (a.latencyMs !== undefined) out.push(`${a.latencyMs} ms`);
  if (a.multiAz) out.push('multi-AZ');
  return out.join(' · ');
}

function footFor(m: GaugeModel, data: ArchNodeData): { left: string; right: string; bad: boolean } {
  if (m.health === 'down') return { left: 'Killed in this run', right: '', bad: true };
  if (!m.live) return { left: configLine(data) || 'Not run yet', right: '', bad: false };
  const left = `in ${fmtInt(m.inRps)}/s`;
  if (m.shed > 0) {
    return { left, right: `${m.hostLimited ? 'pool full · ' : ''}sheds ${Math.round(m.shed * 100)}%`, bad: true };
  }
  if (m.elastic) return { left, right: 'hosted', bad: false };
  return { left, right: fmtMs(m.latencyMs), bad: false };
}

function ArchNodeInner({ id, data, selected }: NodeProps<Node<ArchNodeData, 'arch'>>) {
  const Icon = NODE_ICONS[data.archType];
  const [editing, setEditing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const unlockNode = useCanvas((s) => s.unlockNode);
  const acceptGhost = useCanvas((s) => s.acceptGhost);
  const rejectGhost = useCanvas((s) => s.rejectGhost);
  const edgeKind = useCanvas((s) => s.edgeKind);
  // While a connection is being dragged, a part that cannot take it says so.
  const dragging = useConnection((c) =>
    c.inProgress && c.fromNode.id !== id ? `${c.fromNode.id}|${c.fromHandle?.type ?? 'source'}` : null,
  );
  const cannotConnect = useMemo(() => {
    if (!dragging) return false;
    const [other, side] = dragging.split('|') as [string, string];
    const [source, target] = side === 'target' ? [id, other] : [other, id];
    return Boolean(blockedReason(useCanvas.getState().nodes, source, target, edgeKind));
  }, [dragging, id, edgeKind]);
  // Filter outside the selector: a fresh array from a selector loops forever.
  const markup = useCanvas((s) => s.markup).filter((m) => m.nodeId === id);
  const simResult = useCanvas((s) => s.simResult);
  const sim = simResult?.nodes.find((n) => n.nodeId === id);
  const killed = useCanvas((s) => s.simConfig.killNodeIds.includes(id));
  const running = useCanvas((s) => s.simRunning);
  const outDegree = useCanvas((s) => s.edges.reduce((c, e) => c + (e.source === id ? 1 : 0), 0));
  const skin = usePrefs((s) => s.nodeSkin);
  const dropTarget = useCanvas((s) => s.dropTargetId === id);
  // A boolean selector: nodes re-render when the zoom crosses the line, not on every wheel tick.
  const far = useStore((s) => s.transform[2] < FAR_ZOOM);

  const isOrigin = familyOf(data.archType) === 'origin';
  const points = simResult?.timeline?.points;
  const series = useMemo(() => (isOrigin && points ? points.map((p) => p.offeredRps) : undefined), [isOrigin, points]);
  const m = useMemo(
    () => gaugeModel({ type: data.archType, attrs: data.attrs, sim, killed, outDegree }),
    [data.archType, data.attrs, sim, killed, outDegree],
  );

  if (data.archType === 'group') {
    return (
      <>
        <NodeResizer minWidth={180} minHeight={120} isVisible={selected} color="var(--plum)" />
        {data.attrs?.sharedHost ? (
          <MachineFrame id={id} data={data} killed={killed} dropTarget={dropTarget} />
        ) : (
        <div className={`group-node${dropTarget ? ' drop-target' : ''}`} data-drop={dropTarget ? `Drop into ${data.label}` : undefined} style={{ width: '100%', height: '100%' }}>
          <div className="glabel">
            {editing ? (
              <input
                autoFocus
                defaultValue={data.label}
                onBlur={(e) => {
                  updateNodeData(id, { label: e.target.value });
                  setEditing(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <span onDoubleClick={() => setEditing(true)}>{data.label}</span>
            )}
          </div>
        </div>
        )}
        {data.locked && <LockBadge onUnlock={() => unlockNode(id)} />}
        {/*
          A boundary is a thing you connect. "This VPC peers with that one", "this
          cell replicates to that cell", "traffic crosses from the public zone into
          the private one" are all edges between groups, and without handles there
          was no way to draw any of them. Placed on the frame rather than the fill
          so they do not fight with dragging a component into the group.
        */}
        <Handle type="target" position={Position.Left} className="group-handle" />
        <Handle type="target" position={Position.Top} id="t" className="group-handle" />
        <Handle type="source" position={Position.Right} className="group-handle" />
        <Handle type="source" position={Position.Bottom} id="b" className="group-handle" />
      </>
    );
  }

  // How badly it is over its limit, 0 at the line and 1 by twice it. Drives how
  // heavily the box reads, so a part at 105% is marked and one at 300% is unmissable.
  const overload = Number.isFinite(sim?.utilization) ? Math.min(1, Math.max(0, (sim!.utilization - 1) / 1)) : 0;
  const foot = footFor(m, data);
  const note = statusNote(m, sim, data.attrs ?? {});

  const cls = [
    'node',
    `node-${skin}`,
    far ? 'is-far' : '',
    selected ? 'selected' : '',
    data.ghost ? 'ghost' : '',
    data.locked ? 'locked' : '',
    cannotConnect ? 'no-connect' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const name = editing ? (
    <input
      className="n-rename"
      autoFocus
      defaultValue={data.label}
      onBlur={(e) => {
        updateNodeData(id, { label: e.target.value });
        setEditing(false);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  ) : (
    <span className="n-name" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {data.label}
    </span>
  );

  // The mechanism is what the grader reads, so it stays on the part rather than in a panel.
  const annotation = annotating ? (
    <textarea
      className="n-annot-edit nodrag"
      autoFocus
      placeholder="The mechanism that matters: idempotency key = order_id, cache-aside TTL 60s, shard by tenant_id…"
      defaultValue={data.annotation}
      onBlur={(e) => {
        updateNodeData(id, { annotation: e.target.value });
        setAnnotating(false);
      }}
    />
  ) : data.annotation ? (
    <div className="n-annot" onDoubleClick={() => setAnnotating(true)} title={data.annotation}>
      {data.annotation}
    </div>
  ) : !data.ghost ? (
    <div className="n-annot empty" onDoubleClick={() => setAnnotating(true)} title="Double-click to explain your reasoning — the grader reads this">
      + Explain this choice
    </div>
  ) : null;

  const ghost = data.ghost ? (
    <div className="n-ghost">
      <div className="n-ghost-why">
        <b>Suggested</b> {data.ghost.why}
      </div>
      <div className="ghost-actions">
        <button className="primary" onClick={() => acceptGhost(id)}>
          Accept
        </button>
        <button onClick={() => rejectGhost(id)}>Dismiss</button>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cls}
      data-health={m.health}
      data-running={running && m.live ? 'true' : 'false'}
      style={{ ['--stress' as string]: String(Math.round(overload * 100) / 100) } as CSSProperties}
    >
      {data.locked && <LockBadge onUnlock={() => unlockNode(id)} />}
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="b" />

      {/* What a person on this client sees, while a run is on. */}
      {running && m.live && !far && (data.archType === 'client' || data.archType === 'mobile_client') && (
        <UserView nodeId={id} device={data.archType === 'mobile_client' ? 'phone' : 'browser'} />
      )}

      {markup.length > 0 && (
        <div className="markup-pins">
          {markup.map((mk, i) => (
            <span key={i} className={`pin ${mk.marker}`} title={`${mk.marker}: ${mk.comment}`}>
              {MARKER_GLYPH[mk.marker] ?? '•'}
            </span>
          ))}
        </div>
      )}

      {far ? (
        <FarFace m={m} label={data.label} />
      ) : skin === 'rack' ? (
        <>
          <i className="screw tl" />
          <i className="screw tr" />
          <i className="screw bl" />
          <i className="screw br" />
          <div className="r-head">
            {name}
            <span className="r-model">
              {MODEL_CODE[familyOf(data.archType)]}
              {m.workers ? `·${m.workers.replicas}` : ''}
            </span>
          </div>
          {annotation}
          {ghost ?? (
            <div className="r-panel">
              <div className="r-screen">
                <RackScreen m={m} attrs={data.attrs ?? {}} series={series} />
              </div>
              <StatusTip note={note} health={m.health}>
                <RackLeds health={m.health} />
              </StatusTip>
            </div>
          )}
          <div className="r-foot">
            <span className="r-vents" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className={`r-io${foot.bad ? ' bad' : ''}`}>{m.live ? `IN ${fmtInt(m.inRps)}/S` : foot.left.toUpperCase()}</span>
          </div>
        </>
      ) : (
        <>
          <div className="n-head">
            <span className="n-tile">
              <Icon size={18} />
            </span>
            <span className="n-names">
              {name}
              <span className="n-kind">{data.archType.replace(/_/g, ' ')}</span>
            </span>
            <StatusTip note={note} health={m.health}>
              <span className="n-led" aria-hidden="true" />
            </StatusTip>
          </div>
          {annotation}
          {ghost ?? (
            <div className="n-gauge">
              <InstrumentGauge m={m} attrs={data.attrs ?? {}} series={series} />
            </div>
          )}
          {!data.ghost && (
            <div className="n-foot">
              <span>{foot.left}</span>
              <span className={foot.bad ? 'bad' : ''}>{foot.right}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const ArchNode = memo(ArchNodeInner);

/**
 * The light, and on hover what it means. A red dot with no reason is an accusation;
 * this says which number put it there and, when it is not the part's own speed,
 * what is setting the ceiling.
 */
function StatusTip({ note, health, children }: { note: StatusNote; health: GaugeModel['health']; children: ReactNode }) {
  return (
    <span className="n-status nodrag" tabIndex={0} aria-label={`${note.title}. ${note.body}${note.limit ? ` ${note.limit}` : ''}`}>
      {children}
      <span className="n-tip" role="tooltip" data-health={health}>
        <b>{note.title}</b>
        <span>{note.body}</span>
        {note.limit && <em>{note.limit}</em>}
      </span>
    </span>
  );
}

/**
 * A machine: a frame whose contents run on it. Its header says how big it is and how
 * much of it is in use, and the light explains who is using it.
 */
function MachineFrame({ id, data, killed, dropTarget }: { id: string; data: ArchNodeData; killed: boolean; dropTarget: boolean }) {
  const host = useCanvas((s) => s.simResult?.hosts?.find((h) => h.hostId === id));
  const empty = useCanvas((s) => !s.nodes.some((n) => n.parentId === id));
  const labels = useCanvas((s) => s.nodes);
  const Icon = NODE_ICONS.vm;
  const a = data.attrs ?? {};
  const size = [a.vcpu ? `${a.vcpu} vCPU` : null, a.memoryGb ? `${a.memoryGb} GB` : null, (a.replicas ?? 1) > 1 ? `×${a.replicas}` : null]
    .filter(Boolean)
    .join(' · ');
  const used = host?.used ?? 0;
  const slots = host?.slots ?? null;
  const share = slots ? used / slots : 0;
  const health: GaugeModel['health'] =
    killed || host?.down ? 'down' : !host ? 'idle' : share >= 1 ? 'fail' : share >= 0.7 ? 'load' : 'pass';
  const nameOf = (nid: string) =>
    (labels.find((n) => n.id === nid)?.data as { label?: string } | undefined)?.label ?? nid;
  const who = (host?.members ?? [])
    .filter((m) => m.used > 0.05)
    .sort((x, y) => y.used - x.used)
    .map((m) => `${nameOf(m.nodeId)} ${fmtInt(m.used)}`)
    .join(' · ');
  const note: StatusNote =
    health === 'down'
      ? { title: 'Machine down', body: 'Everything inside it is down with it.' }
      : health === 'idle'
        ? { title: 'Not running', body: 'Press Run load to see how much of this machine is used.' }
        : {
            title: health === 'fail' ? 'Machine full' : health === 'load' ? 'Machine busy' : 'Machine healthy',
            body: slots
              ? `${fmtInt(used)} of ${fmtInt(slots)} request slots in use (${Math.round(share * 100)}%).`
              : `${fmtInt(used)} requests in flight. Give it a vCPU count to set a limit.`,
            ...(who ? { limit: `Using it: ${who}` } : {}),
          };

  return (
    <div
      className={`group-node machine${dropTarget ? ' drop-target' : ''}`}
      data-health={health}
      data-drop={dropTarget ? `Drop to run on ${data.label}` : undefined}
      style={{ width: '100%', height: '100%' }}
    >
      <div className="m-head">
        <span className="m-tile">
          <Icon size={15} />
        </span>
        <span className="m-name">{data.label}</span>
        <span className="m-size">{size || 'unsized'}</span>
        <span className="grow" />
        {slots !== null && host && <span className="m-pct">{Math.round(share * 100)}%</span>}
        <StatusTip note={note} health={health}>
          <span className="n-led" aria-hidden="true" />
        </StatusTip>
      </div>
      <div className="m-bar" aria-hidden="true">
        <i style={{ ['--fill' as string]: String(Math.min(1, share)) } as CSSProperties} />
      </div>
      {empty && !dropTarget && (
        <p className="m-empty">
          Drag parts in here.
          <span>They share this machine’s CPU, and go down with it.</span>
        </p>
      )}
    </div>
  );
}

/**
 * The way back out of a pin. A pinned component is not selectable, so no panel can
 * offer to release it — the control has to live on the object, and it has to stop
 * the click reaching the canvas underneath.
 */
function LockBadge({ onUnlock }: { onUnlock: () => void }) {
  return (
    <button
      className="lock-badge"
      title="Pinned — click to release"
      aria-label="Unpin this component"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onUnlock();
      }}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="5" y="11" width="14" height="10" rx="1.6" />
        <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
      </svg>
    </button>
  );
}
