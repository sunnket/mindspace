/**
 * Text on a path — the geometry half.
 *
 * A path-text block is an ordinary `text` object carrying `style.textPath`.
 * That choice is the whole architecture: it drags, resizes, deletes, syncs in
 * collab, exports and undoes exactly like every other block, and only its
 * RENDERING is different. A new `type` would have meant teaching thirty call
 * sites about a thirty-first kind of thing.
 *
 * Two decisions worth knowing before you change anything here:
 *
 *  1. Control points are NORMALISED (0..1 inside the block's box). Resizing the
 *     block therefore scales the curve for free — store them in px and the text
 *     detaches from its line the first time someone drags a corner.
 *
 *  2. We do NOT use SVG `<textPath>`. It cannot give per-letter delays, honest
 *     3D extrusion in a fixed light direction, or a letter-spacing that means
 *     the same thing in every browser. Instead we sample the curve ourselves,
 *     measure each glyph with a 2D canvas, and place every character at its own
 *     point + tangent. Everything downstream (animation, depth, above/on/below)
 *     falls out of having a real position and angle per letter.
 */

export type PathAlign = 'above' | 'on' | 'below';
export type PathCurve = 'smooth' | 'sharp';
export type PathAnchor = 'start' | 'middle' | 'end';
export type GuideStyle = 'off' | 'solid' | 'dashed' | 'dotted';

export interface PathPoint { x: number; y: number }

/** Extruded-solid settings. `depth: 0` means flat. */
export interface TextPath3D {
  depth: number;        // 0–24 — how many px the solid is pushed back
  angle: number;        // 0–360° — which way it's pushed (the light direction)
  color?: string;       // side colour; derived from the ink when absent
  tiltX: number;        // -60..60 — the whole plaque leaning back/forward
  tiltY: number;        // -60..60 — …and turning left/right
  perspective: number;  // 300–2400 — how strong that lean reads
  shine: boolean;       // a highlight pass over the face
}

export interface TextPathAnim { preset: string; speed: number }

export interface TextPathConfig {
  points: PathPoint[];
  curve: PathCurve;
  closed: boolean;
  align: PathAlign;
  /** Extra distance from the line, in px. Positive pushes further out. */
  offset: number;
  /** Where the run starts, as a % of the curve. */
  startOffset: number;
  /** Extra px between letters. Negative tightens. */
  spacing: number;
  /** Extra px between words, on top of the space glyph. */
  wordSpacing: number;
  reversed: boolean;
  /** Spread (or tighten) the letters so the run fills the whole curve. */
  fit: boolean;
  anchor: PathAnchor;
  guide: GuideStyle;
  guideColor?: string;
  guideWidth: number;
  /** The preset this curve came from; '' once it's been hand-edited. */
  shape: string;
  three?: TextPath3D;
  anim?: TextPathAnim;
}

export const DEFAULT_3D: TextPath3D = {
  depth: 0, angle: 135, tiltX: 0, tiltY: 0, perspective: 900, shine: false,
};

export function defaultTextPath(patch: Partial<TextPathConfig> = {}): TextPathConfig {
  return {
    points: [{ x: 0.04, y: 0.72 }, { x: 0.34, y: 0.2 }, { x: 0.66, y: 0.8 }, { x: 0.96, y: 0.3 }],
    curve: 'smooth',
    closed: false,
    align: 'above',
    offset: 0,
    startOffset: 0,
    spacing: 0,
    wordSpacing: 0,
    reversed: false,
    fit: false,
    anchor: 'middle',
    guide: 'off',
    guideWidth: 1.5,
    shape: '',
    three: { ...DEFAULT_3D },
    anim: undefined,
    ...patch,
  };
}

/** A stored config from any earlier version, filled out to today's shape. */
export function readTextPath(raw: unknown): TextPathConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TextPathConfig>;
  if (!Array.isArray(r.points) || r.points.length < 2) return null;
  const base = defaultTextPath();
  return {
    ...base,
    ...r,
    points: r.points.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
    three: r.three ? { ...DEFAULT_3D, ...r.three } : { ...DEFAULT_3D },
  };
}

/* ---------------------------------------------------------------- curve -- */

/** Normalised points → px points inside a w×h box, in draw order. */
export function toBox(cfg: TextPathConfig, w: number, h: number): PathPoint[] {
  const pts = cfg.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  return cfg.reversed ? pts.reverse() : pts;
}

/**
 * A Catmull-Rom spline through every point, emitted as cubic béziers.
 *
 * Through, not near: a curve you drew by dropping four dots has to actually
 * touch those four dots, or the handles you drag stop being the thing you're
 * dragging.
 */
export function splineD(pts: PathPoint[], closed: boolean, tension = 1): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const at = (i: number) => {
    if (closed) return pts[(i + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };

  let d = `M ${pts[0].x} ${pts[0].y}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const k = tension / 6;
    const c1x = p1.x + (p2.x - p0.x) * k;
    const c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k;
    const c2y = p2.y - (p3.y - p1.y) * k;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  if (closed) d += ' Z';
  return d;
}

export function polylineD(pts: PathPoint[], closed: boolean): string {
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  if (closed) d += ' Z';
  return d;
}

/** The `d` this config draws inside a w×h box. */
export function pathD(cfg: TextPathConfig, w: number, h: number): string {
  const pts = toBox(cfg, w, h);
  return cfg.curve === 'sharp' ? polylineD(pts, cfg.closed) : splineD(pts, cfg.closed);
}

/* --------------------------------------------------------------- sample -- */

export interface PathSample {
  /** Densely sampled points along the curve. */
  xs: Float64Array;
  ys: Float64Array;
  /** Cumulative arc length at each sample. */
  cum: Float64Array;
  total: number;
}

function cubic(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p1;
}

/**
 * Walk the curve at a fixed resolution and remember how far along each step is.
 * Everything else (where does letter 7 sit, which way is it facing, how long is
 * the line) is a lookup in this table, so it's built once per render.
 */
export function samplePath(cfg: TextPathConfig, w: number, h: number, perSegment = 24): PathSample {
  const pts = toBox(cfg, w, h);
  const n = pts.length;
  const out: number[] = [];

  const push = (x: number, y: number) => { out.push(x, y); };

  if (n < 2) {
    push(pts[0]?.x ?? 0, pts[0]?.y ?? 0);
  } else if (cfg.curve === 'sharp') {
    for (const p of pts) push(p.x, p.y);
    if (cfg.closed) push(pts[0].x, pts[0].y);
  } else if (n === 2) {
    for (let i = 0; i <= perSegment; i++) {
      const t = i / perSegment;
      push(pts[0].x + (pts[1].x - pts[0].x) * t, pts[0].y + (pts[1].y - pts[0].y) * t);
    }
  } else {
    const at = (i: number) => (cfg.closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const segs = cfg.closed ? n : n - 1;
    push(pts[0].x, pts[0].y);
    for (let s = 0; s < segs; s++) {
      const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
      const k = 1 / 6;
      const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
      const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
      for (let i = 1; i <= perSegment; i++) {
        const t = i / perSegment;
        push(cubic(p1.x, c1x, c2x, p2.x, t), cubic(p1.y, c1y, c2y, p2.y, t));
      }
    }
  }

  const count = out.length / 2;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const cum = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = out[i * 2];
    ys[i] = out[i * 2 + 1];
    if (i > 0) {
      cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
  }
  return { xs, ys, cum, total: count ? cum[count - 1] : 0 };
}

export interface PathPose { x: number; y: number; deg: number }

/** Where the curve is `s` px in — position and heading. */
export function poseAt(sample: PathSample, s: number): PathPose {
  const { xs, ys, cum, total } = sample;
  const n = xs.length;
  if (n === 0) return { x: 0, y: 0, deg: 0 };
  if (n === 1) return { x: xs[0], y: ys[0], deg: 0 };

  const clamped = Math.max(0, Math.min(total, s));
  // Binary search the cumulative table — a linear scan here is O(chars × samples).
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const t = (clamped - cum[lo]) / segLen;
  const x = xs[lo] + (xs[hi] - xs[lo]) * t;
  const y = ys[lo] + (ys[hi] - ys[lo]) * t;
  const deg = (Math.atan2(ys[hi] - ys[lo], xs[hi] - xs[lo]) * 180) / Math.PI;
  return { x, y, deg };
}

/* -------------------------------------------------------------- measure -- */

let measureCtx: CanvasRenderingContext2D | null = null;
const advanceCache = new Map<string, number>();

/** One glyph's advance width, cached per (font, char). */
export function glyphWidth(ch: string, font: string): number {
  const key = `${font} ${ch}`;
  const hit = advanceCache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return 0;
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  if (!measureCtx) return 0;
  measureCtx.font = font;
  const w = measureCtx.measureText(ch).width;
  if (advanceCache.size > 4000) advanceCache.clear();
  advanceCache.set(key, w);
  return w;
}

export function cssFont(size: number, weight: number, family: string): string {
  return `${weight || 400} ${size}px ${family}`;
}

/* --------------------------------------------------------------- layout -- */

export interface Glyph {
  ch: string;
  /** Index in the source string — drives per-letter animation delays. */
  i: number;
  x: number;
  y: number;
  deg: number;
  /** Distance along the curve, kept so animations can travel. */
  s: number;
}

export interface GlyphRun {
  glyphs: Glyph[];
  /** Baseline shift along the letter's own normal. */
  dy: number;
  /** Total length of the set text, in px. */
  runLength: number;
  pathLength: number;
  /** True when the text is longer than the curve it has to sit on. */
  overflows: boolean;
}

/**
 * Place every character on the curve.
 *
 * `dy` is applied in each letter's ROTATED frame, which is what makes
 * above / on / below mean "away from the line" on a curve rather than "up the
 * screen" — a letter halfway round a circle has its own idea of up.
 */
export function layoutGlyphs(
  text: string,
  cfg: TextPathConfig,
  sample: PathSample,
  fontSize: number,
  font: string,
): GlyphRun {
  const chars = Array.from(text);
  const total = sample.total;

  const advances = chars.map((ch) => {
    const base = glyphWidth(ch, font) || fontSize * 0.5;
    return base + cfg.spacing + (ch === ' ' ? cfg.wordSpacing : 0);
  });
  let runLength = advances.reduce((a, b) => a + b, 0);

  /* Fit: hand the leftover curve out equally between the letters — or take the
     overflow back the same way. One rule covers both, which is why a line that
     is too long for its curve tightens instead of running off the end. */
  const natural = runLength;
  if (cfg.fit && total > 0 && chars.length > 1) {
    const extra = (total - runLength) / chars.length;
    for (let i = 0; i < advances.length; i++) advances[i] += extra;
    runLength = total;
  }

  let start =
    cfg.anchor === 'start' ? 0
    : cfg.anchor === 'end' ? total - runLength
    : (total - runLength) / 2;
  start += (cfg.startOffset / 100) * total;

  const glyphs: Glyph[] = [];
  let cursor = start;
  for (let i = 0; i < chars.length; i++) {
    const adv = advances[i];
    const centre = cursor + adv / 2;
    cursor += adv;
    if (chars[i] === ' ') continue;             // no node for whitespace
    // A closed curve wraps; an open one lets the tails run off the ends, which
    // reads better than piling letters up at the last point.
    const s = cfg.closed && total > 0 ? ((centre % total) + total) % total : centre;
    const pose = poseAt(sample, s);
    glyphs.push({ ch: chars[i], i, x: pose.x, y: pose.y, deg: pose.deg, s });
  }

  const dy =
    cfg.align === 'on' ? fontSize * 0.34 - cfg.offset
    : cfg.align === 'below' ? fontSize * 0.9 + cfg.offset
    : -cfg.offset;                               // 'above' — baseline on the line

  return { glyphs, dy, runLength, pathLength: total, overflows: natural > total + 1 };
}

/* --------------------------------------------------------------- shapes -- */

export interface PathShape {
  id: string;
  name: string;
  points: PathPoint[];
  closed?: boolean;
  curve?: PathCurve;
  /** A sensible default for where text sits on this particular curve. */
  align?: PathAlign;
}

const circlePts = (n: number, rx: number, ry: number, cx = 0.5, cy = 0.5, phase = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });

/* Angles are in SVG space, where y grows DOWNWARDS — so π → 2π sweeps over the
   top (a dome) and π → 0 sweeps under (a bowl). Getting these the wrong way
   round is the classic way to ship an "arch" that smiles. */
const arcPts = (n: number, rx: number, ry: number, from: number, to: number, cx = 0.5, cy = 0.5) =>
  Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / (n - 1);
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });

/** The catalogue behind the Shape tab. Order is the order they're shown in. */
export const PATH_SHAPES: PathShape[] = [
  { id: 'line', name: 'Line', points: [{ x: 0.03, y: 0.5 }, { x: 0.97, y: 0.5 }] },
  { id: 'slope', name: 'Slope', points: [{ x: 0.04, y: 0.78 }, { x: 0.96, y: 0.22 }] },
  { id: 'arch', name: 'Arch', points: arcPts(9, 0.46, 0.4, Math.PI, 2 * Math.PI, 0.5, 0.82) },
  { id: 'valley', name: 'Valley', points: arcPts(9, 0.46, 0.4, Math.PI, 0, 0.5, 0.18), align: 'below' },
  { id: 'wave', name: 'Wave', points: [{ x: 0.03, y: 0.66 }, { x: 0.28, y: 0.28 }, { x: 0.55, y: 0.72 }, { x: 0.81, y: 0.32 }, { x: 0.97, y: 0.5 }] },
  {
    id: 'ripple', name: 'Ripple',
    points: Array.from({ length: 13 }, (_, i) => ({ x: 0.03 + (i / 12) * 0.94, y: 0.5 + Math.sin((i / 12) * Math.PI * 4) * 0.22 })),
  },
  { id: 'circle', name: 'Circle', points: circlePts(12, 0.42, 0.42), closed: true },
  { id: 'ellipse', name: 'Ellipse', points: circlePts(12, 0.46, 0.3), closed: true },
  { id: 'ring-in', name: 'Inner ring', points: circlePts(12, 0.42, 0.42).reverse(), closed: true, align: 'below' },
  { id: 'semi', name: 'Half circle', points: arcPts(9, 0.44, 0.44, Math.PI, 2 * Math.PI, 0.5, 0.76) },
  {
    id: 'spiral', name: 'Spiral',
    points: Array.from({ length: 26 }, (_, i) => {
      const t = i / 25;
      const a = -Math.PI / 2 + t * Math.PI * 3.6;
      const r = 0.06 + t * 0.4;
      return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r * 0.94 };
    }),
  },
  {
    id: 'zigzag', name: 'Zigzag', curve: 'sharp',
    points: Array.from({ length: 9 }, (_, i) => ({ x: 0.04 + (i / 8) * 0.92, y: i % 2 ? 0.26 : 0.74 })),
  },
  {
    id: 'stairs', name: 'Stairs', curve: 'sharp',
    points: [{ x: 0.04, y: 0.86 }, { x: 0.28, y: 0.86 }, { x: 0.28, y: 0.62 }, { x: 0.52, y: 0.62 }, { x: 0.52, y: 0.38 }, { x: 0.76, y: 0.38 }, { x: 0.76, y: 0.14 }, { x: 0.96, y: 0.14 }],
  },
  {
    id: 'heart', name: 'Heart', closed: true,
    points: Array.from({ length: 22 }, (_, i) => {
      const t = (i / 22) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return { x: 0.5 + x / 38, y: 0.48 - y / 34 };
    }),
  },
  {
    id: 'banner', name: 'Banner',
    points: [{ x: 0.03, y: 0.36 }, { x: 0.2, y: 0.6 }, { x: 0.5, y: 0.66 }, { x: 0.8, y: 0.6 }, { x: 0.97, y: 0.36 }],
  },
  {
    id: 'bump', name: 'Bump',
    points: [{ x: 0.03, y: 0.62 }, { x: 0.3, y: 0.6 }, { x: 0.5, y: 0.3 }, { x: 0.7, y: 0.6 }, { x: 0.97, y: 0.62 }],
  },
  {
    id: 'loop', name: 'Loop',
    points: [{ x: 0.04, y: 0.66 }, { x: 0.3, y: 0.66 }, { x: 0.46, y: 0.24 }, { x: 0.62, y: 0.62 }, { x: 0.74, y: 0.3 }, { x: 0.96, y: 0.46 }],
  },
  {
    id: 'triangle', name: 'Triangle', curve: 'sharp', closed: true,
    points: [{ x: 0.5, y: 0.06 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.9 }],
  },
  {
    id: 'box', name: 'Box', curve: 'sharp', closed: true,
    points: [{ x: 0.06, y: 0.1 }, { x: 0.94, y: 0.1 }, { x: 0.94, y: 0.9 }, { x: 0.06, y: 0.9 }],
  },
];

export function getShape(id: string): PathShape | undefined {
  return PATH_SHAPES.find((s) => s.id === id);
}

/** Swap the curve under a block for a preset, keeping every other setting. */
export function applyShape(cfg: TextPathConfig, id: string): TextPathConfig {
  const s = getShape(id);
  if (!s) return cfg;
  return {
    ...cfg,
    points: s.points.map((p) => ({ ...p })),
    closed: !!s.closed,
    curve: s.curve || 'smooth',
    align: s.align || cfg.align,
    shape: id,
    reversed: false,
  };
}

/* ------------------------------------------------------------ animation -- */

export interface PathAnimPreset {
  id: string;
  name: string;
  hint: string;
  /** 'css' rides a keyframe per letter; 'travel' moves the run along the curve. */
  kind: 'css' | 'travel';
  /** ms between one letter and the next. */
  stagger?: number;
  /** ms for one cycle. */
  dur?: number;
  /** travel only: laps per minute, signed. */
  speed?: number;
}

export const PATH_ANIMS: PathAnimPreset[] = [
  { id: 'wave', name: 'Wave', hint: 'Letters rise and fall in sequence', kind: 'css', stagger: 70, dur: 1800 },
  { id: 'bounce', name: 'Bounce', hint: 'A ball-drop hop, one letter at a time', kind: 'css', stagger: 60, dur: 1400 },
  { id: 'breathe', name: 'Breathe', hint: 'The whole run swells and settles', kind: 'css', stagger: 26, dur: 2600 },
  { id: 'sway', name: 'Sway', hint: 'Each letter rocks on its own baseline', kind: 'css', stagger: 55, dur: 2200 },
  { id: 'pop', name: 'Pop in', hint: 'Letters land one after another', kind: 'css', stagger: 45, dur: 620 },
  { id: 'fade', name: 'Fade in', hint: 'A soft left-to-right reveal', kind: 'css', stagger: 55, dur: 900 },
  { id: 'drop', name: 'Drop in', hint: 'They fall onto the line', kind: 'css', stagger: 50, dur: 760 },
  { id: 'spin', name: 'Spin in', hint: 'Each letter twists into place', kind: 'css', stagger: 48, dur: 800 },
  { id: 'flicker', name: 'Neon flicker', hint: 'An old sign warming up', kind: 'css', stagger: 90, dur: 2400 },
  { id: 'shimmer', name: 'Shimmer', hint: 'A light runs along the run', kind: 'css', stagger: 60, dur: 2000 },
  { id: 'jitter', name: 'Jitter', hint: 'Restless, hand-drawn energy', kind: 'css', stagger: 37, dur: 700 },
  { id: 'travel', name: 'Orbit', hint: 'The text rides the curve', kind: 'travel', speed: 6 },
  { id: 'travel-back', name: 'Orbit back', hint: 'The same, the other way', kind: 'travel', speed: -6 },
];

export function getPathAnim(id?: string): PathAnimPreset | undefined {
  return id ? PATH_ANIMS.find((a) => a.id === id) : undefined;
}

/* ----------------------------------------------------------------- misc -- */

/** Darken a hex colour towards black — the side of an extruded letter. */
export function shade(hex: string, amount = 0.42): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 'rgba(0,0,0,0.45)';
  let body = m[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const n = parseInt(body, 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The bounding box of some world points, padded for the type that sits on it. */
export function fitBox(points: PathPoint[], pad: number) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return {
    x: minX,
    y: minY,
    width: Math.max(60, maxX - minX),
    height: Math.max(60, maxY - minY),
  };
}

/** World points → the normalised points a config stores, for a given box. */
export function normalizePoints(
  points: PathPoint[],
  box: { x: number; y: number; width: number; height: number },
): PathPoint[] {
  return points.map((p) => ({
    x: (p.x - box.x) / (box.width || 1),
    y: (p.y - box.y) / (box.height || 1),
  }));
}

/**
 * Thin a freehand stroke down to the handful of anchors a spline needs.
 * Ramer–Douglas–Peucker: keep the points that carry the shape, drop the ones
 * that only carry the hand's tremor.
 */
export function simplify(points: PathPoint[], tolerance = 4): PathPoint[] {
  if (points.length <= 2) return points;

  const sqTol = tolerance * tolerance;
  const sqSegDist = (p: PathPoint, a: PathPoint, b: PathPoint) => {
    let x = a.x, y = a.y;
    let dx = b.x - x, dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) { index = i; maxSq = sq; }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = points.filter((_, i) => keep[i]);
  // A spline with forty anchors is unusable in the handle editor; thin further.
  if (out.length > 24) {
    const step = out.length / 24;
    const thinned: PathPoint[] = [];
    for (let i = 0; i < 24; i++) thinned.push(out[Math.round(i * step)]);
    thinned.push(out[out.length - 1]);
    return thinned;
  }
  return out;
}
