// Pulling JSON out of an LLM reply. Models wrap objects in code fences, prepend
// "Here is the JSON:", and sprinkle trailing commas. This module forgives all of
// that and gives up loudly (LlmJsonError) so the caller can ask for a repair.

/** Thrown when nothing in the reply parses as JSON. Carries the raw text for a repair prompt. */
export class LlmJsonError extends Error {
  constructor(public raw: string) {
    super('The model reply could not be parsed as JSON.');
    this.name = 'LlmJsonError';
  }
}

/** How many `{`/`[` openers we are willing to try before giving up. Guards against prose full of braces. */
const MAX_OPENERS = 24;

/**
 * Best-effort JSON extraction from arbitrary model output.
 * Handles bare JSON, ```json / ``` fences, prose around the object, nested braces
 * inside string literals, trailing commas, and top-level arrays.
 * @throws LlmJsonError when no candidate parses.
 */
export function extractJson(text: string): unknown {
  for (const source of sources(text)) {
    for (const candidate of candidates(source)) {
      const parsed = tryParse(candidate);
      if (parsed.ok) return parsed.value;
    }
  }
  throw new LlmJsonError(text);
}

/** Whole text first (bare JSON is the common case), then the body of every code fence. */
function sources(text: string): string[] {
  const out: string[] = [];
  const trimmed = text.trim();
  if (trimmed) out.push(trimmed);
  for (const body of fencedBodies(text)) {
    const t = body.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Bodies of ```lang ... ``` blocks, plus an unterminated fence that runs to the end. */
function fencedBodies(text: string): string[] {
  const out: string[] = [];
  const closed = /```[ \t]*[A-Za-z0-9_+.-]*[ \t]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = closed.exec(text)) !== null) out.push(m[1] ?? '');
  const open = /```[ \t]*[A-Za-z0-9_+.-]*[ \t]*\r?\n([\s\S]*)$/.exec(text);
  if (open) out.push(open[1] ?? '');
  return out;
}

/** The source itself, then every balanced `{...}` / `[...]` slice starting at each opener in order. */
function candidates(source: string): string[] {
  const out = [source];
  let found = 0;
  for (let i = 0; i < source.length && found < MAX_OPENERS; i++) {
    const ch = source[i];
    if (ch !== '{' && ch !== '[') continue;
    found++;
    const end = matchingClose(source, i);
    if (end === -1) continue;
    const slice = source.slice(i, end + 1);
    if (slice !== source) out.push(slice);
  }
  return out;
}

/**
 * Index of the brace/bracket that closes the one at `start`, tracking depth while
 * skipping over string literals and backslash escapes. -1 if never balanced.
 */
function matchingClose(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** Drop commas that sit directly before `}` or `]` — outside string literals only. */
function stripTrailingCommas(source: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j]!)) j++;
      const next = source[j];
      if (next === '}' || next === ']') continue; // trailing comma — drop it
    }
    out += ch;
  }
  return out;
}

type ParseResult = { ok: true; value: unknown } | { ok: false };

function tryParse(candidate: string): ParseResult {
  const t = candidate.trim();
  if (!t) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    /* fall through to the trailing-comma repair */
  }
  try {
    return { ok: true, value: JSON.parse(stripTrailingCommas(t)) };
  } catch {
    return { ok: false };
  }
}
