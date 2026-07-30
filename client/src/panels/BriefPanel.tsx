import { DESIGN_CHECKLIST } from '@archdojo/shared';
import { useApp } from '../state/appStore';

export function BriefPanel() {
  const problem = useApp((s) => s.problem);
  const round = useApp((s) => s.round);
  const twist = useApp((s) => s.activeTwist);
  const score = useApp((s) => s.score);
  if (!problem) return null;

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <span className={`lvl l${problem.level}`}>L{problem.level}</span>
        <span className="chip">{problem.domain}</span>
        {round > 1 && <span className="chip load">round {round}</span>}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{problem.title}</h3>

      {twist && (
        <div className="banner warnb">
          <strong>Twist in play.</strong> {twist}
        </div>
      )}

      <p style={{ marginTop: 0 }}>{problem.prompt}</p>

      <div className="card">
        <h4>Must do</h4>
        <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
          {problem.functional.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h4>Numbers</h4>
        <div className="row wrap" style={{ gap: 4 }}>
          {Object.entries(problem.nonFunctional).map(([k, v]) => (
            <span className="chip spec" key={k}>
              {k}: {String(v)}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h4>Constraints — these decide what counts as overengineering</h4>
        <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
          {problem.constraints.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h4>Flows you should declare</h4>
        <div className="row wrap" style={{ gap: 4 }}>
          {problem.expectedFlows.map((f) => (
            <span className="chip spec" key={f}>
              {f}
            </span>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
          Define these in the Flows tab. They drive the load simulator and are graded step by step.
        </p>
      </div>

      {score === null && (
        <details className="disclose">
          <summary>The 10-step checklist a complete answer covers</summary>
          <ol className="list-reset" style={{ fontSize: 12, marginTop: 6 }}>
            {DESIGN_CHECKLIST.map((s) => (
              <li key={s.step} style={{ marginBottom: 5 }}>
                <strong>{s.step}</strong>
                <div className="faint">{s.detail}</div>
              </li>
            ))}
          </ol>
        </details>
      )}

      <details className="disclose">
        <summary>Load scenarios you can run before submitting</summary>
        {problem.scenarios.map((s) => (
          <div className="card" key={s.id}>
            <h4>{s.name}</h4>
            <p className="muted" style={{ fontSize: 12 }}>
              {s.description}
            </p>
            <div className="row wrap" style={{ gap: 4 }}>
              <span className="chip">×{s.rpsMultiplier} load</span>
              {(s.killNodes ?? []).map((k) => (
                <span className="chip fail" key={k}>
                  kill {k}
                </span>
              ))}
              {s.thirdPartyLatencyMs ? <span className="chip load">+{s.thirdPartyLatencyMs}ms 3rd-party</span> : null}
            </div>
            <p className="faint" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
              Pass: {s.passCriteria}
            </p>
          </div>
        ))}
      </details>
    </div>
  );
}
