import { useEffect, useMemo, useState } from 'react';
import { checkAgainstCode, type InventoryItem, type RepoScan, type TraceSummary } from '@loadbearing/shared';
import { api, type ScanIndexEntry } from '../lib/api';
import { useCanvas } from '../state/canvasStore';

/**
 * The code view: what your repository actually contains, next to what you drew.
 *
 * The deliberate restriction is what is *not* here. Only the parts the repository
 * has can be added to the canvas — there is no load balancer, no cache, no queue,
 * no guardrail in this list, because none of those are in the code. They are the
 * design, and the design is the learner's work. This panel removes the typing, not
 * the thinking.
 */
export function ScanPanel() {
  const [scans, setScans] = useState<ScanIndexEntry[] | null>(null);
  const [scan, setScan] = useState<RepoScan | null>(null);
  const [trace, setTrace] = useState<TraceSummary | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanId = useCanvas((s) => s.scanId);
  const bindings = useCanvas((s) => s.bindings);
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const addArchNodeAtCenter = useCanvas((s) => s.addArchNodeAtCenter);
  const bindNode = useCanvas((s) => s.bindNode);
  const setScanId = useCanvas((s) => s.setScanId);
  const focusNode = useCanvas((s) => s.focusNode);
  const toGraph = useCanvas((s) => s.toGraph);

  useEffect(() => {
    api
      .scans()
      .then((r) => setScans(r.scans))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!scanId) {
      setScan(null);
      setInventory([]);
      setTrace(null);
      return;
    }
    api
      .scan(scanId)
      .then((r) => {
        setScan(r.scan);
        setInventory(r.inventory);
        setTrace(r.trace ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [scanId]);

  // The code-versus-drawing findings. Silent until something is bound, which is
  // correct: with no stated correspondence there is no contradiction to report.
  const divergence = useMemo(() => {
    if (!scan) return [];
    try {
      return checkAgainstCode({ graph: toGraph(), scan, bindings, ...(trace ? { trace } : {}) });
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, bindings, nodes, edges, trace, toGraph]);

  const boundRefs = new Set(bindings.map((b) => b.codeRef));

  const addToCanvas = (item: InventoryItem) => {
    if (!item.node) return;
    const id = addArchNodeAtCenter(item.node.type, {
      label: item.node.label,
      annotation: item.node.annotation,
      ...(item.node.attrs ? { attrs: item.node.attrs } : {}),
    });
    bindNode(item.ref, id);
    focusNode(id);
  };

  if (error) {
    return <p className="faint" style={{ fontSize: 12 }}>{error}</p>;
  }

  if (!scans) return <p className="faint" style={{ fontSize: 12 }}>Loading…</p>;

  if (scans.length === 0) {
    return (
      <div style={{ fontSize: 12 }}>
        <p className="faint" style={{ marginTop: 0 }}>
          No repository has been scanned on this account yet.
        </p>
        <p className="faint">
          Ask the coding agent in your project to send it: <em>“scan my repo into Loadbearing”</em>. It
          collects your manifests, deploy config and route files, redacts every secret value, and posts
          them here. Your source is read once and dropped — only a few lines of evidence per finding are
          kept.
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12 }}>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span className="faint">Scanned repository</span>
        <select
          value={scanId ?? ''}
          onChange={(e) => setScanId(e.target.value || null)}
          style={{ width: '100%', marginTop: 4 }}
        >
          <option value="">— none —</option>
          {scans.map((s) => (
            <option key={s.id} value={s.id}>
              {s.projectName} · {s.endpoints} endpoints
              {s.criticals > 0 ? ` · ${s.criticals} critical` : ''}
            </option>
          ))}
        </select>
      </label>

      {!scan && (
        <p className="faint">
          Pick a scan to see what it found. Nothing is drawn for you — you add the parts your code has,
          and design everything around them yourself.
        </p>
      )}

      {scan && (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{scan.projectName}</strong> — {shapeWord(scan.shape.verdict)}
            <br />
            <span className="faint">{scan.shape.why}</span>
          </p>

          {scan.exposures.length > 0 && (
            <Section title={`Between you and going public (${scan.exposures.length})`}>
              {scan.exposures.map((e) => (
                <div key={e.id} style={{ marginBottom: 10 }}>
                  <div>
                    <span className={`chip ${e.severity === 'critical' || e.severity === 'high' ? 'fail' : ''}`}>
                      {e.severity}
                    </span>{' '}
                    <strong>{e.title}</strong>
                    {e.confidence === 'inferred' && <span className="faint"> · needs checking</span>}
                    {e.source !== 'loadbearing' && <span className="faint"> · {e.source}</span>}
                  </div>
                  <div className="faint" style={{ marginTop: 2 }}>{e.detail}</div>
                  {e.path && (
                    <div className="faint" style={{ marginTop: 2 }}>
                      Chain: <code>{e.path.join(' → ')}</code>
                    </div>
                  )}
                  <div style={{ marginTop: 2 }}>Fix: {e.fix}</div>
                  {e.evidence[0] && (
                    <div className="faint" style={{ marginTop: 2 }}>
                      <code>
                        {e.evidence[0].file}
                        {e.evidence[0].line ? `:${e.evidence[0].line}` : ''}
                      </code>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {divergence.length > 0 && (
            <Section title={`Your drawing versus your code (${divergence.length})`}>
              {divergence.map((f, i) => (
                <div key={`${f.rule}-${i}`} style={{ marginBottom: 8 }}>
                  <span className={`chip ${f.severity === 'error' ? 'fail' : ''}`}>{f.severity}</span>{' '}
                  {f.message}
                  <div className="faint" style={{ marginTop: 2 }}>{f.fix}</div>
                </div>
              ))}
            </Section>
          )}

          {(['deployable', 'endpoint', 'data', 'external', 'ai'] as const).map((group) => {
            const rows = inventory.filter((i) => i.group === group);
            if (rows.length === 0) return null;
            return (
              <Section key={group} title={`${groupTitle(group)} (${rows.length})`}>
                {rows.map((item) => (
                  <div key={item.ref} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <button
                        type="button"
                        className="linky"
                        onClick={() => setOpen(open === item.ref ? null : item.ref)}
                        style={{ textAlign: 'left', flex: 1 }}
                      >
                        <strong>{item.label}</strong>
                        <span className="faint"> — {item.sublabel}</span>
                        {item.confidence === 'inferred' && <span className="faint"> · inferred</span>}
                      </button>
                      {item.node &&
                        (boundRefs.has(item.ref) ? (
                          <span className="chip pass">on canvas</span>
                        ) : (
                          <button type="button" onClick={() => addToCanvas(item)}>
                            Add
                          </button>
                        ))}
                    </div>
                    {open === item.ref && (
                      <pre
                        style={{
                          margin: '4px 0 0',
                          padding: 6,
                          overflowX: 'auto',
                          fontSize: 11,
                          opacity: 0.85,
                        }}
                      >
                        {item.evidence
                          .map((ev) => `${ev.file}${ev.line ? `:${ev.line}` : ''}\n${ev.snippet}`)
                          .join('\n\n') || 'no evidence recorded'}
                      </pre>
                    )}
                  </div>
                ))}
              </Section>
            );
          })}

          {trace && (
            <Section title={`Measured (${trace.traces} trace${trace.traces === 1 ? '' : 's'})`}>
              {trace.components.map((c) => (
                <div key={c.ref}>
                  <strong>{c.label}</strong>
                  <span className="faint">
                    {' '}
                    — p50 {c.p50Ms}ms, p95 {c.p95Ms}ms over {c.calls} call{c.calls === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </Section>
          )}

          <p className="faint" style={{ marginTop: 12 }}>
            Read {scan.coverage.filesRead} of {scan.coverage.filesSeen} file(s).
            {scan.coverage.analyzers.length > 0 && ` Analyzers: ${scan.coverage.analyzers.join(', ')}.`}
          </p>
          {scan.coverage.notes.map((n) => (
            <p key={n} className="faint" style={{ marginTop: 4 }}>
              {n}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>{title}</h4>
      {children}
    </div>
  );
}

function groupTitle(group: string): string {
  const map: Record<string, string> = {
    deployable: 'What gets deployed',
    endpoint: 'What it answers on',
    data: 'What it stores things in',
    external: 'Who it calls',
    ai: 'What it thinks with',
  };
  return map[group] ?? group;
}

function shapeWord(verdict: string): string {
  const map: Record<string, string> = {
    monolith: 'one deployable, many routes',
    services: 'several separately deployable pieces',
    'static+functions': 'static pages plus one function per route',
    unknown: 'shape could not be determined',
  };
  return map[verdict] ?? verdict;
}
