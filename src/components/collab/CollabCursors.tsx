'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollabStore } from '@/store/collabStore';
import { useCanvasStore } from '@/store/canvasStore';
import { cameraForWorldCenter } from '@/lib/utils';

/**
 * Everyone else's cursors, in world space.
 *
 * Two states per peer, because a live session almost never means two people
 * looking at the exact same patch of an infinite canvas:
 *
 *  • ON-SCREEN  — their pointer falls inside my viewport: a coloured, glowing
 *    pointer with a name tag, spring-eased so it glides instead of teleporting.
 *  • OFF-SCREEN — their pointer is somewhere I'm not looking: a chip pinned to
 *    the edge of my screen, pointing the way to them. Click it and I fly there.
 *    This is the difference between "their cursor vanished" (the old behaviour,
 *    which read as broken) and "they're over there, tap to go".
 */

const EDGE_MARGIN = 26; // how far the off-screen chip sits from the viewport edge

export default function CollabCursors() {
  const status = useCollabStore((s) => s.status);
  const peers = useCollabStore((s) => s.peers);
  const cursors = useCollabStore((s) => s.cursors);
  const camera = useCanvasStore((s) => s.camera);
  const animateCamera = useCanvasStore((s) => s.animateCamera);

  const [vp, setVp] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (status !== 'connected') return null;

  const entries = Object.entries(cursors);
  if (entries.length === 0) return null;

  const flyTo = (worldX: number, worldY: number) => {
    animateCamera(cameraForWorldCenter(worldX, worldY, camera.zoom), 520);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-[130]">
      <AnimatePresence>
        {entries.map(([id, pos]) => {
          const peer = peers[id];
          if (!peer) return null;

          // World -> screen using MY camera. A correct world coordinate from the
          // sender lands on the same content on my screen, whatever my pan/zoom.
          const screenX = pos.x * camera.zoom + camera.x;
          const screenY = pos.y * camera.zoom + camera.y;

          const onScreen =
            screenX >= 0 && screenX <= vp.w && screenY >= 0 && screenY <= vp.h;

          if (onScreen) {
            return (
              <motion.div
                key={id}
                data-peer-cursor={id}
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
          }

          // Off-screen: clamp to the edge and rotate a little arrow toward them.
          const cx = vp.w / 2;
          const cy = vp.h / 2;
          const dx = screenX - cx;
          const dy = screenY - cy;
          const edgeX = Math.max(EDGE_MARGIN, Math.min(vp.w - EDGE_MARGIN, screenX));
          const edgeY = Math.max(EDGE_MARGIN, Math.min(vp.h - EDGE_MARGIN, screenY));
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

          return (
            <motion.button
              key={id}
              type="button"
              data-peer-edge={id}
              onClick={() => flyTo(pos.x, pos.y)}
              className="absolute top-0 left-0 pointer-events-auto flex items-center gap-1 pl-1 pr-2 py-1 rounded-full shadow-md cursor-pointer"
              style={{ background: peer.color }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.95, scale: 1, x: edgeX - 8, y: edgeY - 12 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{
                x: { type: 'spring', stiffness: 500, damping: 40 },
                y: { type: 'spring', stiffness: 500, damping: 40 },
                opacity: { duration: 0.15 },
              }}
              title={`Jump to ${peer.name}`}
            >
              <span
                className="flex items-center justify-center w-4 h-4"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
              <span className="text-[10px] font-bold text-white whitespace-nowrap max-w-[90px] truncate">
                {peer.name}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
