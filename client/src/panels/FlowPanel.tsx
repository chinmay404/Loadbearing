import { useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import {
  isPathBroken,
  matchPath,
  meetsPlan,
  plansFor,
  type Flow,
  type FlowKind,
  type FlowPlan,
  type GraphDSL,
  type PathMatch,
  type SimResult,
} from '@loadbearing/shared';
import { FLOW_KINDS, useCanvas, type ArchNodeData } from '../state/canvasStore';
import { useApp } from '../state/appStore';
import { assignFlows } from './requestFlows';

const KIND_HINT: Record<FlowKind, string> = {
  read: 'A read path — cacheable, latency-sensitive, usually the highest volume.',
  write: 'A write path — where consistency, idempotency and durability get decided.',
  async: 'Background work — queued, retried, eventually consistent.',
  admin: 'Operational or internal path — low volume, high privilege.',
};

type ArchNode = Node<ArchNodeData, 'arch'>;
type FlowResult = SimResult['flows'][number];

/**
 * The requests a sheet asks for, each set up from the arrows already drawn.
 *
 * Declaring a flow used to be five unexplained decisions. The sheet knows the
 * request's name, kind and rate, and the drawing knows its path — so each card
 * shows the path it found and asks for one click. The hand editor is still there
 * for anything the cards cannot express.
 */
export function FlowPanel() {
  const flows = useCanvas((s) => s.flows);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const toGraph = useCanvas((s) => s.toGraph);
  const addFlow = useCanvas((s) => s.addFlow);
  const updateFlow = useCanvas((s) => s.updateFlow);
  const sim = useCanvas((s) => s.simResult);
  const problem = useApp((s) => s.problem);

  const archNodes = nodes.filter(
    (n): n is ArchNode => n.type === 'arch' && !(n.data as ArchNodeData).ghost,
  );
  const labelOf = (id: string) => archNodes.find((n) => n.id === id)?.data.label ?? '?';
  // The flows are part of toGraph, but the path search only reads boxes and arrows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => toGraph(), [nodes, edges, toGraph]);
  const plans = useMemo(() => (problem ? plansFor(problem) : []), [problem]);
  const resultFor = (flow?: Flow) => (flow ? sim?.flows.find((r) => r.flowId === flow.id) : undefined);

  const { byPlan, extra } = assignFlows(plans, flows);

  /** Declare (or re-point) the flow for a plan. Values the learner already edited are kept. */
  const usePath = (plan: FlowPlan, steps: string[]) => {
    const existing = byPlan.get(plan.name);
    const id = existing?.id ?? addFlow();
    updateFlow(id, {
      name: plan.name,
      steps,
      ...(existing ? {} : { kind: plan.kind, rps: plan.rps, description: plan.plain }),
    });
  };

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Requests</h4>

      {plans.map((plan) => {
        const flow = byPlan.get(plan.name);
        return (
          <RequestCard
            key={plan.name}
            plan={plan}
            flow={flow}
            match={matchPath(plan, graph)}
            graph={graph}
            archNodes={archNodes}
            labelOf={labelOf}
            result={resultFor(flow)}
            onUse={(steps) => usePath(plan, steps)}
          />
        );
      })}

      {extra.length > 0 && <h4>{plans.length ? 'Your other flows' : 'Your flows'}</h4>}
      {extra.map((flow) => (
        <div className="card" key={flow.id}>
          <FlowEditor flow={flow} archNodes={archNodes} labelOf={labelOf} result={resultFor(flow)} />
        </div>
      ))}

      <button className="ghost" onClick={() => addFlow()} style={{ marginTop: 2 }}>
        + Add a flow
      </button>
    </div>
  );
}

function RequestCard({
  plan,
  flow,
  match,
  graph,
  archNodes,
  labelOf,
  result,
  onUse,
}: {
  plan: FlowPlan;
  flow?: Flow;
  match: PathMatch;
  graph: GraphDSL;
  archNodes: ArchNode[];
  labelOf: (id: string) => string;
  result?: FlowResult;
  onUse: (steps: string[]) => void;
}) {
  const [handOpen, setHandOpen] = useState(false);
  const route = (steps: string[]) => steps.map(labelOf).join(' → ');
  const declared = Boolean(flow && flow.steps.length > 0);
  // Changed when an arrow or a middle box went, and also when the first or last box
  // went: deleting a box strips it from the steps, leaving a connected path that no
  // longer reaches what this request needs.
  const broken = declared && (isPathBroken(flow!.steps, graph) || !meetsPlan(plan, flow!.steps, graph));

  return (
    <div className="card request-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{plan.name}</strong>
        <span className="chip spec" title={KIND_HINT[flow?.kind ?? plan.kind]}>
          {flow?.kind ?? plan.kind} · {flow?.rps ?? plan.rps}/s
        </span>
      </div>
      {/* Help text only while the path is unset. */}
      {plan.plain && (!declared || broken) && (
        <p className="faint" style={{ fontSize: 12, margin: '4px 0 6px' }}>
          {plan.plain}
        </p>
      )}

      {declared && !broken && (
        <div className="request-path ok">
          <span className="mono">{route(flow!.steps)}</span>
          {result && <ResultLine result={result} />}
        </div>
      )}

      {(!declared || broken) && (
        <div className="request-path">
          {broken && <p className="warn-text">Your drawing changed — this path no longer exists.</p>}
          {match.status === 'found' && (
            <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
              <span className="mono">{route(match.path)}</span>
              <span className="faint">found in your drawing</span>
              <button className="primary" onClick={() => onUse(match.path)}>
                {broken ? 'Update path' : 'Use this'}
              </button>
            </div>
          )}
          {match.status === 'choose' && (
            <div className="col" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                Which route does this request take?
              </span>
              {match.paths.map((p) => (
                <button key={p.join('>')} style={{ textAlign: 'left' }} onClick={() => onUse(p)}>
                  <span className="mono">{route(p)}</span>
                </button>
              ))}
            </div>
          )}
          {match.status === 'none' && (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Not connected yet — draw an arrow from the user to the next box
              {plan.mustReach ? ', and on to where this request has to end up' : ''}.
            </p>
          )}
        </div>
      )}

      {flow && (
        <details open={handOpen} onToggle={(e) => setHandOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="faint" style={{ fontSize: 11.5 }}>
            Edit
          </summary>
          {handOpen && <FlowEditor flow={flow} archNodes={archNodes} labelOf={labelOf} result={result} lockName />}
        </details>
      )}
    </div>
  );
}

/** How the request held under load. */
function ResultLine({ result }: { result: FlowResult }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div className="request-result mono">
        <span className={result.broken ? 'bad' : 'good'}>
          {result.broken ? `breaks at ${result.brokenAt}` : '✓ completes'}
        </span>
        {' · '}
        {Math.round(result.completedRps)}/{Math.round(result.offeredRps)} rps · p99 {Math.round(result.p99Ms)}ms
      </div>
      {result.notes.length > 0 && (
        <ul className="list-reset faint" style={{ fontSize: 11.5, marginTop: 5 }}>
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every field of one flow, by hand: name, kind, rate, guarantee and steps. */
function FlowEditor({
  flow,
  archNodes,
  labelOf,
  result,
  lockName = false,
}: {
  flow: Flow;
  archNodes: ArchNode[];
  labelOf: (id: string) => string;
  result?: FlowResult;
  /** Inside a request card the name is what ties the flow to the card, so it is fixed. */
  lockName?: boolean;
}) {
  const updateFlow = useCanvas((s) => s.updateFlow);
  const removeFlow = useCanvas((s) => s.removeFlow);
  const appendFlowStep = useCanvas((s) => s.appendFlowStep);
  const removeFlowStep = useCanvas((s) => s.removeFlowStep);

  return (
    <div style={{ marginTop: 6 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <input
          value={flow.name}
          onChange={(e) => updateFlow(flow.id, { name: e.target.value })}
          placeholder="checkout write path"
          readOnly={lockName}
          title={lockName ? 'This flow belongs to the request above, so its name is fixed' : undefined}
        />
        <button className="ghost" onClick={() => removeFlow(flow.id)} title="Delete flow">
          ✕
        </button>
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        <select
          value={flow.kind}
          onChange={(e) => updateFlow(flow.id, { kind: e.target.value as FlowKind })}
          title={KIND_HINT[flow.kind]}
          style={{ width: 110 }}
        >
          {FLOW_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <div className="row" style={{ gap: 4 }}>
          <input
            type="number"
            min={0}
            value={flow.rps}
            onChange={(e) => updateFlow(flow.id, { rps: Math.max(0, Number(e.target.value)) })}
            style={{ width: 90 }}
          />
          <span className="faint mono">rps</span>
        </div>
      </div>

      <input
        value={flow.description}
        onChange={(e) => updateFlow(flow.id, { description: e.target.value })}
        placeholder="What this flow guarantees (e.g. exactly-once charge, read-your-writes)"
        style={{ marginBottom: 6 }}
      />

      <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>
        {flow.steps.length === 0 && <span className="faint" style={{ fontSize: 11.5 }}>no steps yet →</span>}
        {flow.steps.map((s, i) => (
          <span className="chip spec" key={`${s}-${i}`}>
            {i + 1}. {labelOf(s)}
            <button className="ghost" style={{ padding: '0 4px', fontSize: 11.5 }} onClick={() => removeFlowStep(flow.id, i)}>
              ✕
            </button>
          </span>
        ))}
      </div>

      <select
        value=""
        onChange={(e) => {
          if (e.target.value) appendFlowStep(flow.id, e.target.value);
        }}
      >
        <option value="">+ add next step…</option>
        {archNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.data.label} ({n.data.archType})
          </option>
        ))}
      </select>

      {result && <ResultLine result={result} />}
    </div>
  );
}
