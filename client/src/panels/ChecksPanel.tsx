import { useMemo, useState } from 'react';
import { checkTopology, type TopologyFinding } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';

/**
 * Deterministic structural review. This runs locally on every edit and costs
 * nothing, so the obvious mistakes — a client wired straight into Postgres, a
 * queue nobody consumes, a replication edge into a cache — are caught while you
 * are still drawing, long before a model is asked for an opinion.
 *
 * Each finding is one line until you open it: what is wrong, on which parts. The
 * reasoning and the fix are a click away rather than a wall you have to read
 * before you can see the next problem.
 */

const SEVERITY_LABEL = { error: 'Cannot work', warning: 'Would be questioned', info: 'Worth noticing' } as const;

/** "X does Y — because Z" reads as a headline and its reason. */
export function splitMessage(message: string): { head: string; why: string } {
  const dash = message.indexOf(' — ');
  if (dash > 0) return { head: message.slice(0, dash), why: capitalise(message.slice(dash + 3)) };
  const stop = message.search(/[.;]\s/);
  if (stop > 0 && stop < message.length - 2) {
    return { head: message.slice(0, stop), why: capitalise(message.slice(stop + 2)) };
  }
  return { head: message.replace(/\.$/, ''), why: '' };
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function ChecksPanel() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const flows = useCanvas((s) => s.flows);
  const toGraph = useCanvas((s) => s.toGraph);
  const focusNode = useCanvas((s) => s.focusNode);
  const [open, setOpen] = useState<string | null>(null);

  const findings = useMemo(() => {
    try {
      return checkTopology(toGraph());
      // Recompute whenever the drawing changes.
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, flows, toGraph]);

  const labelOf = (id: string) =>
    (nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id;

  if (findings.length === 0) {
    return (
      <div className="checks-clear">
        <span className="checks-tick" aria-hidden="true" />
        <b>Nothing structurally wrong</b>
        <span>Checked on every edit: impossible connections, meaningless ones, and holes.</span>
      </div>
    );
  }

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const keyOf = (f: TopologyFinding, i: number) => `${f.rule}-${i}`;
  // The worst problem starts open, so there is always one thing to read first.
  const openKey = open ?? keyOf(findings[0]!, 0);

  return (
    <div className="checks">
      <div className="checks-tally" title="Deterministic and free. The model review is for judgement; this is for facts.">
        {counts.error > 0 && <span className="chip fail">{counts.error} cannot work</span>}
        {counts.warning > 0 && <span className="chip load">{counts.warning} questioned</span>}
        {counts.info > 0 && <span className="chip">{counts.info} worth noticing</span>}
      </div>

      <ul className="check-list">
        {findings.map((f, i) => {
          const key = keyOf(f, i);
          const isOpen = key === openKey;
          const { head, why } = splitMessage(f.message);
          return (
            <li key={key} className={`check ${f.severity}${isOpen ? ' open' : ''}`}>
              <button
                className="check-row"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? '' : key)}
                title={SEVERITY_LABEL[f.severity]}
              >
                <span className="check-dot" aria-hidden="true" />
                <span className="check-head">{head}</span>
                <span className="check-caret" aria-hidden="true" />
              </button>
              <div className="check-more">
                <div>
                  {why && <p className="check-why">{why}</p>}
                  <p className="check-fix">
                    <b>Fix</b> {f.fix}
                  </p>
                  <div className="check-tags">
                    {f.nodeIds.map((id) => (
                      <button key={id} className="chip check-part" onClick={() => focusNode(id)} title="Show it on the canvas">
                        {labelOf(id)}
                      </button>
                    ))}
                    {f.concept && <span className="chip spec">{f.concept}</span>}
                    <span className="grow" />
                    <span className="stencil">{f.rule}</span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
