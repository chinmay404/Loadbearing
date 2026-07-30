import { useEffect, useMemo, useState } from 'react';
import type { MasteryEntry, ProblemSummary } from '@archdojo/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';

const LEVEL_NAME: Record<number, string> = {
  1: 'Fundamentals',
  2: 'Scaling basics',
  3: 'Reliability & correctness',
  4: 'Data-intensive',
  5: 'Distributed hard mode',
  6: 'AI systems',
};

export function ProblemBrowser() {
  const problems = useApp((s) => s.problems);
  const setProblems = useApp((s) => s.setProblems);
  const openProblem = useApp((s) => s.openProblem);
  const setError = useApp((s) => s.setError);
  const [mastery, setMastery] = useState<MasteryEntry[]>([]);
  const [level, setLevel] = useState<number | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      try {
        const [p, m, attempts] = await Promise.all([api.problems(), api.mastery(), api.attempts()]);
        setProblems(p);
        setMastery(m);
        const best: Record<string, number> = {};
        for (const a of attempts) best[a.problemId] = Math.max(best[a.problemId] ?? 0, a.overall);
        setDone(best);
      } catch (e) {
        const err = e as ApiError;
        setError({ message: err.message, hint: err.hint });
      }
    })();
  }, [setProblems, setError]);

  const weakSet = useMemo(() => {
    const seen = mastery
      .filter((m) => m.ema !== null)
      .sort((a, b) => (a.ema ?? 0) - (b.ema ?? 0))
      .slice(0, 8)
      .map((m) => m.concept);
    return new Set(seen);
  }, [mastery]);

  const open = async (id: string) => {
    try {
      setBusy(id);
      openProblem(await api.problem(id));
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(null);
    }
  };

  const generate = async (targeted: boolean) => {
    try {
      setBusy('gen');
      const body = targeted ? await api.weaknessTarget() : {};
      const p = await api.generateProblem(body);
      setProblems(await api.problems());
      openProblem(p);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(null);
    }
  };

  const shown = problems.filter((p) => level === 'all' || p.level === level);
  const byLevel = [1, 2, 3, 4, 5, 6].map((l) => ({ l, items: shown.filter((p) => p.level === l) }));

  return (
    <div className="dash">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="grow">
          <h1 style={{ margin: 0 }}>Choose a problem</h1>
          <p className="faint" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
            Draw the design, declare the flows, run load against it, then get graded. Levels climb from
            single-service fundamentals to multi-region and AI systems.
          </p>
        </div>
        <button onClick={() => void generate(true)} disabled={busy === 'gen'}>
          {busy === 'gen' ? <span className="spinner" /> : '🎯'} Train my weakness
        </button>
        <button onClick={() => void generate(false)} disabled={busy === 'gen'}>
          + Generate problem
        </button>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 4 }}>
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>
          All
        </button>
        {[1, 2, 3, 4, 5, 6].map((l) => (
          <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
            L{l}
          </button>
        ))}
      </div>

      {byLevel.map(({ l, items }) =>
        items.length === 0 ? null : (
          <div key={l} style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--fg-dim)' }}>
              <span className={`lvl l${l}`}>L{l}</span> {LEVEL_NAME[l]}
            </h3>
            <div className="dash-grid">
              {items.map((p) => (
                <ProblemCard
                  key={p.id}
                  p={p}
                  best={done[p.id]}
                  weak={p.concepts.filter((c) => weakSet.has(c)).length}
                  busy={busy === p.id}
                  onOpen={() => void open(p.id)}
                />
              ))}
            </div>
          </div>
        ),
      )}
      {problems.length === 0 && (
        <div className="banner info">Loading the problem bank… if this persists, the server is not running.</div>
      )}
    </div>
  );
}

function ProblemCard({
  p,
  best,
  weak,
  busy,
  onOpen,
}: {
  p: ProblemSummary;
  best?: number;
  weak: number;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="plist-item" onClick={onOpen} disabled={busy} style={{ padding: 12 }}>
      <div className="t">
        <span className={`lvl l${p.level}`}>L{p.level}</span>
        <span className="grow">{p.title}</span>
        {best !== undefined && (
          <span className={`chip ${best >= 80 ? 'good' : best >= 60 ? 'warn' : 'bad'}`}>{best}</span>
        )}
      </div>
      <div className="m">
        {p.domain}
        {p.custom ? ' · generated' : ''}
        {weak > 0 ? ` · hits ${weak} weak concept${weak > 1 ? 's' : ''}` : ''}
      </div>
      <div className="row wrap" style={{ gap: 3, marginTop: 6 }}>
        {p.concepts.slice(0, 5).map((c) => (
          <span className="chip" key={c} style={{ fontSize: 10 }}>
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}
