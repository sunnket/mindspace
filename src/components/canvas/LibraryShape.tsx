'use client';

import React from 'react';
import { SHAPE_LIBRARY } from '@/lib/shapeLibrary';

/**
 * The renderer for every DATA shape.
 *
 * The original 214 shapes are one hand-written `{shapeType === 'x' && <svg>…}`
 * block each inside the canvas renderer. That is a reasonable way to draw
 * twenty and an impossible way to draw two thousand, so the library is data and
 * this is the single branch that draws all of it — used by the canvas and by
 * the picker preview, so what you pick is exactly what you get.
 *
 * Two kinds live in here and they are drawn differently on purpose:
 *   • generated geometry is a closed path, so it takes the object's FILL and
 *     border exactly like the hand-written shapes do;
 *   • Lucide line art is open stroke work — filling it floods the outline and
 *     turns a rocket into a blob — so it draws stroke-only.
 */

/** One node of the DSL documented in shapeLibrary.ts. */
function node(part: string, i: number): React.ReactElement | null {
  const kind = part[0];
  const body = part.slice(1);
  const n = (s: string) => body.split(',').map(Number)[Number(s)];
  switch (kind) {
    case 'p':
      return <path key={i} d={body} />;
    case 'c':
      return <circle key={i} cx={n('0')} cy={n('1')} r={n('2')} />;
    case 'r':
      return <rect key={i} x={n('0')} y={n('1')} width={n('2')} height={n('3')} rx={n('4')} ry={n('5')} />;
    case 'l':
      return <line key={i} x1={n('0')} y1={n('1')} x2={n('2')} y2={n('3')} />;
    case 'e':
      return <ellipse key={i} cx={n('0')} cy={n('1')} rx={n('2')} ry={n('3')} />;
    case 'y':
      return <polyline key={i} points={body} />;
    case 'g':
      return <polygon key={i} points={body} />;
    default:
      return null;
  }
}

export function isLibraryShape(id: string | undefined): boolean {
  return !!id && !!SHAPE_LIBRARY[id];
}

/**
 * `strokeWidth` is in viewBox units, so it scales with the shape — which is what
 * the hand-written shapes do and what you want when you drag a shape bigger.
 * (`vectorEffect: non-scaling-stroke` was the wrong instinct here: it pins the
 * stroke to screen pixels, so a 400px shape comes out as a hairline.)
 *
 * The default differs by caller because the viewBox is only 24 units across:
 * Lucide's own 2 units is 8% of the shape, which is roughly four times heavier
 * than the hand-written catalogue's 2-in-100. The canvas asks for ~1.1 and the
 * picker, drawing at 22px where thin strokes disappear, asks for more.
 */
export default function LibraryShape({
  id, fill, stroke, strokeWidth = 1.1,
}: {
  id: string;
  fill: string;
  stroke: string;
  strokeWidth?: number;
}) {
  const shape = SHAPE_LIBRARY[id];
  if (!shape) return null;
  const solid = shape.f === 1;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      preserveAspectRatio="none"
      className="overflow-visible"
      fill={solid ? fill : 'none'}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape.d.split('~').map(node)}
    </svg>
  );
}
