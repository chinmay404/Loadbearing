import { Fragment, type ReactNode } from 'react';

/**
 * Markdown, rendered.
 *
 * Notes were shown as raw text, so a note pasted from a chat arrived full of asterisks
 * and hash marks and was harder to read than the plain prose it replaced.
 *
 * This is deliberately a small renderer rather than a dependency. It covers what
 * actually turns up in these notes — headings, emphasis, code, lists, quotes, links,
 * rules, tables are not attempted — and it builds React elements rather than HTML
 * strings, so there is no `dangerouslySetInnerHTML` anywhere and no way for a pasted
 * note to inject anything. Anything it does not recognise renders as the text it is,
 * which is the correct failure: worst case you see what you typed.
 */

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\w*)\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;

/** Split into blocks first: inline formatting cannot span a paragraph break. */
export function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      // An unterminated fence runs to the end rather than swallowing the document
      // into a broken state.
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'code', language: fence[1] ?? '', lines: body });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const body = [quote[1]!];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) {
        i += 1;
        body.push(QUOTE.exec(lines[i]!)![1]!);
      }
      blocks.push({ kind: 'quote', lines: body });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]!);
        const n = NUMBERED.exec(lines[i]!);
        const match = ordered ? (n ?? b) : (b ?? n);
        if (!match) break;
        items.push({ text: match[2]!, depth: Math.floor(match[1]!.length / 2) });
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Inline formatting, innermost last so a link's label can still be bold. Scanning
 * rather than one big regex, because nested emphasis is where a single pattern starts
 * matching across unrelated text.
 */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = key;

  const patterns: { re: RegExp; render: (m: RegExpExecArray) => ReactNode }[] = [
    // Code first: nothing inside a backtick span is formatting.
    { re: /`([^`]+)`/, render: (m) => <code key={`c${n}`}>{m[1]}</code> },
    {
      re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/,
      render: (m) => (
        <a key={`a${n}`} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>
      ),
    },
    { re: /\*\*([^*]+)\*\*/, render: (m) => <strong key={`b${n}`}>{inline(m[1]!, n + 1)}</strong> },
    { re: /__([^_]+)__/, render: (m) => <strong key={`b${n}`}>{inline(m[1]!, n + 1)}</strong> },
    { re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/, render: (m) => <em key={`i${n}`}>{inline(m[1]!, n + 1)}</em> },
    { re: /~~([^~]+)~~/, render: (m) => <s key={`s${n}`}>{m[1]}</s> },
  ];

  // Bare URLs get linked too, since a pasted note is full of them.
  const bare = /(?<![("])\bhttps?:\/\/[^\s<>()]+/;

  let guard = 0;
  while (rest.length > 0 && guard < 500) {
    guard += 1;
    let best: { index: number; length: number; node: ReactNode } | null = null;

    for (const { re, render } of patterns) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: render(m) };
      }
    }
    const url = bare.exec(rest);
    if (url && (best === null || url.index < best.index)) {
      best = {
        index: url.index,
        length: url[0].length,
        node: (
          <a key={`u${n}`} href={url[0]} target="_blank" rel="noopener noreferrer">
            {url[0]}
          </a>
        ),
      };
    }

    if (!best) break;
    if (best.index > 0) out.push(<Fragment key={`t${n}`}>{rest.slice(0, best.index)}</Fragment>);
    out.push(best.node);
    rest = rest.slice(best.index + best.length);
    n += 1;
  }

  if (rest.length > 0) out.push(<Fragment key={`t${n}`}>{rest}</Fragment>);
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parse(source);

  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            // h1 in a side panel would compete with the panel's own title, so the
            // scale starts one level down and stops at four.
            const Tag = `h${Math.min(6, block.level + 2)}` as 'h3';
            return <Tag key={i}>{inline(block.text)}</Tag>;
          }
          case 'code':
            return (
              <pre key={i} data-lang={block.language || undefined}>
                <code>{block.lines.join('\n')}</code>
              </pre>
            );
          case 'quote':
            return <blockquote key={i}>{inline(block.lines.join('\n'))}</blockquote>;
          case 'rule':
            return <hr key={i} />;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i}>
                {block.items.map((item, j) => (
                  <li key={j} style={item.depth > 0 ? { marginLeft: item.depth * 12 } : undefined}>
                    {inline(item.text)}
                  </li>
                ))}
              </Tag>
            );
          }
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
