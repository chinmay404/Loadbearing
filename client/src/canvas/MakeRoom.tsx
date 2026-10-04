import { useState } from 'react';
import { useCanvas } from '../state/canvasStore';
import { hasOverlap } from './layout';

/**
 * Parts grew when they gained gauges, so a drawing saved for the old, smaller
 * boxes can land with parts sitting on each other. This offers to spread it —
 * once, undoably, and never on its own: where things sit is the author's call.
 */
export function MakeRoom() {
  const crowded = useCanvas((s) => hasOverlap(s.nodes));
  const makeRoom = useCanvas((s) => s.makeRoom);
  const problemId = useCanvas((s) => s.problemId);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (!crowded || dismissedFor === (problemId ?? '')) return null;
  return (
    <div className="make-room" role="status">
      Some parts overlap since they gained their gauges.
      <button className="primary" onClick={makeRoom}>
        Make room
      </button>
      <button className="ghost" onClick={() => setDismissedFor(problemId ?? '')}>
        Keep as is
      </button>
    </div>
  );
}
