'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

export default function ConnectionsLayer() {
  const connections = useCanvasStore((s) => s.connections);
  const objects = useCanvasStore((s) => s.objects);
  const removeConnection = useCanvasStore((s) => s.removeConnection);
  const mode = useCanvasStore((s) => s.mode);

  const [hoveredConnId, setHoveredConnId] = useState<string | null>(null);

  const getObjectVisualRect = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || obj.style?.isMinimized) return null;

    return {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      centerX: obj.x + obj.width / 2,
      centerY: obj.y + obj.height / 2,
    };
  };

  const getIntersectionPoint = (rect: any, otherX: number, otherY: number) => {
    const cx = rect.centerX;
    const cy = rect.centerY;
    
    const dx = otherX - cx;
    const dy = otherY - cy;
    
    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // Line equation: (x-cx)/dx = (y-cy)/dy = t
    // Check intersection with vertical edges
    const tX = dx > 0 ? halfW / dx : -halfW / dx;
    // Check intersection with horizontal edges
    const tY = dy > 0 ? halfH / dy : -halfH / dy;

    const t = Math.min(Math.abs(tX), Math.abs(tY));

    return {
      x: cx + dx * t,
      y: cy + dy * t
    };
  };

  return (
    <div className="absolute top-0 left-0 pointer-events-none overflow-visible">
      {/* 1x1 SVG with visible overflow: paths render at world coordinates without
          creating a giant layout box (a 100000x100000 layer can exhaust GPU memory) */}
      <svg
        width="1"
        height="1"
        style={{ pointerEvents: 'none', position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <marker 
            id="workflow-arrow" 
            viewBox="0 0 10 10"
            refX="6" 
            refY="5" 
            markerWidth="7" 
            markerHeight="7" 
            orient="auto"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 Z" fill="currentColor" />
          </marker>
          <style>{`
            @keyframes workflow-pulse {
              from {
                stroke-dashoffset: 24;
              }
              to {
                stroke-dashoffset: 0;
              }
            }
            .workflow-pulse-path {
              /* Static dashes at rest: the infinite animation forced a repaint of the
                 connection layer every frame, which stacks up badly on large canvases */
              stroke-dasharray: 8, 4;
            }
            .workflow-pulse-path-hover {
              stroke-dasharray: 8, 4;
              animation: workflow-pulse 0.7s linear infinite;
            }
          `}</style>
        </defs>
        <AnimatePresence>
          {Array.from(new Map(connections.map(c => [c.id, c])).values()).map((conn) => {
            const rectA = getObjectVisualRect(conn.fromId);
            const rectB = getObjectVisualRect(conn.toId);

            if (!rectA || !rectB) return null;

            const isWorkflow = conn.style?.isWorkflowConnection || 
                               (objects.find(o => o.id === conn.fromId)?.type === 'workflow-node' && 
                                objects.find(o => o.id === conn.toId)?.type === 'workflow-node');
            
            let d = '';
            let start = { x: 0, y: 0 };
            let end = { x: 0, y: 0 };

            if (!isWorkflow) {
              start = getIntersectionPoint(rectA, rectB.centerX, rectB.centerY);
              end = getIntersectionPoint(rectB, rectA.centerX, rectA.centerY);
              d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
            } else {
              const dx = rectB.centerX - rectA.centerX;
              const dy = rectB.centerY - rectA.centerY;
              
              if (Math.abs(dx) > Math.abs(dy)) {
                if (dx >= 0) {
                  start = { x: rectA.x + rectA.width, y: rectA.centerY };
                  end = { x: rectB.x - 3, y: rectB.centerY }; // offset slightly for arrowhead clearance
                } else {
                  start = { x: rectA.x, y: rectA.centerY };
                  end = { x: rectB.x + rectB.width + 3, y: rectB.centerY };
                }
                const offset = Math.abs(end.x - start.x) * 0.45;
                const cpx1 = start.x + (dx >= 0 ? offset : -offset);
                const cpy1 = start.y;
                const cpx2 = end.x - (dx >= 0 ? offset : -offset);
                const cpy2 = end.y;
                d = `M ${start.x} ${start.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${end.x} ${end.y}`;
              } else {
                if (dy >= 0) {
                  start = { x: rectA.centerX, y: rectA.y + rectA.height };
                  end = { x: rectB.centerX, y: rectB.y - 3 };
                } else {
                  start = { x: rectA.centerX, y: rectA.y };
                  end = { x: rectB.centerX, y: rectB.y + rectB.height + 3 };
                }
                const offset = Math.abs(end.y - start.y) * 0.45;
                const cpx1 = start.x;
                const cpy1 = start.y + (dy >= 0 ? offset : -offset);
                const cpx2 = end.x;
                const cpy2 = end.y - (dy >= 0 ? offset : -offset);
                d = `M ${start.x} ${start.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${end.x} ${end.y}`;
              }
            }

            const isHovered = hoveredConnId === conn.id;
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const connColor = isHovered 
              ? "var(--accent)" 
              : ((conn.style?.color as string) || (isWorkflow ? '#C97B4B' : 'rgba(0,0,0,0.8)'));

            return (
              <g key={conn.id}>
                {/* Hit area for hover */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onMouseEnter={() => setHoveredConnId(conn.id)}
                  onMouseLeave={() => setHoveredConnId(null)}
                />

                {/* Background Shadow Line */}
                <motion.path
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.15 }}
                  d={d}
                  fill="none"
                  stroke="#000"
                  strokeWidth={4}
                  strokeLinecap="round"
                />

                {/* The visible connection line */}
                <motion.path
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ pathLength: 0, opacity: 0 }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  d={d}
                  fill="none"
                  stroke={connColor}
                  strokeWidth={isHovered ? 2.5 : isWorkflow ? 2 : 1.5}
                  strokeLinecap="round"
                  className={
                    isWorkflow
                      ? (isHovered ? 'workflow-pulse-path-hover' : 'workflow-pulse-path')
                      : ''
                  }
                  style={{ 
                    color: connColor,
                    filter: isHovered ? 'url(#line-glow)' : 'none',
                    transition: 'stroke 0.3s, stroke-width 0.3s'
                  }}
                  markerEnd={isWorkflow ? "url(#workflow-arrow)" : undefined}
                />

                {/* Delete button on hover */}
                {isHovered && (
                  <foreignObject
                    x={midX - 15}
                    y={midY - 15}
                    width={30}
                    height={30}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <motion.button
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center shadow-xl border border-white/20 hover:bg-red-500 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeConnection(conn.id);
                      }}
                      onMouseEnter={() => setHoveredConnId(conn.id)}
                    >
                      <span className="text-[12px] font-bold">✕</span>
                    </motion.button>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </AnimatePresence>
      </svg>
    </div>
  );
}
