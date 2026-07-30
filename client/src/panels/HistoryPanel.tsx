import { useEffect, useState } from 'react';
import { diffGraphs, renderDiffLines } from '@loadbearing/shared';
import type { Attempt } from '@loadbearing/shared';
import { api } from '../lib/api';
import { useApp } from '../state/appStore';

export function HistoryPanel() {
  const problem = useApp((s) => s.problem);
  const score = useApp((s) => s.score);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  useEffect(() => {
    if (!problem) return;
    void api
      .attempts(problem.id)
      .then(setAttempts)
      .catch(() => setAttempts([]));
  }, [problem, score]);

  if (!problem) return null;
  if (attempts.length === 0) {
    return (
      <p className="faint" style={{ fontSize: 12 }}>
        No attempts on this problem yet. Your scores and the design you submitted are kept locally so you
        can compare rounds.
      </p>
    );
  }

  return (
    <div>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        {attempts.length} attempt{attempts.length > 1 ? 's' : ''} on this problem.
      </p>
      {attempts.map((a, i) => (
        <div className="card" key={a.id}>
          <div className="row">
            <span className="grow mono faint" style={{ fontSize: 11 }}>
              {a.createdAt} · round {a.round}
            </span>
            <span className={`chip ${a.overall >= 80 ? 'good' : a.overall >= 60 ? 'warn' : 'bad'}`}>
              {a.overall}
            </span>
          </div>
          {a.twistText && (
            <p className="faint" style={{ fontSize: 11.5, margin: '5px 0 0' }}>
              twist: {a.twistText}
            </p>
          )}
          <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
            <span className="chip">{a.graph.nodes.length} components</span>
            <span className="chip">{a.graph.edges.length} links</span>
            <span className="chip">{a.graph.flows.length} flows</span>
            {a.score.critical_failures.length > 0 && (
              <span className="chip fail">{a.score.critical_failures.length} failures</span>
            )}
          </div>
          {/* attempts arrive newest-first, so the "previous" round is the next row down */}
          {i + 1 < attempts.length &&
            (() => {
              const prev = attempts[i + 1]!;
              const lines = renderDiffLines(diffGraphs(prev.graph, a.graph));
              const delta = a.overall - prev.overall;
              return (
                <details className="disclose">
                  <summary>
                    changed vs round {prev.round} ({delta >= 0 ? '+' : ''}
                    {delta} points)
                  </summary>
                  {lines.length === 0 ? (
                    <p className="faint" style={{ fontSize: 11.5 }}>
                      Identical design — the score moved on grading alone.
                    </p>
                  ) : (
                    <ul className="list-reset mono" style={{ fontSize: 11, marginTop: 4 }}>
                      {lines.map((l, j) => (
                        <li
                          key={j}
                          style={{
                            color: l.startsWith('+')
                              ? 'var(--pass)'
                              : l.startsWith('−') || l.startsWith('-')
                                ? 'var(--fail)'
                                : 'var(--graphite)',
                          }}
                        >
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              );
            })()}
        </div>
      ))}
    </div>
  );
}
