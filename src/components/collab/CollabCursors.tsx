'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollabStore } from '@/store/collabStore';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * Renders other peoples' cursors as coloured, highlighter-style pointers with
 * a soft glow and a name tag. Only mounts content during a live session with
 * at least one other person present — solo canvases show nothing.
 */
export default function CollabCursors() {
  const status = useCollabStore((s) => s.status);
  const peers = useCollabStore((s) => s.peers);
  const cursors = useCollabStore((s) => s.cursors);
  const camera = useCanvasStore((s) => s.camera);

  if (status !== 'connected') return null;

  const entries = Object.entries(cursors);
  if (entries.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[130]">
      <AnimatePresence>
        {entries.map(([id, pos]) => {
          const peer = peers[id];
          if (!peer) return null;

          // World -> screen using the local viewer's camera.
          const screenX = pos.x * camera.zoom + camera.x;
          const screenY = pos.y * camera.zoom + camera.y;

          return (
            <motion.div
              key={id}
              className="absolute top-0 left-0"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, x: screenX, y: screenY }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{
                x: { type: 'spring', stiffness: 700, damping: 42, mass: 0.4 },
                y: { type: 'spring', stiffness: 700, damping: 42, mass: 0.4 },
                opacity: { duration: 0.15 },
                scale: { duration: 0.15 },
              }}
            >
              {/* soft highlighter halo */}
              <div
                className="absolute -top-2 -left-2 w-9 h-9 rounded-full blur-md"
                style={{ background: peer.color, opacity: 0.28 }}
              />

              {/* pointer */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="relative drop-shadow-sm" aria-hidden="true">
                <path
                  d="M5 3l6.5 16 2.2-6.3 6.3-2.2L5 3z"
                  fill={peer.color}
                  stroke="white"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>

              {/* name tag */}
              <span
                className="absolute left-5 top-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap shadow-sm"
                style={{ background: peer.color }}
              >
                {peer.name}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
