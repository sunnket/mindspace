/**
 * Connectors — the vocabulary, and the geometry that makes one look connected.
 *
 * A connection used to have exactly one look: a face-routed cubic. Nothing
 * else was reachable from the UI, so every relationship on a board — a
 * sequence, a dependency, a rough "these two are related" — was drawn with the
 * same wavy line, and the only way to say something different was not to draw
 * it at all.
 *
 * So a connector is now three independent choices, the way every diagram tool
 * worth using splits them:
 *
 *   · SHAPE  — how the line travels (curve / straight / elbow / arc / scribble),
 *              each with its own subtypes.
 *   · ENDS   — what sits at either tip (nothing, arrow, triangle, dot, …).
 *   · STROKE — ink, weight, dashes, and whether the dashes march.
 *
 * The thing they all share is ATTACHMENT, which is what actually made the old
 * connectors look wrong. Two rules here, applied to every shape:
 *
 *   1. A tip lands exactly ON the border of the card, never near it. Anchors
 *      are computed from the rect, not from a guessed clip.
 *   2. A line with no cap is pushed 1.6px UNDER the card, and a line with a
 *      solid cap is pulled back by exactly that cap's length. Connectors draw
 *      beneath the blocks, so the overlap hides — which kills the hairline gap
 *      you used to get at the seam, and stops a line poking out through the
 *      point of its own arrowhead.
 *
 * Everything is pure. The layer renders it, the options panel previews it with
 * the same functions on two toy rectangles, so a swatch cannot lie about what
 * you'll get.
 */

export type Side = 'l' | 'r' | 't' | 'b';
export interface Pt { x: number; y: number }
/** A block's box in world coordinates, with its centre precomputed. */
export interface Rect { x: number; y: number; width: number; height: number; cx: number; cy: number }

export type ConnectorShape = 'curve' | 'straight' | 'elbow' | 'arc' | 'scribble';
export type ConnectorCap = 'none' | 'arrow' | 'triangle' | 'dot' | 'diamond' | 'bar';
export type ConnectorDash = 'solid' | 'dashed' | 'dotted';

export interface ConnectorStyle {
  shape: ConnectorShape;
  /** Subtype within the shape — see `VARIANTS`. */
  variant: string;
  /** Elbow corners: rounded or mitred. Ignored by the other shapes. */
  rounded: boolean;
  startCap: ConnectorCap;
  endCap: ConnectorCap;
  dash: ConnectorDash;
  weight: number;
  /** `null` means "theme ink" — legible on both the light and dark canvas. */
  color: string | null;
  /** Marching dashes. Opt-in: it repaints the connection layer every frame. */
  flow: boolean;
  /** A word or two riding the middle of the line. */
  label: string;
}

export const DEFAULT_CONNECTOR: ConnectorStyle = {
  shape: 'curve',
  variant: 'soft',
  rounded: true,
  startCap: 'none',
  // A connection has a direction (fromId → toId); it may as well say so.
  endCap: 'arrow',
  dash: 'solid',
  weight: 2,
  color: null,
  flow: false,
  label: '',
};

/* ------------------------------------------------------------------ *
 * The pickable vocabulary (also drives the options panel)
 * ------------------------------------------------------------------ */

export const SHAPES: { key: ConnectorShape; label: string; hint: string }[] = [
  { key: 'curve', label: 'Curve', hint: 'Leaves and lands square to each card' },
  { key: 'straight', label: 'Straight', hint: 'The shortest line between the two' },
  { key: 'elbow', label: 'Elbow', hint: 'Right angles — reads like a diagram' },
  { key: 'arc', label: 'Arc', hint: 'One clean bow around whatever sits between' },
  { key: 'scribble', label: 'Scribble', hint: 'Drawn by hand, in pen' },
];

export const VARIANTS: Record<ConnectorShape, { key: string; label: string }[]> = {
  curve: [
    { key: 'taut', label: 'Taut' },
    { key: 'soft', label: 'Soft' },
    { key: 'deep', label: 'Deep' },
  ],
  straight: [
    { key: 'direct', label: 'Direct' },
    { key: 'square', label: 'Square' },
  ],
  elbow: [
    { key: 'auto', label: 'Auto' },
    { key: 'h', label: 'Across first' },
    { key: 'v', label: 'Down first' },
  ],
  arc: [
    { key: 'right', label: 'Bow out' },
    { key: 'left', label: 'Bow back' },
    { key: 'wide', label: 'Wide' },
  ],
  scribble: [
    { key: 'calm', label: 'Calm' },
    { key: 'lively', label: 'Lively' },
  ],
};

export const DEFAULT_VARIANT: Record<ConnectorShape, string> = {
  curve: 'soft',
  straight: 'direct',
  elbow: 'auto',
  arc: 'right',
  scribble: 'calm',
};

export const CAPS: { key: ConnectorCap; label: string }[] = [
  { key: 'none', label: 'Plain' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'triangle', label: 'Solid' },
  { key: 'dot', label: 'Dot' },
  { key: 'diamond', label: 'Diamond' },
  { key: 'bar', label: 'Bar' },
];

export const WEIGHTS: { key: number; label: string }[] = [
  { key: 1.4, label: 'Fine' },
  { key: 2, label: 'Medium' },
  { key: 3.2, label: 'Bold' },
];

export const DASHES: { key: ConnectorDash; label: string }[] = [
  { key: 'solid', label: 'Solid' },
  { key: 'dashed', label: 'Dashed' },
  { key: 'dotted', label: 'Dotted' },
];

/** Inks that hold up on both the warm-paper and the dark canvas. */
export const INKS: { key: string | null; label: string; css: string }[] = [
  { key: null, label: 'Ink', css: 'var(--connector-ink)' },
  { key: '#C97B4B', label: 'Clay', css: '#C97B4B' },
  { key: '#D64541', label: 'Red', css: '#D64541' },
  { key: '#E0A030', label: 'Amber', css: '#E0A030' },
  { key: '#2F9E68', label: 'Green', css: '#2F9E68' },
  { key: '#3E63DD', label: 'Blue', css: '#3E63DD' },
  { key: '#8156C9', label: 'Violet', css: '#8156C9' },
];

/* ------------------------------------------------------------------ *
 * Reading a stored style back
 * ------------------------------------------------------------------ */

const isShape = (v: unknown): v is ConnectorShape =>
  typeof v === 'string' && SHAPES.some((s) => s.key === v);
const isCap = (v: unknown): v is ConnectorCap =>
  typeof v === 'string' && CAPS.some((c) => c.key === v);
const isDash = (v: unknown): v is ConnectorDash =>
  typeof v === 'string' && DASHES.some((d) => d.key === v);

/**
 * Turn a connection's loose `style` bag into a complete, valid connector.
 *
 * It also speaks the two dialects that predate this file: `style.straight`
 * (the old opt-out from smart routing) and `style.isWorkflowConnection` (a
 * workflow branch, which has always been a clay arrow with marching dashes).
 * Old boards therefore keep the look they were drawn with.
 */
export function resolveConnector(
  style: Record<string, unknown> | undefined,
  opts: { workflow?: boolean } = {},
): ConnectorStyle {
  const s = style || {};
  const workflow = !!opts.workflow || !!s.isWorkflowConnection;

  const shape: ConnectorShape = isShape(s.shape)
    ? s.shape
    : s.straight === true
      ? 'straight'
      : DEFAULT_CONNECTOR.shape;

  const variants = VARIANTS[shape];
  const variant =
    typeof s.variant === 'string' && variants.some((v) => v.key === s.variant)
      ? s.variant
      : DEFAULT_VARIANT[shape];

  const weight = typeof s.weight === 'number' && s.weight > 0 ? s.weight : workflow ? 2.2 : DEFAULT_CONNECTOR.weight;

  return {
    shape,
    variant,
    rounded: typeof s.rounded === 'boolean' ? s.rounded : true,
    startCap: isCap(s.startCap) ? s.startCap : 'none',
    endCap: isCap(s.endCap) ? s.endCap : 'arrow',
    dash: isDash(s.dash) ? s.dash : workflow ? 'dashed' : 'solid',
    weight,
    color: typeof s.color === 'string' ? s.color : workflow ? '#C97B4B' : null,
    flow: typeof s.flow === 'boolean' ? s.flow : workflow,
    label: typeof s.label === 'string' ? s.label : '',
  };
}

/** Only the fields that differ from the defaults, for a compact `style` bag. */
export function connectorStyleToBag(cfg: ConnectorStyle): Record<string, unknown> {
  return {
    shape: cfg.shape,
    variant: cfg.variant,
    rounded: cfg.rounded,
    startCap: cfg.startCap,
    endCap: cfg.endCap,
    dash: cfg.dash,
    weight: cfg.weight,
    color: cfg.color,
    flow: cfg.flow,
    label: cfg.label,
  };
}

/* ------------------------------------------------------------------ *
 * Vector scratch
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const unit = (a: Pt, b: Pt): Pt => {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

export const rectOf = (o: { x: number; y: number; width: number; height: number }): Rect => ({
  x: o.x, y: o.y, width: o.width, height: o.height,
  cx: o.x + o.width / 2, cy: o.y + o.height / 2,
});

/* ------------------------------------------------------------------ *
 * Anchors
 * ------------------------------------------------------------------ */

/**
 * Which faces should this link use?
 *
 * Whichever axis the two blocks are actually separated on wins, with a bias
 * toward horizontal: cards sit side by side far more often than stacked, and
 * left→right reads as flow. The gap (not the centre distance) is what's
 * measured, so a tall card beside a short one doesn't read as "stacked" just
 * because it's tall. `prefer` lets an elbow subtype force the axis.
 */
export function chooseSides(a: Rect, b: Rect, prefer?: 'h' | 'v'): [Side, Side] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  let horizontal: boolean;
  if (prefer === 'h') horizontal = true;
  else if (prefer === 'v') horizontal = false;
  else {
    const gapX = Math.max(0, Math.abs(dx) - (a.width + b.width) / 2);
    const gapY = Math.max(0, Math.abs(dy) - (a.height + b.height) / 2);
    horizontal = gapX * 1.35 >= gapY;
  }
  if (horizontal) return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
  return dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

interface Anchor extends Pt { nx: number; ny: number }

/**
 * Where on that face to sit. `spread` slides the anchor along the face so
 * several links leaving one block fan out across it instead of piling onto its
 * midpoint. Clamped to the middle 70% so a tip never lands on a corner radius.
 */
function anchorOn(r: Rect, side: Side, spread: number): Anchor {
  const t = clamp(spread, -0.35, 0.35);
  switch (side) {
    case 'l': return { x: r.x, y: r.cy + r.height * t, nx: -1, ny: 0 };
    case 'r': return { x: r.x + r.width, y: r.cy + r.height * t, nx: 1, ny: 0 };
    case 't': return { x: r.cx + r.width * t, y: r.y, nx: 0, ny: -1 };
    default: return { x: r.cx + r.width * t, y: r.y + r.height, nx: 0, ny: 1 };
  }
}

/** Where the ray from the rect's centre toward `towards` crosses its border. */
function borderPoint(r: Rect, towards: Pt): Anchor {
  const dx = towards.x - r.cx;
  const dy = towards.y - r.cy;
  if (dx === 0 && dy === 0) return { x: r.cx, y: r.cy, nx: 1, ny: 0 };
  const tx = Math.abs(r.width / 2 / (dx || 1e-6));
  const ty = Math.abs(r.height / 2 / (dy || 1e-6));
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy) || 1;
  return { x: r.cx + dx * t, y: r.cy + dy * t, nx: dx / len, ny: dy / len };
}

/* ------------------------------------------------------------------ *
 * Caps
 * ------------------------------------------------------------------ */

/** How big a cap is, in world px. Grows with the line so it never looks bolted on. */
export function capSize(weight: number): number {
  return 3.8 + weight * 2.1;
}

/**
 * How far INSIDE its block a tip sits.
 *
 * A block's object box is not where you see its edge: the card that paints the
 * border is inset from it by a couple of px (its own outline and shadow live in
 * that margin). Anchoring on the box therefore left a visible hairline between
 * the arrowhead and the card — measured at ~2.4px, and the exact thing that
 * makes a connector read as "nearly attached" rather than attached. So every
 * tip is sunk slightly past the box, which lands it a hair inside the painted
 * edge. Connectors draw beneath the blocks, so the overlap never shows.
 */
const EDGE_SINK = 2.5;

/**
 * How far back from the tip the LINE has to stop.
 *
 * Negative for a plain end — it tucks under the card so there's no seam.
 * Zero for the open shapes, whose vertex is the tip and which therefore want
 * the line running right into them. Positive for the solid ones, so the stroke
 * meets the back of the shape instead of splitting it.
 */
function capTrim(cap: ConnectorCap, weight: number): number {
  const s = capSize(weight);
  switch (cap) {
    case 'none': return -1.6;
    case 'arrow': return 0;
    case 'bar': return 0;
    case 'triangle': return s * 0.9;
    case 'diamond': return s * 1.05;
    case 'dot': return s * 0.6;
  }
}

export type CapGeom =
  | { kind: 'stroke'; d: string }
  | { kind: 'fill'; d: string }
  | { kind: 'dot'; cx: number; cy: number; r: number };

/**
 * The cap itself. `angle` is the direction of TRAVEL into the tip, so a start
 * cap simply passes the reversed tangent and gets a correctly mirrored shape.
 */
export function capGeom(cap: ConnectorCap, tip: Pt, angle: number, weight: number): CapGeom | null {
  if (cap === 'none') return null;
  const s = capSize(weight);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // px/py: the perpendicular. back: one cap-length upstream of the tip.
  const px = -dy;
  const py = dx;
  const back = (len: number): Pt => ({ x: tip.x - dx * len, y: tip.y - dy * len });
  const side = (p: Pt, half: number, sign: 1 | -1): Pt => ({ x: p.x + px * half * sign, y: p.y + py * half * sign });

  switch (cap) {
    case 'arrow': {
      const b = back(s * 0.95);
      const w1 = side(b, s * 0.6, 1);
      const w2 = side(b, s * 0.6, -1);
      return { kind: 'stroke', d: `M ${fmt(w1)} L ${fmt(tip)} L ${fmt(w2)}` };
    }
    case 'triangle': {
      const b = back(s * 0.9);
      const w1 = side(b, s * 0.44, 1);
      const w2 = side(b, s * 0.44, -1);
      return { kind: 'fill', d: `M ${fmt(tip)} L ${fmt(w1)} L ${fmt(w2)} Z` };
    }
    case 'diamond': {
      const mid = back(s * 0.52);
      const tail = back(s * 1.05);
      const w1 = side(mid, s * 0.4, 1);
      const w2 = side(mid, s * 0.4, -1);
      return { kind: 'fill', d: `M ${fmt(tip)} L ${fmt(w1)} L ${fmt(tail)} L ${fmt(w2)} Z` };
    }
    case 'dot': {
      const r = s * 0.36;
      const c = back(r * 0.85);
      return { kind: 'dot', cx: r2(c.x), cy: r2(c.y), r: r2(r) };
    }
    case 'bar': {
      const w1 = side(tip, s * 0.55, 1);
      const w2 = side(tip, s * 0.55, -1);
      return { kind: 'stroke', d: `M ${fmt(w1)} L ${fmt(w2)}` };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Stroke decoration
 * ------------------------------------------------------------------ */

/** Dash pattern in world px. `flow` forces a pattern so there's something to march. */
export function dashArray(cfg: ConnectorStyle): string | undefined {
  const w = Math.max(1, cfg.weight);
  if (cfg.dash === 'dashed') return `${r2(w * 3.6)} ${r2(w * 2.6)}`;
  if (cfg.dash === 'dotted') return `${r2(w * 0.01)} ${r2(w * 2.3)}`;
  return cfg.flow ? `${r2(w * 3.6)} ${r2(w * 2.6)}` : undefined;
}

/** One dash cycle, so the marching animation loops seamlessly. */
export function dashCycle(cfg: ConnectorStyle): number {
  const w = Math.max(1, cfg.weight);
  if (cfg.dash === 'dotted') return w * 2.31;
  return w * 6.2;
}

/* ------------------------------------------------------------------ *
 * Path builders
 * ------------------------------------------------------------------ */

export interface BuiltConnector {
  /** The stroked path, already trimmed for its caps. */
  d: string;
  /** Where the line starts / ends (trimmed). */
  start: Pt;
  end: Pt;
  /** Where the caps sit — exactly on each card's border. */
  tipStart: Pt;
  tipEnd: Pt;
  /** Travel direction leaving the start, and arriving at the end (radians). */
  startAngle: number;
  endAngle: number;
  /** Middle of the line, for the label and the hover controls. */
  mid: Pt;
  midAngle: number;
}

const CURVE_REACH: Record<string, number> = { taut: 0.2, soft: 0.42, deep: 0.8 };

function cubicPoint(p: Pt, c1: Pt, c2: Pt, q: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x,
    y: u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * q.y,
  };
}

function cubicTangent(p: Pt, c1: Pt, c2: Pt, q: Pt, t: number): number {
  const u = 1 - t;
  const x = 3 * u * u * (c1.x - p.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (q.x - c2.x);
  const y = 3 * u * u * (c1.y - p.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (q.y - c2.y);
  return Math.atan2(y, x);
}

/** Drop points that sit on top of each other, then flatten collinear runs. */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.4) out.push(p);
  }
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 0.5) { out.splice(i, 1); i--; }
  }
  return out;
}

/** A polyline, optionally with its corners rounded off. */
function polyPath(pts: Pt[], radius: number): string {
  if (pts.length < 2) return '';
  if (radius <= 0.5 || pts.length === 2) return `M ${pts.map(fmt).join(' L ')}`;
  let d = `M ${fmt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2);
    const a = lerp(cur, prev, r / (dist(prev, cur) || 1));
    const b = lerp(cur, next, r / (dist(cur, next) || 1));
    d += ` L ${fmt(a)} Q ${fmt(cur)} ${fmt(b)}`;
  }
  d += ` L ${fmt(pts[pts.length - 1])}`;
  return d;
}

/** The point half the total length along a polyline, and the heading there. */
function polyMid(pts: Pt[]): { mid: Pt; angle: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      return { mid: lerp(pts[i - 1], pts[i], t), angle: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) };
    }
    walked += seg;
  }
  return { mid: pts[pts.length - 1], angle: 0 };
}

/* --- seeded noise, so a scribble is the SAME scribble on every render --- */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom through every point, emitted as cubics. */
function smoothThrough(pts: Pt[]): string {
  if (pts.length < 3) return `M ${pts.map(fmt).join(' L ')}`;
  let d = `M ${fmt(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${fmt(c1)}, ${fmt(c2)}, ${fmt(p2)}`;
  }
  return d;
}

export interface Fan { from: number; to: number }
const NO_FAN: Fan = { from: 0, to: 0 };

/**
 * Build one connector between two boxes.
 *
 * `fan` slides each end along its face so siblings don't stack (the layer
 * computes it for the whole board at once — a link can only know where to sit
 * relative to its neighbours). `seed` keeps a scribble stable across renders.
 */
export function buildConnector(
  a: Rect,
  b: Rect,
  cfg: ConnectorStyle,
  fan: Fan = NO_FAN,
  seed = 'x',
): BuiltConnector {
  const trimA = capTrim(cfg.startCap, cfg.weight);
  const trimB = capTrim(cfg.endCap, cfg.weight);

  /* Every shape resolves to: two anchors on the borders (the cap tips), the
     outward normal at each, and a path between the TRIMMED versions of them. */
  const finish = (
    rawA: Anchor, rawB: Anchor,
    build: (P: Pt, Q: Pt) => { d: string; startAngle: number; endAngle: number; mid: Pt; midAngle: number },
  ): BuiltConnector => {
    // Sink each anchor past the object box first; every trim is measured from
    // there, so a cap tip and a bare line end are both sunk by the same amount.
    const endA: Anchor = { ...rawA, x: rawA.x - rawA.nx * EDGE_SINK, y: rawA.y - rawA.ny * EDGE_SINK };
    const endB: Anchor = { ...rawB, x: rawB.x - rawB.nx * EDGE_SINK, y: rawB.y - rawB.ny * EDGE_SINK };
    const P = { x: endA.x + endA.nx * trimA, y: endA.y + endA.ny * trimA };
    const Q = { x: endB.x + endB.nx * trimB, y: endB.y + endB.ny * trimB };
    const built = build(P, Q);
    return {
      d: built.d,
      start: P,
      end: Q,
      tipStart: { x: endA.x, y: endA.y },
      tipEnd: { x: endB.x, y: endB.y },
      startAngle: built.startAngle,
      endAngle: built.endAngle,
      mid: built.mid,
      midAngle: built.midAngle,
    };
  };

  /* ---- Straight ---- */
  if (cfg.shape === 'straight') {
    if (cfg.variant === 'square') {
      // Face-anchored: fans with its siblings and leaves from a real side.
      const [sa, sb] = chooseSides(a, b);
      const pA = anchorOn(a, sa, fan.from);
      const pB = anchorOn(b, sb, fan.to);
      return finish(pA, pB, (P, Q) => {
        const ang = Math.atan2(Q.y - P.y, Q.x - P.x);
        return { d: `M ${fmt(P)} L ${fmt(Q)}`, startAngle: ang, endAngle: ang, mid: lerp(P, Q, 0.5), midAngle: ang };
      });
    }
    // Direct: centre to centre, clipped at both borders — the shortest line.
    const pA = borderPoint(a, { x: b.cx, y: b.cy });
    const pB = borderPoint(b, { x: a.cx, y: a.cy });
    return finish(pA, pB, (P, Q) => {
      const ang = Math.atan2(Q.y - P.y, Q.x - P.x);
      return { d: `M ${fmt(P)} L ${fmt(Q)}`, startAngle: ang, endAngle: ang, mid: lerp(P, Q, 0.5), midAngle: ang };
    });
  }

  /* ---- Arc ---- */
  if (cfg.shape === 'arc') {
    const bowAmt = cfg.variant === 'wide' ? 0.42 : 0.22;
    const sign = cfg.variant === 'left' ? -1 : 1;
    const span = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
    const dirX = (b.cx - a.cx) / span;
    const dirY = (b.cy - a.cy) / span;
    // Control point off the centre line; both ends then aim AT it, so the arc
    // genuinely leaves and lands on the borders it touches.
    const ctrl: Pt = {
      x: (a.cx + b.cx) / 2 + -dirY * span * bowAmt * sign,
      y: (a.cy + b.cy) / 2 + dirX * span * bowAmt * sign,
    };
    const pA = borderPoint(a, ctrl);
    const pB = borderPoint(b, ctrl);
    return finish(pA, pB, (P, Q) => ({
      d: `M ${fmt(P)} Q ${fmt(ctrl)} ${fmt(Q)}`,
      startAngle: Math.atan2(ctrl.y - P.y, ctrl.x - P.x),
      endAngle: Math.atan2(Q.y - ctrl.y, Q.x - ctrl.x),
      mid: { x: 0.25 * P.x + 0.5 * ctrl.x + 0.25 * Q.x, y: 0.25 * P.y + 0.5 * ctrl.y + 0.25 * Q.y },
      midAngle: Math.atan2(Q.y - P.y, Q.x - P.x),
    }));
  }

  /* ---- Elbow ---- */
  if (cfg.shape === 'elbow') {
    const prefer = cfg.variant === 'h' ? 'h' : cfg.variant === 'v' ? 'v' : undefined;
    const [sa, sb] = chooseSides(a, b, prefer);
    const pA = anchorOn(a, sa, fan.from);
    const pB = anchorOn(b, sb, fan.to);
    const radius = cfg.rounded ? 14 : 0;

    return finish(pA, pB, (P, Q) => {
      const span = dist(P, Q);
      const stub = clamp(span * 0.18, 20, 54);
      const P1: Pt = { x: P.x + pA.nx * stub, y: P.y + pA.ny * stub };
      const Q1: Pt = { x: Q.x + pB.nx * stub, y: Q.y + pB.ny * stub };
      const pHoriz = pA.nx !== 0;
      const qHoriz = pB.nx !== 0;

      let mids: Pt[];
      if (pHoriz && qHoriz) {
        // Facing along the same axis: split the gap. If the stubs have already
        // crossed (the boxes overlap on this axis) a split would double back
        // through the card, so step around on the other axis instead.
        const forward = (Q1.x - P1.x) * pA.nx > 0;
        if (forward) {
          const mx = (P1.x + Q1.x) / 2;
          mids = [{ x: mx, y: P1.y }, { x: mx, y: Q1.y }];
        } else {
          const my = (P1.y + Q1.y) / 2;
          mids = [{ x: P1.x, y: my }, { x: Q1.x, y: my }];
        }
      } else if (!pHoriz && !qHoriz) {
        const forward = (Q1.y - P1.y) * pA.ny > 0;
        if (forward) {
          const my = (P1.y + Q1.y) / 2;
          mids = [{ x: P1.x, y: my }, { x: Q1.x, y: my }];
        } else {
          const mx = (P1.x + Q1.x) / 2;
          mids = [{ x: mx, y: P1.y }, { x: mx, y: Q1.y }];
        }
      } else if (pHoriz) {
        // One corner if both legs run the way their faces point; otherwise
        // take the corner on the other side, which always resolves.
        const c1: Pt = { x: Q1.x, y: P1.y };
        const legOk = (c1.x - P1.x) * pA.nx > 0 && (Q1.y - c1.y) * -pB.ny > 0;
        mids = legOk ? [c1] : [{ x: P1.x, y: Q1.y }];
      } else {
        const c1: Pt = { x: P1.x, y: Q1.y };
        const legOk = (c1.y - P1.y) * pA.ny > 0 && (Q1.x - c1.x) * -pB.nx > 0;
        mids = legOk ? [c1] : [{ x: Q1.x, y: P1.y }];
      }

      const pts = tidy([P, P1, ...mids, Q1, Q]);
      const { mid, angle } = polyMid(pts);
      const first = unit(pts[0], pts[1] || pts[0]);
      const lastA = pts[pts.length - 2] || pts[0];
      const last = unit(lastA, pts[pts.length - 1]);
      return {
        d: polyPath(pts, radius),
        startAngle: Math.atan2(first.y, first.x),
        endAngle: Math.atan2(last.y, last.x),
        mid,
        midAngle: angle,
      };
    });
  }

  /* ---- Curve & Scribble (both ride the same face-routed cubic) ---- */
  const [sa, sb] = chooseSides(a, b);
  const pA = anchorOn(a, sa, fan.from);
  const pB = anchorOn(b, sb, fan.to);

  return finish(pA, pB, (P, Q) => {
    const span = dist(P, Q);
    const factor = CURVE_REACH[cfg.shape === 'scribble' ? 'soft' : cfg.variant] ?? 0.42;
    /* How far the curve runs straight out of each face before it turns.
       Proportional to the span so short links stay taut and long ones bow
       gracefully; floored so touching cards still leave squarely, capped so a
       link across the whole board doesn't balloon. */
    const reach = clamp(span * factor, 24, cfg.variant === 'deep' ? 300 : 160);
    const c1: Pt = { x: P.x + pA.nx * reach, y: P.y + pA.ny * reach };
    const c2: Pt = { x: Q.x + pB.nx * reach, y: Q.y + pB.ny * reach };

    const startAngle = Math.atan2(c1.y - P.y, c1.x - P.x);
    const endAngle = Math.atan2(Q.y - c2.y, Q.x - c2.x);
    const mid = cubicPoint(P, c1, c2, Q, 0.5);
    const midAngle = cubicTangent(P, c1, c2, Q, 0.5);

    if (cfg.shape !== 'scribble') {
      return { d: `M ${fmt(P)} C ${fmt(c1)}, ${fmt(c2)}, ${fmt(Q)}`, startAngle, endAngle, mid, midAngle };
    }

    /* A scribble is that same curve, walked in steps and nudged sideways by
       seeded noise. The two ENDS are left untouched: a hand-drawn line still
       has to meet the card it points at. */
    const amp = cfg.variant === 'lively' ? 6.2 : 3;
    const steps = Math.round(clamp(span / 24, 6, 22));
    const rnd = mulberry32(hash32(seed));
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = cubicPoint(P, c1, c2, Q, t);
      if (i === 0 || i === steps) { pts.push(at); continue; }
      const tan = cubicTangent(P, c1, c2, Q, t);
      // Taper the wobble toward both ends so it eases into the attachment.
      const taper = Math.sin(Math.PI * t);
      const off = (rnd() * 2 - 1) * amp * taper;
      const along = (rnd() * 2 - 1) * amp * 0.5 * taper;
      pts.push({
        x: at.x + -Math.sin(tan) * off + Math.cos(tan) * along,
        y: at.y + Math.cos(tan) * off + Math.sin(tan) * along,
      });
    }
    const scribbleMid = pts[Math.floor(pts.length / 2)];
    return { d: smoothThrough(pts), startAngle, endAngle, mid: scribbleMid, midAngle };
  });
}

/**
 * A true-to-life miniature, for the options panel. It runs the REAL builder on
 * two toy cards inside the given box, so a swatch can't drift from what the
 * board will draw.
 */
export function previewConnector(
  cfg: ConnectorStyle,
  w = 54,
  h = 34,
): { built: BuiltConnector; a: Rect; b: Rect; weight: number } {
  const bw = 13;
  const bh = 10;
  const a = rectOf({ x: 2, y: h - bh - 3, width: bw, height: bh });
  const b = rectOf({ x: w - bw - 2, y: 3, width: bw, height: bh });
  const weight = Math.max(1.1, cfg.weight * 0.62);
  return { built: buildConnector(a, b, { ...cfg, weight }, NO_FAN, 'preview'), a, b, weight };
}
