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

/** The dominant colour around the border — our guess at "the background". */
function sampleBorderColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  // Buckets of 32 per channel: fine enough to tell white from off-white paper,
  // coarse enough that JPEG noise in a flat sky lands in one bucket.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (i: number) => {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 8) return; // already transparent — not evidence of a background colour
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

  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const v of buckets.values()) if (v.n > best.n) best = v;
  if (!best.n) return [255, 255, 255];
  return [best.r / best.n, best.g / best.n, best.b / best.n];
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
  const tolerance = Math.max(0.01, Math.min(0.9, opts.tolerance ?? 0.16));
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  // Reference colour: the clicked pixel for a wand, else the border's dominant.
  let ref: [number, number, number];
  if (opts.seeds?.length) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const s of opts.seeds) {
      const x = Math.max(0, Math.min(w - 1, Math.round(s.x * w)));
      const y = Math.max(0, Math.min(h - 1, Math.round(s.y * h)));
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    ref = [r / n, g / n, b / n];
  } else {
    ref = sampleBorderColor(data, w, h);
  }

  const total = w * h;
  const visited = new Uint8Array(total);
  const removed = new Uint8Array(total);
  // A plain number[] used as a stack reallocates constantly at this size; a
  // preallocated Int32Array with a pointer keeps the fill in one buffer.
  const stack = new Int32Array(total);
  let sp = 0;

  const push = (p: number) => {
    if (p < 0 || p >= total || visited[p]) return;
    visited[p] = 1;
    stack[sp++] = p;
  };

  if (opts.seeds?.length) {
    for (const s of opts.seeds) {
      const x = Math.max(0, Math.min(w - 1, Math.round(s.x * w)));
      const y = Math.max(0, Math.min(h - 1, Math.round(s.y * h)));
      push(y * w + x);
    }
  } else {
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  }

  let removedCount = 0;
  while (sp > 0) {
    const p = stack[--sp];
    const i = p * 4;
    if (data[i + 3] < 8) { removed[p] = 1; removedCount++; continue; }
    const d = colorDistance(data[i], data[i + 1], data[i + 2], ref[0], ref[1], ref[2]);
    if (d > tolerance) continue; // subject — stop the fill here

    removed[p] = 1;
    removedCount++;

    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  /* Feather. Alpha is written into a separate array first: mutating `data` in
     place would let a pixel already softened this pass act as evidence for its
     neighbour, and the softening would bleed inward across the whole subject. */
  const alpha = new Uint8ClampedArray(total);
  for (let p = 0; p < total; p++) alpha[p] = removed[p] ? 0 : data[p * 4 + 3];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (removed[p]) continue;

      let touching = false;
      if (x > 0 && removed[p - 1]) touching = true;
      else if (x < w - 1 && removed[p + 1]) touching = true;
      else if (y > 0 && removed[p - w]) touching = true;
      else if (y < h - 1 && removed[p + w]) touching = true;
      if (!touching) continue;

      const i = p * 4;
      const d = colorDistance(data[i], data[i + 1], data[i + 2], ref[0], ref[1], ref[2]);
      // At the tolerance edge the pixel is fully the subject's; at zero distance
      // it is indistinguishable from background. In between it is a blend, and
      // its alpha should say so.
      const keep = Math.max(0, Math.min(1, d / tolerance));
      alpha[p] = Math.round(data[i + 3] * keep);
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
