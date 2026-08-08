/**
 * The deep field behind the Constellation View.
 *
 * The old backdrop was a fixed list of stars drawn at `wrapMod(x - cam.x, w)`,
 * which tiles the field across the viewport: pan far enough in any direction and
 * the SAME stars slide back past you, forever. That single fact is most of why
 * the sky read as wallpaper rather than as space — real sky does not repeat, and
 * the eye catches the loop immediately even when it can't name what it caught.
 *
 * This generates the field procedurally instead. Space is cut into tiles; a tile
 * is seeded by its own integer coordinates, so a tile always contains the same
 * stars no matter how you arrive at it, and two different tiles are unrelated.
 * The tile grid is unbounded, so the field never repeats and never runs out. Only
 * the tiles touching the viewport are ever visited, so the cost is set by screen
 * area, not by how far you have travelled.
 *
 * Three things follow from doing it this way, all of which the fixed list could
 * not do: the sky is the SAME PLACE every time you open the board (tiles are
 * seeded by coordinate, not by `Math.random()` at mount); the Milky Way can be a
 * real feature of the sky rather than a screen-space overlay, because a star
 * knows its absolute position; and layers at different depths can move at
 * genuinely different rates without any of them wrapping.
 *
 * Stars are drawn as point sources whose SIZE does not change with distance,
 * only their brightness and how fast they slide — which is what a real star does.
 * Zoom feeds the parallax rate rather than the pattern scale, so no amount of
 * zooming makes the field pop or resample.
 */

/* ------------------------------------------------------------------- noise */

/** Deterministic 32-bit hash of three integers — the tile's identity. */
function hash3(a: number, b: number, c: number): number {
  let h = 2166136261 ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small, fast, well-distributed PRNG. Seeded per tile. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------- stellar colour */

/**
 * The main sequence, in the proportions the naked eye actually sees.
 *
 * Not the proportions the galaxy actually HAS — by count the galaxy is
 * overwhelmingly dim red M-dwarfs, none of which are visible to the eye. What
 * you see is dominated by the hot, luminous end, so the visible sky skews
 * blue-white with a scattering of orange and red giants. Getting this backwards
 * is what makes a fake starfield look like coloured confetti.
 */
const SPECTRAL: { rgb: string; w: number }[] = [
  { rgb: '155,176,255', w: 0.06 }, // O/B — blue
  { rgb: '185,201,255', w: 0.11 }, // B/A
  { rgb: '213,224,255', w: 0.17 }, // A
  { rgb: '249,248,255', w: 0.24 }, // F — white
  { rgb: '255,244,232', w: 0.20 }, // G — sun
  { rgb: '255,222,180', w: 0.14 }, // K — orange
  { rgb: '255,190,140', w: 0.08 }, // M — red giants
];

function spectralRGB(r: number): string {
  let acc = 0;
  for (const s of SPECTRAL) {
    acc += s.w;
    if (r <= acc) return s.rgb;
  }
  return SPECTRAL[SPECTRAL.length - 1].rgb;
}

/* ----------------------------------------------------------------- layers */

export interface FieldLayer {
  /** how fast this layer slides relative to the star plane — smaller is further */
  parallax: number;
  /** world px per tile */
  tile: number;
  /** stars generated per tile before the band thins them out */
  perTile: number;
  sizeMin: number;
  sizeMax: number;
  alphaMin: number;
  alphaMax: number;
}

/* Far layers are dense and dim; the near layer is sparse, bigger and brighter.
   The eye reads the RATE DIFFERENCE between them as distance, so the spread
   between the parallax figures matters more than any one layer's numbers.

   `sizeMin` is never below 1. A canvas fillRect smaller than a pixel does not
   draw a small star, it draws an antialiased fraction of one — so a 0.45px star
   at alpha 0.1 is mathematically present and visually absent, which is how the
   first pass of this ended up with an empty-looking sky. Faintness is expressed
   through alpha, which is what actually varies; size stays a real pixel. */
export const FIELD_LAYERS: FieldLayer[] = [
  { parallax: 0.15, tile: 190, perTile: 16, sizeMin: 1.0, sizeMax: 1.5, alphaMin: 0.22, alphaMax: 0.78 },
  { parallax: 0.30, tile: 260, perTile: 8, sizeMin: 1.0, sizeMax: 1.9, alphaMin: 0.30, alphaMax: 0.92 },
  { parallax: 0.55, tile: 420, perTile: 4, sizeMin: 1.2, sizeMax: 2.6, alphaMin: 0.42, alphaMax: 1.00 },
];

export interface FieldStar {
  /** screen position */
  x: number;
  y: number;
  size: number;
  alpha: number;
  rgb: string;
  /** twinkle phase and depth, so the caller can scintillate it */
  phase: number;
  /** 0..1 — drives scintillation strength and whether it earns spikes */
  mag: number;
}

/* ------------------------------------------------------------- Milky Way */

/* The band runs across the sky at a fixed angle. Because a star knows its own
   absolute coordinate, the band is a feature of SPACE — pan away from it and it
   is still there when you come back, at the same angle, in the same place. */
/* Layer units ARE screen pixels — `visitFieldStars` subtracts a screen-space
   offset from them — so everything below is sized against a viewport, not
   against some abstract world. Getting that wrong the first time made the band
   half-width (2100) wider than the whole window, so every star on screen scored
   as "inside the band" and the band itself was invisible. A band has to be
   narrower than the viewport to read as a band. */
const BAND_ANGLE = -0.42;
const BAND_SIN = Math.sin(BAND_ANGLE);
const BAND_COS = Math.cos(BAND_ANGLE);
const BAND_TAN = Math.tan(BAND_ANGLE);
const BAND_HALF = 520; // half-width in layer units ≈ screen px
const LANE_HALF = 95;  // the dark dust lane down the band's spine

/** 0 outside the band, up to 1 in its bright shoulders, dropping in the lane. */
export function bandDensity(u: number, v: number): number {
  const d = Math.abs(u * BAND_SIN - v * BAND_COS);
  if (d > BAND_HALF) return 0;
  // Soft edges, so the band fades into the field instead of ending at a line.
  const core = 1 - (d / BAND_HALF) ** 1.7;
  // Dust lane: a dark cut along the spine, which is what makes it read as our
  // OWN galaxy seen edge-on rather than as a bright smear.
  const lane = d < LANE_HALF ? 0.24 + 0.76 * (d / LANE_HALF) ** 0.7 : 1;
  return core * lane;
}

/* ------------------------------------------------------------ the visitor */

/**
 * Walk every star of one layer that currently touches the viewport.
 *
 * `offX`/`offY` are how far this layer has slid, in screen px — unbounded, and
 * growing as you pan, which is exactly what stops the field repeating: the tile
 * a star belongs to is derived from that unbounded offset, so panning always
 * uncovers NEW tiles rather than re-entering old ones.
 */
export function visitFieldStars(
  layer: FieldLayer,
  offX: number,
  offY: number,
  vw: number,
  vh: number,
  cb: (s: FieldStar) => void,
): void {
  const { tile } = layer;
  const t0x = Math.floor(offX / tile) - 1;
  const t1x = Math.ceil((offX + vw) / tile) + 1;
  const t0y = Math.floor(offY / tile) - 1;
  const t1y = Math.ceil((offY + vh) / tile) + 1;
  const layerId = Math.round(layer.parallax * 1000);

  for (let tx = t0x; tx <= t1x; tx++) {
    for (let ty = t0y; ty <= t1y; ty++) {
      const rng = mulberry32(hash3(tx, ty, layerId));
      for (let i = 0; i < layer.perTile; i++) {
        const u = (tx + rng()) * tile;
        const v = (ty + rng()) * tile;

        /* Thin the field outside the Milky Way. Stars are never ADDED to the
           band — they are removed from everywhere else — which keeps the tile
           budget fixed while still producing a band you can see. */
        const band = bandDensity(u, v);
        const keep = 0.22 + 0.78 * band;
        if (rng() > keep) { rng(); rng(); rng(); continue; }

        /* Magnitude follows a steep power law: overwhelmingly faint, a handful
           bright. A uniform distribution is the other classic fake-sky tell —
           it produces a field of identical mid-grey dots. */
        const mag = rng() ** 3.2;
        const rgb = spectralRGB(rng());
        const phase = rng() * 6.283;

        cb({
          x: u - offX,
          y: v - offY,
          size: layer.sizeMin + (layer.sizeMax - layer.sizeMin) * mag,
          alpha: (layer.alphaMin + (layer.alphaMax - layer.alphaMin) * mag) * (0.55 + 0.45 * band),
          rgb,
          phase,
          mag,
        });
      }
    }
  }
}

/* ------------------------------------------------------- nebulae & bodies */

export interface Filament {
  x: number; y: number; r: number; rot: number; squash: number; rgb: string; a: number;
}

export interface NebulaCloud {
  /** centre in the far layer's coordinate space */
  u: number;
  v: number;
  filaments: Filament[];
}

/* Hubble-palette emission nebulae: ionised oxygen reads teal, hydrogen and
   sulphur read magenta-red. A nebula is built from a dozen overlapping,
   squashed, differently-rotated lobes rather than one radial gradient, because
   a single smooth circle is the shape nothing in space has. */
const NEB_TEAL = '86,196,214';
const NEB_MAGENTA = '196,86,150';
const NEB_DEEP = '78,96,190';

export function buildNebulae(seed: number): NebulaCloud[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const clouds: NebulaCloud[] = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const u = (rng() - 0.5) * 3000;
    /* Emission nebulae are star-forming regions, and star formation happens in
       the galactic plane — so they are pulled ONTO the band, scattered along it
       rather than across it. (`v = u * tan(angle)` is the band's own line; the
       first pass used cos/sin, which is the perpendicular, and flung all three
       clouds off across the sky where none of them were ever visible.) */
    const v = u * BAND_TAN + (rng() - 0.5) * 420;
    const base = 300 + rng() * 300;
    const hue = i === 1 ? NEB_MAGENTA : i === 2 ? NEB_DEEP : NEB_TEAL;
    const filaments: Filament[] = [];
    const lobes = 14 + Math.floor(rng() * 8);
    for (let k = 0; k < lobes; k++) {
      const ang = rng() * 6.283;
      const dist = rng() ** 0.7 * base * 1.5;
      filaments.push({
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist * 0.6,
        r: base * (0.35 + rng() * 0.75),
        rot: rng() * 3.1416,
        squash: 0.22 + rng() * 0.42, // strongly elongated — filaments, not blobs
        rgb: rng() < 0.72 ? hue : k % 2 ? NEB_MAGENTA : NEB_TEAL,
        a: 0.020 + rng() * 0.035,
      });
    }
    clouds.push({ u, v, filaments });
  }
  return clouds;
}

export interface PlacedBody {
  /** index into DEEP_BODIES */
  idx: number;
  /** position in the far layer's coordinate space */
  u: number;
  v: number;
  /** long-edge size in screen px */
  size: number;
  alpha: number;
  /** its own slow drift, in layer units per second */
  driftX: number;
  driftY: number;
  spin: number;
}

/**
 * Scatter planets through the deep field, deterministically for a given board.
 *
 * They are kept off the Milky Way's spine (a body silhouetted against the
 * densest star cloud reads as a sticker) and well apart from each other, and
 * they are DIM: a lit sphere at distance is a dull disc, and drawing one at full
 * opacity is the fastest way to turn a night sky back into a UI.
 */
export function placeBodies(seed: number, count: number, bodyCount: number): PlacedBody[] {
  const rng = mulberry32(seed ^ 0x85ebca6b);
  const out: PlacedBody[] = [];
  let guard = 0;
  /* The spread is tuned so that two or three bodies are in view at any time.
     Scatter them over a wider area and the deep field is empty most of the time,
     which is worse than having none: an object you only meet once reads as a
     bug rather than as a place. */
  while (out.length < count && guard++ < count * 40) {
    const u = (rng() - 0.5) * 2600;
    const v = (rng() - 0.5) * 1900;
    if (bandDensity(u, v) > 0.62) continue; // not against the bright spine
    if (out.some((b) => Math.hypot(b.u - u, b.v - v) < 380)) continue;
    const far = rng() ** 1.6; // most are far, a few are close
    out.push({
      idx: Math.floor(rng() * bodyCount) % Math.max(1, bodyCount),
      u,
      v,
      size: 30 + far * 104,
      alpha: 0.26 + far * 0.40,
      driftX: (rng() - 0.5) * 1.1,
      driftY: (rng() - 0.5) * 0.7,
      spin: (rng() - 0.5) * 0.9,
    });
  }
  return out;
}

/** Stable per-board seed, so a board's sky is always the same sky. */
export function skySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
