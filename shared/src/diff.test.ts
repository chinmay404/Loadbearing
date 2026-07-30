import { describe, expect, it } from 'vitest';

import { diffGraphs, renderDiffLines } from './diff.js';
import type { ArchNodeType, Flow, GraphDSL, GraphEdge, GraphNode, NodeAttrs } from './types.js';

// ---------------------------------------------------------------- builders ---

function node(id: string, type: ArchNodeType, label = id, attrs?: NodeAttrs): GraphNode {
  return { id, type, label, annotation: '', ...(attrs ? { attrs } : {}) };
}

function edge(
  from: string,
  to: string,
  kind: GraphEdge['kind'] = 'sync',
  label = '',
): GraphEdge {
  return { id: `${from}->${to}:${kind}`, from, to, kind, label };
}

function flow(
  id: string,
  steps: string[],
  rps: number,
  kind: Flow['kind'] = 'read',
  name = id,
): Flow {
  return { id, name, kind, steps, rps, description: '' };
}

function graph(partial: Partial<GraphDSL>): GraphDSL {
  return { nodes: [], edges: [], stickies: [], flows: [], ...partial };
}

// The "before" design used across tests: API -> Redis -> Postgres.
function base(): GraphDSL {
  return graph({
    nodes: [
      node('api', 'service', 'Catalog API', { capacityRps: 500, replicas: 1 }),
      node('redis', 'cache', 'Redis'),
      node('db', 'sql_db', 'Postgres'),
    ],
    edges: [edge('api', 'redis'), edge('api', 'db')],
    flows: [flow('reads', ['api', 'redis', 'db'], 800)],
  });
}

// ---------------------------------------------------------------- tests ------

describe('diffGraphs — nodes', () => {
  it('reports an added node and renders it with a + prefix', () => {
    const after = base();
    after.nodes.push(node('rr', 'read_replica', 'Read Replica'));
    const d = diffGraphs(base(), after);

    expect(d.addedNodes).toEqual([{ id: 'rr', label: 'Read Replica', type: 'read_replica' }]);
    expect(d.removedNodes).toEqual([]);
    expect(d.unchanged).toBe(false);
    expect(renderDiffLines(d)).toContain('+ Read Replica (read_replica)');
  });

  it('reports a removed node with a − prefix', () => {
    const after = base();
    after.nodes = after.nodes.filter((n) => n.id !== 'redis');
    after.edges = after.edges.filter((e) => e.to !== 'redis');
    after.flows = [flow('reads', ['api', 'db'], 800)];
    const d = diffGraphs(base(), after);

    expect(d.removedNodes).toEqual([{ id: 'redis', label: 'Redis', type: 'cache' }]);
    expect(renderDiffLines(d)).toContain('− Redis (cache)');
  });

  it('compares attrs one by one and produces the exact change strings', () => {
    const after = base();
    after.nodes = after.nodes.map((n) =>
      n.id === 'api' ? { ...n, attrs: { capacityRps: 800, replicas: 3 } } : n,
    );
    const d = diffGraphs(base(), after);

    expect(d.changedNodes).toHaveLength(1);
    const change = d.changedNodes[0]!;
    expect(change.id).toBe('api');
    expect(change.label).toBe('Catalog API');
    expect(change.changes).toEqual(['capacityRps 500 → 800', 'replicas 1 → 3']);
    expect(renderDiffLines(d)).toContain('~ Catalog API: capacityRps 500 → 800, replicas 1 → 3');
  });

  it('describes label renames, annotation edits, and attrs going from unset to set', () => {
    const after = base();
    after.nodes = after.nodes.map((n) =>
      n.id === 'redis'
        ? { ...n, label: 'Redis Cluster', annotation: 'now clustered', attrs: { replicas: 3 } }
        : n,
    );
    const d = diffGraphs(base(), after);

    const change = d.changedNodes[0]!;
    expect(change.changes).toContain("label 'Redis' → 'Redis Cluster'");
    expect(change.changes).toContain('annotation edited');
    expect(change.changes).toContain('replicas default → 3');
    // Human lines use the AFTER label for a renamed node.
    expect(change.label).toBe('Redis Cluster');
  });
});

describe('diffGraphs — edges', () => {
  it('reports added and removed edges as human lines using labels, never ids', () => {
    const after = base();
    after.nodes.push(node('rr', 'read_replica', 'Read Replica'));
    after.edges = [edge('api', 'redis'), edge('api', 'rr')]; // db edge dropped, replica added
    const d = diffGraphs(base(), after);

    expect(d.addedEdges).toEqual(['Catalog API —sync→ Read Replica']);
    expect(d.removedEdges).toEqual(['Catalog API —sync→ Postgres']);
    expect(renderDiffLines(d)).toContain('+ Catalog API —sync→ Read Replica');
    expect(renderDiffLines(d)).toContain('− Catalog API —sync→ Postgres');
  });

  it('treats a kind flip on the same endpoints as ONE changed edge, not remove+add', () => {
    const after = base();
    after.edges = [edge('api', 'redis'), edge('api', 'db', 'async')];
    const d = diffGraphs(base(), after);

    expect(d.addedEdges).toEqual([]);
    expect(d.removedEdges).toEqual([]);
    expect(d.changedEdges).toEqual(['Catalog API → Postgres: kind sync → async']);
    expect(renderDiffLines(d)).toContain('~ Catalog API → Postgres: kind sync → async');
  });

  it('reports an edge label change at the same endpoints as a changed edge', () => {
    const before = base();
    before.edges = [edge('api', 'db', 'sync', 'reads')];
    const after = base();
    after.edges = [edge('api', 'db', 'sync', 'reads + writes')];
    const d = diffGraphs(before, after);

    expect(d.changedEdges).toEqual([
      "label on Catalog API —sync→ Postgres: 'reads' → 'reads + writes'",
    ]);
    expect(d.addedEdges).toEqual([]);
    expect(d.removedEdges).toEqual([]);
  });
});

describe('diffGraphs — flows', () => {
  it('describes a step change with labels on both sides', () => {
    const after = base();
    after.nodes.push(node('q', 'queue', 'Queue'));
    after.flows = [flow('reads', ['api', 'q', 'db'], 800)];
    const d = diffGraphs(base(), after);

    expect(d.flowChanges).toContain(
      "flow 'reads' steps changed: Catalog API → Redis → Postgres becomes Catalog API → Queue → Postgres",
    );
  });

  it('describes an rps change', () => {
    const after = base();
    after.flows = [flow('reads', ['api', 'redis', 'db'], 2000)];
    const d = diffGraphs(base(), after);
    expect(d.flowChanges).toEqual(["flow 'reads' rps 800 → 2000"]);
    expect(renderDiffLines(d)).toContain("~ flow 'reads' rps 800 → 2000");
  });

  it('describes added and removed flows by name with the right prefixes', () => {
    const after = base();
    after.flows = [flow('writes', ['api', 'db'], 200, 'write', 'checkout')];
    const d = diffGraphs(base(), after);

    expect(d.flowChanges).toContain("removed flow 'reads'");
    expect(d.flowChanges).toContain("added flow 'checkout'");
    const lines = renderDiffLines(d);
    expect(lines).toContain("− removed flow 'reads'");
    expect(lines).toContain("+ added flow 'checkout'");
  });
});

describe('diffGraphs — identity and hygiene', () => {
  it('returns unchanged=true and renders no lines for identical graphs', () => {
    const d = diffGraphs(base(), base());
    expect(d.unchanged).toBe(true);
    expect(d.addedNodes).toEqual([]);
    expect(d.removedNodes).toEqual([]);
    expect(d.changedNodes).toEqual([]);
    expect(d.addedEdges).toEqual([]);
    expect(d.removedEdges).toEqual([]);
    expect(d.changedEdges).toEqual([]);
    expect(d.flowChanges).toEqual([]);
    expect(renderDiffLines(d)).toEqual([]);
  });

  it('does not mutate its inputs and is deterministic', () => {
    const before = base();
    const after = base();
    after.nodes.push(node('rr', 'read_replica', 'Read Replica'));
    after.edges.push(edge('db', 'rr', 'replication'));
    after.flows = [flow('reads', ['api', 'redis', 'rr'], 2000)];

    const beforeSnap = JSON.stringify(before);
    const afterSnap = JSON.stringify(after);
    const a = diffGraphs(before, after);
    const b = diffGraphs(before, after);

    expect(JSON.stringify(before)).toBe(beforeSnap);
    expect(JSON.stringify(after)).toBe(afterSnap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
