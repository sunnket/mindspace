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
  ATMO_FRAG, CORONA_FRAG, DISK_FRAG, GAS_FRAG, NEBULA_FRAG,
  PLANET_FRAG, PLANET_VERT, SKYDOME_FRAG, STARS_FRAG, STARS_VERT, SUN_FRAG,
} from './shaders';

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

/* ------------------------------------------------------------- star field */

/** Same visible-sky statistics as the 2D view: steep magnitude curve, main
 *  sequence colours weighted to the hot end, because that is what the eye sees. */
const SPECTRAL: [number, number, number, number][] = [
  [0.61, 0.69, 1.00, 0.06],
  [0.73, 0.79, 1.00, 0.11],
  [0.84, 0.88, 1.00, 0.17],
  [0.98, 0.97, 1.00, 0.24],
  [1.00, 0.96, 0.91, 0.20],
  [1.00, 0.87, 0.71, 0.14],
  [1.00, 0.75, 0.55, 0.08],
];

function starField(rng: () => number, count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform on a sphere. Using raw angles instead clumps stars at the poles.
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.82 + rng() * 0.18);
    pos[i * 3] = Math.cos(th) * s * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = Math.sin(th) * s * r;

    const mag = Math.pow(rng(), 3.4);
    siz[i] = 0.8 + mag * 3.0;

    let acc = 0;
    const pick = rng();
    let c = SPECTRAL[SPECTRAL.length - 1];
    for (const sp of SPECTRAL) {
      acc += sp[3];
      if (pick <= acc) { c = sp; break; }
    }
    const b = 0.5 + mag * 0.5;
    col[i * 3] = c[0] * b;
    col[i * 3 + 1] = c[1] * b;
    col[i * 3 + 2] = c[2] * b;
    pha[i] = rng() * 6.283;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: 1 },
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

  const SKY_R = 42000;

  /* ---- deep sky ---- */
  const domeGeo = track(new THREE.SphereGeometry(SKY_R, 48, 32));
  const domeMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: rng() * 40 },
      uBandColor: { value: new THREE.Color(0x8ea8d8) },
      uDust: { value: new THREE.Color(0x2a1d18) },
    },
    vertexShader: 'varying vec3 vPosL; void main(){ vPosL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: SKYDOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  }));
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  root.add(dome);

  const stars = starField(rng, 40000, SKY_R * 0.86);
  root.add(stars);
  track(stars.geometry);
  track(stars.material as THREE.Material);

  /* ---- nebulae: billboards that always face the camera ---- */
  const nebulae: THREE.Mesh[] = [];
  const NEB_COLORS: [number, number][] = [
    [0x2ea8b8, 0x8f3f7a], [0x7a3fa8, 0x2d5fa8], [0xa83f52, 0x2e7fa8],
  ];
  for (let i = 0; i < 5; i++) {
    const [ca, cb] = NEB_COLORS[i % NEB_COLORS.length];
    const size = SKY_R * (0.16 + rng() * 0.22);
    const g = track(new THREE.PlaneGeometry(size, size));
    const m = track(new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(ca) },
        uColorB: { value: new THREE.Color(cb) },
        uSeed: { value: rng() * 60 },
        uTime: { value: 0 },
        uOpacity: { value: 0.34 + rng() * 0.3 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: NEBULA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const mesh = new THREE.Mesh(g, m);
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = SKY_R * 0.7;
    mesh.position.set(Math.cos(th) * s * r, u * r * 0.6, Math.sin(th) * s * r);
    mesh.renderOrder = -15;
    mesh.frustumCulled = false;
    root.add(mesh);
    nebulae.push(mesh);
  }

  /* ---- the star ---- */
  const SUN_R = 21;
  const sunGeo = track(new THREE.SphereGeometry(SUN_R, 64, 48));
  const sunMat = track(new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: rng() * 30 },
      uHot: { value: new THREE.Color(0xfff2d0) },
      uCool: { value: new THREE.Color(0xff8a2e) },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: SUN_FRAG,
  }));
  const sun = new THREE.Mesh(sunGeo, sunMat);
  root.add(sun);

  const coronaGeo = track(new THREE.SphereGeometry(SUN_R * 1.32, 48, 32));
  const coronaMat = track(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffa63d) }, uTime: { value: 0 } },
    vertexShader: PLANET_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  }));
  const corona = new THREE.Mesh(coronaGeo, coronaMat);
  sun.add(corona);

  const sunLight = new THREE.PointLight(0xfff0d8, 3.2, 0, 0);
  root.add(sunLight);
  root.add(new THREE.AmbientLight(0x223044, 0.35));

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
    const tMat = track(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 0 } },
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

  /* ---- black hole ---- */
  const BH_DIST = orbit * 2.6;
  const bhGroup = new THREE.Group();
  bhGroup.position.set(BH_DIST * 0.72, orbit * 0.28, -BH_DIST * 0.62);
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
    },
    vertexShader: 'varying vec3 vPosL; void main(){ vPosL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: DISK_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }));
  const disk = new THREE.Mesh(diskGeo, diskMat);
  // RingGeometry is built in XY; stand it up into the orbital plane, then tilt
  // it so we see it obliquely rather than edge-on.
  disk.rotation.x = -Math.PI / 2;
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

  const update = (t: number, dt: number, camera: THREE.Camera) => {
    const T = t * speed;
    sun.getWorldPosition(sunWorld);

    (domeMat.uniforms.uTime as { value: number }).value = T;
    (sunMat.uniforms.uTime as { value: number }).value = T;
    (coronaMat.uniforms.uTime as { value: number }).value = T;
    (diskMat.uniforms.uTime as { value: number }).value = T;
    ((stars.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = T;
    ((stars.material as THREE.ShaderMaterial).uniforms.uTwinkle as { value: number }).value = spec.reducedMotion ? 0 : 1;

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

  return { root, bodies, sun, blackHole: bhGroup, update, dispose };
}
