import { memo, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type Node } from '@xyflow/react';
import type { SimNodeResult } from '@archdojo/shared';
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
  if (a.replicas && a.replicas > 1) out.push(`×${a.replicas}`);
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
  const acceptGhost = useCanvas((s) => s.acceptGhost);
  const rejectGhost = useCanvas((s) => s.rejectGhost);
  // Filter outside the selector: a fresh array from a selector loops forever.
  const markup = useCanvas((s) => s.markup).filter((m) => m.nodeId === id);
  const sim = useCanvas((s) => s.simResult)?.nodes.find((n) => n.nodeId === id);
  const killed = useCanvas((s) => s.simConfig.killNodeIds.includes(id));

  if (data.archType === 'group') {
    return (
      <>
        <NodeResizer minWidth={180} minHeight={120} isVisible={selected} color="#818cf8" />
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
      </>
    );
  }

  const state = killed ? 'down' : (sim?.state ?? 'ok');
  const cls = [
    'arch-node',
    selected ? 'selected' : '',
    data.ghost ? 'ghost' : '',
    sim || killed ? `state-${state}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={{ ['--node-color' as string]: spec.color, position: 'relative' }}>
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
          <div className="annot" style={{ color: 'var(--accent-2)' }}>
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

function SimBadge({ sim }: { sim: SimNodeResult }) {
  const pct = Number.isFinite(sim.utilization) ? Math.min(sim.utilization, 2) / 2 : 1;
  return (
    <div className="util">
      <div className="bar">
        <span style={{ width: `${Math.max(2, pct * 100)}%` }} />
      </div>
      <div className="util-text">
        <span>
          {Number.isFinite(sim.utilization) ? `${Math.round(sim.utilization * 100)}%` : 'over'} ·{' '}
          {Math.round(sim.incomingRps)} rps
        </span>
        <span>
          {Math.round(sim.latencyMs)}ms
          {sim.droppedRps > 0 ? ` · -${Math.round(sim.droppedRps)}` : ''}
        </span>
      </div>
    </div>
  );
}

export const ArchNode = memo(ArchNodeInner);
