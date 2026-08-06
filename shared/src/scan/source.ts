// The only thing the scanner knows about a repository: a list of paths and a way
// to read one.
//
// Everything above this line is a pure function of those two calls, which is what
// lets the same scanner serve an agent that collected files locally and a tarball
// streamed out of GitHub, without either transport leaking into the analysis. It
// is also why the whole thing is testable from a literal object.

/** A repository, reduced to what analysis actually needs. */
export interface RepoSource {
  /** Every path available, repo-relative with forward slashes. */
  list(): string[];
  /** File contents, or null when the path was not collected. */
  read(path: string): string | null;
}

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * A source over an in-memory list of files.
 *
 * Paths are normalised on the way in — a leading './', a backslash or an absolute
 * Windows path from a careless caller would otherwise produce evidence links that
 * point nowhere and, worse, leak the user's directory layout into the UI.
 */
export function fileSource(files: SourceFile[]): RepoSource {
  const map = new Map<string, string>();
  for (const f of files) {
    const path = normalisePath(f.path);
    if (path) map.set(path, f.content ?? '');
  }
  const paths = [...map.keys()].sort();
  return {
    list: () => paths,
    read: (path) => map.get(normalisePath(path)) ?? null,
  };
}

export function normalisePath(raw: string): string {
  let p = String(raw ?? '').replace(/\\/g, '/').trim();
  // Absolute paths are a sender bug, but stripping the drive/root is kinder than
  // rejecting the whole payload for it.
  p = p.replace(/^[a-zA-Z]:\//, '').replace(/^\/+/, '');
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

// ------------------------------------------------------------------- reading ---

export function lines(content: string): string[] {
  return content.split(/\r?\n/);
}

/**
 * A few lines around a hit, trimmed and capped.
 *
 * Evidence is the feature's whole claim to being checkable, but it is also the
 * only part of the user's source that persists. Five lines is enough to see why
 * the scanner said what it said and short enough that storing it is not storing
 * their codebase.
 */
export function snippetAt(content: string, lineNo: number, span = 1): string {
  const all = lines(content);
  const start = Math.max(0, lineNo - 1);
  const end = Math.min(all.length, start + span);
  return all
    .slice(start, end)
    .map((l) => l.trim())
    .join('\n')
    .slice(0, 300);
}

export function evidenceAt(file: string, content: string, lineNo: number, span = 1) {
  return { file, line: lineNo, snippet: snippetAt(content, lineNo, span) };
}

/**
 * Blank out comments, keeping every newline and every string.
 *
 * Pattern matching over raw source finds `app.get(` inside a comment explaining
 * why you should not call `app.get(`, and reports a route that does not exist.
 * Comments are where the false positives live, so comments are what gets removed —
 * and false positives are the thing that makes people stop trusting a scanner.
 *
 * String *contents* are deliberately preserved: the literal inside `app.get('/x')`
 * is the route path, and a lexer that blanked it would delete the answer. The
 * lexer still has to track strings to know that a `#` or `//` inside one does not
 * open a comment, which is most of the work anyway.
 */
export function blankNoise(content: string): string {
  let out = '';
  let i = 0;
  const n = content.length;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'tick' | 'py3s' | 'py3d' = 'code';

  while (i < n) {
    const c = content[i];
    const next = content[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '#') { state = 'line'; out += ' '; i += 1; continue; }
      if (c === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === '"' && content.slice(i, i + 3) === '"""') { state = 'py3d'; out += '   '; i += 3; continue; }
      if (c === "'" && content.slice(i, i + 3) === "'''") { state = 'py3s'; out += '   '; i += 3; continue; }
      if (c === "'") { state = 'single'; out += "'"; i += 1; continue; }
      if (c === '"') { state = 'double'; out += '"'; i += 1; continue; }
      if (c === '`') { state = 'tick'; out += '`'; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    if (state === 'py3d' || state === 'py3s') {
      const close = state === 'py3d' ? '"""' : "'''";
      if (content.slice(i, i + 3) === close) { state = 'code'; out += '   '; i += 3; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    // Inside a quoted string: kept verbatim, because the literal is often the
    // answer. Only the escape pair is consumed as a unit, so a `\'` cannot be
    // mistaken for the closing quote.
    const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
    if (c === '\\') { out += content.slice(i, i + 2); i += 2; continue; }
    if (c === quote) { state = 'code'; out += quote; i += 1; continue; }
    out += c; i += 1; continue;
  }
  return out;
}

// ------------------------------------------------------------- import graph ---

const REL_IMPORT = /(?:from\s+|import\s*\(?\s*|require\(\s*)['"]([./][^'"]*)['"]/g;
const ALIAS_IMPORT = /(?:from\s+|import\s*\(?\s*|require\(\s*)['"](@\/[^'"]*|~\/[^'"]*)['"]/g;

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Which files a file imports, resolved against what was actually collected.
 *
 * Resolution is deliberately forgiving — extensionless imports, index files, and
 * the `@/` alias that every Next.js starter ships with. An unresolved import is
 * dropped rather than guessed at, because a wrong edge in this graph becomes a
 * wrong reachability claim, and reachability is what the security findings rest on.
 */
export function importsOf(source: RepoSource, path: string): string[] {
  const content = source.read(path);
  if (!content) return [];
  const code = blankNoise(content);
  const found = new Set<string>();

  for (const re of [REL_IMPORT, ALIAS_IMPORT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const spec = m[1];
      if (!spec) continue;
      const target = spec.startsWith('@/') || spec.startsWith('~/')
        ? resolveAlias(source, spec.slice(2))
        : resolveRelative(source, path, spec);
      if (target) found.add(target);
    }
  }
  return [...found];
}

function candidates(base: string): string[] {
  const out = [base];
  for (const ext of JS_EXT) out.push(`${base}${ext}`);
  for (const ext of JS_EXT) out.push(`${base}/index${ext}`);
  out.push(`${base}.py`, `${base}/__init__.py`);
  return out;
}

function resolveRelative(source: RepoSource, from: string, spec: string): string | null {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const joined = normalisePath(collapse(`${dir}/${spec}`));
  return firstThatExists(source, candidates(joined));
}

/** `@/lib/db` means `<root>/lib/db`, where root is `src/` when there is one. */
function resolveAlias(source: RepoSource, rest: string): string | null {
  const roots = source.list().some((p) => p.startsWith('src/')) ? ['src/', ''] : ['', 'src/'];
  for (const root of roots) {
    const hit = firstThatExists(source, candidates(normalisePath(`${root}${rest}`)));
    if (hit) return hit;
  }
  return null;
}

function firstThatExists(source: RepoSource, options: string[]): string | null {
  for (const o of options) if (source.read(o) !== null) return o;
  return null;
}

function collapse(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Files reachable from code that runs in the browser.
 *
 * Seeded from three places: an explicit `'use client'` directive, anything under a
 * client-only convention directory, and — for non-Next projects — the entry files a
 * bundler would start from. Then a breadth-first walk over imports.
 *
 * This set is the difference between "you import a secret somewhere" and "this
 * secret is in your browser bundle, here is the chain". Only the second is worth
 * telling somebody at two in the morning.
 */
export function clientReachable(source: RepoSource): Map<string, string[]> {
  const paths = source.list();
  const reach = new Map<string, string[]>();
  const queue: string[] = [];

  const isServerOnly = (p: string) =>
    /(^|\/)(route|middleware)\.[tj]sx?$/.test(p) ||
    /(^|\/)pages\/api\//.test(p) ||
    /(^|\/)app\/api\//.test(p) ||
    /\.server\.[tj]sx?$/.test(p);

  for (const p of paths) {
    if (!/\.[tj]sx?$/.test(p) && !/\.[cm]js$/.test(p)) continue;
    const content = source.read(p) ?? '';
    const head = content.slice(0, 400);
    const declaredClient = /^\s*['"]use client['"]/m.test(head);
    // A route handler that says 'use client' is a mistake, not a client file; the
    // convention wins over the directive so one stray line cannot invert the graph.
    const conventionClient =
      !isServerOnly(p) &&
      (/(^|\/)(components|ui|widgets)\//.test(p) ||
        /(^|\/)(src\/)?(app|pages)\/.*\/(page|layout|template|error|loading)\.[tj]sx$/.test(p));
    if ((declaredClient && !isServerOnly(p)) || conventionClient) {
      reach.set(p, [p]);
      queue.push(p);
    }
  }

  while (queue.length) {
    const current = queue.shift()!;
    const chain = reach.get(current)!;
    for (const target of importsOf(source, current)) {
      if (reach.has(target)) continue;
      if (isServerOnly(target)) continue;
      reach.set(target, [...chain, target]);
      queue.push(target);
    }
  }
  return reach;
}

// ------------------------------------------------------------------ helpers ---

export function isJs(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

export function isPy(path: string): boolean {
  return path.endsWith('.py');
}

export function isCode(path: string): boolean {
  return isJs(path) || isPy(path);
}

export function baseName(path: string): string {
  return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
}

export function dirName(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** Every line index (1-based) where a pattern matches, over de-noised source. */
export function matchLines(content: string, re: RegExp): { line: number; match: RegExpExecArray }[] {
  const code = blankNoise(content);
  const out: { line: number; match: RegExpExecArray }[] = [];
  const all = lines(code);
  for (let i = 0; i < all.length; i += 1) {
    const rx = new RegExp(re.source, re.flags.replace('g', ''));
    const m = rx.exec(all[i] ?? '');
    if (m) out.push({ line: i + 1, match: m });
  }
  return out;
}
