'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

interface CursorTarget { x: number; y: number; note?: string }

/**
 * The agent's own visible hand. While a build runs, AgentOverlay dispatches an
 * `agent-cursor` event (world coords + a short note) for every block it touches,
 * and this pointer glides there — so the agent reads as a live collaborator
 * working the board, not an invisible process that pops blocks in. Same
 * world→screen math and springs as CollabCursors, in the app's accent color.
 * `agent-cursor-hide` (run finished / failed / stopped) retires it.
 */
export default function AgentCursor() {
  const camera = useCanvasStore((s) => s.camera);
  const [target, setTarget] = useState<CursorTarget | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onMove = (e: Event) => {
      const d = (e as CustomEvent<CursorTarget>).detail;
      if (!d || !isFinite(d.x) || !isFinite(d.y)) return;
      setTarget({ x: d.x, y: d.y, note: d.note });
      // A stream can stall mid-plan; never leave a cursor hovering forever.
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setTarget(null), 6000);
    };
    const onHide = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      // Let the final hop visibly land before the pointer bows out.
      hideTimer.current = setTimeout(() => setTarget(null), 700);
    };
    window.addEventListener('agent-cursor', onMove as EventListener);
    window.addEventListener('agent-cursor-hide', onHide);
    return () => {
      window.removeEventListener('agent-cursor', onMove as EventListener);
      window.removeEventListener('agent-cursor-hide', onHide);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const screenX = target ? target.x * camera.zoom + camera.x : 0;
  const screenY = target ? target.y * camera.zoom + camera.y : 0;

  return (
    <div className="fixed inset-0 pointer-events-none z-[128]">
      <AnimatePresence>
        {target && (
          <motion.div
            key="agent-cursor"
            className="absolute top-0 left-0"
            initial={{ opacity: 0, scale: 0.6, x: screenX, y: screenY }}
            animate={{ opacity: 1, scale: 1, x: screenX, y: screenY }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{
              // Softer than a human peer's cursor: a visible glide between
              // blocks is exactly what makes the work read as "live".
              x: { type: 'spring', stiffness: 380, damping: 34, mass: 0.6 },
              y: { type: 'spring', stiffness: 380, damping: 34, mass: 0.6 },
              opacity: { duration: 0.18 },
              scale: { duration: 0.18 },
            }}
          >
            {/* breathing halo — the agent is "thinking with its hands" */}
            <motion.div
              className="absolute -top-2 -left-2 w-9 h-9 rounded-full blur-md"
              style={{ background: 'var(--accent)' }}
              animate={{ opacity: [0.2, 0.42, 0.2], scale: [1, 1.25, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* pointer */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="relative drop-shadow-sm" aria-hidden="true">
              <path
                d="M5 3l6.5 16 2.2-6.3 6.3-2.2L5 3z"
                fill="var(--accent)"
                stroke="white"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>

            {/* name tag + what it's doing right now */}
            <span
              className="absolute left-5 top-4 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap shadow-sm"
              style={{ background: 'var(--accent)' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              </svg>
              Agent{target.note ? ` · ${target.note.slice(0, 34)}` : ''}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
