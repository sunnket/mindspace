'use client';

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useCanvasStore } from '@/store/canvasStore';

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
 *   ▸ / >>         collapsible toggle (its indented lines are the hidden body)
 *   ---            divider
 * Inline syntax:
 *   **bold**  *italic* / _italic_  ~~strike~~  ==highlight==  `code`
 *   $math$ / \(math\)  $$display$$ / \[display\]
 *   @[label](ref:id)  clickable jump-to-block chip
 */

const MATH_HINT = /\\[a-zA-Z]+|[\^_{}=]|\\[^a-zA-Z]/;
// Cheap gate: does the string contain ANY markdown/math worth parsing? Only real
// structures trigger it — a lone "*" or "_" in prose (2*3, snake_case) does NOT,
// so ordinary notes are never re-flowed.
const RICH_GATE = /(^|\n)[ \t]*(#{1,3}\s|[-*•]\s|\d+\.\s|\[[ xX]?\]\s|>\s|>>\s|▸\s|▾\s|```|---\s*$)|\*\*|~~|==|\|\||`|\$|\\\(|\\\[|@\[/;

// A toggle header line: "▸ text", "▾ text", or the ASCII alias ">> text".
const TOGGLE_RE = /^([ \t]*)(?:▸|▾|>>)\s+(.*)$/;

/* -------------------------------- jump ---------------------------------- */

/** Pan the camera to center a target block and select it (used by @-chips). */
function jumpToObject(id: string) {
  const s = useCanvasStore.getState();
  const target = s.objects.find((o) => o.id === id);
  if (!target) return;
  const { camera } = s;
  s.setCamera({
    x: -(target.x + target.width / 2) * camera.zoom + window.innerWidth / 2,
    y: -(target.y + target.height / 2) * camera.zoom + window.innerHeight / 2,
    zoom: camera.zoom,
  });
  s.setSelectedId(id);
  s.setFocusedId?.(null);
}

/* ----------------------------- inline parsing ---------------------------- */

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' });
  } catch {
    return '';
  }
}

// Split a single line into inline nodes: math, code, bold, italic, marks, plain.
function renderInline(src: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = '';
  let i = 0;
  const n = src.length;
  let k = 0;
  const flush = () => { if (buf) { out.push(<React.Fragment key={`${keyBase}-t${k++}`}>{buf}</React.Fragment>); buf = ''; } };

  while (i < n) {
    const two = src.slice(i, i + 2);

    // @[label](ref:id) — an inline jump-to-block chip
    if (two === '@[') {
      const close = src.indexOf('](ref:', i + 2);
      if (close !== -1) {
        const end = src.indexOf(')', close + 6);
        if (end !== -1) {
          const label = src.slice(i + 2, close);
          const id = src.slice(close + 6, end);
          if (id) {
            flush();
            out.push(
              <button
                key={`${keyBase}-ref${k++}`}
                type="button"
                className="mention-chip"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); jumpToObject(id); }}
              >
                <span className="mention-at">@</span>{label || 'link'}
              </button>
            );
            i = end + 1; continue;
          }
        }
      }
    }

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
    // ~~strikethrough~~ (guard against bare tildes: no space just inside the marks)
    if (two === '~~') {
      const end = src.indexOf('~~', i + 2);
      if (end !== -1 && end > i + 2 && src[i + 2] !== ' ' && src[end - 1] !== ' ') {
        flush();
        out.push(<span key={`${keyBase}-s${k++}`} className="line-through opacity-60">{renderInline(src.slice(i + 2, end), `${keyBase}-s${k}`)}</span>);
        i = end + 2; continue;
      }
    }
    // ==highlight== (guard so "a == b" arithmetic never converts)
    if (two === '==') {
      const end = src.indexOf('==', i + 2);
      if (end !== -1 && end > i + 2 && src[i + 2] !== ' ' && src[end - 1] !== ' ') {
        flush();
        out.push(<mark key={`${keyBase}-h${k++}`} className="rich-highlight">{renderInline(src.slice(i + 2, end), `${keyBase}-h${k}`)}</mark>);
        i = end + 2; continue;
      }
    }
    // ||spoiler|| — hidden behind a bar until clicked (guarded so "a || b"
    // logic in a code note never turns into a spoiler)
    if (two === '||') {
      const end = src.indexOf('||', i + 2);
      if (end !== -1 && end > i + 2 && src[i + 2] !== ' ' && src[end - 1] !== ' ') {
        flush();
        out.push(
          <span
            key={`${keyBase}-sp${k++}`}
            className="spoiler"
            title="Click to reveal"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); e.currentTarget.classList.toggle('revealed'); }}
          >
            {renderInline(src.slice(i + 2, end), `${keyBase}-sp${k}`)}
          </span>
        );
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

// Count leading indentation of a line (tabs count as two spaces).
function leadWs(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, '  ').length : 0;
}

interface RenderCtx {
  collapsed: Record<string, boolean>;
  toggle: (key: string) => void;
  occ: Map<string, number>; // stable per-text occurrence counter for toggle keys
}

// Render one non-toggle line to a node.
function renderLine(line: string, key: string): React.ReactNode {
  let m: RegExpMatchArray | null;

  if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
    const lvl = m[1].length;
    const cls = lvl === 1 ? 'text-[1.5em] font-bold mt-1 mb-0.5' : lvl === 2 ? 'text-[1.25em] font-bold mt-1 mb-0.5' : 'text-[1.08em] font-semibold mt-0.5';
    return <div key={key} className={cls} style={{ lineHeight: 1.3 }}>{renderInline(m[2], key)}</div>;
  }
  if (/^\s*---+\s*$/.test(line)) {
    return <hr key={key} className="my-2 border-0 border-t border-[var(--border-strong)]" />;
  }
  if ((m = line.match(/^(\s*)>\s+(.*)$/))) {
    return (
      <div key={key} className="my-1 pl-3 border-l-[3px] border-[var(--accent)] bg-[var(--accent-subtle)] rounded-r-md py-1 pr-2">
        {renderInline(m[2], key)}
      </div>
    );
  }
  if ((m = line.match(/^(\s*)\[([ xX]?)\]\s+(.*)$/))) {
    const done = m[2].toLowerCase() === 'x';
    return (
      <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
        <span className={`mt-[0.15em] w-[1em] h-[1em] shrink-0 rounded-[4px] border flex items-center justify-center text-[0.7em] ${done ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--text-muted)]'}`}>{done ? '✓' : ''}</span>
        <span className={done ? 'line-through opacity-60' : ''}>{renderInline(m[3], key)}</span>
      </div>
    );
  }
  if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) {
    return (
      <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
        <span className="mt-[0.1em] text-[var(--accent)] leading-none select-none">•</span>
        <span className="min-w-0">{renderInline(m[2], key)}</span>
      </div>
    );
  }
  if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
    return (
      <div key={key} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: m[1].length * 8 }}>
        <span className="text-[var(--accent)] font-semibold tabular-nums select-none">{m[2]}.</span>
        <span className="min-w-0">{renderInline(m[3], key)}</span>
      </div>
    );
  }
  // Blank line → small vertical gap; keeps stanza spacing without collapsing.
  if (line.trim() === '') {
    return <div key={key} style={{ height: '0.5em' }} />;
  }
  return <div key={key}>{renderInline(line, key)}</div>;
}

function renderBlocks(content: string, ctx: RenderCtx): React.ReactNode {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `l${i}`;

    // ```fenced``` code block — gather raw lines until the closing fence. If the
    // fence never closes we fall through and render the line as ordinary text,
    // so a half-typed block never swallows the rest of the note.
    if (/^```(\w*)\s*$/.test(line)) {
      const codeLines: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (/^```\s*$/.test(lines[j])) { closed = true; break; }
        codeLines.push(lines[j]);
        j++;
      }
      if (closed) {
        nodes.push(<pre key={key} className="rich-code-block">{codeLines.join('\n')}</pre>);
        i = j + 1;
        continue;
      }
    }

    const tm = line.match(TOGGLE_RE);

    if (tm) {
      const headWs = leadWs(line);
      const headText = tm[2];

      // Gather the body: following lines indented deeper than the header.
      // Blank lines are kept only if a deeper line follows, so a toggle can hold
      // multi-paragraph detail without a stray blank line ending it early.
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const cl = lines[j];
        if (cl.trim() === '') { bodyLines.push(cl); j++; continue; }
        if (leadWs(cl) > headWs) { bodyLines.push(cl); j++; continue; }
        break;
      }
      while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

      // Stable collapse key: heading text + its occurrence index among same-text
      // toggles, so it survives re-renders and content edits elsewhere.
      const base = headText.trim();
      const occN = ctx.occ.get(base) ?? 0;
      ctx.occ.set(base, occN + 1);
      const tkey = `${base}#${occN}`;
      const isCollapsed = ctx.collapsed[tkey] === true; // default expanded
      const hasBody = bodyLines.length > 0;

      // Dedent the body to its shallowest line so nested lists render relative
      // to the toggle rather than at their absolute canvas indentation.
      let body: React.ReactNode = null;
      if (hasBody && !isCollapsed) {
        const minWs = Math.min(...bodyLines.filter((l) => l.trim() !== '').map(leadWs));
        const dedented = bodyLines.map((l) => l.replace(new RegExp(`^[ \\t]{0,${minWs}}`), '')).join('\n');
        body = (
          <div
            className="border-l border-[var(--border-strong)]"
            style={{ marginLeft: 9, paddingLeft: 12, marginTop: 2 }}
          >
            {renderBlocks(dedented, ctx)}
          </div>
        );
      }

      nodes.push(
        <div key={key} style={{ marginTop: 2, marginBottom: 2 }}>
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              className="toggle-chevron shrink-0"
              aria-expanded={!isCollapsed}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); if (hasBody) ctx.toggle(tkey); }}
              style={{ cursor: hasBody ? 'pointer' : 'default', opacity: hasBody ? 1 : 0.35, marginTop: '0.28em' }}
            >
              <svg
                width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease' }}
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
            <span className="font-semibold min-w-0">{renderInline(headText, key)}</span>
          </div>
          {body}
        </div>
      );

      i = j;
      continue;
    }

    nodes.push(renderLine(line, key));
    i++;
  }

  return <div className="rich-text">{nodes}</div>;
}

export default function RichText({
  content,
  persistedCollapsed,
  onCollapseChange,
}: {
  content: string;
  persistedCollapsed?: Record<string, boolean>;
  onCollapseChange?: (next: Record<string, boolean>) => void;
}) {
  // Collapse state is seeded once from what was persisted on the block, then
  // driven locally; every change is echoed back so it survives an edit round-trip.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => persistedCollapsed || {});
  const cbRef = useRef(onCollapseChange);
  useEffect(() => { cbRef.current = onCollapseChange; });

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      cbRef.current?.(next);
      return next;
    });
  }, []);

  const rendered = useMemo(() => {
    if (!content || !RICH_GATE.test(content)) return null;
    return renderBlocks(content, { collapsed, toggle, occ: new Map() });
  }, [content, collapsed, toggle]);

  if (rendered === null) return <>{content}</>;
  return rendered;
}
