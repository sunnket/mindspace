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

/* ========================================================================== */
/*  Freeform + region pulls                                                    */
/* ========================================================================== */

export interface Point { x: number; y: number }

/**
 * Cut along a hand-drawn path.
 *
 * A rectangle is the honest default but it is also the reason people give up on
 * a crop tool: almost nothing worth keeping out of a photograph is a rectangle.
 * The lasso closes the path, clips to it, and writes the result as a PNG with
 * everything outside the loop transparent — so the piece arrives on the board
 * already the shape of the thing, not the shape of a box around the thing.
 *
 * The path is smoothed through quadratic midpoints rather than drawn as raw
 * line segments. A pointer stream is jittery at speed, and a polygon of those
 * samples has visible corners along every edge; the midpoint construction turns
 * the same samples into a continuous curve at no extra cost.
 */
export function cropLasso(img: LoadedImage, points: Point[], feather = 1.2): { dataUrl: string; width: number; height: number } | null {
  if (points.length < 3) return null;

  const xs = points.map((p) => p.x * img.width);
  const ys = points.map((p) => p.y * img.height);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxX = Math.min(img.width, Math.ceil(Math.max(...xs)));
  const maxY = Math.min(img.height, Math.ceil(Math.max(...ys)));
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 2 || h < 2) return null;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  ctx.beginPath();
  ctx.moveTo(xs[0] - minX, ys[0] - minY);
  for (let i = 1; i < points.length - 1; i++) {
    const cx = xs[i] - minX;
    const cy = ys[i] - minY;
    const nx = (cx + (xs[i + 1] - minX)) / 2;
    const ny = (cy + (ys[i + 1] - minY)) / 2;
    ctx.quadraticCurveTo(cx, cy, nx, ny);
  }
  ctx.closePath();

  // A hairline of blur on the mask edge: a hard clip against a photograph
  // stair-steps, and one pixel of softness is the difference between "cut out"
  // and "cut out with scissors by a child".
  if (feather > 0) {
    ctx.save();
    ctx.filter = `blur(${feather}px)`;
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-in';
  } else {
    ctx.clip();
  }

  ctx.drawImage(img.canvas, minX, minY, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  return { dataUrl: out.toDataURL('image/png'), width: w, height: h };
}

/**
 * Select the connected region under a click and pull just that out.
 *
 * The inverse of the background cut: instead of filling from the edges to find
 * what to DELETE, it fills from a point to find what to KEEP. On flat-coloured
 * material — a logo, a chart segment, an icon, a block of solid colour — this
 * grabs the exact object in one click, which no rectangle ever does.
 */
export function pullRegion(
  img: LoadedImage,
  seed: Point,
  tolerance = 0.14,
): { dataUrl: string; width: number; height: number } | null {
  const { width: w, height: h } = img;
  const image = img.ctx.getImageData(0, 0, w, h);
  const data = image.data;

  const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x * w)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(seed.y * h)));
  const si = (sy * w + sx) * 4;
  const ref: BgRef = [data[si], data[si + 1], data[si + 2]];

  const total = w * h;
  const inRegion = new Uint8Array(total);
  const stack = new Int32Array(total);
  let sp = 0;
  let count = 0;
  let minX = w, minY = h, maxX = 0, maxY = 0;

  const consider = (p: number) => {
    if (inRegion[p]) return;
    const i = p * 4;
    if (data[i + 3] < 8) return;
    if (colorDistance(data[i], data[i + 1], data[i + 2], ref[0], ref[1], ref[2]) > tolerance) return;
    inRegion[p] = 1;
    stack[sp++] = p;
    count++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  consider(sy * w + sx);
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) consider(p - 1);
    if (x < w - 1) consider(p + 1);
    if (y > 0) consider(p - w);
    if (y < h - 1) consider(p + w);
  }

  // Fewer than a few hundred pixels is a mis-click on a speck, not a selection.
  if (count < 200) return null;

  const rw = maxX - minX + 1;
  const rh = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  const octx = out.getContext('2d');
  if (!octx) return null;

  const region = octx.createImageData(rw, rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const src = ((y + minY) * w + (x + minX)) * 4;
      const dst = (y * rw + x) * 4;
      region.data[dst] = data[src];
      region.data[dst + 1] = data[src + 1];
      region.data[dst + 2] = data[src + 2];
      region.data[dst + 3] = inRegion[(y + minY) * w + (x + minX)] ? data[src + 3] : 0;
    }
  }
  octx.putImageData(region, 0, 0);
  return { dataUrl: out.toDataURL('image/png'), width: rw, height: rh };
}

/* ========================================================================== */
/*  Trim + shatter                                                             */
/* ========================================================================== */

/**
 * Crop away transparent margins.
 *
 * The natural companion to the background cut: what is left is a subject
 * floating in a frame the size of the ORIGINAL photograph, so most of the block
 * is empty and it neither sits nicely nor scales sensibly on the board. Trimming
 * to the pixels that survived makes the block the size of the thing in it.
 */
export function trimTransparent(img: LoadedImage, threshold = 8): { dataUrl: string; width: number; height: number } | null {
  const { width: w, height: h } = img;
  const { data } = img.ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;                     // nothing opaque at all
  if (minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) return null; // already tight

  const rw = maxX - minX + 1;
  const rh = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img.canvas, minX, minY, rw, rh, 0, 0, rw, rh);
  return { dataUrl: out.toDataURL('image/png'), width: rw, height: rh };
}

/** One tile of a shattered image, with its place in the grid. */
export interface Tile { dataUrl: string; col: number; row: number; width: number; height: number }

/**
 * Break the picture into a grid of independent blocks.
 *
 * The most literal reading of "make it breakable": afterwards there is no image,
 * there are sixteen pieces, and every one is a block that can be moved, sorted,
 * annotated or thrown away on its own. It is how a contact sheet, a storyboard
 * or a comparison grid gets taken apart into things you can actually arrange.
 */
export function shatter(img: LoadedImage, cols: number, rows: number): Tile[] {
  const tiles: Tile[] = [];
  const tw = Math.floor(img.width / cols);
  const th = Math.floor(img.height / rows);
  if (tw < 2 || th < 2) return tiles;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // The last column and row absorb the remainder, so a size that does not
      // divide evenly loses no pixels off the right and bottom edges.
      const w = col === cols - 1 ? img.width - tw * col : tw;
      const h = row === rows - 1 ? img.height - th * row : th;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img.canvas, tw * col, th * row, w, h, 0, 0, w, h);
      tiles.push({ dataUrl: out.toDataURL('image/png'), col, row, width: w, height: h });
    }
  }
  return tiles;
}

/* ========================================================================== */
/*  Adjustments                                                                */
/* ========================================================================== */

export interface ImageAdjust {
  /** All neutral at 0; the ranges are chosen so the extremes are still usable. */
  exposure: number;   // -100…100
  contrast: number;   // -100…100
  saturation: number; // -100…100
  warmth: number;     // -100…100
  blur: number;       // 0…20
  grain?: number;     // 0…100, a sepia veil rather than real noise
}

export const NEUTRAL_ADJUST: ImageAdjust = { exposure: 0, contrast: 0, saturation: 0, warmth: 0, blur: 0, grain: 0 };

export function isNeutralAdjust(a?: Partial<ImageAdjust> | null): boolean {
  if (!a) return true;
  return !a.exposure && !a.contrast && !a.saturation && !a.warmth && !a.blur && !a.grain;
}

/**
 * An adjustment as a CSS filter string.
 *
 * Deliberately NOT a pixel operation. Written as a filter it costs nothing to
 * apply, nothing to change, and nothing to undo — the original bytes are never
 * touched, so a look can be tuned a hundred times and reverted with one click.
 * The same string is also valid for `ctx.filter`, which is what lets a piece
 * pulled out of an adjusted picture carry the look with it instead of reverting
 * to the raw pixels the moment it becomes its own block.
 */
export function adjustToFilter(a?: Partial<ImageAdjust> | null): string {
  if (isNeutralAdjust(a)) return '';
  const adj = { ...NEUTRAL_ADJUST, ...(a || {}) };
  /* Every multiplier is floored at zero. `saturate(-0.111)` is not merely
     ineffective — it is INVALID, and a browser that meets one invalid function
     discards the whole `filter` declaration. Saturation at its minimum computes
     to 1 + (−100/90) = −0.111, so the Noir look silently rendered as no filter
     at all while every other preset worked, which is a maddening thing to
     diagnose from the outside. Clamping makes the minimum mean what it should:
     saturate(0), i.e. black and white. */
  const mul = (v: number) => Math.max(0, v).toFixed(3);
  const parts: string[] = [];
  if (adj.exposure) parts.push(`brightness(${mul(1 + adj.exposure / 140)})`);
  if (adj.contrast) parts.push(`contrast(${mul(1 + adj.contrast / 120)})`);
  if (adj.saturation) parts.push(`saturate(${mul(1 + adj.saturation / 90)})`);
  if (adj.warmth) {
    // Warm leans sepia; cool rotates the hue toward blue. Two different levers
    // for the two directions, because saturating toward orange and rotating
    // toward blue are what actually read as warm and cool.
    if (adj.warmth > 0) parts.push(`sepia(${(adj.warmth / 200).toFixed(3)})`);
    else parts.push(`hue-rotate(${Math.round(adj.warmth * 0.35)}deg)`);
  }
  if (adj.blur) parts.push(`blur(${(adj.blur / 10).toFixed(2)}px)`);
  if (adj.grain) parts.push(`sepia(${(adj.grain / 260).toFixed(3)}) contrast(${(1 + adj.grain / 700).toFixed(3)})`);
  return parts.join(' ');
}

/**
 * Burn an adjustment into the pixels.
 *
 * Used on PULLS ONLY, and the distinction matters. A look lives as a CSS filter
 * on the block, so the picture you see is filtered at paint time while the
 * stored bytes stay raw. A piece pulled out becomes a NEW block with no look of
 * its own, so unless the filter is baked into it, it reverts to the raw pixels
 * the instant it lands and visibly doesn't match the picture it came from.
 *
 * The background cut deliberately does NOT bake: it writes its result back into
 * the same block, which still carries the CSS filter — baking there would apply
 * the look twice.
 */
export function bakeFilter(img: LoadedImage, filter: string): LoadedImage {
  if (!filter) return img;
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return img;
  ctx.filter = filter;
  ctx.drawImage(img.canvas, 0, 0);
  ctx.filter = 'none';
  return { canvas: out, ctx, width: img.width, height: img.height };
}

/** One-tap looks. Each is just a preset of the same five numbers, so any of
 *  them can be nudged afterwards rather than being a dead end. */
export const IMAGE_LOOKS: { id: string; label: string; adjust: ImageAdjust }[] = [
  { id: 'none', label: 'Original', adjust: { ...NEUTRAL_ADJUST } },
  { id: 'vivid', label: 'Vivid', adjust: { exposure: 6, contrast: 22, saturation: 34, warmth: 4, blur: 0 } },
  { id: 'noir', label: 'Noir', adjust: { exposure: 2, contrast: 30, saturation: -100, warmth: 0, blur: 0 } },
  { id: 'fade', label: 'Fade', adjust: { exposure: 12, contrast: -22, saturation: -18, warmth: 14, blur: 0 } },
  { id: 'warm', label: 'Golden', adjust: { exposure: 6, contrast: 8, saturation: 12, warmth: 44, blur: 0 } },
  { id: 'cool', label: 'Cool', adjust: { exposure: 3, contrast: 10, saturation: 6, warmth: -40, blur: 0 } },
  { id: 'soft', label: 'Dream', adjust: { exposure: 10, contrast: -10, saturation: 8, warmth: 10, blur: 6 } },
];

/** Natural on-canvas size for a pulled-out piece: big enough to see, never so
 *  big it covers the board. */
export function fitPulledBox(width: number, height: number, target = 240): { width: number; height: number } {
  const ratio = width / (height || 1);
  if (ratio >= 1) return { width: target, height: Math.max(40, Math.round(target / ratio)) };
  return { width: Math.max(40, Math.round(target * ratio)), height: target };
}
