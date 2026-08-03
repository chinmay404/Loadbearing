// The deployment config, checked here because the platform checks it too late.
//
// vercel.json is schema-validated at BUILD time, on their side, after a push. A
// mistake in it is not a failing test or a type error — it is a red deployment and a
// round trip. I put a "//" comment key inside a rewrite to explain why the rewrite
// existed; `rewrites[]` allows no additional properties, and the build died on it.
//
// So the shape is asserted locally, along with the two ordering properties the OAuth
// discovery flow depends on. Those are the ones worth having a test for: they are
// invisible, they are load-bearing, and getting them wrong produces a working site
// that quietly answers a metadata request with a web page.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  framework?: string | null;
  buildCommand?: string;
  outputDirectory?: string;
  rewrites: Record<string, unknown>[];
  functions: Record<string, unknown>;
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Everything the platform accepts on a rewrite. Anything else fails the build. */
const REWRITE_KEYS = new Set(['source', 'destination', 'has', 'missing']);

describe('vercel.json', () => {
  it('puts nothing on a rewrite that the schema rejects', () => {
    for (const [i, rewrite] of config.rewrites.entries()) {
      for (const key of Object.keys(rewrite)) {
        // A comment belongs in the code that depends on the rewrite, not in the
        // rewrite. This exact key is what failed a production build.
        expect(REWRITE_KEYS.has(key), `rewrites[${i}] has "${key}", which is not allowed`).toBe(true);
      }
      expect(typeof rewrite.source).toBe('string');
      expect(typeof rewrite.destination).toBe('string');
    }
  });

  it('routes the API and OAuth discovery to the function, and everything else to the app', () => {
    const sources = config.rewrites.map((r) => String(r.source));
    expect(sources).toContain('/api/(.*)');
    // Discovery lives at the root by spec. Without its own rule the catch-all answers
    // it with index.html and a 200, and an MCP client reports that it could not
    // register — which is exactly what happened.
    expect(sources).toContain('/.well-known/(.*)');
  });

  it('excludes both from the single-page-app catch-all, and puts it last', () => {
    const spa = config.rewrites.findIndex((r) => String(r.destination) === '/index.html');
    expect(spa).toBe(config.rewrites.length - 1);

    const pattern = String(config.rewrites[spa]!.source);
    // The negative lookahead is the whole mechanism; a rule that matched /api or
    // /.well-known first would shadow the two above it regardless of order.
    for (const excluded of ['api/', '.well-known/']) {
      expect(pattern, `the catch-all does not exclude ${excluded}`).toContain(excluded);
    }
  });

  it('says explicitly that there is no framework', () => {
    // Left unset, Vercel guesses. CLI 58 found `hono` in the root dependencies,
    // decided this was a Hono server app, ran the wrong workspace's build script and
    // then failed looking for a Node entrypoint inside client/dist. It is a static
    // site plus one function, and saying so is one line.
    expect(config.framework, 'framework must be explicitly null, not absent').toBeNull();
  });

  it('builds the static output the output directory points at', () => {
    expect(config.outputDirectory).toBe('client/dist');
    // build:client is what writes client/dist. If the root build ever stops calling
    // it, the deployment succeeds and serves nothing.
    expect(pkg.scripts.build).toContain('build:client');
  });

  it('keeps a timeout long enough for a grader call', () => {
    const fn = config.functions['api/index.ts'] as { maxDuration?: number } | undefined;
    expect(fn?.maxDuration).toBeGreaterThanOrEqual(30);
  });

  it('does not need a devDependency to build', () => {
    // A production install is entitled to skip devDependencies, and the build script
    // is the one thing that must work when it does. npm-run-all is a devDependency;
    // `&&` is in every shell.
    const chain = [config.buildCommand, pkg.scripts.build, pkg.scripts['build:shared'], pkg.scripts['build:client']]
      .filter((step): step is string => typeof step === 'string');
    for (const dev of Object.keys(pkg.devDependencies)) {
      for (const step of chain) {
        expect(step.includes(dev), `the build path runs "${dev}", which is a devDependency`).toBe(false);
      }
    }
  });
});
