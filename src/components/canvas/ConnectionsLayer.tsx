'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

/* ------------------------------------------------------------------
   Smart routing.

   A connector used to be a straight segment between two box centres,
   clipped where it crossed each edge. That reads fine for one link and
   badly for everything else: lines leave a card at whatever random
   angle the geometry produced, several links from one block stack into
   the same spot, and a run of them turns into a starburst.

   So a connection now LEAVES AND ARRIVES THROUGH A FACE. Pick the pair
   of facing sides, anchor on those, and sweep between them with a cubic
   whose tangents are perpendicular to the faces — the line departs
   square to the card and arrives square to the next one, which is what
   makes a fan of them read as one flowing bundle instead of a scribble.
   ------------------------------------------------------------------ */

type Side = 'l' | 'r' | 't' | 'b';
type Rect = { x: number; y: number; width: number; height: number; centerX: number; centerY: number };

/**
 * Which faces should this link use?
 *
 * Whichever axis the two blocks are more separated on wins, with a bias
 * toward horizontal: cards on a board sit side by side far more often than
 * stacked, and left→right reads as flow. The bias is proportional (not a
 * fixed nudge) so it survives any zoom or card size.
 */
const chooseSides = (a: Rect, b: Rect): [Side, Side] => {
  const dx = b.centerX - a.centerX;
  const dy = b.centerY - a.centerY;
  // Gap along each axis — the space actually between the boxes, not the
  // distance between their centres, so a tall card beside a short one
  // doesn't read as "vertically separated" just because it's tall.
  const gapX = Math.max(0, Math.abs(dx) - (a.width + b.width) / 2);
  const gapY = Math.max(0, Math.abs(dy) - (a.height + b.height) / 2);
  const horizontal = gapX * 1.35 >= gapY;
  if (horizontal) return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
  return dy >= 0 ? ['b', 't'] : ['t', 'b'];
};

/**
 * Where on that face to sit.
 *
 * `spread` slides the anchor along the face so several links leaving one
 * block fan out across it instead of piling onto its midpoint — the
 * difference between the reference's clean bundle and a single overloaded
 * point. Clamped to the middle 70% so an anchor never lands on a corner.
 */
const anchorOn = (r: Rect, side: Side, spread: number) => {
  const t = Math.max(-0.35, Math.min(0.35, spread));
  switch (side) {
    case 'l': return { x: r.x, y: r.centerY + r.height * t, nx: -1, ny: 0 };
    case 'r': return { x: r.x + r.width, y: r.centerY + r.height * t, nx: 1, ny: 0 };
    case 't': return { x: r.centerX + r.width * t, y: r.y, nx: 0, ny: -1 };
    default:  return { x: r.centerX + r.width * t, y: r.y + r.height, nx: 0, ny: 1 };
  }
};

/** The sweeping cubic between two face anchors. */
const smartPath = (a: Rect, b: Rect, spreadA: number, spreadB: number) => {
  const [sideA, sideB] = chooseSides(a, b);
  const p = anchorOn(a, sideA, spreadA);
  const q = anchorOn(b, sideB, spreadB);

  const dist = Math.hypot(q.x - p.x, q.y - p.y);
  /* How far the curve runs straight out of each face before it turns.
     Proportional to the span so short links stay taut and long ones bow
     gracefully, but floored so touching cards still leave squarely, and
     capped so a link across the whole board doesn't balloon. */
  const reach = Math.max(26, Math.min(150, dist * 0.42));

  const c1 = { x: p.x + p.nx * reach, y: p.y + p.ny * reach };
  const c2 = { x: q.x + q.nx * reach, y: q.y + q.ny * reach };

  return {
    d: `M ${p.x} ${p.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${q.x} ${q.y}`,
    start: { x: p.x, y: p.y },
    end: { x: q.x, y: q.y },
    // Midpoint of the cubic (t=0.5) — where the delete button belongs. The
    // straight-line average sat off the curve on anything but a gentle bend.
    mid: {
      x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8,
      y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8,
    },
  };
};

export default function ConnectionsLayer() {
  const connections = useCanvasStore((s) => s.connections);
  const objects = useCanvasStore((s) => s.objects);
  const removeConnection = useCanvasStore((s) => s.removeConnection);
  const mode = useCanvasStore((s) => s.mode);

  const [hoveredConnId, setHoveredConnId] = useState<string | null>(null);

  const getObjectVisualRect = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || obj.style?.isMinimized) return null;

    return {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      centerX: obj.x + obj.width / 2,
      centerY: obj.y + obj.height / 2,
    };
  };

  const getIntersectionPoint = (rect: any, otherX: number, otherY: number) => {
    const cx = rect.centerX;
    const cy = rect.centerY;

    const dx = otherX - cx;
    const dy = otherY - cy;

    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // Line equation: (x-cx)/dx = (y-cy)/dy = t
    // Check intersection with vertical edges
    const tX = dx > 0 ? halfW / dx : -halfW / dx;
    // Check intersection with horizontal edges
    const tY = dy > 0 ? halfH / dy : -halfH / dy;

    const t = Math.min(Math.abs(tX), Math.abs(tY));

    return {
      x: cx + dx * t,
      y: cy + dy * t
    };
  };

  /**
   * Fan offsets: for every block, spread the links that share it evenly
   * across the face they use. Computed once per render for the whole layer
   * because a link can only know where to sit relative to its SIBLINGS.
   */
  const fanOffsets = useMemo(() => {
    const rectOf = (id: string) => {
      const o = objects.find((ob) => ob.id === id);
      if (!o || o.style?.isMinimized) return null;
      return { x: o.x, y: o.y, width: o.width, height: o.height, centerX: o.x + o.width / 2, centerY: o.y + o.height / 2 };
    };
    // key: `${objectId}|${side}` → the connection ids landing there
    const groups = new Map<string, string[]>();
    const sideOf = new Map<string, { from: Side; to: Side }>();

    for (const c of connections) {
      if (c.style?.thread) continue;
      const a = rectOf(c.fromId);
      const b = rectOf(c.toId);
      if (!a || !b) continue;
      const [sa, sb] = chooseSides(a, b);
      sideOf.set(c.id, { from: sa, to: sb });
      const ka = `${c.fromId}|${sa}`;
      const kb = `${c.toId}|${sb}`;
      groups.set(ka, [...(groups.get(ka) || []), c.id]);
      groups.set(kb, [...(groups.get(kb) || []), c.id]);
    }

    // Order each group along the face so the fan never crosses itself.
    const offset = new Map<string, { from: number; to: number }>();
    for (const [key, ids] of groups) {
      const [objId, side] = key.split('|') as [string, Side];
      const here = rectOf(objId);
      if (!here) continue;
      const sorted = [...ids].sort((x, y) => {
        const cx = connections.find((c) => c.id === x)!;
        const cy = connections.find((c) => c.id === y)!;
        const ox = rectOf(cx.fromId === objId ? cx.toId : cx.fromId);
        const oy = rectOf(cy.fromId === objId ? cy.toId : cy.fromId);
        if (!ox || !oy) return 0;
        // Along a vertical face rank by the other block's Y; along a
        // horizontal face rank by its X.
        return side === 'l' || side === 'r' ? ox.centerY - oy.centerY : ox.centerX - oy.centerX;
      });
      const n = sorted.length;
      sorted.forEach((id, i) => {
        // One link sits dead centre; more spread symmetrically around it.
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * Math.min(0.62, 0.2 * n);
        const conn = connections.find((c) => c.id === id)!;
        const prev = offset.get(id) || { from: 0, to: 0 };
        offset.set(id, conn.fromId === objId ? { ...prev, from: t } : { ...prev, to: t });
      });
    }
    return offset;
  }, [connections, objects]);

  return (
    <div className="absolute top-0 left-0 pointer-events-none overflow-visible">
      {/* 1x1 SVG with visible overflow: paths render at world coordinates without
          creating a giant layout box (a 100000x100000 layer can exhaust GPU memory) */}
      <svg
        width="1"
        height="1"
        style={{ pointerEvents: 'none', position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <marker 
            id="workflow-arrow" 
            viewBox="0 0 10 10"
            refX="6" 
            refY="5" 
            markerWidth="7" 
            markerHeight="7" 
            orient="auto"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 Z" fill="currentColor" />
          </marker>
          <style>{`
            @keyframes workflow-pulse {
              from {
                stroke-dashoffset: 24;
              }
              to {
                stroke-dashoffset: 0;
              }
            }
            .workflow-pulse-path {
              /* Static dashes at rest: the infinite animation forced a repaint of the
                 connection layer every frame, which stacks up badly on large canvases */
              stroke-dasharray: 8, 4;
            }
            .workflow-pulse-path-hover {
              stroke-dasharray: 8, 4;
              animation: workflow-pulse 0.7s linear infinite;
            }
          `}</style>
        </defs>
        <AnimatePresence>
          {Array.from(new Map(connections.map(c => [c.id, c])).values()).map((conn) => {
            const rectA = getObjectVisualRect(conn.fromId);
            const rectB = getObjectVisualRect(conn.toId);

            if (!rectA || !rectB) return null;

            /* A brainstorm THREAD is drawn like real string on a cork wall:
               centre-to-centre with a gravity sag, a soft drop shadow, and a
               little knot tied at each pin. It skips the workflow/edge-clip
               geometry entirely. */
            if (conn.style?.thread) {
              const isHovered = hoveredConnId === conn.id;
              const ax = rectA.centerX, ay = rectA.centerY;
              const bx = rectB.centerX, by = rectB.centerY;
              const dist = Math.hypot(bx - ax, by - ay);
              // Sag grows with span but is capped so long runs don't droop forever.
              const sag = Math.min(90, dist * 0.18);
              const midX = (ax + bx) / 2;
              const midY = (ay + by) / 2 + sag;
              const d = `M ${ax} ${ay} Q ${midX} ${midY} ${bx} ${by}`;
              const threadColor = (conn.style?.color as string) || '#D64541';
              return (
                <g key={conn.id}>
                  {/* fat invisible hit area */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={20}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onMouseEnter={() => setHoveredConnId(conn.id)}
                    onMouseLeave={() => setHoveredConnId(null)}
                  />
                  {/* shadow the string casts on the board */}
                  <path d={d} fill="none" stroke="#000" strokeOpacity={0.14} strokeWidth={3.5} strokeLinecap="round" transform="translate(0.5 2.5)" />
                  {/* the string itself */}
                  <motion.path
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    exit={{ pathLength: 0, opacity: 0 }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    d={d}
                    fill="none"
                    stroke={isHovered ? 'var(--accent)' : threadColor}
                    strokeWidth={isHovered ? 3 : 2.2}
                    strokeLinecap="round"
                    style={{ filter: isHovered ? 'url(#line-glow)' : 'none', transition: 'stroke 0.25s, stroke-width 0.2s' }}
                  />
                  {/* knots where the thread ties off */}
                  {[[ax, ay], [bx, by]].map(([kx, ky], i) => (
                    <g key={i}>
                      <circle cx={kx} cy={ky} r={4} fill={isHovered ? 'var(--accent)' : threadColor} />
                      <circle cx={kx} cy={ky} r={4} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={1} />
                    </g>
                  ))}
                  {isHovered && (
                    <foreignObject x={midX - 15} y={midY - 15} width={30} height={30} style={{ pointerEvents: 'auto' }}>
                      <motion.button
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center shadow-xl border border-white/20 hover:bg-red-500 transition-colors"
                        onClick={(e) => { e.stopPropagation(); removeConnection(conn.id); }}
                        onMouseEnter={() => setHoveredConnId(conn.id)}
                        title="Cut thread"
                      >
                        <span className="text-[12px] font-bold">✕</span>
                      </motion.button>
                    </foreignObject>
                  )}
                </g>
              );
            }

            const isWorkflow = conn.style?.isWorkflowConnection ||
                               (objects.find(o => o.id === conn.fromId)?.type === 'workflow-node' && 
                                objects.find(o => o.id === conn.toId)?.type === 'workflow-node');
            
            let d = '';
            let start = { x: 0, y: 0 };
            let end = { x: 0, y: 0 };
            let mid: { x: number; y: number } | null = null;

            if (!isWorkflow) {
              /* Smart routing — leave through a face, arrive through a face,
                 fanned so siblings don't stack. `straight` on a connection
                 opts back into the old dead-straight centre-to-centre line
                 for anyone who wants it. */
              if (conn.style?.straight) {
                start = getIntersectionPoint(rectA, rectB.centerX, rectB.centerY);
                end = getIntersectionPoint(rectB, rectA.centerX, rectA.centerY);
                d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
              } else {
                const fan = fanOffsets.get(conn.id) || { from: 0, to: 0 };
                const routed = smartPath(rectA, rectB, fan.from, fan.to);
                d = routed.d;
                start = routed.start;
                end = routed.end;
                mid = routed.mid;
              }
            } else {
              const dx = rectB.centerX - rectA.centerX;
              const dy = rectB.centerY - rectA.centerY;
              
              if (Math.abs(dx) > Math.abs(dy)) {
                if (dx >= 0) {
                  start = { x: rectA.x + rectA.width, y: rectA.centerY };
                  end = { x: rectB.x - 3, y: rectB.centerY }; // offset slightly for arrowhead clearance
                } else {
                  start = { x: rectA.x, y: rectA.centerY };
                  end = { x: rectB.x + rectB.width + 3, y: rectB.centerY };
                }
                const offset = Math.abs(end.x - start.x) * 0.45;
                const cpx1 = start.x + (dx >= 0 ? offset : -offset);
                const cpy1 = start.y;
                const cpx2 = end.x - (dx >= 0 ? offset : -offset);
                const cpy2 = end.y;
                d = `M ${start.x} ${start.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${end.x} ${end.y}`;
              } else {
                if (dy >= 0) {
                  start = { x: rectA.centerX, y: rectA.y + rectA.height };
                  end = { x: rectB.centerX, y: rectB.y - 3 };
                } else {
                  start = { x: rectA.centerX, y: rectA.y };
                  end = { x: rectB.centerX, y: rectB.y + rectB.height + 3 };
                }
                const offset = Math.abs(end.y - start.y) * 0.45;
                const cpx1 = start.x;
                const cpy1 = start.y + (dy >= 0 ? offset : -offset);
                const cpx2 = end.x;
                const cpy2 = end.y - (dy >= 0 ? offset : -offset);
                d = `M ${start.x} ${start.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${end.x} ${end.y}`;
              }
            }

            const isHovered = hoveredConnId === conn.id;
            // On a routed curve the true midpoint is the cubic's t=0.5, not the
            // average of the endpoints — that sat well off the line on a bend.
            const midX = mid ? mid.x : (start.x + end.x) / 2;
            const midY = mid ? mid.y : (start.y + end.y) / 2;
            /* A plain connector used to be hard-coded `rgba(0,0,0,0.8)` —
               black ink, which simply disappears on the dark canvas. It reads
               off a theme variable now so a link is equally legible either
               way, and the smarter routing is actually visible. */
            const connColor = isHovered
              ? "var(--accent)"
              : ((conn.style?.color as string) || (isWorkflow ? '#C97B4B' : 'var(--connector-ink)'));

            return (
              <g key={conn.id}>
                {/* Hit area for hover */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onMouseEnter={() => setHoveredConnId(conn.id)}
                  onMouseLeave={() => setHoveredConnId(null)}
                />

                {/* Background Shadow Line */}
                <motion.path
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.15 }}
                  d={d}
                  fill="none"
                  stroke="#000"
                  strokeWidth={4}
                  strokeLinecap="round"
                />

                {/* The visible connection line */}
                <motion.path
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ pathLength: 0, opacity: 0 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  d={d}
                  fill="none"
                  stroke={connColor}
                  strokeWidth={isHovered ? 2.6 : isWorkflow ? 2 : 1.8}
                  strokeLinecap="round"
                  className={
                    isWorkflow
                      ? (isHovered ? 'workflow-pulse-path-hover' : 'workflow-pulse-path')
                      : ''
                  }
                  style={{ 
                    color: connColor,
                    filter: isHovered ? 'url(#line-glow)' : 'none',
                    transition: 'stroke 0.3s, stroke-width 0.3s'
                  }}
                  markerEnd={isWorkflow ? "url(#workflow-arrow)" : undefined}
                />

                {/* Delete button on hover */}
                {isHovered && (
                  <foreignObject
                    x={midX - 15}
                    y={midY - 15}
                    width={30}
                    height={30}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <motion.button
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center shadow-xl border border-white/20 hover:bg-red-500 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeConnection(conn.id);
                      }}
                      onMouseEnter={() => setHoveredConnId(conn.id)}
                    >
                      <span className="text-[12px] font-bold">✕</span>
                    </motion.button>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </AnimatePresence>
      </svg>
    </div>
  );
}
