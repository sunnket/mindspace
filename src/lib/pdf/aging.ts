/**
 * Aged paper — the marks, not the filter.
 *
 * The first version of this was one static overlay: six fixed radial gradients
 * and a sepia filter, identical on every page of every document. It read as a
 * texture laid over a viewer, because that is what it was — and the giveaway
 * was turning a page and watching the same six stains turn with it.
 *
 * Real foxing is per sheet. So every mark here is generated from the PAGE
 * NUMBER through a seeded generator: page 7 always has page 7's freckles, page
 * 8 has different ones, and neither changes between renders, reloads or
 * devices. Nothing is stored.
 *
 * The other thing that gives a fake stain away is its OUTLINE. A radial
 * gradient is a perfect ellipse; a tea ring is not. Every blot below is a
 * closed spline through radii that wander, so its edge is irregular the way a
 * liquid edge is — and it costs a path, not an SVG turbulence filter, because
 * four of those on screen during a page turn is a real frame budget.
 */

export type AgePreset = 'off' | 'touched' | 'foxed' | 'weathered' | 'antique';

export interface AgeCfg {
  preset: AgePreset;
  /** Global strength, 0.2–1. The same paper, more or less of it. */
  amount: number;
}

export const AGE_PRESETS: {
  id: AgePreset; label: string; blurb: string;
  /** Yellowing of the printed page itself. */
  sepia: number; warm: number;
  /** How many freckles, how many blots, and whether it has been folded. */
  fox: number; blots: number; creases: number;
  ring: boolean; edge: number; deckle: boolean;
}[] = [
  { id: 'off', label: 'Crisp', blurb: 'Off the press. No marks at all.',
    sepia: 0, warm: 0, fox: 0, blots: 0, creases: 0, ring: false, edge: 0, deckle: false },
  { id: 'touched', label: 'Read', blurb: 'Handled, thumbed, left in the sun a while.',
    sepia: 0.28, warm: 0.16, fox: 5, blots: 1, creases: 0, ring: false, edge: 0.3, deckle: false },
  { id: 'foxed', label: 'Foxed', blurb: 'The rust-coloured freckling old paper gets.',
    sepia: 0.46, warm: 0.28, fox: 26, blots: 2, creases: 1, ring: false, edge: 0.5, deckle: false },
  { id: 'weathered', label: 'Weathered', blurb: 'Damp once, dried badly. Water lines and a cup ring.',
    sepia: 0.58, warm: 0.4, fox: 18, blots: 5, creases: 3, ring: true, edge: 0.72, deckle: true },
  { id: 'antique', label: 'Antique', blurb: 'A century in a warm room. Burnt edges, deckle, the lot.',
    sepia: 0.72, warm: 0.55, fox: 40, blots: 7, creases: 4, ring: true, edge: 1, deckle: true },
];

export const agePresetOf = (id: AgePreset) => AGE_PRESETS.find((p) => p.id === id) || AGE_PRESETS[0];

/* ------------------------------------------------------------------ seed -- */

/** mulberry32 — small, fast, and identical everywhere. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- marks -- */

export interface Blot {
  /** Closed SVG path in a 0–100 × 0–100 box, so it scales with any page. */
  d: string;
  /** Centre + radius, for the gradient that fills it. */
  cx: number; cy: number; r: number;
  opacity: number;
  /** Rust for foxing, tea for a water blot. */
  tone: 'rust' | 'tea' | 'damp';
  blur: number;
}

export interface Crease {
  d: string;
  opacity: number;
}

export interface AgeMarks {
  fox: Blot[];
  blots: Blot[];
  ring: { cx: number; cy: number; r: number; opacity: number } | null;
  creases: Crease[];
  /** The wobble of a hand-cut edge, as a clip-path polygon. */
  deckle: string | null;
}

/**
 * A closed blob: a circle whose radius wanders, drawn as a Catmull-Rom spline
 * so the outline is smooth but never round.
 */
function blob(cx: number, cy: number, r: number, wobble: number, next: () => number, lobes = 9): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + next() * wobble);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (0.82 + next() * 0.36)]);
  }
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];
  let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i - 1), [x1, y1] = at(i), [x2, y2] = at(i + 1), [x3, y3] = at(i + 2);
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return `${d} Z`;
}

/**
 * Everything on page `n`, for this preset. Pure: same page in, same paper out.
 *
 * Marks avoid the middle third vertically where a caption or a heading usually
 * sits — not for legibility (they're faint), but because real damage comes in
 * from the edges and the corners, which is where a book is actually touched.
 */
export function ageMarks(page: number, cfg: AgeCfg): AgeMarks {
  const p = agePresetOf(cfg.preset);
  if (p.id === 'off') return { fox: [], blots: [], ring: null, creases: [], deckle: null };

  const next = rng(page * 2654435761 + 7);
  const amt = Math.max(0.2, Math.min(1, cfg.amount));
  const count = (base: number) => Math.round(base * (0.45 + amt * 0.75));

  /* Foxing: small, many, rust-coloured, crowding the edges. */
  const fox: Blot[] = [];
  for (let i = 0; i < count(p.fox); i++) {
    // Push toward the border: a squared random lands most spots outside the
    // middle, which is where foxing actually starts.
    const edgeBias = (v: number) => (v < 0.5 ? Math.pow(v * 2, 1.7) / 2 : 1 - Math.pow((1 - v) * 2, 1.7) / 2);
    const cx = edgeBias(next()) * 100;
    const cy = edgeBias(next()) * 100;
    const r = 0.4 + next() * 1.7;
    fox.push({
      d: blob(cx, cy, r, 0.55, next, 7),
      cx, cy, r,
      opacity: (0.1 + next() * 0.3) * amt,
      tone: 'rust',
      blur: 0.25 + next() * 0.5,
    });
  }

  /* Blots: fewer, far bigger, and mostly coming in from an edge — which is how
     a book gets wet. */
  const blots: Blot[] = [];
  for (let i = 0; i < count(p.blots); i++) {
    const fromEdge = next() < 0.72;
    const side = Math.floor(next() * 4);
    const cx = fromEdge ? (side === 0 ? next() * 18 : side === 1 ? 82 + next() * 18 : next() * 100) : 15 + next() * 70;
    const cy = fromEdge ? (side === 2 ? next() * 16 : side === 3 ? 84 + next() * 16 : next() * 100) : 15 + next() * 70;
    const r = 7 + next() * 20;
    blots.push({
      d: blob(cx, cy, r, 0.5, next, 11),
      cx, cy, r,
      opacity: (0.05 + next() * 0.11) * amt,
      tone: next() < 0.45 ? 'damp' : 'tea',
      blur: 1.4 + next() * 2.6,
    });
  }

  /* The cup ring — one per page at most, and only on the presets that earn it. */
  const ring = p.ring && next() < 0.42
    ? { cx: 14 + next() * 72, cy: 12 + next() * 76, r: 9 + next() * 8, opacity: (0.1 + next() * 0.1) * amt }
    : null;

  /* Creases: a fold runs corner to corner, or straight across. */
  const creases: Crease[] = [];
  for (let i = 0; i < count(p.creases); i++) {
    const horizontal = next() < 0.55;
    const at = 18 + next() * 64;
    const bend = (next() - 0.5) * 10;
    creases.push({
      d: horizontal
        ? `M -2 ${at.toFixed(1)} Q 50 ${(at + bend).toFixed(1)} 102 ${(at + bend * 0.4).toFixed(1)}`
        : `M ${at.toFixed(1)} -2 Q ${(at + bend).toFixed(1)} 50 ${(at + bend * 0.4).toFixed(1)} 102`,
      opacity: (0.1 + next() * 0.16) * amt,
    });
  }

  /* A deckle edge — the rough, uncut edge of hand-made paper. Traced just
     inside the border rather than clipped out of the page: clipping the sheet
     would take the dog-ear, the sticky notes and the highlight layer with it,
     and a fringe drawn on the paper reads the same at a tenth of the risk. */
  let deckle: string | null = null;
  if (p.deckle) {
    const wob = () => (next() - 0.5) * 2.6 * amt;
    const pts: string[] = [];
    const n = 13;
    for (let i = 0; i <= n; i++) pts.push(`${((i / n) * 100).toFixed(1)} ${(0.9 + wob()).toFixed(2)}`);
    for (let i = 1; i <= n; i++) pts.push(`${(99.1 + wob()).toFixed(2)} ${((i / n) * 100).toFixed(1)}`);
    for (let i = n - 1; i >= 0; i--) pts.push(`${((i / n) * 100).toFixed(1)} ${(99.1 + wob()).toFixed(2)}`);
    for (let i = n - 1; i >= 1; i--) pts.push(`${(0.9 + wob()).toFixed(2)} ${((i / n) * 100).toFixed(1)}`);
    deckle = `M ${pts.join(' L ')} Z`;
  }

  return { fox, blots, ring, creases, deckle };
}

/** The tint the printed page itself takes. A CSS filter string, or ''. */
export function ageFilter(cfg: AgeCfg): string {
  const p = agePresetOf(cfg.preset);
  if (p.id === 'off') return '';
  const a = Math.max(0.2, Math.min(1, cfg.amount));
  const sep = (p.sepia * a).toFixed(3);
  const sat = (1 + p.warm * a * 0.9).toFixed(3);
  const con = (1 - p.warm * a * 0.12).toFixed(3);
  const bri = (1 + p.warm * a * 0.05).toFixed(3);
  return `sepia(${sep}) saturate(${sat}) contrast(${con}) brightness(${bri}) hue-rotate(-6deg)`;
}
