/**
 * Renderer, post chain, and the camera.
 *
 * The camera is the whole reason this reads as cinema rather than as a demo. It
 * is never cut and never snapped: every move is a damped spring toward a target,
 * so a click becomes a flight, a scroll becomes a dolly, and letting go leaves
 * the frame drifting instead of dead-stopping. Interstellar's language is long
 * slow pushes with a very wide range of scale, so the dolly is exponential —
 * each notch multiplies the distance rather than subtracting from it, which is
 * the only way one control can cover a moon and a solar system.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FILM_FRAG, LENSING_FRAG } from './shaders';

const PASS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export interface RigOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
}

export interface Rig {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  composer: EffectComposer;
  lensPass: ShaderPass;
  filmPass: ShaderPass;
  bloom: UnrealBloomPass;
  /** where the camera is looking, and how far off it sits */
  focus: THREE.Vector3;
  setSize: (w: number, h: number) => void;
  update: (dt: number) => void;
  orbitBy: (dx: number, dy: number) => void;
  dollyBy: (notches: number) => void;
  flyTo: (target: THREE.Vector3, distance: number, seconds?: number) => void;
  dispose: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createRig({ canvas, reducedMotion }: RigOptions): Rig {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // The scene spans a moon's surface to 42,000 units of sky. Without a log
    // depth buffer the near geometry z-fights itself into stripes.
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.35, 120000);

  /* ---- camera state: everything is a spring toward a goal ---- */
  const focus = new THREE.Vector3(0, 0, 0);
  const goalFocus = new THREE.Vector3(0, 0, 0);
  let dist = 360;
  let goalDist = 360;
  let yaw = 0.6;
  let goalYaw = 0.6;
  let pitch = 0.32;
  let goalPitch = 0.32;
  let roll = 0;
  let goalRoll = 0;

  /* A flight is absolute, not accumulated.
     Advancing a progress value by `dt` each frame makes the flight's duration a
     function of the frame rate: every clamp on dt (and you need one, or a
     backgrounded tab teleports everything) stretches the journey, so on a slow
     renderer a five-second trip to the black hole simply never arrived. Reading
     the clock instead means the flight takes the time it says it takes on any
     hardware, at any frame rate, and interpolating from a REMEMBERED start
     rather than from the current position means it lands exactly on target
     however few frames it got. */
  let flightStart = -1;
  let flightSec = 1;
  const startFocus = new THREE.Vector3();
  let startDist = 360;

  const MIN_D = 3.2;
  const MAX_D = 26000;

  const orbitBy = (dx: number, dy: number) => {
    goalYaw -= dx * 0.0042;
    goalPitch = clamp(goalPitch + dy * 0.0042, -1.35, 1.35);
    // A touch of roll into the turn. Real camera moves are never perfectly level.
    goalRoll = clamp(-dx * 0.0012, -0.09, 0.09);
  };

  const dollyBy = (notches: number) => {
    goalDist = clamp(goalDist * Math.pow(1.16, notches), MIN_D, MAX_D);
  };

  const flyTo = (target: THREE.Vector3, distance: number, seconds = 2.4) => {
    goalFocus.copy(target);
    goalDist = clamp(distance, MIN_D, MAX_D);
    startFocus.copy(focus);
    startDist = dist;
    flightStart = performance.now();
    flightSec = reducedMotion ? 0.001 : Math.max(0.001, seconds);
  };

  const eye = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let idle = 0;

  const update = (dt: number) => {
    /* A flight uses a slow ease at both ends; ordinary damping is a plain
       exponential. Mixing the two is what makes a click feel authored and a
       drag feel physical. */
    if (flightStart >= 0) {
      const p = clamp((performance.now() - flightStart) / 1000 / flightSec, 0, 1);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      focus.copy(startFocus).lerp(goalFocus, e);
      // Distance is eased geometrically: going 340 -> 26000 linearly spends
      // most of the shot already far away, which reads as a jump then a wait.
      dist = startDist * Math.pow(goalDist / startDist, e);
      if (p >= 1) flightStart = -1;
    } else {
      const k = 1 - Math.pow(0.0016, dt);
      focus.lerp(goalFocus, k);
      dist += (goalDist - dist) * k;
    }

    const k2 = 1 - Math.pow(0.0009, dt);
    yaw += (goalYaw - yaw) * k2;
    pitch += (goalPitch - pitch) * k2;
    roll += (goalRoll - roll) * k2;
    goalRoll *= 1 - Math.min(1, dt * 1.6);

    /* Idle drift. Held perfectly still a rendered frame reads as a screenshot;
       a fraction of a degree of wander reads as a camera someone is holding. */
    if (!reducedMotion) {
      idle += dt;
      goalYaw += Math.sin(idle * 0.11) * 0.000075;
      goalPitch += Math.cos(idle * 0.083) * 0.00005;
    }

    const cp = Math.cos(pitch);
    eye.set(
      focus.x + Math.sin(yaw) * cp * dist,
      focus.y + Math.sin(pitch) * dist,
      focus.z + Math.cos(yaw) * cp * dist,
    );
    camera.position.copy(eye);
    up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.up.copy(up);
    camera.lookAt(focus);

    /* Near/far follow the dolly. A fixed near plane either clips the surface of
       a moon you are hovering over or throws away all precision when you pull
       back to see the whole system. */
    camera.near = clamp(dist * 0.006, 0.02, 60);
    camera.far = Math.max(90000, dist * 60);
    camera.updateProjectionMatrix();
  };

  /* ---------------------------------------------------------------- post */

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));


  /* Lensing sits between the render and the bloom, and it has to.
     Running it after the bloom is more correct on paper — the glow is light and
     light bends too — but UnrealBloomPass does not survive being fed into a
     warping pass here: the hole disappears from the frame entirely. Measured
     both ways over repeated runs; this is the order that renders. The cost is
     that the Einstein ring blooms slightly into the shadow that should be
     absolutely black, which is why the ring is kept deliberately modest. */
  const lensPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uHole: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0.06 },
      uStrength: { value: 1.35 },
      uAspect: { value: 1 },
      uRingColor: { value: new THREE.Color(0xffd9a0) },
      uVisible: { value: 0 },
    },
    vertexShader: PASS_VERT,
    fragmentShader: LENSING_FRAG,
  });
  composer.addPass(lensPass);

  /* Threshold high, strength low. At a low threshold every star point in the
     field crosses it, and UnrealBloomPass blurs each one through mips small
     enough that a single texel upsamples into a hard rounded SQUARE — the sky
     fills with blocky boxes. Only genuinely hot things should bloom: the star,
     the accretion disk, a lit limb. */
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 1.05, 0.85);
  composer.addPass(bloom);


  const filmPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uGrain: { value: 0.032 },
      uVignette: { value: 0.82 },
      /* Small on purpose. A star is one pixel wide, so splitting R from B by
         even a couple of pixels turns the whole field into red and green
         confetti — the aberration has to stay under the size of the smallest
         thing on screen or it stops reading as a lens and starts reading as a
         broken renderer. */
      uAberration: { value: 0.0022 },
    },
    vertexShader: PASS_VERT,
    fragmentShader: FILM_FRAG,
  });
  composer.addPass(filmPass);
  composer.addPass(new OutputPass());

  const setSize = (w: number, h: number) => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    (lensPass.uniforms.uAspect as { value: number }).value = w / h;
  };

  const dispose = () => {
    composer.dispose();
    renderer.dispose();
  };

  return {
    renderer, camera, scene, composer, lensPass, filmPass, bloom,
    focus, setSize, update, orbitBy, dollyBy, flyTo, dispose,
    get distance() { return dist; },
  } as Rig & { distance: number };
}

/**
 * Project the black hole into screen space for the lensing pass.
 *
 * The pass warps the whole frame around a point, so it needs where that point
 * landed this frame and how big it is — and it has to switch OFF when the hole
 * is behind the camera, or the deflection mirrors and smears the sky from a
 * point that isn't there.
 */
export function updateLensing(
  lensPass: ShaderPass,
  camera: THREE.PerspectiveCamera,
  holeWorld: THREE.Vector3,
  holeRadius: number,
): void {
  const v = holeWorld.clone().project(camera);
  const toHole = holeWorld.clone().sub(camera.position);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const behind = toHole.dot(forward) <= 0;
  const dist = toHole.length();

  const u = lensPass.uniforms as Record<string, { value: unknown }>;
  if (behind || v.z > 1) {
    (u.uVisible as { value: number }).value = 0;
    return;
  }

  // Angular radius of the shadow, converted into a fraction of the viewport.
  const fov = (camera.fov * Math.PI) / 180;
  const angular = Math.atan(holeRadius / Math.max(dist, 0.001));
  const radiusUv = angular / fov;

  (u.uVisible as { value: number }).value = radiusUv > 0.0012 ? 1 : 0;
  (u.uHole as { value: THREE.Vector2 }).value.set((v.x + 1) / 2, (v.y + 1) / 2);
  (u.uRadius as { value: number }).value = radiusUv;
}
