import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCanvas } from '../state/canvasStore';
import { SLOW_MS, fmtWait, journeysFor, sampleLoad, type Journey, type LoadOutcome, type PageLoad } from './userLoads';

/** How many recent loads the strip under the device remembers. */
const HISTORY = 20;
/** How long a finished page stays up before the next user arrives. */
const LINGER_MS = { ok: 1300, slow: 1500, error: 1900, timeout: 1900 } as const;

const OUTCOME_LABEL: Record<LoadOutcome, string> = {
  ok: 'Loaded',
  slow: 'Slow',
  error: 'Failed',
  timeout: 'Gave up',
};

/**
 * A phone or a browser floating above a client while a run is on, playing one
 * user's page loads after another at the speed — and with the failures — the run
 * reported. See userLoads.ts for how each load is drawn.
 */
export function UserView({ nodeId, device }: { nodeId: string; device: 'phone' | 'browser' }) {
  const result = useCanvas((s) => s.simResult);
  const flows = useCanvas((s) => s.flows);
  const journeys = useMemo(() => journeysFor(nodeId, flows, result), [nodeId, flows, result]);

  // The loop reads the latest numbers without restarting, so dragging the load
  // slider changes what the next user gets rather than wiping the history.
  const latest = useRef<Journey[]>(journeys);
  latest.current = journeys;

  const [load, setLoad] = useState<PageLoad | null>(null);
  const [phase, setPhase] = useState<'loading' | 'done'>('loading');
  const [history, setHistory] = useState<LoadOutcome[]>([]);
  const [count, setCount] = useState(0);
  const has = journeys.length > 0;

  useEffect(() => {
    if (!has) return;
    let timer = 0;
    let turn = 0;
    const next = () => {
      const pool = latest.current;
      if (pool.length === 0) return;
      const l = sampleLoad(pool[turn++ % pool.length]!);
      setLoad(l);
      setCount((c) => c + 1);
      setPhase('loading');
      timer = window.setTimeout(() => {
        setPhase('done');
        setHistory((h) => [...h.slice(-(HISTORY - 1)), l.outcome]);
        timer = window.setTimeout(next, LINGER_MS[l.outcome]);
      }, l.ms);
    };
    timer = window.setTimeout(next, 250);
    return () => window.clearTimeout(timer);
  }, [has]);

  if (!has || !load) return null;
  const outcome = phase === 'done' ? load.outcome : null;
  const counts = {
    ok: history.filter((o) => o === 'ok').length,
    slow: history.filter((o) => o === 'slow').length,
    bad: history.filter((o) => o === 'error' || o === 'timeout').length,
  };
  const slug = load.journey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <div className={`uv uv-${device}`} data-phase={phase} data-outcome={outcome ?? 'loading'} aria-hidden="true">
      <div className="uv-device">
        {device === 'phone' ? (
          <div className="uv-status">
            <span>9:41</span>
            <i />
          </div>
        ) : (
          <div className="uv-chrome">
            <span className="uv-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="uv-url">shop.app/{slug}</span>
          </div>
        )}
        <div className="uv-screen">
          {phase === 'loading' && (
            // Restarted per load by the key, and timed to the load itself.
            <i
              key={count}
              className="uv-progress"
              style={{ ['--uv-ms' as string]: `${load.ms}ms` } as CSSProperties}
            />
          )}
          {phase === 'loading' ? (
            <div className="uv-skeleton">
              <i className="uv-hero" />
              <i />
              <i className="short" />
              {load.ms > SLOW_MS && <span className="uv-spinner" />}
            </div>
          ) : outcome === 'error' ? (
            <div className="uv-message">
              <b className="uv-icon">!</b>
              <span>Something went wrong</span>
              <em>Try again</em>
            </div>
          ) : outcome === 'timeout' ? (
            <div className="uv-message">
              <b className="uv-icon">…</b>
              <span>This is taking too long</span>
              <em>Reload</em>
            </div>
          ) : (
            <div className="uv-page">
              <i className="uv-hero" />
              <span className="uv-tiles">
                <i />
                <i />
              </span>
              <i className="uv-button" />
            </div>
          )}
        </div>
      </div>
      <div className="uv-caption">
        {outcome ? (
          <>
            <b>{OUTCOME_LABEL[outcome]}</b> {outcome === 'error' ? load.journey : `${fmtWait(load.ms)} · ${load.journey}`}
          </>
        ) : (
          <>Loading {load.journey}…</>
        )}
      </div>
      {history.length > 0 && (
        <div className="uv-history" title="The last 20 page loads">
          <span className="uv-dots">
            {history.map((o, i) => (
              <i key={i} data-o={o} />
            ))}
          </span>
          <span className="uv-tally">
            {counts.bad > 0 ? `${counts.bad} of ${history.length} failed` : counts.slow > 0 ? `${counts.slow} of ${history.length} slow` : `${history.length} of ${history.length} fine`}
          </span>
        </div>
      )}
    </div>
  );
}
