import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';

/**
 * The title block, borrowed from real engineering drawings: which sheet, which
 * revision, and the live state of the thing being drawn. It replaces a scatter of
 * badges with one instrument the eye learns to read in a fixed place.
 */
export function TitleBlock() {
  const problem = useApp((s) => s.problem);
  const round = useApp((s) => s.round);
  const nodes = useCanvas((s) => s.nodes);
  const flows = useCanvas((s) => s.flows);
  const sim = useCanvas((s) => s.simResult);
  const running = useCanvas((s) => s.simRunning);
  if (!problem) return null;

  const components = nodes.filter((n) => n.type === 'arch').length;
  const hottest = sim?.nodes.reduce(
    (acc, n) => (Number.isFinite(n.utilization) && n.utilization > acc ? n.utilization : acc),
    0,
  );
  const broken = sim?.flows.filter((f) => f.broken).length ?? 0;

  const loadClass = !running ? '' : broken > 0 ? 'bad' : (hottest ?? 0) >= 1 ? 'bad' : (hottest ?? 0) >= 0.7 ? 'hot' : 'ok';
  const loadValue = !running
    ? 'idle'
    : broken > 0
      ? `${broken} flow${broken > 1 ? 's' : ''} down`
      : `${Math.round((hottest ?? 0) * 100)}% peak`;

  return (
    <div className="title-block">
      <div>
        <span className="k">sheet</span>
        <span className="v">{problem.id}</span>
      </div>
      <div>
        <span className="k">level / rev</span>
        <span className="v">
          L{problem.level} · r{round}
        </span>
      </div>
      <div>
        <span className="k">drawn</span>
        <span className="v">
          {components} parts · {flows.length} flows
        </span>
      </div>
      <div>
        <span className="k">load</span>
        <span className={`v ${loadClass}`}>{loadValue}</span>
      </div>
    </div>
  );
}
