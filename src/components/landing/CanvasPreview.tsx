'use client';

import React, { useMemo } from 'react';
import type { CanvasObjectData, ConnectionData } from '@/lib/db';
import { gistOf, rankForPreview, effectiveFontSize, textRole, isSemanticCandidate } from '@/lib/semanticZoom';
import { blockKind, splitByRanges, type Range } from '@/lib/canvasSearch';

/**
 * ------------------------------------------------------------------
 * A PREVIEW THAT SAYS WHAT IS IN THE BOARD.
 *
 * The old thumbnail was a scaled-down wireframe with the block labels drawn
 * into it as SVG text — at 240×140 that text lands between 3.2px and 8.5px,
 * which is not small type, it is texture. So every card showed you the same
 * thing: some rectangles. You could tell two boards apart by their shape and by
 * nothing else, and the answer to "what's in this one?" was always "open it".
 *
 * The fix keeps both halves of the problem in view rather than trading one for
 * the other:
 *
 *   · THE MAP STAYS, as a blueprint. Faded right back, no text, no fill detail
 *     — just the arrangement. That is what makes a board recognisable at a
 *     glance ("the wide one with the two columns"), and it is free.
 *   · THE WORDS COME FORWARD, at a size a person can actually read. The board's
 *     leading heading, then a line or two from the blocks that best describe
 *     it, rendered as real HTML text on top of the blueprint.
 *
 * And when a search is running, those support lines are replaced by the lines
 * that actually matched, with the query marked up — so a result explains itself
 * instead of just appearing.
 * ------------------------------------------------------------------ */

/** Blocks the blueprint will draw. Ranked, so headings survive the cut. */
const BLUEPRINT_LIMIT = 26;

/* ---------------------------------------------------------------- blueprint */

export const CanvasBlueprint = React.memo(function CanvasBlueprint({
  objects = [],
  connections = [],
  width = 240,
  height = 140,
  limit = BLUEPRINT_LIMIT,
}: {
  objects?: CanvasObjectData[];
  connections?: ConnectionData[];
  width?: number;
  height?: number;
  limit?: number;
}) {
  if (objects.length === 0) return null;

  /* A canvas object's x/y is its TOP-LEFT corner — reading them as a centre
     shifts every block up-left by half its own size, which is invisible on a
     sticky and half a screen on a frame. Only connections work from centres,
     because that is where a thread actually attaches. */
  let minX = Math.min(...objects.map((o) => o.x));
  let maxX = Math.max(...objects.map((o) => o.x + o.width));
  let minY = Math.min(...objects.map((o) => o.y));
  let maxY = Math.max(...objects.map((o) => o.y + o.height));
  const pad = 30;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;

  const boxW = Math.max(100, maxX - minX);
  const boxH = Math.max(100, maxY - minY);
  const scale = Math.min(width / boxW, height / boxH, 0.45);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const gx = (x: number) => (x - cx) * scale + width / 2;
  const gy = (y: number) => (y - cy) * scale + height / 2;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      aria-hidden="true"
      /* Decoration now, not information — the words above it carry that. Kept
         out of the accessibility tree and out of the hit-testing entirely. */
      style={{ pointerEvents: 'none' }}
    >
      {connections.map((conn) => {
        const from = objects.find((o) => o.id === conn.fromId);
        const to = objects.find((o) => o.id === conn.toId);
        if (!from || !to) return null;
        const fx = gx(from.x + from.width / 2), fy = gy(from.y + from.height / 2);
        const tx = gx(to.x + to.width / 2), ty = gy(to.y + to.height / 2);
        return (
          <path
            key={conn.id}
            d={`M ${fx} ${fy} Q ${(fx + tx) / 2} ${(fy + ty) / 2 - 10} ${tx} ${ty}`}
            stroke="var(--accent)" strokeWidth="1" fill="none" strokeDasharray="2 2" opacity="0.35"
          />
        );
      })}
      {[...rankForPreview(objects, limit)].sort((a, b) => a.zIndex - b.zIndex).map((obj) => {
        const rw = obj.width * scale;
        const rh = obj.height * scale;
        const rx = gx(obj.x);
        const ry = gy(obj.y);

        // A frame is a backdrop on the board, so it stays a backdrop here.
        if (obj.type === 'frame') {
          const c = (obj.style?.frameColor as string) || 'var(--accent)';
          return (
            <rect key={obj.id} x={rx} y={ry} width={rw} height={rh} rx={6} ry={6}
              fill={c} fillOpacity={0.05} stroke={c} strokeWidth="0.8" strokeOpacity={0.3} strokeDasharray="3 2" />
          );
        }

        let fill = 'var(--text-primary)';
        let fillOpacity = 0.1;
        let radius = 3.5;
        if (obj.type === 'shape') {
          fill = (obj.style?.color as string) || 'var(--accent-light)';
          fillOpacity = 0.4;
          if (obj.style?.shapeType === 'pill') radius = rh / 2;
          else if (obj.style?.shapeType === 'oval') radius = Math.min(rw, rh) / 2;
        } else if (obj.type === 'sticky') {
          fill = (obj.style?.color as string) || 'var(--sticky-yellow)';
          fillOpacity = 0.55;
          radius = 1;
        } else if (obj.type === 'heading') {
          fill = 'var(--accent)';
          fillOpacity = 0.32;
        } else if (obj.type === 'image') {
          fill = '#7BB3E0';
          fillOpacity = 0.35;
        }

        return (
          <rect key={obj.id} x={rx} y={ry} width={rw} height={rh} rx={radius} ry={radius}
            fill={fill} fillOpacity={fillOpacity}
            stroke="var(--text-primary)" strokeOpacity={0.09} strokeWidth="0.7" />
        );
      })}
    </svg>
  );
});

/* -------------------------------------------------------------- the reading */

export interface PreviewLine {
  key: string;
  kind: string;
  text: string;
  ranges?: Range[];
}

export interface CanvasReading {
  /** The board's own name for itself — its leading heading, if it has one. */
  lead: string | null;
  lines: PreviewLine[];
  /** "12 notes · 3 lists · 2 images" — what the board is made of. */
  composition: string;
}

/**
 * Plural for the block names used below.
 *
 * A bare `+ 's'` produced "5 stickys", which reads as a typo in the middle of
 * an otherwise careful interface. Three rules cover every kind `blockKind`
 * returns, and the one word they can't fix gets named properly instead.
 */
function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  if (word === 'code') return `${n} code blocks`;
  if (/[^aeiou]y$/.test(word)) return `${n} ${word.slice(0, -1)}ies`;   // sticky → stickies
  if (/(s|x|z|ch|sh)$/.test(word)) return `${n} ${word}es`;
  return `${n} ${word}s`;
}

/**
 * Read a board the way a person skims one: find its biggest heading, then the
 * two or three blocks that best describe it, then note what it is made of.
 */
export function readCanvas(objects: CanvasObjectData[], lineCount = 2): CanvasReading {
  const prose = objects.filter(isSemanticCandidate);

  /* The lead is a real heading if there is one, otherwise the largest display
     text. Ties break on position — top-left first — because that is where a
     board's title actually sits, and "the biggest of three equal headings" is
     otherwise decided by array order, which is creation order. */
  const headingish = prose
    .filter((o) => o.type === 'heading' || textRole(effectiveFontSize(o)) === 'display')
    .sort((a, b) => {
      const ha = a.type === 'heading' ? 1 : 0;
      const hb = b.type === 'heading' ? 1 : 0;
      if (ha !== hb) return hb - ha;
      const fs = effectiveFontSize(b) - effectiveFontSize(a);
      if (fs) return fs;
      return (a.y - b.y) || (a.x - b.x);
    });

  const leadObj = headingish[0] || null;
  const lead = leadObj ? gistOf(leadObj, 58).text : null;

  const rest = prose.filter((o) => o.id !== leadObj?.id);
  const lines: PreviewLine[] = rankForPreview(rest, lineCount)
    .slice(0, lineCount)
    .map((o) => ({ key: o.id, kind: blockKind(o), text: gistOf(o, 74).text }))
    .filter((l) => l.text);

  // Composition: the three biggest groups, so it stays a phrase not a table.
  const counts = new Map<string, number>();
  for (const o of objects) {
    if (o.type === 'frame' || o.type === 'pin' || o.type === 'arrow') continue;
    const k = blockKind(o);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const composition = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => plural(n, k))
    .join(' · ');

  return { lead, lines, composition };
}

/** Text with the query marked up. `<mark>` so it is announced as a match too. */
export function Highlight({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  return (
    <>
      {splitByRanges(text, ranges).map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            className="rounded-[3px]"
            style={{
              background: 'rgba(var(--accent-rgb), 0.26)',
              color: 'var(--accent)',
              fontWeight: 800,
              padding: '0 1px',
            }}
          >
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}

const KIND_DOT: Record<string, string> = {
  heading: 'var(--accent)',
  checklist: '#3F9E6B',
  checkpoint: '#E05B5B',
  sticky: '#D8A93F',
  table: '#4E86C4',
  chart: '#4E86C4',
  roadmap: '#4E86C4',
  timeline: '#4E86C4',
  quote: '#8B5FBF',
  code: '#8B5FBF',
};

/**
 * The card face: blueprint behind, words in front.
 *
 * `lines` may be overridden by the caller — that is how a search result shows
 * the blocks that actually matched instead of the board's usual summary.
 */
export function CanvasCardPreview({
  objects,
  connections,
  lines,
  leadRanges,
  height = 128,
  compact = false,
}: {
  objects: CanvasObjectData[];
  connections?: ConnectionData[];
  /** Override the summary lines (search results pass their hits here). */
  lines?: PreviewLine[];
  /** Highlight ranges for the lead heading, when it is what matched. */
  leadRanges?: Range[];
  height?: number;
  /** Denser type + one line, for list rows and small tiles. */
  compact?: boolean;
}) {
  const reading = useMemo(
    () => readCanvas(objects, compact ? 1 : 2),
    [objects, compact]
  );
  const shown = lines ?? reading.lines;

  if (objects.length === 0) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center gap-1.5 text-[var(--text-muted)]"
        style={{ height }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 17V9h6" />
        </svg>
        <span className="text-[10px] font-semibold">Empty board</span>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      {/* The map, right back where it belongs. */}
      <div className="absolute inset-0" style={{ opacity: 0.4 }}>
        <CanvasBlueprint objects={objects} connections={connections} width={280} height={height} />
      </div>

      {/* A scrim, so the words never have to compete with whatever is under
          them. Bottom-weighted: the text sits low, the map stays visible up top
          where it is doing its job. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.02) 34%, var(--preview-scrim) 74%, var(--preview-scrim) 100%)',
        }}
      />

      <div
        className="absolute inset-x-0 bottom-0 flex flex-col"
        style={{ padding: compact ? '8px 10px' : '10px 12px', gap: 3 }}
      >
        {reading.lead && (
          <p
            className="font-bold leading-tight text-[var(--text-primary)]"
            style={{
              fontSize: compact ? 12 : 13.5,
              letterSpacing: '-0.01em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            <Highlight text={reading.lead} ranges={leadRanges} />
          </p>
        )}

        {shown.map((l) => (
          <p
            key={l.key}
            className="flex items-start gap-1.5 text-[var(--text-secondary)] leading-snug"
            style={{ fontSize: compact ? 10 : 10.5 }}
          >
            <span
              className="shrink-0 rounded-full"
              style={{
                width: 4, height: 4, marginTop: compact ? 4 : 4.5,
                background: KIND_DOT[l.kind] || 'var(--text-muted)',
              }}
              aria-hidden="true"
            />
            <span className="truncate min-w-0">
              <Highlight text={l.text} ranges={l.ranges} />
            </span>
          </p>
        ))}

        {!compact && reading.composition && (
          <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)] truncate" style={{ marginTop: 1 }}>
            {reading.composition}
          </p>
        )}
      </div>
    </div>
  );
}
