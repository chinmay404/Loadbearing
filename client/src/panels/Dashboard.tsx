import { useEffect, useState } from 'react';
import { CONCEPT_GROUPS, type MasteryEntry, type Stats } from '@loadbearing/shared';
import { api } from '../lib/api';

export function Dashboard() {
  const [mastery, setMastery] = useState<MasteryEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    void api.mastery().then(setMastery).catch(() => setMastery([]));
    void api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  const groupAvg = CONCEPT_GROUPS.map((g) => {
    const seen = mastery.filter((m) => m.group === g && m.ema !== null);
    return {
      group: g,
      value: seen.length ? seen.reduce((s, m) => s + (m.ema ?? 0), 0) / seen.length : null,
      covered: seen.length,
      total: mastery.filter((m) => m.group === g).length,
    };
  });

  const practised = mastery.filter((m) => m.ema !== null);
  const weakest = [...practised].sort((a, b) => (a.ema ?? 0) - (b.ema ?? 0)).slice(0, 6);
  const strongest = [...practised].sort((a, b) => (b.ema ?? 0) - (a.ema ?? 0)).slice(0, 6);

  return (
    <div className="sheet">
      <h1>Progress</h1>

      <div className="index-grid" style={{ marginBottom: 14 }}>
        <Tile label="Designs reviewed" value={stats ? String(stats.attempts) : '–'} />
        <Tile label="Average score" value={stats?.avgOverall !== null && stats ? `${stats.avgOverall}` : '–'} />
        <Tile label="Day streak" value={stats ? String(stats.streakDays) : '–'} />
        <Tile
          label="Concepts practised"
          value={`${practised.length}/${mastery.length}`}
        />
      </div>

      <div className="index-grid">
        <div className="card">
          <h4>Mastery by area</h4>
          <Radar data={groupAvg} />
        </div>

        <div className="card">
          <h4>Score trend</h4>
          {stats && stats.trend.length > 1 ? (
            <Trend points={stats.trend.map((t) => t.overall)} />
          ) : (
            <p className="faint" style={{ fontSize: 12 }}>
              Submit a couple of designs and the trend appears here.
            </p>
          )}
        </div>

        <div className="card">
          <h4>Weakest concepts</h4>
          {weakest.length === 0 && <p className="faint" style={{ fontSize: 12 }}>Nothing practised yet.</p>}
          {weakest.map((m) => (
            <Row key={m.concept} m={m} />
          ))}
        </div>

        <div className="card">
          <h4>Strongest concepts</h4>
          {strongest.length === 0 && <p className="faint" style={{ fontSize: 12 }}>Nothing practised yet.</p>}
          {strongest.map((m) => (
            <Row key={m.concept} m={m} />
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h4>All concepts</h4>
        <p className="faint" style={{ fontSize: 11.5 }}>
          Brighter = stronger. Hollow = never assessed. Hover for the score.
        </p>
        <div className="heat">
          {mastery.map((m) => (
            <i
              key={m.concept}
              title={`${m.name} — ${m.ema === null ? 'not practised' : `${Math.round(m.ema * 100)}% over ${m.attempts} assessment${m.attempts > 1 ? 's' : ''}`}`}
              style={
                m.ema === null
                  ? {}
                  : {
                      background: `color-mix(in srgb, var(--pass) ${Math.round(m.ema * 100)}%, #2a1616)`,
                      borderColor: 'transparent',
                    }
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="v">{value}</div>
      <div className="faint" style={{ fontSize: 11.5 }}>
        {label}
      </div>
    </div>
  );
}

function Row({ m }: { m: MasteryEntry }) {
  const pct = Math.round((m.ema ?? 0) * 100);
  const color = pct >= 75 ? 'var(--pass)' : pct >= 45 ? 'var(--load)' : 'var(--fail)';
  return (
    <div style={{ marginBottom: 7 }}>
      <div className="row" style={{ fontSize: 12 }}>
        <span className="grow">{m.name}</span>
        <span className="mono" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Radar({ data }: { data: { group: string; value: number | null; covered: number; total: number }[] }) {
  const size = 250;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const n = data.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, v: number): [number, number] => [
    cx + Math.cos(angle(i)) * r * v,
    cy + Math.sin(angle(i)) * r * v,
  ];

  const poly = data.map((d, i) => pt(i, d.value ?? 0)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 300 }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          points={data.map((_, i) => pt(i, f)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
          fill="none"
          stroke="#322e29"
        />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#322e29" />;
      })}
      <polygon points={poly} fill="rgb(207 163 73 / 0.18)" stroke="#cfa349" strokeWidth={1.5} />
      {data.map((d, i) => {
        const [x, y] = pt(i, 1.19);
        return (
          <text
            key={d.group}
            x={x}
            y={y}
            fontSize={7.5}
            fill={d.value === null ? '#6b7488' : '#a09a90'}
            textAnchor={x < cx - 8 ? 'end' : x > cx + 8 ? 'start' : 'middle'}
            dominantBaseline="middle"
          >
            {d.group}
          </text>
        );
      })}
    </svg>
  );
}

function Trend({ points }: { points: number[] }) {
  const w = 300;
  const h = 90;
  const max = 100;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }}>
      <line x1={0} y1={h - (80 / max) * h} x2={w} y2={h - (80 / max) * h} stroke="#4a6b34" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke="#cfa349" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={i} cx={i * step} cy={h - (p / max) * h} r={2.5} fill="#cfa349" />
      ))}
    </svg>
  );
}
