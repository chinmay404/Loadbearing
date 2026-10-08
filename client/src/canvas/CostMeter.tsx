import { useEffect, useMemo, useRef, useState } from 'react';
import { simulate, type CostReport } from '@loadbearing/shared';
import { useCanvas } from '../state/canvasStore';
import { IconPlay } from '../ui/UiIcons';

/**
 * The bill, always in the corner.
 *
 * Budget is the tension in every exercise, so it cannot live only inside a run you
 * have to remember to start. Before a run this prices the drawing at the current
 * load (the same local engine, quietly); during one it shows the run's own bill.
 * Adding or removing a part moves the number, and the change is called out for a
 * moment so you can see what that decision cost.
 */
export function CanvasCorner() {
  const running = useCanvas((s) => s.simRunning);
  const setRunning = useCanvas((s) => s.setSimRunning);
  const hasParts = useCanvas((s) => s.nodes.some((n) => n.type === 'arch'));

  return (
    <div className="canvas-corner">
      {!running && (
        <button
          className="corner-run"
          onClick={() => setRunning(true)}
          disabled={!hasParts}
          title={hasParts ? 'Push traffic from the entry points through the connections you drew' : 'Draw something first'}
        >
          <IconPlay size={13} /> Run load
        </button>
      )}
      <CostMeter />
    </div>
  );
}

function CostMeter() {
  const running = useCanvas((s) => s.simRunning);
  const result = useCanvas((s) => s.simResult);
  const config = useCanvas((s) => s.simConfig);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const flows = useCanvas((s) => s.flows);
  const toGraph = useCanvas((s) => s.toGraph);
  const [standing, setStanding] = useState<CostReport | null>(null);

  // Off-run pricing, debounced so dragging a part does not re-run the engine per frame.
  useEffect(() => {
    if (running) return;
    const t = window.setTimeout(() => {
      try {
        setStanding(simulate(toGraph(), config).cost);
      } catch {
        setStanding(null);
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [running, nodes, edges, flows, config, toGraph]);

  const cost = running ? (result?.cost ?? null) : standing;
  const total = Math.round(cost?.totalUsd ?? 0);
  const shown = useTween(total);
  const delta = useDelta(total);

  const lines = useMemo(
    () =>
      (cost?.lines ?? [])
        .filter((l) => l.totalUsd >= 0.5)
        .sort((a, b) => b.totalUsd - a.totalUsd)
        .slice(0, 7),
    [cost],
  );
  const top = lines[0]?.totalUsd ?? 1;

  return (
    <div className="cost-meter" tabIndex={0} aria-label={`Estimated cost ${total} dollars a month`}>
      <span className="cm-label">cost</span>
      <span className="cm-value">
        ${shown.toLocaleString('en-US')}
        <small>/mo</small>
      </span>
      {delta && (
        <span key={delta.key} className={`cm-delta ${delta.usd > 0 ? 'up' : 'down'}`} aria-hidden="true">
          {delta.usd > 0 ? '+' : '−'}${Math.abs(delta.usd).toLocaleString('en-US')}
        </span>
      )}

      <div className="cm-card" role="tooltip">
        <div className="cm-split">
          <span>
            <b>${Math.round(cost?.fixedUsd ?? 0).toLocaleString('en-US')}</b> to run
          </span>
          <span>
            <b>${Math.round(cost?.usageUsd ?? 0).toLocaleString('en-US')}</b> for traffic at ×{config.rpsMultiplier}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="cm-empty">Nothing on the sheet costs anything yet.</p>
        ) : (
          <ul className="cm-lines">
            {lines.map((l) => (
              <li key={l.nodeId} title={l.basis}>
                <span className="cm-name">{l.label}</span>
                <span className="cm-amt">${Math.round(l.totalUsd).toLocaleString('en-US')}</span>
                <i style={{ ['--w' as string]: String(l.totalUsd / top) }} />
              </li>
            ))}
          </ul>
        )}
        <p className="cm-foot">{running ? 'From this run.' : 'Priced at the current load, without running it.'}</p>
      </div>
    </div>
  );
}

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count to the new number rather than jump, so a change reads as a change. */
function useTween(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || reduceMotion()) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 420);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

/** The last change worth mentioning, keyed so each one replays its animation. */
function useDelta(total: number): { usd: number; key: number } | null {
  const prev = useRef<number | null>(null);
  const [delta, setDelta] = useState<{ usd: number; key: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = total;
    if (before === null || Math.abs(total - before) < 1) return;
    setDelta((d) => ({ usd: total - before, key: (d?.key ?? 0) + 1 }));
    const t = window.setTimeout(() => setDelta(null), 1800);
    return () => window.clearTimeout(t);
  }, [total]);
  return delta;
}
