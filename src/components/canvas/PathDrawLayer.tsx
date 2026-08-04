'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas } from '@/lib/utils';
import {
  defaultTextPath, splineD, polylineD, fitBox, normalizePoints, simplify,
  type PathPoint,
} from '@/lib/textPath';

/**
 * Drawing the line the words will sit on.
 *
 * Live only in `textpath` mode. Two gestures, both of which people try
 * unprompted, so both work:
 *
 *   click, click, click…   drop anchors; the curve is drawn through them
 *   press and drag         freehand, thinned down to a handful of anchors on
 *                          release (see `simplify`)
 *
 * Double-click, Enter or a click back on the first anchor finishes it; Escape
 * throws it away. Finishing builds an ordinary text block whose `style.textPath`
 * holds the curve, and drops the caret into it — you draw, then you write.
 */

const CLOSE_RADIUS = 14;      // screen px within which a click closes the loop
const DRAG_THRESHOLD = 5;     // beyond this, a press is a freehand stroke

export default function PathDrawLayer() {
  const camera = useCanvasStore((s) => s.camera);
  const setMode = useCanvasStore((s) => s.setMode);
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);

  const [points, setPointsState] = useState<PathPoint[]>([]);
  const [cursor, setCursor] = useState<PathPoint | null>(null);
  const [freehand, setFreehand] = useState(false);

  /* The anchors live in a ref as well as in state. Mouse handlers have to read
     the CURRENT list to decide whether a click closed the loop or added to it,
     and a state updater is the wrong place to decide that — it must stay pure,
     and it can run twice. */
  const pointsRef = useRef<PathPoint[]>([]);
  const setPoints = useCallback((next: PathPoint[]) => {
    pointsRef.current = next;
    setPointsState(next);
  }, []);

  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const reset = useCallback(() => {
    setPoints([]);
    setCursor(null);
    setFreehand(false);
    pressRef.current = null;
  }, [setPoints]);

  /** Turn what's on screen into a block, and put the caret in it. */
  const commit = useCallback((raw: PathPoint[], closed: boolean) => {
    if (raw.length < 2) { reset(); return; }

    const ts = useCanvasStore.getState().textStyle;
    /* Size the type to the LINE, not to the body-text default. Inheriting 14px
       gives you a beautiful two-hundred-pixel curve with a whisper of text
       parked in the middle of it — technically correct and useless. A rough
       "about fifteen characters across this curve" reads well at every scale
       people actually draw at, and the size control is right there afterwards. */
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    const fontSize = Math.round(Math.max(24, Math.min(96, len / 15)));
    const box = fitBox(raw, fontSize * 1.7);

    const obj = addObject({
      type: 'text',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      content: '',
      style: {
        fontFamily: ts.fontFamily,
        fontWeight: Math.max(600, ts.fontWeight || 600),
        textColor: ts.textColor,
        fontSize,
        // The box IS the curve's coordinate space, so it must never be
        // re-measured from the text the way a normal block's is.
        isResized: true,
        textPath: defaultTextPath({
          points: normalizePoints(raw, box),
          closed,
          shape: '',
          align: 'above',
        }),
      },
    });

    reset();
    setMode('select');
    setSelectedId(obj.id);
    setEditingId(obj.id);
  }, [addObject, reset, setMode, setSelectedId, setEditingId]);

  /* Keyboard: finish, or throw it away. Bound at the window so it works
     wherever the pointer happens to be. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (points.length) reset(); else setMode('select');
      } else if (e.key === 'Enter' && points.length >= 2) {
        e.preventDefault();
        commit(points, false);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && points.length) {
        e.preventDefault();
        setPoints(points.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [points, commit, reset, setMode, setPoints]);

  const world = (e: React.MouseEvent) =>
    screenToCanvas(e.clientX, e.clientY, useCanvasStore.getState().camera);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = world(e);
    setCursor(p);

    const press = pressRef.current;
    if (!press) return;

    if (!press.moved) {
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD;
      if (!far) return;
      press.moved = true;
      setFreehand(true);
      // The press itself is the stroke's first sample.
      const startWorld = screenToCanvas(press.x, press.y, useCanvasStore.getState().camera);
      if (!pointsRef.current.length) setPoints([startWorld]);
    }
    const prev = pointsRef.current;
    const last = prev[prev.length - 1];
    // One sample every ~2 world px keeps the stroke honest without storing a
    // point per mousemove event.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
    setPoints([...prev, p]);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;

    if (press.moved) {
      // Freehand: thin it and finish immediately — a drawn stroke is a
      // complete gesture, and asking for a second confirmation reads as a bug.
      setFreehand(false);
      const thinned = simplify(pointsRef.current, 4 / camera.zoom);
      if (thinned.length >= 2) commit(thinned, false);
      else reset();
      return;
    }

    // A tap: drop an anchor, or close the loop on the first one.
    const p = world(e);
    const prev = pointsRef.current;
    if (prev.length >= 3) {
      const first = prev[0];
      const dist = Math.hypot((p.x - first.x) * camera.zoom, (p.y - first.y) * camera.zoom);
      if (dist < CLOSE_RADIUS) { commit(prev, true); return; }
    }
    /* The first half of a double-click is an ordinary click, so finishing the
       line would otherwise stack a second anchor on top of the last one. */
    const last = prev[prev.length - 1];
    if (last && Math.hypot((p.x - last.x) * camera.zoom, (p.y - last.y) * camera.zoom) < 4) return;
    setPoints([...prev, p]);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (points.length >= 2) commit(points, false);
  };

  const preview = cursor && !freehand && points.length ? [...points, cursor] : points;
  const d = freehand
    ? polylineD(preview, false)
    : preview.length > 2 ? splineD(preview, false) : polylineD(preview, false);

  const handleR = Math.max(2.5, 5 / camera.zoom);

  return (
    <>
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 1200, cursor: 'crosshair', pointerEvents: 'auto' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); reset(); }}
      >
        <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.zoom})`}>
          {d && (
            <>
              {/* A wide, faint under-stroke so the line reads on any paper. */}
              <path d={d} fill="none" stroke="var(--accent)" strokeOpacity={0.2} strokeWidth={7 / camera.zoom} strokeLinecap="round" />
              <path
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2 / camera.zoom}
                strokeLinecap="round"
                strokeDasharray={freehand ? undefined : `${7 / camera.zoom} ${5 / camera.zoom}`}
              />
            </>
          )}

          {!freehand && points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === 0 && points.length >= 3 ? handleR * 1.5 : handleR}
              fill={i === 0 && points.length >= 3 ? 'var(--accent)' : '#ffffff'}
              stroke="var(--accent)"
              strokeWidth={2 / camera.zoom}
            />
          ))}
        </g>
      </svg>

      {/* What to do, where you're doing it. */}
      <AnimatePresence>
        <motion.div
          key="tp-hint"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed left-1/2 -translate-x-1/2 z-[1201] pointer-events-none"
          style={{ bottom: 108 }}
        >
          <div
            className="glass-panel flex items-center gap-2.5 whitespace-nowrap"
            style={{ padding: '8px 14px', fontFamily: "'Outfit', sans-serif" }}
          >
            <span className="flex items-center justify-center rounded-full" style={{ width: 20, height: 20, background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M3 17c5-12 13-12 18 0" />
              </svg>
            </span>
            <span className="text-[11.5px] font-bold text-[var(--text-primary)]">
              {points.length === 0
                ? 'Draw the line your words will sit on'
                : freehand
                  ? 'Let go to finish'
                  : `${points.length} point${points.length === 1 ? '' : 's'} — double-click to finish`}
            </span>
            <span className="text-[10.5px] font-semibold text-[var(--text-tertiary)]">
              {points.length === 0 ? 'Click to place points, or drag to draw freehand' : 'Enter finishes · Esc clears · click the first dot to close it'}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
