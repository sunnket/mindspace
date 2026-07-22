'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';

/**
 * The minimap — an overview of the board and a way to get across it fast.
 *
 * Two sizes. The small one is an ambient locator that stays out of the way; the
 * expanded one is a navigator you actually work in — big enough to pick a
 * specific block out of a sprawling board, and draggable, so you can sweep the
 * viewport across the whole canvas in one gesture instead of scrolling for it.
 */

const SMALL = { w: 168, h: 106 };
const LARGE = { w: 460, h: 296 };

export default function Minimap() {
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);

  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  /* Viewport size has to be state, not a bare `window.innerWidth` read during
     render: the viewport rectangle is derived from it, so on a window resize the
     indicator would keep drawing the old size until something else re-rendered. */
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const sync = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const W = expanded ? LARGE.w : SMALL.w;
  const H = expanded ? LARGE.h : SMALL.h;

  // Only this canvas level — a nested space shouldn't map its parent's objects.
  const activeParent = resolveParentId(canvasStack, urlCanvasId);
  const visible = useMemo(
    () => objects.filter((o) => o.parentId === activeParent && !o.style?.isMinimized),
    [objects, activeParent],
  );

  /* Bounds cover the content AND the current viewport, so the indicator can
     never leave the map — panning into empty space used to push it off the edge
     and the minimap stopped telling you anything about where you were. */
  const bounds = useMemo(() => {
    const camLeft = -camera.x / camera.zoom;
    const camTop = -camera.y / camera.zoom;
    const camRight = camLeft + vp.w / camera.zoom;
    const camBottom = camTop + vp.h / camera.zoom;

    if (visible.length === 0) {
      const pad = 400;
      return { minX: camLeft - pad, minY: camTop - pad, maxX: camRight + pad, maxY: camBottom + pad };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of visible) {
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + o.width);
      maxY = Math.max(maxY, o.y + o.height);
    }
    const pad = 200;
    return {
      minX: Math.min(minX, camLeft) - pad,
      minY: Math.min(minY, camTop) - pad,
      maxX: Math.max(maxX, camRight) + pad,
      maxY: Math.max(maxY, camBottom) + pad,
    };
  }, [visible, camera, vp]);

  const worldW = Math.max(1, bounds.maxX - bounds.minX);
  const worldH = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(W / worldW, H / worldH);

  // Centre the content in the box rather than pinning it to the top-left, so a
  // board that doesn't match the map's aspect ratio isn't shoved into a corner.
  const offX = (W - worldW * scale) / 2;
  const offY = (H - worldH * scale) / 2;

  const vpX = offX + (-camera.x / camera.zoom - bounds.minX) * scale;
  const vpY = offY + (-camera.y / camera.zoom - bounds.minY) * scale;
  const vpW = (vp.w / camera.zoom) * scale;
  const vpH = (vp.h / camera.zoom) * scale;

  /** Centre the camera on the world point under the pointer. */
  const jumpTo = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldX = (clientX - rect.left - offX) / scale + bounds.minX;
    const worldY = (clientY - rect.top - offY) / scale + bounds.minY;
    const cam = useCanvasStore.getState().camera;
    setCamera({
      x: -worldX * cam.zoom + window.innerWidth / 2,
      y: -worldY * cam.zoom + window.innerHeight / 2,
      zoom: cam.zoom,
    });
  }, [offX, offY, scale, bounds.minX, bounds.minY, setCamera]);

  /* Press and DRAG to sweep the board. Pointer capture keeps the gesture alive
     when the cursor leaves the map mid-drag, which is easy to do near the edges
     and otherwise strands the viewport halfway. */
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    // Capture on the SVG itself, not e.target — the pointer goes down on
    // whichever <rect> happens to be under it, and capturing that would tie the
    // gesture to one block instead of the map.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    jumpTo(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    jumpTo(e.clientX, e.clientY);
  };
  const endDrag = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  const zoomToFit = () => {
    if (visible.length === 0) return;
    const minX = Math.min(...visible.map((o) => o.x));
    const minY = Math.min(...visible.map((o) => o.y));
    const maxX = Math.max(...visible.map((o) => o.x + o.width));
    const maxY = Math.max(...visible.map((o) => o.y + o.height));
    const pad = 120;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const zoom = Math.min(window.innerWidth / w, window.innerHeight / h, 1.2);
    useCanvasStore.getState().animateCamera({
      x: window.innerWidth / 2 - (minX + (maxX - minX) / 2) * zoom,
      y: window.innerHeight / 2 - (minY + (maxY - minY) / 2) * zoom,
      zoom,
    }, 700);
  };

  const fillFor = (o: (typeof visible)[number]) =>
    o.style?.isCheckpoint ? '#FF4D4D'
    : o.type === 'frame' ? 'transparent'
    : o.type === 'heading' ? 'var(--accent)'
    : o.type === 'sticky' ? ((o.style?.color as string) || '#F5C563')
    : o.type === 'image' || o.type === 'mirror' ? '#7BB3E0'
    : 'var(--text-tertiary)';

  return (
    <div className="fixed bottom-8 right-12 z-[140] pointer-events-none minimap-container flow-hideable">
      <motion.div
        layout
        className="clay-card rounded-2xl flex flex-col gap-1.5 pointer-events-auto shadow-sm relative"
        style={{ padding: 8 }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: expanded ? 1 : 0.78, y: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.35 }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header: zoom read-out + controls. Moved OUT of the map itself — as a
            translucent white chip floating on the canvas it was unreadable on a
            dark board, and it sat on top of the very content it was labelling. */}
        <div className="flex items-center gap-1.5" style={{ paddingLeft: 2 }}>
          <span
            className="text-[10px] font-bold tabular-nums text-[var(--text-primary)] rounded-md"
            style={{ background: 'var(--well)', padding: '2px 6px' }}
            title="Current zoom"
          >
            {Math.round(camera.zoom * 100)}%
          </span>

          {expanded && (
            <>
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)] tabular-nums">
                {visible.length} block{visible.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={zoomToFit}
                title="Zoom the canvas to fit everything (F)"
                aria-label="Zoom to fit everything"
                className="w-5 h-5 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                style={{ marginLeft: 'auto' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              </button>
            </>
          )}

          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Shrink the map' : 'Expand the map — drag it to sweep the whole board'}
            aria-label={expanded ? 'Shrink minimap' : 'Expand minimap'}
            aria-pressed={expanded}
            className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              expanded ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)] hover:text-[var(--accent)]'
            }`}
            style={expanded ? undefined : { marginLeft: 'auto' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {expanded
                ? <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /></>
                : <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /></>}
            </svg>
          </button>
        </div>

        {/* A plain <svg>, not motion.svg: framer's layout projection works by
            applying transforms, which fights an SVG that resizes by attribute.
            The card around it carries the layout animation. */}
        <svg
          ref={svgRef}
          width={W}
          height={H}
          className="rounded-xl"
          style={{
            background: 'var(--well)',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {visible.map((o) => (
            <rect
              key={o.id}
              x={offX + (o.x - bounds.minX) * scale}
              y={offY + (o.y - bounds.minY) * scale}
              width={Math.max(expanded ? 3 : 2, o.width * scale)}
              height={Math.max(expanded ? 3 : 2, o.height * scale)}
              fill={fillFor(o)}
              stroke={o.type === 'frame' ? ((o.style?.frameColor as string) || 'var(--accent)') : 'none'}
              strokeDasharray={o.type === 'frame' ? '3 2' : undefined}
              strokeWidth={o.type === 'frame' ? 0.8 : 0}
              rx={o.style?.isCheckpoint ? 10 : 1.5}
              opacity={o.style?.isCheckpoint ? 1 : o.type === 'frame' ? 0.65 : 0.75}
            />
          ))}

          {/* Viewport: a filled wash as well as an outline, so at small sizes
              you can see where you are without hunting for a 1px rectangle. */}
          <rect
            x={vpX}
            y={vpY}
            width={Math.max(4, vpW)}
            height={Math.max(4, vpH)}
            fill="rgba(var(--accent-rgb), 0.14)"
            stroke="var(--accent)"
            strokeWidth={1.5}
            rx={2}
          />
        </svg>

        {expanded && (
          <p className="text-[9px] text-center text-[var(--text-tertiary)] leading-snug" style={{ paddingBottom: 1 }}>
            Drag anywhere on the map to sweep the board
          </p>
        )}
      </motion.div>
    </div>
  );
}
