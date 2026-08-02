import { useMemo, useState } from 'react';
import { CONCEPT_CARDS, CONCEPT_GROUPS, DESIGN_CHECKLIST, PLAYBOOK } from '@loadbearing/shared';
import { PrimerTab } from './PrimerTab';

export function ReferencePanel() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [tab, setTab] = useState<'concepts' | 'playbook' | 'primer'>('concepts');

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

  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PLAYBOOK;
    return PLAYBOOK.filter((e) =>
      [e.id, e.title, e.rule, e.failure, e.source, e.numbers ?? '', ...e.concepts, ...e.triggers]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [q]);

  return (
    <div className="sheet">
      <h1>Design reference</h1>
      <p className="faint" style={{ fontSize: 12.5, marginTop: -8 }}>
        Two layers. The <em>vocabulary</em> is what the grader scores against: {CONCEPT_CARDS.length} concepts
        in {CONCEPT_GROUPS.length} groups. The <em>playbook</em> is what it reasons from: {PLAYBOOK.length}{' '}
        entries of documented practice, retrieved per problem and cited in the review, so a finding can be
        traced back to a source instead of being taken on trust.
      </p>

      <div className="filter-row">
        <button className={tab === 'concepts' ? 'on' : ''} onClick={() => setTab('concepts')}>
          Vocabulary · {CONCEPT_CARDS.length}
        </button>
        <button className={tab === 'playbook' ? 'on' : ''} onClick={() => setTab('playbook')}>
          Playbook · {PLAYBOOK.length}
        </button>
        <button className={tab === 'primer' ? 'on' : ''} onClick={() => setTab('primer')} title="The System Design Primer by Donne Martin, vendored so it works offline">
          The Primer
        </button>
      </div>

      {tab === 'playbook' && (
        <>
          <div className="row wrap" style={{ gap: 5, margin: '10px 0 12px' }}>
            <input
              placeholder="Search the playbook…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 300 }}
            />
          </div>
          <div className="index-grid">
            {entries.map((e) => (
              <div className="card ref-card" key={e.id}>
                <div className="row">
                  <h4 className="grow">{e.title}</h4>
                  <span className="chip" style={{ fontSize: 10 }}>
                    {e.sourceKind}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  {e.rule}
                </p>
                <dl>
                  {e.numbers ? (
                    <>
                      <dt>numbers</dt>
                      <dd>{e.numbers}</dd>
                    </>
                  ) : null}
                  <dt>without it</dt>
                  <dd style={{ color: '#fca5a5' }}>{e.failure}</dd>
                  <dt>source</dt>
                  <dd>{e.source}</dd>
                </dl>
                <div className="row wrap" style={{ gap: 3, marginTop: 5 }}>
                  {e.concepts.map((c) => (
                    <span className="chip" key={c} style={{ fontSize: 10 }}>
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mono faint" style={{ fontSize: 10, marginTop: 6 }}>
                  {e.id}
                </div>
              </div>
            ))}
          </div>
          {entries.length === 0 && <p className="faint">Nothing matches that search.</p>}
        </>
      )}

      {tab === 'primer' && <PrimerTab />}

      {tab === 'concepts' && (
        <ConceptsTab q={q} setQ={setQ} group={group} setGroup={setGroup} cards={cards} />
      )}
    </div>
  );
}

function ConceptsTab({
  q,
  setQ,
  group,
  setGroup,
  cards,
}: {
  q: string;
  setQ: (v: string) => void;
  group: string;
  setGroup: (v: string) => void;
  cards: typeof CONCEPT_CARDS;
}) {
  return (
    <div>
      <div className="card" style={{ marginTop: 12, marginBottom: 14 }}>
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

      <div className="index-grid">
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
