import { useState } from 'react';
import type { DimensionKey } from '@loadbearing/shared';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { api, ApiError } from '../lib/api';
import { copyText, downloadText, toDrawio, toMermaid } from '../lib/diagram';
import { IconArchive, IconTwist } from '../ui/UiIcons';

const DIM_LABEL: Record<DimensionKey, string> = {
  requirements: 'Requirements met',
  scalability: 'Scalability',
  reliability: 'Reliability',
  data_consistency: 'Data & consistency',
  security: 'Security',
  cost_simplicity: 'Cost & simplicity',
};

export function FeedbackPanel() {
  const score = useApp((s) => s.score);
  const problem = useApp((s) => s.problem);
  const submitting = useApp((s) => s.submitting);
  const attemptId = useApp((s) => s.attemptId);
  const round = useApp((s) => s.round);
  const startTwist = useApp((s) => s.startTwist);
  const setNotice = useApp((s) => s.setNotice);
  const setError = useApp((s) => s.setError);
  const clearAi = useCanvas((s) => s.clearAi);
  const toGraph = useCanvas((s) => s.toGraph);
  const toDoc = useCanvas((s) => s.toDoc);
  const [busy, setBusy] = useState<string | null>(null);

  if (submitting) {
    return (
      <div className="empty-state">
        <div>
          <span className="spinner" style={{ width: 18, height: 18 }} />
          <h3 style={{ marginTop: 12 }}>The reviewer is reading your drawing</h3>
          <p style={{ fontSize: 12.5, maxWidth: 260 }}>
            Components, connections, annotations, flows and the capacity model. Ten to forty seconds.
          </p>
        </div>
      </div>
    );
  }

  if (!score) {
    return (
      <div className="empty-state">
        <div>
          <h3>Nothing reviewed yet</h3>
          <p style={{ fontSize: 12.5, maxWidth: 270 }}>
            Draw the design, declare your flows, then run load to catch the obvious problems yourself.
            Submit when you are ready to be argued with.
          </p>
        </div>
      </div>
    );
  }

  const band = score.overall >= 80 ? 'hi' : score.overall >= 60 ? 'mid' : 'lo';
  const twist = problem?.twists[round - 1] ?? problem?.twists[0];

  const run = async (key: string, fn: () => Promise<void>) => {
    try {
      setBusy(key);
      await fn();
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="verdict-head">
        <span className={`n ${band}`}>{score.overall}</span>
        <span className="of">
          / 100
          <br />
          rev {round}
        </span>
        <span className="grow" />
        {score.risks.length > 0 && (
          <span className={`chip ${score.risks.some((r) => r.likelihood === 'high') ? 'fail' : 'load'}`}>
            {score.risks.length} risks
          </span>
        )}
      </div>

      {score.decision_summary && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 9 }}>
          {score.decision_summary}
        </p>
      )}

      <div className="row wrap" style={{ gap: 4, margin: '10px 0 4px' }}>
        {twist && (
          <button
            className="primary"
            onClick={() => {
              clearAi();
              startTwist(twist);
            }}
            title={twist}
          >
            <IconTwist size={15} /> Take the twist
          </button>
        )}
        <button
          onClick={() => void run('adr', async () => {
            if (attemptId === null) return;
            const r = await api.exportAttempt(attemptId, 'adr');
            setNotice(`ADR written to ${r.path}`);
          })}
          disabled={busy !== null || attemptId === null}
          title="Write an Architecture Decision Record into your vault: context, decision, alternatives, consequences, risks, at-10x"
        >
          {busy === 'adr' ? <span className="spinner" /> : <IconArchive size={15} />} Write ADR
        </button>
        <button
          onClick={() => void run('copyadr', async () => {
            if (attemptId === null) return;
            const r = await api.exportText(attemptId, 'adr');
            setNotice((await copyText(r.text)) ? 'ADR copied to the clipboard.' : 'Clipboard blocked — use Write ADR instead.');
          })}
          disabled={busy !== null || attemptId === null}
          title="Copy the ADR markdown for a PR description or a design doc"
        >
          Copy ADR
        </button>
        <button
          onClick={() => void run('mermaid', async () => {
            setNotice(
              (await copyText(toMermaid(toGraph())))
                ? 'Mermaid copied — paste it into a PR, README or Obsidian note.'
                : 'Clipboard blocked by the browser.',
            );
          })}
          title="Copy the diagram as Mermaid"
        >
          Copy Mermaid
        </button>
        <button
          onClick={() => downloadText(`${problem?.id ?? 'design'}.drawio`, toDrawio(toDoc()), 'application/xml')}
          title="Download as draw.io / diagrams.net, positions intact"
        >
          .drawio
        </button>
        <button
          onClick={() => void run('review', async () => {
            if (attemptId === null) return;
            const r = await api.exportAttempt(attemptId, 'review');
            setNotice(`Review post-mortem written to ${r.path}`);
          })}
          disabled={busy !== null || attemptId === null}
        >
          Save review
        </button>
        <button className="ghost" onClick={clearAi} title="Remove the reviewer's pins and ghost components">
          Clear markup
        </button>
      </div>

      <span className="section-label">Scores</span>
      {(Object.keys(DIM_LABEL) as DimensionKey[]).map((k) => {
        const d = score.dimensions[k];
        // max 0 means the grader never returned this dimension — show it as such
        // instead of a zero the learner did not earn.
        if (d.max === 0) {
          return (
            <div className="dim-row" key={k}>
              <div className="top">
                <span className="muted">{DIM_LABEL[k]}</span>
                <span className="v faint">n/a</span>
              </div>
              <div className="notes faint">
                Not assessed this round. Smaller models sometimes drop a dimension — resubmit, or use a
                stronger model for the full rubric.
              </div>
            </div>
          );
        }
        const pct = (d.score / d.max) * 100;
        const color = pct >= 75 ? 'var(--pass)' : pct >= 50 ? 'var(--load)' : 'var(--fail)';
        return (
          <div className="dim-row" key={k}>
            <div className="top">
              <span>{DIM_LABEL[k]}</span>
              <span className="v" style={{ color }}>
                {d.score}/{d.max}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${pct}%`, background: color }} />
            </div>
            {d.notes && <div className="notes">{d.notes}</div>}
          </div>
        );
      })}

      {score.critical_failures.length > 0 && (
        <>
          <span className="section-label">What breaks · {score.critical_failures.length}</span>
          {score.critical_failures.map((f, i) => (
            <div className={`card sev-${f.severity}`} key={i}>
              <h4>{f.title}</h4>
              <p className="muted" style={{ fontSize: 12.5 }}>
                {f.detail}
              </p>
              {f.concept && <span className="chip fail">{f.concept}</span>}
            </div>
          ))}
        </>
      )}

      {score.risks.length > 0 && (
        <>
          <span className="section-label">Risk register</span>
          {score.risks.map((r, i) => (
            <div className="card" key={i}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <h4 className="grow">{r.risk}</h4>
                <span className={`chip ${r.likelihood === 'high' ? 'fail' : r.likelihood === 'medium' ? 'load' : ''}`}>
                  {r.likelihood}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                <span className="stencil">impact</span> {r.impact}
              </p>
              <p className="muted" style={{ fontSize: 12 }}>
                <span className="stencil">mitigation</span> {r.mitigation}
              </p>
            </div>
          ))}
        </>
      )}

      {score.spofs.length > 0 && (
        <>
          <span className="section-label">Single points of failure</span>
          <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
            {score.spofs.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {score.missing.length > 0 && (
        <>
          <span className="section-label">Missing</span>
          <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
            {score.missing.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {score.flow_reviews.length > 0 && (
        <>
          <span className="section-label">Flow review</span>
          {score.flow_reviews.map((f, i) => (
            <div className="card" key={i}>
              <div className="row">
                <strong className="grow" style={{ fontSize: 12.5 }}>
                  {f.flowName}
                </strong>
                <span className={`chip ${f.verdict === 'sound' ? 'pass' : f.verdict === 'missing' ? 'fail' : 'load'}`}>
                  {f.verdict}
                </span>
              </div>
              {f.issues.length > 0 && (
                <ul className="list-reset muted" style={{ fontSize: 12, marginTop: 5 }}>
                  {f.issues.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}

      {score.good_calls.length > 0 && (
        <>
          <span className="section-label">Right calls</span>
          {score.good_calls.map((g, i) => (
            <div className="card ok-card" key={i}>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {g}
              </p>
            </div>
          ))}
        </>
      )}

      {score.socratic_questions.length > 0 && (
        <>
          <span className="section-label">Answer these before you peek</span>
          <ol className="list-reset" style={{ fontSize: 12.5 }}>
            {score.socratic_questions.map((q, i) => (
              <li key={i} style={{ marginBottom: 5 }}>
                {q}
              </li>
            ))}
          </ol>
          <p className="stencil">work them through in the ask tab</p>
        </>
      )}

      {score.at_10x && (
        <details className="disclose">
          <summary>At ten times the load</summary>
          <div className="card">
            <p className="muted" style={{ fontSize: 12.5, margin: 0, whiteSpace: 'pre-wrap' }}>
              {score.at_10x}
            </p>
          </div>
        </details>
      )}

      {score.alternatives.length > 0 && (
        <details className="disclose">
          <summary>Alternatives weighed · {score.alternatives.length}</summary>
          {score.alternatives.map((a, i) => (
            <div className="card" key={i}>
              <h4>{a.option}</h4>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {a.why_not}
              </p>
            </div>
          ))}
        </details>
      )}

      {score.verdict_teaching.length > 0 && (
        <details className="disclose">
          <summary>Why each component belongs · {score.verdict_teaching.length}</summary>
          {score.verdict_teaching.map((t, i) => (
            <div className="card" key={i}>
              <h4>{t.component}</h4>
              <dl style={{ margin: 0, fontSize: 12 }}>
                <dt className="stencil">why</dt>
                <dd className="muted" style={{ margin: '0 0 4px' }}>
                  {t.why}
                </dd>
                <dt className="stencil">breaks without it</dt>
                <dd className="muted" style={{ margin: '0 0 4px' }}>
                  {t.breaks_without}
                </dd>
                <dt className="stencil">rejected alternative</dt>
                <dd className="muted" style={{ margin: 0 }}>
                  {t.rejected_alt}
                </dd>
              </dl>
            </div>
          ))}
        </details>
      )}

      {score.model_answer_summary && (
        <details className="disclose">
          <summary>How a strong engineer would solve it</summary>
          <div className="card">
            <p className="muted" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', margin: 0 }}>
              {score.model_answer_summary}
            </p>
          </div>
        </details>
      )}

      {Object.keys(score.concept_scores).length > 0 && (
        <details className="disclose">
          <summary>Concept mastery from this attempt</summary>
          <div className="row wrap" style={{ gap: 3, marginTop: 6 }}>
            {Object.entries(score.concept_scores)
              .sort((a, b) => a[1] - b[1])
              .map(([c, v]) => (
                <span className={`chip ${v >= 0.75 ? 'pass' : v >= 0.45 ? 'load' : 'fail'}`} key={c}>
                  {c} {Math.round(v * 100)}%
                </span>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}
