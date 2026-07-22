import type { CanvasObjectData } from './db';

/**
 * Semantic zoom — what a text block says once it is too small to read.
 *
 * Pull the camera back and body copy stops being text: it becomes a grey
 * smear, present but useless. Semantic zoom trades that smear for the one
 * thing the block was actually about, drawn LARGER on screen than the words
 * it replaces. The block keeps its exact geometry — only what's printed
 * inside it changes — so the map of the canvas never shifts under you.
 *
 * Three rules govern it, and all three have to hold:
 *
 *   1. ZOOM BAND. Above 50% nothing collapses. Between 50% and 40% only body
 *      copy (12–20px) collapses — headings at that scale are still perfectly
 *      readable and are the landmarks you navigate by. At 40% and below
 *      everything collapses, display type included.
 *
 *   2. IT MUST BE AN IMPROVEMENT. A gist is only ever swapped in when it
 *      renders BIGGER on screen than the real text does. That single test is
 *      what keeps this from being a downgrade: a 60px display heading at 30%
 *      zoom is already the biggest thing in the viewport, so it stays itself,
 *      while the 14px note beside it collapses. No threshold tuning required —
 *      the geometry decides.
 *
 *   3. IT MUST FIT. The gist is measured against the block's on-screen box and
 *      shortened until it fits. When the box is too small for even a word
 *      (a 300px note at 10% zoom is 30 screen px wide), the gist gives up
 *      honestly and draws ghost rules instead of a clipped fragment.
 */

/* ------------------------------------------------------------------ bands */

/** Body copy, by size. Outside this band, type reads as display. */
export const BODY_MIN_PX = 12;
export const BODY_MAX_PX = 20;

/** At or below this zoom, BODY copy collapses to its gist. */
export const BODY_COLLAPSE_ZOOM = 0.5;
/** At or below this zoom, EVERY size collapses — headings included. */
export const ALL_COLLAPSE_ZOOM = 0.4;

export type TextRole = 'body' | 'display';

/**
 * What each text-bearing block renders at when nothing was chosen. These
 * mirror the literals in CanvasObject's own style blocks — a heading's CSS
 * default is `2.2rem`, which is 35.2px at the app's 16px root.
 */
const DEFAULT_FONT_PX: Record<string, number> = {
  text: 15,
  heading: 35.2,
  sticky: 14,
  card: 14,
};

/** Blocks whose whole point is prose. Everything else keeps its own visuals. */
const TEXTUAL_TYPES = new Set<CanvasObjectData['type']>(['text', 'heading', 'sticky', 'card']);

/** Average glyph advance as a fraction of em, for Inter at these weights. */
const CHAR_W = 0.52;

/** Preferred and minimum on-screen size of a gist, in screen px. */
const TARGET_SCREEN_PX: Record<TextRole, number> = { body: 13, display: 17 };
const FLOOR_SCREEN_PX: Record<TextRole, number> = { body: 10, display: 12 };

/**
 * Fraction of a block's width a gist may use. Shared with the gist layer,
 * which spends the remainder as its side inset — see GIST_INSET_CSS.
 */
const GIST_INSET = 0.9;
export const GIST_INSET_CSS = `0 ${(((1 - GIST_INSET) / 2) * 100).toFixed(2)}%`;

/** Below this many characters a gist is a fragment, not a summary. */
const MIN_CHARS = 6;
/** Ghost rules only stand in for text that is genuinely sub-legible. */
const GHOST_MAX_SCREEN_PX = 8;

/* ------------------------------------------------------------- classifying */

export function effectiveFontSize(obj: CanvasObjectData): number {
  const raw = obj.style?.fontSize;
  const px = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (Number.isFinite(px) && px > 0) return px;
  return DEFAULT_FONT_PX[obj.type] ?? 15;
}

export function textRole(fontPx: number): TextRole {
  return fontPx >= BODY_MIN_PX && fontPx <= BODY_MAX_PX ? 'body' : 'display';
}

/**
 * Whether this block is prose at all.
 *
 * A `card` carrying ANY `is*` feature flag is a functional block — a poll, a
 * countdown, a chart — that stores its data in `style` and draws its own
 * chrome. Summarising its `content` would print a fragment of something the
 * user never wrote. Same test as `isAutoCleanable` in the canvas store, for
 * the same reason: an `is*` flag means "this is not a note".
 */
export function isSemanticCandidate(obj: CanvasObjectData): boolean {
  if (!TEXTUAL_TYPES.has(obj.type)) return false;
  if (!(obj.content || '').trim() && !(obj.summary || '').trim()) return false;
  if (obj.style?.isMinimized) return false;
  if (obj.type === 'card') {
    return !Object.entries(obj.style || {}).some(([k, v]) => /^is[A-Z]/.test(k) && Boolean(v));
  }
  return true;
}

/* ---------------------------------------------------------------- the gist */

/**
 * Markup a reader sees as structure but a gist should see as noise. Stripping
 * it is what makes "## Q3 roadmap" summarise as "Q3 roadmap" rather than as a
 * pair of hashes. Mirrors the syntax RichText actually understands.
 */
function stripMarks(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*\[[ xX]?\]\s+/, '')
    .replace(/^\s*(?:>>|▸|▾|>)\s+/, '')
    .replace(/@\[([^\]]*)\]\(ref:[^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '·')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|~~|==|\|\|/g, '')
    // Italics unwrap only when they actually wrap something, so `2*3` and
    // `snake_case` survive. Deliberately no lookbehind: Safari only learned
    // that in 16.4, and an unsupported group here is a parse error that takes
    // the whole bundle down rather than one summary.
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The whole block as one clean line: every line of prose it holds, in order,
 * separated by a middot. A one-line note gists to itself; a checklist gists to
 * "buy milk · call Sam · book flights", which is a far better answer to "what
 * is in that block" than its first item alone.
 *
 * Cleaning is regex-heavy and the camera fires this on every zoom frame, so
 * the cleaned form is cached against the raw source. Clipping it to a budget
 * is cheap and stays outside the cache, because the budget moves continuously
 * as you zoom.
 */
const cleanCache = new Map<string, { flat: string; words: number }>();
const CLEAN_CACHE_MAX = 500;

function cleanSource(src: string): { flat: string; words: number } {
  const hit = cleanCache.get(src);
  if (hit) return hit;

  let fenced = false;
  const parts: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^-{3,}$/.test(line)) continue;
    const clean = stripMarks(line);
    if (clean && clean !== '·') parts.push(clean);
  }
  const flat = parts.join(' · ');
  const out = { flat, words: flat ? flat.split(/\s+/).length : 0 };

  // Bounded, FIFO. Boards run to thousands of blocks; the cache exists to
  // survive a zoom gesture, not to remember the whole canvas forever.
  if (cleanCache.size >= CLEAN_CACHE_MAX) {
    const oldest = cleanCache.keys().next().value;
    if (oldest !== undefined) cleanCache.delete(oldest);
  }
  cleanCache.set(src, out);
  return out;
}

export interface Gist {
  /** The summary, already clipped to the budget. */
  text: string;
  /** Words the clip dropped. 0 when the gist is the whole block. */
  hidden: number;
}

/**
 * Summarise a block in at most `budget` characters, breaking on words.
 *
 * An explicit `summary` on the object always wins — that field exists so an
 * author (or the agent) can say what a block is about in their own words,
 * and a hand-written summary beats anything derived.
 */
export function gistOf(obj: CanvasObjectData, budget = 48): Gist {
  const authored = (obj.summary || '').trim();
  const { flat, words } = authored
    ? { flat: stripMarks(authored), words: authored.split(/\s+/).length }
    : cleanSource(obj.content || '');

  if (!flat) return { text: '', hidden: 0 };
  if (flat.length <= budget) return { text: flat, hidden: 0 };

  const cut = flat.slice(0, budget);
  const space = cut.lastIndexOf(' ');
  // Only break on a word if that leaves most of the budget used; otherwise a
  // single long word would clip back to nothing.
  const head = (space > budget * 0.55 ? cut.slice(0, space) : cut).replace(/[\s.,;:·—–-]+$/, '');
  const shown = head ? head.split(/\s+/).length : 0;
  return { text: head + '…', hidden: Math.max(0, words - shown) };
}

/* ----------------------------------------------------------------- fitting */

interface Fit {
  /** Size the gist should occupy on SCREEN, in px. */
  screenFont: number;
  /** Characters that will fit across the lines available. */
  budget: number;
  lines: 1 | 2;
}

/**
 * The largest legible gist this block's on-screen box can hold, or null when
 * it can't hold one at all. Tries the preferred size first and only then the
 * floor — a gist shrinks before it truncates, because a smaller complete
 * phrase says more than a bigger fragment.
 */
function fitGist(width: number, height: number, zoom: number, role: TextRole): Fit | null {
  const screenW = width * zoom;
  const screenH = height * zoom;
  // Must match the gist layer's own inset, which is `0 5%` — a percentage, so
  // that the two agree at every block width instead of only at large ones.
  const usableW = screenW * GIST_INSET;

  for (const screenFont of [TARGET_SCREEN_PX[role], FLOOR_SCREEN_PX[role]]) {
    const lines: 1 | 2 = screenH >= screenFont * 2.8 ? 2 : 1;
    // A second line never packs full: words break early. Budgeting for a
    // perfect fill is how a gist ends up clamped to "…" on top of its own "…".
    const slack = lines === 2 ? 0.92 : 1;
    const budget = Math.floor((usableW * lines * slack) / (screenFont * CHAR_W));
    if (budget >= MIN_CHARS) return { screenFont, budget: Math.min(budget, 96), lines };
  }
  return null;
}

/* ------------------------------------------------------------------- view */

export interface SemanticView {
  /** `gist` prints words; `ghost` draws rules where words would not fit. */
  kind: 'gist' | 'ghost';
  text: string;
  /** Font size in WORLD px — the canvas's scale transform lifts it to
   *  `screenFont` on screen, so the gist holds one size however far you zoom. */
  fontPx: number;
  weight: number;
  lines: 1 | 2;
  /** Words the gist left out, for the trailing count. */
  hidden: number;
  role: TextRole;
}

/**
 * What `obj` should print at this zoom, or null to render it as written.
 *
 * Null is the answer for the overwhelming majority of calls (anything above
 * 50% zoom, and everything that isn't prose), so the cheap tests come first.
 */
export function semanticView(obj: CanvasObjectData, zoom: number): SemanticView | null {
  if (zoom > BODY_COLLAPSE_ZOOM) return null;
  if (!isSemanticCandidate(obj)) return null;

  const fontPx = effectiveFontSize(obj);
  const role = textRole(fontPx);
  if (zoom > (role === 'body' ? BODY_COLLAPSE_ZOOM : ALL_COLLAPSE_ZOOM)) return null;

  const onScreen = fontPx * zoom; // what the real text measures right now
  const fit = fitGist(obj.width, obj.height, zoom, role);

  if (!fit) {
    // No room for words. Rules stand in for them — but only where the real
    // text is genuinely sub-legible, never over type that can still be read.
    if (onScreen >= GHOST_MAX_SCREEN_PX) return null;
    return { kind: 'ghost', text: '', fontPx: 0, weight: 400, lines: 1, hidden: 0, role };
  }

  // Rule 2: never trade the truth for a summary that reads no better than it.
  if (fit.screenFont <= onScreen) return null;

  const { text, hidden } = gistOf(obj, fit.budget);
  if (!text) return null;

  return {
    kind: 'gist',
    text,
    fontPx: fit.screenFont / zoom,
    weight: role === 'display' ? 600 : 500,
    lines: fit.lines,
    hidden,
    role,
  };
}

/* ------------------------------------------------- gallery-scale summaries */

/**
 * Which blocks best describe a canvas, most telling first.
 *
 * A landing-page thumbnail is this same idea taken to its limit — a whole
 * board at roughly 4% zoom — so it wants the same answer: headings are what a
 * canvas is about, and they must survive the cut even when a preview can only
 * draw a handful of blocks.
 */
export function rankForPreview(objects: CanvasObjectData[], limit: number): CanvasObjectData[] {
  if (objects.length <= limit) return objects;

  // Prose outranks everything, headings outrank the rest of it — but a board
  // of shapes and images is still a board, so non-prose keeps a real score
  // (its footprint) rather than a zero that would empty the thumbnail out.
  const score = (o: CanvasObjectData) => {
    if (!isSemanticCandidate(o)) return Math.min(90, Math.sqrt(Math.abs(o.width * o.height)) / 8);
    const fs = effectiveFontSize(o);
    if (o.type === 'heading') return 1000 + fs;
    return (textRole(fs) === 'display' ? 500 : 100) + fs;
  };

  const keep = new Set(
    [...objects]
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit)
      .map((o) => o.id)
  );
  // Ranked to CHOOSE, original order to DRAW — the thumbnail's stacking has to
  // keep matching the board it stands for.
  return objects.filter((o) => keep.has(o.id));
}
