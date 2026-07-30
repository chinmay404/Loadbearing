import { useMemo, useState } from 'react';
import { CONCEPT_CARDS, CONCEPT_GROUPS, DESIGN_CHECKLIST } from '@archdojo/shared';

export function ReferencePanel() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');

  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CONCEPT_CARDS.filter(
      (c) =>
        (group === 'all' || c.group === group) &&
        (needle === '' ||
          c.name.toLowerCase().includes(needle) ||
          c.id.includes(needle) ||
          c.summary.toLowerCase().includes(needle) ||
          c.redFlags.toLowerCase().includes(needle)),
    );
  }, [q, group]);

  return (
    <div className="dash">
      <h1>Design reference</h1>
      <p className="faint" style={{ fontSize: 12.5, marginTop: -8 }}>
        The vocabulary the grader scores against: {CONCEPT_CARDS.length} concepts in {CONCEPT_GROUPS.length}{' '}
        groups. Each card tells you what it is, when to reach for it, what it costs, and how it gets
        misused.
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <h4>The 10 steps a complete answer covers</h4>
        <ol className="list-reset" style={{ fontSize: 12.5, marginTop: 6 }}>
          {DESIGN_CHECKLIST.map((s) => (
            <li key={s.step} style={{ marginBottom: 5 }}>
              <strong>{s.step}</strong> — <span className="muted">{s.detail}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="row wrap" style={{ gap: 5, marginBottom: 12 }}>
        <input placeholder="Search concepts…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <button className={group === 'all' ? 'on' : ''} onClick={() => setGroup('all')}>
          All
        </button>
        {CONCEPT_GROUPS.map((g) => (
          <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>

      <div className="dash-grid">
        {cards.map((c) => (
          <div className="card ref-card" key={c.id}>
            <div className="row">
              <h4 className="grow">{c.name}</h4>
              <span className="chip" style={{ fontSize: 10 }}>
                {c.group}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {c.summary}
            </p>
            <dl>
              <dt>when</dt>
              <dd>{c.when}</dd>
              <dt>trade-off</dt>
              <dd>{c.tradeoffs}</dd>
              <dt>red flag</dt>
              <dd style={{ color: '#fca5a5' }}>{c.redFlags}</dd>
            </dl>
            <div className="mono faint" style={{ fontSize: 10, marginTop: 6 }}>
              {c.id}
            </div>
          </div>
        ))}
      </div>
      {cards.length === 0 && <p className="faint">Nothing matches that search.</p>}
    </div>
  );
}
