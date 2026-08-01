// The block parser behind rendered notes.
//
// A hand-rolled markdown parser is exactly the kind of thing that quietly rots, so the
// shapes that actually turn up in a pasted note are pinned here: fences that hold their
// contents verbatim, lists that stop at the blank line, quotes that join, and — most
// importantly — malformed input that degrades into text rather than eating the rest of
// the document.

import { describe, expect, it } from 'vitest';
import { parse } from './Markdown';

const kinds = (source: string) => parse(source).map((b) => b.kind);

describe('blocks', () => {
  it('separates paragraphs on a blank line', () => {
    expect(kinds('one\n\ntwo')).toEqual(['paragraph', 'paragraph']);
  });

  it('keeps a wrapped paragraph together', () => {
    const [block] = parse('one line\nand its continuation');
    expect(block).toEqual({ kind: 'paragraph', text: 'one line\nand its continuation' });
  });

  it('reads headings and their depth', () => {
    expect(parse('## Your agent can stay together')).toEqual([
      { kind: 'heading', level: 2, text: 'Your agent can stay together' },
    ]);
    expect(parse('#### deep')[0]).toMatchObject({ level: 4 });
  });

  it('does not treat a hash inside a sentence as a heading', () => {
    expect(kinds('issue #4 is open')).toEqual(['paragraph']);
  });

  it('collects a bullet list and stops at the blank line', () => {
    const blocks = parse('* one\n* two\n\nafter');
    expect(blocks[0]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        { text: 'one', depth: 0 },
        { text: 'two', depth: 0 },
      ],
    });
    expect(blocks[1]!.kind).toBe('paragraph');
  });

  it('reads a numbered list as ordered, and records nesting', () => {
    const [block] = parse('1. first\n2. second\n    2.1 nested');
    expect(block).toMatchObject({ kind: 'list', ordered: true });
  });

  it('keeps a fenced block verbatim, formatting characters and all', () => {
    const [block] = parse('```text\nAgent Worker\n  **not bold**\n```');
    expect(block).toEqual({
      kind: 'code',
      language: 'text',
      lines: ['Agent Worker', '  **not bold**'],
    });
  });

  it('runs an unterminated fence to the end instead of losing the document', () => {
    const blocks = parse('before\n\n```\nstill code\nmore code');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code']);
    expect(blocks[1]).toMatchObject({ lines: ['still code', 'more code'] });
  });

  it('joins consecutive quote lines into one quote', () => {
    const [block] = parse('> first\n> second');
    expect(block).toEqual({ kind: 'quote', lines: ['first', 'second'] });
  });

  it('reads a horizontal rule, but not a list item that starts with a dash', () => {
    expect(kinds('---')).toEqual(['rule']);
    expect(kinds('- an item')).toEqual(['list']);
  });

  it('survives an empty note', () => {
    expect(parse('')).toEqual([]);
    expect(parse('\n\n\n')).toEqual([]);
  });

  it('handles windows line endings', () => {
    expect(kinds('one\r\n\r\ntwo')).toEqual(['paragraph', 'paragraph']);
  });

  it('parses the shape of a note pasted out of a chat', () => {
    const pasted = [
      'Think of it like a restaurant.',
      '',
      '* **API Gateway** = receptionist',
      '* **Queue** = waiting line',
      '',
      '## Your agent can stay together',
      '',
      'You do **not** need to split every LLM.',
      '',
      '```text',
      'Agent Worker',
      '```',
      '',
      '---',
      '',
      '# Simple architecture',
    ].join('\n');

    expect(kinds(pasted)).toEqual([
      'paragraph',
      'list',
      'heading',
      'paragraph',
      'code',
      'rule',
      'heading',
    ]);
  });
});
