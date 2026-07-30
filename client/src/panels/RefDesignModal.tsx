// The model answer as a drawing, not a paragraph. After a review the learner
// can open ONE strong reference design for the problem, rendered as a static
// diagram, and watch it carry the same load their own design just took.
//
// Deliberately decoupled from the canvas: no React Flow, no store — the
// reference is something you read, not something you edit.
import { useEffect, useMemo, useState } from 'react';
import { simulate } from '@loadbearing/shared';
import type { GraphDSL, GraphNode, Problem, SimResult } from '@loadbearing/shared';
import { NODE_SPEC } from '../canvas/nodeCatalog';
import { NODE_ICONS } from '../canvas/icons';

const COL_W = 250;
const ROW_H = 150;
const NODE_W = 210;
const MARGIN = 40;
/** Vertical offset from a card's top to where its edges attach. */
const ANCHOR_Y = 44;

const EDGE_STROKE: Record<'sync' | 'async' | 'replication', { color: string; dash?: string }> = {
  sync: { color: '#9c968b' },
  async: { color: '#7ba75f', dash: '6 4' },
  replication: { color: '#b07ca8', dash: '2 4' },
};

interface Layout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Columns by BFS depth from the sources (in-degree 0, or a flow's first step),
 * rows in graph order within a column. Nodes with no edges park in a final
 * column so they never overlap the request path.
 */
function layoutGraph(graph: GraphDSL): Layout {
  const ids = graph.nodes.map((n) => n.id);
  const out = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  const hasEdge = new Set<string>();
  for (const id of ids) {
    out.set(id, []);
    inDeg.set(id, 0);
  }
  for (const e of graph.edges) {
    if (!out.has(e.from) || !inDeg.has(e.to)) continue;
    out.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    hasEdge.add(e.from);
    hasEdge.add(e.to);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];
  const seed = (id: string) => {
    if (!depth.has(id)) {
      depth.set(id, 0);
      queue.push(id);
    }
  };
  for (const id of ids) if (hasEdge.has(id) && (inDeg.get(id) ?? 0) === 0) seed(id);
  for (const f of graph.flows) {
    const first = f.steps[0];
    if (first !== undefined && out.has(first)) seed(first);
  }
  if (queue.length === 0 && ids[0] !== undefined) seed(ids[0]);

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const d = depth.get(id) ?? 0;
    for (const next of out.get(id) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
  }

  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const lastCol = maxDepth + 1;
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    // Unreached but wired (a cycle off the request path) reads best up front;
    // truly disconnected nodes go to the final column.
    const col = depth.get(id) ?? (hasEdge.has(id) ? 0 : lastCol);
    const list = columns.get(col) ?? [];
    list.push(id);
    columns.set(col, list);
  }

  const pos = new Map<string, { x: number; y: number }>();
  let maxCol = 0;
  let maxRows = 1;
  for (const [col, list] of columns) {
    maxCol = Math.max(maxCol, col);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((id, row) => {
      pos.set(id, { x: MARGIN + col * COL_W, y: MARGIN + row * ROW_H });
    });
  }

  return {
    pos,
    width: MARGIN + maxCol * COL_W + NODE_W + MARGIN,
    height: MARGIN + (maxRows - 1) * ROW_H + ROW_H,
  };
}

function RefNode({ node, state }: { node: GraphNode; state?: string }) {
  const spec = NODE_SPEC[node.type];
  const Icon = NODE_ICONS[node.type];
  const topColor =
    state === 'saturated' || state === 'down'
      ? 'var(--fail)'
      : state === 'warn'
        ? 'var(--load)'
        : spec.color;
  const chips: string[] = [];
  if (typeof node.attrs?.replicas === 'number') chips.push(`×${node.attrs.replicas}`);
  if (typeof node.attrs?.capacityRps === 'number') chips.push(`${node.attrs.capacityRps} rps`);
  return (
    <div
      style={{
        width: NODE_W,
        background: '#1c1a17',
        border: '1px solid var(--rule)',
        borderTop: `2px solid ${topColor}`,
        borderRadius: 'var(--r)',
        padding: '6px 8px',
        fontSize: 11.5,
      }}
    >
      <div className="row" style={{ gap: 5, minWidth: 0 }}>
        <span style={{ color: spec.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon size={16} />
        </span>
        <span
          style={{
            fontFamily: 'var(--display)',
            fontWeight: 600,
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.label}
        </span>
      </div>
      <div className="stencil" style={{ marginTop: 1 }}>
        {node.type.replace(/_/g, ' ')}
      </div>
      {node.annotation && (
        <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--graphite)' }}>{node.annotation}</div>
      )}
      {chips.length > 0 && (
        <div className="row wrap" style={{ gap: 3, marginTop: 4 }}>
          {chips.map((t) => (
            <span className="chip" key={t} style={{ fontSize: 9, padding: '0 4px' }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RefDesignModal({ problem, onClose }: { problem: Problem; onClose: () => void }) {
  const [graph, setGraph] = useState<GraphDSL | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/problems/${encodeURIComponent(problem.id)}/reference`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        const text = await res.text();
        const body = (text ? JSON.parse(text) : null) as {
          graph?: GraphDSL;
          error?: { message?: string };
        } | null;
        if (!res.ok || !body?.graph) {
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        if (alive) setGraph(body.graph);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [problem.id]);

  // The harshest load the problem itself throws at a design — the reference
  // should be judged under the same storm the learner's design faced.
  const multiplier = Math.max(1, ...problem.scenarios.map((s) => s.rpsMultiplier));

  const sim: SimResult | null = useMemo(
    () =>
      graph
        ? simulate(graph, { rpsMultiplier: multiplier, killNodeIds: [], thirdPartyLatencyMs: 0 })
        : null,
    [graph, multiplier],
  );
  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);

  const stateById = new Map((sim?.nodes ?? []).map((n) => [n.nodeId, n.state]));
  const labelById = new Map((graph?.nodes ?? []).map((n) => [n.id, n.label]));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(10 9 8 / 0.75)',
        zIndex: 40,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1180px, calc(100vw - 48px))',
          height: 'calc(100vh - 48px)',
          background: 'var(--ink-2)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div className="pane-head">
          <span className="stencil">reference design</span>
          <h2 style={{ fontSize: 13, color: 'var(--chalk)', textTransform: 'none', letterSpacing: 0 }}>
            {problem.title}
          </h2>
          <span className="grow" />
          <button className="ghost" onClick={onClose} title="Close (Esc)">
            esc ×
          </button>
        </div>

        {sim && (
          <div
            className="row"
            style={{ padding: '7px 11px', borderBottom: '1px solid var(--rule)', gap: 8 }}
          >
            <span className="chip load">×{multiplier} load</span>
            <span style={{ fontSize: 12.5, color: 'var(--graphite)' }}>{sim.verdict}</span>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {!graph && !error && (
            <div className="empty-state" style={{ width: '100%' }}>
              <div>
                <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
                  <span className="spinner" />
                  <h3 style={{ margin: 0 }}>Drafting the reference…</h3>
                </div>
                <p style={{ fontSize: 11.5, marginTop: 6 }}>
                  The first time for a problem takes ~20s — after that it is instant.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: 16, width: '100%' }}>
              <div className="banner error">{error}</div>
            </div>
          )}

          {graph && layout && (
            <>
              <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                <div
                  style={{
                    position: 'relative',
                    width: layout.width,
                    height: layout.height,
                  }}
                >
                  <svg
                    width={layout.width}
                    height={layout.height}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                  >
                    {graph.edges.map((e) => {
                      const from = layout.pos.get(e.from);
                      const to = layout.pos.get(e.to);
                      if (!from || !to) return null;
                      const stroke = EDGE_STROKE[e.kind];
                      const x1 = from.x + NODE_W;
                      const y1 = from.y + ANCHOR_Y;
                      const x2 = to.x;
                      const y2 = to.y + ANCHOR_Y;
                      return (
                        <g key={e.id}>
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={stroke.color}
                            strokeWidth={1}
                            strokeDasharray={stroke.dash}
                          />
                          {e.label && graph.edges.length <= 14 && (
                            <text
                              x={(x1 + x2) / 2}
                              y={(y1 + y2) / 2 - 4}
                              textAnchor="middle"
                              style={{ fontFamily: 'var(--mono)', fontSize: 8, fill: '#6a6459' }}
                            >
                              {e.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                  {graph.nodes.map((n) => {
                    const p = layout.pos.get(n.id);
                    if (!p) return null;
                    return (
                      <div key={n.id} style={{ position: 'absolute', left: p.x, top: p.y }}>
                        <RefNode node={n} state={stateById.get(n.id)} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {graph.stickies.length > 0 && (
                <div
                  style={{
                    width: 236,
                    flexShrink: 0,
                    borderLeft: '1px solid var(--rule)',
                    overflow: 'auto',
                    padding: 10,
                  }}
                >
                  <span className="stencil" style={{ display: 'block', marginBottom: 6 }}>
                    the capacity math
                  </span>
                  {graph.stickies.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        background: '#2b2412',
                        border: '1px solid #5c4d1e',
                        borderTop: '2px solid #96802a',
                        borderRadius: 'var(--r)',
                        padding: '6px 7px',
                        fontSize: 11,
                        color: '#f2e2ab',
                        marginBottom: 6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {s.text}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {graph && (
          <div
            className="stencil"
            style={{
              padding: '8px 11px',
              borderTop: '1px solid var(--rule)',
              flexShrink: 0,
              lineHeight: 1.7,
              textTransform: 'none',
              letterSpacing: '0.04em',
            }}
          >
            One strong answer, not the only one — your design can beat it.{' '}
            {graph.flows.length > 0 && (
              <>
                Flows:{' '}
                {graph.flows
                  .map(
                    (f) =>
                      `${f.name}: ${f.steps.map((s) => labelById.get(s) ?? s).join(' → ')}`,
                  )
                  .join(' · ')}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
