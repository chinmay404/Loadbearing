import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The theme only works if colours come from tokens. One hard-coded hex in a
 * component is a white box in dark mode, or a brass line nobody can explain.
 *
 * ALLOWED is a ratchet: files that may still carry literal colours, each with why.
 * A file that comes clean must come off the list, so the list can only shrink.
 */
const SRC = join(__dirname, '..');

const ALLOWED: Record<string, string> = {
  'styles/tokens.css': 'where colours are defined',
  'lib/diagram.ts': 'Mermaid and draw.io exports are read by other tools, which cannot see our tokens',
};

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({
  rel: relative(SRC, path).replace(/\\/g, '/'),
  hexes: readFileSync(path, 'utf8').match(HEX) ?? [],
}));

describe('colours come from tokens', () => {
  it('actually reads the sources', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('no file outside the allowed list names a colour', () => {
    const offenders = files.filter((f) => f.hexes.length > 0 && !(f.rel in ALLOWED)).map((f) => `${f.rel}: ${f.hexes.join(' ')}`);
    expect(offenders).toEqual([]);
  });

  it('a file that has come clean is taken off the allowed list', () => {
    const clean = Object.keys(ALLOWED).filter((rel) => files.find((f) => f.rel === rel)?.hexes.length === 0);
    expect(clean).toEqual([]);
  });
});
