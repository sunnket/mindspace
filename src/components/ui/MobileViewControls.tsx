'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { useIsPhone } from '@/lib/responsive';

/**
 * Zoom, fit and "write here" — the three things a phone has no other way to do.
 *
 * On a desktop all three are free: the wheel zooms, the minimap has a Fit
 * button, and clicking empty board starts a note. On a phone the wheel does not
 * exist, the minimap is hidden (168px of map is unreadable and it would sit on
 * top of the work), and empty board is scarce — the whole screen is usually
 * covered by the cards you are looking at, and every drag across them now pans
 * instead of creating.
 *
 * So: a rail of exactly three buttons. Pinch still does the zooming for anyone
 * who reaches for it; these are the discoverable version of the same thing, and
 * the percentage between them is the read-out the minimap used to carry.
 *
 * It hides itself whenever a sheet is up (`.mobile-sheet-open`), because a
 * floating control over a modal is just clutter — see mobile.css.
 */
export default function MobileViewControls() {
  const isPhone = useIsPhone();
  const camera = useCanvasStore((s) => s.camera);
  const objects = useCanvasStore((s) => s.objects);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const isTouring = useCanvasStore((s) => s.isTouring);

  if (!isPhone || isTouring) return null;

  const step = (factor: number) => {
    const cam = useCanvasStore.getState().camera;
    const zoom = Math.min(5, Math.max(0.1, cam.zoom * factor));
    // Pivot on the middle of the screen, which is the only anchor a button
    // press has — a pinch gets to use the point between your fingers instead.
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const k = zoom / cam.zoom;
    useCanvasStore.getState().animateCamera({
      zoom,
      x: cx - (cx - cam.x) * k,
      y: cy - (cy - cam.y) * k,
    }, 200);
  };

  /** Everything on this level of the board, framed. Same rule as the minimap. */
  const fit = () => {
    const parent = resolveParentId(canvasStack, urlCanvasId);
    const visible = objects.filter((o) => o.parentId === parent && !o.style?.isMinimized);
    if (visible.length === 0) {
      useCanvasStore.getState().animateCamera({ x: 0, y: 0, zoom: 1 }, 400);
      return;
    }
    const minX = Math.min(...visible.map((o) => o.x));
    const minY = Math.min(...visible.map((o) => o.y));
    const maxX = Math.max(...visible.map((o) => o.x + o.width));
    const maxY = Math.max(...visible.map((o) => o.y + o.height));
    // A phone is narrow: less padding than the desktop's 120, or a wide board
    // fits at a zoom too small to read anything on it.
    const pad = 40;
    const zoom = Math.min(
      window.innerWidth / (maxX - minX + pad * 2),
      window.innerHeight / (maxY - minY + pad * 2),
      1.2,
    );
    useCanvasStore.getState().animateCamera({
      zoom,
      x: window.innerWidth / 2 - (minX + (maxX - minX) / 2) * zoom,
      y: window.innerHeight / 2 - (minY + (maxY - minY) / 2) * zoom,
    }, 620);
  };

  const btn = 'w-10 h-10 flex items-center justify-center text-[var(--text-secondary)] active:text-[var(--accent)] transition-colors';

  return (
    <motion.div
      className="mobile-view-controls clay-card flow-hideable"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.45, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <button onClick={() => step(1.35)} className={btn} aria-label="Zoom in">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M11 8v6M8 11h6M20 20l-4.3-4.3" />
        </svg>
      </button>

      <button
        onClick={fit}
        className="h-8 px-1 flex items-center justify-center text-[10px] font-extrabold tabular-nums text-[var(--text-tertiary)] active:text-[var(--accent)]"
        aria-label="Fit everything on screen"
        title="Fit"
      >
        {Math.round(camera.zoom * 100)}%
      </button>

      <button onClick={() => step(1 / 1.35)} className={btn} aria-label="Zoom out">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4.3-4.3" />
        </svg>
      </button>
    </motion.div>
  );
}
