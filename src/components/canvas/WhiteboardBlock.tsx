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

export default function WhiteboardBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  
  // Title / Content
  const [title, setTitle] = useState(obj.content || 'untitled whiteboard');

  // Drawing settings
  const [brushColor, setBrushColor] = useState('#ff5f56');
  const [brushWidth, setBrushWidth] = useState(4);
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  
  // Background setting
  const [bgColor, setBgColor] = useState((obj.style?.whiteboardBg as string) || '#ffffff');
  const [rgb, setRgb] = useState({ r: 255, g: 255, b: 255 });
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<StrokePoint[]>([]);

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
        // Create temp canvas to store buffer
        const temp = document.createElement('canvas');
        temp.width = canvas.width;
        temp.height = canvas.height;
        const tempCtx = temp.getContext('2d');
        if (tempCtx) tempCtx.drawImage(canvas, 0, 0);

        canvas.width = rect.width;
        canvas.height = rect.height;

        // Redraw saved strokes
        redraw();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    
    // Initial draw
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
    // Only draw if Ctrl or Cmd key is held down to avoid conflicts with card dragging
    if (!e.ctrlKey && !e.metaKey) return;

    e.stopPropagation();
    const coords = getCoordinates(e);
    if (!coords) return;

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
    e.stopPropagation();
    if (!isDrawingRef.current) return;
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
    e.stopPropagation();
    if (!isDrawingRef.current) return;
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

    // Convert to hex
    const componentToHex = (c: number) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    const hex = '#' + componentToHex(nextRgb.r) + componentToHex(nextRgb.g) + componentToHex(nextRgb.b);
    handleBgColorChange(hex);
  };

  // Cycle Preset backgrounds
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

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col rounded-2xl border border-[var(--border)] shadow-xl overflow-hidden backdrop-blur-md transition-all select-none"
      style={{ backgroundColor: bgColor }}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/5 bg-black/[0.03] dark:bg-white/[0.03] shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs text-[var(--text-secondary)] shrink-0">📋</span>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Rename whiteboard…"
            className="bg-transparent border-none outline-none font-bold text-[11px] text-[var(--text-primary)] w-full placeholder:opacity-40"
          />
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0 ml-2" onMouseDown={(e) => e.stopPropagation()}>
          {/* Quick cycle button */}
          <button
            type="button"
            onClick={cycleBg}
            title="Cycle background color"
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)] cursor-pointer"
          >
            🎨
          </button>
          
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            title="Brush and background settings"
            className={`w-6 h-6 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)] cursor-pointer ${showSettings ? 'bg-black/5 dark:bg-white/5 text-[var(--accent)]' : ''}`}
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
      <div className="flex-1 relative min-h-0 bg-transparent">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        />

        {/* Draw Guideline */}
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/45 dark:bg-white/10 text-[8px] font-bold text-white/95 dark:text-white/80 uppercase tracking-wider select-none pointer-events-none">
          Ctrl + Drag to Draw
        </div>

        {/* Slide-out Brush & Background Controls */}
        {showSettings && (
          <div
            className="absolute bottom-2 left-2 right-2 p-3 rounded-xl border border-[var(--border)] shadow-xl bg-[var(--bg-glass)] backdrop-blur-md flex flex-col gap-2.5 z-10 text-[10px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Color Palette */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-secondary)]">Brush Color:</span>
              <div className="flex gap-1.5">
                {['#ff5f56', '#ffbd2e', '#27c93f', '#3e63dd', '#7c5cd6', '#000000', '#ffffff'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBrushColor(c)}
                    className={`w-4 h-4 rounded-full border cursor-pointer transition-transform ${brushColor === c ? 'scale-120 ring-1 ring-[var(--accent)] border-transparent' : 'border-black/10 dark:border-white/20'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Brush Width */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-secondary)]">Brush Width:</span>
              <div className="flex items-center gap-2 flex-1 max-w-[120px] ml-4">
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={brushWidth}
                  onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                  className="w-full cursor-pointer accent-[var(--accent)]"
                />
                <span className="font-bold w-4 text-right text-[9px]">{brushWidth}px</span>
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Background Presets */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-secondary)]">Presets:</span>
              <div className="flex gap-1.5">
                {BG_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleBgColorChange(preset.color)}
                    title={preset.name}
                    className={`h-4 px-1.5 rounded border text-[9px] cursor-pointer transition-colors ${bgColor.toLowerCase() === preset.color.toLowerCase() ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)] font-bold' : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/25 text-[var(--text-secondary)]'}`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Background RGB Sliders */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px]">
                <span className="font-semibold text-[var(--text-secondary)]">RGB Editor:</span>
                <span className="font-mono text-[var(--text-tertiary)] uppercase">{bgColor}</span>
              </div>
              <div className="space-y-1">
                {/* R */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 font-bold text-red-500">R</span>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={rgb.r}
                    onChange={(e) => handleRgbSlider('r', parseInt(e.target.value))}
                    className="flex-1 h-1 bg-red-100 rounded-lg appearance-none cursor-pointer accent-red-500"
                  />
                  <span className="w-5 text-right font-mono text-[9px]">{rgb.r}</span>
                </div>
                {/* G */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 font-bold text-green-500">G</span>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={rgb.g}
                    onChange={(e) => handleRgbSlider('g', parseInt(e.target.value))}
                    className="flex-1 h-1 bg-green-100 rounded-lg appearance-none cursor-pointer accent-green-500"
                  />
                  <span className="w-5 text-right font-mono text-[9px]">{rgb.g}</span>
                </div>
                {/* B */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 font-bold text-blue-500">B</span>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={rgb.b}
                    onChange={(e) => handleRgbSlider('b', parseInt(e.target.value))}
                    className="flex-1 h-1 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="w-5 text-right font-mono text-[9px]">{rgb.b}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
