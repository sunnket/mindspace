'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

export default function Minimap() {
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);

  const MINIMAP_W = 160;
  const MINIMAP_H = 100;

  // Calculate bounds of all objects
  const bounds = useMemo(() => {
    if (objects.length === 0) return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objects) {
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(maxX, obj.x + obj.width);
      maxY = Math.max(maxY, obj.y + obj.height);
    }
    // Add padding
    const pad = 200;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [objects]);

  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);

  // Viewport rect in minimap space
  const vpX = (-camera.x / camera.zoom - bounds.minX) * scale;
  const vpY = (-camera.y / camera.zoom - bounds.minY) * scale;
  const vpW = (window.innerWidth / camera.zoom) * scale;
  const vpH = (window.innerHeight / camera.zoom) * scale;

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldX = mx / scale + bounds.minX;
    const worldY = my / scale + bounds.minY;

    setCamera({
      x: -worldX * camera.zoom + window.innerWidth / 2,
      y: -worldY * camera.zoom + window.innerHeight / 2,
      zoom: camera.zoom,
    });
  };

  return (
    <div className="fixed bottom-8 right-12 z-[140] pointer-events-none minimap-container flow-hideable">
      <motion.div
        className="glass-panel p-2 flex flex-col gap-2 pointer-events-auto shadow-sm cursor-pointer relative"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 0.7, y: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        onClick={handleClick}
      >
        {/* Zoom percentage on top left of minimap */}
        <div className="absolute top-1 left-1 bg-white/40 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] font-mono text-[var(--text-secondary)] pointer-events-none border border-white/40 z-10">
          {Math.round(camera.zoom * 100)}%
        </div>

        {/* Zoom-to-fit (also on the F key) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (objects.length === 0) return;
            const minX = Math.min(...objects.map((o) => o.x));
            const minY = Math.min(...objects.map((o) => o.y));
            const maxX = Math.max(...objects.map((o) => o.x + o.width));
            const maxY = Math.max(...objects.map((o) => o.y + o.height));
            const pad = 120;
            const w = maxX - minX + pad * 2;
            const h = maxY - minY + pad * 2;
            const zoom = Math.min(window.innerWidth / w, window.innerHeight / h, 1.2);
            useCanvasStore.getState().animateCamera({
              x: window.innerWidth / 2 - (minX + (maxX - minX) / 2) * zoom,
              y: window.innerHeight / 2 - (minY + (maxY - minY) / 2) * zoom,
              zoom,
            }, 700);
          }}
          title="Zoom to fit everything (F)"
          aria-label="Zoom to fit everything"
          className="absolute top-1 right-1 z-10 w-5 h-5 rounded bg-white/40 backdrop-blur-md border border-white/40 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-white/70 transition-colors cursor-pointer"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>

        <svg width={MINIMAP_W} height={MINIMAP_H} className="w-full h-full">
          {/* Objects as dots/rects */}
          {Array.from(new Map(objects.map(o => [o.id, o])).values()).map((obj) => (
            <rect
              key={obj.id}
              x={(obj.x - bounds.minX) * scale}
              y={(obj.y - bounds.minY) * scale}
              width={Math.max(2, obj.width * scale)}
              height={Math.max(2, obj.height * scale)}
              fill={
                obj.style?.isCheckpoint
                  ? '#FF4D4D' // Bright Red for checkpoints
                  : obj.type === 'heading'
                  ? 'var(--accent)'
                  : obj.type === 'sticky'
                  ? '#F5C563'
                  : obj.type === 'image'
                  ? '#7BB3E0'
                  : 'var(--text-tertiary)'
              }
              rx={obj.style?.isCheckpoint ? 10 : 1}
              opacity={obj.style?.isCheckpoint ? 1 : 0.7}
            />
          ))}

          {/* Viewport indicator */}
          <rect
            x={vpX}
            y={vpY}
            width={vpW}
            height={vpH}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            rx={1}
            opacity={0.6}
          />
        </svg>
      </motion.div>
    </div>
  );
}
