/* ------------------------------------------------------------------
   Sketch vectorizer — turn ANY raster image into real vector polylines
   so an AI-generated picture can be re-inked on the canvas as ACTUAL
   editable pen strokes (not a flat picture).

   Two modes, picked automatically:
   • Line art (mostly-white image, sparse dark ink)  → trace the dark ink.
   • Everything else (photos, shaded art)            → Sobel EDGE DETECTION
     first, so we draw the subject's contours (a recognisable line drawing)
     instead of a filled silhouette blob.

   Then: marching-squares boundary tracing → stitch segments into paths →
   Douglas–Peucker simplify → the caller inks them with a little jitter.
   ------------------------------------------------------------------ */

type Poly = number[][]; // [[x,y], ...] in image-pixel space

function perpDist(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function simplify(points: Poly, eps: number): Poly {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = simplify(points.slice(0, idx + 1), eps);
    const right = simplify(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

/** Simplify, correctly handling CLOSED loops (start≈end): a naive Douglas–
 *  Peucker on a closed ring collapses to 2 points because its baseline is
 *  zero-length, so split the ring at its farthest point and simplify each arc. */
function simplifyPath(points: Poly, eps: number): Poly {
  if (points.length < 4) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1.5;
  if (closed) {
    let far = 0;
    let maxD = -1;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - first[0], points[i][1] - first[1]);
      if (d > maxD) { maxD = d; far = i; }
    }
    const a = simplify(points.slice(0, far + 1), eps);
    const b = simplify(points.slice(far), eps);
    return a.slice(0, -1).concat(b);
  }
  return simplify(points, eps);
}

/** Grayscale (transparent → white paper). */
function toGray(data: ImageData): Float32Array {
  const { width: W, height: H, data: px } = data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3];
    g[i] = a < 24 ? 255 : 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  }
  return g;
}

/** Light 3×3 box blur to tame photo noise before edge detection. */
function boxBlur(g: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          sum += g[yy * W + xx]; n++;
        }
      }
      out[y * W + x] = sum / n;
    }
  }
  return out;
}

/** Build a binary "ink" mask (1 = draw here) from an image. */
function buildMask(data: ImageData): Uint8Array {
  const W = data.width, H = data.height;
  const gray = toGray(data);

  // Line-art detector: mostly white with sparse dark strokes.
  let white = 0, dark = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > 232) white++;
    else if (gray[i] < 120) dark++;
  }
  const total = gray.length;
  const isLineArt = white / total > 0.5 && dark / total < 0.35;

  const mask = new Uint8Array(W * H);

  if (isLineArt) {
    for (let i = 0; i < total; i++) mask[i] = gray[i] < 150 ? 1 : 0;
    return mask;
  }

  // Photo / shaded: Sobel gradient magnitude → strongest edges are the lines.
  const g = boxBlur(gray, W, H);
  const mag = new Float32Array(W * H);
  let maxMag = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx =
        -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] +
         g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      const gy =
        -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] +
         g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  const thr = Math.max(28, maxMag * 0.16); // keep the meaningful contours
  for (let i = 0; i < total; i++) mask[i] = mag[i] > thr ? 1 : 0;
  return mask;
}

export function imageDataToPolylines(
  data: ImageData,
  { simplifyEps = 1.0, minPolyPoints = 2, minBbox = 4 } = {},
): Poly[] {
  const W = data.width;
  const H = data.height;
  const grid = buildMask(data);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : grid[y * W + x]);

  // Marching squares → soup of boundary segments.
  const segs: number[][] = [];
  const T = (x: number, y: number) => [x + 0.5, y];
  const R = (x: number, y: number) => [x + 1, y + 0.5];
  const B = (x: number, y: number) => [x + 0.5, y + 1];
  const L = (x: number, y: number) => [x, y + 0.5];
  const seg = (a: number[], b: number[]) => segs.push([a[0], a[1], b[0], b[1]]);

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      switch (c) {
        case 1: seg(L(x, y), B(x, y)); break;
        case 2: seg(B(x, y), R(x, y)); break;
        case 3: seg(L(x, y), R(x, y)); break;
        case 4: seg(T(x, y), R(x, y)); break;
        case 5: seg(T(x, y), R(x, y)); seg(L(x, y), B(x, y)); break;
        case 6: seg(T(x, y), B(x, y)); break;
        case 7: seg(T(x, y), L(x, y)); break;
        case 8: seg(T(x, y), L(x, y)); break;
        case 9: seg(T(x, y), B(x, y)); break;
        case 10: seg(T(x, y), L(x, y)); seg(B(x, y), R(x, y)); break;
        case 11: seg(T(x, y), R(x, y)); break;
        case 12: seg(L(x, y), R(x, y)); break;
        case 13: seg(B(x, y), R(x, y)); break;
        case 14: seg(L(x, y), B(x, y)); break;
        default: break;
      }
    }
  }
  if (segs.length === 0) return [];

  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const byEnd = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const list = byEnd.get(k);
    if (list) list.push(i); else byEnd.set(k, [i]);
  };
  segs.forEach((s, i) => { add(key(s[0], s[1]), i); add(key(s[2], s[3]), i); });

  const used = new Array(segs.length).fill(false);
  const other = (s: number[], k: string): { pt: number[]; k: string } => {
    const k1 = key(s[0], s[1]);
    return k1 === k
      ? { pt: [s[2], s[3]], k: key(s[2], s[3]) }
      : { pt: [s[0], s[1]], k: key(s[0], s[1]) };
  };
  const nextUnused = (k: string) => (byEnd.get(k) || []).find((j) => !used[j]);

  const polys: Poly[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segs[i];
    const pts: Poly = [[s[0], s[1]], [s[2], s[3]]];
    let endK = key(s[2], s[3]);
    for (let guard = 0; guard < 100000; guard++) {
      const j = nextUnused(endK);
      if (j === undefined) break;
      used[j] = true;
      const nx = other(segs[j], endK);
      pts.push(nx.pt);
      endK = nx.k;
    }
    let startK = key(s[0], s[1]);
    for (let guard = 0; guard < 100000; guard++) {
      const j = nextUnused(startK);
      if (j === undefined) break;
      used[j] = true;
      const nx = other(segs[j], startK);
      pts.unshift(nx.pt);
      startK = nx.k;
    }
    polys.push(pts);
  }

  const out: Poly[] = [];
  for (const p of polys) {
    const capped = p.length > 1400 ? p.filter((_, i) => i % Math.ceil(p.length / 1400) === 0) : p;
    const s = simplifyPath(capped, simplifyEps);
    if (s.length < minPolyPoints) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of s) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (Math.max(maxX - minX, maxY - minY) < minBbox) continue;
    out.push(s);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}
