'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Lightweight Notion-style renderer for canvas text. It understands a small,
 * familiar markdown subset plus LaTeX math — but ONLY upgrades content that
 * actually uses it. Plain prose is returned untouched (the parent block keeps
 * its `white-space: pre-wrap`), so ordinary notes render exactly as before.
 *
 * Block syntax (line-level):
 *   # / ## / ###   headings
 *   - / * / •      bullet list
 *   1.             numbered list
 *   [] / [x]       to-do checkbox
 *   >              callout / quote
 *   ---            divider
 * Inline syntax:
 *   **bold**  *italic* / _italic_  `code`  $math$ / \(math\)  $$display$$ / \[display\]
 */

const MATH_HINT = /\\[a-zA-Z]+|[\^_{}=]|\\[^a-zA-Z]/;
// Cheap gate: does the string contain ANY markdown/math worth parsing? Only real
// structures trigger it — a lone "*" or "_" in prose (2*3, snake_case) does NOT,
// so ordinary notes are never re-flowed.
const RICH_GATE = /(^|\n)\s*(#{1,3}\s|[-*•]\s|\d+\.\s|\[[ xX]?\]\s|>\s|---\s*$)|\*\*|`|\$|\\\(|\\\[/;

/* ----------------------------- inline parsing ---------------------------- */

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' });
  } catch {
    return '';
  }
}

// Split a single line into inline nodes: math, code, bold, italic, plain.
function renderInline(src: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = '';
  let i = 0;
  const n = src.length;
  let k = 0;
  const flush = () => { if (buf) { out.push(<React.Fragment key={`${keyBase}-t${k++}`}>{buf}</React.Fragment>); buf = ''; } };

  while (i < n) {
    const two = src.slice(i, i + 2);

    // Display math (rare inline, but supported)
    if (two === '$$') {
      const end = src.indexOf('$$', i + 2);
      if (end !== -1) { flush(); const html = renderMath(src.slice(i + 2, end), true); out.push(html ? <span key={`${keyBase}-m${k++}`} className="inline" dangerouslySetInnerHTML={{ __html: html }} /> : <span key={`${keyBase}-m${k++}`}>{src.slice(i, end + 2)}</span>); i = end + 2; continue; }
    }
    if (two === '\\(' ) {
      const end = src.indexOf('\\)', i + 2);
      if (end !== -1) { flush(); const html = renderMath(src.slice(i + 2, end), false); out.push(html ? <span key={`${keyBase}-m${k++}`} dangerouslySetInnerHTML={{ __html: html }} /> : <span key={`${keyBase}-m${k++}`}>{src.slice(i + 2, end)}</span>); i = end + 2; continue; }
    }
    if (two === '\\[' ) {
      const end = src.indexOf('\\]', i + 2);
      if (end !== -1) { flush(); const html = renderMath(src.slice(i + 2, end), true); out.push(html ? <span key={`${keyBase}-m${k++}`} className="inline" dangerouslySetInnerHTML={{ __html: html }} /> : <span key={`${keyBase}-m${k++}`}>{src.slice(i + 2, end)}</span>); i = end + 2; continue; }
    }
    // Inline math $…$ (only when it looks mathematical, so "$5" stays plain)
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1) {
        const inner = src.slice(i + 1, end);
        if (!inner.includes('\n') && MATH_HINT.test(inner)) {
          flush(); const html = renderMath(inner, false);
          out.push(html ? <span key={`${keyBase}-m${k++}`} dangerouslySetInnerHTML={{ __html: html }} /> : <span key={`${keyBase}-m${k++}`}>{src.slice(i, end + 1)}</span>);
          i = end + 1; continue;
        }
      }
    }
    // `code`
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push(<code key={`${keyBase}-c${k++}`} className="px-1 py-0.5 rounded bg-black/8 dark:bg-white/10 text-[0.9em] font-mono">{src.slice(i + 1, end)}</code>);
        i = end + 1; continue;
      }
    }
    // **bold**
    if (two === '**') {
      const end = src.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        out.push(<strong key={`${keyBase}-b${k++}`} className="font-bold">{renderInline(src.slice(i + 2, end), `${keyBase}-b${k}`)}</strong>);
        i = end + 2; continue;
      }
    }
    // *italic* (single asterisk; underscores are left alone to avoid mangling
    // identifiers like snake_case)
    if (src[i] === '*') {
      const end = src.indexOf('*', i + 1);
      if (end !== -1 && end > i + 1 && src[i + 1] !== ' ' && src[end - 1] !== ' ') {
        flush();
        out.push(<em key={`${keyBase}-i${k++}`} className="italic">{src.slice(i + 1, end)}</em>);
        i = end + 1; continue;
      }
    }

    buf += src[i];
    i++;
  }
  flush();
  return out;
}

/* ------------------------------ block parsing ---------------------------- */

function renderBlocks(content: string): React.ReactNode {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    const key = `l${idx}`;
    let m: RegExpMatchArray | null;

    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const lvl = m[1].length;
      const cls = lvl === 1 ? 'text-[1.5em] font-bold mt-1 mb-0.5' : lvl === 2 ? 'text-[1.25em] font-bold mt-1 mb-0.5' : 'text-[1.08em] font-semibold mt-0.5';
      nodes.push(<div key={key} className={cls} style={{ lineHeight: 1.3 }}>{renderInline(m[2], key)}</div>);
      return;
    }
    if (/^\s*---+\s*$/.test(line)) {
      nodes.push(<hr key={key} className="my-2 border-0 border-t border-[var(--border-strong)]" />);
      return;
    }
    if ((m = line.match(/^(\s*)>\s+(.*)$/))) {
      nodes.push(
        <div key={key} className="my-1 pl-3 border-l-[3px] border-[var(--accent)] bg-[var(--accent-subtle)] rounded-r-md py-1 pr-2">
          {renderInline(m[2], key)}
        </div>
      );
      return;
    }
    if ((m = line.match(/^(\s*)\[([ xX]?)\]\s+(.*)$/))) {
      const done = m[2].toLowerCase() === 'x';
      nodes.push(
        <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
          <span className={`mt-[0.15em] w-[1em] h-[1em] shrink-0 rounded-[4px] border flex items-center justify-center text-[0.7em] ${done ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--text-muted)]'}`}>{done ? '✓' : ''}</span>
          <span className={done ? 'line-through opacity-60' : ''}>{renderInline(m[3], key)}</span>
        </div>
      );
      return;
    }
    if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) {
      nodes.push(
        <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
          <span className="mt-[0.1em] text-[var(--accent)] leading-none select-none">•</span>
          <span className="min-w-0">{renderInline(m[2], key)}</span>
        </div>
      );
      return;
    }
    if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
      nodes.push(
        <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
          <span className="text-[var(--accent)] font-semibold tabular-nums select-none">{m[2]}.</span>
          <span className="min-w-0">{renderInline(m[3], key)}</span>
        </div>
      );
      return;
    }
    // Blank line → small vertical gap; keeps stanza spacing without collapsing.
    if (line.trim() === '') {
      nodes.push(<div key={key} style={{ height: '0.5em' }} />);
      return;
    }
    nodes.push(<div key={key}>{renderInline(line, key)}</div>);
  });

  return <div className="rich-text">{nodes}</div>;
}

export default function RichText({ content }: { content: string }) {
  const rendered = useMemo(() => {
    if (!content || !RICH_GATE.test(content)) return null;
    return renderBlocks(content);
  }, [content]);

  if (rendered === null) return <>{content}</>;
  return rendered;
}
