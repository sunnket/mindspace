'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Renders block text with inline/block LaTeX math beautifully via KaTeX, while
 * leaving ordinary prose untouched. Math is written between delimiters:
 *   $ … $   or  \( … \)   → inline   (e.g. the area is $\pi r^2$)
 *   $$ … $$ or  \[ … \]   → display  (centered block)
 *
 * A lone `$` in prose (like "$5") is NOT treated as math — an inline `$…$` only
 * renders as math when its contents actually look mathematical, so currency and
 * plain text pass through as-is.
 */

// Inline "$…$" only counts as math if it contains a math indicator — a LaTeX
// command, a super/subscript, braces, or an equality/operator. This keeps "$5
// and $10" as plain text.
const MATH_HINT = /\\[a-zA-Z]+|[\^_{}=]|\\[^a-zA-Z]/;
const HAS_DELIM = /\$|\\\(|\\\[/;

interface Seg { text: string; math: boolean; display: boolean; }

function tokenize(src: string): Seg[] {
  const segs: Seg[] = [];
  let plain = '';
  let i = 0;
  const n = src.length;
  const flush = () => { if (plain) { segs.push({ text: plain, math: false, display: false }); plain = ''; } };

  while (i < n) {
    const two = src.slice(i, i + 2);

    if (two === '$$') {
      const end = src.indexOf('$$', i + 2);
      if (end !== -1) { flush(); segs.push({ text: src.slice(i + 2, end), math: true, display: true }); i = end + 2; continue; }
    }
    if (two === '\\[') {
      const end = src.indexOf('\\]', i + 2);
      if (end !== -1) { flush(); segs.push({ text: src.slice(i + 2, end), math: true, display: true }); i = end + 2; continue; }
    }
    if (two === '\\(') {
      const end = src.indexOf('\\)', i + 2);
      if (end !== -1) { flush(); segs.push({ text: src.slice(i + 2, end), math: true, display: false }); i = end + 2; continue; }
    }
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1) {
        const inner = src.slice(i + 1, end);
        if (!inner.includes('\n') && MATH_HINT.test(inner)) {
          flush(); segs.push({ text: inner, math: true, display: false }); i = end + 1; continue;
        }
      }
    }

    plain += src[i];
    i++;
  }
  flush();
  return segs;
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' });
  } catch {
    return '';
  }
}

export default function RichText({ content }: { content: string }) {
  const nodes = useMemo(() => {
    if (!content || !HAS_DELIM.test(content)) return null;
    const segs = tokenize(content);
    // No real math found → let the caller render the raw string as before.
    if (!segs.some((s) => s.math)) return null;
    return segs.map((s, idx) => {
      if (!s.math) return <span key={idx}>{s.text}</span>;
      const html = renderMath(s.text, s.display);
      if (!html) return <span key={idx}>{s.display ? `$$${s.text}$$` : `$${s.text}$`}</span>;
      return (
        <span
          key={idx}
          className={s.display ? 'block my-1' : 'inline'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    });
  }, [content]);

  if (nodes === null) return <>{content}</>;
  return <>{nodes}</>;
}
