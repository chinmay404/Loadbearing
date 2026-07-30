import { memo, useState } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { useCanvas, type StickyData } from '../state/canvasStore';

function StickyNodeInner({ id, data, selected }: NodeProps<Node<StickyData, 'sticky'>>) {
  const [editing, setEditing] = useState(data.text === '');
  const update = useCanvas((s) => s.updateStickyText);

  return (
    <>
      <NodeResizer minWidth={140} minHeight={70} isVisible={selected} color="#d0b64a" />
      <div className="sticky-node" style={{ width: '100%', height: '100%' }}>
        {editing ? (
          <textarea
            autoFocus
            defaultValue={data.text}
            placeholder="Reasoning, trade-offs, capacity math…"
            onBlur={(e) => {
              update(id, e.target.value);
              setEditing(false);
            }}
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} style={{ whiteSpace: 'pre-wrap' }}>
            {data.text || 'double-click to write'}
          </div>
        )}
      </div>
    </>
  );
}

export const StickyNode = memo(StickyNodeInner);
