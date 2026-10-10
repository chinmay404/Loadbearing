import { checkConnection, type EdgeKind, type GraphNode, type TopologyFinding } from '@loadbearing/shared';
import type { Node } from '@xyflow/react';
import type { ArchNodeData } from '../state/canvasStore';

function asGraphNode(n: Node | undefined): GraphNode | null {
  const data = n?.data as ArchNodeData | undefined;
  if (!n || n.type !== 'arch' || !data?.archType) return null;
  return { id: n.id, type: data.archType, label: data.label, annotation: '', attrs: data.attrs ?? {} };
}

/**
 * Why `source` cannot be connected to `target` this way, or nothing if it can.
 * Only errors block: a design that is merely questionable can still be drawn.
 */
export function blockedReason(
  nodes: readonly Node[],
  source: string,
  target: string,
  kind: EdgeKind,
): TopologyFinding | undefined {
  const from = asGraphNode(nodes.find((n) => n.id === source));
  const to = asGraphNode(nodes.find((n) => n.id === target));
  if (!from || !to) return undefined;
  return checkConnection(from, to, kind).find((f) => f.severity === 'error');
}
