'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

interface StrokePoint {
  x: number;
  y: number;
}

interface WhiteboardStroke {
  points: StrokePoint[];
  color: string;
  width: number;
}

// Preset background options
const BG_PRESETS = [
  { name: 'White', color: '#ffffff' },
  { name: 'Black', color: '#1c1c1e' },
  { name: 'Cream', color: '#fcf8f2' },
  { name: 'Mint', color: '#f0f9f4' },
  { name: 'Midnight', color: '#0d1117' },
];

const MARKERS = ['#ff5f56', '#ffbd2e', '#27c93f', '#3e63dd', '#7c5cd6', '#111111', '#ffffff'];

export default function WhiteboardBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);

  // Title / Content
  const [title, setTitle] = useState(obj.content || 'untitled whiteboard');

  // Drawing settings
  const [brushColor, setBrushColor] = useState('#ff5f56');
  const [brushWidth, setBrushWidth] = useState(4);
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);

  // Draw mode — toggled by double-clicking the board (so a normal click/drag
  // still moves the card, and drawing never fights with dragging).
  const [drawMode, setDrawMode] = useState(false);

  // Background setting
  const [bgColor, setBgColor] = useState((obj.style?.whiteboardBg as string) || '#ffffff');
  const [rgb, setRgb] = useState({ r: 255, g: 255, b: 255 });
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<StrokePoint[]>([]);

  // A dark board wants a light default marker and vice-versa.
  const boardIsDark = (() => {
    const hex = bgColor.replace('#', '');
    if (hex.length !== 6) return false;
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  })();

  // Parse color to RGB for sliders
  useEffect(() => {
    const hex = bgColor.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.substring(1, 3), 16);
      const g = parseInt(hex.substring(3, 5), 16);
      const b = parseInt(hex.substring(5, 7), 16);
      setRgb({ r, g, b });
    }
  }, [bgColor]);

  // Load saved strokes and background
  useEffect(() => {
    if (obj.style?.whiteboardStrokes) {
      setStrokes(obj.style.whiteboardStrokes as WhiteboardStroke[]);
    } else {
      setStrokes([]);
    }
    if (obj.style?.whiteboardBg) {
      setBgColor(obj.style.whiteboardBg as string);
    }
  }, [obj.style]);

  // Esc leaves draw mode
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setDrawMode(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawMode]);

  // Redraw all strokes onto canvas context
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokes.forEach((stroke) => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const p0 = stroke.points[0];
      ctx.moveTo(p0.x, p0.y);

      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    });
  }, [strokes]);

  // Handle Resize buffer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        redraw();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);

    redraw();

    return () => observer.disconnect();
  }, [redraw]);

  // Drawing event handlers
  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode) return; // only draw once the board is in draw mode
    e.stopPropagation();
    const coords = getCoordinates(e);
    if (!coords) return;
    try { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch { /* older browsers */ }

    isDrawingRef.current = true;
    currentPointsRef.current = [coords];

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(coords.x, coords.y);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.stopPropagation();
    const coords = getCoordinates(e);
    if (!coords) return;

    currentPointsRef.current.push(coords);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.stopPropagation();
    isDrawingRef.current = false;

    if (currentPointsRef.current.length > 0) {
      const newStroke: WhiteboardStroke = {
        points: currentPointsRef.current,
        color: brushColor,
        width: brushWidth,
      };

      const nextStrokes = [...strokes, newStroke];
      setStrokes(nextStrokes);
      updateObject(obj.id, {
        style: {
          ...obj.style,
          whiteboardStrokes: nextStrokes,
        },
      });
    }
  };

  // Settings helpers
  const handleBgColorChange = (color: string) => {
    setBgColor(color);
    updateObject(obj.id, {
      style: {
        ...obj.style,
        whiteboardBg: color,
      },
    });
  };

  const handleRgbSlider = (key: 'r' | 'g' | 'b', val: number) => {
    const nextRgb = { ...rgb, [key]: val };
    setRgb(nextRgb);
    const componentToHex = (c: number) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    const hex = '#' + componentToHex(nextRgb.r) + componentToHex(nextRgb.g) + componentToHex(nextRgb.b);
    handleBgColorChange(hex);
  };

  const cycleBg = () => {
    const currentIndex = BG_PRESETS.findIndex((p) => p.color.toLowerCase() === bgColor.toLowerCase());
    const nextIndex = (currentIndex + 1) % BG_PRESETS.length;
    handleBgColorChange(BG_PRESETS[nextIndex].color);
  };

  const clearCanvas = () => {
    setStrokes([]);
    updateObject(obj.id, {
      style: {
        ...obj.style,
        whiteboardStrokes: [],
      },
    });
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    updateObject(obj.id, { content: val });
  };

  const stopDrag = (e: React.MouseEvent) => e.stopPropagation();
  const headerInk = boardIsDark ? 'text-white/85' : 'text-black/70';

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col rounded-2xl overflow-hidden select-none transition-shadow"
      style={{
        backgroundColor: bgColor,
        // A real whiteboard: a chunky neutral frame + a soft cast shadow, and an
        // accent ring while you're actively drawing on it.
        boxShadow: drawMode
          ? '0 0 0 2px var(--accent), 0 14px 34px rgba(0,0,0,0.22)'
          : '0 0 0 1px rgba(0,0,0,0.12), inset 0 0 0 6px rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Top toolbar */}
      <div
        className={`flex items-center justify-between px-3 py-2 shrink-0 ${boardIsDark ? 'bg-white/[0.06]' : 'bg-black/[0.04]'} border-b ${boardIsDark ? 'border-white/10' : 'border-black/5'}`}
        onMouseDown={stopDrag}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-xs shrink-0 ${headerInk}`}>📋</span>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onMouseDown={stopDrag}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Rename whiteboard…"
            className={`bg-transparent border-none outline-none font-bold text-[11px] w-full placeholder:opacity-40 ${boardIsDark ? 'text-white/90' : 'text-black/80'}`}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Draw / Done toggle */}
          <button
            type="button"
            onClick={() => setDrawMode((m) => !m)}
            title={drawMode ? 'Stop drawing' : 'Draw (or double-click the board)'}
            className={`h-6 px-2 rounded-lg flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
              drawMode
                ? 'bg-[var(--accent)] text-white'
                : boardIsDark ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-black/5 text-black/70 hover:bg-black/10'
            }`}
          >
            {drawMode ? (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Done</>
            ) : (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>Draw</>
            )}
          </button>

          <button
            type="button"
            onClick={cycleBg}
            title="Cycle background color"
            className={`w-6 h-6 rounded-lg flex items-center justify-center cursor-pointer ${boardIsDark ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/5 text-black/60'}`}
          >
            🎨
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            title="Background settings"
            className={`w-6 h-6 rounded-lg flex items-center justify-center cursor-pointer ${boardIsDark ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/5 text-black/60'} ${showSettings ? '!text-[var(--accent)]' : ''}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={clearCanvas}
            title="Clear all drawings"
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/10 text-red-500 cursor-pointer"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Main Drawing Area */}
      <div className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={(e) => { e.stopPropagation(); setDrawMode((m) => !m); }}
          onMouseDown={drawMode ? stopDrag : undefined}
          className={`absolute inset-0 w-full h-full touch-none ${drawMode ? 'cursor-crosshair' : 'cursor-default'}`}
        />

        {/* Idle hint / drawing indicator */}
        {!drawMode ? (
          <div className={`absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider select-none pointer-events-none ${boardIsDark ? 'bg-white/10 text-white/70' : 'bg-black/10 text-black/60'}`}>
            Double-click to draw
          </div>
        ) : (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold uppercase tracking-wider select-none pointer-events-none flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Drawing · Esc to stop
          </div>
        )}

        {/* Marker tray — always-visible palette + brush size */}
        <div
          className={`absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1.5 rounded-full shadow-lg backdrop-blur-md z-10 ${boardIsDark ? 'bg-black/40 border border-white/10' : 'bg-white/80 border border-black/10'}`}
          onMouseDown={stopDrag}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {MARKERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setBrushColor(c); if (!drawMode) setDrawMode(true); }}
              title="Marker color"
              className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${brushColor === c ? 'scale-125 ring-2 ring-[var(--accent)]' : 'hover:scale-110'} ${c === '#ffffff' ? 'border border-black/20' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <span className={`w-px h-4 ${boardIsDark ? 'bg-white/15' : 'bg-black/10'}`} />
          <input
            type="range"
            min="1"
            max="14"
            value={brushWidth}
            onChange={(e) => setBrushWidth(parseInt(e.target.value))}
            title="Brush width"
            className="w-16 cursor-pointer accent-[var(--accent)]"
          />
        </div>

        {/* Background settings pop-over */}
        {showSettings && (
          <div
            className="absolute top-2 right-2 w-56 p-3 rounded-xl border border-[var(--border)] shadow-xl bg-[var(--bg-glass)] backdrop-blur-md flex flex-col gap-2.5 z-20 text-[10px] text-[var(--text-primary)]"
            onMouseDown={stopDrag}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-secondary)]">Background:</span>
              <div className="flex gap-1">
                {BG_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleBgColorChange(preset.color)}
                    title={preset.name}
                    className={`w-5 h-5 rounded-md border cursor-pointer transition-transform hover:scale-110 ${bgColor.toLowerCase() === preset.color.toLowerCase() ? 'ring-2 ring-[var(--accent)] border-transparent' : 'border-black/15 dark:border-white/25'}`}
                    style={{ backgroundColor: preset.color }}
                  />
                ))}
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px]">
                <span className="font-semibold text-[var(--text-secondary)]">RGB Editor:</span>
                <span className="font-mono text-[var(--text-tertiary)] uppercase">{bgColor}</span>
              </div>
              <div className="space-y-1">
                {(['r', 'g', 'b'] as const).map((ch) => (
                  <div key={ch} className="flex items-center gap-2">
                    <span className={`w-2.5 font-bold ${ch === 'r' ? 'text-red-500' : ch === 'g' ? 'text-green-500' : 'text-blue-500'}`}>{ch.toUpperCase()}</span>
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={rgb[ch]}
                      onChange={(e) => handleRgbSlider(ch, parseInt(e.target.value))}
                      className={`flex-1 h-1 rounded-lg appearance-none cursor-pointer ${ch === 'r' ? 'accent-red-500' : ch === 'g' ? 'accent-green-500' : 'accent-blue-500'}`}
                    />
                    <span className="w-6 text-right font-mono text-[9px]">{rgb[ch]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
