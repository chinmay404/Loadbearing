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

  const [brief, setBrief] = useState('');
  const [scale, setScale] = useState('');
  const [constraints, setConstraints] = useState('');
  const [focus, setFocus] = useState<string[]>([]);
  const [mode, setMode] = useState<'own' | 'exercise'>('exercise');
  const [level, setLevel] = useState(4);
  const [harder, setHarder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<string>(CONCEPT_GROUPS[0]);

  const surprise = async () => {
    try {
      setBusy(true);
      const problem = await api.generateProblem({});
      setProblems(await api.problems());
      openProblem(problem);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

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

  const short = 40 - brief.trim().length;
  const own = mode === 'own';

  return (
    <div className="sheet compose" style={{ maxWidth: 720 }}>
      <h1>New problem</h1>
      <p className="lede">Describe a system. You get a sheet with real numbers, a rubric and load scenarios.</p>

      <div className="filter-row">
        <button className={!own ? 'on' : ''} onClick={() => setMode('exercise')}>
          Training drill
        </button>
        <button className={own ? 'on' : ''} onClick={() => setMode('own')}>
          A system I own
        </button>
      </div>

      <div className="card compose-form">
        <div className="field">
          <label htmlFor="compose-brief">Scenario</label>
          <textarea
            id="compose-brief"
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={
              own
                ? 'What it does, and the part that keeps going wrong — that is usually the real design problem.'
                : 'What the system does, and what hurts about it.'
            }
          />
          <div className="row wrap examples">
            <span className="stencil">try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                className="link-btn"
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

        <div className="field">
          <label htmlFor="compose-scale">
            Scale
          </label>
          <textarea
            id="compose-scale"
            rows={2}
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            placeholder="900 writes/sec at peak, 40M rows, p99 under 250ms, 99.95% availability"
          />
        </div>

        <div className="field">
          <label htmlFor="compose-constraints">
            Constraints
          </label>
          <textarea
            id="compose-constraints"
            rows={2}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="Team of 5, no SRE, $6k/mo, PCI, single region, Postgres + Node"
          />
        </div>

        <div className="row wrap" style={{ gap: 12 }}>
          <span className="stencil">Level</span>
          <div className="filter-row" style={{ marginBottom: 0 }} role="group" aria-label="Difficulty">
            {[1, 2, 3, 4, 5, 6].map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                L{l}
              </button>
            ))}
          </div>
          <label className="row check">
            <input type="checkbox" checked={harder} onChange={(e) => setHarder(e.target.checked)} />
            Force a real trade-off
          </label>
        </div>

        <details className="disclose">
          <summary>Focus concepts{focus.length > 0 ? ` · ${focus.length} chosen` : ''}</summary>
          <div className="filter-row" style={{ margin: '8px 0 6px' }}>
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
                style={{ fontSize: 11.5 }}
              >
                {c.name}
              </button>
            ))}
            {focus.length > 0 && (
              <button className="ghost" onClick={() => setFocus([])}>
                Clear
              </button>
            )}
          </div>
        </details>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={() => void build()} disabled={busy || short > 0}>
          {busy ? <span className="spinner" /> : <IconPlus size={15} />}
          {busy ? 'Building' : 'Build the sheet'}
        </button>
        {brief.trim().length > 0 && short > 0 && (
          <span className="stencil">{short} more characters</span>
        )}
        <span className="grow" />
        <button className="ghost" onClick={() => void surprise()} disabled={busy} title="Generate a problem at random">
          Surprise me
        </button>
      </div>
    </div>
  );
}
