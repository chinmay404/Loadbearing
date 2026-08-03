import { describe, expect, it } from 'vitest';

import { CONCEPTS } from './concepts.js';
import { checkConnection, checkTopology } from './compatibility.js';
import type { TopologyFinding } from './compatibility.js';
import type { ArchNodeType, Flow, GraphDSL, GraphEdge, GraphNode, NodeAttrs } from './types.js';

// ---------------------------------------------------------------- builders ---

function node(
  id: string,
  type: ArchNodeType,
  label = id,
  annotation = '',
  attrs?: NodeAttrs,
): GraphNode {
  return { id, type, label, annotation, ...(attrs ? { attrs } : {}) };
}

function edge(from: string, to: string, kind: GraphEdge['kind'] = 'sync'): GraphEdge {
  return { id: `${from}->${to}:${kind}`, from, to, kind, label: '' };
}

function flow(id: string, steps: string[], rps = 100, kind: Flow['kind'] = 'read'): Flow {
  return { id, name: id, kind, steps, rps, description: '' };
}

function graph(partial: Partial<GraphDSL>): GraphDSL {
  return { nodes: [], edges: [], stickies: [], flows: [], ...partial };
}

function byRule(findings: readonly TopologyFinding[], rule: string): TopologyFinding[] {
  return findings.filter((f) => f.rule === rule);
}

/** Asserts exactly one finding for the rule and hands it back for detail checks. */
function only(findings: readonly TopologyFinding[], rule: string): TopologyFinding {
  const matches = byRule(findings, rule);
  expect(matches.map((m) => m.message)).toHaveLength(1);
  return matches[0]!;
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

// A design a reviewer would sign off on: authenticated edge, a balanced pair of
// services, a cache in front of a replicated primary, a drained queue with a DLQ,
// observability, and declared flows.
function cleanDesign(): GraphDSL {
  return graph({
    nodes: [
      node('web', 'client', 'Browser'),
      node('gw', 'api_gateway', 'API gateway'),
      node('authn', 'auth', 'Auth service'),
      node('lb', 'load_balancer', 'Internal LB'),
      node('api1', 'service', 'Orders A', '', { replicas: 3 }),
      node('api2', 'service', 'Orders B', '', { replicas: 3 }),
      node('redis', 'cache', 'Redis', '', { replicas: 2 }),
      node('db', 'sql_db', 'Postgres', '', { replicas: 2 }),
      node('q', 'queue', 'Order events', '', { replicas: 2 }),
      node('w', 'worker', 'Fulfilment worker', '', { replicas: 2 }),
      node('dlq', 'dead_letter_queue', 'Order DLQ'),
      node('obs', 'observability', 'Metrics + traces'),
    ],
    edges: [
      edge('web', 'gw'),
      edge('gw', 'authn'),
      edge('gw', 'lb'),
      edge('lb', 'api1'),
      edge('lb', 'api2'),
      edge('api1', 'redis'),
      edge('api2', 'redis'),
      edge('redis', 'db'),
      edge('api1', 'db'),
      edge('api2', 'db'),
      edge('api1', 'q'),
      edge('q', 'w', 'async'),
      edge('w', 'dlq', 'async'),
    ],
    flows: [
      flow('read order', ['web', 'gw', 'lb', 'api1', 'redis', 'db'], 400, 'read'),
      flow('place order', ['web', 'gw', 'lb', 'api1', 'db', 'q'], 60, 'write'),
      flow('fulfil', ['q', 'w'], 60, 'async'),
    ],
  });
}

// ============================================================== hard errors ===

describe('rule 1 — client-direct-to-datastore', () => {
  it('flags a browser wired straight into Postgres, pinning both nodes and the edge', () => {
    const g = graph({
      nodes: [node('web', 'client', 'Browser'), node('db', 'sql_db', 'Postgres')],
      edges: [edge('web', 'db')],
    });

    const f = only(checkTopology(g), 'client-direct-to-datastore');
    expect(f.severity).toBe('error');
    expect(f.nodeIds).toEqual(['web', 'db']);
    expect(f.edgeIds).toEqual(['web->db:sync']);
    expect(f.concept).toBe('authn-authz');
    expect(f.message).toMatch(/credentials/i);
  });

  it('flags a mobile client publishing straight into a broker', () => {
    const g = graph({
      nodes: [node('app', 'mobile_client', 'iOS app'), node('q', 'queue', 'Ingest queue')],
      edges: [edge('app', 'q')],
    });

    const f = only(checkTopology(g), 'client-direct-to-datastore');
    expect(f.nodeIds).toEqual(['app', 'q']);
  });

  it('leaves a client → service → datastore path alone', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('db', 'sql_db')],
      edges: [edge('web', 'api'), edge('api', 'db')],
    });

    expect(byRule(checkTopology(g), 'client-direct-to-datastore')).toEqual([]);
  });
});

describe('rule 2 — replication-between-unlike-stores', () => {
  it('flags a "replication" edge from Postgres into Redis', () => {
    const g = graph({
      nodes: [node('db', 'sql_db', 'Postgres'), node('redis', 'cache', 'Redis')],
      edges: [edge('db', 'redis', 'replication')],
    });

    const f = only(checkTopology(g), 'replication-between-unlike-stores');
    expect(f.severity).toBe('error');
    expect(f.nodeIds).toEqual(['db', 'redis']);
    expect(f.edgeIds).toEqual(['db->redis:replication']);
    expect(f.fix).toMatch(/cdc_connector/);
  });

  it('accepts primary → read replica in either family', () => {
    const g = graph({
      nodes: [
        node('db', 'sql_db'),
        node('ro', 'read_replica'),
        node('mongo', 'nosql_db'),
        node('mongoro', 'read_replica', 'mongo-ro'),
      ],
      edges: [edge('db', 'ro', 'replication'), edge('mongo', 'mongoro', 'replication')],
    });

    expect(byRule(checkTopology(g), 'replication-between-unlike-stores')).toEqual([]);
  });
});

describe('rule 3 — sync-into-queue', () => {
  it('flags the sync edge leaving a queue, not the one entering it', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('q', 'queue', 'Jobs'), node('w', 'worker')],
      edges: [edge('svc', 'q'), edge('q', 'w')],
    });

    const f = only(checkTopology(g), 'sync-into-queue');
    expect(f.severity).toBe('error');
    expect(f.nodeIds).toEqual(['q', 'w']);
    expect(f.edgeIds).toEqual(['q->w:sync']);
    expect(f.concept).toBe('queue-backpressure');
  });

  it('says nothing when the consumer pulls asynchronously', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('q', 'queue'), node('w', 'worker')],
      edges: [edge('svc', 'q'), edge('q', 'w', 'async')],
    });

    expect(byRule(checkTopology(g), 'sync-into-queue')).toEqual([]);
  });
});

describe('rule 4 — cache-as-system-of-record', () => {
  it('flags a datastore whose only inbound write path is a cache', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('redis', 'cache', 'Redis'), node('db', 'sql_db', 'Postgres')],
      edges: [edge('svc', 'redis'), edge('redis', 'db')],
    });

    const f = only(checkTopology(g), 'cache-as-system-of-record');
    expect(f.severity).toBe('error');
    expect(f.nodeIds).toEqual(['db', 'redis']);
    expect(f.edgeIds).toEqual(['redis->db:sync']);
    expect(f.concept).toBe('caching');
  });

  it('flags a cache with nothing durable behind it', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('redis', 'cache', 'Redis')],
      edges: [edge('web', 'redis')],
    });

    const f = only(checkTopology(g), 'cache-as-system-of-record');
    expect(f.nodeIds).toEqual(['redis']);
    expect(f.message).toMatch(/system of record/i);
  });

  it('accepts a cache-aside pair where the service also writes the store', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('redis', 'cache'), node('db', 'sql_db')],
      edges: [edge('svc', 'redis'), edge('redis', 'db'), edge('svc', 'db')],
    });

    expect(byRule(checkTopology(g), 'cache-as-system-of-record')).toEqual([]);
  });

  it('accepts a prompt cache in front of a model — the model can always recompute', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('pc', 'prompt_cache'), node('llm', 'llm')],
      edges: [edge('svc', 'pc'), edge('pc', 'llm')],
    });

    expect(byRule(checkTopology(g), 'cache-as-system-of-record')).toEqual([]);
  });
});

describe('rule 5 — orphan-node', () => {
  it('warns about a node with no edges and no flow, but leaves observability and groups alone', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('api', 'service'),
        node('ghost', 'search_index', 'Elasticsearch'),
        node('obs', 'observability', 'Grafana'),
        node('region', 'group', 'eu-west-1'),
      ],
      edges: [edge('web', 'api')],
    });

    const findings = checkTopology(g);
    const f = only(findings, 'orphan-node');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['ghost']);
    expect(f.edgeIds).toEqual([]);
    expect(f.concept).toBeUndefined();
  });

  it('does not warn when a flow names the node even with no edges drawn', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service')],
      flows: [flow('read', ['web', 'api'])],
    });

    expect(byRule(checkTopology(g), 'orphan-node')).toEqual([]);
  });
});

// ================================================================ warnings ===

describe('rule 6 — llm-without-guardrail', () => {
  it('warns when a client can reach a model with nothing reading the prompt', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('llm', 'llm', 'Claude')],
      edges: [edge('web', 'api'), edge('api', 'llm')],
    });

    const f = only(checkTopology(g), 'llm-without-guardrail');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['llm']);
    expect(f.concept).toBe('prompt-injection-defense');
  });

  it('is satisfied by a guardrail on the path', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('gr', 'guardrail'),
        node('api', 'service'),
        node('llm', 'llm'),
      ],
      edges: [edge('web', 'gr'), edge('gr', 'api'), edge('api', 'llm')],
    });

    expect(byRule(checkTopology(g), 'llm-without-guardrail')).toEqual([]);
  });

  it('trusts the declared flow over a shortcut in the edge list', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('rl', 'rate_limiter'),
        node('api', 'service'),
        node('agent', 'agent_runtime'),
      ],
      edges: [edge('web', 'api'), edge('web', 'rl'), edge('rl', 'api'), edge('api', 'agent')],
      flows: [flow('ask', ['web', 'rl', 'api', 'agent'])],
    });

    expect(byRule(checkTopology(g), 'llm-without-guardrail')).toEqual([]);
  });
});

describe('rule 7 — llm-no-cost-ceiling', () => {
  it('warns when nothing in the graph bounds model spend', () => {
    const g = graph({
      nodes: [node('api', 'service'), node('llm', 'llm', 'Claude')],
      edges: [edge('api', 'llm')],
    });

    const f = only(checkTopology(g), 'llm-no-cost-ceiling');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['llm']);
    expect(f.concept).toBe('llm-cost-control');
  });

  it('is satisfied by a model router', () => {
    const g = graph({
      nodes: [node('api', 'service'), node('mr', 'model_router'), node('llm', 'llm')],
      edges: [edge('api', 'mr'), edge('mr', 'llm')],
    });

    expect(byRule(checkTopology(g), 'llm-no-cost-ceiling')).toEqual([]);
  });
});

describe('rule 8 — third-party-on-sync-user-path', () => {
  it('warns about an unprotected vendor call inline on a write flow', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('stripe', 'third_party', 'Stripe')],
      edges: [edge('web', 'api'), edge('api', 'stripe')],
      flows: [flow('checkout', ['web', 'api', 'stripe'], 20, 'write')],
    });

    const f = only(checkTopology(g), 'third-party-on-sync-user-path');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['stripe']);
    expect(f.concept).toBe('circuit-breaker');
    expect(f.message).toMatch(/checkout/);
  });

  it('accepts a node labelled as a circuit breaker as the protection', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('api', 'service'),
        node('cb', 'service', 'Payment circuit breaker'),
        node('stripe', 'third_party', 'Stripe'),
      ],
      edges: [edge('web', 'api'), edge('api', 'cb'), edge('cb', 'stripe')],
      flows: [flow('checkout', ['web', 'api', 'cb', 'stripe'], 20, 'write')],
    });

    expect(byRule(checkTopology(g), 'third-party-on-sync-user-path')).toEqual([]);
  });

  it('ignores a vendor that only appears on an async flow', () => {
    const g = graph({
      nodes: [node('w', 'worker'), node('stripe', 'third_party')],
      edges: [edge('w', 'stripe')],
      flows: [flow('reconcile', ['w', 'stripe'], 5, 'async')],
    });

    expect(byRule(checkTopology(g), 'third-party-on-sync-user-path')).toEqual([]);
  });
});

describe('rule 9 — queue-without-consumer', () => {
  it('warns about a queue nothing drains', () => {
    const g = graph({
      nodes: [node('api', 'service'), node('q', 'stream', 'Events')],
      edges: [edge('api', 'q')],
    });

    const f = only(checkTopology(g), 'queue-without-consumer');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['q']);
    expect(f.concept).toBe('queue-backpressure');
  });

  it('does not warn about a dead letter queue having no consumer', () => {
    const g = graph({
      nodes: [node('w', 'worker'), node('dlq', 'dead_letter_queue')],
      edges: [edge('w', 'dlq', 'async')],
    });

    expect(byRule(checkTopology(g), 'queue-without-consumer')).toEqual([]);
  });
});

describe('rule 10 — queue-without-dlq', () => {
  it('warns when a drained queue has nowhere to put a poison message', () => {
    const g = graph({
      nodes: [node('api', 'service'), node('q', 'queue', 'Jobs'), node('w', 'worker')],
      edges: [edge('api', 'q'), edge('q', 'w', 'async')],
    });

    const f = only(checkTopology(g), 'queue-without-dlq');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['q']);
    expect(f.concept).toBe('exactly-once');
  });

  it('cites webhook reliability instead when a third party is in the design', () => {
    const g = graph({
      nodes: [
        node('api', 'service'),
        node('q', 'queue'),
        node('w', 'worker'),
        node('hook', 'third_party', 'Customer webhook'),
      ],
      edges: [edge('api', 'q'), edge('q', 'w', 'async'), edge('w', 'hook')],
    });

    expect(only(checkTopology(g), 'queue-without-dlq').concept).toBe('webhook-reliability');
  });

  it('is silent once a dead letter queue exists', () => {
    const g = graph({
      nodes: [node('q', 'queue'), node('w', 'worker'), node('dlq', 'dead_letter_queue')],
      edges: [edge('q', 'w', 'async'), edge('w', 'dlq', 'async')],
    });

    expect(byRule(checkTopology(g), 'queue-without-dlq')).toEqual([]);
  });
});

describe('rule 11 — no-auth-boundary', () => {
  it('warns when a client reaches a service with nothing checking identity', () => {
    const g = graph({
      nodes: [node('web', 'client', 'Browser'), node('api', 'service', 'API')],
      edges: [edge('web', 'api')],
    });

    const f = only(checkTopology(g), 'no-auth-boundary');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['web', 'api']);
    expect(f.concept).toBe('authn-authz');
  });

  it('treats an api_gateway on the path as the boundary', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('gw', 'api_gateway'), node('api', 'service')],
      edges: [edge('web', 'gw'), edge('gw', 'api')],
    });

    expect(byRule(checkTopology(g), 'no-auth-boundary')).toEqual([]);
  });
});

describe('rule 12 — search-index-written-synchronously', () => {
  it('flags the dual write and pins both edges', () => {
    const g = graph({
      nodes: [
        node('svc', 'service', 'Catalog'),
        node('db', 'sql_db', 'Postgres'),
        node('idx', 'search_index', 'Elasticsearch'),
      ],
      edges: [edge('svc', 'db'), edge('svc', 'idx')],
    });

    const f = only(checkTopology(g), 'search-index-written-synchronously');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['svc', 'db', 'idx']);
    expect(f.edgeIds).toEqual(['svc->db:sync', 'svc->idx:sync']);
    expect(f.concept).toBe('outbox');
    expect(f.fix).toMatch(/outbox|cdc_connector/);
  });

  it('accepts an index fed asynchronously', () => {
    const g = graph({
      nodes: [node('svc', 'service'), node('db', 'sql_db'), node('idx', 'search_index')],
      edges: [edge('svc', 'db'), edge('svc', 'idx', 'async')],
    });

    expect(byRule(checkTopology(g), 'search-index-written-synchronously')).toEqual([]);
  });
});

describe('rule 13 — stateful-single-replica', () => {
  it('warns about a one-instance database on a read flow', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('db', 'sql_db', 'Postgres')],
      edges: [edge('web', 'api'), edge('api', 'db')],
      flows: [flow('read', ['web', 'api', 'db'], 50, 'read')],
    });

    const f = only(checkTopology(g), 'stateful-single-replica');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['db']);
    expect(f.concept).toBe('spof');
  });

  it('is silent with replicas set above one, and off the user path', () => {
    const withReplicas = graph({
      nodes: [node('api', 'service'), node('db', 'sql_db', 'Postgres', '', { replicas: 2 })],
      edges: [edge('api', 'db')],
      flows: [flow('read', ['api', 'db'], 50, 'read')],
    });
    const offPath = graph({
      nodes: [node('w', 'worker'), node('db', 'sql_db')],
      edges: [edge('w', 'db')],
      flows: [flow('job', ['w', 'db'], 5, 'async')],
    });

    expect(byRule(checkTopology(withReplicas), 'stateful-single-replica')).toEqual([]);
    expect(byRule(checkTopology(offPath), 'stateful-single-replica')).toEqual([]);
  });
});

describe('rule 14 — lb-without-backends', () => {
  it('warns when the load balancer has a single backend', () => {
    const g = graph({
      nodes: [node('lb', 'load_balancer', 'ALB'), node('api', 'service', 'API')],
      edges: [edge('lb', 'api')],
    });

    const f = only(checkTopology(g), 'lb-without-backends');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['lb', 'api']);
    expect(f.edgeIds).toEqual(['lb->api:sync']);
  });

  it('is satisfied by two interchangeable backends of the same type', () => {
    const g = graph({
      nodes: [
        node('lb', 'load_balancer'),
        node('api1', 'service'),
        node('api2', 'service'),
      ],
      edges: [edge('lb', 'api1'), edge('lb', 'api2')],
    });

    expect(byRule(checkTopology(g), 'lb-without-backends')).toEqual([]);
  });

  it('does not count two different types as redundancy', () => {
    const g = graph({
      nodes: [
        node('rp', 'reverse_proxy', 'nginx'),
        node('api', 'service'),
        node('mono', 'monolith'),
      ],
      edges: [edge('rp', 'api'), edge('rp', 'mono')],
    });

    expect(only(checkTopology(g), 'lb-without-backends').nodeIds).toEqual(['rp', 'api', 'mono']);
  });
});

describe('rule 15 — cdn-behind-app', () => {
  it('warns when the CDN receives traffic from the app instead of fronting it', () => {
    const g = graph({
      nodes: [node('api', 'service', 'Web app'), node('cdn', 'cdn', 'CloudFront')],
      edges: [edge('api', 'cdn')],
    });

    const f = only(checkTopology(g), 'cdn-behind-app');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['api', 'cdn']);
    expect(f.edgeIds).toEqual(['api->cdn:sync']);
    expect(f.concept).toBe('cdn');
  });

  it('is silent when the CDN fronts the app', () => {
    const g = graph({
      nodes: [node('cdn', 'cdn'), node('api', 'service')],
      edges: [edge('cdn', 'api')],
    });

    expect(byRule(checkTopology(g), 'cdn-behind-app')).toEqual([]);
  });
});

describe('rule 16 — warehouse-on-user-path', () => {
  it('warns about an analytical store on a read flow', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('dw', 'data_warehouse', 'Snowflake')],
      edges: [edge('web', 'api'), edge('api', 'dw')],
      flows: [flow('dashboard', ['web', 'api', 'dw'], 30, 'read')],
    });

    const f = only(checkTopology(g), 'warehouse-on-user-path');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['dw']);
    expect(f.message).toMatch(/dashboard/);
  });

  it('is silent when the warehouse is only on an async pipeline', () => {
    const g = graph({
      nodes: [node('etl', 'batch_job'), node('dw', 'olap_db')],
      edges: [edge('etl', 'dw', 'async')],
      flows: [flow('nightly', ['etl', 'dw'], 1, 'async')],
    });

    expect(byRule(checkTopology(g), 'warehouse-on-user-path')).toEqual([]);
  });
});

describe('rule 17 — vector-db-without-embedder', () => {
  it('warns when nothing can produce the vectors', () => {
    const g = graph({
      nodes: [node('api', 'service'), node('vdb', 'vector_db', 'pgvector')],
      edges: [edge('api', 'vdb')],
    });

    const f = only(checkTopology(g), 'vector-db-without-embedder');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['vdb']);
    expect(f.concept).toBe('rag-retrieval');
  });

  it('is satisfied by an embedding service, or by an annotation naming embeddings', () => {
    const withSvc = graph({
      nodes: [node('emb', 'embedding_svc'), node('vdb', 'vector_db')],
      edges: [edge('emb', 'vdb')],
    });
    const withAnnotation = graph({
      nodes: [
        node('api', 'service'),
        node('vdb', 'vector_db', 'pgvector', 'chunks embedded by the ingest job, model v3'),
      ],
      edges: [edge('api', 'vdb')],
    });

    expect(byRule(checkTopology(withSvc), 'vector-db-without-embedder')).toEqual([]);
    expect(byRule(checkTopology(withAnnotation), 'vector-db-without-embedder')).toEqual([]);
  });
});

describe('rule 18 — pii-unencrypted-third-party', () => {
  it('warns when annotated card data goes to a vendor with no KMS in the design', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'Checkout', 'holds the card number and billing address'),
        node('vendor', 'third_party', 'Fraud vendor'),
      ],
      edges: [edge('api', 'vendor')],
    });

    const f = only(checkTopology(g), 'pii-unencrypted-third-party');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['api', 'vendor']);
    expect(f.edgeIds).toEqual(['api->vendor:sync']);
    expect(f.concept).toBe('encryption');
  });

  it('is silent once a kms is present', () => {
    const g = graph({
      nodes: [
        node('api', 'service', 'Checkout', 'holds PII'),
        node('vendor', 'third_party'),
        node('kms', 'kms'),
      ],
      edges: [edge('api', 'vendor'), edge('api', 'kms')],
    });

    expect(byRule(checkTopology(g), 'pii-unencrypted-third-party')).toEqual([]);
  });
});

// ==================================================================== info ===

describe('rule 19 — no-observability', () => {
  it('notes the gap once the design has four real components', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('lb', 'load_balancer'),
        node('api', 'service'),
        node('db', 'sql_db'),
      ],
      edges: [edge('web', 'lb'), edge('lb', 'api'), edge('api', 'db')],
    });

    const f = only(checkTopology(g), 'no-observability');
    expect(f.severity).toBe('info');
    expect(f.nodeIds).toEqual([]);
    expect(f.edgeIds).toEqual([]);
    expect(f.concept).toBe('observability');
  });

  it('stays quiet on a three-node sketch and when observability exists', () => {
    const small = graph({
      nodes: [node('web', 'client'), node('api', 'service'), node('db', 'sql_db')],
      edges: [edge('web', 'api'), edge('api', 'db')],
    });

    expect(byRule(checkTopology(small), 'no-observability')).toEqual([]);
    expect(byRule(checkTopology(cleanDesign()), 'no-observability')).toEqual([]);
  });
});

describe('rule 20 — no-flows-declared', () => {
  it('points at what flows unlock', () => {
    const g = graph({
      nodes: [node('web', 'client'), node('api', 'service')],
      edges: [edge('web', 'api')],
    });

    const f = only(checkTopology(g), 'no-flows-declared');
    expect(f.severity).toBe('info');
    expect(f.fix).toMatch(/simulat/i);
    expect(f.fix).toMatch(/review/i);
  });

  it('is silent when a flow exists', () => {
    expect(byRule(checkTopology(cleanDesign()), 'no-flows-declared')).toEqual([]);
  });
});

describe('rule 21 — overengineered-for-scale', () => {
  it('notes three services carrying under 100 rps', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('s1', 'service', 'Users'),
        node('s2', 'service', 'Orders'),
        node('s3', 'service', 'Billing'),
      ],
      edges: [edge('web', 's1'), edge('s1', 's2'), edge('s2', 's3')],
      flows: [flow('browse', ['web', 's1', 's2', 's3'], 40, 'read')],
    });

    const f = only(checkTopology(g), 'overengineered-for-scale');
    expect(f.severity).toBe('info');
    expect(f.nodeIds).toEqual(['s1', 's2', 's3']);
    expect(f.concept).toBe('overengineering-avoidance');
    expect(f.fix).toMatch(/monolith/i);
  });

  it('stays quiet once a flow actually carries load', () => {
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('s1', 'service'),
        node('s2', 'service'),
        node('s3', 'service'),
      ],
      edges: [edge('web', 's1'), edge('s1', 's2'), edge('s2', 's3')],
      flows: [flow('browse', ['web', 's1', 's2', 's3'], 4_000, 'read')],
    });

    expect(byRule(checkTopology(g), 'overengineered-for-scale')).toEqual([]);
  });
});

// ============================================================== whole graph ===

describe('checkTopology — contract', () => {
  it('finds no errors in a sensible design', () => {
    const findings = checkTopology(cleanDesign());
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('does not throw on an empty graph and returns only the no-flows note', () => {
    const findings = checkTopology(graph({}));
    expect(findings.map((f) => f.rule)).toEqual(['no-flows-declared']);
    expect(findings[0]!.severity).toBe('info');
  });

  it('orders findings error → warning → info', () => {
    // One of each: a client wired to Postgres (error), a lone backend behind the
    // LB (warning), and no flows at all (info).
    const g = graph({
      nodes: [
        node('web', 'client'),
        node('lb', 'load_balancer'),
        node('api', 'service'),
        node('db', 'sql_db'),
      ],
      edges: [edge('web', 'db'), edge('web', 'lb'), edge('lb', 'api'), edge('api', 'db')],
    });

    const findings = checkTopology(g);
    const severities = findings.map((f) => f.severity);
    expect(severities).toContain('error');
    expect(severities).toContain('warning');
    expect(severities).toContain('info');
    for (let i = 1; i < findings.length; i += 1) {
      expect(RANK[findings[i]!.severity]).toBeGreaterThanOrEqual(RANK[findings[i - 1]!.severity]);
    }
  });

  it('is deterministic: the same graph twice yields an identical array', () => {
    const g = cleanDesign();
    const messy = graph({
      nodes: [...g.nodes, node('web2', 'mobile_client'), node('llm', 'llm'), node('lonely', 'vm')],
      edges: [...g.edges, edge('web2', 'db'), edge('api2', 'llm')],
      flows: g.flows,
      stickies: [],
    });

    expect(checkTopology(messy)).toEqual(checkTopology(messy));
    expect(JSON.stringify(checkTopology(messy))).toBe(JSON.stringify(checkTopology(messy)));
  });

  it('does not mutate the graph it is given', () => {
    const g = cleanDesign();
    const before = JSON.stringify(g);
    const frozen = deepFreeze(g);

    expect(() => checkTopology(frozen)).not.toThrow();
    expect(JSON.stringify(g)).toBe(before);
  });
});

// =========================================================== checkConnection ===

describe('checkConnection', () => {
  const web = node('web', 'client', 'Browser');
  const db = node('db', 'sql_db', 'Postgres');
  const svc = node('svc', 'service', 'API');

  it('rejects a client wired straight to a datastore, with no edge id yet', () => {
    const findings = checkConnection(web, db, 'sync');
    const f = only(findings, 'client-direct-to-datastore');
    expect(f.severity).toBe('error');
    expect(f.nodeIds).toEqual(['web', 'db']);
    expect(f.edgeIds).toEqual([]);
  });

  it('rejects replication between a store and a cache', () => {
    const f = only(checkConnection(db, node('redis', 'cache', 'Redis'), 'replication'), 'replication-between-unlike-stores');
    expect(f.severity).toBe('error');
  });

  it('rejects a sync edge out of a queue', () => {
    const f = only(checkConnection(node('q', 'queue', 'Jobs'), node('w', 'worker'), 'sync'), 'sync-into-queue');
    expect(f.severity).toBe('error');
  });

  it('accepts a sync edge into a queue', () => {
    expect(checkConnection(svc, node('q', 'queue'), 'sync')).toEqual([]);
  });

  it('warns about a CDN placed behind the app', () => {
    const f = only(checkConnection(svc, node('cdn', 'cdn', 'CloudFront'), 'sync'), 'cdn-behind-app');
    expect(f.severity).toBe('warning');
  });

  it('warns when a datastore points sync into a service', () => {
    const f = only(checkConnection(db, svc, 'sync'), 'datastore-calls-service');
    expect(f.severity).toBe('warning');
    expect(f.nodeIds).toEqual(['db', 'svc']);
    expect(f.fix).toMatch(/cdc_connector/);
  });

  it('says nothing about an ordinary service → datastore call', () => {
    expect(checkConnection(svc, db, 'sync')).toEqual([]);
  });
});

// ---------------------------------------------------------------- utilities ---

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('read-after-write against a follower', () => {
  const withReplica = (readSteps: string[], writeFlow: boolean): GraphDSL => ({
    nodes: [
      { id: 'client', type: 'client', label: 'Client', annotation: '' },
      { id: 'api', type: 'service', label: 'API', annotation: 'Serves both paths.' },
      { id: 'primary', type: 'sql_db', label: 'Primary', annotation: 'System of record.' },
      { id: 'replica', type: 'read_replica', label: 'Replica', annotation: 'Follows the primary.' },
    ],
    edges: [
      { id: 'e1', from: 'client', to: 'api', kind: 'sync', label: '' },
      { id: 'e2', from: 'api', to: 'primary', kind: 'sync', label: '' },
      { id: 'e3', from: 'api', to: 'replica', kind: 'sync', label: '' },
      { id: 'e4', from: 'primary', to: 'replica', kind: 'replication', label: '' },
    ],
    stickies: [],
    flows: [
      { id: 'r', name: 'profile read', kind: 'read', steps: readSteps, rps: 800, description: '' },
      ...(writeFlow
        ? [{ id: 'w', name: 'profile write', kind: 'write' as const, steps: ['client', 'api', 'primary'], rps: 200, description: '' }]
        : []),
    ],
  });

  const ruleIds = (g: GraphDSL) => checkTopology(g).map((f) => f.rule);

  it('warns when a read flow goes to a replica and the design also writes', () => {
    expect(ruleIds(withReplica(['client', 'api', 'replica'], true))).toContain(
      'read-after-write-on-replica',
    );
  });

  it('stays quiet when nothing in the design writes', () => {
    // A read-only reporting design against a follower is exactly right.
    expect(ruleIds(withReplica(['client', 'api', 'replica'], false))).not.toContain(
      'read-after-write-on-replica',
    );
  });

  it('stays quiet when the read goes to the primary', () => {
    expect(ruleIds(withReplica(['client', 'api', 'primary'], true))).not.toContain(
      'read-after-write-on-replica',
    );
  });

  it('cites a concept that actually exists', () => {
    const f = checkTopology(withReplica(['client', 'api', 'replica'], true)).find(
      (x) => x.rule === 'read-after-write-on-replica',
    );
    expect(f?.concept).toBe('consistency-models');
    expect(CONCEPTS).toContain(f!.concept!);
  });
});
