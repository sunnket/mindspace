/**
 * Instagram-story style "tap to cycle" shapes for image & camera-mirror blocks.
 *
 * A tap on a selected image/mirror advances it through this cycle. `original`
 * is the natural rectangle (no clip); every other entry is an SVG clip path
 * authored in objectBoundingBox units (0..1), so a single global <clipPath>
 * masks an image of any size — see ImageShapeClipDefs, rendered once by the
 * canvas. Geometry mirrors the vector shapes used by the `shape` block, scaled
 * from the 0–100 viewBox down to 0–1.
 */
import type { CSSProperties } from 'react';

export type ImageShape =
  | 'original'
  | 'heart'
  | 'star'
  | 'circle'
  | 'hexagon'
  | 'diamond'
  | 'triangle'
  | 'pentagon'
  | 'cloud'
  | 'blob';

/** The tap order. First tap → heart, second → star, and so on, wrapping back
 *  to the untouched rectangle after the last shape. */
export const IMAGE_SHAPE_CYCLE: ImageShape[] = [
  'original',
  'heart',
  'star',
  'circle',
  'hexagon',
  'diamond',
  'triangle',
  'pentagon',
  'cloud',
  'blob',
];

/** Friendly label shown in the tap hint. */
export const IMAGE_SHAPE_LABEL: Record<ImageShape, string> = {
  original: 'Original',
  heart: 'Heart',
  star: 'Star',
  circle: 'Circle',
  hexagon: 'Hexagon',
  diamond: 'Diamond',
  triangle: 'Triangle',
  pentagon: 'Pentagon',
  cloud: 'Cloud',
  blob: 'Blob',
};

/** Normalised clip geometry per shape (objectBoundingBox units). */
export const IMAGE_SHAPE_CLIP: Record<Exclude<ImageShape, 'original'>,
  { kind: 'path'; d: string } | { kind: 'polygon'; points: string } | { kind: 'circle' }> = {
  heart: { kind: 'path', d: 'M.5,.25 C.35,.05 .05,.05 .05,.42 C.05,.68 .45,.9 .5,.95 C.55,.9 .95,.68 .95,.42 C.95,.05 .65,.05 .5,.25 Z' },
  star: { kind: 'polygon', points: '.5,.02 .63,.35 .98,.35 .7,.57 .81,.91 .5,.7 .19,.91 .3,.57 .02,.35 .37,.35' },
  circle: { kind: 'circle' },
  hexagon: { kind: 'polygon', points: '.5,.02 .94,.27 .94,.73 .5,.98 .06,.73 .06,.27' },
  diamond: { kind: 'polygon', points: '.5,.02 .98,.5 .5,.98 .02,.5' },
  triangle: { kind: 'polygon', points: '.5,.02 .98,.96 .02,.96' },
  pentagon: { kind: 'polygon', points: '.5,.04 .96,.37 .78,.92 .22,.92 .04,.37' },
  cloud: { kind: 'path', d: 'M.25,.5 C.25,.35 .4,.25 .55,.25 C.7,.25 .85,.35 .85,.5 C.92,.5 .98,.56 .98,.63 C.98,.71 .92,.77 .85,.77 L.25,.77 C.15,.77 .08,.7 .08,.6 C.08,.51 .16,.45 .25,.5 Z' },
  blob: { kind: 'path', d: 'M.5,.04 C.71,.04 .88,.16 .93,.34 C.99,.53 .95,.73 .8,.86 C.66,.98 .43,1 .27,.9 C.11,.79 .03,.59 .07,.4 C.11,.21 .29,.04 .5,.04 Z' },
};

/** DOM id of the global <clipPath> for a shape. */
export function imageClipId(shape: ImageShape): string {
  return `imgclip-${shape}`;
}

/** Next shape in the tap cycle. */
export function nextImageShape(current: ImageShape | undefined): ImageShape {
  const idx = IMAGE_SHAPE_CYCLE.indexOf((current || 'original') as ImageShape);
  return IMAGE_SHAPE_CYCLE[(idx + 1 + IMAGE_SHAPE_CYCLE.length) % IMAGE_SHAPE_CYCLE.length];
}

/**
 * The CSS a shaped image/mirror needs: cover-fill + clip when a shape is set,
 * and a shape-following drop shadow so the mask never shows a rectangular
 * shadow behind it. `original` returns an empty object (keep default styling).
 */
export function imageShapeStyle(shape: ImageShape | undefined): CSSProperties {
  if (!shape || shape === 'original') return {};
  return {
    clipPath: `url(#${imageClipId(shape)})`,
    WebkitClipPath: `url(#${imageClipId(shape)})`,
    objectFit: 'cover',
    borderRadius: 0,
    filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.28))',
  } as CSSProperties;
}
