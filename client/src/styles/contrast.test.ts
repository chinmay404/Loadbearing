import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every pair of text and ground the design actually uses has to read: WCAG AA,
 * 4.5:1, in both themes. The values are read out of tokens.css itself, so a token
 * nudged for taste cannot quietly drop a label below legibility.
 */
const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

const THEMES = {
  light: block("[data-theme='light'] {"),
  dark: block("[data-theme='dark'] {"),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** [text, ground] pairs as the stylesheet uses them. */
const PAIRS: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'surface-2'],
  ['fg', 'bench'],
  ['fg-2', 'surface'],
  ['fg-2', 'surface-2'],
  ['fg-2', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['muted', 'surface-3'],
  ['muted', 'bg'],
  ['muted', 'bench'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['accent', 'accent-soft'],
  ['accent-fg', 'accent'],
  ['pass', 'surface'],
  ['pass', 'pass-soft'],
  ['load', 'load-soft'],
  ['fail', 'surface'],
  ['fail', 'fail-soft'],
  ['plum', 'surface'],
  ['plum', 'plum-soft'],
];

describe.each(Object.entries(THEMES))('%s theme', (_name, tokens) => {
  it('defines every token the pairs need', () => {
    const missing = [...new Set(PAIRS.flat())].filter((t) => !tokens[t]);
    expect(missing).toEqual([]);
  });

  it.each(PAIRS)('%s on %s reads at 4.5:1 or better', (text, ground) => {
    expect(contrast(tokens[text]!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
  });
});
