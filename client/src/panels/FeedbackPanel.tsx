import { useState } from 'react';
import type { DimensionKey } from '@archdojo/shared';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';
import { api, ApiError } from '../lib/api';

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
  const [exporting, setExporting] = useState(false);

  if (submitting) {
    return (
      <div className="empty-state">
        <div>
          <span className="spinner" style={{ width: 22, height: 22 }} />
          <h3 style={{ marginTop: 12 }}>The reviewer is reading your design…</h3>
          <p style={{ fontSize: 12.5 }}>
            Components, connections, annotations, flows and the capacity model — 10 to 40 seconds.
          </p>
        </div>
      </div>
    );
  }

  if (!score) {
    return (
      <div className="empty-state">
        <div>
          <h3>No review yet</h3>
          <p style={{ fontSize: 12.5, maxWidth: 280 }}>
            Draw your design, declare the flows, run the load simulator to catch the obvious problems
            yourself — then hit <strong>Submit for review</strong>.
          </p>
        </div>
      </div>
    );
  }

  const band = score.overall >= 80 ? 'hi' : score.overall >= 60 ? 'mid' : 'lo';
  const twist = problem?.twists[round - 1] ?? problem?.twists[0];

  const doExport = async () => {
    if (attemptId === null) return;
    try {
      setExporting(true);
      const r = await api.exportAttempt(attemptId);
      setNotice(`Post-mortem written to ${r.path}`);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="overall" style={{ marginBottom: 4 }}>
        <span className={`n ${band}`}>{score.overall}</span>
        <span className="faint">/100 · round {round}</span>
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 0 }}>
        Pins have been drawn on your canvas. Ghost components are suggestions you can accept.
      </p>

      <div className="row wrap" style={{ gap: 5, marginBottom: 12 }}>
        {twist && (
          <button className="primary" onClick={() => { clearAi(); startTwist(twist); }}>
            🌀 Take the twist
          </button>
        )}
        <button onClick={() => void doExport()} disabled={exporting || attemptId === null}>
          {exporting ? <span className="spinner" /> : '↗'} Save to my vault
        </button>
        <button onClick={clearAi} title="Remove the grader's pins and ghost nodes">
          Clear markup
        </button>
      </div>

      {score.dimensions &&
        (Object.keys(DIM_LABEL) as DimensionKey[]).map((k) => {
          const d = score.dimensions[k];
          const pct = (d.score / d.max) * 100;
          const color = pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
          return (
            <div className="dim-row" key={k}>
              <div className="top">
                <span>{DIM_LABEL[k]}</span>
                <span className="mono" style={{ color }}>
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
        <Section title={`What breaks (${score.critical_failures.length})`}>
          {score.critical_failures.map((f, i) => (
            <div className={`card sev-${f.severity}`} key={i}>
              <h4>{f.title}</h4>
              <p className="muted" style={{ fontSize: 12.5 }}>
                {f.detail}
              </p>
              {f.concept && <span className="chip bad">{f.concept}</span>}
            </div>
          ))}
        </Section>
      )}

      {score.spofs.length > 0 && (
        <Section title="Single points of failure">
          <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
            {score.spofs.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {score.missing.length > 0 && (
        <Section title="Missing">
          <ul className="list-reset muted" style={{ fontSize: 12.5 }}>
            {score.missing.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {score.flow_reviews.length > 0 && (
        <Section title="Flow review">
          {score.flow_reviews.map((f, i) => (
            <div className="card" key={i}>
              <div className="row">
                <span className="grow">
                  <strong style={{ fontSize: 12.5 }}>{f.flowName}</strong>
                </span>
                <span className={`chip ${f.verdict === 'sound' ? 'good' : f.verdict === 'missing' ? 'bad' : 'warn'}`}>
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
        </Section>
      )}

      {score.good_calls.length > 0 && (
        <Section title="Good calls">
          {score.good_calls.map((g, i) => (
            <div className="card ok-card" key={i}>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {g}
              </p>
            </div>
          ))}
        </Section>
      )}

      {score.socratic_questions.length > 0 && (
        <Section title="Answer these before you look at the model answer">
          <ol className="list-reset" style={{ fontSize: 12.5 }}>
            {score.socratic_questions.map((q, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {q}
              </li>
            ))}
          </ol>
          <p className="faint" style={{ fontSize: 11.5 }}>
            Use the Ask tab to work through them against your own diagram.
          </p>
        </Section>
      )}

      {score.verdict_teaching.length > 0 && (
        <details className="disclose">
          <summary>Why each component belongs ({score.verdict_teaching.length})</summary>
          {score.verdict_teaching.map((t, i) => (
            <div className="card" key={i}>
              <h4>{t.component}</h4>
              <dl style={{ margin: 0, fontSize: 12 }}>
                <dt className="faint">why</dt>
                <dd className="muted" style={{ margin: '0 0 4px' }}>
                  {t.why}
                </dd>
                <dt className="faint">breaks without it</dt>
                <dd className="muted" style={{ margin: '0 0 4px' }}>
                  {t.breaks_without}
                </dd>
                <dt className="faint">rejected alternative</dt>
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
          <summary>Peek at how a strong engineer would solve it</summary>
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
          <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
            {Object.entries(score.concept_scores)
              .sort((a, b) => a[1] - b[1])
              .map(([c, v]) => (
                <span className={`chip ${v >= 0.75 ? 'good' : v >= 0.45 ? 'warn' : 'bad'}`} key={c}>
                  {c} {Math.round(v * 100)}%
                </span>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-faint)', margin: '0 0 6px' }}>
        {title}
      </h4>
      {children}
    </div>
  );
}
