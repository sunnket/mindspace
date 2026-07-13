'use client';

import React, { useRef, useCallback, useState, useMemo } from 'react';
import { getStroke } from 'perfect-freehand';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/store/canvasStore';
import { DrawingStroke } from '@/lib/db';

function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );

  d.push('Z');
  return d.join(' ');
}

const STROKE_OPTIONS = {
  size: 4,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => t,
  start: {
    taper: 0,
    cap: true,
  },
  end: {
    taper: 25,
    cap: true,
  },
};


const CanvasStroke = React.memo(({ stroke }: { stroke: DrawingStroke }) => {
  const pathData = React.useMemo(() => {
    const renderedStroke = getStroke(stroke.points, {
      ...STROKE_OPTIONS,
      size: stroke.size,
      thinning: stroke.pressure === false ? 0 : 0.5,
      smoothing: stroke.smoothing ?? 0.5,
      streamline: stroke.stabilization ?? 0.5,
    });
    return getSvgPathFromStroke(renderedStroke);
  }, [stroke.points, stroke.size, stroke.pressure, stroke.smoothing, stroke.stabilization]);

  const blurAmount = stroke.hardness !== undefined && stroke.hardness < 1
    ? (1 - stroke.hardness) * stroke.size * 0.35
    : 0;

  const opacityValue = (stroke.opacity ?? (stroke.isHighlighter ? 0.35 : 0.9)) * (stroke.flow ?? 1.0);

  const blurStr = blurAmount > 0 ? `blur(${blurAmount}px)` : '';
  const urlStr = stroke.texture && stroke.texture !== 'none' ? `url(#${stroke.texture}-texture)` : '';
  const filterVal = [blurStr, urlStr].filter(Boolean).join(' ') || 'none';

  return (
    <path
      d={pathData}
      fill={stroke.color}
      opacity={opacityValue}
      style={{
        pointerEvents: 'none',
        mixBlendMode: (stroke.blendMode || 'normal') as React.CSSProperties['mixBlendMode'],
        filter: filterVal,
      }}
    />
  );
});
CanvasStroke.displayName = 'CanvasStroke';

export default function DrawingLayer() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentPoints, setCurrentPoints] = useState<number[][] | null>(null);
  const [isErasing, setIsErasing] = useState(false);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);
  
  const mode = useCanvasStore((s) => s.mode);
  const camera = useCanvasStore((s) => s.camera);
  const strokes = useCanvasStore((s) => s.strokes);
  const setStrokes = useCanvasStore((s) => s.setStrokes);
  const addStroke = useCanvasStore((s) => s.addStroke);
  const drawColor = useCanvasStore((s) => s.drawColor);
  const drawSize = useCanvasStore((s) => s.drawSize);
  const eraserMode = useCanvasStore((s) => s.eraserMode);
  const highlighterMode = useCanvasStore((s) => s.highlighterMode);

  // New brush settings
  const drawOpacity = useCanvasStore((s) => s.drawOpacity);
  const drawFlow = useCanvasStore((s) => s.drawFlow);
  const drawHardness = useCanvasStore((s) => s.drawHardness);
  const drawStabilization = useCanvasStore((s) => s.drawStabilization);
  const drawPressure = useCanvasStore((s) => s.drawPressure);
  const drawSmoothing = useCanvasStore((s) => s.drawSmoothing);
  const drawTexture = useCanvasStore((s) => s.drawTexture);
  const drawBlendMode = useCanvasStore((s) => s.drawBlendMode);

  // Pixel-perfect point-by-point eraser collision detection and segment splitting
  const eraseAtPosition = useCallback((x: number, y: number) => {
    // Radius of the eraser is determined by the selected drawSize!
    const eraserRadius = drawSize * 1.5; 
    let anyErased = false;

    const nextStrokes = strokes.flatMap((stroke) => {
      const segments: number[][][] = [];
      let segment: number[][] = [];
      
      for (const p of stroke.points) {
        const dx = p[0] - x;
        const dy = p[1] - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= eraserRadius) {
          anyErased = true;
          // Finish the current segment if it has enough points to draw
          if (segment.length > 1) {
            segments.push(segment);
          }
          segment = [];
        } else {
          segment.push(p);
        }
      }
      
      if (segment.length > 1) {
        segments.push(segment);
      }
      
      if (segments.length === 0) {
        return []; // Entirely erased
      }
      
      return segments.map((seg, i) => ({
        id: i === 0 ? stroke.id : `${stroke.id}-${i}-${Date.now()}`,
        points: seg,
        color: stroke.color,
        size: stroke.size,
        createdAt: stroke.createdAt,
        isHighlighter: stroke.isHighlighter,
        opacity: stroke.opacity,
        flow: stroke.flow,
        hardness: stroke.hardness,
        stabilization: stroke.stabilization,
        pressure: stroke.pressure,
        smoothing: stroke.smoothing,
        texture: stroke.texture,
        blendMode: stroke.blendMode,
      }));
    });
    
    if (anyErased) {
      setStrokes(nextStrokes);
    }
  }, [strokes, drawSize, setStrokes]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== 'draw') return;
      
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left - camera.x) / camera.zoom;
      const y = (e.clientY - rect.top - camera.y) / camera.zoom;

      if (eraserMode) {
        setIsErasing(true);
        setEraserPos({ x: e.clientX, y: e.clientY });
        eraseAtPosition(x, y);
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const pressureVal = drawPressure ? (e.pressure || 0.5) : 0.5;
      setCurrentPoints([[x, y, pressureVal]]);
      svg.setPointerCapture(e.pointerId);
    },
    [mode, camera, eraserMode, eraseAtPosition, drawPressure]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== 'draw') return;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left - camera.x) / camera.zoom;
      const y = (e.clientY - rect.top - camera.y) / camera.zoom;

      if (eraserMode) {
        setEraserPos({ x: e.clientX, y: e.clientY });
        if (isErasing) {
          eraseAtPosition(x, y);
        }
        e.preventDefault();
        return;
      }

      if (!currentPoints) return;
      e.preventDefault();

      const pressureVal = drawPressure ? (e.pressure || 0.5) : 0.5;
      setCurrentPoints((prev) => [...(prev || []), [x, y, pressureVal]]);
    },
    [mode, camera, eraserMode, isErasing, currentPoints, eraseAtPosition, drawPressure]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const svg = svgRef.current;
      if (svg) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch {}
      }

      if (eraserMode) {
        setIsErasing(false);
        e.preventDefault();
        return;
      }

      if (!currentPoints) return;
      e.preventDefault();

      if (currentPoints.length > 1) {
        const newStroke: DrawingStroke = {
          id: uuidv4(),
          points: currentPoints,
          color: drawColor,
          size: drawSize,
          isHighlighter: highlighterMode,
          createdAt: Date.now(),
          opacity: drawOpacity,
          flow: drawFlow,
          hardness: drawHardness,
          stabilization: drawStabilization,
          pressure: drawPressure,
          smoothing: drawSmoothing,
          texture: drawTexture,
          blendMode: drawBlendMode,
        };
        addStroke(newStroke);
      }

      setCurrentPoints(null);
    },
    [drawColor, drawSize, addStroke, currentPoints, eraserMode, highlighterMode, drawOpacity, drawFlow, drawHardness, drawStabilization, drawPressure, drawSmoothing, drawTexture, drawBlendMode]
  );

  const currentStrokePath = useMemo(() => {
    if (!currentPoints || currentPoints.length < 2) return '';
    const stroke = getStroke(currentPoints, {
      ...STROKE_OPTIONS,
      size: drawSize,
      thinning: drawPressure ? 0.5 : 0,
      smoothing: drawSmoothing,
      streamline: drawStabilization,
    });
    return getSvgPathFromStroke(stroke);
  }, [currentPoints, drawSize, drawPressure, drawSmoothing, drawStabilization]);

  const activeBlurAmount = drawHardness < 1
    ? (1 - drawHardness) * drawSize * 0.35
    : 0;

  const activeBlurStr = activeBlurAmount > 0 ? `blur(${activeBlurAmount}px)` : '';
  const activeUrlStr = drawTexture !== 'none' ? `url(#${drawTexture}-texture)` : '';
  const activeFilterVal = [activeBlurStr, activeUrlStr].filter(Boolean).join(' ') || 'none';

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{
          pointerEvents: mode === 'draw' ? 'auto' : 'none',
          zIndex: mode === 'draw' ? 1000 : 5, // High z-index when drawing
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setEraserPos(null)}
      >
        <defs>
          {/* Chalk/Crayon Texture */}
          <filter id="chalk-texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {/* Watercolor Texture */}
          <filter id="watercolor-texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feGaussianBlur in="displaced" stdDeviation="1.5" />
          </filter>
          {/* Grainy Noise Texture */}
          <filter id="noise-texture" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" />
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.18 0" />
            <feComposite operator="in" in2="SourceGraphic" />
            <feBlend mode="multiply" in="SourceGraphic" />
          </filter>
          {/* Splatter Texture */}
          <filter id="splatter-texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" result="noise" />
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="highContrast" />
            <feComposite operator="in" in="SourceGraphic" in2="highContrast" />
          </filter>

          {/* Gradients */}
          <linearGradient id="sunset-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF512F" />
            <stop offset="100%" stopColor="#DD2476" />
          </linearGradient>
          <linearGradient id="ocean-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#02AAB0" />
            <stop offset="100%" stopColor="#00CDAC" />
          </linearGradient>
          <linearGradient id="fire-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F5576C" />
            <stop offset="100%" stopColor="#F08080" />
          </linearGradient>
          <linearGradient id="lavender-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a18cd1" />
            <stop offset="100%" stopColor="#fbc2eb" />
          </linearGradient>
          <linearGradient id="cosmic-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#30cfd0" />
            <stop offset="100%" stopColor="#330867" />
          </linearGradient>
        </defs>

        <g
          className="strokes-world"
          transform={`translate(${camera.x}, ${camera.y}) scale(${camera.zoom})`}
        >
          {/* Existing strokes */}
          {strokes.map((stroke) => (
            <CanvasStroke key={stroke.id} stroke={stroke} />
          ))}

          {/* Current drawing stroke */}
          {currentPoints && (
            <path
              d={currentStrokePath}
              fill={drawColor}
              opacity={drawOpacity * drawFlow}
              style={{
                pointerEvents: 'none',
                mixBlendMode: drawBlendMode as React.CSSProperties['mixBlendMode'],
                filter: activeFilterVal,
              }}
            />
          )}
        </g>
      </svg>

      {/* Circular Eraser Preview Cursor */}
      {eraserMode && eraserPos && (
        <div
          className="fixed pointer-events-none z-[10000] rounded-full border-2 border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.18)] flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
          style={{
            left: eraserPos.x,
            top: eraserPos.y,
            width: drawSize * 1.5 * 2 * camera.zoom,
            height: drawSize * 1.5 * 2 * camera.zoom,
          }}
        />
      )}
    </>
  );
}
