import { useMemo } from 'react';
import { checkTopology } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';

/**
 * Deterministic structural review. This runs locally on every edit and costs
 * nothing, so the obvious mistakes — a client wired straight into Postgres, a
 * queue nobody consumes, a replication edge into a cache — are caught while you
 * are still drawing, long before a model is asked for an opinion.
 */
export function ChecksPanel() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const flows = useCanvas((s) => s.flows);
  const toGraph = useCanvas((s) => s.toGraph);

  const findings = useMemo(() => {
    try {
      return checkTopology(toGraph());
      // Recompute whenever the drawing changes.
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, flows, toGraph]);

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  const labelOf = (id: string) =>
    (nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id;

  if (findings.length === 0) {
    return (
      <div>
        <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
          Nothing structurally wrong. These checks look at how components are wired to each other —
          which connections are physically possible, which are meaningless, and which leave a hole. They
          run locally on every edit, so they cost nothing.
        </p>
        <div className="chip pass">no findings</div>
      </div>
    );
  }

  return (
    <div>
      <div className="row wrap" style={{ gap: 4, marginBottom: 10 }}>
        {counts.error > 0 && <span className="chip fail">{counts.error} cannot work</span>}
        {counts.warning > 0 && <span className="chip load">{counts.warning} would be questioned</span>}
        {counts.info > 0 && <span className="chip">{counts.info} worth noticing</span>}
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 0 }}>
        Structural checks on how your components fit together. Deterministic and free — the model review
        is for judgement, this is for facts.
      </p>

      {findings.map((f, i) => (
        <div className={`finding ${f.severity}`} key={`${f.rule}-${i}`}>
          <div className="msg">{f.message}</div>
          <div className="fix">{f.fix}</div>
          <div className="row wrap" style={{ gap: 3, marginTop: 6 }}>
            {f.nodeIds.map((id) => (
              <span className="chip" key={id}>
                {labelOf(id)}
              </span>
            ))}
            {f.concept && <span className="chip spec">{f.concept}</span>}
            <span className="grow" />
            <span className="stencil">{f.rule}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
