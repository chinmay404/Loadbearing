import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '@archdojo/shared';

const STROKE: Record<EdgeKind, { stroke: string; dash?: string; width: number }> = {
  sync: { stroke: '#8b93a7', width: 1.8 },
  async: { stroke: '#34d399', dash: '6 4', width: 1.8 },
  replication: { stroke: '#818cf8', dash: '2 4', width: 1.6 },
};

function ArchEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const kind = ((data as { kind?: EdgeKind } | undefined)?.kind ?? 'sync') as EdgeKind;
  const s = STROKE[kind];
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#5eead4' : s.stroke,
          strokeWidth: selected ? s.width + 0.7 : s.width,
          ...(s.dash ? { strokeDasharray: s.dash } : {}),
          ...style,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: '#0b0d12',
              border: '1px solid #262b38',
              borderRadius: 5,
              padding: '1px 5px',
              fontSize: 10,
              color: '#9aa3b5',
              pointerEvents: 'none',
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ArchEdge = memo(ArchEdgeInner);
