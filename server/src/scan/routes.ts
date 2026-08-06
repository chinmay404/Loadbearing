// Receiving a repository.
//
// The analysis itself lives in `shared`, is deterministic, and never calls a model.
// What is left here is everything about receiving somebody else's source code
// safely: how much of it to accept, what to refuse outright, what to keep, and —
// the part that matters most — what never to store.
//
// Only evidence snippets persist. The files are scanned in memory and dropped on
// the way out of this handler. A user who scans a private repository has left five
// lines per finding behind, not a copy of their codebase, and that is a promise the
// code has to keep rather than the documentation.

import { Hono } from 'hono';
import {
  candidateFlows,
  inventory,
  scanFiles,
  summariseTrace,
  type RepoScan,
  type SarifAttachment,
  type SourceFile,
} from '@loadbearing/shared';
import { storage } from '../storage/index.js';
import { requireUser, type AppEnv } from '../auth/middleware.js';

export const scanRoutes = new Hono<AppEnv>();

/**
 * Caps.
 *
 * Generous enough for any repository somebody vibe-coded, tight enough that one
 * request cannot exhaust a serverless function's memory or its time budget. Every
 * limit reports itself in `coverage` rather than failing silently, because a scan
 * that quietly dropped half the repo reads exactly like a complete one.
 */
const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 1_500_000;
const MAX_FILE_BYTES = 120_000;
const MAX_SCANS_KEPT = 20;

/** Paths that must never be accepted, whatever the sender claims about them. */
const FORBIDDEN = /(^|\/)(\.git\/|node_modules\/|\.pem$|\.p12$|\.keystore$|id_rsa|\.ssh\/|\.aws\/)/i;

interface ScanBody {
  projectName?: string;
  files?: { path?: string; content?: string }[];
  sarif?: SarifAttachment[];
  meta?: { filesSeen?: number; truncated?: string[]; skipped?: string[]; dropped?: string[] };
}

scanRoutes.post('/scan', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => null)) as ScanBody | null;
  if (!body || !Array.isArray(body.files)) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Body must include a files array.',
          hint: 'Send { projectName, files: [{ path, content }], sarif?, meta? }. Paths are repo-relative with forward slashes. Redact secrets before sending — see the loadbearing-scan skill.',
        },
      },
      400,
    );
  }

  const accepted: SourceFile[] = [];
  const refused: string[] = [];
  const truncated: string[] = [...(body.meta?.truncated ?? [])];
  const dropped: string[] = [...(body.meta?.dropped ?? [])];
  let total = 0;

  for (const raw of body.files) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    const content = typeof raw?.content === 'string' ? raw.content : '';
    if (!path) continue;
    if (FORBIDDEN.test(path)) {
      refused.push(path);
      continue;
    }
    if (accepted.length >= MAX_FILES) {
      dropped.push(path);
      continue;
    }
    let text = content;
    if (text.length > MAX_FILE_BYTES) {
      text = `${text.slice(0, MAX_FILE_BYTES)}\n// …truncated by Loadbearing…`;
      truncated.push(path);
    }
    if (total + text.length > MAX_TOTAL_BYTES) {
      dropped.push(path);
      continue;
    }
    total += text.length;
    accepted.push({ path, content: text });
  }

  if (accepted.length === 0) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'No usable files were sent.',
          hint: 'Every path was empty or refused. Send manifests (package.json, requirements.txt), deploy config, and route files from the repository root.',
        },
      },
      400,
    );
  }

  const scan = scanFiles(accepted, {
    projectName: body.projectName,
    sarif: Array.isArray(body.sarif) ? body.sarif : [],
    meta: {
      filesSeen: body.meta?.filesSeen ?? body.files.length,
      truncated,
      skipped: body.meta?.skipped ?? [],
      dropped,
    },
  });

  if (refused.length > 0) {
    // Refusing a private key is right, and doing it silently is not: the sender
    // should learn its collection rules are too wide before it does this again.
    scan.coverage.skipped = [...scan.coverage.skipped, ...refused];
    scan.coverage.notes.push(
      `${refused.length} file(s) were refused by the server as credential material and never read.`,
    );
  }

  const id = await persist(c.get('userId'), scan);
  return c.json({ id, scan, inventory: inventory(scan), candidateFlows: candidateFlows(scan) }, 201);
});

scanRoutes.get('/scan/:id', requireUser, async (c) => {
  const scan = await load(c.get('userId'), c.req.param('id'));
  if (!scan) return c.json({ error: { code: 'not_found', message: 'No such scan.' } }, 404);
  const trace = await loadTrace(c.get('userId'), c.req.param('id'));
  return c.json({
    id: c.req.param('id'),
    scan,
    inventory: inventory(scan),
    candidateFlows: candidateFlows(scan, trace ?? undefined),
    ...(trace ? { trace } : {}),
  });
});

scanRoutes.get('/scans', requireUser, async (c) => {
  return c.json({ scans: await index(c.get('userId')) });
});

/**
 * Trace ingest — the v2 half.
 *
 * One environment variable on the user's own machine produces spans that say what
 * their app actually costs, and those numbers replace catalogue guesses in the
 * simulator. The body is accepted in whatever shape the exporter emitted; the
 * parser normalises console output, JSON Lines and OTLP alike, because telling
 * somebody their trace file is the wrong dialect is a good way to end the session.
 */
scanRoutes.post('/scan/:id/trace', requireUser, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await load(userId, id))) {
    return c.json({ error: { code: 'not_found', message: 'No such scan.' } }, 404);
  }

  const contentType = c.req.header('content-type') ?? '';
  const raw = contentType.includes('application/json')
    ? await c.req.json().catch(() => null)
    : await c.req.text().catch(() => null);
  if (raw === null || raw === '') {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'Send the spans as the request body.',
          hint: 'Anything the exporter wrote: OTLP JSON, JSON Lines, or the console exporter\'s output pasted verbatim.',
        },
      },
      400,
    );
  }

  const summary = summariseTrace(typeof raw === 'string' ? raw : (raw as { spans?: unknown }).spans ?? raw);
  if (summary.spans === 0) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: 'No spans were recognised in that body.',
          hint: 'Check the exporter actually ran: OTEL_TRACES_EXPORTER=console with @opentelemetry/auto-instrumentations-node/register loaded before the app starts.',
        },
      },
      400,
    );
  }

  await (await storage()).setSetting(userId, traceKey(id), JSON.stringify(summary));
  return c.json({ trace: summary }, 201);
});

// ------------------------------------------------------------------ storage ---
//
// Scans live in the per-user settings table rather than a table of their own.
// Both backends already implement it, both are already covered by the storage
// suite, and a schema change is a migration on two dialects for something that is
// one JSON document keyed by one string.

const scanKey = (id: string) => `scan:${id}`;
const traceKey = (id: string) => `scan:${id}:trace`;
const INDEX_KEY = 'scan:index';

export interface ScanIndexEntry {
  id: string;
  projectName: string;
  scannedAt: string;
  endpoints: number;
  criticals: number;
}

async function persist(userId: string, scan: RepoScan): Promise<string> {
  const store = await storage();
  const id = `${slugify(scan.projectName)}-${Date.now().toString(36)}`;
  await store.setSetting(userId, scanKey(id), JSON.stringify(scan));

  const entries = await index(userId);
  const next: ScanIndexEntry[] = [
    {
      id,
      projectName: scan.projectName,
      scannedAt: scan.scannedAt,
      endpoints: scan.endpoints.length,
      criticals: scan.exposures.filter((e) => e.severity === 'critical').length,
    },
    ...entries,
  ].slice(0, MAX_SCANS_KEPT);
  await store.setSetting(userId, INDEX_KEY, JSON.stringify(next));
  return id;
}

async function index(userId: string): Promise<ScanIndexEntry[]> {
  const raw = await (await storage()).getSetting(userId, INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScanIndexEntry[]) : [];
  } catch {
    return [];
  }
}

export async function load(userId: string, id: string): Promise<RepoScan | null> {
  const raw = await (await storage()).getSetting(userId, scanKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoScan;
  } catch {
    return null;
  }
}

export async function loadTrace(userId: string, id: string) {
  const raw = await (await storage()).getSetting(userId, traceKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReturnType<typeof summariseTrace>;
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'scan'
  );
}
