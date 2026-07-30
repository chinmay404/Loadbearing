import { useState } from 'react';
import { CONCEPT_CARDS, CONCEPT_GROUPS } from '@loadbearing/shared';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { IconPlus } from '../ui/UiIcons';

const EXAMPLES: { label: string; brief: string; scale: string; constraints: string }[] = [
  {
    label: 'Marketplace orders',
    brief:
      'Order service for a marketplace. Buyers place orders, we reserve stock, charge the card through Stripe, then notify the seller. Sellers complain that occasionally an order is charged twice, and during sales we oversell items.',
    scale: '900 writes/sec at peak, 40M orders in Postgres, p99 budget 250ms, 99.95% availability',
    constraints: 'Team of 5, no dedicated SRE, must stay PCI-compliant, single AWS region today, $6k/mo cloud budget',
  },
  {
    label: 'Support-ticket RAG',
    brief:
      'An assistant that answers customer questions from our support docs and past tickets. Agents say it invents policies that do not exist and is slow when the knowledge base is updated.',
    scale: '2M documents, 30 questions/sec at peak, answers must arrive in under 4s, docs change hourly',
    constraints: 'Team of 3, $2k/mo including model spend, customer data cannot leave our cloud region',
  },
  {
    label: 'Live match feed',
    brief:
      'Realtime score and commentary feed for a sports app. Everyone watching the same match must see an update within a second of it happening, and traffic goes from nothing to enormous the moment a big match starts.',
    scale: '400k concurrent viewers at kickoff, 20 updates/sec per match, 12 matches at once',
    constraints: 'Team of 6, mobile clients on poor networks, $10k/mo, must degrade rather than fail',
  },
];

export function ComposePanel() {
  const openProblem = useApp((s) => s.openProblem);
  const setProblems = useApp((s) => s.setProblems);
  const setError = useApp((s) => s.setError);
  const setView = useApp((s) => s.setView);

  const [brief, setBrief] = useState('');
  const [scale, setScale] = useState('');
  const [constraints, setConstraints] = useState('');
  const [focus, setFocus] = useState<string[]>([]);
  const [mode, setMode] = useState<'own' | 'exercise'>('exercise');
  const [level, setLevel] = useState(4);
  const [harder, setHarder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<string>(CONCEPT_GROUPS[0]);

  const toggle = (id: string) =>
    setFocus((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const build = async () => {
    try {
      setBusy(true);
      const problem = await api.problemFromBrief({
        brief,
        scale,
        constraints,
        focus,
        level,
        mode,
        harder,
      });
      setProblems(await api.problems());
      openProblem(problem);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <h1>Compose a sheet</h1>
      <p className="lede">
        Describe a scenario and the constraints you are actually under. You get back a problem sheet with
        real numbers, a rubric, twists and load scenarios — then you draw it and have it reviewed. Use it
        for a system you own, or to invent a drill on a topic you want to practise.
      </p>

      <div className="filter-row">
        <button className={mode === 'exercise' ? 'on' : ''} onClick={() => setMode('exercise')}>
          Training drill
        </button>
        <button className={mode === 'own' ? 'on' : ''} onClick={() => setMode('own')}>
          A system I own
        </button>
      </div>

      <div className="card">
        <label>Scenario — what the system does, and what hurts about it</label>
        <textarea
          rows={5}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Describe it the way you would to a new teammate. Include the part that keeps going wrong — that is usually the real design problem."
        />
        <div className="row wrap" style={{ gap: 4, marginTop: 7 }}>
          <span className="stencil">start from an example</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => {
                setBrief(ex.brief);
                setScale(ex.scale);
                setConstraints(ex.constraints);
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <label>Scale and traffic — any numbers you know</label>
        <textarea
          rows={2}
          value={scale}
          onChange={(e) => setScale(e.target.value)}
          placeholder="900 writes/sec at peak, 40M rows, p99 under 250ms, 99.95% availability"
        />
        <p className="stencil" style={{ marginTop: 4 }}>
          numbers you give are kept exactly; anything missing is inferred conservatively
        </p>
      </div>

      <div className="card">
        <label>Hard constraints — these decide what counts as overengineering</label>
        <textarea
          rows={2}
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="Team of 5, no SRE, $6k/mo, PCI, single region, existing stack is Postgres + Node"
        />
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <label>Concepts the answer must demonstrate (optional)</label>
            <div className="filter-row" style={{ marginBottom: 6 }}>
              {CONCEPT_GROUPS.map((g) => (
                <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className="row wrap" style={{ gap: 3 }}>
              {CONCEPT_CARDS.filter((c) => c.group === group).map((c) => (
                <button
                  key={c.id}
                  className={focus.includes(c.id) ? 'on' : ''}
                  title={`${c.summary}\n\nRed flag: ${c.redFlags}`}
                  onClick={() => toggle(c.id)}
                  style={{ fontSize: 11 }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        {focus.length > 0 && (
          <div className="row wrap" style={{ gap: 3, marginTop: 8 }}>
            <span className="stencil">chosen</span>
            {focus.map((f) => (
              <span className="chip spec" key={f}>
                {f}
              </span>
            ))}
            <button className="ghost" onClick={() => setFocus([])}>
              clear
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row wrap">
          <div>
            <label>Difficulty</label>
            <div className="filter-row" style={{ marginBottom: 0 }}>
              {[1, 2, 3, 4, 5, 6].map((l) => (
                <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                  L{l}
                </button>
              ))}
            </div>
          </div>
          <span className="grow" />
          <label className="row" style={{ textTransform: 'none', margin: 0, gap: 6 }}>
            <input
              type="checkbox"
              checked={harder}
              onChange={(e) => setHarder(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 12, color: 'var(--graphite)' }}>
              Add a constraint that forces a real trade-off
            </span>
          </label>
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={() => void build()} disabled={busy || brief.trim().length < 40}>
          {busy ? <span className="spinner" /> : <IconPlus size={15} />}
          {busy ? 'Composing the sheet' : 'Build the sheet'}
        </button>
        <button className="ghost" onClick={() => setView('problems')}>
          Back to the index
        </button>
        <span className="grow" />
        <span className="stencil">{brief.trim().length} characters · minimum 40</span>
      </div>
    </div>
  );
}
