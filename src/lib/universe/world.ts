/**
 * Builds the universe: one star system, a black hole, and the deep sky.
 *
 * Scale here is compressed, deliberately and heavily. Real astronomical scale is
 * unusable in a viewport — at true proportions a planet beside its star is a
 * pixel beside a stadium, and the gap between two planets is minutes of travel
 * at any speed that doesn't make the camera sick. What IS kept true is the
 * relationships that the eye can actually read: inner orbits are faster than
 * outer ones by Kepler's third law, moons are much faster than their planets,
 * bodies are lit from wherever the star actually is, and nothing is ever
 * stationary.
 *
 * Everything is seeded, so a given board always generates the same universe.
 */

import * as THREE from 'three';
import {
  ATMO_FRAG, BULGE_FRAG, CORONA_FRAG, DISK_FRAG, GALAXY_DISC_FRAG, GALAXY_FRAG,
  GALAXY_VERT, GAS_FRAG, NEBULA_FRAG, PLANET_FRAG, PLANET_VERT, SKYDOME_FRAG,
  STARS_FRAG, STARS_VERT, SUN_FRAG,
} from './shaders';

const BILLBOARD_VERT =
  'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

/* ------------------------------------------------------------------ galaxy */

export interface GalaxyParts {
  group: THREE.Group;
  points: THREE.Points;
  bulge: THREE.Mesh;
  /** the smooth, unresolved sheet of light the points sit on top of */
  disc: THREE.Mesh;
  radius: number;
}

/**
 * A spiral galaxy: a few hundred thousand stars in logarithmic arms, a bright
 * old bulge, and enough blue supergiants and pink HII regions along the arms to
 * give it the colour a real one has.
 *
 * Star formation happens IN the arms, which is the whole reason arms are
 * visible: the hot blue stars that light them up burn out before they can drift
 * out of the arm that made them. So blue and pink go on the arm ridges, and the
 * space between arms gets the dim old red population.
 */
export function buildGalaxy(
  rng: () => number,
  opts: { radius: number; arms: number; count: number; tight: number },
): GalaxyParts {
  const { radius, arms, count, tight } = opts;
  const aR = new Float32Array(count);
  const aT = new Float32Array(count);
  const aZ = new Float32Array(count);
  const aS = new Float32Array(count);
  const aC = new Float32Array(count * 3);
  const aSeed = new Float32Array(count);

  // Box-Muller: real scatter is gaussian, and uniform scatter gives arms hard
  // parallel edges instead of a soft ridge that fades either side.
  const gauss = () => {
    const u = Math.max(1e-6, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * rng());
  };

  for (let i = 0; i < count; i++) {
    /* Most stars are in the bulge and inner disk. Sampling radius uniformly
       gives a flat, evenly-lit pancake with no centre to it. */
    const t = Math.pow(rng(), 1.9);
    const r = radius * (0.02 + t * 0.98);
    const inBulge = t < 0.09 && rng() < 0.75;

    let theta: number;
    let z: number;
    let col: [number, number, number];
    let size: number;

    if (inBulge) {
      theta = rng() * 6.283185;
      // The bulge is a squashed sphere, not part of the disk.
      z = gauss() * radius * 0.05;
      const warm = 0.82 + rng() * 0.18;
      col = [1.0 * warm, 0.87 * warm, 0.63 * warm];
      size = 0.10 + Math.pow(rng(), 3) * 0.3;
    } else {
      const arm = Math.floor(rng() * arms);
      const base = (arm / arms) * 6.283185 + tight * Math.log(Math.max(r / (radius * 0.06), 1.0001));
      // Arms are tight at the hub and fray outward.
      const spread = 0.34 * (0.22 + t * 1.5);
      theta = base + gauss() * spread;
      // A thin disk that flares slightly at the rim.
      z = gauss() * radius * 0.012 * (0.5 + t);

      /* Colour is dominated by the arms, not by the old population. In a real
         spiral the disk between the arms is far dimmer than the arm ridges, so
         letting the neutral population win by count — as the first pass did —
         washes the whole disk to the same cream and the arms stop reading as
         arms. Blue and pink are what an arm IS. */
      const onRidge = Math.exp(-Math.abs(gauss()) * 0.8);
      const pick = rng();
      if (pick < 0.16 * onRidge) {
        // HII regions — hydrogen lit up by the young stars inside the arm.
        col = [1.0, 0.26 + rng() * 0.14, 0.52 + rng() * 0.22];
        size = 0.30 + rng() * 0.52;
      } else if (pick < 0.78 * onRidge + 0.16) {
        col = [0.30 + rng() * 0.16, 0.55 + rng() * 0.18, 1.0];
        size = 0.14 + Math.pow(rng(), 2.2) * 0.34;
      } else {
        const w = 0.42 + rng() * 0.3;
        col = [w, w * 0.92, w * 0.86];
        size = 0.07 + Math.pow(rng(), 3.4) * 0.18;
      }
    }

    aR[i] = r;
    aT[i] = theta;
    aZ[i] = z;
    aS[i] = size;
    aC[i * 3] = col[0];
    aC[i * 3 + 1] = col[1];
    aC[i * 3 + 2] = col[2];
    aSeed[i] = rng();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(aR, 1));
  geo.setAttribute('aTheta', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aZ', new THREE.BufferAttribute(aZ, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aS, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(aC, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uSpin: { value: 0.02 },
    },
    vertexShader: GALAXY_VERT,
    fragmentShader: GALAXY_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  /* The unresolved sheet, lying IN the disk — not billboarded. It has to be
     real geometry in the galaxy's own plane, because the whole point of it is
     that it foreshortens: a galaxy seen edge-on is a line and seen face-on is a
     circle, and a camera-facing quad is a circle from everywhere. */
  const SPIN = 0.02;
  const discGeo = new THREE.PlaneGeometry(radius * 2.3, radius * 2.3);
  const discMat = new THREE.ShaderMaterial({
    uniforms: {
      uArm: { value: new THREE.Color(0x8fb4ff) },
      uCore: { value: new THREE.Color(0xffe0ac) },
      uDust: { value: new THREE.Color(0x2b1a12) },
      uArms: { value: arms },
      uTight: { value: tight },
      uRadius: { value: radius * 1.15 },
      uR0: { value: radius * 0.06 },
      uSpin: { value: SPIN },
      uTime: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: GALAXY_DISC_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  // The particles are laid out in XZ with Y as height; PlaneGeometry is in XY.
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = -1;
  disc.frustumCulled = false;

  const bulgeGeo = new THREE.PlaneGeometry(radius * 0.55, radius * 0.55);
  const bulgeMat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: new THREE.Color(0xfff6e2) },
      uOuter: { value: new THREE.Color(0xffb96b) },
      uTime: { value: 0 },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: BULGE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bulge = new THREE.Mesh(bulgeGeo, bulgeMat);

  const group = new THREE.Group();
  group.add(disc);
  group.add(points);
  group.add(bulge);
  return { group, points, bulge, disc, radius };
}

/* ------------------------------------------------------------------- rng */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------------------------------------------------------------- types */

export interface Body {
  /** the pivot that carries this body around its parent */
  pivot: THREE.Object3D;
  /** the body itself, for raycasting and for the camera to fly to */
  mesh: THREE.Mesh;
  /** id of the canvas block it stands for, if any */
  blockId?: string;
  label: string;
  kind: 'star' | 'planet' | 'gas' | 'moon' | 'blackhole';
  radius: number;
  /** orbital radius and angular rate */
  orbitR: number;
  orbitW: number;
  orbitPhase: number;
  /** inclination of the orbital plane, radians */
  incline: number;
  spinW: number;
  /** live world position, refreshed each frame so callers don't recompute it */
  world: THREE.Vector3;
}

export interface Universe {
  root: THREE.Group;
  bodies: Body[];
  sun: THREE.Object3D;
  blackHole: THREE.Object3D;
  galaxies: GalaxyParts[];
  update: (t: number, dt: number, camera: THREE.Camera) => void;
  dispose: () => void;
}

export interface UniverseSpec {
  seed: number;
  /** one world per block, capped — the universe is yours but it is not a list */
  blocks: { id: string; label: string; weight: number }[];
  reducedMotion: boolean;
}

/* --------------------------------------------------------------- palettes */

const ROCKY = [
  { low: 0x2f4a2a, mid: 0x6b7a3e, high: 0xb9ae90, sea: 0x16385e, atmo: 0x5aa2ff },
  { low: 0x6b3a24, mid: 0x9c5a32, high: 0xd0a271, sea: 0x2a3f52, atmo: 0xff8a52 },
  { low: 0x2c3f4e, mid: 0x4d6273, high: 0xa9bcc7, sea: 0x0e2436, atmo: 0x74c6ff },
  { low: 0x4a3357, mid: 0x7a5680, high: 0xc7a8c9, sea: 0x241636, atmo: 0xb98cff },
  { low: 0x34503f, mid: 0x5c7a4e, high: 0xc3c39a, sea: 0x0d3140, atmo: 0x63d6c0 },
];

const GIANTS = [
  { a: 0xd9b48a, b: 0x8a6242, storm: 0xc4593c },
  { a: 0xc9d3dd, b: 0x7e93a8, storm: 0xe0e6ec },
  { a: 0x7fb2c9, b: 0x3f6f92, storm: 0xa8dbe8 },
  { a: 0xd2c08a, b: 0x9a8352, storm: 0xe8dcae },
];

/* --------------------------------------------------------- the home galaxy */

/** Main-sequence colours, weighted the way the naked-eye sky actually is —
 *  hot stars are rare but they are bright, so they are over-represented in
 *  anything you can see. */
const SPECTRAL: [number, number, number, number][] = [
  [0.61, 0.69, 1.00, 0.06],
  [0.73, 0.79, 1.00, 0.11],
  [0.84, 0.88, 1.00, 0.17],
  [0.98, 0.97, 1.00, 0.24],
  [1.00, 0.96, 0.91, 0.20],
  [1.00, 0.87, 0.71, 0.14],
  [1.00, 0.75, 0.55, 0.08],
];

/**
 * Where we are in our own galaxy.
 *
 * The Sun sits at the origin of this scene, and the galactic centre is
 * `GC_DIST` away in the `e1` direction, inside a disk whose normal is `POLE`.
 * Those three facts are the whole geometry of the night sky, and they are
 * shared — the star particles, the dust, the unresolved-light dome and the
 * nebulae are all built from this one frame, so they cannot disagree with each
 * other the way a painted band and a scattered star field always will.
 *
 * The proportions are true even though the units are not: the disk is about a
 * hundred times wider than it is thick, and we are roughly two thirds of the
 * way out from the middle. That ratio is the reason there is a band at all.
 */
const POLE = new THREE.Vector3(0.28, 0.94, 0.20).normalize();
const GC_DIST = 30000;
const DISC_R = 46000;      // where the disk is truncated
const DISC_H = 8600;       // radial scale length: density falls as exp(-R/H)
const THIN_Z = 300;        // scale height of the young thin disk
const THICK_Z = 1400;      // and of the older, puffier population
const BULGE_R = 4300;
const DUST_Z = 150;        // dust is in a LAYER, thinner than the stars are

/* An orthonormal frame for the galaxy. e1 points from us to the centre. */
const E1 = new THREE.Vector3(1, 0, 0).sub(POLE.clone().multiplyScalar(POLE.x)).normalize();
const E2 = new THREE.Vector3().crossVectors(POLE, E1).normalize();
const GC = E1.clone().multiplyScalar(GC_DIST);

/* --------------------------------------------------------- dust, on the CPU */

function vhash(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Trilinear value noise. Cheap, and it only ever runs at build time. */
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(vhash(xi, yi, zi), vhash(xi + 1, yi, zi), u), l(vhash(xi, yi + 1, zi), vhash(xi + 1, yi + 1, zi), u), v),
    l(l(vhash(xi, yi, zi + 1), vhash(xi + 1, yi, zi + 1), u), l(vhash(xi, yi + 1, zi + 1), vhash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function fbm3(x: number, y: number, z: number, oct: number): number {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, z);
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

/**
 * How much light a star loses on its way to us, and how much redder it gets.
 *
 * This is the single most important thing in the whole sky and it is almost
 * always left out. The dark rifts splitting the Milky Way are not places with
 * fewer stars — there are just as many, and they are being HIDDEN, by cold dust
 * sitting in a layer far thinner than the stars themselves. Which means the
 * rifts only appear when you look along the plane, exactly where the band is
 * brightest, and that interplay is most of what makes the band look like a
 * photograph rather than an airbrush.
 *
 * Dust also reddens what it does not block, because it scatters blue much more
 * efficiently than red — the same reason sunsets are the colour they are. So a
 * star seen through a lot of it does not merely dim, it goes orange, and stars
 * near the plane are visibly warmer than stars near the poles.
 */
function extinction(sx: number, sy: number, sz: number, out: { dim: number; red: number }): void {
  const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (dist < 1) { out.dim = 1; out.red = 0; return; }

  const STEPS = 4;
  let column = 0;
  for (let i = 1; i <= STEPS; i++) {
    const f = (i - 0.5) / STEPS;
    const px = sx * f, py = sy * f, pz = sz * f;
    // Height above the galactic plane at this point along the sight line.
    const h = Math.abs(px * POLE.x + py * POLE.y + pz * POLE.z);
    const layer = Math.exp(-h / DUST_Z);
    if (layer < 0.002) continue;
    const clump = fbm3(px * 0.00022, py * 0.00022, pz * 0.00022, 4);
    column += layer * Math.max(0, 0.18 + clump * 1.5);
  }
  /* Mean density times path length — the optical depth. The constant is the
     one number that decides whether there is a galaxy in the sky at all: too
     small and the dark rifts vanish, and at the first value tried here (five
     times this) every star more than about twenty thousand units away along the
     plane came out at exp(-8), which quietly deleted the entire band and left
     nothing but the local neighbourhood. Tuned so a typical line of sight
     across the disk loses about four fifths of its light and a dense cloud
     loses effectively all of it. */
  column *= (dist / STEPS) * 0.00004;

  out.dim = Math.exp(-column);
  out.red = 1 - Math.exp(-column * 0.55);
}

interface StarBuf { pos: number[]; col: number[]; siz: number[]; pha: number[] }

function pushStar(
  b: StarBuf, rng: () => number, x: number, y: number, z: number,
  size: number, tint: [number, number, number],
): void {
  const ext = { dim: 1, red: 0 };
  extinction(x, y, z, ext);
  // Below a certain flux a star will never light a single pixel; dropping it
  // here is free and keeps the buffer honest.
  if (ext.dim < 0.012) return;

  b.pos.push(x, y, z);
  /* Reddening applied per channel. Blue is scattered out of the beam hardest,
     red barely at all — so the ratio between the channels changes, which is the
     part that reads as dust rather than as a dimmer switch. */
  const r = ext.red;
  b.col.push(
    tint[0] * (1 - r * 0.06),
    tint[1] * (1 - r * 0.34),
    tint[2] * (1 - r * 0.66),
  );
  b.siz.push(size * Math.sqrt(ext.dim));
  b.pha.push(rng() * 6.283);
}

function spectral(rng: () => number): [number, number, number] {
  let acc = 0;
  const pick = rng();
  for (const sp of SPECTRAL) {
    acc += sp[3];
    if (pick <= acc) return [sp[0], sp[1], sp[2]];
  }
  const last = SPECTRAL[SPECTRAL.length - 1];
  return [last[0], last[1], last[2]];
}

/**
 * The Milky Way, as geometry.
 *
 * Three populations, because the sky has three and they do different jobs:
 *
 *  - LOCAL stars, within a few thousand units, sparse and individually bright.
 *    These are the ones you can point at and name. Without them the sky has no
 *    foreground and the band floats in nothing.
 *  - The DISK, sampled from a truncated exponential in radius and a two-
 *    component exponential in height. Almost every one of these is far too far
 *    away to resolve, and that is the point — they are what SUM into the band.
 *  - The BULGE, a squashed spheroid of old yellow stars at the centre, thirty
 *    thousand units away in one specific direction. It is why one part of the
 *    band is dramatically brighter than the rest, and why the sky is not
 *    symmetric.
 *
 * A fraction of the disk is placed on logarithmic spiral arms rather than
 * smoothly, which is what produces the bright knots along the band — Cygnus,
 * Carina — instead of an even wash.
 */
function milkyWay(rng: () => number): THREE.Points {
  const b: StarBuf = { pos: [], col: [], siz: [], pha: [] };

  const gauss = () => {
    const u = Math.max(1e-6, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * rng());
  };
  /* Exponential radius, inverted analytically and truncated at the disk edge.
     Sampling radius uniformly instead is the classic mistake: it puts as many
     stars in the outer ring as the inner one, the centre stops being a centre,
     and the band comes out the same brightness in every direction. */
  const expR = () => -DISC_H * Math.log(1 - rng() * (1 - Math.exp(-DISC_R / DISC_H)));

  const world = new THREE.Vector3();
  const place = (gx: number, gy: number, gz: number) => {
    // galactic (in-plane x, in-plane y, height) -> world, with the Sun at 0.
    world.copy(GC)
      .addScaledVector(E1, gx)
      .addScaledVector(E2, gy)
      .addScaledVector(POLE, gz);
    return world;
  };

  /* ---- local population ---- */
  for (let i = 0; i < 24000; i++) {
    // A slab around us: uniform in the plane, exponential in height.
    const a = rng() * 6.283185;
    const rr = Math.sqrt(rng()) * 9000;
    const z = -THIN_Z * 2.2 * Math.log(Math.max(1e-6, rng())) * (rng() < 0.5 ? 1 : -1);
    const p = new THREE.Vector3()
      .addScaledVector(E1, Math.cos(a) * rr)
      .addScaledVector(E2, Math.sin(a) * rr)
      .addScaledVector(POLE, z);
    // Nothing inside the star system — a background star drawn among the
    // planets would be a light source sitting impossibly close.
    if (p.length() < 1400) continue;
    pushStar(b, rng, p.x, p.y, p.z, 0.26 + Math.pow(rng(), 22) * 26, spectral(rng));
  }

  /* ---- the disk ----
     Four hundred thousand of them, and the count is not decoration. The band is
     made by SUMMING sub-pixel stars, so it exists only above a certain density
     on the sky: at the hundred and thirty thousand this started with, a frame
     held roughly one disk star per three hundred pixels and there was simply
     nothing to sum — the sky came out as scattered points with no band in it at
     all, which is the failure that makes every procedural night sky look like a
     screensaver. Points are cheap; this is where the budget belongs. */
  const ARMS = 4;
  for (let i = 0; i < 400000; i++) {
    const R = expR();
    let th: number;
    if (rng() < 0.62) {
      // On an arm: a logarithmic spiral, frayed more at larger radius.
      const arm = Math.floor(rng() * ARMS);
      const base = (arm / ARMS) * 6.283185 + 2.9 * Math.log(Math.max(R / (DISC_R * 0.05), 1.0001));
      th = base + gauss() * 0.30 * (0.3 + (R / DISC_R) * 1.4);
    } else {
      th = rng() * 6.283185;
    }
    const thick = rng() < 0.16;
    const hz = thick ? THICK_Z : THIN_Z;
    const z = -hz * Math.log(Math.max(1e-6, rng())) * (rng() < 0.5 ? 1 : -1);

    const p = place(Math.cos(th) * R, Math.sin(th) * R, z);
    if (p.length() < 1400) continue;

    /* Arm stars skew hot and blue: star formation happens in the arms, and the
       blue stars it makes burn out before they can drift out of the arm that
       made them. That is the only reason arms are visible at all. */
    let tint = spectral(rng);
    if (rng() < 0.14) tint = [0.42, 0.62, 1.0];
    pushStar(b, rng, p.x, p.y, p.z, 0.22 + Math.pow(rng(), 18) * 24, tint);
  }

  /* ---- the bulge ---- */
  for (let i = 0; i < 70000; i++) {
    // Squashed spheroid, denser toward the middle.
    const u = rng() * 2 - 1;
    const a = rng() * 6.283185;
    const s = Math.sqrt(1 - u * u);
    const rr = BULGE_R * Math.pow(rng(), 0.55);
    const p = place(Math.cos(a) * s * rr, Math.sin(a) * s * rr, u * rr * 0.6);
    const warm = 0.85 + rng() * 0.15;
    pushStar(b, rng, p.x, p.y, p.z, 0.30 + Math.pow(rng(), 20) * 16,
      [1.0 * warm, 0.86 * warm, 0.64 * warm]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(b.col), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(b.siz), 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(b.pha), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), GC_DIST + DISC_R);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uTwinkle: { value: 0 },
      /* The distance at which aSize is literally the star's size in pixels.
         It is the exposure control for the whole sky: raise it and the nearby
         stars swell into blobs, lower it and the band goes out. */
      uRefDist: { value: 3600 },
      uAtten: { value: 1 },
      uGain: { value: 1 },
    },
    vertexShader: STARS_VERT,
    fragmentShader: STARS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}

/* ------------------------------------------------------------------ build */

export function buildUniverse(spec: UniverseSpec): Universe {
  const rng = mulberry32(spec.seed);
  const root = new THREE.Group();
  const bodies: Body[] = [];
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x; };

  const SKY_R = 60000;

  /* ---- the unresolved sky ----
     A sphere carried along with the camera, because unresolved starlight is at
     effective infinity: no amount of travelling inside the galaxy changes the
     direction it comes from. It is built from the SAME pole and centre as the
     star particles below, so the diffuse glow lands exactly on the band the
     geometry makes rather than beside it. */
  const domeGeo = track(new THREE.SphereGeometry(SKY_R, 48, 32));
  const domeMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: rng() * 40 },
      uBandColor: { value: new THREE.Color(0x9fb2d6) },
      uCoreColor: { value: new THREE.Color(0xffd9a4) },
      uDust: { value: new THREE.Color(0x2a1d18) },
      uPole: { value: POLE.clone() },
      uCoreDir: { value: E1.clone() },
      uFade: { value: 1 },
    },
    vertexShader: 'varying vec3 vPosL; void main(){ vPosL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: SKYDOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  }));
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  root.add(dome);

  const stars = milkyWay(rng);
  root.add(stars);
  track(stars.geometry);
  track(stars.material as THREE.Material);

  /* ---- nebulae ----
     In the disk, where they belong. A nebula is a cloud of the gas that stars
     are made from, so it lives in the thin layer where the star formation is —
     scattering them isotropically around the sky, as the first pass did, put
     glowing clouds at the galactic poles where there is nothing at all to make
     them out of. Now they sit along the band, and you find them there. */
  const nebulae: THREE.Mesh[] = [];
  const NEB_COLORS: [number, number][] = [
    // Hydrogen-alpha crimson outside, doubly-ionised oxygen teal in the core.
    [0xd63a2a, 0x49d8c4], [0xc22f4a, 0x3fc2d8], [0xe05a2c, 0x5ad0b0],
  ];
  for (let i = 0; i < 6; i++) {
    const [ca, cb] = NEB_COLORS[i % NEB_COLORS.length];
    const dist = 7000 + rng() * 20000;
    const size = dist * (0.10 + rng() * 0.16);
    const g = track(new THREE.PlaneGeometry(size, size));
    const m = track(new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(ca) },
        uColorB: { value: new THREE.Color(cb) },
        uSeed: { value: rng() * 60 },
        uTime: { value: 0 },
        uOpacity: { value: 0.30 + rng() * 0.26 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: NEBULA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const mesh = new THREE.Mesh(g, m);
    const a = rng() * Math.PI * 2;
    // Within a few degrees of the plane, and biased toward the inner galaxy
    // where the gas is.
    const lean = (rng() - 0.5) * dist * 0.06;
    mesh.position.copy(E1).multiplyScalar(Math.cos(a) * dist)
      .addScaledVector(E2, Math.sin(a) * dist)
      .addScaledVector(POLE, lean);
    mesh.renderOrder = -15;
    mesh.frustumCulled = false;
    root.add(mesh);
    nebulae.push(mesh);
  }

  /* ---- other galaxies ----
     Genuinely outside, and it matters that they are. Before, they sat at a
     third of the sky radius — inside our own star field, in front of stars they
     should have been a hundred times further away than — which is the version
     of "galaxies in the background" that quietly tells you the scene has no
     depth. Andromeda is two and a half million light years off and spans about
     three degrees; that is the proportion these keep. Flying to the near one is
     a journey out of our own disk, and the Milky Way closes up behind you into
     a galaxy you can turn around and look at. */
  const galaxies: GalaxyParts[] = [];
  {
    const specs = [
      /* Point counts came down by more than half once the smooth sheet existed
         to carry the light. They are no longer making the galaxy — they are
         resolving the brightest stars out of it, which needs far fewer of them
         and buys back the frame budget the half-million-star Milky Way spent. */
      { d: 190000, radius: 9000, arms: 2, count: 150000, tight: 2.6, tilt: 0.42 },
      { d: 330000, radius: 5200, arms: 4, count: 60000, tight: 3.4, tilt: 1.15 },
      { d: 420000, radius: 4400, arms: 2, count: 45000, tight: 2.1, tilt: 0.24 },
    ];
    for (const sp of specs) {
      const g = buildGalaxy(rng, { radius: sp.radius, arms: sp.arms, count: sp.count, tight: sp.tight });
      /* Out of the plane of our own galaxy, deliberately. Looking through the
         disk you are looking through its dust, which is why the real sky has a
         "zone of avoidance" — a stripe along the Milky Way where essentially no
         external galaxy can be seen. Putting them near the poles is both what
         the sky does and what keeps them legible. */
      const u = (rng() < 0.5 ? -1 : 1) * (0.55 + rng() * 0.45);
      const th = rng() * Math.PI * 2;
      const sxz = Math.sqrt(Math.max(0, 1 - u * u));
      g.group.position.copy(POLE).multiplyScalar(u * sp.d)
        .addScaledVector(E1, Math.cos(th) * sxz * sp.d)
        .addScaledVector(E2, Math.sin(th) * sxz * sp.d);
      g.group.rotation.set(sp.tilt, rng() * 6.283, (rng() - 0.5) * 0.6);
      g.points.frustumCulled = false;
      g.bulge.frustumCulled = false;
      root.add(g.group);
      galaxies.push(g);
      track(g.points.geometry);
      track(g.points.material as THREE.Material);
      track(g.bulge.geometry);
      track(g.bulge.material as THREE.Material);
      track(g.disc.geometry);
      track(g.disc.material as THREE.Material);
    }
  }

  /* ---- the star ---- */
  const SUN_R = 21;
  const sunGeo = track(new THREE.SphereGeometry(SUN_R, 96, 64));
  const sunMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: rng() * 30 },
      /* A G-type star is WHITE. It looks yellow from the ground because the
         atmosphere has taken the blue out of it on the way down, and it looks
         orange in most renders because the render started from the picture of
         it we grew up with rather than from the physics. From space the disc is
         white with a cream cast, and the warmth lives in the granulation lanes
         and in the reddening at the limb — which is where the eye reads it as
         hot, instead of reading the whole ball as amber plastic. */
      uHot: { value: new THREE.Color(0xfffdf6) },
      uCool: { value: new THREE.Color(0xffa63c) },
      uSpot: { value: new THREE.Color(0x51210c) },
      uActivity: { value: 0.72 + rng() * 0.4 },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: SUN_FRAG,
  }));
  const sun = new THREE.Mesh(sunGeo, sunMat);
  root.add(sun);

  /* No corona SHELL. A back-faced sphere with a Fresnel rim is the obvious way
     to halo a star and it cannot work: the rim term peaks at the sphere's
     silhouette, so the glow ends in a hard circular cut and the star wears a
     flat orange donut.

     The billboard below is the chromosphere, the prominences and the corona in
     one pass, and — the part that matters — it has a HOLE in it exactly the
     size of the photosphere. The version this replaces did not, and that is the
     single defect that made the star wrong no matter what else was fixed: an
     additive gradient was being laid over the disc every frame, erasing the
     limb. A star with a soft edge is not a star, it is a lamp. */
  /* How far out the halo reaches, in stellar radii. Eclipse photographs show
     the corona out to two or three; at the eight this started on, the billboard
     alone subtended more than the whole frame at the establishing distance,
     which is how its discard boundary became a grey disc across the sky. */
  const CORONA_K = 4.2;
  const coronaGeo = track(new THREE.PlaneGeometry(SUN_R * 2 * CORONA_K, SUN_R * 2 * CORONA_K));
  const coronaMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uCorona: { value: new THREE.Color(0xf6f1e4) },
      uChromo: { value: new THREE.Color(0xff3b1e) },
      uTime: { value: 0 },
      uSeed: { value: rng() * 6.283 },
      uDisc: { value: 1 / CORONA_K },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  const corona = new THREE.Mesh(coronaGeo, coronaMat);
  /* Drawn after the solid bodies and depth-tested against them, so a planet
     crossing in front of the star cuts the corona exactly where its silhouette
     is. A screen-space glow cannot do that, and the moment a world passes in
     front of a sun whose halo shines straight through it, the whole frame stops
     being a place and becomes a stack of layers. */
  corona.renderOrder = 1;
  root.add(corona);

  const sunLight = new THREE.PointLight(0xfff4e2, 3.2, 0, 0);
  root.add(sunLight);
  /* Ambient stands in for the galaxy: a planet's night side is not lit by
     nothing, it is lit by everything else, faintly and coldly. */
  root.add(new THREE.AmbientLight(0x1b2740, 0.3));

  bodies.push({
    pivot: sun, mesh: sun, label: 'Star', kind: 'star', radius: SUN_R,
    orbitR: 0, orbitW: 0, orbitPhase: 0, incline: 0, spinW: 0.02,
    world: new THREE.Vector3(),
  });

  /* ---- planets ---- */
  const atmoMats: THREE.ShaderMaterial[] = [];
  const surfaceMats: THREE.ShaderMaterial[] = [];

  const count = Math.max(4, Math.min(11, spec.blocks.length || 7));
  let orbit = 74;
  for (let i = 0; i < count; i++) {
    const blk = spec.blocks[i];
    // Gas giants live in the outer system, the way ours do.
    const isGas = i >= Math.floor(count * 0.55) && rng() < 0.72;
    /* Bodies are drawn far larger relative to their orbits than they really
       are. At true proportions a planet beside its star is invisible and the
       system is empty black — every space renderer cheats this, and the cheat is
       what lets one frame hold both a world and its orbit. */
    const radius = isGas ? 9.5 + rng() * 7.0 : 3.6 + rng() * 3.4;

    const pivot = new THREE.Object3D();
    const incline = (rng() - 0.5) * 0.22;
    pivot.rotation.z = incline;
    root.add(pivot);

    const geo = track(new THREE.SphereGeometry(radius, 64, 48));
    let mat: THREE.ShaderMaterial;
    if (isGas) {
      const p = GIANTS[(rng() * GIANTS.length) | 0];
      mat = track(new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uBandA: { value: new THREE.Color(p.a) },
          uBandB: { value: new THREE.Color(p.b) },
          uStorm: { value: new THREE.Color(p.storm) },
          uSeed: { value: rng() * 50 },
          uTime: { value: 0 },
          uSunI: { value: 1 },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: GAS_FRAG,
      }));
    } else {
      const p = ROCKY[(rng() * ROCKY.length) | 0];
      mat = track(new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uLow: { value: new THREE.Color(p.low) },
          uMid: { value: new THREE.Color(p.mid) },
          uHigh: { value: new THREE.Color(p.high) },
          uSea: { value: new THREE.Color(p.sea) },
          uSeaLevel: { value: 0.46 + rng() * 0.12 },
          uSeed: { value: rng() * 90 },
          uIce: { value: 0.66 + rng() * 0.2 },
          uTime: { value: 0 },
          uCityLights: { value: rng() < 0.45 ? 0.9 : 0.0 },
          uSunI: { value: 1 },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      }));
    }
    surfaceMats.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.x = orbit;
    pivot.add(mesh);

    // Atmosphere shell — back faces, additive, sitting just proud of the surface.
    const aGeo = track(new THREE.SphereGeometry(radius * 1.055, 48, 32));
    const atmoColor = isGas ? 0x9fc4ff : ROCKY[(rng() * ROCKY.length) | 0].atmo;
    const aMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uColor: { value: new THREE.Color(atmoColor) },
        uPower: { value: 2.6 + rng() * 1.2 },
        uStrength: { value: isGas ? 0.85 : 1.25 },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }));
    atmoMats.push(aMat);
    mesh.add(new THREE.Mesh(aGeo, aMat));

    /* Rings. Tilted well off the orbital plane, because a ring system that sits
       flat in the ecliptic reads as a rendering artefact rather than a moon
       that came apart. */
    if (isGas && rng() < 0.62) {
      const rin = radius * 1.5;
      const rout = radius * (2.4 + rng() * 0.9);
      const rGeo = track(new THREE.RingGeometry(rin, rout, 128, 1));
      const rMat = track(new THREE.ShaderMaterial({
        uniforms: {
          uInner: { value: new THREE.Color(0xd9cbb0) },
          uOuter: { value: new THREE.Color(0x8b7c66) },
          uRin: { value: rin },
          uRout: { value: rout },
          uTime: { value: 0 },
        },
        vertexShader: 'varying vec3 vPosL; void main(){ vPosL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 uInner; uniform vec3 uOuter; uniform float uRin; uniform float uRout;
          varying vec3 vPosL;
          float h11(float p){ return fract(sin(p * 78.233) * 43758.5453); }
          void main(){
            float r = length(vPosL.xy);
            float t = (r - uRin) / max(uRout - uRin, 0.0001);
            if (t < 0.0 || t > 1.0) discard;
            // Cassini-style gaps: banded density, not a smooth wash.
            float bands = 0.0;
            for (int i = 0; i < 7; i++) {
              float fi = float(i);
              bands += sin(t * (24.0 + fi * 17.0) + h11(fi) * 6.28) * (0.5 / (fi + 1.0));
            }
            float dens = clamp(0.55 + bands, 0.0, 1.0);
            dens *= smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t);
            vec3 col = mix(uInner, uOuter, t);
            gl_FragColor = vec4(col * (0.6 + dens * 0.8), dens * 0.78);
          }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }));
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.5;
      ring.rotation.y = (rng() - 0.5) * 0.3;
      mesh.add(ring);
    }

    const body: Body = {
      pivot, mesh, blockId: blk?.id, label: blk?.label || (isGas ? 'Gas giant' : 'World'),
      kind: isGas ? 'gas' : 'planet', radius,
      orbitR: orbit,
      // Kepler's third law: w ~ r^-1.5. Inner worlds visibly race, outer ones crawl.
      orbitW: 5.4 / Math.pow(orbit, 1.5) * 26,
      orbitPhase: rng() * Math.PI * 2,
      incline,
      spinW: (0.05 + rng() * 0.28) * (rng() < 0.12 ? -1 : 1),
      world: new THREE.Vector3(),
    };
    bodies.push(body);

    /* ---- moons ---- */
    const moons = isGas ? 1 + ((rng() * 3) | 0) : rng() < 0.4 ? 1 : 0;
    for (let m = 0; m < moons; m++) {
      const mPivot = new THREE.Object3D();
      mPivot.rotation.z = (rng() - 0.5) * 0.7;
      mesh.add(mPivot);
      const mr = radius * (0.16 + rng() * 0.2);
      const mGeo = track(new THREE.SphereGeometry(mr, 32, 24));
      const p = ROCKY[(rng() * ROCKY.length) | 0];
      const mMat = track(new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uLow: { value: new THREE.Color(0x4a4a52) },
          uMid: { value: new THREE.Color(0x7c7a80) },
          uHigh: { value: new THREE.Color(0xb6b3ae) },
          uSea: { value: new THREE.Color(p.sea) },
          uSeaLevel: { value: 1.4 }, // above every possible height: airless, no ocean
          uSeed: { value: rng() * 90 },
          uIce: { value: 1.6 },
          uTime: { value: 0 },
          uCityLights: { value: 0 },
          uSunI: { value: 1 },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      }));
      surfaceMats.push(mMat);
      const moon = new THREE.Mesh(mGeo, mMat);
      moon.position.x = radius * (2.1 + m * 0.9 + rng() * 0.5);
      mPivot.add(moon);
      bodies.push({
        pivot: mPivot, mesh: moon, label: 'Moon', kind: 'moon', radius: mr,
        orbitR: moon.position.x, orbitW: 0.5 + rng() * 0.7,
        orbitPhase: rng() * Math.PI * 2, incline: 0,
        spinW: 0.1, world: new THREE.Vector3(),
      });
    }

    orbit *= 1.27 + rng() * 0.17;
  }

  /* ---- asteroid belt ---- */
  const beltR = orbit * 0.42;
  const BELT_N = 2600;
  const rockGeo = track(new THREE.IcosahedronGeometry(1, 0));
  const rockMat = track(new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 1, metalness: 0 }));
  const belt = new THREE.InstancedMesh(rockGeo, rockMat, BELT_N);
  const dummy = new THREE.Object3D();
  const beltData: { r: number; a: number; w: number; y: number; s: number }[] = [];
  for (let i = 0; i < BELT_N; i++) {
    const r = beltR * (0.86 + rng() * 0.3);
    const a = rng() * Math.PI * 2;
    beltData.push({
      r, a, w: (5.4 / Math.pow(r, 1.5)) * 26,
      y: (rng() - 0.5) * beltR * 0.045,
      s: 0.22 + Math.pow(rng(), 2.6) * 1.9,
    });
    dummy.position.set(Math.cos(a) * r, beltData[i].y, Math.sin(a) * r);
    dummy.scale.setScalar(beltData[i].s);
    dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    dummy.updateMatrix();
    belt.setMatrixAt(i, dummy.matrix);
  }
  belt.instanceMatrix.needsUpdate = true;
  root.add(belt);

  /* ---- comets ---- */
  interface Comet { group: THREE.Group; head: THREE.Mesh; tail: THREE.Points; r: number; a: number; w: number; ecc: number; tilt: number }
  const comets: Comet[] = [];
  for (let c = 0; c < 3; c++) {
    const group = new THREE.Group();
    const hGeo = track(new THREE.SphereGeometry(1.1, 16, 12));
    /* Dim. A comet nucleus is a dirty snowball a few km across — it is not a
       light source, and rendering it near-white put a small very bright object
       in frame that punched straight through the bloom threshold and came back
       as a hard square. */
    const hMat = track(new THREE.MeshBasicMaterial({ color: 0x5d7a8c }));
    const head = new THREE.Mesh(hGeo, hMat);
    group.add(head);

    /* The tail is a particle cone that always points AWAY from the star — solar
       wind decides its direction, not the comet's velocity. Getting that wrong
       (trailing it behind the motion) is the classic tell. */
    const TN = 900;
    const tp = new Float32Array(TN * 3);
    const ta = new Float32Array(TN);
    const tc = new Float32Array(TN * 3);
    for (let i = 0; i < TN; i++) {
      const t = Math.pow(rng(), 1.6);
      const spread = t * 9 * (rng() - 0.5);
      tp[i * 3] = t * 150;
      tp[i * 3 + 1] = spread;
      tp[i * 3 + 2] = spread * (rng() - 0.5) * 2;
      ta[i] = (1 - t) * 1.7 + 0.35;
      const blue = 0.7 + rng() * 0.3;
      tc[i * 3] = 0.55 * (1 - t) + 0.25;
      tc[i * 3 + 1] = 0.78 * (1 - t) + 0.3;
      tc[i * 3 + 2] = blue;
    }
    const tGeo = track(new THREE.BufferGeometry());
    tGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    tGeo.setAttribute('aSize', new THREE.BufferAttribute(ta, 1));
    tGeo.setAttribute('aColor', new THREE.BufferAttribute(tc, 3));
    tGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(TN), 1));
    /* The tail shares the star shader and it does need the distance law, just
       with a reference scaled to a comet rather than to a galaxy. Switching
       attenuation off entirely — the first thing tried here — meant the tails
       drew at full brightness from any distance, so pulling back twenty
       thousand units to look at the sky left three glowing white streaks
       hanging in the middle of the frame, each of them a comet that should have
       been far too small to see. */
    const tMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uTwinkle: { value: 0 }, uRefDist: { value: 260 }, uAtten: { value: 1 }, uGain: { value: 1 },
      },
      vertexShader: STARS_VERT,
      fragmentShader: STARS_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const tail = new THREE.Points(tGeo, tMat);
    tail.frustumCulled = false;
    group.add(tail);
    root.add(group);
    comets.push({
      group, head, tail,
      r: orbit * (0.5 + rng() * 0.7), a: rng() * 6.283,
      w: 0.055 + rng() * 0.06, ecc: 0.45 + rng() * 0.3,
      tilt: (rng() - 0.5) * 1.1,
    });
  }

  /* ---- black hole ----
     Far outside the planets. It used to sit two and a half orbits past the last
     world, which put a stellar-mass black hole inside a functioning planetary
     system — nothing there would have planets, or an orbit, or a next Tuesday.
     Out here it reads as what it is: a separate thing in the dark that you
     travel to. */
  const BH_DIST = orbit * 11;
  const bhGroup = new THREE.Group();
  bhGroup.position.set(BH_DIST * 0.72, orbit * 1.6, -BH_DIST * 0.62);
  root.add(bhGroup);

  const BH_R = 26;
  const holeGeo = track(new THREE.SphereGeometry(BH_R, 48, 32));
  const holeMat = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const hole = new THREE.Mesh(holeGeo, holeMat);
  bhGroup.add(hole);

  const diskGeo = track(new THREE.RingGeometry(BH_R * 1.9, BH_R * 6.2, 220, 1));
  const diskMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uInner: { value: new THREE.Color(0xfff2d6) },
      uOuter: { value: new THREE.Color(0xff7220) },
      uRin: { value: BH_R * 1.9 },
      uRout: { value: BH_R * 6.2 },
      uViewLocal: { value: new THREE.Vector3() },
    },
    vertexShader: 'varying vec3 vPosL; void main(){ vPosL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: DISK_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    /* Depth test OFF, and this is what produces the image everyone recognises.
       The far half of the disk passes BEHIND the hole, so ordinarily the black
       sphere occludes it and there is nothing there for the lensing pass to
       bend — you get a flat orange bar with a dot in the middle. Let it draw
       through, and the screen-space warp pushes it radially outward from the
       shadow, lifting the far side up over the top and folding it under the
       bottom. That arc over the hole is the whole photograph. The shadow term
       in the lensing shader then blacks out everything actually inside the
       horizon, so nothing survives where nothing should. */
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  const disk = new THREE.Mesh(diskGeo, diskMat);
  // RingGeometry is built in XY; stand it up into the orbital plane, then tilt
  // it so we see it obliquely rather than edge-on.
  disk.rotation.x = -Math.PI / 2;
  disk.renderOrder = 3;
  hole.renderOrder = 2;
  bhGroup.rotation.set(0.34, 0.6, 0.12);
  bhGroup.add(disk);

  bodies.push({
    pivot: bhGroup, mesh: hole, label: 'Gargantua', kind: 'blackhole', radius: BH_R,
    orbitR: 0, orbitW: 0, orbitPhase: 0, incline: 0, spinW: 0,
    world: new THREE.Vector3(),
  });

  /* --------------------------------------------------------------- update */

  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const speed = spec.reducedMotion ? 0 : 1;

  const camPos = new THREE.Vector3();

  const update = (t: number, dt: number, camera: THREE.Camera) => {
    const T = t * speed;
    sun.getWorldPosition(sunWorld);
    camera.getWorldPosition(camPos);

    (domeMat.uniforms.uTime as { value: number }).value = T;
    (sunMat.uniforms.uTime as { value: number }).value = T;
    (diskMat.uniforms.uTime as { value: number }).value = T;
    /* The beaming term needs the eye in the DISK's frame, not the world's —
       which side is coming toward you depends on where you are standing. */
    (diskMat.uniforms.uViewLocal.value as THREE.Vector3).copy(disk.worldToLocal(camPos.clone()));
    ((stars.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = T;

    /* The sky rides with the camera and fades as you leave.
       This is the answer to "how can the Milky Way be visible from inside it":
       it is visible from inside it and ONLY from inside it. The band is the
       shape of the disk you are standing in, so it comes from a fixed set of
       directions no matter where in the disk you go — hence a sphere pinned to
       the camera rather than to the world. And once you climb far enough out of
       the disk there is no band any more, because there is no longer any galaxy
       around you; there is a galaxy behind you, made of the star particles,
       which you can turn round and look at. So the dome has to die on the way
       out or you would carry a painted sky into intergalactic space. */
    dome.position.copy(camPos);
    const outOfPlane = Math.abs(camPos.dot(POLE));
    const fromCore = camPos.distanceTo(GC);
    const away = Math.max(outOfPlane / 9000, fromCore / (DISC_R * 1.25));
    (domeMat.uniforms.uFade as { value: number }).value = Math.max(0, Math.min(1, 1.35 - away));

    (coronaMat.uniforms.uTime as { value: number }).value = T;
    corona.quaternion.copy(camera.quaternion);

    for (const g of galaxies) {
      ((g.points.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = T;
      ((g.bulge.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = T;
      ((g.disc.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = T;
      /* The bulge billboard faces the camera, but it lives inside the galaxy's
         own tilted frame — so the camera's rotation has to be brought into that
         frame or the bulge slides off the hub as you orbit. */
      g.bulge.quaternion.copy(camera.quaternion);
      g.bulge.quaternion.premultiply(g.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    }

    for (const n of nebulae) {
      (((n.material as THREE.ShaderMaterial).uniforms.uTime) as { value: number }).value = T;
      n.quaternion.copy(camera.quaternion); // billboard
    }

    sun.rotation.y += 0.02 * dt * speed;

    for (const b of bodies) {
      if (b.kind === 'star' || b.kind === 'blackhole') {
        b.mesh.getWorldPosition(b.world);
        continue;
      }
      b.pivot.rotation.y = b.orbitPhase + T * b.orbitW;
      b.mesh.rotation.y += b.spinW * dt * speed;
      b.mesh.getWorldPosition(b.world);
    }

    /* Every lit surface needs the direction to the star in ITS OWN local frame,
       because the shader works in object space. Recomputing it per body per
       frame is what keeps the terminator correct as things orbit — bake it once
       and every planet ends up lit from the same fixed direction, which is the
       single most obvious way to make a solar system look fake. */
    for (const b of bodies) {
      const mat = b.mesh.material as THREE.ShaderMaterial;
      if (!mat || !mat.uniforms || !mat.uniforms.uSunDir) continue;
      tmp.copy(sunWorld).sub(b.world).normalize();
      (mat.uniforms.uSunDir.value as THREE.Vector3).copy(tmp);
      const child = b.mesh.children.find(
        (c) => (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.ShaderMaterial)?.uniforms?.uColor,
      ) as THREE.Mesh | undefined;
      if (child) {
        const am = child.material as THREE.ShaderMaterial;
        if (am.uniforms.uSunDir) (am.uniforms.uSunDir.value as THREE.Vector3).copy(tmp);
      }
    }

    // Belt: same Kepler shear as the planets, so it visibly winds.
    for (let i = 0; i < BELT_N; i++) {
      const d = beltData[i];
      const a = d.a + T * d.w;
      dummy.position.set(Math.cos(a) * d.r, d.y, Math.sin(a) * d.r);
      dummy.scale.setScalar(d.s);
      dummy.rotation.set(a * 0.7, a * 1.3, a * 0.4);
      dummy.updateMatrix();
      belt.setMatrixAt(i, dummy.matrix);
    }
    belt.instanceMatrix.needsUpdate = true;

    for (const c of comets) {
      const a = c.a + T * c.w;
      // An ellipse with the star at a focus, not a circle.
      const rr = (c.r * (1 - c.ecc * c.ecc)) / (1 + c.ecc * Math.cos(a));
      c.group.position.set(
        Math.cos(a) * rr,
        Math.sin(a) * rr * Math.sin(c.tilt),
        Math.sin(a) * rr * Math.cos(c.tilt),
      );
      tmp.copy(c.group.position).sub(sunWorld).normalize();
      const away = new THREE.Vector3().copy(tmp);
      c.tail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), away);
      const near = 1 - Math.min(1, rr / (c.r * 1.4));
      c.tail.scale.setScalar(0.5 + near * 1.9);
    }
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else mm?.dispose();
    });
  };

  return { root, bodies, sun, blackHole: bhGroup, galaxies, update, dispose };
}
