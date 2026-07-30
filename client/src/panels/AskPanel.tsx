import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { useCanvas } from '../state/canvasStore';

const STARTERS = [
  'Where is the single point of failure in what I drew?',
  'Is anything here overengineered for these constraints?',
  'What happens to my write path if the database fails over?',
  'Which component saturates first as traffic grows?',
  'How would you make this idempotent end to end?',
];

interface Msg {
  role: 'me' | 'ai';
  text: string;
}

export function AskPanel() {
  const problem = useApp((s) => s.problem);
  const setError = useApp((s) => s.setError);
  const toGraph = useCanvas((s) => s.toGraph);
  const setMarkup = useCanvas((s) => s.setMarkup);
  const addGhosts = useCanvas((s) => s.addGhosts);
  const [log, setLog] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!problem || !question.trim()) return;
    setQ('');
    setLog((l) => [...l, { role: 'me', text: question }]);
    setBusy(true);
    try {
      const r = await api.critique({ problemId: problem.id, graph: toGraph(), question });
      setLog((l) => [...l, { role: 'ai', text: r.answer }]);
      if (r.canvas_markup.length) setMarkup(r.canvas_markup);
      if (r.suggested_additions.length) addGhosts(r.suggested_additions);
    } catch (e) {
      const err = e as ApiError;
      setLog((l) => [...l, { role: 'ai', text: `⚠ ${err.message}${err.hint ? `\n${err.hint}` : ''}` }]);
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ height: '100%' }}>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        Ask about the diagram you have drawn right now. Answers can pin markers on your components and
        propose ghost nodes you can accept.
      </p>

      {log.length === 0 && (
        <div className="col" style={{ gap: 5 }}>
          {STARTERS.map((s) => (
            <button key={s} style={{ textAlign: 'left', fontSize: 12 }} onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat-log grow" style={{ overflow: 'auto' }}>
        {log.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="msg ai">
            <span className="spinner" /> thinking about your design…
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about your design…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(q);
            }
          }}
        />
        <button className="primary" onClick={() => void ask(q)} disabled={busy || !q.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}
