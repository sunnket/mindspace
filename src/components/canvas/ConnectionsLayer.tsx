'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import {
  buildConnector,
  capGeom,
  chooseSides,
  dashArray,
  dashCycle,
  rectOf,
  resolveConnector,
  type ConnectorStyle,
  type Rect,
  type Side,
} from '@/lib/connectors';

/* ------------------------------------------------------------------
   Drawing the links.

   All the geometry lives in `lib/connectors` — shapes, subtypes, caps,
   attachment. This file is only responsible for three things the geometry
   can't know on its own:

     · FANNING. A link can only know where to sit on a face relative to its
       SIBLINGS, so the offsets are solved once per render for the whole board.
       Without it, six links out of one card stack onto the same point and the
       result reads as a starburst instead of a bundle.
     · INTERACTION. Hover to reveal the cut button, click to select — which is
       what opens the connector options panel at the top of the screen.
     · The brainstorm THREAD, which is not a diagram connector at all but
       string on a cork wall, and keeps its own drawing entirely.
   ------------------------------------------------------------------ */

type Fanned = { from: number; to: number };

export default function ConnectionsLayer() {
  const connections = useCanvasStore((s) => s.connections);
  const objects = useCanvasStore((s) => s.objects);
  const removeConnection = useCanvasStore((s) => s.removeConnection);
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const setSelectedConnectionId = useCanvasStore((s) => s.setSelectedConnectionId);

  const [hoveredConnId, setHoveredConnId] = useState<string | null>(null);

  /** Live box of a block, or null if it isn't on the board to point at. */
  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const o of objects) {
      if (o.style?.isMinimized) continue;
      map.set(o.id, rectOf(o));
    }
    return map;
  }, [objects]);

  /** Each connection's resolved look — read once, used by fanning and drawing. */
  const configs = useMemo(() => {
    const map = new Map<string, ConnectorStyle>();
    for (const c of connections) {
      if (c.style?.thread) continue;
      const workflow =
        !!c.style?.isWorkflowConnection ||
        (objects.find((o) => o.id === c.fromId)?.type === 'workflow-node' &&
          objects.find((o) => o.id === c.toId)?.type === 'workflow-node');
      map.set(c.id, resolveConnector(c.style, { workflow }));
    }
    return map;
  }, [connections, objects]);

  /**
   * Spread the links that share a face evenly across it, ordered so the fan
   * never crosses itself. Only the face-anchored shapes take part: an arc and
   * a direct straight line are measured from the centres, so nudging them
   * along a face would just detach them.
   */
  const fanOffsets = useMemo(() => {
    const groups = new Map<string, string[]>();

    for (const c of connections) {
      const cfg = configs.get(c.id);
      if (!cfg) continue;
      const faceAnchored =
        cfg.shape === 'curve' || cfg.shape === 'scribble' || cfg.shape === 'elbow' ||
        (cfg.shape === 'straight' && cfg.variant === 'square');
      if (!faceAnchored) continue;
      const a = rects.get(c.fromId);
      const b = rects.get(c.toId);
      if (!a || !b) continue;
      const prefer = cfg.shape === 'elbow' && (cfg.variant === 'h' || cfg.variant === 'v')
        ? (cfg.variant as 'h' | 'v')
        : undefined;
      const [sa, sb] = chooseSides(a, b, prefer);
      const ka = `${c.fromId}|${sa}`;
      const kb = `${c.toId}|${sb}`;
      groups.set(ka, [...(groups.get(ka) || []), c.id]);
      groups.set(kb, [...(groups.get(kb) || []), c.id]);
    }

    const offset = new Map<string, Fanned>();
    for (const [key, ids] of groups) {
      const [objId, side] = key.split('|') as [string, Side];
      const sorted = [...ids].sort((x, y) => {
        const cx = connections.find((c) => c.id === x)!;
        const cy = connections.find((c) => c.id === y)!;
        const ox = rects.get(cx.fromId === objId ? cx.toId : cx.fromId);
        const oy = rects.get(cy.fromId === objId ? cy.toId : cy.fromId);
        if (!ox || !oy) return 0;
        // Along a vertical face rank by the other block's Y; along a
        // horizontal face rank by its X.
        return side === 'l' || side === 'r' ? ox.cy - oy.cy : ox.cx - oy.cx;
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
  }, [connections, configs, rects]);

  const unique = useMemo(
    () => Array.from(new Map(connections.map((c) => [c.id, c])).values()),
    [connections],
  );

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
          <style>{`
            /* Marching dashes. The cycle length differs per connector (it scales
               with the line weight), so the distance travelled comes in as a
               custom property — that's what keeps the loop seamless instead of
               visibly jumping every repeat. */
            @keyframes conn-flow {
              to { stroke-dashoffset: calc(var(--conn-cycle, 8px) * -1); }
            }
            .conn-flow { animation: conn-flow 0.55s linear infinite; }
          `}</style>
        </defs>
        <AnimatePresence>
          {unique.map((conn) => {
            const rectA = rects.get(conn.fromId);
            const rectB = rects.get(conn.toId);
            if (!rectA || !rectB) return null;

            /* A brainstorm THREAD is drawn like real string on a cork wall:
               centre-to-centre with a gravity sag, a soft drop shadow, and a
               little knot tied at each pin. It skips the connector geometry
               entirely — it isn't a diagram line. */
            if (conn.style?.thread) {
              const isHovered = hoveredConnId === conn.id;
              const ax = rectA.cx, ay = rectA.cy;
              const bx = rectB.cx, by = rectB.cy;
              const span = Math.hypot(bx - ax, by - ay);
              // Sag grows with span but is capped so long runs don't droop forever.
              const sag = Math.min(90, span * 0.18);
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

            const cfg = configs.get(conn.id) || resolveConnector(conn.style);
            const fan = fanOffsets.get(conn.id) || { from: 0, to: 0 };
            const built = buildConnector(rectA, rectB, cfg, fan, conn.id);

            const isSelected = selectedConnectionId === conn.id;
            const isHovered = hoveredConnId === conn.id;
            const lit = isSelected || isHovered;

            /* A plain connector used to be hard-coded black ink, which simply
               disappears on the dark canvas. It reads off a theme variable
               unless the user picked an ink, so a link is equally legible
               either way. */
            const ink = cfg.color || 'var(--connector-ink)';
            const stroke = isSelected ? 'var(--accent)' : isHovered ? 'var(--accent)' : ink;
            const weight = lit ? cfg.weight + 0.7 : cfg.weight;

            const dashes = dashArray(cfg);
            // A cap must never wear the dash pattern — a dashed arrowhead is
            // just a broken arrowhead.
            const startCap = capGeom(cfg.startCap, built.tipStart, built.startAngle + Math.PI, weight);
            const endCap = capGeom(cfg.endCap, built.tipEnd, built.endAngle, weight);

            const labelW = Math.max(24, cfg.label.length * 6.4 + 14);

            return (
              <g key={conn.id}>
                {/* Hit area. Wide enough to catch a line you're aiming at, and
                    it's what makes a connector clickable — selecting one is how
                    the options panel opens. */}
                <path
                  d={built.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onMouseEnter={() => setHoveredConnId(conn.id)}
                  onMouseLeave={() => setHoveredConnId(null)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Picking a link puts down whatever block was held.
                    if (!isSelected) useCanvasStore.getState().setSelectedId(null);
                    setSelectedConnectionId(isSelected ? null : conn.id);
                  }}
                />

                {/* Lit up: a soft halo behind the stroke, so the line you're
                    pointing at or editing is obvious even where it runs over
                    busy content.

                    This used to be `filter: url(#line-glow)` on the stroke
                    itself, which had a catastrophic edge case: a filter region
                    is measured from the element's BOUNDING BOX, and a perfectly
                    horizontal (or vertical) line has a box of zero height. The
                    filter then had nothing to render into and the whole stroke
                    disappeared — so linking two cards sitting side by side drew
                    an arrowhead attached to nothing. A second path can't have
                    that problem. */}
                {lit && (
                  <path
                    d={built.d}
                    fill="none"
                    stroke="var(--accent)"
                    strokeOpacity={isSelected ? 0.22 : 0.14}
                    strokeWidth={weight + (isSelected ? 7 : 5)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* The shadow the line casts on the paper */}
                <path
                  d={built.d}
                  fill="none"
                  stroke="#000"
                  strokeOpacity={0.13}
                  strokeWidth={weight + 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dashes}
                />

                {/* The line itself.
                    NOT a `pathLength` draw-on animation. Framer implements that
                    by stamping `pathLength="1"` plus a normalised dash pattern
                    onto the element, and it only re-measures the path when it
                    animates — so the first time a re-render changed `d` (a
                    restyle, a card moved) the stale pattern left the stroke
                    unpainted: arrowhead on screen, line gone. A connector's
                    geometry changes constantly, so it fades in instead. */}
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  d={built.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={weight}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dashes}
                  className={cfg.flow ? 'conn-flow' : undefined}
                  style={{
                    transition: 'stroke 0.25s, stroke-width 0.2s',
                    ['--conn-cycle' as string]: `${dashCycle(cfg)}px`,
                  }}
                />

                {/* Ends. Drawn as real geometry rather than SVG markers: a
                    marker's refX is a guess about the stroke it's attached to,
                    and every wrong guess shows up as a gap at the card edge or
                    a line poking through its own arrowhead. */}
                {[startCap, endCap].map((cap, i) =>
                  !cap ? null : cap.kind === 'dot' ? (
                    <circle key={i} cx={cap.cx} cy={cap.cy} r={cap.r} fill={stroke} />
                  ) : cap.kind === 'fill' ? (
                    <path key={i} d={cap.d} fill={stroke} stroke="none" />
                  ) : (
                    <path
                      key={i}
                      d={cap.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={weight}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ),
                )}

                {/* Where the two ends actually attach — shown only while the
                    connector is selected, as confirmation that it's fastened. */}
                {isSelected && (
                  <>
                    {[built.tipStart, built.tipEnd].map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={3.4}
                        fill="var(--bg-primary)"
                        stroke="var(--accent)"
                        strokeWidth={1.8}
                      />
                    ))}
                  </>
                )}

                {/* A label rides the middle of the line, on a plate punched out
                    of it so the ink doesn't run through the words. */}
                {cfg.label && (
                  <g transform={`translate(${built.mid.x} ${built.mid.y})`} style={{ pointerEvents: 'none' }}>
                    <rect
                      x={-labelW / 2}
                      y={-9}
                      width={labelW}
                      height={18}
                      rx={9}
                      fill="var(--bg-primary)"
                      stroke={stroke}
                      strokeOpacity={0.35}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="var(--text-secondary)"
                      style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.01em' }}
                    >
                      {cfg.label}
                    </text>
                  </g>
                )}

                {/* Cut it. On hover only — once selected, the panel at the top
                    of the screen owns the destructive action. */}
                {isHovered && !isSelected && (
                  <foreignObject
                    /* Beside the label rather than above it. Above put the button
                       under whatever card the line passes behind — this layer
                       draws BENEATH the blocks, so it simply vanished. */
                    x={built.mid.x - 15 + (cfg.label ? labelW / 2 + 18 : 0)}
                    y={built.mid.y - 15}
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
                      title="Remove this link — click the line to restyle it"
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
