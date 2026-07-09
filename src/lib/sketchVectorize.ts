/* ------------------------------------------------------------------
   Sketch vectorizer — turn a raster line-art image into real vector
   polylines so an AI-generated drawing can be re-inked on the canvas
   as ACTUAL editable pen strokes (not a flat picture). Uses marching
   squares to trace the ink boundaries, stitches the segments into
   continuous paths, simplifies them, and hands back point lists the
   caller renders with the draw tool.
   ------------------------------------------------------------------ */

type Poly = number[][]; // [[x,y], ...] in image-pixel space

/** Perpendicular distance from p to the line a→b (for Douglas–Peucker). */
function perpDist(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Douglas–Peucker path simplification. */
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

/**
 * Trace an image's dark "ink" into simplified polylines.
 * @param data     ImageData (work at ~200px for speed before calling).
 * @param threshold luminance cutoff 0..1 — below = ink.
 */
export function imageDataToPolylines(
  data: ImageData,
  { threshold = 0.55, simplifyEps = 1.1, minPolyPoints = 3, minBbox = 3 } = {},
): Poly[] {
  const W = data.width;
  const H = data.height;
  const th = threshold * 255;
  const px = data.data;

  // Binary ink grid (1 = dark/opaque).
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3];
    const lum = a < 24 ? 255 : 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    grid[i] = lum < th ? 1 : 0;
  }
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
        case 5: seg(T(x, y), R(x, y)); seg(L(x, y), B(x, y)); break; // saddle
        case 6: seg(T(x, y), B(x, y)); break;
        case 7: seg(T(x, y), L(x, y)); break;
        case 8: seg(T(x, y), L(x, y)); break;
        case 9: seg(T(x, y), B(x, y)); break;
        case 10: seg(T(x, y), L(x, y)); seg(B(x, y), R(x, y)); break; // saddle
        case 11: seg(T(x, y), R(x, y)); break;
        case 12: seg(L(x, y), R(x, y)); break;
        case 13: seg(B(x, y), R(x, y)); break;
        case 14: seg(L(x, y), B(x, y)); break;
        default: break; // 0 and 15 → empty
      }
    }
  }
  if (segs.length === 0) return [];

  // Index segment endpoints (coords are half-integers → exact integer keys).
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

  // Stitch segments sharing endpoints into continuous polylines.
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

  // Simplify + drop noise specks.
  const out: Poly[] = [];
  for (const p of polys) {
    // Decimate very long paths first so the recursive simplify can't overflow.
    const capped = p.length > 1400 ? p.filter((_, i) => i % Math.ceil(p.length / 1400) === 0) : p;
    const s = simplify(capped, simplifyEps);
    if (s.length < minPolyPoints) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of s) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (Math.max(maxX - minX, maxY - minY) < minBbox) continue;
    out.push(s);
  }
  // Longest paths first (so the big shapes ink first, caps look good).
  out.sort((a, b) => b.length - a.length);
  return out;
}
