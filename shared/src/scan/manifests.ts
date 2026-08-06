// What gets deployed, and how many of them there are.
//
// The monolith-versus-services question is usually not a judgement call at all —
// it is written down. One package.json with one start script is one deployable;
// four services in a compose file are four. The scanner's job is to count what is
// declared and show the evidence, not to have an opinion about what the count
// should be. The opinion is the learner's, and grading it is the grader's.

import type { Deployable, DeployableKind, Evidence, SystemShape } from './types.js';
import { dirName, evidenceAt, lines, matchLines, type RepoSource } from './source.js';
import { lookupFramework } from './deps.js';

export interface ManifestResult {
  deployables: Deployable[];
  /** Declared dependency names by ecosystem, with where each was declared. */
  deps: { name: string; eco: 'node' | 'python'; evidence: Evidence }[];
  shape: { verdict: SystemShape; why: string; evidence: Evidence[] };
  /** Hosting platform hints, e.g. 'vercel'. */
  platforms: string[];
}

const NODE_MANIFEST = /(^|\/)package\.json$/;
const PY_REQS = /(^|\/)requirements[\w.-]*\.txt$/;
const PY_PROJECT = /(^|\/)pyproject\.toml$/;
const COMPOSE = /(^|\/)docker-compose[\w.-]*\.ya?ml$/;
const DOCKERFILE = /(^|\/)Dockerfile[\w.-]*$/;

export function readManifests(source: RepoSource): ManifestResult {
  const paths = source.list();
  const deployables: Deployable[] = [];
  const deps: ManifestResult['deps'] = [];
  const platforms: string[] = [];
  const shapeEvidence: Evidence[] = [];

  // ------------------------------------------------------------ node packages ---
  for (const path of paths.filter((p) => NODE_MANIFEST.test(p) && !p.includes('node_modules/'))) {
    const raw = source.read(path);
    if (!raw) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const root = dirName(path);
    const declared = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    const names = Object.keys(declared ?? {});
    for (const name of names) {
      deps.push({ name, eco: 'node', evidence: { file: path, line: lineOfKey(raw, name), snippet: `"${name}"` } });
    }

    // A package.json holding only workspaces is a monorepo root, not something that
    // ships. Counting it as a deployable inflates every project that uses one.
    const workspaces = pkg.workspaces;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const hasStart = runsAServer(scripts);
    const isWorkspaceRoot = Boolean(workspaces) && names.length === 0;
    if (isWorkspaceRoot) continue;

    const framework = names.map((n) => lookupFramework(n, 'node')).find(Boolean) ?? null;
    const kind: DeployableKind =
      framework === 'next' || framework === 'nuxt' || framework === 'remix' || framework === 'astro'
        ? 'next_app'
        : framework
          ? 'node_service'
          : hasStart
            ? 'node_service'
            : 'unknown';

    // A package with no start script and no server framework is a library inside a
    // monorepo — `shared/` in this very repository is one. It is not deployed.
    if (kind === 'unknown' && !hasStart) continue;

    deployables.push({
      id: slug(root || String(pkg.name ?? 'app')),
      name: String(pkg.name ?? root ?? 'app'),
      kind,
      runtime: 'node',
      root,
      evidence: [{ file: path, line: 1, snippet: `"name": ${JSON.stringify(pkg.name ?? '')}` }],
    });
  }

  // ---------------------------------------------------------- python packages ---
  for (const path of paths.filter((p) => PY_REQS.test(p))) {
    const raw = source.read(path);
    if (!raw) continue;
    lines(raw).forEach((line, i) => {
      const name = line.trim().split(/[\s=<>!~[;#]/)[0];
      if (!name || line.trim().startsWith('#') || line.trim().startsWith('-')) return;
      deps.push({ name: name.toLowerCase(), eco: 'python', evidence: evidenceAt(path, raw, i + 1) });
    });
    registerPythonDeployable(source, deployables, dirName(path), path);
  }

  for (const path of paths.filter((p) => PY_PROJECT.test(p))) {
    const raw = source.read(path);
    if (!raw) continue;
    // Deliberately not a TOML parser. Dependency lines in both the PEP 621 and the
    // Poetry layouts are `name = "..."` or `"name>=1.0",`, and reading those two
    // shapes covers essentially every real file for none of the weight.
    lines(raw).forEach((line, i) => {
      const pep = /^\s*["']([A-Za-z0-9_.-]+)\s*[<>=~!\[]/.exec(line);
      const poetry = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["{]/.exec(line);
      const name = pep?.[1] ?? poetry?.[1];
      if (!name || ['python', 'name', 'version', 'description', 'requires-python', 'readme'].includes(name.toLowerCase())) return;
      deps.push({ name: name.toLowerCase(), eco: 'python', evidence: evidenceAt(path, raw, i + 1) });
    });
    registerPythonDeployable(source, deployables, dirName(path), path);
  }

  // ------------------------------------------------------------------ compose ---
  let composeServices = 0;
  for (const path of paths.filter((p) => COMPOSE.test(p))) {
    const raw = source.read(path);
    if (!raw) continue;
    const services = composeServiceNames(raw);
    composeServices += services.length;
    for (const svc of services) {
      // Managed infrastructure declared in compose (a postgres image, a redis image)
      // is a datastore, not a deployable of the user's own — it is picked up by the
      // dependency pass instead, where it arrives with the client that talks to it.
      if (/^(postgres|mysql|redis|mongo|elasticsearch|rabbitmq|kafka|minio|mailhog)/.test(svc.image ?? '')) continue;
      if (deployables.some((d) => d.id === slug(svc.name))) continue;
      deployables.push({
        id: slug(svc.name),
        name: svc.name,
        kind: 'container',
        runtime: 'unknown',
        root: svc.context ?? '',
        evidence: [evidenceAt(path, raw, svc.line)],
      });
    }
    if (services[0]) shapeEvidence.push(evidenceAt(path, raw, services[0].line));
  }

  // --------------------------------------------------------------- dockerfiles ---
  const dockerfiles = paths.filter((p) => DOCKERFILE.test(p));
  for (const path of dockerfiles) {
    const root = dirName(path);
    if (deployables.some((d) => d.root === root)) continue;
    const raw = source.read(path) ?? '';
    deployables.push({
      id: slug(root || 'container'),
      name: root || 'container',
      kind: 'container',
      runtime: /python/i.test(raw) ? 'python' : /node/i.test(raw) ? 'node' : 'unknown',
      root,
      evidence: [{ file: path, line: 1, snippet: lines(raw)[0] ?? 'Dockerfile' }],
    });
  }

  // ----------------------------------------------------------------- platforms ---
  for (const [file, name] of [
    ['vercel.json', 'vercel'],
    ['netlify.toml', 'netlify'],
    ['fly.toml', 'fly'],
    ['railway.json', 'railway'],
    ['render.yaml', 'render'],
    ['Procfile', 'heroku'],
    ['serverless.yml', 'serverless'],
  ] as const) {
    if (paths.some((p) => p === file || p.endsWith(`/${file}`))) platforms.push(name);
  }

  // --------------------------------------------------------------------- shape ---
  const shipping = deployables.filter((d) => d.kind !== 'unknown');
  let verdict: SystemShape = 'unknown';
  let why = 'Nothing that looks deployable was found — the scan may not have reached the repo root.';

  const first = shipping[0];
  if (!first) {
    verdict = 'unknown';
  } else if (composeServices > 1 || shipping.length > 1) {
    verdict = 'services';
    why = `${shipping.length} separately deployable pieces: ${shipping.map((d) => d.name).join(', ')}.`;
  } else if (first.kind === 'next_app' && platforms.includes('vercel')) {
    verdict = 'static+functions';
    why = `One Next.js app deployed to Vercel: pages are static or server-rendered, and each API route is its own function.`;
  } else {
    verdict = 'monolith';
    why = `One deployable, ${first.name} — every route runs in the same process.`;
  }
  if (first) shapeEvidence.unshift(...first.evidence);

  return { deployables, deps: dedupeDeps(deps), shape: { verdict, why, evidence: shapeEvidence.slice(0, 4) }, platforms };
}

function registerPythonDeployable(
  source: RepoSource,
  deployables: Deployable[],
  root: string,
  manifestPath: string,
) {
  if (deployables.some((d) => d.root === root && d.runtime === 'python')) return;
  const entry = source
    .list()
    .find((p) => dirName(p) === root && /(^|\/)(main|app|api|server|wsgi|asgi)\.py$/.test(p));
  deployables.push({
    id: slug(root || 'python-app'),
    name: root || 'python app',
    kind: 'python_service',
    runtime: 'python',
    root,
    evidence: [{ file: entry ?? manifestPath, line: 1, snippet: entry ? `entry point ${entry}` : manifestPath }],
  });
}

/**
 * Service names out of a compose file, without a YAML parser.
 *
 * Compose files are machine-written and shallow: `services:` at column zero, then
 * one key per service at a consistent indent. Reading that shape directly costs a
 * dozen lines; a YAML dependency costs a dependency, and `shared` has none on
 * purpose — everything here has to run inside a Vercel function.
 */
export function composeServiceNames(raw: string): { name: string; line: number; image?: string; context?: string }[] {
  const all = lines(raw);
  const out: { name: string; line: number; image?: string; context?: string }[] = [];
  let inServices = false;
  let indent = -1;
  let current: { name: string; line: number; image?: string; context?: string } | null = null;

  all.forEach((line, i) => {
    if (/^\s*#/.test(line) || line.trim() === '') return;
    if (/^services:\s*$/.test(line)) { inServices = true; return; }
    if (inServices && /^\S/.test(line)) { inServices = false; current = null; return; }
    if (!inServices) return;

    const m = /^(\s+)([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2]) {
      const width = m[1].length;
      if (indent === -1) indent = width;
      if (width === indent) {
        current = { name: m[2], line: i + 1 };
        out.push(current);
        return;
      }
    }
    const open = current;
    if (open) {
      const image = /^\s+image:\s*["']?([^"'\s]+)/.exec(line);
      if (image?.[1]) open.image = image[1];
      const context = /^\s+context:\s*["']?([^"'\s]+)/.exec(line);
      if (context?.[1]) open.context = context[1].replace(/^\.\//, '').replace(/^\.$/, '');
    }
  });
  return out;
}

/** Where a JSON key first appears, so a dependency can cite its own line. */
function lineOfKey(raw: string, key: string): number {
  const hits = matchLines(raw, new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`));
  return hits[0]?.line ?? 1;
}

function dedupeDeps(deps: ManifestResult['deps']): ManifestResult['deps'] {
  const seen = new Set<string>();
  return deps.filter((d) => {
    const key = `${d.eco}:${d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Whether a package's scripts actually start something that serves traffic.
 *
 * The obvious test — "does it have a dev or start script" — counts every library
 * in a monorepo as a deployable, because `dev: tsc --watch` is a script called dev.
 * Loadbearing's own `shared/` package was reported as a service by exactly that
 * mistake, which is the reason the scanner is pointed at this repository in the
 * tests: a fixture can be shaped to pass, and a real monorepo cannot.
 */
export function runsAServer(scripts: Record<string, string>): boolean {
  const candidates = [scripts.start, scripts.dev, scripts.serve].filter(Boolean) as string[];
  const RUNNER =
    /\b(node|nodemon|tsx|ts-node|bun|deno|next|nuxt|vite|astro|remix|serve|http-server|fastify|nest|uvicorn|gunicorn|flask|streamlit|celery)\b/;
  // A compiler in watch mode is a build step wearing a dev script's name.
  const COMPILER_ONLY = /^\s*(tsc|swc|esbuild|rollup|babel|tsup|webpack)\b/;
  return candidates.some((cmd) => RUNNER.test(cmd) && !COMPILER_ONLY.test(cmd));
}

export function slug(text: string): string {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  );
}
