'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasObjectData } from '@/lib/db';
import {
  readTextPath, pathD, samplePath, layoutGlyphs, cssFont, shade,
  getPathAnim, type TextPathConfig, type PathPoint,
} from '@/lib/textPath';

/**
 * Text written along a curve.
 *
 * Every letter is placed by hand (see lib/textPath.ts for why we don't use
 * `<textPath>`): its own point on the curve, its own heading, its own
 * animation delay. Three things fall out of that and none of them are free
 * otherwise —
 *
 *   above / on / below   is a shift along the letter's own normal, so it stays
 *                        "away from the line" all the way round a circle;
 *   the solid            is one `<use>` of the whole run per depth step, offset
 *                        in SCREEN space, so the light comes from one direction
 *                        instead of rotating with each letter;
 *   the animation        is per letter, because each letter is its own element.
 *
 * The block is a normal `text` object with `style.textPath` set. It drags,
 * resizes, deletes and syncs like anything else on the board.
 */

const PLACEHOLDER = 'Write on the path…';

export default function TextPathBlock({
  obj, isSelected, isEditing,
}: {
  obj: CanvasObjectData;
  isSelected: boolean;
  isEditing: boolean;
}) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const zoom = useCanvasStore((s) => s.camera.zoom);
  const readOnly = useCanvasStore((s) => s.readOnly);

  const cfg = useMemo(() => readTextPath(obj.style?.textPath), [obj.style?.textPath]);

  /* Fonts load after first paint, and every glyph's advance was measured
     against whatever was available at the time. One re-layout when the webfont
     lands is the difference between "the curve is right" and "the letters are
     bunched up in the middle for the first second". */
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let alive = true;
    fonts.ready.then(() => { if (alive) setFontTick((t) => t + 1); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* The travelling presets move the whole run along the curve. A rAF that only
     runs while the preset is on — a loop nobody can see is a battery bill. */
  const anim = getPathAnim(cfg?.anim?.preset);
  const travels = anim?.kind === 'travel';
  const [travelRaw, setTravel] = useState(0);
  // Read through the flag rather than resetting the state when the preset goes
  // away: a stale 43% is harmless as long as nothing is reading it.
  const travel = travels ? travelRaw : 0;
  const rafRef = useRef(0);
  useEffect(() => {
    if (!travels) return;
    const lapsPerMin = (anim?.speed || 6) * (cfg?.anim?.speed || 1);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTravel((v) => (v + (lapsPerMin / 60) * 100 * dt + 100) % 100);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [travels, anim?.speed, cfg?.anim?.speed]);

  const style = obj.style || {};
  const fontSize = (style.fontSize as number) || 28;
  const fontFamily = (style.fontFamily as string) || "'Inter', sans-serif";
  const fontWeight = (style.fontWeight as number) || 600;
  const ink = (style.textColor as string) || '#F4EFE8';
  const text = (obj.content || '').replace(/\n/g, ' ');
  const isPlaceholder = !text.trim();
  const shown = isPlaceholder ? PLACEHOLDER : text;

  const live: TextPathConfig | null = useMemo(() => {
    if (!cfg) return null;
    return travels ? { ...cfg, startOffset: cfg.startOffset + travel } : cfg;
  }, [cfg, travels, travel]);

  const geom = useMemo(() => {
    if (!live) return null;
    const sample = samplePath(live, obj.width, obj.height);
    const font = cssFont(fontSize, fontWeight, fontFamily);
    const run = layoutGlyphs(shown, live, sample, fontSize, font);
    return { sample, run, d: pathD(live, obj.width, obj.height) };
    // fontTick is a deliberate dependency: it means "re-measure, the face changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, obj.width, obj.height, shown, fontSize, fontWeight, fontFamily, fontTick]);

  if (!cfg || !live || !geom) return null;

  const { run, d } = geom;
  const three = live.three;
  const depth = Math.max(0, Math.min(24, three?.depth ?? 0));
  const rad = ((three?.angle ?? 135) * Math.PI) / 180;
  const stepX = Math.cos(rad);
  const stepY = Math.sin(rad);
  const sideColor = three?.color || shade(ink, 0.45);

  const faceId = `tpf-${obj.id}`;
  const shineId = `tps-${obj.id}`;

  const cssAnim = anim?.kind === 'css' ? anim : undefined;
  const speed = cfg.anim?.speed || 1;

  /* The curve itself. Hidden by default — the point is the text — but always
     drawn while the block is selected, because you cannot drag a handle on a
     line you can't see. */
  const guideOn = live.guide !== 'off';
  const guideColor = live.guideColor || 'var(--accent)';
  const guideW = live.guideWidth ?? 1.5;
  const dash =
    live.guide === 'dashed' ? `${guideW * 5} ${guideW * 4}`
    : live.guide === 'dotted' ? `${guideW * 0.1} ${guideW * 3}`
    : undefined;

  const glyphNodes = (
    <g>
      {run.glyphs.map((g, n) => {
        const delay = cssAnim ? (g.i * (cssAnim.stagger || 50)) / speed : 0;
        const dur = cssAnim ? (cssAnim.dur || 900) / speed : 0;
        return (
          <g key={`${g.i}-${n}`} transform={`translate(${g.x} ${g.y}) rotate(${g.deg})`}>
            {/* The animated frame is a NESTED group on purpose: a CSS transform
                would replace the transform attribute above, not compose with
                it, and every letter would collapse onto the origin. */}
            <g
              className={cssAnim ? `tp-glyph tp-a-${cssAnim.id}` : undefined}
              style={cssAnim ? { animationDelay: `${delay}ms`, animationDuration: `${dur}ms` } : undefined}
            >
              <text
                x={0}
                y={run.dy}
                textAnchor="middle"
                style={{
                  fontFamily,
                  fontSize,
                  fontWeight,
                  whiteSpace: 'pre',
                  userSelect: 'none',
                }}
              >
                {g.ch}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );

  const tilt = three && (three.tiltX || three.tiltY)
    ? {
        transform: `perspective(${three.perspective || 900}px) rotateX(${three.tiltX}deg) rotateY(${three.tiltY}deg)`,
        transformOrigin: '50% 50%',
      }
    : undefined;

  return (
    <div className="w-full h-full relative" style={{ pointerEvents: 'none' }}>
      <svg
        width={obj.width}
        height={obj.height}
        viewBox={`0 0 ${obj.width} ${obj.height}`}
        style={{ overflow: 'visible', display: 'block', ...tilt }}
      >
        {three?.shine && (
          <defs>
            <linearGradient id={shineId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="46%" stopColor={ink} />
              <stop offset="54%" stopColor={shade(ink, 0.18)} />
              <stop offset="100%" stopColor={ink} />
            </linearGradient>
          </defs>
        )}

        {(guideOn || isSelected) && (
          <path
            d={d}
            fill="none"
            stroke={guideOn ? guideColor : 'var(--accent)'}
            strokeWidth={guideOn ? guideW : Math.max(0.6, 1.2 / zoom)}
            strokeDasharray={guideOn ? dash : `${6 / zoom} ${5 / zoom}`}
            strokeOpacity={guideOn ? 1 : 0.55}
            strokeLinecap="round"
          />
        )}

        {/* The solid, back to front. Each layer is one <use> of the whole run
            rather than a second copy of every letter, so depth costs 24 nodes
            instead of 24 × the character count. The referenced group carries NO
            fill of its own — that's what lets each clone paint itself. */}
        {depth > 0 && Array.from({ length: depth }, (_, i) => depth - i).map((i) => (
          <use
            key={i}
            href={`#${faceId}`}
            x={stepX * i}
            y={stepY * i}
            fill={sideColor}
            opacity={0.55 + 0.45 * (1 - i / depth)}
          />
        ))}

        {/* …and the face, which is the real, rendered run — the clones above
            point at it. Its colour lives on the wrapper for that reason. */}
        <g fill={three?.shine ? `url(#${shineId})` : ink} opacity={isPlaceholder ? 0.34 : 1}>
          <g id={faceId}>{glyphNodes}</g>
        </g>
      </svg>

      {/* Control points. Live only while the block is selected and not being
          typed into; sized in screen px so they stay grabbable at any zoom. */}
      {isSelected && !isEditing && !readOnly && (
        <PathHandles obj={obj} cfg={cfg} zoom={zoom} onChange={(next) => {
          updateObject(obj.id, { style: { ...(obj.style || {}), textPath: next } });
        }} />
      )}

      {/* Typing. The words go into a real input rather than onto the curve —
          a caret cannot follow a spiral — and the curve updates as you type. */}
      {isEditing && !readOnly && (
        <div
          className="absolute left-1/2 z-[120]"
          style={{ top: '100%', marginTop: 12, transform: 'translateX(-50%)', width: Math.max(240, obj.width * 0.85) }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="glass-panel flex items-center gap-2" style={{ padding: '7px 9px', pointerEvents: 'auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-[var(--accent)]">
              <path d="M3 16c4-11 14-11 18 0" />
              <path d="M8 12h.01M12 10h.01M16 12h.01" />
            </svg>
            <input
              autoFocus
              value={obj.content || ''}
              onChange={(e) => updateObject(obj.id, { content: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                  setEditingId(null);
                }
              }}
              placeholder="Type — it lands on the curve"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- handles -- */

function PathHandles({
  obj, cfg, zoom, onChange,
}: {
  obj: CanvasObjectData;
  cfg: TextPathConfig;
  zoom: number;
  onChange: (next: TextPathConfig) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const r = Math.max(3.5, 6 / zoom);

  /** Drag point `index` of `base`, live, until the button comes up. */
  const drag = (base: PathPoint[], index: number, e: React.MouseEvent) => {
    setDragging(index);
    const originX = e.clientX;
    const originY = e.clientY;
    const from = base[index];

    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - originX) / zoom / (obj.width || 1);
      const dy = (ev.clientY - originY) / zoom / (obj.height || 1);
      const points = base.map((p, i) =>
        i === index
          // Let a handle go a little outside the box — an SVG that overflows is
          // fine, and clamping hard makes the curve feel stuck to the walls.
          ? { x: Math.max(-0.4, Math.min(1.4, from.x + dx)), y: Math.max(-0.4, Math.min(1.4, from.y + dy)) }
          : p,
      );
      onChange({ ...cfg, points, shape: '' });
    };
    const up = () => {
      setDragging(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const start = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag(cfg.points, index, e);
  };

  /* Alt-click removes a point (never below two — a path needs somewhere to go
     and somewhere to come from). */
  const remove = (index: number) => (e: React.MouseEvent) => {
    if (!e.altKey || cfg.points.length <= 2) return;
    e.stopPropagation();
    e.preventDefault();
    onChange({ ...cfg, points: cfg.points.filter((_, i) => i !== index), shape: '' });
  };

  /* The small dot between two handles adds a point there. Pressing it does the
     insert AND picks the new point up in the same gesture — reaching for the
     gap between two anchors and pulling means "bend it here", and making that
     a click-then-drag would be two gestures for one intention. */
  const insert = (after: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const a = cfg.points[after];
    const b = cfg.points[(after + 1) % cfg.points.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const points = [...cfg.points.slice(0, after + 1), mid, ...cfg.points.slice(after + 1)];
    onChange({ ...cfg, points, shape: '' });
    drag(points, after + 1, e);
  };

  /* The add-a-point targets are only offered while there's room to read them.
     A twelve-point circle with twelve more dots between them is a bead
     necklace, not a control — and on a preset that dense you want to drag the
     ring, not subdivide it. */
  const midCount = cfg.points.length > 10 ? 0 : cfg.closed ? cfg.points.length : cfg.points.length - 1;

  return (
    <svg
      width={obj.width}
      height={obj.height}
      viewBox={`0 0 ${obj.width} ${obj.height}`}
      className="absolute inset-0"
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      {/* Insert targets sit UNDER the handles so a point never hides behind one. */}
      {Array.from({ length: midCount }, (_, i) => {
        const a = cfg.points[i];
        const b = cfg.points[(i + 1) % cfg.points.length];
        const x = ((a.x + b.x) / 2) * obj.width;
        const y = ((a.y + b.y) / 2) * obj.height;
        return (
          <circle
            key={`m${i}`}
            cx={x}
            cy={y}
            r={r * 0.72}
            fill="var(--accent)"
            fillOpacity={0.28}
            stroke="var(--accent)"
            strokeWidth={1 / zoom}
            style={{ pointerEvents: 'auto', cursor: 'copy' }}
            onMouseDown={insert(i)}
          >
            <title>Drag to add a point and bend the path here</title>
          </circle>
        );
      })}

      {cfg.points.map((p, i) => (
        <circle
          key={i}
          cx={p.x * obj.width}
          cy={p.y * obj.height}
          r={dragging === i ? r * 1.35 : r}
          fill="#ffffff"
          stroke="var(--accent)"
          strokeWidth={2 / zoom}
          style={{ pointerEvents: 'auto', cursor: 'grab', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
          onMouseDown={(e) => { remove(i)(e); if (!e.altKey) start(i)(e); }}
        >
          <title>Drag to bend the path — Alt-click to remove</title>
        </circle>
      ))}
    </svg>
  );
}
