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
    });
    return getSvgPathFromStroke(renderedStroke);
  }, [stroke.points, stroke.size]);

  return (
    <path
      d={pathData}
      fill={stroke.color}
      opacity={stroke.isHighlighter ? 0.35 : 0.9}
      style={{
        pointerEvents: 'none',
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

      setCurrentPoints([[x, y, e.pressure || 0.5]]);
      svg.setPointerCapture(e.pointerId);
    },
    [mode, camera, eraserMode, eraseAtPosition]
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

      setCurrentPoints((prev) => [...(prev || []), [x, y, e.pressure || 0.5]]);
    },
    [mode, camera, eraserMode, isErasing, currentPoints, eraseAtPosition]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const svg = svgRef.current;
      if (svg) {
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch (err) {}
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
        };
        addStroke(newStroke);
      }

      setCurrentPoints(null);
    },
    [drawColor, drawSize, addStroke, currentPoints, eraserMode, highlighterMode]
  );

  const currentStrokePath = useMemo(() => {
    if (!currentPoints || currentPoints.length < 2) return '';
    const stroke = getStroke(currentPoints, {
      ...STROKE_OPTIONS,
      size: drawSize,
    });
    return getSvgPathFromStroke(stroke);
  }, [currentPoints, drawSize]);

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
              opacity={highlighterMode ? 0.35 : 0.8}
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      </svg>

      {/* Circular Eraser Preview Cursor */}
      {eraserMode && eraserPos && (
        <div
          className="fixed pointer-events-none z-[10000] rounded-full border-2 border-[var(--accent)] bg-[rgba(201,123,75,0.18)] flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
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
