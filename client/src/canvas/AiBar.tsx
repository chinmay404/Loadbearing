import { useCanvas, type ArchNodeData } from '../state/canvasStore';

/**
 * One place to manage what the AI has done to the drawing: pending proposals
 * (accept or dismiss the lot) and a way back after accepting — this is the
 * learner's design, and every AI edit must be reversible in one click.
 */
export function AiBar() {
  const nodes = useCanvas((s) => s.nodes);
  const aiAccepted = useCanvas((s) => s.aiAccepted);
  const acceptAllGhosts = useCanvas((s) => s.acceptAllGhosts);
  const rejectAllGhosts = useCanvas((s) => s.rejectAllGhosts);
  const revertAiChanges = useCanvas((s) => s.revertAiChanges);

  const ghosts = nodes.filter((n) => n.type === 'arch' && (n.data as ArchNodeData).ghost);
  const acceptedAlive = aiAccepted.filter((id) => nodes.some((n) => n.id === id));

  if (ghosts.length === 0 && acceptedAlive.length === 0) return null;

  return (
    <div className="toolbar" style={{ left: 12, top: 10, transform: 'none' }}>
      {ghosts.length > 0 && (
        <>
          <span className="stencil" style={{ alignSelf: 'center', padding: '0 4px' }}>
            {ghosts.length} suggested
          </span>
          <button onClick={acceptAllGhosts} title="Accept every suggested component">
            Accept
          </button>
          <button className="ghost" onClick={rejectAllGhosts} title="Remove every suggested component">
            Dismiss
          </button>
        </>
      )}
      {acceptedAlive.length > 0 && (
        <>
          {ghosts.length > 0 && <span className="sep" />}
          <button
            className="ghost"
            onClick={revertAiChanges}
            title={`Remove the ${acceptedAlive.length} AI component${acceptedAlive.length > 1 ? 's' : ''} you accepted and put the drawing back how you had it`}
          >
            Undo AI ({acceptedAlive.length})
          </button>
        </>
      )}
    </div>
  );
}
