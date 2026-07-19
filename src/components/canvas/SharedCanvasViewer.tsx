'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { clamp } from '@/lib/utils';
import { applyCanvasTheme, resetCanvasTheme, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';
import type { CanvasBackground } from '@/lib/canvasTheme';
import type { BoardSnapshot } from '@/lib/share';
import CanvasObject from './CanvasObject';
import ConnectionsLayer from './ConnectionsLayer';
import DrawingLayer from './DrawingLayer';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

/**
 * The public, read-only board viewer behind a share link. It reuses the real
 * CanvasObject / connection / drawing renderers for pixel-perfect fidelity, but
 * runs with the store's `readOnly` flag on so nothing can be edited — you can
 * only pan, zoom and look.
 */
export default function SharedCanvasViewer({ snapshot }: { snapshot: BoardSnapshot }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setObjects = useCanvasStore((s) => s.setObjects);
  const setStrokes = useCanvasStore((s) => s.setStrokes);
  const setConnections = useCanvasStore((s) => s.setConnections);
  const setWorkspaceTitle = useCanvasStore((s) => s.setWorkspaceTitle);
  const setReadOnly = useCanvasStore((s) => s.setReadOnly);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const camera = useCanvasStore((s) => s.camera);
  const objects = useCanvasStore((s) => s.objects);

  const fit = useCallback(() => {
    const objs = useCanvasStore.getState().objects;
    if (!objs.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objs) {
      minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + (o.width || 0)); maxY = Math.max(maxY, o.y + (o.height || 0));
    }
    const bw = maxX - minX, bh = maxY - minY;
    const vw = window.innerWidth, vh = window.innerHeight, pad = 100;
    const zoom = clamp(Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh), MIN_ZOOM, 1);
    setCamera({ x: vw / 2 - (minX + bw / 2) * zoom, y: vh / 2 - (minY + bh / 2) * zoom, zoom });
  }, [setCamera]);

  // Load the snapshot into the store, read-only, and frame it.
  useEffect(() => {
    setReadOnly(true);
    applyCanvasTheme((snapshot.background as CanvasBackground) || DEFAULT_BACKGROUND);
    setWorkspaceTitle(snapshot.title || 'Shared board');
    setObjects(snapshot.objects || []);
    setStrokes(snapshot.strokes || []);
    setConnections(snapshot.connections || []);
    // Frame after the objects have mounted.
    requestAnimationFrame(() => requestAnimationFrame(fit));
    return () => {
      setReadOnly(false);
      resetCanvasTheme();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Zoom (ctrl/⌘ + wheel) toward cursor; plain wheel pans — same feel as the editor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = useCanvasStore.getState().camera;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.005);
        const nz = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setCamera({ x: mx - (mx - cam.x) * (nz / cam.zoom), y: my - (my - cam.y) * (nz / cam.zoom), zoom: nz });
      } else {
        setCamera({ x: cam.x - e.deltaX, y: cam.y - e.deltaY, zoom: cam.zoom });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCamera]);

  // Drag-anywhere panning.
  const pan = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const cam = useCanvasStore.getState().camera;
    pan.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!pan.current) return;
    const cam = useCanvasStore.getState().camera;
    setCamera({ x: pan.current.camX + (e.clientX - pan.current.x), y: pan.current.camY + (e.clientY - pan.current.y), zoom: cam.zoom });
  };
  const endPan = () => { pan.current = null; };

  const zoomBy = (factor: number) => {
    const cam = useCanvasStore.getState().camera;
    const nz = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    setCamera({ x: cx - (cx - cam.x) * (nz / cam.zoom), y: cy - (cy - cam.y) * (nz / cam.zoom), zoom: nz });
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden select-none"
      style={{ background: 'var(--bg-primary)', cursor: pan.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
    >
      <div className="canvas-grid" style={{ position: 'absolute', inset: 0 }} />

      <div className="canvas-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <ConnectionsLayer />
        {objects.map((obj) => (
          <div key={obj.id} data-object-id={obj.id}>
            <CanvasObject obj={obj} isSelected={false} isFocused={false} />
          </div>
        ))}
      </div>
      <DrawingLayer />

      {/* Header */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-3">
        <div className="glass-panel pointer-events-auto flex items-center gap-2" style={{ padding: '7px 14px' }}>
          <span className="text-sm font-semibold text-[var(--text-primary)]" style={{ fontFamily: "'Outfit', sans-serif" }}>
            {snapshot.title || 'Shared board'}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]" style={{ padding: '2px 8px' }}>
            View only
          </span>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto">
        <div className="glass-panel flex items-center gap-1" style={{ padding: '5px 7px' }}>
          <button onClick={() => zoomBy(1 / 1.2)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] cursor-pointer text-lg">−</button>
          <button onClick={fit} title="Fit to screen" className="px-2 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] cursor-pointer text-xs font-bold uppercase tracking-wide">Fit</button>
          <button onClick={() => zoomBy(1.2)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] cursor-pointer text-lg">+</button>
        </div>
      </div>

      {/* Made-with badge */}
      <a
        href="/"
        className="fixed bottom-8 right-8 z-[200] glass-panel pointer-events-auto text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        style={{ padding: '7px 12px', fontFamily: "'Outfit', sans-serif" }}
      >
        Made with <span className="text-[var(--accent)]">canvabrains</span>
      </a>
    </div>
  );
}
