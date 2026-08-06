// What the application actually did, as opposed to what its source implies.
//
// Static analysis can tell you a handler imports the Anthropic SDK. It cannot tell
// you the call takes 2.4 seconds and blocks the request, which is the fact that
// decides the entire design. OpenTelemetry's zero-code instrumentation produces
// exactly that, for one environment variable and a minute of clicking, under
// Apache-2.0 and with no vendor involved:
//
//   OTEL_TRACES_EXPORTER=console \
//     node --require @opentelemetry/auto-instrumentations-node/register server.js
//
// So this module accepts spans in whatever shape came out — console exporter lines,
// a file of JSON objects, or an OTLP JSON body — normalises them, and turns each
// trace into a request path with measured service times. Those numbers seed the
// simulator, which is the difference between "at 50x load your database saturates"
// and a sentence about a database the learner has never measured.

import type {
  ArchNodeType,
  FlowKind,
} from '../types.js';
import type { ObservedComponent, ObservedFlow, TraceSpan, TraceSummary } from './types.js';

/**
 * Normalise anything span-shaped into TraceSpan[].
 *
 * Three input shapes are accepted because three are what people actually have,
 * and telling somebody their trace file is the wrong dialect at midnight is a
 * good way to end the session.
 */
export function parseSpans(input: unknown): TraceSpan[] {
  const raw = typeof input === 'string' ? parseLoose(input) : input;
  const spans: TraceSpan[] = [];

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;

    // OTLP JSON nests spans under resourceSpans[].scopeSpans[].spans[].
    if (Array.isArray(o.resourceSpans)) return visit(o.resourceSpans);
    if (Array.isArray(o.scopeSpans)) return visit(o.scopeSpans);
    if (Array.isArray(o.instrumentationLibrarySpans)) return visit(o.instrumentationLibrarySpans);
    if (Array.isArray(o.spans)) return visit(o.spans);

    const span = toSpan(o);
    if (span) spans.push(span);
  };

  visit(raw);
  return spans;
}

/** A console exporter emits pretty-printed objects back to back, not valid JSON. */
function parseLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to line and brace scanning */
  }

  const out: unknown[] = [];
  // JSON Lines first: the cheapest and most common file exporter format.
  const asLines = trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  let parsedAny = false;
  for (const line of asLines) {
    try {
      out.push(JSON.parse(line));
      parsedAny = true;
    } catch {
      /* not JSON Lines after all */
    }
  }
  if (parsedAny) return out;

  // Otherwise walk brace depth and parse each balanced object.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const c = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth += 1; continue; }
    if (c === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(trimmed.slice(start, i + 1)));
        } catch {
          /* an unbalanced fragment at the end of a truncated log */
        }
        start = -1;
      }
    }
  }
  return out;
}

function toSpan(o: Record<string, unknown>): TraceSpan | null {
  const name = str(o.name);
  if (!name) return null;

  const ctx = (o.spanContext ?? o.context) as Record<string, unknown> | undefined;
  const traceId = str(o.traceId) || str(ctx?.traceId);
  const spanId = str(o.spanId) || str(ctx?.spanId) || `${traceId}-${name}`;
  if (!traceId) return null;

  return {
    traceId,
    spanId,
    parentSpanId: str(o.parentSpanId) || str(o.parentId) || undefined,
    name,
    kind: kindOf(o.kind),
    durationMs: durationOf(o),
    attributes: flattenAttributes(o.attributes),
  };
}

/** Span kind arrives as a number in OTLP and a string from the console exporter. */
function kindOf(kind: unknown): string | undefined {
  if (typeof kind === 'string') return kind.replace(/^SPAN_KIND_/, '').toUpperCase();
  if (typeof kind === 'number') {
    return ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'][kind] ?? undefined;
  }
  return undefined;
}

/**
 * Duration, from whichever of the four representations is present.
 *
 * The console exporter writes `duration: [seconds, nanos]`; OTLP writes start and
 * end as nanosecond strings; some wrappers write plain milliseconds.
 */
function durationOf(o: Record<string, unknown>): number {
  if (Array.isArray(o.duration) && o.duration.length === 2) {
    return Number(o.duration[0]) * 1000 + Number(o.duration[1]) / 1e6;
  }
  if (typeof o.duration === 'number') return o.duration;
  if (typeof o.durationMs === 'number') return o.durationMs;
  const start = Number(o.startTimeUnixNano ?? o.startTime);
  const end = Number(o.endTimeUnixNano ?? o.endTime);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return (end - start) / 1e6;
  return 0;
}

function flattenAttributes(attrs: unknown): Record<string, string | number | boolean> | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    // OTLP: [{ key, value: { stringValue | intValue | ... } }]
    const out: Record<string, string | number | boolean> = {};
    for (const item of attrs) {
      const kv = item as { key?: string; value?: Record<string, unknown> };
      if (!kv?.key || !kv.value) continue;
      const v = kv.value.stringValue ?? kv.value.intValue ?? kv.value.doubleValue ?? kv.value.boolValue;
      if (v !== undefined) out[kv.key] = v as string | number | boolean;
    }
    return out;
  }
  if (typeof attrs === 'object') return attrs as Record<string, string | number | boolean>;
  return undefined;
}

// ------------------------------------------------------- spans -> components ---

/**
 * What a span is, in canvas vocabulary.
 *
 * Semantic conventions do most of the work: `db.system` means a database,
 * `http.url` on a CLIENT span means somebody else's API, `messaging.system` means a
 * queue. The host is kept in the ref so two different third parties do not collapse
 * into one box — an app that calls Stripe and Anthropic has two dependencies, and
 * merging them would hide the one that costs money.
 */
export function classifySpan(span: TraceSpan): { ref: string; label: string; nodeType: ArchNodeType } | null {
  const a = span.attributes ?? {};
  const kind = span.kind ?? 'INTERNAL';

  const dbSystem = str(a['db.system']);
  if (dbSystem) {
    const type: ArchNodeType = /redis|memcached/i.test(dbSystem)
      ? 'cache'
      : /mongo|dynamo|cassandra/i.test(dbSystem)
        ? 'nosql_db'
        : 'sql_db';
    return { ref: `db:${dbSystem}`, label: labelForDb(dbSystem), nodeType: type };
  }

  const messaging = str(a['messaging.system']);
  if (messaging) {
    return { ref: `mq:${messaging}`, label: messaging, nodeType: /kafka|kinesis/i.test(messaging) ? 'stream' : 'queue' };
  }

  if (kind === 'SERVER') {
    const route = str(a['http.route']) || str(a['url.path']) || str(a['http.target']) || span.name;
    const method = str(a['http.request.method']) || str(a['http.method']) || 'ANY';
    return { ref: `http:${method} ${stripQuery(route)}`, label: `${method} ${stripQuery(route)}`, nodeType: 'service' };
  }

  if (kind === 'CLIENT' || kind === 'PRODUCER') {
    const host = str(a['server.address']) || str(a['net.peer.name']) || hostOf(str(a['http.url']) || str(a['url.full']));
    if (host) {
      return { ref: `http:${host}`, label: host, nodeType: thirdPartyType(host) };
    }
  }

  return null;
}

function thirdPartyType(host: string): ArchNodeType {
  if (/anthropic|openai|googleapis.*generative|mistral|groq|deepseek|bedrock/i.test(host)) return 'llm';
  if (/pinecone|qdrant|weaviate/i.test(host)) return 'vector_db';
  if (/stripe|paypal|adyen/i.test(host)) return 'payment_gateway';
  if (/sendgrid|resend|postmark|mailgun/i.test(host)) return 'email_provider';
  if (/twilio/i.test(host)) return 'sms_provider';
  if (/s3\.|blob\.|storage\./i.test(host)) return 'blob_store';
  if (/supabase|firebase/i.test(host)) return 'sql_db';
  if (/clerk|auth0|okta/i.test(host)) return 'identity_provider';
  return 'third_party';
}

function labelForDb(system: string): string {
  const map: Record<string, string> = {
    postgresql: 'Postgres',
    postgres: 'Postgres',
    mysql: 'MySQL',
    redis: 'Redis',
    mongodb: 'MongoDB',
    sqlite: 'SQLite',
  };
  return map[system.toLowerCase()] ?? system;
}

// ----------------------------------------------------------- spans -> flows ---

/**
 * Group spans into traces, and each trace into one request path.
 *
 * A flow is the entry span plus every classified descendant in the order they
 * started. Identical paths across many traces collapse into one flow carrying the
 * sample count and the percentiles, because "this happened 40 times and the 95th
 * percentile was 3.1 seconds" is an argument, and one example is an anecdote.
 */
export function summariseTrace(spansInput: unknown): TraceSummary {
  const spans = parseSpans(spansInput);
  const byTrace = new Map<string, TraceSpan[]>();
  for (const s of spans) byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]);

  const componentStats = new Map<string, { label: string; nodeType: ArchNodeType; times: number[] }>();
  const flowPaths = new Map<string, { steps: string[]; totals: number[] }>();
  const notes: string[] = [];
  let singleSpanTraces = 0;

  for (const [, group] of byTrace) {
    const classified = group
      .map((s) => ({ span: s, cls: classifySpan(s) }))
      .filter((x): x is { span: TraceSpan; cls: NonNullable<ReturnType<typeof classifySpan>> } => x.cls !== null);

    if (classified.length <= 1) singleSpanTraces += 1;

    for (const { span, cls } of classified) {
      const stat = componentStats.get(cls.ref) ?? { label: cls.label, nodeType: cls.nodeType, times: [] };
      stat.times.push(span.durationMs);
      componentStats.set(cls.ref, stat);
    }

    const entry = classified.find((c) => c.span.kind === 'SERVER') ?? classified[0];
    if (!entry) continue;
    const rest = classified.filter((c) => c !== entry);
    const steps = ['client', entry.cls.ref, ...dedupeConsecutive(rest.map((r) => r.cls.ref))];
    const key = steps.join(' > ');
    const path = flowPaths.get(key) ?? { steps, totals: [] };
    path.totals.push(entry.span.durationMs);
    flowPaths.set(key, path);
  }

  const components: ObservedComponent[] = [...componentStats.entries()]
    .map(([ref, s]) => ({
      ref,
      label: s.label,
      nodeType: s.nodeType,
      calls: s.times.length,
      p50Ms: round(percentile(s.times, 50)),
      p95Ms: round(percentile(s.times, 95)),
      maxMs: round(Math.max(...s.times)),
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);

  const flows: ObservedFlow[] = [...flowPaths.values()]
    .map((p, i) => ({
      id: `obs-${i + 1}`,
      name: nameForFlow(p.steps),
      kind: kindForFlow(p.steps),
      steps: p.steps,
      samples: p.totals.length,
      p50Ms: round(percentile(p.totals, 50)),
      p95Ms: round(percentile(p.totals, 95)),
    }))
    .sort((a, b) => b.samples - a.samples);

  if (byTrace.size === 0) notes.push('No spans were recognised. Check the exporter actually wrote traces.');
  if (singleSpanTraces === byTrace.size && byTrace.size > 0) {
    notes.push(
      'Every trace was a single span, so nothing downstream was instrumented. Auto-instrumentation usually needs to be loaded before the app imports its database and HTTP clients.',
    );
  }

  return { traces: byTrace.size, spans: spans.length, components, flows, notes };
}

function nameForFlow(steps: string[]): string {
  const entry = steps[1] ?? steps[0] ?? 'request';
  return entry.replace(/^http:/, '').replace(/^db:/, '');
}

function kindForFlow(steps: string[]): FlowKind {
  const entry = steps[1] ?? '';
  if (/^http:(POST|PUT|PATCH|DELETE)/.test(entry)) return 'write';
  if (steps.some((s) => s.startsWith('mq:'))) return 'async';
  return 'read';
}

function dedupeConsecutive(list: string[]): string[] {
  return list.filter((v, i) => v !== list[i - 1]);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function stripQuery(url: string): string {
  return url.split('?')[0] ?? url;
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/:]+)/i.exec(url);
  return m?.[1] ?? '';
}
