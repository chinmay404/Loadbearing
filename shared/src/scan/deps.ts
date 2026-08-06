// Dependency name -> what it means on a canvas.
//
// Deliberately a table and not a function. Supporting a new framework, database or
// model provider should be one row that a person can read and argue with, not a
// branch in a parser — and a table can be tested exhaustively, which a pile of
// conditionals cannot.
//
// `mechanism` is the annotation the component arrives with when somebody drags it
// out of the inventory. It states what the code is doing, never what the design
// should do: "Postgres via Supabase client" is a fact, "use connection pooling"
// is advice, and putting advice in an annotation would mean the grader is marking
// its own homework.

import type { ArchNodeType } from '../types.js';

export type DepGroup = 'datastore' | 'external' | 'ai' | 'infra';

export interface DepMapping {
  /** Exact package name, or a prefix ending in '*'. */
  match: string;
  nodeType: ArchNodeType;
  label: string;
  mechanism: string;
  group: DepGroup;
  /** Ecosystem, so a Python package cannot match a Node manifest. */
  eco: 'node' | 'python' | 'any';
  /** Extra components this dependency implies, e.g. a queue implies a worker. */
  implies?: { nodeType: ArchNodeType; label: string; mechanism: string; group: DepGroup }[];
}

export const DEP_TABLE: DepMapping[] = [
  // ------------------------------------------------------------- datastores ---
  {
    match: '@supabase/supabase-js',
    nodeType: 'sql_db',
    label: 'Supabase Postgres',
    mechanism: 'Postgres reached through the Supabase JS client',
    group: 'datastore',
    eco: 'node',
  },
  { match: 'supabase', nodeType: 'sql_db', label: 'Supabase Postgres', mechanism: 'Postgres via the Supabase Python client', group: 'datastore', eco: 'python' },
  { match: '@prisma/client', nodeType: 'sql_db', label: 'SQL database', mechanism: 'accessed through Prisma', group: 'datastore', eco: 'node' },
  { match: 'drizzle-orm', nodeType: 'sql_db', label: 'SQL database', mechanism: 'accessed through Drizzle', group: 'datastore', eco: 'node' },
  { match: 'pg', nodeType: 'sql_db', label: 'Postgres', mechanism: 'node-postgres client', group: 'datastore', eco: 'node' },
  { match: 'postgres', nodeType: 'sql_db', label: 'Postgres', mechanism: 'postgres.js client', group: 'datastore', eco: 'node' },
  { match: 'mysql2', nodeType: 'sql_db', label: 'MySQL', mechanism: 'mysql2 client', group: 'datastore', eco: 'node' },
  { match: 'better-sqlite3', nodeType: 'sql_db', label: 'SQLite', mechanism: 'file-backed SQLite', group: 'datastore', eco: 'node' },
  { match: 'psycopg*', nodeType: 'sql_db', label: 'Postgres', mechanism: 'psycopg client', group: 'datastore', eco: 'python' },
  { match: 'asyncpg', nodeType: 'sql_db', label: 'Postgres', mechanism: 'asyncpg client', group: 'datastore', eco: 'python' },
  { match: 'sqlalchemy', nodeType: 'sql_db', label: 'SQL database', mechanism: 'accessed through SQLAlchemy', group: 'datastore', eco: 'python' },
  { match: 'mongoose', nodeType: 'nosql_db', label: 'MongoDB', mechanism: 'documents via Mongoose', group: 'datastore', eco: 'node' },
  { match: 'mongodb', nodeType: 'nosql_db', label: 'MongoDB', mechanism: 'official MongoDB driver', group: 'datastore', eco: 'any' },
  { match: 'pymongo', nodeType: 'nosql_db', label: 'MongoDB', mechanism: 'PyMongo driver', group: 'datastore', eco: 'python' },
  { match: '@planetscale/database', nodeType: 'sql_db', label: 'PlanetScale MySQL', mechanism: 'serverless driver over HTTP', group: 'datastore', eco: 'node' },
  { match: '@neondatabase/serverless', nodeType: 'sql_db', label: 'Neon Postgres', mechanism: 'serverless driver over HTTP', group: 'datastore', eco: 'node' },
  { match: 'firebase*', nodeType: 'nosql_db', label: 'Firestore', mechanism: 'Firebase SDK', group: 'datastore', eco: 'any' },
  { match: '@upstash/redis', nodeType: 'cache', label: 'Upstash Redis', mechanism: 'Redis over HTTP', group: 'datastore', eco: 'node' },
  { match: 'ioredis', nodeType: 'cache', label: 'Redis', mechanism: 'ioredis client', group: 'datastore', eco: 'node' },
  { match: 'redis', nodeType: 'cache', label: 'Redis', mechanism: 'Redis client', group: 'datastore', eco: 'any' },
  { match: 'memcached', nodeType: 'cache', label: 'Memcached', mechanism: 'memcached client', group: 'datastore', eco: 'any' },
  { match: '@elastic/elasticsearch', nodeType: 'search_index', label: 'Elasticsearch', mechanism: 'full-text search index', group: 'datastore', eco: 'node' },
  { match: 'meilisearch', nodeType: 'search_index', label: 'Meilisearch', mechanism: 'full-text search index', group: 'datastore', eco: 'any' },
  { match: 'algoliasearch', nodeType: 'search_index', label: 'Algolia', mechanism: 'hosted search index', group: 'datastore', eco: 'any' },
  { match: 'neo4j-driver', nodeType: 'graph_db', label: 'Neo4j', mechanism: 'graph queries', group: 'datastore', eco: 'any' },

  // ------------------------------------------------------------ object store ---
  { match: '@aws-sdk/client-s3', nodeType: 'blob_store', label: 'S3', mechanism: 'object storage via AWS SDK v3', group: 'external', eco: 'node' },
  { match: 'boto3', nodeType: 'blob_store', label: 'S3', mechanism: 'object storage via boto3', group: 'external', eco: 'python' },
  { match: 'cloudinary', nodeType: 'blob_store', label: 'Cloudinary', mechanism: 'media storage and transforms', group: 'external', eco: 'any' },
  { match: '@vercel/blob', nodeType: 'blob_store', label: 'Vercel Blob', mechanism: 'object storage', group: 'external', eco: 'node' },
  { match: 'uploadthing', nodeType: 'blob_store', label: 'UploadThing', mechanism: 'hosted upload endpoint', group: 'external', eco: 'node' },

  // ------------------------------------------------------------------ queues ---
  {
    match: 'bullmq',
    nodeType: 'queue',
    label: 'BullMQ queue',
    mechanism: 'Redis-backed job queue',
    group: 'infra',
    eco: 'node',
    implies: [{ nodeType: 'worker', label: 'Job worker', mechanism: 'consumes the BullMQ queue', group: 'infra' }],
  },
  {
    match: 'celery',
    nodeType: 'queue',
    label: 'Celery queue',
    mechanism: 'broker-backed task queue',
    group: 'infra',
    eco: 'python',
    implies: [{ nodeType: 'worker', label: 'Celery worker', mechanism: 'consumes Celery tasks', group: 'infra' }],
  },
  { match: '@aws-sdk/client-sqs', nodeType: 'queue', label: 'SQS', mechanism: 'managed queue', group: 'infra', eco: 'node' },
  { match: 'amqplib', nodeType: 'queue', label: 'RabbitMQ', mechanism: 'AMQP broker', group: 'infra', eco: 'node' },
  { match: 'kafkajs', nodeType: 'stream', label: 'Kafka', mechanism: 'partitioned log', group: 'infra', eco: 'node' },
  { match: 'inngest', nodeType: 'workflow_engine', label: 'Inngest', mechanism: 'durable steps and retries', group: 'infra', eco: 'node' },
  { match: 'node-cron', nodeType: 'scheduler', label: 'Cron', mechanism: 'in-process schedule', group: 'infra', eco: 'node' },

  // ---------------------------------------------------------------- AI stack ---
  { match: '@anthropic-ai/sdk', nodeType: 'llm', label: 'Anthropic API', mechanism: 'metered LLM calls over HTTPS', group: 'ai', eco: 'node' },
  { match: 'anthropic', nodeType: 'llm', label: 'Anthropic API', mechanism: 'metered LLM calls over HTTPS', group: 'ai', eco: 'python' },
  { match: 'openai', nodeType: 'llm', label: 'OpenAI API', mechanism: 'metered LLM calls over HTTPS', group: 'ai', eco: 'any' },
  { match: '@google/generative-ai', nodeType: 'llm', label: 'Gemini API', mechanism: 'metered LLM calls over HTTPS', group: 'ai', eco: 'node' },
  { match: '@ai-sdk/*', nodeType: 'llm', label: 'LLM provider', mechanism: 'called through the Vercel AI SDK', group: 'ai', eco: 'node' },
  { match: 'ai', nodeType: 'llm', label: 'LLM provider', mechanism: 'called through the Vercel AI SDK, streamed to the browser', group: 'ai', eco: 'node' },
  { match: 'ollama', nodeType: 'model_server', label: 'Ollama', mechanism: 'self-hosted inference', group: 'ai', eco: 'any' },
  {
    match: 'langgraph',
    nodeType: 'agent_runtime',
    label: 'LangGraph agent',
    mechanism: 'stateful multi-step agent loop',
    group: 'ai',
    eco: 'any',
  },
  { match: 'langchain*', nodeType: 'agent_runtime', label: 'LangChain', mechanism: 'chained model calls and tools', group: 'ai', eco: 'any' },
  { match: 'llama-index*', nodeType: 'retriever', label: 'LlamaIndex', mechanism: 'retrieval over an index', group: 'ai', eco: 'any' },
  { match: 'llamaindex', nodeType: 'retriever', label: 'LlamaIndex', mechanism: 'retrieval over an index', group: 'ai', eco: 'any' },
  { match: 'crewai', nodeType: 'agent_runtime', label: 'CrewAI agents', mechanism: 'multi-agent orchestration', group: 'ai', eco: 'python' },
  { match: 'autogen*', nodeType: 'agent_runtime', label: 'AutoGen agents', mechanism: 'multi-agent orchestration', group: 'ai', eco: 'python' },
  { match: '@modelcontextprotocol/sdk', nodeType: 'mcp_server', label: 'MCP server', mechanism: 'tools exposed over MCP', group: 'ai', eco: 'node' },
  { match: '@pinecone-database/pinecone', nodeType: 'vector_db', label: 'Pinecone', mechanism: 'hosted vector index', group: 'ai', eco: 'node' },
  { match: 'pinecone*', nodeType: 'vector_db', label: 'Pinecone', mechanism: 'hosted vector index', group: 'ai', eco: 'python' },
  { match: 'chromadb', nodeType: 'vector_db', label: 'Chroma', mechanism: 'vector index', group: 'ai', eco: 'python' },
  { match: 'chromadb-client', nodeType: 'vector_db', label: 'Chroma', mechanism: 'vector index', group: 'ai', eco: 'python' },
  { match: '@qdrant/js-client-rest', nodeType: 'vector_db', label: 'Qdrant', mechanism: 'vector index', group: 'ai', eco: 'node' },
  { match: 'qdrant-client', nodeType: 'vector_db', label: 'Qdrant', mechanism: 'vector index', group: 'ai', eco: 'python' },
  { match: 'weaviate*', nodeType: 'vector_db', label: 'Weaviate', mechanism: 'vector index', group: 'ai', eco: 'any' },
  { match: 'faiss*', nodeType: 'vector_db', label: 'FAISS', mechanism: 'in-process vector index', group: 'ai', eco: 'python' },
  { match: 'pgvector', nodeType: 'vector_db', label: 'pgvector', mechanism: 'vectors inside Postgres', group: 'ai', eco: 'any' },
  { match: '@xenova/transformers', nodeType: 'embedding_svc', label: 'Local embeddings', mechanism: 'in-process embedding model', group: 'ai', eco: 'node' },
  { match: 'sentence-transformers', nodeType: 'embedding_svc', label: 'Local embeddings', mechanism: 'in-process embedding model', group: 'ai', eco: 'python' },
  { match: 'tiktoken', nodeType: 'budget_guard', label: 'Token counting', mechanism: 'counts tokens before a call', group: 'ai', eco: 'any' },
  { match: 'guardrails-ai', nodeType: 'guardrail', label: 'Guardrails', mechanism: 'validates model output against a schema', group: 'ai', eco: 'python' },
  { match: 'zod', nodeType: 'output_validator', label: 'Schema validation', mechanism: 'runtime schema checks', group: 'ai', eco: 'node' },

  // ------------------------------------------------------------- third party ---
  { match: 'stripe', nodeType: 'payment_gateway', label: 'Stripe', mechanism: 'card payments and webhooks', group: 'external', eco: 'any' },
  { match: 'resend', nodeType: 'email_provider', label: 'Resend', mechanism: 'transactional email over HTTPS', group: 'external', eco: 'any' },
  { match: 'nodemailer', nodeType: 'email_provider', label: 'SMTP mail', mechanism: 'mail sent over SMTP', group: 'external', eco: 'node' },
  { match: '@sendgrid/mail', nodeType: 'email_provider', label: 'SendGrid', mechanism: 'transactional email over HTTPS', group: 'external', eco: 'node' },
  { match: 'twilio', nodeType: 'sms_provider', label: 'Twilio', mechanism: 'SMS over HTTPS', group: 'external', eco: 'any' },
  { match: 'next-auth', nodeType: 'identity_provider', label: 'NextAuth', mechanism: 'session cookies and OAuth providers', group: 'external', eco: 'node' },
  { match: '@auth/*', nodeType: 'identity_provider', label: 'Auth.js', mechanism: 'session cookies and OAuth providers', group: 'external', eco: 'node' },
  { match: '@clerk/*', nodeType: 'identity_provider', label: 'Clerk', mechanism: 'hosted identity', group: 'external', eco: 'node' },
  { match: 'passport', nodeType: 'identity_provider', label: 'Passport', mechanism: 'authentication strategies', group: 'external', eco: 'node' },
  { match: '@sentry/*', nodeType: 'observability', label: 'Sentry', mechanism: 'error reporting', group: 'external', eco: 'any' },
  { match: '@opentelemetry/*', nodeType: 'observability', label: 'OpenTelemetry', mechanism: 'traces and metrics', group: 'external', eco: 'any' },
  { match: 'posthog*', nodeType: 'observability', label: 'PostHog', mechanism: 'product analytics', group: 'external', eco: 'any' },

  // -------------------------------------------------------------- protection ---
  { match: '@upstash/ratelimit', nodeType: 'rate_limiter', label: 'Upstash rate limit', mechanism: 'per-key request ceiling', group: 'infra', eco: 'node' },
  { match: 'express-rate-limit', nodeType: 'rate_limiter', label: 'Rate limiter', mechanism: 'per-IP request ceiling', group: 'infra', eco: 'node' },
  { match: 'slowapi', nodeType: 'rate_limiter', label: 'Rate limiter', mechanism: 'per-IP request ceiling', group: 'infra', eco: 'python' },
  { match: 'helmet', nodeType: 'waf', label: 'Security headers', mechanism: 'sets protective response headers', group: 'infra', eco: 'node' },

  // ------------------------------------------------------------- websockets ---
  { match: 'socket.io', nodeType: 'websocket_gw', label: 'Socket.IO', mechanism: 'persistent bidirectional connections', group: 'infra', eco: 'node' },
  { match: 'ws', nodeType: 'websocket_gw', label: 'WebSocket server', mechanism: 'persistent connections', group: 'infra', eco: 'node' },
];

/** Frameworks, which say what a deployable *is* rather than what it talks to. */
export const FRAMEWORKS: { match: string; framework: string; eco: 'node' | 'python' }[] = [
  { match: 'next', framework: 'next', eco: 'node' },
  { match: 'express', framework: 'express', eco: 'node' },
  { match: 'hono', framework: 'hono', eco: 'node' },
  { match: 'fastify', framework: 'fastify', eco: 'node' },
  { match: '@nestjs/core', framework: 'nest', eco: 'node' },
  { match: 'koa', framework: 'koa', eco: 'node' },
  { match: 'astro', framework: 'astro', eco: 'node' },
  { match: 'nuxt', framework: 'nuxt', eco: 'node' },
  { match: 'remix', framework: 'remix', eco: 'node' },
  { match: '@remix-run/*', framework: 'remix', eco: 'node' },
  { match: 'vite', framework: 'vite', eco: 'node' },
  { match: 'fastapi', framework: 'fastapi', eco: 'python' },
  { match: 'flask', framework: 'flask', eco: 'python' },
  { match: 'django', framework: 'django', eco: 'python' },
  { match: 'streamlit', framework: 'streamlit', eco: 'python' },
  { match: 'gradio', framework: 'gradio', eco: 'python' },
];

function matches(pattern: string, name: string): boolean {
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

/**
 * Every mapping a dependency name triggers.
 *
 * Longest pattern wins so `@ai-sdk/anthropic` is an LLM provider rather than
 * whatever a shorter prefix would have claimed, and an exact match always beats a
 * prefix — `redis` the package should not be shadowed by some future `redis*` row.
 */
export function lookupDep(name: string, eco: 'node' | 'python'): DepMapping | null {
  const candidates = DEP_TABLE.filter(
    (d) => (d.eco === eco || d.eco === 'any') && matches(d.match, name),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const exactA = a.match === name ? 1 : 0;
    const exactB = b.match === name ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    return b.match.length - a.match.length;
  });
  return candidates[0] ?? null;
}

export function lookupFramework(name: string, eco: 'node' | 'python'): string | null {
  const hit = FRAMEWORKS.filter((f) => f.eco === eco && matches(f.match, name)).sort(
    (a, b) => b.match.length - a.match.length,
  )[0];
  return hit ? hit.framework : null;
}

/**
 * Import specifiers that mean a dependency is genuinely used, not merely declared.
 *
 * A package in `dependencies` that nothing imports is a leftover, and drawing a
 * component for it puts a box on the canvas that does not exist in the running
 * system. Declared-but-unimported still gets reported — as inferred.
 */
export function importNamesIn(content: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:from\s+|import\s*\(?\s*|require\(\s*)['"]([^'".][^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const spec = m[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')) continue;
    out.add(packageOf(spec));
  }
  // Python: `import x`, `from x import y`, `import x.y as z`
  const py = /^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm;
  while ((m = py.exec(content))) {
    const root = m[1]?.split('.')[0];
    if (root) out.add(root);
  }
  return out;
}

/** `@scope/pkg/sub` -> `@scope/pkg`; `pkg/sub` -> `pkg`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}
