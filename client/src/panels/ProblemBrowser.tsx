import { useEffect, useMemo, useState } from 'react';
import type { MasteryEntry, ProblemSummary } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconPlus, IconTarget } from '../ui/UiIcons';

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
  const [kind, setKind] = useState<'all' | 'design' | 'lab'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<{ problemId: string; lastTouchedAt: string; attempts: number }[]>([]);
  const [ownOpen, setOwnOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [queue, setQueue] = useState<{
    due: { concept: string; name: string; ema: number; overdueDays: number }[];
    drillConcepts: string[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [p, m, attempts, rq, act] = await Promise.all([
          api.problems(),
          api.mastery(),
          api.attempts(),
          api.reviewQueue().catch(() => null),
          api.activity().catch(() => ({ recent: [] })),
        ]);
        setProblems(p);
        setMastery(m);
        setQueue(rq);
        setRecent(act.recent);
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

  const shown = problems.filter(
    (p) => (level === 'all' || p.level === level) && (kind === 'all' || (p.kind ?? 'design') === kind),
  );
  const byLevel = [1, 2, 3, 4, 5, 6].map((l) => ({ l, items: shown.filter((p) => p.level === l) }));
  const labCount = problems.filter((p) => p.kind === 'lab').length;

  // The level filter applies here too, so filtering to L4 does not leave an L1 sheet
  // stranded at the top of the page.
  const recentlyWorkedOn = useMemo(() => {
    const byId = new Map(shown.map((p) => [p.id, p]));
    return recent
      .map((r) => ({ problem: byId.get(r.problemId), touched: r.lastTouchedAt }))
      .filter((r): r is { problem: ProblemSummary; touched: string } => Boolean(r.problem))
      .slice(0, 6);
  }, [recent, shown]);

  return (
    <div className="sheet">
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>Problem index</h1>
          <p className="lede">
            Draw the design, declare the flows, run load against it, then have it reviewed. Levels climb
            from single-service fundamentals to multi-region, exactly-once billing and AI systems.
          </p>
        </div>
        <div className="row" style={{ marginBottom: 16 }}>
          <button onClick={() => void generate(true)} disabled={busy === 'gen'} title="Generate a problem aimed at your three weakest concepts">
            {busy === 'gen' ? <span className="spinner" /> : <IconTarget size={15} />} Target my weak spots
          </button>
          <button onClick={() => void generate(false)} disabled={busy === 'gen'}>
            <IconPlus size={15} /> New problem
          </button>
          <button className={ownOpen ? 'on' : ''} onClick={() => setOwnOpen(!ownOpen)} title="Have your own production system reviewed against its real numbers">
            Review my system
          </button>
        </div>
      </div>

      {ownOpen && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h4>Review a system you actually own</h4>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Describe it the way you would to a new teammate: what it does, roughly how much traffic and
            data, and the constraints you are actually under. You will get a sheet with a rubric built
            from your own numbers, then draw it and have it torn apart.
          </p>
          <textarea
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Order service for a marketplace. ~900 writes/sec at peak, 40M orders in Postgres, p99 budget 250ms. Team of 5, no dedicated SRE, must stay PCI-compliant, single AWS region today. Payments go through Stripe; we retry failed charges from a cron."
          />
          <div className="row" style={{ marginTop: 7 }}>
            <button
              className="primary"
              disabled={busy === 'own' || brief.trim().length < 40}
              onClick={() =>
                void (async () => {
                  try {
                    setBusy('own');
                    const p = await api.problemFromBrief({ brief });
                    setProblems(await api.problems());
                    openProblem(p);
                  } catch (e) {
                    const err = e as ApiError;
                    setError({ message: err.message, hint: err.hint });
                  } finally {
                    setBusy(null);
                  }
                })()
              }
            >
              {busy === 'own' ? <span className="spinner" /> : null} Build the sheet
            </button>
            <span className="stencil">{brief.trim().length} characters</span>
          </div>
        </div>
      )}

      {queue && queue.due.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '2px solid var(--load)' }}>
          <div className="row wrap">
            <div className="grow">
              <h4>
                Due for review — {queue.due.length} concept{queue.due.length > 1 ? 's' : ''} going stale
              </h4>
              <div className="row wrap" style={{ gap: 3, marginTop: 6 }}>
                {queue.due.map((d) => (
                  <span
                    className={`chip ${d.ema < 0.4 ? 'fail' : 'load'}`}
                    key={d.concept}
                    title={`${Math.round(d.ema * 100)}% mastery · ${d.overdueDays === 0 ? 'due today' : `${d.overdueDays}d overdue`}`}
                  >
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="primary"
              disabled={busy === 'gen'}
              onClick={() =>
                void (async () => {
                  try {
                    setBusy('gen');
                    const p = await api.generateProblem({ concepts: queue.drillConcepts });
                    setProblems(await api.problems());
                    openProblem(p);
                  } catch (e) {
                    const err = e as ApiError;
                    setError({ message: err.message, hint: err.hint });
                  } finally {
                    setBusy(null);
                  }
                })()
              }
              title={`A ~10 minute drill built around: ${queue.drillConcepts.join(', ')}`}
            >
              {busy === 'gen' ? <span className="spinner" /> : <IconTarget size={15} />} Start today's drill
            </button>
          </div>
        </div>
      )}

      <div className="filter-row">
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>
          All levels
        </button>
        {[1, 2, 3, 4, 5, 6].map((l) => (
          <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
            L{l}
          </button>
        ))}
        {labCount > 0 && (
          <>
            <span className="filter-gap" />
            <button
              className={kind === 'design' ? 'on' : ''}
              onClick={() => setKind(kind === 'design' ? 'all' : 'design')}
              title="Sheets that start blank"
            >
              Blank sheets
            </button>
            <button
              className={kind === 'lab' ? 'on' : ''}
              onClick={() => setKind(kind === 'lab' ? 'all' : 'lab')}
              title="Sheets that start with an architecture already on them, and something wrong in it"
            >
              Labs ({labCount})
            </button>
          </>
        )}
      </div>

      {/* Where you left off, before the catalogue. Sheets you have drawn on come back
          to the top: a half-finished design is the thing you actually want to reopen,
          and hunting for it in six levels is the friction this removes. */}
      {recentlyWorkedOn.length > 0 && (
        <div className="tier">
          <div className="tier-head">
            <span className="lvl recent">•</span>
            <h3>Where you left off</h3>
            <span className="count">{recentlyWorkedOn.length} recent</span>
          </div>
          <div className="index-grid">
            {recentlyWorkedOn.map(({ problem, touched }) => (
              <ProblemCard
                key={`recent-${problem.id}`}
                p={problem}
                best={done[problem.id]}
                weak={problem.concepts.filter((c) => weakSet.has(c)).length}
                busy={busy === problem.id}
                touched={touched}
                onOpen={() => void open(problem.id)}
              />
            ))}
          </div>
        </div>
      )}

      {byLevel.map(({ l, items }) =>
        items.length === 0 ? null : (
          <div className="tier" key={l}>
            <div className="tier-head">
              <span className={`lvl l${l}`}>L{l}</span>
              <h3>{LEVEL_NAME[l]}</h3>
              <span className="count">{items.length} sheets</span>
            </div>
            <div className="index-grid">
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
        <div className="banner info">
          No problems loaded. The server on port 8787 is not answering — check the terminal running
          <span className="mono"> npm run dev</span>.
        </div>
      )}
    </div>
  );
}

/** "3h ago", "yesterday", "12 Mar" — precise enough to recognise, short enough to scan. */
function whenTouched(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function ProblemCard({
  p,
  best,
  weak,
  busy,
  touched,
  onOpen,
}: {
  p: ProblemSummary;
  best?: number;
  weak: number;
  busy: boolean;
  /** Set only in the recent section: when this sheet was last worked on. */
  touched?: string;
  onOpen: () => void;
}) {
  const isLab = p.kind === 'lab';
  return (
    <button
      className={`plate${p.custom ? ' mine' : ''}${isLab ? ' lab' : ''}`}
      onClick={onOpen}
      disabled={busy}
    >
      {best !== undefined && (
        <span
          className={`best ${best >= 80 ? 'hi' : best >= 60 ? 'mid' : 'lo'}`}
          title={`Your best score on this problem: ${best}/100`}
        >
          {best}
        </span>
      )}
      <div className="t" style={{ paddingRight: best !== undefined ? 32 : 0 }}>
        {/* Yours are marked rather than merely labelled: the catalogue and the things
            you wrote yourself are different kinds of thing and should not need reading
            to tell apart. */}
        {p.custom && (
          <span className="mine-tag" title="Your own problem, not from the catalogue">
            yours
          </span>
        )}
        {/* A lab and a blank sheet are different exercises, and which one you are
            about to open should not require reading the title. */}
        {isLab && (
          <span className="lab-tag" title="Starts with an architecture already drawn, and something wrong in it">
            lab
          </span>
        )}
        {isLab ? p.title.replace(/^Lab:\s*/, '') : p.title}
      </div>
      <div className="m">
        {p.domain}
        {touched ? ` · ${whenTouched(touched)}` : ''}
        {weak > 0 ? ` · ${weak} weak concept${weak > 1 ? 's' : ''}` : ''}
      </div>
      <div className="row wrap" style={{ gap: 3, marginTop: 7 }}>
        {p.concepts.slice(0, 5).map((c) => (
          <span className="chip" key={c}>
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}
