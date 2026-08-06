// The HTTP surface: every way into the system from outside.
//
// Three detection strategies, in descending order of how much they can be trusted.
// Next.js routes are read off the directory structure, which is not analysis at all
// — the filesystem IS the route table, so those are 'observed' and exact. Imperative
// routers are found by matching call expressions with comments already stripped.
// Python decorators are matched by line shape, which is conventional enough to be
// right nearly always and is therefore marked 'inferred', because "nearly always"
// is not the same as "always" and the difference should be visible to the reader.

import type { AuthGuard, ScanEndpoint } from './types.js';
import { blankNoise, evidenceAt, importsOf, matchLines, type RepoSource } from './source.js';
import { importNamesIn, packageOf } from './deps.js';

/** Resolves a package name to the id of the component detected for it. */
export type TouchResolver = (packageName: string) => string | null;

const NEXT_ROUTE = /(?:^|\/)((?:src\/)?app\/.*?)route\.[tj]sx?$/;
const NEXT_PAGES_API = /(?:^|\/)((?:src\/)?pages\/api\/.*)\.[tj]sx?$/;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const ROUTER_RECEIVERS = /^(app|router|api|server|r|v1|routes?|blueprint|bp|fastify)$/i;

export function findEndpoints(
  source: RepoSource,
  deployableFor: (path: string) => string,
  touchOf: TouchResolver,
): ScanEndpoint[] {
  const out: ScanEndpoint[] = [];
  const seen = new Set<string>();

  const push = (e: ScanEndpoint) => {
    const key = `${e.method} ${e.path} ${e.evidence.file}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };

  for (const path of source.list()) {
    const content = source.read(path);
    if (!content) continue;

    // ------------------------------------------------- Next.js app router ---
    const appRoute = NEXT_ROUTE.exec(path);
    if (appRoute?.[1]) {
      const url = nextAppPath(appRoute[1]);
      const methods = exportedMethods(content);
      for (const method of methods.length ? methods : ['ANY']) {
        push({
          id: endpointId(method, url),
          method,
          path: url,
          deployable: deployableFor(path),
          framework: 'next',
          authGuard: guardIn(source, path, content),
          touches: touchesIn(source, path, touchOf),
          confidence: 'observed',
          evidence: { file: path, line: methodLine(content, method), snippet: `export ${method}` },
        });
      }
      continue;
    }

    // ------------------------------------------------ Next.js pages router ---
    const pagesApi = NEXT_PAGES_API.exec(path);
    if (pagesApi?.[1]) {
      const url = nextPagesPath(pagesApi[1]);
      push({
        id: endpointId('ANY', url),
        method: 'ANY',
        path: url,
        deployable: deployableFor(path),
        framework: 'next',
        authGuard: guardIn(source, path, content),
        touches: touchesIn(source, path, touchOf),
        confidence: 'observed',
        evidence: { file: path, line: 1, snippet: 'pages/api handler' },
      });
      continue;
    }

    // ------------------------------------------------------ server actions ---
    if (/^\s*['"]use server['"]/m.test(content.slice(0, 400))) {
      push({
        id: endpointId('ACTION', `/${path}`),
        method: 'ACTION',
        path: `/${path}`,
        deployable: deployableFor(path),
        framework: 'next',
        authGuard: guardIn(source, path, content),
        touches: touchesIn(source, path, touchOf),
        confidence: 'observed',
        // A server action is a POST endpoint the framework generates and nobody
        // writes a URL for, which is exactly why people forget to guard them.
        evidence: { file: path, line: 1, snippet: "'use server'" },
      });
    }

    // ---------------------------------------- imperative routers (JS/TS) ---
    if (/\.[tj]sx?$/.test(path) || /\.[cm]js$/.test(path)) {
      for (const hit of matchLines(
        content,
        /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/,
      )) {
        const [, receiver, verb, url] = hit.match;
        if (!receiver || !verb || !url) continue;
        if (!ROUTER_RECEIVERS.test(receiver) && !/router$|app$|routes$/i.test(receiver)) continue;
        if (!url.startsWith('/')) continue;
        push({
          id: endpointId(verb.toUpperCase(), url),
          method: verb.toUpperCase(),
          path: url,
          deployable: deployableFor(path),
          framework: frameworkOf(content),
          authGuard: guardIn(source, path, content),
          touches: touchesIn(source, path, touchOf),
          confidence: 'observed',
          evidence: evidenceAt(path, content, hit.line),
        });
      }
    }

    // ------------------------------------------------ Python decorators ---
    if (path.endsWith('.py')) {
      for (const hit of matchLines(
        content,
        /^\s*@\s*([A-Za-z_][\w.]*)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/,
      )) {
        const [, , verb, url] = hit.match;
        if (!verb || !url) continue;
        push({
          id: endpointId(verb.toUpperCase(), url),
          method: verb.toUpperCase(),
          path: url,
          deployable: deployableFor(path),
          framework: /fastapi/i.test(content) ? 'fastapi' : 'python',
          authGuard: guardIn(source, path, content),
          touches: touchesIn(source, path, touchOf),
          confidence: 'inferred',
          evidence: evidenceAt(path, content, hit.line),
        });
      }
      // Flask's @app.route carries its verbs in a keyword argument, defaulting to GET.
      for (const hit of matchLines(
        content,
        /^\s*@\s*([A-Za-z_][\w.]*)\s*\.\s*route\s*\(\s*['"]([^'"]+)['"]([^)]*)/,
      )) {
        const [, , url, rest] = hit.match;
        if (!url) continue;
        const declared = /methods\s*=\s*\[([^\]]*)\]/.exec(rest ?? '');
        const methods = declared?.[1]
          ? declared[1].split(',').map((m) => m.replace(/['"\s]/g, '').toUpperCase()).filter(Boolean)
          : ['GET'];
        for (const method of methods) {
          push({
            id: endpointId(method, url),
            method,
            path: url,
            deployable: deployableFor(path),
            framework: 'flask',
            authGuard: guardIn(source, path, content),
            touches: touchesIn(source, path, touchOf),
            confidence: 'inferred',
            evidence: evidenceAt(path, content, hit.line),
          });
        }
      }
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// --------------------------------------------------------------- Next paths ---

/**
 * `src/app/api/chat/[id]/` -> `/api/chat/:id`.
 *
 * Route groups in parentheses organise files without appearing in the URL, and
 * getting that wrong invents endpoints nobody can call.
 */
export function nextAppPath(dir: string): string {
  const segments = dir
    .replace(/^src\//, '')
    .replace(/^app\/?/, '')
    .split('/')
    .filter(Boolean)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .filter((s) => !s.startsWith('@'))
    .map((s) => {
      if (/^\[\.\.\..+\]$/.test(s)) return '*';
      if (/^\[.+\]$/.test(s)) return `:${s.slice(1, -1).replace(/^\.\.\./, '')}`;
      return s;
    });
  return `/${segments.join('/')}`.replace(/\/+$/, '') || '/';
}

export function nextPagesPath(filePath: string): string {
  const segments = filePath
    .replace(/^src\//, '')
    .replace(/^pages\//, '')
    .split('/')
    .filter(Boolean)
    .map((s) => (/^\[\.\.\..+\]$/.test(s) ? '*' : /^\[.+\]$/.test(s) ? `:${s.slice(1, -1)}` : s));
  if (segments[segments.length - 1] === 'index') segments.pop();
  return `/${segments.join('/')}`.replace(/\/+$/, '') || '/';
}

function exportedMethods(content: string): string[] {
  const code = blankNoise(content);
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${m}\\b|const\\s+${m}\\s*=)`).test(code) ||
    new RegExp(`export\\s*\\{[^}]*\\b${m}\\b`).test(code),
  );
}

function methodLine(content: string, method: string): number {
  const hits = matchLines(content, new RegExp(`\\b${method}\\b`));
  return hits[0]?.line ?? 1;
}

function frameworkOf(content: string): string {
  if (/from\s+['"]hono/.test(content)) return 'hono';
  if (/from\s+['"]fastify|require\(['"]fastify/.test(content)) return 'fastify';
  if (/from\s+['"]express|require\(['"]express/.test(content)) return 'express';
  return 'node';
}

// ------------------------------------------------------------- auth + reach ---

const GUARD_PATTERNS = [
  /\bgetUser\s*\(/,
  /\bgetSession\s*\(/,
  /\bgetClaims\s*\(/,
  /\brequireUser\b/,
  /\bauth\s*\(\s*\)/,
  /\bcurrentUser\s*\(/,
  /\bverify(Token|Jwt|Session)\b/i,
  /\bjwt\.verify\b/,
  /\bDepends\s*\(\s*[\w.]*(auth|current_user|get_user)/i,
  /\blogin_required\b/,
  /\bauthorization\b/i,
  /\bclerkClient\b|\bauthMiddleware\b|\bwithAuth\b/,
];

/**
 * Whether anything in this handler checks who is calling.
 *
 * Looks one hop through local imports, because the guard is usually a helper in
 * `lib/auth.ts` rather than inline. Deliberately generous: a false 'found' merely
 * declines to raise a finding, while a false 'none' accuses somebody of a hole
 * they do not have, and only one of those two errors destroys trust.
 */
function guardIn(source: RepoSource, path: string, content: string): AuthGuard {
  const bodies = [content, ...importsOf(source, path).map((p) => source.read(p) ?? '')];
  for (const body of bodies) {
    const code = blankNoise(body);
    if (GUARD_PATTERNS.some((re) => re.test(code))) return 'found';
  }
  // Middleware covering everything is a real guard, but proving which routes it
  // covers needs matcher analysis this pass does not do. Say unknown, not none.
  const middleware = source.list().find((p) => /(^|\/)middleware\.[tj]sx?$/.test(p));
  if (middleware) {
    const code = blankNoise(source.read(middleware) ?? '');
    if (GUARD_PATTERNS.some((re) => re.test(code))) return 'unknown';
  }
  return 'none';
}

/**
 * Which detected components this handler reaches, one import hop out.
 *
 * Always approximate — it answers "is this module in scope here", not "is it called
 * on this path" — so every consumer treats the result as a suggestion. It is the
 * seed for candidate flows, never a declared flow.
 */
function touchesIn(source: RepoSource, path: string, touchOf: TouchResolver): string[] {
  const bodies = [path, ...importsOf(source, path)];
  const found = new Set<string>();
  for (const file of bodies) {
    const body = source.read(file);
    if (!body) continue;
    for (const spec of importNamesIn(body)) {
      const id = touchOf(packageOf(spec));
      if (id) found.add(id);
    }
  }
  return [...found].sort();
}

export function endpointId(method: string, path: string): string {
  return `${method} ${path}`;
}

/** Which deployable a file belongs to: the deepest declared root that contains it. */
export function deployableResolver(roots: { id: string; root: string }[]): (path: string) => string {
  const sorted = [...roots].sort((a, b) => b.root.length - a.root.length);
  return (path: string) => {
    const hit = sorted.find((r) => (r.root === '' ? true : path.startsWith(`${r.root}/`)));
    return hit?.id ?? 'app';
  };
}

