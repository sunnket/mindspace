'use client';

import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { screenToCanvas } from '@/lib/utils';

function chipVisual(obj: CanvasObjectData) {
  const color =
    (obj.style?.color as string) ||
    (obj.style?.borderColor as string) ||
    (obj.style?.frameColor as string) ||
    'var(--accent)';

  let label = (obj.content || '').split('\n')[0].trim();
  if (!label) {
    label =
      obj.type === 'shape' ? ((obj.style?.shapeType as string) || 'shape') :
      obj.type === 'frame' ? 'frame' :
      obj.type === 'workflow-node' ? 'node' :
      obj.type;
  }
  return { color, label: label.slice(0, 22) };
}

/**
 * Corner shelf: drag any object here to slide it out of the way, drag a
 * chip back onto the canvas (or just click it) to restore it exactly where
 * you drop it. CanvasObject's own drag handler detects the hot zone and
 * calls minimizeObject directly — this component only renders the shelf,
 * the drop-zone highlight target, and the restore-by-dragging interaction.
 */
export default function MinimizeDock() {
  const objects = useCanvasStore((s) => s.objects);
  const restoreMinimized = useCanvasStore((s) => s.restoreMinimized);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [ghostLabel, setGhostLabel] = useState('');
  const [ghostColor, setGhostColor] = useState('#C97B4B');

  const minimized = objects
    .filter((o) => o.style?.isMinimized)
    .sort((a, b) => ((a.style?.minimizedAt as number) || 0) - ((b.style?.minimizedAt as number) || 0));

  const startDrag = (e: React.MouseEvent, obj: CanvasObjectData) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const { color, label } = chipVisual(obj);
    setGhostColor(color);
    setGhostLabel(label);

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.display = 'flex';
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (ghostRef.current) ghostRef.current.style.display = 'none';

      const camera = useCanvasStore.getState().camera;
      const target = moved
        ? screenToCanvas(ev.clientX, ev.clientY, camera)
        : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2, camera);
      restoreMinimized(obj.id, target.x, target.y);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <>
      {/* Floating ghost preview shown only while dragging a chip out */}
      <div
        ref={ghostRef}
        className="fixed pointer-events-none z-[9999] hidden items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white shadow-xl -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
        style={{ background: ghostColor }}
      >
        {ghostLabel}
      </div>

      {/* Drop-target highlights — toggled directly by CanvasObject's drag handler
          via DOM writes (no store subscription) to avoid re-rendering on drag.
          Top zone minimizes; the zone below WARPS to another canvas. */}
      <div
        id="minimize-hotzone"
        className="fixed top-[76px] left-4 w-[196px] h-[152px] z-[100] pointer-events-none rounded-[28px] border-2 border-dashed flex items-center justify-center transition-colors duration-150"
        style={{ borderColor: 'transparent', background: 'transparent' }}
      >
        <div
          id="minimize-hotzone-label"
          className="flex flex-col items-center gap-1.5 text-[var(--accent)] transition-opacity duration-150"
          style={{ opacity: 0 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 9h6v6H9z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wider text-center">Drop to minimize</span>
        </div>
      </div>

      <div
        id="warp-hotzone"
        className="fixed top-[238px] left-4 w-[196px] h-[156px] z-[100] pointer-events-none rounded-[28px] border-2 border-dashed flex items-center justify-center transition-all duration-150"
        style={{ borderColor: 'rgba(201,123,75,0.28)', background: 'transparent', opacity: 0 }}
      >
        <div
          id="warp-hotzone-label"
          className="flex flex-col items-center gap-1.5 text-[var(--accent)] transition-opacity duration-150"
          style={{ opacity: 0.55 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="3.5" ry="9" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wider text-center">Warp to canvas</span>
        </div>
      </div>

      <div
        id="chat-hotzone"
        className="fixed top-[412px] left-4 w-[196px] h-[152px] z-[100] pointer-events-none rounded-[28px] border-2 border-dashed flex items-center justify-center transition-all duration-150"
        style={{ borderColor: 'rgba(201,123,75,0.28)', background: 'transparent', opacity: 0 }}
      >
        <div
          id="chat-hotzone-label"
          className="flex flex-col items-center gap-1.5 text-[var(--accent)] transition-opacity duration-150"
          style={{ opacity: 0.55 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wider text-center">Send to chat</span>
        </div>
      </div>

      {/* The shelf itself */}
      <AnimatePresence>
        {minimized.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="fixed top-24 left-4 z-[110] flex flex-col gap-2 pointer-events-auto"
          >
            <AnimatePresence>
              {minimized.map((obj) => {
                const { color, label } = chipVisual(obj);
                return (
                  <motion.button
                    key={obj.id}
                    layout
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    onMouseDown={(e) => startDrag(e, obj)}
                    onClick={(e) => e.stopPropagation()}
                    title={`${label} — drag onto the canvas to restore, or click to pop it back to center`}
                    className="group flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full cursor-grab active:cursor-grabbing max-w-[170px]"
                    style={{
                      background: '#FFFDFA',
                      border: '1px solid rgba(201,123,75,0.16)',
                      boxShadow:
                        'inset 0 1.5px 0 rgba(255,255,255,0.95), 0 12px 24px -12px rgba(90,62,40,0.30), 0 3px 8px -4px rgba(90,62,40,0.1)',
                    }}
                  >
                    <span className="w-6 h-6 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{label}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
