import { memo, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SimNodeResult } from '@loadbearing/shared';
import { NODE_ICONS } from './icons';
import { NODE_SPEC } from './nodeCatalog';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';

const MARKER_GLYPH: Record<string, string> = {
  spof: '!',
  bottleneck: '▲',
  missing: '+',
  good: '✓',
  question: '?',
};

function attrChips(data: ArchNodeData): string[] {
  const a = data.attrs ?? {};
  const out: string[] = [];
  // An autoscaling range says more than a replica count, and it is the floor that
  // meets a spike — so show the range when there is one.
  if (a.autoscaleMax && a.autoscaleMax > 1) out.push(`×${a.autoscaleMin ?? a.replicas ?? 1}–${a.autoscaleMax}`);
  else if (a.replicas && a.replicas > 1) out.push(`×${a.replicas}`);
  if (a.capacityRps) out.push(`${a.capacityRps >= 1000 ? `${a.capacityRps / 1000}k` : a.capacityRps} rps`);
  if (a.latencyMs !== undefined) out.push(`${a.latencyMs}ms`);
  if (a.cacheHitRate !== undefined) out.push(`hit ${Math.round(a.cacheHitRate * 100)}%`);
  if (a.multiAz) out.push('multi-AZ');
  return out;
}

function ArchNodeInner({ id, data, selected }: NodeProps<Node<ArchNodeData, 'arch'>>) {
  const spec = NODE_SPEC[data.archType];
  const Icon = NODE_ICONS[data.archType];
  const [editing, setEditing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const updateNodeData = useCanvas((s) => s.updateNodeData);
  const unlockNode = useCanvas((s) => s.unlockNode);
  const acceptGhost = useCanvas((s) => s.acceptGhost);
  const rejectGhost = useCanvas((s) => s.rejectGhost);
  // Filter outside the selector: a fresh array from a selector loops forever.
  const markup = useCanvas((s) => s.markup).filter((m) => m.nodeId === id);
  const sim = useCanvas((s) => s.simResult)?.nodes.find((n) => n.nodeId === id);
  const killed = useCanvas((s) => s.simConfig.killNodeIds.includes(id));

  if (data.archType === 'group') {
    return (
      <>
        <NodeResizer minWidth={180} minHeight={120} isVisible={selected} color="#b07ca8" />
        <div className="group-node" style={{ width: '100%', height: '100%' }}>
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

  const state = killed ? 'down' : (sim?.state ?? 'ok');
  const cls = [
    'arch-node',
    selected ? 'selected' : '',
    data.ghost ? 'ghost' : '',
    data.locked ? 'locked' : '',
    sim || killed ? `state-${state}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={{ ['--node-color' as string]: spec.color, position: 'relative' }}>
      {data.locked && <LockBadge onUnlock={() => unlockNode(id)} />}
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="b" />

      {markup.length > 0 && (
        <div className="markup-pins">
          {markup.map((m, i) => (
            <span key={i} className={`pin ${m.marker}`} title={`${m.marker.toUpperCase()}: ${m.comment}`}>
              {MARKER_GLYPH[m.marker] ?? '•'}
            </span>
          ))}
        </div>
      )}

      <div className="head">
        <span className="ico">
          <Icon size={16} />
        </span>
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
          <span className="label" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {data.label}
          </span>
        )}
      </div>
      <div className="kind">{data.archType.replace(/_/g, ' ')}</div>

      {annotating ? (
        <textarea
          autoFocus
          placeholder="The mechanism that matters: idempotency key = order_id, cache-aside TTL 60s, shard by tenant_id…"
          defaultValue={data.annotation}
          onBlur={(e) => {
            updateNodeData(id, { annotation: e.target.value });
            setAnnotating(false);
          }}
        />
      ) : data.annotation ? (
        <div className="annot" onDoubleClick={() => setAnnotating(true)}>
          {data.annotation}
        </div>
      ) : (
        !data.ghost && (
          <div
            className="annot faint"
            onDoubleClick={() => setAnnotating(true)}
            title="Double-click to explain your reasoning — the grader reads this"
          >
            + explain this choice
          </div>
        )
      )}

      {attrChips(data).length > 0 && (
        <div className="attrs">
          {attrChips(data).map((t) => (
            <span className="chip" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      {sim && !data.ghost && <SimBadge sim={sim} />}

      {data.ghost && (
        <>
          <div className="annot" style={{ color: 'var(--violet)' }}>
            AI suggests: {data.ghost.why}
          </div>
          <div className="ghost-actions">
            <button className="primary" onClick={() => acceptGhost(id)}>
              Accept
            </button>
            <button onClick={() => rejectGhost(id)}>Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Seconds once milliseconds stop being readable: 80000ms tells nobody anything. */
function duration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * What the replica count did. An autoscaler that went from one to five is the story;
 * a fixed count is barely worth the space.
 */
function scaling(sim: SimNodeResult): string {
  if (sim.replicasSettled > sim.replicas) return ` · ×${sim.replicas}→${sim.replicasSettled}`;
  return sim.replicas > 1 ? ` · ×${sim.replicas}` : '';
}

function SimBadge({ sim }: { sim: SimNodeResult }) {
  const bar = Number.isFinite(sim.utilization) ? Math.min(sim.utilization, 2) / 2 : 1;
  const overloaded = sim.utilization > 1;
  // How much of what arrived did not get served. This is the number that matters once
  // a component is past its limit — "2000% utilised" is arithmetic, "sheds 95%" is the
  // finding.
  const shedPct = sim.incomingRps > 0 ? Math.round((sim.droppedRps / sim.incomingRps) * 100) : 0;

  return (
    <div className="util">
      <div className="bar">
        <span style={{ width: `${Math.max(2, bar * 100)}%` }} />
      </div>
      <div className="util-text">
        <span
          title={
            sim.elastic
              ? 'Runs on a provider’s capacity, so there is no utilisation to report — only their rate limit and their bill can stop it.'
              : sim.unlimited
                ? 'Nothing about this component limits traffic, so it has no utilisation.'
                : `${Math.round(sim.incomingRps)} rps arriving against ${Math.round(sim.capacityRps)} rps of capacity${sim.replicas > 1 ? ` across ${sim.replicas} replicas` : ''}.`
          }
        >
          {sim.elastic
            ? `hosted · ${Math.round(sim.incomingRps)} rps`
            : sim.unlimited
              ? `passes ${Math.round(sim.incomingRps)} rps`
              : `${Math.round(Math.min(sim.utilization, 9.99) * 100)}% · ${Math.round(sim.incomingRps)} rps`}
        </span>
        <span
          title={
            sim.hostLimited
              ? 'Not its own limit: the pool it shares with its neighbours has run out of room.'
              : overloaded
                ? `Past its capacity, so its latency is at the ceiling the model reports rather than a number to plan against. ${Math.round(sim.droppedRps)} rps never got served.`
                : 'Service time plus queue wait.'
          }
        >
          {/* A component squeezed by its pool is not overloaded — its neighbours are
              eating the machines, and saying "sheds 40%" without saying why sends you
              to tune the wrong box. */}
          {shedPct > 0 ? `${sim.hostLimited ? 'pool full · ' : ''}sheds ${shedPct}%` : duration(sim.latencyMs)}
          {scaling(sim)}
        </span>
      </div>
    </div>
  );
}

export const ArchNode = memo(ArchNodeInner);

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
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="5" y="11" width="14" height="10" rx="1.6" />
        <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
      </svg>
    </button>
  );
}
