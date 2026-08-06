// What stands between this repository and being safely reachable from the internet.
//
// The rules here are the reason somebody scans their repo at eleven at night, and
// they are also the fastest way to lose them. A miss is a disappointment; a
// confident false accusation is a reason to close the tab. So two disciplines apply
// throughout:
//
//   1. A reachability claim must carry the chain that proves it. If the import path
//      cannot be produced, the finding is downgraded rather than shipped.
//   2. Where a guess is unavoidable, it is marked 'inferred' and worded as a
//      question. "No rate limit was found near your model call" is checkable.
//      "You have no rate limit" is a claim about code the scanner never saw.

import type { Detected, Evidence, EnvVar, Exposure, ScanEndpoint } from './types.js';
import { blankNoise, clientReachable, evidenceAt, lines, matchLines, type RepoSource } from './source.js';

/** Names that look like they hold a credential. */
const SECRETISH = /(SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|_KEY$|^.*API_KEY|TOKEN|CREDENTIAL|DSN|CONNECTION_STRING)/i;

/** Names that are meant to be public, so their shape must not trigger the rule. */
const PUBLIC_BY_DESIGN = /(ANON_KEY|PUBLISHABLE|PUBLIC_KEY|CLIENT_ID|_URL$|_HOST$|_REGION$)/i;

/** The marker the collecting agent leaves where a secret used to be. */
const REDACTED = /«redacted[^»]*»/;

const RAW_SECRET =
  /\b(sk-ant-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;

export interface ExposureInput {
  source: RepoSource;
  endpoints: ScanEndpoint[];
  datastores: Detected[];
  externals: Detected[];
  ai: Detected[];
}

export interface ExposureResult {
  exposures: Exposure[];
  env: EnvVar[];
}

export function findExposures(input: ExposureInput): ExposureResult {
  const { source, endpoints, datastores, ai } = input;
  const out: Exposure[] = [];
  const reach = clientReachable(source);
  const env = readEnv(source, reach);

  let n = 0;
  const add = (e: Omit<Exposure, 'id'>) => {
    out.push({ ...e, id: `exp-${(n += 1)}` });
  };

  // 1 -------------------------------------------------- secret in the browser ---
  //
  // The single most valuable thing this scanner can say, and the one that must
  // never be said without proof. Every finding here prints the import chain.
  for (const v of env) {
    if (!v.secretish || !v.clientReachable) continue;
    const holder = v.readIn.find((f) => reach.has(f));
    const chain = holder ? reach.get(holder) : undefined;
    if (!chain || chain.length === 0) continue;
    const content = holder ? source.read(holder) ?? '' : '';
    const line = matchLines(content, new RegExp(v.name))[0]?.line ?? 1;
    add({
      rule: 'secret-reaches-client',
      severity: 'critical',
      title: `${v.name} can reach the browser`,
      detail:
        `${v.name} is read in ${holder}, and that file is bundled into the client. ` +
        `Anything shipped to a browser is readable by anyone who opens developer tools — ` +
        `a service-role key there is full database access handed to every visitor.`,
      fix:
        'Move the read into a server-only file — a route handler, a server action, or a module that no client component imports — and pass only the result to the browser.',
      source: 'loadbearing',
      confidence: 'observed',
      evidence: [evidenceAt(holder!, content, line)],
      path: chain,
    });
  }

  // 2 --------------------------------------------- public env holding a secret ---
  for (const v of env) {
    if (!/^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)/.test(v.name)) continue;
    if (PUBLIC_BY_DESIGN.test(v.name) || !SECRETISH.test(v.name)) continue;
    add({
      rule: 'public-env-holds-secret',
      severity: 'critical',
      title: `${v.name} is published to the browser by its prefix`,
      detail:
        `The framework inlines every variable with this prefix into the client bundle at build time. ` +
        `The name suggests it holds a credential, which would then be public.`,
      fix: `Drop the public prefix and read it server-side, or confirm the value really is meant to be public.`,
      source: 'loadbearing',
      confidence: 'observed',
      evidence: [{ file: v.readIn[0] ?? '.env', line: 0, snippet: v.name }],
    });
  }

  // 3 ----------------------------------------------------- secret in the source ---
  for (const path of source.list()) {
    const content = source.read(path);
    if (!content) continue;
    const assigned = matchLines(
      content,
      /\b(\w*(?:key|token|secret|password|dsn)\w*)\s*[:=]\s*['"`]([^'"`]{8,})['"`]/i,
    );
    for (const hit of assigned) {
      const name = hit.match[1];
      const value = hit.match[2];
      if (!name || !value) continue;
      const isRedacted = REDACTED.test(value);
      const isRaw = RAW_SECRET.test(value);
      // A redaction marker is not a false positive to be filtered out — it is the
      // finding, preserved. The collecting agent replaced the value precisely so
      // this rule could still fire without the secret ever leaving the machine.
      if (!isRedacted && !isRaw) continue;
      if (/process\.env|os\.environ|getenv|import\.meta\.env/.test(hit.match[0])) continue;
      add({
        rule: 'hardcoded-secret',
        severity: 'critical',
        title: `A credential is written into ${path}`,
        detail:
          `${name} is assigned a literal value in source. Anything in the repository is in its ` +
          `git history forever, readable by anyone who ever gets a copy — including a future public push.`,
        fix: 'Move it to an environment variable, then rotate it: a key that has been committed must be treated as leaked even after the commit is removed.',
        source: 'loadbearing',
        confidence: isRaw ? 'observed' : 'inferred',
        evidence: [evidenceAt(path, content, hit.line)],
      });
    }
  }

  // 4 ------------------------------------------------------- unguarded endpoints ---
  const sensitive = new Set([...datastores, ...ai].map((d) => d.id));
  for (const e of endpoints) {
    if (e.authGuard !== 'none') continue;
    const reached = e.touches.filter((t) => sensitive.has(t));
    if (reached.length === 0) continue;
    const isAi = ai.some((a) => reached.includes(a.id));
    add({
      rule: 'unguarded-endpoint',
      severity: isAi ? 'critical' : 'high',
      title: `${e.method} ${e.path} has no sign-in check`,
      detail: isAi
        ? `Nothing in this handler checks who is calling, and it reaches a model API. Anyone who finds the URL can spend your tokens — this is how a hobby project runs up a four-figure bill overnight.`
        : `Nothing in this handler checks who is calling, and it reaches a datastore. Anyone who finds the URL can use it.`,
      fix: 'Read the session at the top of the handler and return 401 when there is none. If it is genuinely public, add a rate limit instead.',
      source: 'loadbearing',
      // The guard may be in middleware this pass cannot attribute to a route, so
      // this is offered as a question, not a verdict.
      confidence: 'inferred',
      evidence: [e.evidence],
    });
  }

  // 5 ----------------------------------------------------------- no spend ceiling ---
  const llms = ai.filter((a) => a.nodeType === 'llm' || a.nodeType === 'agent_runtime');
  const hasCeiling = [...input.externals, ...input.datastores, ...ai].some(
    (d) => d.nodeType === 'rate_limiter' || d.nodeType === 'budget_guard',
  );
  const firstLlm = llms[0];
  if (firstLlm && !hasCeiling) {
    add({
      rule: 'llm-without-ceiling',
      severity: 'high',
      title: 'Nothing limits what the model calls can cost',
      detail:
        `${llms.map((l) => l.label).join(' and ')} is called, and no rate limiter or token budget was found anywhere in the repository. ` +
        `A metered API with no ceiling turns any loop, retry storm or bored stranger into your bill.`,
      fix: 'Add a per-user rate limit in front of the endpoint, cap tokens per request, and set a spend alert with the provider.',
      source: 'loadbearing',
      confidence: 'inferred',
      evidence: firstLlm.evidence.slice(0, 1),
    });
  }

  // 6 ------------------------------------------------------------ committed .env ---
  const gitignore = source.read('.gitignore') ?? '';
  const ignoresEnv = /^\s*\.env/m.test(gitignore);
  const envFiles = source.list().filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !/\.example$/.test(p));
  const firstEnvFile = envFiles[0];
  if (firstEnvFile && !ignoresEnv) {
    add({
      rule: 'env-file-committed',
      severity: 'high',
      title: `${firstEnvFile} is not ignored by git`,
      detail:
        `.gitignore does not exclude it, so the file and everything in it is committed to history. ` +
        `Making the repository public later publishes every key it has ever held.`,
      fix: 'Add `.env*` to .gitignore, remove the file from the index, and rotate anything it contained.',
      source: 'loadbearing',
      confidence: 'observed',
      evidence: [{ file: firstEnvFile, line: 0, snippet: firstEnvFile }],
    });
  }

  // 7 ----------------------------------------------------------- wide-open CORS ---
  for (const path of source.list()) {
    const content = source.read(path);
    if (!content) continue;
    for (const hit of matchLines(
      content,
      /(origin\s*:\s*['"`]\*['"`]|allow_origins\s*=\s*\[\s*["']\*["']|Access-Control-Allow-Origin['"`\s:,]+\*)/,
    )) {
      add({
        rule: 'cors-wildcard',
        severity: 'medium',
        title: 'Any website may call this API from a browser',
        detail:
          'CORS is set to allow every origin. Combined with cookie-based sessions this lets another site make authenticated requests as your signed-in user.',
        fix: 'Name the origins you actually serve. If the API is public and token-authenticated, this may be fine — decide it rather than inherit it.',
        source: 'loadbearing',
        confidence: 'observed',
        evidence: [evidenceAt(path, content, hit.line)],
      });
      break;
    }
  }

  // 8 -------------------------------------------------------- Supabase without RLS ---
  const usesSupabase = [...datastores, ...input.externals].some((d) => /supabase/i.test(d.label));
  if (usesSupabase) {
    const sql = source.list().filter((p) => p.endsWith('.sql'));
    const enablesRls = sql.some((p) => /enable\s+row\s+level\s+security/i.test(source.read(p) ?? ''));
    if (!enablesRls) {
      add({
        rule: 'no-rls-found',
        severity: sql.length ? 'high' : 'medium',
        title: 'No row-level security was found in your migrations',
        detail:
          sql.length
            ? `${sql.length} SQL file(s) were scanned and none enables row level security. Supabase exposes tables directly to the browser through the anon key, and without RLS every row is readable by everyone.`
            : 'No migrations were collected, so this could not be checked. With Supabase the anon key reaches the database directly from the browser, and RLS is the only thing standing between a visitor and every row.',
        fix: 'Enable RLS on every table holding user data and write a policy per table. Verify by querying with the anon key as a signed-out user.',
        source: 'loadbearing',
        confidence: 'inferred',
        evidence: sql[0] ? [{ file: sql[0], line: 0, snippet: sql[0] }] : [],
      });
    }
  }

  // 9 ------------------------------------------------------ SQL built by string ---
  for (const path of source.list()) {
    const content = source.read(path);
    if (!content) continue;
    for (const hit of matchLines(
      content,
      /(?:query|execute|raw)\s*\(\s*[`'"][^`'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^`'"]*(?:\$\{|"\s*\+|'\s*\+|%\s*\()/i,
    )) {
      add({
        rule: 'sql-string-built',
        severity: 'high',
        title: `A SQL statement is assembled from a string in ${path}`,
        detail:
          'Values pasted into SQL text are executed as SQL. A name containing an apostrophe breaks the query; a name chosen carefully reads or deletes the table.',
        fix: 'Use parameters — `query("… WHERE id = $1", [id])` — so the value can never be read as syntax.',
        source: 'loadbearing',
        confidence: 'inferred',
        evidence: [evidenceAt(path, content, hit.line)],
      });
      break;
    }
  }

  return { exposures: rank(out), env };
}

const SEVERITY_ORDER: Record<Exposure['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function rank(list: Exposure[]): Exposure[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.confidence === b.confidence ? 0 : a.confidence === 'observed' ? -1 : 1) ||
      a.rule.localeCompare(b.rule),
  );
}

// ---------------------------------------------------------------- environment ---

/**
 * Every environment variable the code reads, plus whatever the redacted .env files
 * declared, and whether a browser bundle can reach the code that reads it.
 *
 * The `.env` side only ever contains names and shapes — the collecting agent strips
 * values before anything is sent — so this can describe what the app expects
 * without ever having held a secret.
 */
export function readEnv(source: RepoSource, reach: Map<string, string[]>): EnvVar[] {
  const byName = new Map<string, EnvVar>();

  const touch = (name: string, file: string | null, shape?: string) => {
    const existing = byName.get(name);
    const entry: EnvVar =
      existing ?? { name, readIn: [], clientReachable: false, secretish: isSecretish(name) };
    if (file && !entry.readIn.includes(file)) entry.readIn.push(file);
    if (file && reach.has(file)) entry.clientReachable = true;
    if (shape && !entry.shape) entry.shape = shape;
    byName.set(name, entry);
  };

  for (const path of source.list()) {
    const content = source.read(path);
    if (!content) continue;

    if (/(^|\/)\.env(\.|$)/.test(path)) {
      for (const line of lines(content)) {
        const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
        if (!m?.[1]) continue;
        const shape = /shape=([A-Za-z0-9_-]+)/.exec(m[2] ?? '')?.[1];
        touch(m[1], null, shape);
      }
      continue;
    }

    const code = blankNoise(content);
    const re = /(?:process\.env\.|import\.meta\.env\.|process\.env\[['"]|os\.environ\[['"]|os\.environ\.get\(\s*['"]|os\.getenv\(\s*['"])([A-Z][A-Z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      if (m[1]) touch(m[1], path);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function isSecretish(name: string): boolean {
  if (PUBLIC_BY_DESIGN.test(name)) return false;
  return SECRETISH.test(name);
}

export function evidenceFor(file: string, content: string, line: number): Evidence {
  return evidenceAt(file, content, line);
}
