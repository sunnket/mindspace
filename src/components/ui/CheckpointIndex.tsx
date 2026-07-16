'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';

/** Short human label for an object type, shown as a result badge. */
function typeLabel(o: CanvasObjectData): string {
  if (o.style?.isCheckpoint) return 'Checkpoint';
  if (o.style?.isBinder) return 'Binder';
  switch (o.type) {
    case 'heading': return 'Heading';
    case 'sticky': return 'Note';
    case 'card': return 'Card';
    case 'shape': return 'Shape';
    case 'frame': return 'Frame';
    case 'mirror': return 'Mirror';
    case 'workflow-node': return 'Node';
    default: return 'Text';
  }
}

/**
 * Search-this-canvas — a small finder that lives inside the checkpoint gauge's
 * hover panel. Type any words and it matches the text of every object on the
 * CURRENT canvas; clicking a result flies the camera there and selects it. It's
 * deliberately tucked under the checkpoint list (and only revealed on hover) so
 * it never reads as a "search for checkpoints" box.
 */
function CanvasSearch() {
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return objects
      .filter((o) => {
        if (o.style?.isMinimized) return false;
        const c = (o.content || '').trim();
        // Skip empty blocks, data-URL payloads (images/files), and JSON blob
        // content (todo/poll/table cards store their data there — not prose).
        if (!c || c.startsWith('data:') || c.startsWith('[') || c.startsWith('{')) return false;
        return c.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [q, objects]);

  const goTo = (o: CanvasObjectData) => {
    const targetZoom = Math.max(camera.zoom, 0.85);
    const camX = window.innerWidth / 2 - (o.x + o.width / 2) * targetZoom;
    const camY = window.innerHeight / 2 - (o.y + o.height / 2) * targetZoom;
    animateCamera({ x: camX, y: camY, zoom: targetZoom }, 1200);
    setSelectedId(o.id);
  };

  const snippet = (o: CanvasObjectData) => {
    const c = (o.content || '').replace(/\s+/g, ' ').trim();
    return c.length > 46 ? c.slice(0, 46) + '…' : c;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] font-bold font-mono flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search this canvas
      </div>

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Enter' && results[0]) goTo(results[0]);
          }}
          placeholder="Find text on this board…"
          style={{ padding: '7px 12px 7px 30px' }}
          className="w-full rounded-full border border-[var(--border)] bg-black/5 dark:bg-black/25 text-[12px] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/35 text-[var(--text-primary)] placeholder-[var(--text-muted)]"
        />
      </div>

      {q.trim() && (
        results.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-0.5">
            {results.map((o) => (
              <button
                key={o.id}
                onClick={() => goTo(o)}
                style={{ padding: '7px 10px' }}
                className="group/result flex items-center gap-2 rounded-lg text-left hover:bg-[var(--accent)]/10 transition-colors cursor-pointer"
              >
                <span className="shrink-0 text-[8px] uppercase tracking-wider font-bold text-[var(--text-tertiary)] group-hover/result:text-[var(--accent)]" style={{ minWidth: 46 }}>
                  {typeLabel(o)}
                </span>
                <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover/result:text-[var(--text-primary)] truncate">
                  {snippet(o)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--text-muted)] italic" style={{ padding: '4px 2px' }}>
            No matches on this canvas
          </div>
        )
      )}
    </div>
  );
}

export default function CheckpointIndex() {
  const objects = useCanvasStore((state) => state.objects);
  const camera = useCanvasStore((state) => state.camera);
  const [isHovered, setIsHovered] = useState(false);
  // Bridges the gap between the gauge and its left-side panel: leaving one
  // schedules a close that entering the other cancels, so moving across the gap
  // (to reach the search box) never dismisses the panel mid-motion.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openHover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setIsHovered(true); };
  const closeHover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setIsHovered(false), 200);
  };

  // Filter for checkpoint objects
  const checkpoints = useMemo(() => {
    return objects.filter((o) => o.style?.isCheckpoint);
  }, [objects]);

  // Calculate the active checkpoint (closest to the viewport center in world coordinates)
  const activeCheckpointId = useMemo(() => {
    if (checkpoints.length === 0) return null;

    // Viewport center in world space
    const viewportCenter = {
      x: (window.innerWidth / 2 - camera.x) / camera.zoom,
      y: (window.innerHeight / 2 - camera.y) / camera.zoom,
    };

    let minDistance = Infinity;
    let closestId = null;

    checkpoints.forEach((c) => {
      const cx = c.x + (c.width || 0) / 2;
      const cy = c.y + (c.height || 0) / 2;
      const dx = cx - viewportCenter.x;
      const dy = cy - viewportCenter.y;
      const dist = dx * dx + dy * dy;

      if (dist < minDistance) {
        minDistance = dist;
        closestId = c.id;
      }
    });

    return closestId;
  }, [checkpoints, camera]);

  const handleGoToCheckpoint = (obj: CanvasObjectData) => {
    if (!obj) return;
    const targetZoom = Math.max(camera.zoom, 0.8);
    const camX = window.innerWidth / 2 - (obj.x + obj.width / 2) * targetZoom;
    const camY = window.innerHeight / 2 - (obj.y + obj.height / 2) * targetZoom;

    // Cinematic camera transition
    useCanvasStore.getState().animateCamera({ x: camX, y: camY, zoom: targetZoom }, 1400);
  };

  // No checkpoints yet — show a muted gauge, but STILL offer canvas search on hover.
  if (checkpoints.length === 0) {
    return (
      <div
        className="fixed right-6 top-1/2 -translate-y-1/2 z-50 pointer-events-auto flex items-center select-none"
        onMouseEnter={openHover}
        onMouseLeave={closeHover}
      >
        <AnimatePresence>
          {isHovered && (
            <motion.div
              className="absolute right-10 mr-2 bg-[rgba(255,252,248,0.4)] dark:bg-black/35 backdrop-blur-3xl rounded-2xl border border-white/20 dark:border-white/5 shadow-2xl flex flex-col gap-3 w-[280px]"
              style={{ padding: 18 }}
              initial={{ opacity: 0, x: 15, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 15, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              onMouseEnter={openHover}
              onMouseLeave={closeHover}
            >
              <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)] font-bold font-mono">
                No checkpoints placed
              </span>
              <div className="h-px w-full bg-black/[0.06] dark:bg-white/[0.06]" />
              <CanvasSearch />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col items-end gap-1.5">
          {/* Muted gauge ticks */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-[2px] bg-[var(--text-muted)] opacity-40 transition-all duration-300"
              style={{ width: i === 2 ? '20px' : '12px' }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed right-6 top-1/2 -translate-y-1/2 z-50 pointer-events-auto flex items-center select-none"
      onMouseEnter={openHover}
      onMouseLeave={closeHover}
    >
      {/* ─── HOVER REVEAL PANEL: checkpoints list + canvas search ───────────── */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute right-10 mr-2 bg-[rgba(255,252,248,0.4)] dark:bg-black/35 backdrop-blur-3xl rounded-2xl border border-white/20 dark:border-white/5 shadow-2xl flex flex-col gap-2.5 w-[300px]"
            style={{ padding: 20 }}
            initial={{ opacity: 0, x: 15, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 15, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            onMouseEnter={openHover}
            onMouseLeave={closeHover}
          >
            <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] font-bold border-b border-black/[0.04] dark:border-white/[0.04] pb-1.5 font-mono">
              Checkpoints
            </div>

            {checkpoints.map((checkpoint, index) => {
              const isActive = checkpoint.id === activeCheckpointId;

              return (
                <button
                  key={checkpoint.id}
                  onClick={() => handleGoToCheckpoint(checkpoint)}
                  style={{ padding: '6px 4px' }}
                  className="group flex items-center justify-between text-left w-full transition-all focus:outline-none"
                >
                  <span
                    className={`text-xs font-semibold truncate max-w-[210px] transition-colors ${
                      isActive
                        ? 'text-[var(--accent)] font-bold'
                        : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] font-semibold'
                    }`}
                    style={{ fontFamily: "'Outfit', sans-serif" }}
                  >
                    {checkpoint.content || `Checkpoint 0${index + 1}`}
                  </span>

                  <span className={`text-[9px] font-mono shrink-0 ml-3 transition-opacity ${isActive ? 'text-[var(--accent)] opacity-100 font-bold' : 'text-[var(--text-muted)] opacity-60 group-hover:opacity-100'}`}>
                    0{index + 1}
                  </span>
                </button>
              );
            })}

            <div className="h-px w-full bg-black/[0.06] dark:bg-white/[0.06] mt-0.5" />
            <CanvasSearch />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── MINIMAL HARDWARE GAUGE SCROLL SCALE ───────────────────────────── */}
      <div className="flex flex-col items-end gap-1.5 py-4 pl-4 cursor-pointer">
        {checkpoints.map((checkpoint, index) => {
          const isActive = checkpoint.id === activeCheckpointId;

          return (
            <div key={checkpoint.id} className="flex flex-col items-end">
              {/* Major Tick Line - Restored original orange accent theme */}
              <motion.div
                onClick={() => handleGoToCheckpoint(checkpoint)}
                className={`rounded-full transition-all duration-300 ${
                  isActive
                    ? 'bg-[var(--accent)] shadow-[0_0_12px_rgba(var(--accent-rgb),0.75)]'
                    : 'bg-[var(--text-secondary)] dark:bg-white/40 opacity-70 hover:opacity-100'
                }`}
                animate={{
                  width: isActive ? 30 : 16,
                  height: isActive ? 3.5 : 2.5,
                }}
                whileHover={{ width: 30, height: 3.5 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                title={checkpoint.content || `Checkpoint 0${index + 1}`}
              />

              {/* Minor Tick Lines - Restored 3 ticks per segment with standard spacing */}
              {index < checkpoints.length - 1 && (
                <div className="flex flex-col items-end gap-1 my-1.5 pr-[2px]">
                  <div className="w-8 h-[1.5px] bg-[var(--text-muted)] opacity-35" />
                  <div className="w-11 h-[1.5px] bg-[var(--text-muted)] opacity-50" />
                  <div className="w-8 h-[1.5px] bg-[var(--text-muted)] opacity-35" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
