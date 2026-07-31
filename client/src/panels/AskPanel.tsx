import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../state/appStore';
import { useCanvas, type ArchNodeData } from '../state/canvasStore';

const STARTERS = [
  'Where is the single point of failure in what I drew?',
  'Is anything here overengineered for these constraints?',
  'What happens to my write path if the database fails over?',
  'Which component saturates first as traffic grows?',
  'How would you make this idempotent end to end?',
];

export function AskPanel() {
  const problem = useApp((s) => s.problem);
  const setError = useApp((s) => s.setError);
  const log = useApp((s) => s.chat);
  const chatFor = useApp((s) => s.chatFor);
  const setChat = useApp((s) => s.setChat);
  const appendChat = useApp((s) => s.appendChat);
  const toGraph = useCanvas((s) => s.toGraph);
  const setMarkup = useCanvas((s) => s.setMarkup);
  const addGhosts = useCanvas((s) => s.addGhosts);
  // Selecting components on the canvas points the coach at them.
  const selectedNodes = useCanvas((s) => s.nodes).filter(
    (n) => n.selected && n.type === 'arch' && !(n.data as ArchNodeData).ghost,
  );
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Fetch the thread once per sheet. The panel unmounts whenever the rail changes
  // tab, so this has to be cheap and idempotent: `chatFor` already matching means
  // the conversation in the store belongs to this sheet and is left alone.
  const problemId = problem?.id ?? null;
  useEffect(() => {
    if (!problemId || chatFor === problemId) return;
    let live = true;
    void (async () => {
      try {
        const { turns } = await api.loadChat(problemId);
        if (live) setChat(problemId, turns);
      } catch {
        // An unreachable server should not wipe the panel; start it empty.
        if (live) setChat(problemId, []);
      }
    })();
    return () => {
      live = false;
    };
  }, [problemId, chatFor, setChat]);

  // Land on the newest turn, whether it just arrived or the thread was restored.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [log.length, busy]);

  const ask = async (question: string) => {
    if (!problem || !question.trim()) return;
    const selectedNodeIds = selectedNodes.map((n) => n.id);
    const selectedLabels = selectedNodes.map((n) => (n.data as ArchNodeData).label);
    setQ('');
    appendChat({
      role: 'me',
      text: selectedLabels.length ? `[about ${selectedLabels.join(', ')}] ${question}` : question,
    });
    setBusy(true);
    try {
      const r = await api.critique({
        problemId: problem.id,
        graph: toGraph(),
        question,
        ...(selectedNodeIds.length ? { selectedNodeIds } : {}),
      });
      // The server returns the thread it stored, so the panel shows exactly what
      // the next question will be answered against — including turns trimmed off
      // the top of a long conversation.
      if (r.turns) setChat(problem.id, r.turns);
      else appendChat({ role: 'ai', text: r.answer });
      if (r.canvas_markup.length) setMarkup(r.canvas_markup);
      if (r.suggested_additions.length) addGhosts(r.suggested_additions);
    } catch (e) {
      const err = e as ApiError;
      // Shown, not stored: a failure is not part of the conversation, and the
      // server only records a turn once it has an answer to record with it.
      appendChat({ role: 'ai', text: `⚠ ${err.message}${err.hint ? `\n${err.hint}` : ''}` });
      setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    if (!problem) return;
    setChat(problem.id, []);
    try {
      await api.clearChat(problem.id);
    } catch {
      // The panel is already clear; the stored copy will be replaced on the next
      // answer regardless.
    }
  };

  return (
    <div className="col" style={{ height: '100%' }}>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        A coach, not an answer machine: it sharpens your thinking about what you drew, and only proposes
        a component when you explicitly ask what to add. Select components on the canvas to ask about
        them specifically.
      </p>

      {selectedNodes.length > 0 && (
        <div className="row wrap" style={{ gap: 3, marginBottom: 8 }}>
          <span className="stencil">asking about</span>
          {selectedNodes.map((n) => (
            <span className="chip spec" key={n.id}>
              {(n.data as ArchNodeData).label}
            </span>
          ))}
        </div>
      )}

      {log.length === 0 && (
        <div className="col" style={{ gap: 5 }}>
          {STARTERS.map((s) => (
            <button key={s} style={{ textAlign: 'left', fontSize: 12 }} onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span className="stencil">
            {log.filter((m) => m.role === 'me').length} question
            {log.filter((m) => m.role === 'me').length === 1 ? '' : 's'} on this sheet
          </span>
          <button style={{ fontSize: 11 }} onClick={() => void startOver()} disabled={busy}>
            Start over
          </button>
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
        <div ref={bottom} />
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
