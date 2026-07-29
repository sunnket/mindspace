'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { useCollabStore } from '@/store/collabStore';

/**
 * "Back to your work" — the way out of the void.
 *
 * An infinite canvas is infinite in every direction, and nothing about empty
 * space tells you which way is home. Scroll far enough (or nudge the trackpad
 * once at 20% zoom) and the board is simply gone: no landmark, no edge, no clue
 * whether your notes are one screen away or forty. The only recovery was the
 * minimap's fit button, which you have to already know about.
 *
 * So: the moment not one block is left on screen, a chip appears with an arrow
 * pointing at where everything actually is. Click it and the camera flies back
 * the same way a checkpoint does — a glide, not a teleport, so you keep your
 * bearings and can see how far you'd drifted.
 *
 * Deliberately quiet about it:
 *  · it waits ~400ms before appearing, so panning THROUGH a gap never flashes;
 *  · it never zooms you IN — it keeps your zoom unless the board can't fit at
 *    it, in which case it pulls back just enough to show everything;
 *  · it's an opaque chip with its own arrow, legible on any canvas background,
 *    light or dark, plain or photographic.
 */

/** How long the viewport must be empty before we offer the way back. */
const APPEAR_AFTER_MS = 400;
/** Padding (screen px) treated as still "on screen", so a block clipped at the
 *  very edge doesn't count as lost. */
const EDGE_SLACK = 24;

export default function ReturnToWork() {
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const constellationOpen = useCanvasStore((s) => s.constellationOpen);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const collabStatus = useCollabStore((s) => s.status);

  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const sync = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  // Only this canvas level — a binder's sub-space must not point at its parent.
  const activeParent = resolveParentId(canvasStack, urlCanvasId);
  const visible = useMemo(
    () => objects.filter((o) => o.parentId === activeParent && !o.style?.isMinimized),
    [objects, activeParent],
  );

  /** Where everything is, and whether any of it is currently on screen. */
  const cluster = useMemo(() => {
    if (visible.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Weighted centroid: on a board with one far-flung stray note, the middle
    // of the bounding box is empty space. The centre of MASS is where the work
    // is, so that's what the arrow points at and what we fly to.
    let cx = 0, cy = 0, mass = 0;
    let onScreen = false;

    const viewL = -camera.x / camera.zoom - EDGE_SLACK / camera.zoom;
    const viewT = -camera.y / camera.zoom - EDGE_SLACK / camera.zoom;
    const viewR = viewL + (vp.w + EDGE_SLACK * 2) / camera.zoom;
    const viewB = viewT + (vp.h + EDGE_SLACK * 2) / camera.zoom;

    for (const o of visible) {
      const r = o.x + o.width;
      const b = o.y + o.height;
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;

      const w = Math.max(1, o.width * o.height);
      cx += (o.x + o.width / 2) * w;
      cy += (o.y + o.height / 2) * w;
      mass += w;

      if (!onScreen && o.x < viewR && r > viewL && o.y < viewB && b > viewT) onScreen = true;
    }

    return {
      minX, minY, maxX, maxY,
      cx: cx / mass,
      cy: cy / mass,
      onScreen,
    };
  }, [visible, camera, vp]);

  const lost = !!cluster && !cluster.onScreen && !constellationOpen && !isTouring;

  /* Debounced so a pan that crosses open space doesn't strobe the chip.
     `show` is DERIVED from `lost` rather than mirrored into state, so getting
     back to your blocks hides it on the very same frame — an offer to go home
     that lingers after you're home is just noise. The timer only ever arms it;
     the cleanup disarms so the next trip into the void waits its turn too. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!lost) return;
    const t = setTimeout(() => setArmed(true), APPEAR_AFTER_MS);
    return () => { clearTimeout(t); setArmed(false); };
  }, [lost]);
  const show = lost && armed;

  if (!cluster) return null;

  // Screen-space bearing from the middle of the view to the middle of the work.
  const viewCx = (-camera.x + vp.w / 2) / camera.zoom;
  const viewCy = (-camera.y + vp.h / 2) / camera.zoom;
  const dx = cluster.cx - viewCx;
  const dy = cluster.cy - viewCy;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Distance in screenfuls — "4 screens away" is a far more useful unit here
  // than pixels, which mean nothing at an arbitrary zoom.
  const screens = Math.hypot(dx * camera.zoom, dy * camera.zoom) / Math.max(vp.w, vp.h);
  const away = screens < 1.2 ? 'just off screen' : `${Math.round(screens)} screens away`;

  const flyBack = () => {
    const pad = 140;
    const w = cluster.maxX - cluster.minX + pad * 2;
    const h = cluster.maxY - cluster.minY + pad * 2;
    const fit = Math.min(vp.w / Math.max(1, w), vp.h / Math.max(1, h));
    /* Never zoom IN on the way back: you chose your zoom, and being lost isn't
       a reason to overrule it. Only pull back — and only as far as it takes for
       the whole board to fit. */
    const zoom = Math.max(0.1, Math.min(camera.zoom, fit));

    // Frame the bounding box's centre (not the centroid) so nothing is left
    // hanging off an edge once we arrive.
    const targetX = (cluster.minX + cluster.maxX) / 2;
    const targetY = (cluster.minY + cluster.maxY) / 2;

    useCanvasStore.getState().animateCamera(
      {
        x: vp.w / 2 - targetX * zoom,
        y: vp.h / 2 - targetY * zoom,
        zoom,
      },
      620,
    );
  };

  // Stack under whatever top-centre chrome a live session puts up.
  const top = collabStatus === 'connected' || collabStatus === 'connecting' ? 116 : 18;

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="return-to-work"
          onClick={flyBack}
          initial={{ opacity: 0, y: -12, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.94 }}
          transition={{ type: 'spring', damping: 24, stiffness: 300 }}
          className="fixed left-1/2 -translate-x-1/2 z-[145] flex items-center gap-2.5 rounded-full clay-card cursor-pointer pointer-events-auto group flow-hideable"
          style={{ top, padding: '7px 15px 7px 9px' }}
          title="Bring the camera back to your blocks"
        >
          {/* A compass, not a decoration: it turns to face wherever the work
              actually is, so you also learn which way you drifted. */}
          <span
            className="flex items-center justify-center rounded-full shrink-0"
            style={{ width: 24, height: 24, background: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            <motion.svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              animate={{ rotate: angle }}
              transition={{ type: 'spring', damping: 20, stiffness: 200 }}
            >
              <line x1="4" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </motion.svg>
          </span>

          <span className="flex flex-col items-start leading-none" style={{ gap: 2 }}>
            <span className="text-[11.5px] font-extrabold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
              Back to your work
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {visible.length} block{visible.length === 1 ? '' : 's'} · {away}
            </span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
