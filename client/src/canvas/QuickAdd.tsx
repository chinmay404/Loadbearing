import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_CATALOG, type NodeSpec } from './nodeCatalog';
import { NODE_ICONS } from './icons';
import { useCanvas } from '../state/canvasStore';

/**
 * Ctrl+K, then type. Once the palette runs to sixty components, hunting for one
 * with the mouse is slower than naming it.
 */
/**
 * Nobody searches for "blob_store" — they type "s3". Nobody types
 * "workflow_engine" — they type "temporal". Products and pattern names map onto
 * the component that implements them.
 */
const ALIASES: Record<string, string[]> = {
  cache: ['redis', 'memcached', 'valkey', 'elasticache'],
  prompt_cache: ['semantic cache', 'llm cache'],
  queue: ['sqs', 'rabbitmq', 'outbox', 'relay', 'jobs', 'celery', 'sidekiq'],
  stream: ['kafka', 'kinesis', 'pulsar', 'log', 'wal', 'redpanda'],
  event_bus: ['pubsub', 'sns', 'eventbridge', 'topic', 'fanout'],
  dead_letter_queue: ['dlq', 'poison', 'failed messages'],
  workflow_engine: ['temporal', 'step functions', 'airflow', 'cadence', 'durable'],
  saga_orchestrator: ['saga', 'compensation', 'coordinator'],
  cdc_connector: ['debezium', 'cdc', 'change data capture', 'binlog', 'logical replication'],
  sql_db: ['postgres', 'postgresql', 'mysql', 'rds', 'aurora', 'oltp', 'relational'],
  read_replica: ['replica', 'follower', 'standby', 'hot standby'],
  nosql_db: ['dynamodb', 'mongo', 'mongodb', 'cassandra', 'scylla', 'bigtable'],
  blob_store: ['s3', 'gcs', 'object storage', 'bucket', 'minio', 'blob'],
  search_index: ['elasticsearch', 'opensearch', 'solr', 'typesense', 'meilisearch', 'lucene'],
  vector_db: ['pinecone', 'pgvector', 'qdrant', 'weaviate', 'milvus', 'embedding index'],
  data_warehouse: ['snowflake', 'bigquery', 'redshift', 'warehouse', 'dwh'],
  olap_db: ['clickhouse', 'druid', 'pinot', 'olap', 'columnar'],
  timeseries_db: ['prometheus', 'influx', 'timescale', 'metrics store'],
  graph_db: ['neo4j', 'neptune', 'graph'],
  data_lake: ['lake', 'iceberg', 'delta', 'parquet', 'lakehouse'],
  load_balancer: ['alb', 'nlb', 'elb', 'haproxy', 'lb'],
  reverse_proxy: ['nginx', 'envoy', 'traefik', 'caddy', 'proxy'],
  api_gateway: ['kong', 'apigee', 'api gw', 'gateway'],
  graphql_gateway: ['graphql', 'apollo', 'federation'],
  bff: ['backend for frontend', 'edge api'],
  service_mesh: ['istio', 'linkerd', 'sidecar', 'mesh'],
  waf: ['firewall', 'cloudflare', 'shield', 'ddos'],
  cdn: ['cloudfront', 'fastly', 'akamai', 'edge cache'],
  container_platform: ['kubernetes', 'k8s', 'ecs', 'nomad', 'fargate', 'orchestrator'],
  serverless_fn: ['lambda', 'cloud function', 'faas'],
  edge_function: ['cloudflare worker', 'edge worker', 'middleware'],
  vm: ['ec2', 'instance', 'droplet', 'server'],
  batch_job: ['batch', 'etl', 'spark', 'nightly job'],
  scheduler: ['cron', 'timer', 'periodic'],
  worker: ['consumer', 'background worker', 'processor'],
  rate_limiter: ['throttle', 'token bucket', 'quota'],
  websocket_gw: ['websocket', 'sse', 'realtime', 'socket'],
  llm: ['gpt', 'claude', 'model', 'inference', 'openai'],
  model_router: ['router', 'model tiering', 'fallback model'],
  guardrail: ['moderation', 'safety filter', 'content filter'],
  reranker: ['rerank', 'cross-encoder', 'colbert'],
  agent_runtime: ['agent', 'tool use', 'react loop'],
  eval_gate: ['evals', 'golden set', 'llm judge', 'regression'],
  feature_store: ['feast', 'features', 'ml features'],
  embedding_svc: ['embeddings', 'encoder', 'vectorise'],
  iam: ['rbac', 'authz', 'permissions', 'roles', 'policy'],
  kms: ['keys', 'encryption', 'vault', 'hsm', 'secrets encryption'],
  audit_log: ['audit', 'compliance log', 'trail'],
  secrets_manager: ['secrets', 'vault', 'parameter store'],
  feature_flags: ['launchdarkly', 'flags', 'toggles', 'unleash'],
  ci_cd: ['github actions', 'jenkins', 'pipeline', 'deploy', 'build'],
  observability: ['datadog', 'grafana', 'tracing', 'otel', 'logs', 'metrics', 'apm'],
  auth: ['oauth', 'oidc', 'login', 'keycloak', 'auth0', 'sso'],
  monolith: ['rails app', 'django app', 'single deploy'],
  group: ['region', 'vpc', 'cell', 'zone', 'boundary'],
};

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const addAtCenter = useCanvas((s) => s.addArchNodeAtCenter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQ('');
        setCursor(0);
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const hits = useMemo<(NodeSpec & { matchedAlias?: string })[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return NODE_CATALOG.slice(0, 9);
    const underscored = needle.replace(/\s+/g, '_');
    const scored = NODE_CATALOG.map((s) => {
      const aliases = ALIASES[s.type] ?? [];
      const aliasHit = aliases.find((a) => a.includes(needle) || needle.includes(a));
      // Rank exact-ish matches above merely-mentioned-in-the-hint matches.
      const rank = s.label.toLowerCase().startsWith(needle)
        ? 0
        : s.label.toLowerCase().includes(needle)
          ? 1
          : s.type.includes(underscored)
            ? 2
            : aliasHit
              ? 3
              : s.hint.toLowerCase().includes(needle)
                ? 4
                : 9;
      return { s, rank, aliasHit };
    });
    return scored
      .filter((x) => x.rank < 9)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 9)
      .map((x) => ({
        ...x.s,
        matchedAlias: x.rank === 3 ? x.aliasHit : undefined,
      })) as (NodeSpec & { matchedAlias?: string })[];
  }, [q]);

  if (!open) return null;

  const place = (index: number) => {
    const spec = hits[index];
    if (!spec) return;
    addAtCenter(spec.type);
    setOpen(false);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgb(8 10 14 / 0.6)',
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        className="card"
        style={{ width: 'min(440px, 90%)', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          placeholder="Add a component…"
          style={{ border: 'none', borderBottom: '1px solid var(--rule)', borderRadius: 0, padding: '9px 11px' }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              place(cursor);
            }
          }}
        />
        <div>
          {hits.map((spec, i) => {
            const Icon = NODE_ICONS[spec.type];
            return (
              <div
                key={spec.type}
                onClick={() => place(i)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 11px',
                  cursor: 'pointer',
                  background: i === cursor ? 'var(--ink-3)' : 'transparent',
                  borderLeft: `2px solid ${i === cursor ? spec.color : 'transparent'}`,
                }}
              >
                <span style={{ color: spec.color, display: 'grid', placeItems: 'center' }}>
                  <Icon size={15} />
                </span>
                <span style={{ fontSize: 12.5 }}>{spec.label}</span>
                {spec.matchedAlias && <span className="chip">{spec.matchedAlias}</span>}
                <span className="grow" />
                <span className="stencil" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {spec.category}
                </span>
              </div>
            );
          })}
          {hits.length === 0 && (
            <div style={{ padding: '10px 11px' }} className="faint">
              Nothing matches that.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
