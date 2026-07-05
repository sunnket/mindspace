'use client';

import React, { useState, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { motion, AnimatePresence } from 'framer-motion';

export default function CheckpointIndex() {
  const objects = useCanvasStore((state) => state.objects);
  const camera = useCanvasStore((state) => state.camera);
  const [isHovered, setIsHovered] = useState(false);

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

  const handleGoToCheckpoint = (obj: any) => {
    if (!obj) return;
    const targetZoom = Math.max(camera.zoom, 0.8);
    const camX = window.innerWidth / 2 - (obj.x + obj.width / 2) * targetZoom;
    const camY = window.innerHeight / 2 - (obj.y + obj.height / 2) * targetZoom;
    
    // Cinematic camera transition
    useCanvasStore.getState().animateCamera({ x: camX, y: camY, zoom: targetZoom }, 1400);
  };

  // If there are no checkpoints, show a subtle empty gauge placeholder
  if (checkpoints.length === 0) {
    return (
      <div 
        className="fixed right-6 top-1/2 -translate-y-1/2 z-50 pointer-events-auto flex items-center select-none"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
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
        
        <AnimatePresence>
          {isHovered && (
            <motion.div
              className="absolute right-8 mr-2 glass-panel py-2.5 px-4 flex items-center shadow-xl border border-white/20"
              initial={{ opacity: 0, x: 10, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                No checkpoints placed
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div 
      className="fixed right-6 top-1/2 -translate-y-1/2 z-50 pointer-events-auto flex items-center select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* ─── HOVER REVEAL HEADINGS PANEL ─────────────────────────────────── */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute right-10 mr-2 bg-[rgba(255,252,248,0.4)] dark:bg-black/35 backdrop-blur-3xl py-6 pl-9 pr-5 rounded-2xl border border-white/20 dark:border-white/5 shadow-2xl flex flex-col gap-2.5 min-w-[280px]"
            initial={{ opacity: 0, x: 15, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 15, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          >
            {/* Added pl-12 to shift the Checkpoints title deeply (84px total) inside the card boundaries */}
            <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] font-bold mb-1 border-b border-black/[0.04] dark:border-white/[0.04] pb-1 font-mono pl-12">
              Checkpoints
            </div>
            
            {checkpoints.map((checkpoint, index) => {
              const isActive = checkpoint.id === activeCheckpointId;
              
              return (
                <button
                  key={checkpoint.id}
                  onClick={() => handleGoToCheckpoint(checkpoint)}
                  className="group flex items-center justify-between text-left py-2 w-full transition-all focus:outline-none pl-12"
                >
                  <span 
                    className={`text-xs font-semibold truncate max-w-[190px] transition-colors ${
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
                    ? 'bg-[var(--accent)] shadow-[0_0_12px_rgba(201,123,75,0.75)]' 
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
