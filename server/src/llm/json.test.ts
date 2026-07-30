import { describe, expect, it } from 'vitest';
import { extractJson, LlmJsonError } from './json.js';

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('parses bare JSON surrounded by whitespace/newlines', () => {
    expect(extractJson('\n\n  {"a": 1}  \n')).toEqual({ a: 1 });
  });

  it('parses a ```json fenced block', () => {
    const text = 'Sure.\n```json\n{"overall": 72, "spofs": ["db"]}\n```\n';
    expect(extractJson(text)).toEqual({ overall: 72, spofs: ['db'] });
  });

  it('parses an unlabelled ``` fenced block', () => {
    const text = '```\n{"nodes": [], "edges": []}\n```';
    expect(extractJson(text)).toEqual({ nodes: [], edges: [] });
  });

  it('parses an unterminated fence that runs to the end of the reply', () => {
    const text = '```json\n{"truncatedFence": true}';
    expect(extractJson(text)).toEqual({ truncatedFence: true });
  });

  it('ignores prose before and after the object', () => {
    const text = 'Here is the JSON: {"ok":true,"score":5} Hope that helps!';
    expect(extractJson(text)).toEqual({ ok: true, score: 5 });
  });

  it('respects braces and escaped quotes inside string literals', () => {
    const raw = '{"tpl":"use {placeholder} and }{ weirdness","q":"a \\"quoted\\" }","n":{"deep":{"x":1}}}';
    const text = `Notes above.\n${raw}\nNotes below.`;
    expect(extractJson(text)).toEqual({
      tpl: 'use {placeholder} and }{ weirdness',
      q: 'a "quoted" }',
      n: { deep: { x: 1 } },
    });
  });

  it('takes the matching close brace, not the last one in the text', () => {
    const text = 'prefix {"a":{"b":2}} trailing } } }';
    expect(extractJson(text)).toEqual({ a: { b: 2 } });
  });

  it('skips a brace that appears in prose before the real object', () => {
    const text = 'The set {x, y, z} is informal prose. Real answer: {"a":1}';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('strips trailing commas in objects and arrays', () => {
    const text = '{"a":1,"list":[1,2,3,],"nested":{"b":2,},}';
    expect(extractJson(text)).toEqual({ a: 1, list: [1, 2, 3], nested: { b: 2 } });
  });

  it('does not strip commas that live inside strings', () => {
    expect(extractJson('{"s":"a, }","t":"x,]",}')).toEqual({ s: 'a, }', t: 'x,]' });
  });

  it('accepts a top-level array', () => {
    expect(extractJson('[{"id":"a"},{"id":"b"}]')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('accepts a top-level array inside a fence with prose around it', () => {
    const text = 'Results:\n```json\n[1, 2, 3,]\n```\nDone.';
    expect(extractJson(text)).toEqual([1, 2, 3]);
  });

  it('throws LlmJsonError carrying the raw text when nothing parses', () => {
    const raw = 'I am sorry, I cannot produce that.';
    expect(() => extractJson(raw)).toThrow(LlmJsonError);
    try {
      extractJson(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmJsonError);
      expect((err as LlmJsonError).raw).toBe(raw);
    }
  });

  it('throws LlmJsonError on an unbalanced/truncated object', () => {
    expect(() => extractJson('{"a": 1, "b": [1, 2')).toThrow(LlmJsonError);
  });

  it('throws LlmJsonError on empty input', () => {
    expect(() => extractJson('')).toThrow(LlmJsonError);
  });
});
