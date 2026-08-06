// Repository in, RepoScan out.
//
// The order matters and is the same order the rest of the app already uses:
// arithmetic before opinion. Manifests say what exists, dependencies say what it
// talks to, the filesystem says what it answers on, and only then do the exposure
// rules run over the result. Nothing here calls a model, and nothing here is
// allowed to be non-deterministic — the same input has to produce the same scan,
// because the grader is handed these as facts it must respect and a fact that
// changes between runs is not one.

import type {
  Detected,
  Deployable,
  Evidence,
  RepoScan,
  ScanCoverage,
  ScanEndpoint,
} from './types.js';
import { fileSource, type RepoSource, type SourceFile } from './source.js';
import { importNamesIn, lookupDep, packageOf, type DepMapping } from './deps.js';
import { readManifests, slug } from './manifests.js';
import { deployableResolver, findEndpoints } from './endpoints.js';
import { findExposures } from './exposure.js';
import { exposuresFromSarif, type SarifAttachment } from './sarif.js';

export * from './types.js';
export * from './source.js';
export * from './deps.js';
export * from './manifests.js';
export * from './endpoints.js';
export * from './exposure.js';
export * from './sarif.js';
export * from './trace.js';
export * from './inventory.js';
export * from './divergence.js';

export interface ScanOptions {
  projectName?: string;
  /** SARIF from analyzers the caller ran locally. */
  sarif?: SarifAttachment[];
  /** What the sender saw and chose not to send. */
  meta?: {
    filesSeen?: number;
    truncated?: string[];
    skipped?: string[];
    dropped?: string[];
  };
  /** ISO timestamp; injected so the scan is reproducible in tests. */
  now?: string;
}

export function scanFiles(files: SourceFile[], options: ScanOptions = {}): RepoScan {
  return scanRepo(fileSource(files), options);
}

export function scanRepo(source: RepoSource, options: ScanOptions = {}): RepoScan {
  const paths = source.list();
  const { deployables, deps, shape, platforms } = readManifests(source);

  // Which packages are genuinely imported. A dependency nobody imports is a
  // leftover, and drawing a component for it puts a box on the canvas that does
  // not exist in the running system.
  const importedIn = new Map<string, string[]>();
  for (const path of paths) {
    const content = source.read(path);
    if (!content) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(path)) continue;
    for (const spec of importNamesIn(content)) {
      const pkg = packageOf(spec);
      importedIn.set(pkg, [...(importedIn.get(pkg) ?? []), path]);
    }
  }

  const datastores: Detected[] = [];
  const externals: Detected[] = [];
  const ai: Detected[] = [];
  const infra: Detected[] = [];
  /** package name -> detected id, so an endpoint can say what it reaches. */
  const byPackage = new Map<string, string>();
  const byId = new Map<string, Detected>();

  const bucketFor = (group: DepMapping['group']) =>
    group === 'datastore' ? datastores : group === 'ai' ? ai : group === 'infra' ? infra : externals;

  for (const dep of deps) {
    const mapping = lookupDep(dep.name, dep.eco);
    if (!mapping) continue;

    const usedIn = importedIn.get(dep.name) ?? importedIn.get(dep.name.replace(/-/g, '_')) ?? [];
    const id = slug(`${mapping.nodeType}-${mapping.label}`);
    byPackage.set(dep.name, id);

    const evidence: Evidence[] = [dep.evidence];
    if (usedIn[0]) {
      const content = source.read(usedIn[0]) ?? '';
      const line = content.split(/\r?\n/).findIndex((l) => l.includes(dep.name)) + 1;
      evidence.push({ file: usedIn[0], line: Math.max(1, line), snippet: `imports ${dep.name}` });
    }

    const existing = byId.get(id);
    if (existing) {
      // Two packages can mean the same component — `pg` alongside Drizzle is one
      // Postgres, not two. Merge the evidence rather than drawing it twice.
      existing.evidence.push(...evidence);
      if (usedIn.length > 0) existing.confidence = 'observed';
      continue;
    }

    const detected: Detected = {
      id,
      nodeType: mapping.nodeType,
      label: mapping.label,
      mechanism: mapping.mechanism,
      // Declared but never imported is a real possibility and a real answer.
      confidence: usedIn.length > 0 ? 'observed' : 'inferred',
      evidence,
    };
    byId.set(id, detected);
    bucketFor(mapping.group).push(detected);

    for (const implied of mapping.implies ?? []) {
      const impliedId = slug(`${implied.nodeType}-${implied.label}`);
      if (byId.has(impliedId)) continue;
      const impliedDetected: Detected = {
        id: impliedId,
        nodeType: implied.nodeType,
        label: implied.label,
        mechanism: implied.mechanism,
        confidence: 'inferred',
        evidence: [dep.evidence],
      };
      byId.set(impliedId, impliedDetected);
      bucketFor(implied.group).push(impliedDetected);
    }
  }

  // Infrastructure the user runs (queues, workers, rate limiters) belongs with the
  // externals for presentation: the inventory groups by what a person would look
  // for, not by which table row produced it.
  externals.push(...infra);

  const resolveDeployable = deployableResolver(
    deployables.length ? deployables.map((d) => ({ id: d.id, root: d.root })) : [{ id: 'app', root: '' }],
  );
  const endpoints = findEndpoints(source, resolveDeployable, (pkg) => byPackage.get(pkg) ?? null);

  const { exposures, env } = findExposures({ source, endpoints, datastores, externals, ai });
  const fromSarif = exposuresFromSarif(options.sarif ?? []);

  const coverage = buildCoverage(source, deployables, endpoints, options, platforms);

  return {
    version: 1,
    projectName: options.projectName?.trim() || inferProjectName(source) || 'project',
    scannedAt: options.now ?? new Date().toISOString(),
    shape,
    deployables,
    endpoints,
    datastores,
    externals,
    ai,
    exposures: [...exposures, ...fromSarif],
    env,
    coverage,
  };
}

function buildCoverage(
  source: RepoSource,
  deployables: Deployable[],
  endpoints: ScanEndpoint[],
  options: ScanOptions,
  platforms: string[],
): ScanCoverage {
  const paths = source.list();
  const languages = new Set<string>();
  for (const p of paths) {
    if (/\.tsx?$/.test(p)) languages.add('typescript');
    else if (/\.[cm]?jsx?$/.test(p)) languages.add('javascript');
    else if (p.endsWith('.py')) languages.add('python');
    else if (p.endsWith('.sql')) languages.add('sql');
  }

  const truncated = options.meta?.truncated ?? [];
  const skipped = options.meta?.skipped ?? [];
  const dropped = options.meta?.dropped ?? [];
  const filesSeen = options.meta?.filesSeen ?? paths.length;

  const notes: string[] = [];
  if (deployables.length === 0) {
    notes.push(
      'No manifest was found, so nothing could be identified as deployable. The scan may have started below the repository root.',
    );
  }
  if (endpoints.length === 0 && deployables.length > 0) {
    notes.push(
      'No HTTP endpoints were found. That is correct for a CLI, a batch job or a library — and wrong for a web app, in which case the route files were probably not collected.',
    );
  }
  if (dropped.length > 0) {
    notes.push(`${dropped.length} file(s) were dropped to stay inside the size limit, so this scan is partial.`);
  }
  if (platforms.length > 0) {
    notes.push(`Deployment config found for: ${platforms.join(', ')}.`);
  }
  const inferredEndpoints = endpoints.filter((e) => e.confidence === 'inferred').length;
  if (inferredEndpoints > 0) {
    notes.push(
      `${inferredEndpoints} endpoint(s) were matched by line shape rather than read off the filesystem, so check those against the code.`,
    );
  }

  return {
    filesSeen,
    filesRead: paths.length,
    partial: dropped.length > 0 || filesSeen > paths.length * 40,
    truncated,
    skipped,
    dropped,
    languages: [...languages].sort(),
    analyzers: (options.sarif ?? []).map((s) => s.tool),
    notes,
  };
}

function inferProjectName(source: RepoSource): string | null {
  const raw = source.read('package.json');
  if (raw) {
    try {
      const name = (JSON.parse(raw) as { name?: string }).name;
      if (name) return String(name).replace(/^@[^/]+\//, '');
    } catch {
      /* a package.json that does not parse names nothing */
    }
  }
  return null;
}

// Re-exported for callers that only want the narrow contract.
export type { SarifAttachment, SourceFile, RepoSource };
