/**
 * Pixel work: taking an image apart.
 *
 * Everything here runs on a 2D canvas in the browser — no model downloads, no
 * server round-trip, no dependency. That constraint shapes what these functions
 * promise: this module does not do "AI subject extraction". It does something
 * narrower and completely predictable, which for the images people actually put
 * on a thinking board — screenshots, logos, diagrams, product shots, charts —
 * is the thing they wanted anyway.
 *
 * THE TAINT PROBLEM, up front, because it governs every function below.
 * Drawing a cross-origin image onto a canvas taints it, and a tainted canvas
 * throws on `getImageData` and `toDataURL`. Images dropped or pasted onto this
 * board are `data:` URLs and are safe; images placed from web search are plain
 * https and are not. `loadPixelImage` therefore asks for CORS and reports the
 * failure honestly rather than throwing an opaque SecurityError three calls
 * later — callers route those through the proxy (see lib/image/source.ts).
 */

/** Hard ceiling on pixels we will process at once (~24MP, i.e. a 6000×4000).
 *  Past this a flood fill in JS stops being interactive and the browser starts
 *  refusing the allocation anyway. */
const MAX_PIXELS = 24_000_000;

export interface LoadedImage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/** Thrown when the pixels can't be read — almost always cross-origin taint. */
export class PixelAccessError extends Error {
  constructor(message = 'These pixels are cross-origin and cannot be read.') {
    super(message);
    this.name = 'PixelAccessError';
  }
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Only meaningful for remote URLs, and harmless for data: ones. Without it
    // a same-origin-looking load still taints the canvas.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded.'));
    img.src = src;
  });
}

/** Draw an image into a readable canvas, downscaling only if it is enormous. */
export async function loadPixelImage(src: string): Promise<LoadedImage> {
  const img = await loadHtmlImage(src);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('The image has no dimensions.');

  const total = w * h;
  if (total > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / total);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.drawImage(img, 0, 0, w, h);

  // Prove readability NOW, at a known point, rather than letting a
  // SecurityError surface from deep inside an algorithm.
  try {
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    throw new PixelAccessError();
  }

  return { canvas, ctx, width: w, height: h };
}

/* ========================================================================== */
/*  Crop                                                                       */
/* ========================================================================== */

/** A region of an image in NORMALISED coordinates (0…1), so it survives the
 *  block being resized between selecting the region and using it. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cropRegion(img: LoadedImage, region: Region): { dataUrl: string; width: number; height: number } {
  const sx = Math.max(0, Math.round(region.x * img.width));
  const sy = Math.max(0, Math.round(region.y * img.height));
  const sw = Math.max(1, Math.min(img.width - sx, Math.round(region.w * img.width)));
  const sh = Math.max(1, Math.min(img.height - sy, Math.round(region.h * img.height)));

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas is unavailable.');
  octx.drawImage(img.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  // PNG, not JPEG: a crop taken out of an image whose background has already
  // been removed must keep its alpha.
  return { dataUrl: out.toDataURL('image/png'), width: sw, height: sh };
}

/* ========================================================================== */
/*  Background removal                                                         */
/* ========================================================================== */

/** Perceptual-ish colour distance, 0…1. Green is weighted most and blue least,
 *  roughly matching luminance sensitivity — a plain RGB euclidean distance
 *  calls a blue shift far more different than the eye does, which makes a
 *  single tolerance behave inconsistently across images. */
function colorDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = (r1 - r2) / 255;
  const dg = (g1 - g2) / 255;
  const db = (b1 - b2) / 255;
  return Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

export type BgRef = [number, number, number];

/**
 * The colours the background is made of — plural, deliberately.
 *
 * A single dominant colour is only right for a flat studio backdrop. Real
 * pictures have a sky that darkens toward the top, a wall with a shadow down
 * one side, a desk photographed under two lights. Judged against ONE reference,
 * half of that background reads as "different enough to be the subject" and
 * stays, so the cut leaves great blotches behind — and raising the tolerance far
 * enough to catch them is exactly what starts eating the subject.
 *
 * Keeping several references means each pixel is judged against the nearest one,
 * so a two-tone background can be removed cleanly at a TIGHT tolerance.
 */
function sampleBackgroundRefs(data: Uint8ClampedArray, w: number, h: number): BgRef[] {
  // Buckets of 32 per channel: fine enough to tell white from off-white paper,
  // coarse enough that JPEG noise in a flat sky lands in one bucket.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let samples = 0;
  const add = (i: number) => {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 8) return; // already transparent — not evidence of a background colour
    samples++;
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  };

  for (let x = 0; x < w; x++) {
    add((x) * 4);                    // top row
    add(((h - 1) * w + x) * 4);      // bottom row
  }
  for (let y = 0; y < h; y++) {
    add((y * w) * 4);                // left column
    add((y * w + (w - 1)) * 4);      // right column
  }

  if (!samples) return [[255, 255, 255]];

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const refs: BgRef[] = [];
  for (const v of sorted) {
    // A colour has to hold a real share of the border to count as background.
    // Without this floor, a subject that happens to touch an edge contributes
    // its own colour as a "background" and gets eaten from the inside.
    if (v.n / samples < 0.06 && refs.length) break;
    refs.push([v.r / v.n, v.g / v.n, v.b / v.n]);
    if (refs.length >= 4) break;
  }
  return refs.length ? refs : [[255, 255, 255]];
}

const nearestRefDistance = (r: number, g: number, b: number, refs: BgRef[]): number => {
  let best = 1;
  for (let i = 0; i < refs.length; i++) {
    const d = colorDistance(r, g, b, refs[i][0], refs[i][1], refs[i][2]);
    if (d < best) best = d;
  }
  return best;
};

const nearestRef = (r: number, g: number, b: number, refs: BgRef[]): BgRef => {
  let best = refs[0];
  let bestD = 2;
  for (let i = 0; i < refs.length; i++) {
    const d = colorDistance(r, g, b, refs[i][0], refs[i][1], refs[i][2]);
    if (d < bestD) { bestD = d; best = refs[i]; }
  }
  return best;
};

/**
 * A starting tolerance derived from the picture rather than guessed.
 *
 * One fixed default cannot serve both a logo on flat white (which wants a very
 * tight threshold, or the black in the logo starts going) and a photograph on a
 * mottled wall (which needs a loose one to catch the texture). Measuring how
 * much the border actually varies gives a first result that is usually right,
 * which matters more than the slider: most people judge the feature on the
 * click, not on the tuning afterwards.
 */
export function estimateTolerance(img: LoadedImage): number {
  const { width: w, height: h, ctx } = img;
  const { data } = ctx.getImageData(0, 0, w, h);
  const refs = sampleBackgroundRefs(data, w, h);

  let total = 0;
  let n = 0;
  const consider = (i: number) => {
    if (data[i + 3] < 8) return;
    total += nearestRefDistance(data[i], data[i + 1], data[i + 2], refs);
    n++;
  };
  for (let x = 0; x < w; x += 2) { consider(x * 4); consider(((h - 1) * w + x) * 4); }
  for (let y = 0; y < h; y += 2) { consider((y * w) * 4); consider((y * w + w - 1) * 4); }

  const mean = n ? total / n : 0.04;
  // Roughly three times the border's own spread, floored so a perfectly flat
  // backdrop still tolerates compression noise, and capped so this can never
  // hand back something aggressive enough to devour a subject unasked.
  return Math.max(0.055, Math.min(0.22, mean * 3 + 0.035));
}

export interface RemoveBackgroundOptions {
  /** 0…1. How different from the background a pixel may be and still count as
   *  background. ~0.12 suits a clean studio shot; ~0.3 a noisy photo. */
  tolerance?: number;
  /** Seed points in normalised coords. Omitted → seed from every border pixel
   *  (the "auto" behaviour); supplied → a magic wand click. */
  seeds?: { x: number; y: number }[];
}

export interface RemoveBackgroundResult {
  dataUrl: string;
  /** Share of pixels made transparent — lets the UI say when it did nothing. */
  removedRatio: number;
}

/**
 * Make the background transparent.
 *
 * CONNECTIVITY IS THE WHOLE POINT. A naive "delete every pixel near this
 * colour" also punches holes through the middle of the subject — the white of
 * an eye, a white shirt, the page behind a diagram's own strokes. This flood
 * fills from the OUTSIDE (or from a clicked point), so only background that is
 * actually reachable from the edge is removed and an enclosed white region
 * stays put.
 *
 * The edge is then feathered: a binary mask on a photograph leaves a hard,
 * aliased outline with a rim of leftover background colour, which is what makes
 * a cheap cutout look cheap. Boundary pixels get partial alpha in proportion to
 * how background-like they actually are, which reads as a soft edge.
 */
export function removeBackground(img: LoadedImage, opts: RemoveBackgroundOptions = {}): RemoveBackgroundResult {
  const { width: w, height: h, ctx } = img;
  const tol = Math.max(0.01, Math.min(0.9, opts.tolerance ?? 0.12));
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  /* How far the fill may DRIFT from a reference while following a gradient, and
     how similar two touching pixels must be for it to keep going. Together
     these are what let a sky that shades from pale to deep blue come out in one
     pass at a tight tolerance: each step only has to resemble the step before
     it. The drift cap is the leash — without it the same rule walks straight
     down a soft shadow and into the subject, and never stops.

     THE LEASH IS ABSOLUTE, not a multiple. As a pure multiple (tol × 2.4) it
     grew with the tolerance, so raising the slider lengthened the very thing
     that is supposed to contain it — and past a point the drift budget exceeded
     the distance from the background to the SUBJECT. Then a single accepted
     pixel on an anti-aliased edge was enough: the subject's interior is flat, so
     every neighbouring pixel is nearly identical to the last, and the fill ate
     the whole thing in one sweep. Measured on a red disc over a gradient, the
     slider at 22 took 60% of the subject. Adding a fixed ceiling keeps a raised
     tolerance meaning "accept colours nearer the background" instead of
     "let the fill run further from it". */
  const DRIFT = Math.min(tol * 2.2, tol + 0.14);
  const LOCAL = Math.max(0.012, tol * 0.3);

  const refs: BgRef[] = opts.seeds?.length
    ? opts.seeds.map((s) => {
      const x = Math.max(0, Math.min(w - 1, Math.round(s.x * w)));
      const y = Math.max(0, Math.min(h - 1, Math.round(s.y * h)));
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]] as BgRef;
    })
    : sampleBackgroundRefs(data, w, h);

  const total = w * h;
  /* 0 = never looked at, 1 = removed, 2 = looked at and kept (the boundary).
     Distinguishing 2 from 0 is what makes the feather pass cheap and exact:
     the edge is precisely the set of 2s, so there is no need to hunt for it. */
  const state = new Uint8Array(total);
  // A plain number[] used as a stack reallocates constantly at this size; a
  // preallocated Int32Array with a pointer keeps the fill in one buffer.
  const stack = new Int32Array(total);
  let sp = 0;
  let removedCount = 0;

  const accept = (p: number) => { state[p] = 1; stack[sp++] = p; removedCount++; };

  // Seeds are judged against the references only — they have no parent to
  // follow a gradient from.
  const seedPixels: number[] = [];
  if (opts.seeds?.length) {
    for (const s of opts.seeds) {
      const x = Math.max(0, Math.min(w - 1, Math.round(s.x * w)));
      const y = Math.max(0, Math.min(h - 1, Math.round(s.y * h)));
      seedPixels.push(y * w + x);
    }
  } else {
    for (let x = 0; x < w; x++) { seedPixels.push(x); seedPixels.push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seedPixels.push(y * w); seedPixels.push(y * w + w - 1); }
  }
  for (const p of seedPixels) {
    if (state[p]) continue;
    const i = p * 4;
    if (data[i + 3] < 8) { accept(p); continue; }
    if (nearestRefDistance(data[i], data[i + 1], data[i + 2], refs) <= tol) accept(p);
    else state[p] = 2;
  }

  while (sp > 0) {
    const p = stack[--sp];
    const pi = p * 4;
    const parentOpaque = data[pi + 3] >= 8;
    const pr = data[pi], pg = data[pi + 1], pb = data[pi + 2];

    const x = p % w;
    const y = (p / w) | 0;

    const visit = (n: number) => {
      if (state[n]) return;
      const i = n * 4;
      if (data[i + 3] < 8) { accept(n); return; }

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gd = nearestRefDistance(r, g, b, refs);

      let ok = gd <= tol;
      // Gradient continuation: still close enough to a reference to be plausible
      // background, AND nearly identical to the pixel we arrived from.
      if (!ok && gd <= DRIFT && parentOpaque) {
        ok = colorDistance(r, g, b, pr, pg, pb) <= LOCAL;
      }
      if (ok) accept(n);
      else state[n] = 2;
    };

    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }

  /* ---- feather + de-fringe -------------------------------------------------
     The previous version of this computed `keep = min(1, distance / tolerance)`
     for kept pixels — but a pixel is only KEPT when its distance already
     EXCEEDS the tolerance, so that expression was 1 every single time and the
     feather did precisely nothing. Every edge came out hard and stair-stepped.

     The band is measured ABOVE the tolerance instead: a boundary pixel exactly
     at the threshold is entirely background and goes to zero, one a little
     beyond it is a blend and gets partial alpha, and past the band it is the
     subject and is left alone.

     De-fringe then removes the halo. A boundary pixel is literally a mixture of
     background and subject, so it still carries the backdrop's colour; leaving
     it produces the pale outline that makes a cutout look pasted on. Undoing
     the blend — c = (observed − (1−a)·background) / a — recovers the subject's
     own colour, which is what makes the result sit on any canvas. */
  const FEATHER = Math.max(0.02, tol * 0.6);
  const alpha = new Uint8ClampedArray(total);
  for (let p = 0; p < total; p++) alpha[p] = state[p] === 1 ? 0 : data[p * 4 + 3];

  for (let p = 0; p < total; p++) {
    if (state[p] !== 2) continue;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gd = nearestRefDistance(r, g, b, refs);
    const a = Math.max(0, Math.min(1, (gd - tol) / FEATHER));
    alpha[p] = Math.round(data[i + 3] * a);

    if (a > 0.03 && a < 0.97) {
      const [br, bg2, bb] = nearestRef(r, g, b, refs);
      data[i] = Math.max(0, Math.min(255, (r - (1 - a) * br) / a));
      data[i + 1] = Math.max(0, Math.min(255, (g - (1 - a) * bg2) / a));
      data[i + 2] = Math.max(0, Math.min(255, (b - (1 - a) * bb) / a));
    }
  }

  for (let p = 0; p < total; p++) data[p * 4 + 3] = alpha[p];

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas is unavailable.');
  octx.putImageData(image, 0, 0);

  return { dataUrl: out.toDataURL('image/png'), removedRatio: removedCount / total };
}

/* ========================================================================== */
/*  Palette                                                                    */
/* ========================================================================== */

export interface Swatch { hex: string; weight: number }

/** The colours an image is actually made of, most used first.
 *  Transparent and near-transparent pixels are skipped so a cutout reports the
 *  subject's palette rather than a phantom average of nothing. */
export function extractPalette(img: LoadedImage, count = 6): Swatch[] {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 40_000)));
  const { data } = img.ctx.getImageData(0, 0, img.width, img.height);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      cur.n++; cur.r += r; cur.g += g; cur.b += b;
      buckets.set(key, cur);
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const totalSampled = sorted.reduce((s, v) => s + v.n, 0) || 1;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

  const out: Swatch[] = [];
  for (const v of sorted) {
    const r = v.r / v.n, g = v.g / v.n, b = v.b / v.n;
    // Skip a colour that is nearly the same as one already taken, so the row
    // isn't six indistinguishable greys off a photo of a road.
    if (out.some((s) => {
      const pr = parseInt(s.hex.slice(1, 3), 16);
      const pg = parseInt(s.hex.slice(3, 5), 16);
      const pb = parseInt(s.hex.slice(5, 7), 16);
      return colorDistance(r, g, b, pr, pg, pb) < 0.06;
    })) continue;

    out.push({ hex: `#${hex(r)}${hex(g)}${hex(b)}`, weight: v.n / totalSampled });
    if (out.length >= count) break;
  }
  return out;
}

/** Natural on-canvas size for a pulled-out piece: big enough to see, never so
 *  big it covers the board. */
export function fitPulledBox(width: number, height: number, target = 240): { width: number; height: number } {
  const ratio = width / (height || 1);
  if (ratio >= 1) return { width: target, height: Math.max(40, Math.round(target / ratio)) };
  return { width: Math.max(40, Math.round(target * ratio)), height: target };
}
