/**
 * Stress Reliefer — the effect catalogue.
 *
 * Every effect is a tiny particle system: `create` builds one DOM node and its
 * physics state, `step` advances it and writes the result to that node. The
 * engine in RelaxEffectsLayer owns emission, the RAF loop, and teardown.
 *
 * Three hard rules for anything added here, all learned the hard way:
 *
 *  1. World-space particles mount inside `.canvas-world`, a 0x0 shrink-to-fit
 *     box. Tailwind preflight's `img { max-width: 100% }` resolves against it,
 *     so any node that doesn't pin `max-width/max-height: none` collapses to
 *     zero width and silently renders nothing. `baseStyle` does this for you.
 *  2. `step` may only touch `transform` and `opacity`. Anything else (width,
 *     left/top, filter) re-runs layout or paint for every particle every frame,
 *     and a burst is routinely 200+ nodes.
 *  3. Pick `space` deliberately. 'world' pins particles to canvas coordinates so
 *     they pan and zoom with the board — right for a burst that belongs to a
 *     spot on the canvas. 'screen' pins them to the viewport — right for weather
 *     and for anything the user has to click, which must not slide out from
 *     under the cursor when the canvas moves.
 */

import { BLOOM_FLOWERS, BLOOM_LEAVES } from './bloomAssets';
import { RELAX_DRIFT, RELAX_SEEDHEAD } from './relaxAssets';
import {
  HIRAJOSHI,
  PENTATONIC,
  playBamboo,
  playBell,
  playBoom,
  playChime,
  playHandpan,
  playKoto,
  playLaunch,
  playPlop,
  playSnap,
  playSparkle,
  playWhoosh,
  startAmbience,
  startRain,
  stopAmbience,
  stopRain,
} from './relaxAudio';

export type RelaxEffectId =
  | 'flowers'
  | 'blooming'
  | 'petalfall'
  | 'rain'
  | 'fireworks'
  | 'galaxy'
  | 'bubblewrap'
  | 'chimes'
  | 'ripples'
  | 'ocean'
  | 'handpan'
  | 'snow'
  | 'fireflies'
  | 'lanterns'
  | 'gate'
  | 'breathing'
  | 'aurora'
  /* the second shelf */
  | 'koi'
  | 'ink'
  | 'soap'
  | 'glassrain'
  | 'dandelion'
  | 'kaleido'
  | 'stones'
  | 'embers'
  | 'jellyfish'
  | 'candles'
  /* immersions — the whole viewport, for two minutes */
  | 'stargaze'
  | 'tide'
  | 'clouds'
  | 'duskwash'
  | 'deepwater'
  | 'godrays'
  | 'shoji'
  | 'wheat'
  | 'lavalamp'
  | 'blossomstorm'
  | 'fogbank'
  | 'citynight'
  | 'meteors'
  | 'silk'
  | 'sandgarden'
  | 'moonrise'
  | 'bioluminescence'
  | 'steamroom'
  | 'prism'
  | 'wisteria'
  | 'mountains'
  | 'campfire'
  | 'snowfield'
  | 'desert'
  | 'bamboo'
  | 'rainwindow'
  | 'lanternriver'
  | 'waterfall'
  | 'nebula'
  | 'autumn'
  | 'harbour'
  | 'thunderhead';

export interface Particle {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  born: number;
  life: number;
  maxScale: number;
  tint: string;
  /** which sub-species of the effect this is — shells vs sparks, bubbles vs shards */
  kind: number;
  /** free scratch slots — meaning is per-effect */
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface EffectApi {
  spawn: (x: number, y: number, n: number, kind?: number, tint?: string) => void;
  /** drop every particle this effect currently owns — used to re-lay a fresh grid */
  clear: () => void;
  /** fixed, viewport-sized overlay — for weather, veils and lightning */
  screen: HTMLElement;
  viewport: { w: number; h: number };
  /** live cursor position in SCREEN px — for effects the user pushes around */
  pointer: { x: number; y: number };
  /** is the canvas currently on a DARK paper? Effects read this at create-time to
   *  render legibly in both themes — bright glows against a light page wash out,
   *  and white particles vanish on light paper, so each effect adapts its colours,
   *  contrast and (where it helps) its own backdrop to the theme it lands in. */
  readonly isDark: boolean;
}

/**
 * What shelf an effect sits on in the picker.
 *
 * Twenty-seven tiles in one undifferentiated grid is a wall, and you stop
 * reading a wall after the first row. Grouping by what the thing IS — water,
 * sky, garden, firelight, something to play with, something to sit in front of
 * — is how you find the one you are in the mood for without reading all of it.
 */
export type RelaxGroup = 'Immersion' | 'Water' | 'Sky' | 'Garden' | 'Firelight' | 'Play' | 'Stillness';

export const RELAX_GROUPS: readonly RelaxGroup[] = ['Immersion', 'Water', 'Garden', 'Sky', 'Firelight', 'Play', 'Stillness'];

export interface RelaxEffect {
  id: RelaxEffectId;
  label: string;
  group: RelaxGroup;
  blurb: string;
  space: 'world' | 'screen';
  /** colour of the shockwave ring that opens the burst; '' for none */
  flash: string;
  burstMs: number;
  openingPop: number;
  /** 0 = one-shot: the click spawns openingPop and nothing more */
  spawnEveryMs: number;
  spawnPerTick: number;
  maxParticles: number;
  /** particles take clicks — the pop games */
  interactive?: boolean;
  /** interactive particles also fire on pointer-enter, so sweeping the cursor
   *  across them plays them (wind chimes) */
  hover?: boolean;
  /** false keeps the particle alive after a click — a chime rings, it doesn't
   *  vanish. Defaults to true: clicking a bubble destroys it. */
  consumeOnPop?: boolean;
  create: (
    x: number,
    y: number,
    now: number,
    api: EffectApi,
    kind?: number,
    tint?: string,
    /** position within this spawn batch — lets an effect lay out a grid */
    index?: number
  ) => Particle;
  step: (p: Particle, t: number, now: number, api: EffectApi) => void;
  /** fires when a particle reaches the end of its life (fireworks shell -> sparks) */
  onDeath?: (p: Particle, api: EffectApi) => void;
  /** fires when the user clicks a particle (interactive effects only) */
  onPop?: (p: Particle, api: EffectApi) => void;
  /** fires on every click — per-click sound belongs here */
  onBurst?: (x: number, y: number, api: EffectApi) => void;
  /** lifecycle: fires when the effect starts running and when it goes quiet.
   *  Anything continuous (a looping track, a full-screen veil) belongs here so a
   *  second click during a storm doesn't start a second storm. */
  onStart?: (x: number, y: number, api: EffectApi) => void;
  onStop?: (api: EffectApi) => void;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];

/** Shared reset. Anything that skips this will collapse to 0px wide — see rule 1. */
function baseStyle(el: HTMLElement, size: number, extra = '') {
  el.style.cssText =
    'position:absolute;left:0;top:0;pointer-events:none;user-select:none;' +
    'max-width:none;max-height:none;will-change:transform,opacity;opacity:0;' +
    `width:${size}px;height:${size}px;` +
    extra;
}

function particle(el: HTMLElement, x: number, y: number, size: number, life: number, now: number): Particle {
  return {
    el, x, y, size, life, born: now,
    vx: 0, vy: 0, rot: 0, spin: 0, maxScale: 1, tint: '#fff',
    kind: 0, a: 0, b: 0, c: 0, d: 0,
  };
}

/** Elastic pop-in with a touch of overshoot. */
function popIn(t: number, window_ = 0.18) {
  if (t >= window_) return 1;
  const k = t / window_;
  return 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.16;
}

/* ------------------------------------------------------------------ flowers */

const FLOWER_SVGS = [
  '/flowers/Flower.svg',
  '/flowers/day-flower-gift-svgrepo-com.svg',
  '/flowers/flower-green-svgrepo-com.svg',
  '/flowers/flower-leaf-2-svgrepo-com.svg',
  '/flowers/flower-orange-3-svgrepo-com.svg',
  '/flowers/flower-orange-organic-svgrepo-com.svg',
  '/flowers/flower-svgrepo-com (1).svg',
  '/flowers/flower-svgrepo-com.svg',
  '/flowers/flower_31.svg',
  '/flowers/johnny-automatic-rose-3.svg',
  '/flowers/leaf-organic-2-svgrepo-com.svg',
  '/flowers/yellow-flower-2-svgrepo-com.svg',
  '/flowers/yves_guillou_Dahlia.svg',
];

/* Warm the SVGs into the browser's cache the first time the effect is armed.
   Without this, the opening 40 blooms each kick off their own request for a file
   nobody has fetched yet, and the burst stutters on its first frame. */
let flowersPreloaded = false;
function preloadFlowers() {
  if (flowersPreloaded || typeof Image === 'undefined') return;
  flowersPreloaded = true;
  for (const src of FLOWER_SVGS) {
    const img = new Image();
    img.src = src;
  }
}

const flowers: RelaxEffect = {
  id: 'flowers',
  label: 'Flower Burst',
  group: 'Garden',
  blurb: 'Blooms pop from your cursor and drift away on the breeze.',
  space: 'world',
  flash: 'rgba(255, 140, 170, 0.55)',
  burstMs: 10_000,
  /* Cut back from 55/3/900.
     Every bloom carried `filter: drop-shadow(…)`, and a CSS filter forces the
     compositor to give that element its OWN render surface. Nine hundred of them
     meant nine hundred surfaces, so tapping four or five spots at once — which is
     exactly what people do with this one — dropped the frame rate through the
     floor. The shadow is gone and the ceiling is less than half what it was; the
     burst still reads as "a lot of flowers" and it now holds 60fps while you
     hammer the canvas. (RelaxEffectsLayer also divides the emission rate between
     concurrent taps, so N bursts cost about what one used to.) */
  openingPop: 40,
  spawnEveryMs: 55,
  spawnPerTick: 2,
  maxParticles: 420,
  onStart() {
    preloadFlowers();
  },
  create(x, y, now) {
    const size = rand(26, 64);
    const el = document.createElement('img');
    (el as HTMLImageElement).src = pick(FLOWER_SVGS);
    (el as HTMLImageElement).alt = '';
    (el as HTMLImageElement).draggable = false;
    baseStyle(el, size);

    const p = particle(el, x + rand(-10, 10), y + rand(-10, 10), size, rand(3200, 5200), now);
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(3.5, 11) * (0.55 + Math.random() * 0.45);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.rot = rand(0, 360);
    p.spin = rand(-5, 5);
    p.maxScale = rand(0.75, 1.25);
    p.a = rand(-0.075, 0.03); // buoyancy: most rise, a few settle
    p.b = rand(6, 22); // sway amplitude
    p.c = rand(0.8, 2.4); // sway frequency
    p.d = rand(0, Math.PI * 2); // sway phase
    return p;
  },
  // Deliberately flat: no 3D tumble, no fade-in. A rotateX here reads as the
  // flowers being squashed wide, not as petals turning. This is the version that
  // works — leave it alone.
  step(p, t) {
    p.vx *= 0.955;
    p.vy = p.vy * 0.955 + p.a;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;

    const sway = Math.sin(t * p.c * Math.PI * 2 + p.d) * p.b;
    const scale = p.maxScale * popIn(t);

    p.el.style.transform =
      `translate3d(${p.x + sway - p.size / 2}px, ${p.y - p.size / 2}px, 0) ` +
      `rotate(${p.rot}deg) scale(${scale})`;
    p.el.style.opacity = String(t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1);
  },
};

/* ----------------------------------------------------- blooming / petalfall */

/* Both of the botanical effects below draw from lib/bloomAssets.ts — 146 PNGs
   of real flowers and leaves. The two of them split the artwork along the one
   axis that matters for motion: a bloom is drawn FACING YOU and may only ever
   be turned in the plane, while a leaf is a flat blade and can be tumbled in
   3D. Rotating a face-on bloom about X or Y doesn't read as petals turning, it
   reads as the flower being squashed — the same trap documented on the older
   flower burst above. */

/* Warm a slice of the artwork when either effect is first armed, so the opening
   pop isn't 40 simultaneous first-time requests. Callers deliberately hand over
   a SLICE and not the whole library: warming all 146 would put that many
   requests in flight for artwork most bursts never reach. The flag is shared
   between the two effects because the browser cache is too. */
let bloomAssetsPreloaded = false;
function preloadBloomAssets(urls: readonly string[]) {
  if (bloomAssetsPreloaded || typeof Image === 'undefined') return;
  bloomAssetsPreloaded = true;
  for (const src of urls) {
    const img = new Image();
    img.src = src;
  }
}

/* ----------------------------------------------------------------- blooming */

const BLOOM_STEM_GREENS = [
  ['#3f7a35', '#6bab53'],
  ['#356b3d', '#5f9d63'],
  ['#4a7c3f', '#78b264'],
  ['#2f6b46', '#57a271'],
];

/**
 * One particle is one whole plant: a wrapper holding a stem, two leaves and a
 * flower head. The unfurl — stem extending, leaves opening, bud blowing open —
 * is CSS keyframes on those children (see `.bloom-*` in globals.css), so it
 * runs on the compositor and `step` is left doing what it is allowed to do:
 * one transform and one opacity, on one node, for the whole plant.
 */
const blooming: RelaxEffect = {
  id: 'blooming',
  label: 'Blooming Garden',
  group: 'Garden',
  blurb: 'Press the canvas and a flowerbed grows out of it — stems climb, leaves unfurl, and the buds blow open in their own time.',
  space: 'world',
  flash: 'rgba(150, 205, 145, 0.42)',
  burstMs: 9_000,
  openingPop: 7,
  spawnEveryMs: 300,
  spawnPerTick: 1,
  // A plant is four DOM nodes, not one, so the ceiling is far lower than the
  // flower burst's — this is a garden filling in, not confetti.
  maxParticles: 80,
  onStart() {
    preloadBloomAssets(BLOOM_FLOWERS.slice(0, 24).concat(BLOOM_LEAVES.slice(0, 12)));
  },
  onBurst(x, y, api) {
    playKoto(pick(PENTATONIC), 0.2);
    api.spawn(x, y, 14, 1); // pollen shaken loose
  },
  create(x, y, now, api, kind, _tint, index) {
    /* ---- pollen ---- */
    if (kind === 1) {
      const size = rand(2.5, 5);
      const el = document.createElement('div');
      baseStyle(el, size, 'border-radius:50%;background:#f6d873;box-shadow:0 0 5px rgba(246,216,115,0.8);');
      const p = particle(el, x + rand(-60, 60), y + rand(-20, 14), size, rand(2600, 4600), now);
      p.kind = 1;
      p.vx = rand(-0.35, 0.35);
      p.vy = rand(-0.55, -0.16);
      p.a = rand(8, 26); // drift amplitude
      p.c = rand(0.5, 1.4);
      p.d = rand(0, Math.PI * 2);
      p.b = rand(0.45, 0.9); // peak opacity
      return p;
    }

    /* ---- a plant ---- */
    const head = rand(30, 58);
    const stemLen = rand(48, 124);

    /* Nothing in a flowerbed grows plumb. Each stalk gets a few degrees of lean,
       and every part that rides it — the head at the tip, both leaves partway up
       — is placed along that leaned line here, at create time. Get this wrong
       and the flower floats off the end of its own stem. */
    const lean = rand(-8, 8);
    const rad = (lean * Math.PI) / 180;
    const sinL = Math.sin(rad);
    const cosL = Math.cos(rad);

    const w = head + Math.abs(sinL) * stemLen * 2;
    // The head's anchor sits 78% of the way down its own box (roughly where the
    // petals meet the stalk), so the wrapper is exactly tall enough to put that
    // anchor on the tip of the stem with no dead space above or below.
    const h = cosL * stemLen + head * 0.78;
    const midX = w / 2;

    const el = document.createElement('div');
    baseStyle(el, w, `height:${h}px;transform-origin:50% 100%;`);

    const [dark, light] = pick(BLOOM_STEM_GREENS);
    const stemW = rand(2.1, 3.6);
    const stem = document.createElement('div');
    stem.className = 'bloom-stem';
    stem.style.cssText =
      `position:absolute;left:${midX - stemW / 2}px;bottom:0;width:${stemW}px;height:${stemLen}px;` +
      `background:linear-gradient(to top, ${dark}, ${light});` +
      // A rectangle reads as a fence post. The taper is what makes it a stalk.
      'clip-path:polygon(12% 100%, 88% 100%, 66% 0%, 34% 0%);' +
      `transform-origin:50% 100%;--stem-lean:${lean.toFixed(2)}deg;` +
      `animation-duration:${(700 + stemLen * 2.2).toFixed(0)}ms;`;
    el.appendChild(stem);

    // Leaves ride the stalk at two different heights, one to each side.
    for (let i = 0; i < 2; i++) {
      const lf = document.createElement('img');
      lf.src = pick(BLOOM_LEAVES);
      lf.alt = '';
      lf.draggable = false;
      lf.className = 'bloom-leaf';
      const ls = head * rand(0.3, 0.46);
      const side = i === 0 ? -1 : 1;
      const up = stemLen * (i === 0 ? rand(0.22, 0.4) : rand(0.46, 0.68));
      lf.style.cssText =
        `position:absolute;left:${midX + sinL * up + side * ls * 0.52 - ls / 2}px;` +
        `bottom:${cosL * up}px;width:${ls}px;height:${ls}px;max-width:none;max-height:none;` +
        `transform-origin:${side < 0 ? '100%' : '0%'} 50%;` +
        `--leaf-tilt:${(lean + side * rand(18, 42)).toFixed(1)}deg;` +
        `animation-delay:${(160 + i * 150).toFixed(0)}ms;`;
      el.appendChild(lf);
    }

    const bloom = document.createElement('img');
    bloom.src = pick(BLOOM_FLOWERS);
    bloom.alt = '';
    bloom.draggable = false;
    bloom.className = 'bloom-head';
    bloom.style.cssText =
      `position:absolute;left:${midX + sinL * stemLen - head / 2}px;top:0;` +
      `width:${head}px;height:${head}px;` +
      'max-width:none;max-height:none;transform-origin:50% 78%;' +
      // The head carries the stalk's lean plus a little of its own, so it sits
      // on the tip rather than staring straight up out of a bent stem.
      `--head-tilt:${(lean * 0.7 + rand(-7, 7)).toFixed(1)}deg;` +
      `animation-delay:${(220 + stemLen * 1.6).toFixed(0)}ms;`;
    el.appendChild(bloom);

    /* Fan successive plants around the press instead of scattering them, so a
       held burst fills a bed rather than piling everything on one spot. */
    const spread = 118;
    const a = (index ?? 0) * 2.399963; // golden angle
    const p = particle(
      el,
      x + Math.cos(a) * spread * Math.sqrt(((index ?? 0) % 9) / 9) + rand(-14, 14),
      y + rand(-16, 22),
      w,
      rand(8500, 13500),
      now
    );
    p.kind = 0;
    p.a = h;
    p.b = rand(1.1, 3.4); // breeze, in degrees
    p.c = rand(0.16, 0.42);
    p.d = rand(0, Math.PI * 2);
    return p;
  },
  step(p, t, now) {
    if (p.kind === 1) {
      p.vy *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      const drift = Math.sin(now / 1000 * p.c + p.d) * p.a;
      p.el.style.transform = `translate3d(${p.x + drift - p.size / 2}px, ${p.y - p.size / 2}px, 0)`;
      p.el.style.opacity = String(p.b * Math.min(1, t * 6) * (t > 0.55 ? (1 - t) / 0.45 : 1));
      return;
    }

    // Two breaths at unrelated rates, so a bed of them never sways in unison.
    const sway =
      Math.sin(now / 1000 * p.c + p.d) * p.b +
      Math.sin(now / 1000 * p.c * 2.7 + p.d) * p.b * 0.28;

    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.a}px, 0) rotate(${sway.toFixed(2)}deg)`;
    p.el.style.opacity = String(t > 0.82 ? (1 - t) / 0.18 : 1);
  },
};

/* ---------------------------------------------------------------- petalfall */

/** Blossoms drift face-on; leaves tumble. */
const PETAL_BLOSSOM = 0;
const PETAL_LEAF = 1;

/* The opening pop should arrive as a sky that is ALREADY full, not as an empty
   screen you wait three seconds for. For a moment after the effect starts,
   `create` seeds anywhere on the viewport; after that everything enters from
   above the top edge, the way weather actually does. */
let petalSeedUntil = 0;

const petalfall: RelaxEffect = {
  id: 'petalfall',
  label: 'Petal Drift',
  group: 'Garden',
  blurb: 'Blossom and leaf come down across the whole canvas, on a wind that gusts and settles. Lasts a minute.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 70,
  spawnEveryMs: 150,
  spawnPerTick: 2,
  maxParticles: 240,
  onStart() {
    petalSeedUntil = performance.now() + 400;
    startAmbience('wind');
    preloadBloomAssets(BLOOM_FLOWERS.slice(0, 24).concat(BLOOM_LEAVES.slice(0, 12)));
  },
  onStop() {
    stopAmbience('wind');
  },
  create(_x, _y, now, api, kind) {
    const { w, h } = api.viewport;
    const isLeaf = kind !== undefined ? kind === PETAL_LEAF : Math.random() < 0.42;

    /* Depth drives size, speed, opacity and how hard the wind pushes it, all
       from one number. Without that correlation the fall is a flat sheet of
       identical petals; with it, the near ones sweep past and the far ones
       hang back. */
    const near = Math.random() ** 1.4; // biased far — most of the fall is distance
    const size = (isLeaf ? rand(16, 44) : rand(20, 54)) * (0.6 + near * 0.8);

    const el = document.createElement('img');
    el.src = pick(isLeaf ? BLOOM_LEAVES : BLOOM_FLOWERS);
    el.alt = '';
    el.draggable = false;
    baseStyle(el, size);

    const seeding = now < petalSeedUntil;
    const p = particle(
      el,
      rand(-60, w + 60),
      seeding ? rand(-h * 0.2, h) : rand(-h * 0.35, -size),
      size,
      rand(14_000, 24_000),
      now
    );
    p.kind = isLeaf ? PETAL_LEAF : PETAL_BLOSSOM;
    p.maxScale = near;
    p.vy = 0.42 + near * 1.5;
    p.vx = rand(-0.2, 0.45);
    p.rot = rand(0, 360);
    p.a = rand(16, 62); // sway amplitude
    p.c = rand(0.12, 0.44); // sway frequency
    p.d = rand(0, Math.PI * 2);
    p.b = 0.5 + near * 0.5; // opacity
    // In-plane drift only — slow enough that nothing looks like it is spinning.
    // A leaf's actual tumble is the rock applied in `step`.
    p.spin = isLeaf ? rand(-0.3, 0.3) : rand(-0.25, 0.25);
    return p;
  },
  step(p, t, now, api) {
    const { w, h } = api.viewport;

    // One wind for the whole fall, read straight off the clock so every petal
    // agrees about it without anything having to store it.
    const wind = Math.sin(now / 3800) * 1.5 + Math.sin(now / 1450 + 1.7) * 0.55;

    p.x += p.vx + wind * (0.35 + p.maxScale);
    p.y += p.vy;
    p.rot += p.spin;

    // Recycle rather than churn: a minute of weather would otherwise create and
    // destroy thousands of nodes.
    if (p.y > h + 60) {
      p.y = rand(-140, -p.size);
      p.x = rand(-60, w + 60);
    }
    if (p.x > w + 90) p.x = -80;
    else if (p.x < -90) p.x = w + 80;

    const drift = Math.sin(now / 1000 * p.c + p.d) * p.a;
    const x = p.x + drift - p.size / 2;
    const y = p.y - p.size / 2;

    if (p.kind === PETAL_LEAF) {
      /* The tumble — allowed here and not on a bloom, because a leaf is a flat
         blade and turning one through edge-on is exactly what it does on the
         way down. It ROCKS rather than spins: swept past ±90° a leaf goes
         genuinely invisible for a few frames and reads as a stray green scratch
         on the page, so the sweep stops short of the edge and always leaves
         some face showing. The perspective is what keeps the turn from reading
         as a flat horizontal squash. */
      const turn = Math.sin(now / 1000 * p.c * 3.4 + p.d) * (58 + p.a * 0.3);
      p.el.style.transform =
        `translate3d(${x}px, ${y}px, 0) perspective(340px) ` +
        `rotateY(${turn.toFixed(1)}deg) rotateX(${(turn * 0.28).toFixed(1)}deg) ` +
        `rotate(${p.rot.toFixed(1)}deg)`;
    } else {
      p.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${p.rot.toFixed(1)}deg)`;
    }

    p.el.style.opacity = String(p.b * Math.min(1, t * 10) * (t > 0.93 ? (1 - t) / 0.07 : 1));
  },
};

/* --------------------------------------------------------------------- rain */

/** Every timer the storm owns, so onStop can kill the lot. */
let stormTimers: number[] = [];

const rain: RelaxEffect = {
  id: 'rain',
  label: 'Rainfall',
  group: 'Water',
  blurb: 'A full minute of downpour across the whole canvas, with real rain on the soundtrack and lightning cracking overhead every so often.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 160,
  spawnEveryMs: 40,
  spawnPerTick: 9,
  maxParticles: 700,
  onStart(x, y, api) {
    startRain();

    // Storm veil. It also solves a contrast problem: the lightning is white-hot,
    // and the canvas may be on a light paper background, where a white bolt would
    // be invisible. Dimming the whole viewport gives it something to burn against.
    const veil = document.createElement('div');
    veil.dataset.rainVeil = '';
    veil.style.cssText =
      'position:absolute;inset:0;pointer-events:none;background:rgba(10,18,34,0.42);' +
      'opacity:0;transition:opacity 900ms ease;';
    api.screen.appendChild(veil);
    requestAnimationFrame(() => {
      veil.style.opacity = '1';
    });

    const strike = () => {
      if (!veil.isConnected) return; // storm already over

      const bolt = document.createElement('div');
      bolt.dataset.lightning = '';
      // Throw the bolt somewhere new each time, and flip it now and then, so a
      // minute of storm doesn't replay the same photograph.
      const flip = Math.random() < 0.5 ? -1 : 1;
      const cx = 25 + Math.random() * 50;
      bolt.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;' +
        `transform:scaleX(${flip});` +
        // thunder.svg is a solid-black potrace trace, so it is used as a mask and
        // lit from behind rather than drawn directly.
        `-webkit-mask:url('/thunder.svg') no-repeat ${cx}% 10%/${60 + Math.random() * 25}% auto;` +
        `mask:url('/thunder.svg') no-repeat ${cx}% 10%/${60 + Math.random() * 25}% auto;` +
        'background:linear-gradient(180deg, #ffffff 0%, #dceaff 45%, #9ec5ff 100%);' +
        'filter:drop-shadow(0 0 40px rgba(190, 225, 255, 0.9));';
      api.screen.appendChild(bolt);

      const glow = document.createElement('div');
      glow.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;' +
        `background:radial-gradient(ellipse at ${cx}% 10%, rgba(215,235,255,0.75), transparent 62%);`;
      api.screen.appendChild(glow);

      // Real lightning stutters — bright, gone, brighter, gone, then an afterglow.
      // The hold has to be declared per keyframe: `easing` in the timing options
      // is the *iteration* easing, so a `steps()` there pins the whole animation's
      // progress at 0 and the bolt never lights at all.
      const flicker: Keyframe[] = [
        { offset: 0, opacity: 0, easing: 'steps(1, end)' },
        { offset: 0.05, opacity: 1, easing: 'steps(1, end)' },
        { offset: 0.13, opacity: 0.12, easing: 'steps(1, end)' },
        { offset: 0.2, opacity: 0.95, easing: 'steps(1, end)' },
        { offset: 0.28, opacity: 0.1, easing: 'steps(1, end)' },
        { offset: 0.36, opacity: 0.8, easing: 'linear' },
        { offset: 1, opacity: 0 },
      ];
      const timing: KeyframeAnimationOptions = { duration: 1400, easing: 'linear' };

      const a1 = bolt.animate(flicker, timing);
      const a2 = glow.animate(flicker, timing);
      a1.onfinish = () => bolt.remove();
      a1.oncancel = () => bolt.remove();
      a2.onfinish = () => glow.remove();
      a2.oncancel = () => glow.remove();

      // The thunder is already in the rain recording, so no extra boom here —
      // just keep the sky busy for as long as the storm lasts.
      stormTimers.push(window.setTimeout(strike, rand(9000, 16000)));
    };

    stormTimers.push(window.setTimeout(strike, 2000));
  },
  onStop(api) {
    stopRain();
    for (const id of stormTimers) clearTimeout(id);
    stormTimers = [];
    const veil = api.screen.querySelector<HTMLElement>('[data-rain-veil]');
    if (!veil) return;
    veil.style.opacity = '0';
    window.setTimeout(() => veil.remove(), 950);
  },
  create(_x, _y, now, api) {
    const { w, h } = api.viewport;
    const len = rand(14, 46);
    const el = document.createElement('div');
    baseStyle(
      el,
      1.6,
      `height:${len}px;border-radius:2px;` +
        'background:linear-gradient(to bottom, rgba(190,220,255,0), rgba(205,230,255,0.85));'
    );

    // Rain ignores the click point — it falls across the entire viewport. Start
    // above the top edge and spread beyond the right so the slant still covers
    // the left as drops drift across.
    const p = particle(el, rand(-120, w + 120), rand(-h * 0.5, -20), 1.6, rand(1400, 2600), now);
    p.a = len;
    p.vy = rand(13, 24);
    p.vx = p.vy * 0.18; // consistent slant — every drop rides the same wind
    p.b = rand(0.35, 0.85); // opacity: near drops are bold, far drops are faint
    return p;
  },
  step(p, t, _now, api) {
    p.x += p.vx;
    p.y += p.vy;

    // Recycle instead of dying: a drop that leaves the bottom starts again at the
    // top. Keeps the downpour dense without churning DOM nodes.
    if (p.y > api.viewport.h + 40) {
      p.y = rand(-140, -20);
      p.x = rand(-120, api.viewport.w + 120);
    }

    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${-10}deg)`;
    p.el.style.opacity = String(p.b * (t > 0.9 ? (1 - t) / 0.1 : Math.min(1, t * 8)));
  },
};

/* ---------------------------------------------------------------- fireworks */

const FIREWORK_COLORS = [
  '#FF4D6D', '#FFD60A', '#38F8B0', '#5BC0FF', '#C77DFF', '#FF9E00', '#FFFFFF',
];

const SHELL = 0;
const SPARK = 1;
const TRAIL = 2;

const fireworks: RelaxEffect = {
  id: 'fireworks',
  label: 'Fireworks',
  group: 'Sky',
  blurb: 'Shells climb from your cursor trailing sparks, hang for a beat, then burst into the sky.',
  space: 'world',
  flash: 'rgba(255, 214, 10, 0.4)',
  burstMs: 10_000,
  openingPop: 1,
  spawnEveryMs: 850,
  spawnPerTick: 1,
  maxParticles: 1400,
  create(x, y, now, _api, kind = SHELL, tint) {
    const color = tint ?? pick(FIREWORK_COLORS);

    if (kind === SHELL) {
      playLaunch();
      const el = document.createElement('div');
      baseStyle(el, 5, `border-radius:50%;background:#fff;box-shadow:0 0 12px 3px ${color};`);
      // Long enough to clear the launch point and hang at the top of the climb.
      const p = particle(el, x + rand(-45, 45), y, 5, rand(750, 1050), now);
      p.kind = SHELL;
      p.tint = color;
      p.vx = rand(-1.2, 1.2);
      p.vy = -rand(8.5, 13);
      p.a = 0.14; // gravity
      return p;
    }

    if (kind === TRAIL) {
      const size = rand(1.5, 3.5);
      const el = document.createElement('div');
      baseStyle(el, size, `border-radius:50%;background:${color};box-shadow:0 0 6px ${color};`);
      const p = particle(el, x, y, size, rand(280, 520), now);
      p.kind = TRAIL;
      p.tint = color;
      p.vx = rand(-0.4, 0.4);
      p.vy = rand(0, 0.8);
      return p;
    }

    // Spark. Radial burst, then gravity takes over and it rains down.
    const size = rand(2, 5);
    const el = document.createElement('div');
    baseStyle(el, size, `border-radius:50%;background:${color};box-shadow:0 0 ${size * 3}px ${size}px ${color}AA;`);

    const p = particle(el, x, y, size, rand(900, 1900), now);
    p.kind = SPARK;
    p.tint = color;
    const angle = Math.random() * Math.PI * 2;
    // Squaring a uniform random pushes sparks toward the outside of the shell,
    // which is what gives the burst a defined edge instead of a soft blob.
    const speed = rand(1.5, 9) * (0.4 + Math.pow(Math.random(), 0.5) * 0.6);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.a = 0.07; // gravity
    p.b = rand(4, 9); // twinkle rate
    p.c = rand(0, Math.PI * 2);
    return p;
  },
  step(p, t, now, api) {
    if (p.kind === SHELL) {
      p.vy += p.a;
      p.x += p.vx;
      p.y += p.vy;
      // Smoke trail on the way up.
      if (Math.random() < 0.55) api.spawn(p.x, p.y, 1, TRAIL, p.tint);
      p.el.style.transform = `translate3d(${p.x - 2.5}px, ${p.y - 2.5}px, 0)`;
      p.el.style.opacity = '1';
      return;
    }

    if (p.kind === TRAIL) {
      p.x += p.vx;
      p.y += p.vy;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 - t})`;
      p.el.style.opacity = String((1 - t) * 0.7);
      return;
    }

    p.vx *= 0.965;
    p.vy = p.vy * 0.965 + p.a;
    p.x += p.vx;
    p.y += p.vy;

    // Sparks don't just fade, they flicker out — that's the crackle you see.
    const twinkle = 0.55 + 0.45 * Math.sin(now / 1000 * p.b + p.c);
    const opacity = (t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1) * twinkle;
    p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0)`;
    p.el.style.opacity = String(opacity);
  },
  onDeath(p, api) {
    if (p.kind !== SHELL) return;
    playBoom();
    api.spawn(p.x, p.y, 90, SPARK, p.tint);
  },
};

/* ------------------------------------------------------------------- galaxy
   Rebuilt from flat coloured dots into an actual spiral galaxy: a glowing gold
   core BULGE, two arms of stars whose colour runs from hot blue-white youngsters
   to warm old suns with pink HII regions between them, faint blurred NEBULA gas
   riding the arms, a scatter of DUST for depth, and — because a bright galaxy
   vanishes on light paper — its own pocket of dark SPACE to glow against in
   light mode. Every element is additive ('screen') so overlapping stars and gas
   sum into real brightness the way light does. */

const GALAXY_BLUE = ['#EAF3FF', '#CFE4FF', '#FFFFFF', '#BFD8FF', '#A9CCFF'];
const GALAXY_WARM = ['#FFF1D6', '#FFE0AE', '#FFE9C7', '#FFD9A0'];
const GALAXY_HII = ['#FFB0D4', '#F09BFF', '#FF9EC6', '#E58AFF'];
const GALAXY_TEAL = ['#BFF6FF', '#9FE9FF'];
const GALAXY_NEBULA = ['#7A5CFF', '#FF6FB5', '#3FC7E6', '#B06CFF', '#FF8AA8'];

const GX_STAR = 0;
const GX_DUST = 1;
const GX_NEBULA = 2;
const GX_CORE = 3;
const GX_SPACE = 4;

/** Rate-limit the heavy blurred backdrop so hammering the canvas can't stack a
 *  dozen of them. */
let lastGalaxySpace = 0;

/** Give a spiralling particle its arm + orbit state. */
function galaxyOrbit(p: Particle, growthLo: number, growthHi: number, sweepLo: number, sweepHi: number) {
  const arm = Math.random() < 0.5 ? 0 : Math.PI;
  p.a = arm + rand(-0.22, 0.22);   // arm angle (tight jitter — wide washes it flat)
  p.b = rand(4, 26);               // starting radius, rooted near the core
  p.c = rand(growthLo, growthHi);  // radial growth per frame
  p.d = rand(sweepLo, sweepHi);    // sweep rate (differential rotation in step)
}

const galaxy: RelaxEffect = {
  id: 'galaxy',
  label: 'Galaxy Swirl',
  group: 'Sky',
  blurb: 'A whole spiral galaxy winds out of your cursor — a molten core, arms of blue-white and gold stars laced with glowing gas, turning in deep space.',
  space: 'world',
  flash: 'rgba(150, 130, 255, 0.4)',
  burstMs: 10_000,
  openingPop: 80,
  spawnEveryMs: 45,
  spawnPerTick: 5,
  maxParticles: 1100,
  onBurst(x, y, api) {
    playSparkle();
    const now = performance.now();
    // Dark space to glow against — only in light mode, and only occasionally.
    if (!api.isDark && now - lastGalaxySpace > 2200) {
      lastGalaxySpace = now;
      api.spawn(x, y, 1, GX_SPACE);
    }
    api.spawn(x, y, 1, GX_CORE);         // the bulge
    api.spawn(x, y, 3, GX_NEBULA);       // a few gas clouds along the arms
    api.spawn(x, y, 26, GX_DUST);        // faint field stars for depth
  },
  create(x, y, now, api, kind = GX_STAR) {
    /* ---- the dark space pocket (light mode only) ---- */
    if (kind === GX_SPACE) {
      const size = rand(580, 780);
      const el = document.createElement('div');
      baseStyle(
        el, size,
        'border-radius:50%;filter:blur(10px);' +
          'background:radial-gradient(circle, rgba(6,8,22,0.86) 0%, rgba(10,14,32,0.62) 36%,' +
          ' rgba(16,20,40,0.28) 60%, rgba(20,24,46,0) 76%);'
      );
      const p = particle(el, x, y, size, rand(7000, 9000), now);
      p.kind = GX_SPACE;
      return p;
    }

    /* ---- the glowing core bulge ---- */
    if (kind === GX_CORE) {
      const size = rand(140, 200);
      const el = document.createElement('div');
      baseStyle(
        el, size,
        'border-radius:50%;mix-blend-mode:screen;' +
          'background:radial-gradient(circle, rgba(255,248,232,0.98) 0%, rgba(255,224,168,0.72) 20%,' +
          ' rgba(255,186,128,0.34) 44%, rgba(196,150,255,0.16) 66%, rgba(120,90,220,0) 80%);'
      );
      const p = particle(el, x, y, size, rand(3400, 4400), now);
      p.kind = GX_CORE;
      p.d = rand(0, Math.PI * 2); // pulse phase
      return p;
    }

    /* ---- blurred nebula gas that rides an arm ---- */
    if (kind === GX_NEBULA) {
      const size = rand(80, 170);
      const color = pick(GALAXY_NEBULA);
      const el = document.createElement('div');
      baseStyle(
        el, size,
        'border-radius:50%;filter:blur(18px);mix-blend-mode:screen;' +
          `background:radial-gradient(circle, ${color}66 0%, ${color}2e 48%, ${color}00 72%);`
      );
      const p = particle(el, x, y, size, rand(4200, 6800), now);
      p.kind = GX_NEBULA;
      galaxyOrbit(p, 0.14, 0.34, 0.03, 0.055); // big, slow, drifts with the arm
      p.maxScale = rand(0.85, 1.3);
      return p;
    }

    /* ---- a star (or, when tiny & dim, a dust mote) ---- */
    const dust = kind === GX_DUST;
    const bright = !dust && Math.random() < 0.14;
    const size = dust ? rand(0.8, 1.8) : bright ? rand(3.4, 6.5) : rand(1.4, 3.2);

    // Colour by population: mostly hot blue-white, a good share of warm suns,
    // a sprinkle of pink star-forming regions, a rare teal.
    const r = Math.random();
    const color =
      r < 0.52 ? pick(GALAXY_BLUE)
      : r < 0.76 ? pick(GALAXY_WARM)
      : r < 0.9 ? pick(GALAXY_HII)
      : pick(GALAXY_TEAL);

    const el = document.createElement('div');
    const glow = dust ? 0 : bright ? size * 3.2 : size * 2;
    baseStyle(
      el, size,
      `border-radius:50%;background:${color};mix-blend-mode:screen;` +
        (dust ? '' : `box-shadow:0 0 ${glow}px ${size * 0.5}px ${color}cc;`)
    );

    const p = particle(el, x, y, size, rand(4200, 7400), now);
    p.kind = dust ? GX_DUST : GX_STAR;
    p.tint = color;
    galaxyOrbit(p, 0.3, 0.78, 0.045, 0.085);
    p.maxScale = dust ? rand(0.6, 1) : 1;
    p.vx = rand(1.4, 4.2);        // twinkle rate
    p.vy = rand(0, Math.PI * 2);  // twinkle phase
    p.b += dust ? rand(0, 40) : 0; // dust starts more scattered
    return p;
  },
  step(p, t, now) {
    if (p.kind === GX_SPACE) {
      const fade = t < 0.08 ? t / 0.08 : t > 0.82 ? (1 - t) / 0.18 : 1;
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0)`;
      p.el.style.opacity = String(fade * 0.9);
      return;
    }

    if (p.kind === GX_CORE) {
      const pulse = 1 + Math.sin(now / 1000 * 1.7 + p.d) * 0.05;
      const scale = popIn(t, 0.14) * pulse;
      const fade = t < 0.1 ? t / 0.1 : t > 0.58 ? 1 - (t - 0.58) / 0.42 : 1;
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
      p.el.style.opacity = String(fade);
      return;
    }

    // Stars, dust and nebula all spiral. Differential rotation (the sweep slows
    // with radius) is what bends straight spokes into trailing arms.
    p.b += p.c;
    p.a += p.d / Math.sqrt(p.b);
    const gx = p.x + Math.cos(p.a) * p.b;
    const gy = p.y + Math.sin(p.a) * p.b * 0.42; // vertical squash = a tilted disc

    if (p.kind === GX_NEBULA) {
      const fade = t < 0.12 ? t / 0.12 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
      p.el.style.transform = `translate3d(${gx - p.size / 2}px, ${gy - p.size / 2}px, 0) scale(${p.maxScale})`;
      p.el.style.opacity = String(fade * 0.9);
      return;
    }

    // Twinkle: stars shimmer as they turn; dust is steady and faint.
    const twinkle = p.kind === GX_DUST ? 0.5 : 0.7 + 0.3 * Math.sin(now / 1000 * p.vx + p.vy);
    const life = t < 0.08 ? t / 0.08 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
    const scale = popIn(t, 0.1) * p.maxScale;
    p.el.style.transform = `translate3d(${gx - p.size / 2}px, ${gy - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String(life * twinkle);
  },
};

/* -------------------------------------------------------------- bubble wrap */

const CELL = 88;
/** Grid geometry for the current sheet — set in onBurst, read back in create. */
let wrap = { cols: 0, ox: 0, oy: 0 };

const POPPED = 1;

const bubblewrap: RelaxEffect = {
  id: 'bubblewrap',
  label: 'Bubble Wrap',
  group: 'Play',
  blurb: 'A whole sheet of it. Work your way across and pop every blister — each one snaps. Click the canvas again for a fresh sheet.',
  space: 'screen',
  flash: '',
  // The sheet is laid by hand in onBurst, so there is nothing to emit.
  burstMs: 0,
  openingPop: 0,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 900,
  interactive: true,
  onBurst(_x, _y, api) {
    const { w, h } = api.viewport;
    const cols = Math.max(3, Math.floor((w - 60) / CELL));
    const rows = Math.max(3, Math.floor((h - 150) / CELL));
    wrap = {
      cols,
      ox: (w - cols * CELL) / 2 + CELL / 2,
      oy: (h - rows * CELL) / 2 + CELL / 2 - 20,
    };
    // A fresh sheet, not a second sheet stacked on the first.
    api.clear();
    api.spawn(0, 0, cols * rows, 0);
  },
  create(x, y, now, _api, kind = 0, _tint, index = 0) {
    if (kind === POPPED) {
      // The spent blister, left where it died. The sheet keeps a record of what
      // you've already been through — which is most of the point of bubble wrap.
      const size = 58;
      const el = document.createElement('div');
      baseStyle(
        el,
        size,
        'border-radius:50%;' +
          'background:radial-gradient(circle at 50% 45%, rgba(90,120,160,0.20), rgba(90,120,160,0.06) 70%);' +
          'box-shadow:inset 0 4px 10px rgba(0,0,0,0.30), inset 0 -2px 6px rgba(255,255,255,0.18);'
      );
      const p = particle(el, x, y, size, 120_000, now);
      p.kind = POPPED;
      return p;
    }

    const size = 58;
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        'backdrop-filter:blur(1.5px) brightness(1.06);' +
        '-webkit-backdrop-filter:blur(1.5px) brightness(1.06);' +
        'border:1px solid rgba(255,255,255,0.5);' +
        'background:radial-gradient(circle at 34% 30%, rgba(255,255,255,0.82), rgba(255,255,255,0.10) 42%,' +
        ' rgba(150,205,255,0.16) 70%);' +
        'box-shadow:inset -4px -6px 12px rgba(60,100,150,0.25), inset 4px 6px 12px rgba(255,255,255,0.45),' +
        ' 0 2px 6px rgba(0,0,0,0.18);'
    );

    const col = index % wrap.cols;
    const row = Math.floor(index / wrap.cols);
    const p = particle(el, wrap.ox + col * CELL, wrap.oy + row * CELL, size, 120_000, now);
    p.kind = 0;
    // Stagger the pop-in so the sheet unrolls diagonally instead of appearing.
    p.a = (col + row) * 22;
    p.b = rand(0.96, 1.04); // no two blisters are quite the same size
    return p;
  },
  step(p, t, now) {
    if (p.kind === POPPED) {
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(0.86)`;
      p.el.style.opacity = '0.85';
      return;
    }

    const age = now - p.born - p.a;
    if (age < 0) {
      p.el.style.opacity = '0';
      return;
    }
    const intro = Math.min(1, age / 260);
    const scale = p.b * (0.6 + popIn(intro, 1) * 0.4);

    p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String(intro);
  },
  onPop(p, api) {
    playSnap();
    api.spawn(p.x, p.y, 1, POPPED);
  },
};

/* ------------------------------------------------------------------- chimes */

const ROD_COUNT = 9;
const RACK_TOP = 74; // where the beam hangs
const BEAM = 1;

const rackSpread = (w: number) => Math.min(w - 140, 620);
const rodX = (w: number, index: number) =>
  w / 2 - rackSpread(w) / 2 + (index / (ROD_COUNT - 1)) * rackSpread(w);

const chimes: RelaxEffect = {
  id: 'chimes',
  label: 'Wind Chimes',
  group: 'Stillness',
  blurb: 'A rack of chimes hangs over the canvas. Sweep your cursor through them and they swing and ring — every note is in key.',
  space: 'screen',
  flash: '',
  burstMs: 0,
  openingPop: ROD_COUNT,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 14,
  interactive: true,
  hover: true, // sweeping the cursor across the rack plays it like an instrument
  consumeOnPop: false, // a chime rings and keeps swinging; it doesn't vanish
  onBurst(_x, _y, api) {
    api.clear();
    // The beam is a particle rather than loose furniture, so the engine tears it
    // down with everything else when the tool is put away.
    api.spawn(0, 0, 1, BEAM);
  },
  create(_x, _y, now, api, kind = 0, _tint, index = 0) {
    const { w } = api.viewport;

    if (kind === BEAM) {
      const spread = rackSpread(w) + 46;
      const el = document.createElement('div');
      baseStyle(
        el,
        spread,
        'height:7px;border-radius:4px;' +
          'background:linear-gradient(180deg, #d9c3a5 0%, #a98963 40%, #7d6244 100%);' +
          'box-shadow:0 3px 10px rgba(0,0,0,0.35);'
      );
      const p = particle(el, w / 2 - spread / 2, RACK_TOP - 7, spread, 60_000, now);
      p.kind = BEAM;
      return p;
    }

    // Longest rod on the left, shortest on the right, so a left-to-right sweep
    // runs up the scale.
    const len = 270 - index * 21;
    const width = 14 - index * 0.6;
    const el = document.createElement('div');
    baseStyle(
      el,
      width,
      `height:${len}px;border-radius:${width}px;cursor:pointer;transform-origin:50% 0;` +
        'background:linear-gradient(180deg, #f4f8fc 0%, #bcc9d7 16%, #8fa1b4 45%, #dae4ee 74%, #94a5b7 100%);' +
        'box-shadow:0 0 12px rgba(180,215,255,0.4), inset -2px 0 3px rgba(0,0,0,0.28),' +
        ' inset 2px 0 3px rgba(255,255,255,0.65);'
    );

    const p = particle(el, rodX(w, index), RACK_TOP, width, 60_000, now);
    p.kind = 0;
    p.a = 0; // swing angle, degrees
    p.b = 0; // angular velocity
    p.c = 0; // last strike time, for the retrigger cooldown
    p.d = PENTATONIC[index % PENTATONIC.length] / (index < 5 ? 2 : 1); // longer rod, lower note
    return p;
  },
  step(p, t) {
    const fade = Math.min(1, t * 40) * (t > 0.94 ? (1 - t) / 0.06 : 1);

    if (p.kind === BEAM) {
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      p.el.style.opacity = String(fade);
      return;
    }

    // Damped pendulum. There is no driving force — a rod only ever moves because
    // you hit it, and then it rings itself out.
    const accel = -p.a * 0.012;
    p.b = (p.b + accel) * 0.985;
    p.a += p.b;

    p.el.style.transform = `translate3d(${p.x}px, ${RACK_TOP - 4}px, 0) rotate(${p.a}deg)`;
    p.el.style.opacity = String(fade);
  },
  onPop(p) {
    const now = performance.now();
    // Without a cooldown, a cursor jittering on one rod machine-guns the note.
    if (now - p.c < 260) return;
    p.c = now;
    playBell(p.d);
    p.b += rand(0.55, 1.1) * (Math.random() < 0.5 ? -1 : 1);
  },
};



/* ------------------------------------------------------------------ ripples */

const ripples: RelaxEffect = {
  id: 'ripples',
  label: 'Zen Ripples',
  group: 'Water',
  blurb: 'Touch the water. Rings spread out and chime — every note is in key, so keep tapping and it stays music.',
  space: 'world',
  flash: '',
  burstMs: 0, // one-shot: every click is its own small event
  openingPop: 4,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 200,
  // Every tap gets its own note, so this is onBurst rather than onStart.
  onBurst() {
    playChime();
  },
  create(x, y, now, api) {
    const el = document.createElement('div');
    const size = 40;
    // Light paper needs a deeper, more saturated ring to read as water; dark keeps
    // the airy pale-blue hoop.
    const ring = api.isDark
      ? 'border:2px solid rgba(160,215,255,0.85);box-shadow:0 0 18px rgba(150,210,255,0.35), inset 0 0 18px rgba(190,235,255,0.25);'
      : 'border:2px solid rgba(56,138,196,0.8);box-shadow:0 0 16px rgba(70,150,205,0.3), inset 0 0 16px rgba(90,165,215,0.22);';
    baseStyle(el, size, `border-radius:50%;${ring}`);

    const p = particle(el, x, y, size, rand(1800, 2600), now);
    // Staggered rings, so one tap reads as a spreading wave rather than a single
    // hoop. Negative time = still waiting to be born.
    p.a = rand(0, 0.34); // delay, as a fraction of life
    p.b = rand(5, 9); // final radius, in multiples of base size
    return p;
  },
  step(p, t) {
    const local = (t - p.a) / (1 - p.a);
    if (local <= 0) {
      p.el.style.opacity = '0';
      return;
    }

    // Ease-out: the ring races away, then relaxes as it dies. Water does this.
    const eased = 1 - Math.pow(1 - local, 2.4);
    const scale = 0.25 + eased * p.b;

    p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String((1 - local) * 0.75);
  },
};

/* ------------------------------------------------------------------- ocean */

const SWASH = 0;   // the thin sheet of water that runs up the sand
const FOAM = 1;    // bubbles riding the leading edge
const WETLINE = 2; // the dark mark the sheet leaves as it drains back
const GLINT = 3;   // sun on the water further out

/**
 * A shore, not a pulsing blob.
 *
 * The first version rose a flat ellipse up the screen and dropped it back, which
 * is nothing like what water does. What actually happens at a waterline is a
 * SWASH — a thin, fast sheet racing up the sand with a foaming leading edge —
 * and then a BACKWASH, slower and reluctant, that drains under the next one and
 * leaves the sand dark behind it. Those two motions are asymmetric (fast in,
 * slow out), they overlap, and the leading edge is where all the detail lives.
 * Everything below is built around that.
 */
const ocean: RelaxEffect = {
  id: 'ocean',
  label: 'Ocean Shore',
  group: 'Water',
  blurb: 'Stand at the waterline. Sheets of water race up the sand, hiss into foam, and drag back out under the next one. A full minute of it, over real surf.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 2,
  spawnEveryMs: 2100,
  spawnPerTick: 1,
  maxParticles: 260,
  onStart(_x, _y, api) {
    startAmbience('ocean');

    const { h } = api.viewport;

    // The sea beyond the break: a deep band with a paler horizon, so the swash
    // is arriving FROM somewhere instead of materialising out of the floor.
    const sea = document.createElement('div');
    sea.dataset.sea = '';
    sea.style.cssText =
      `position:absolute;left:0;right:0;bottom:0;height:${Math.round(h * 0.46)}px;pointer-events:none;opacity:0;` +
      'transition:opacity 1600ms ease;' +
      'background:' +
      // the wet sand it runs out over
      'linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(60,42,26,0.22) 100%),' +
      // the water
      'linear-gradient(180deg, rgba(150,200,230,0.30) 0%, rgba(46,110,158,0.55) 14%,' +
      ' rgba(28,84,132,0.62) 42%, rgba(24,74,118,0.40) 72%, rgba(30,86,126,0.10) 100%);';
    api.screen.appendChild(sea);

    // The break line: a soft white band out where the waves are turning over.
    const surf = document.createElement('div');
    surf.dataset.surf = '';
    surf.style.cssText =
      `position:absolute;left:-5%;right:-5%;bottom:${Math.round(h * 0.40)}px;height:14px;pointer-events:none;opacity:0;` +
      'transition:opacity 1600ms ease;filter:blur(4px);' +
      'background:linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 55%, rgba(255,255,255,0) 100%);';
    api.screen.appendChild(surf);

    requestAnimationFrame(() => {
      sea.style.opacity = '1';
      surf.style.opacity = '1';
    });
  },
  onStop(api) {
    stopAmbience('ocean');
    for (const sel of ['[data-sea]', '[data-surf]']) {
      const el = api.screen.querySelector<HTMLElement>(sel);
      if (!el) continue;
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 1700);
    }
  },
  create(x, y, now, api, kind = SWASH) {
    const { w, h } = api.viewport;

    if (kind === FOAM) {
      const size = rand(2, 7);
      const el = document.createElement('div');
      baseStyle(
        el,
        size,
        'border-radius:50%;background:rgba(255,255,255,0.92);' +
          'box-shadow:0 0 4px rgba(255,255,255,0.6);'
      );
      const p = particle(el, x, y + rand(-4, 8), size, rand(700, 1500), now);
      p.kind = FOAM;
      // Foam rides the sheet forward, then sits and pops where it's stranded.
      p.vx = rand(-0.5, 0.5);
      p.vy = rand(-0.5, 0.1);
      p.a = rand(0.85, 1);
      return p;
    }

    if (kind === WETLINE) {
      const el = document.createElement('div');
      const width = w * 1.1;
      baseStyle(
        el,
        width,
        'height:70px;border-radius:50% 50% 0 0 / 26% 26% 0 0;' +
          'background:linear-gradient(180deg, rgba(70,48,30,0.30) 0%, rgba(70,48,30,0.10) 60%, rgba(70,48,30,0) 100%);'
      );
      const p = particle(el, (w - width) / 2, y, width, rand(2600, 4200), now);
      p.kind = WETLINE;
      return p;
    }

    if (kind === GLINT) {
      const size = rand(2, 5);
      const el = document.createElement('div');
      baseStyle(el, size, 'border-radius:50%;background:rgba(255,255,255,0.9);');
      const p = particle(el, rand(0, w), h - rand(h * 0.12, h * 0.42), size, rand(900, 2200), now);
      p.kind = GLINT;
      p.c = rand(2, 5); // twinkle rate
      p.d = rand(0, Math.PI * 2);
      return p;
    }

    /* The swash sheet. Wide, LOW, with a hard bright leading edge and almost
       nothing behind it — that thin bright line is the whole illusion. The gentle
       dome (border-radius on the top corners only) makes the middle of the sheet
       run further up the beach than its ends, which is what a real one does. */
    const width = w * rand(1.15, 1.45);
    const el = document.createElement('div');
    baseStyle(
      el,
      width,
      'height:200px;border-radius:50% 50% 0 0 / 30% 30% 0 0;' +
        'background:' +
        'linear-gradient(180deg,' +
        ' rgba(255,255,255,0.95) 0px, rgba(255,255,255,0.85) 3px,' +
        ' rgba(232,248,255,0.62) 9px, rgba(186,224,246,0.42) 22px,' +
        ' rgba(130,186,222,0.26) 60px, rgba(70,140,190,0.12) 130px,' +
        ' rgba(40,110,165,0.02) 200px);' +
        'box-shadow:0 -3px 22px rgba(210,240,255,0.35);'
    );

    const p = particle(el, (w - width) / 2, h, width, rand(6500, 9500), now);
    p.kind = SWASH;
    p.a = rand(0.16, 0.36) * h; // how far up the sand this one reaches
    p.b = rand(-24, 24);        // a little lateral drift — the sea isn't square-on
    p.c = 0;                    // foam thrown yet?
    p.d = 0;                    // wet line laid yet?
    return p;
  },
  step(p, t, now, api) {
    const { w, h } = api.viewport;

    if (p.kind === FOAM) {
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.x += p.vx;
      p.y += p.vy;
      // Bubbles don't fade evenly — they hold, then pop.
      const life = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${0.6 + life * 0.4})`;
      p.el.style.opacity = String(life * p.a);
      return;
    }

    if (p.kind === WETLINE) {
      // Sand dries from the top down: the mark shrinks back as it fades.
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scaleY(${1 - t * 0.35})`;
      p.el.style.opacity = String((1 - t) * 0.75);
      return;
    }

    if (p.kind === GLINT) {
      const tw = Math.pow((Math.sin(now / 1000 * p.c + p.d) + 1) / 2, 3);
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      p.el.style.opacity = String(tw * (t > 0.8 ? (1 - t) / 0.2 : Math.min(1, t * 5)) * 0.8);
      return;
    }

    /* Swash in, backwash out. The asymmetry is everything: the run-up is fast and
       eased-OUT (the sheet arrives with momentum and decelerates as the beach
       drags on it) and the retreat is slow and eased-IN (it hesitates at the top,
       then gathers pace as gravity takes it). Swap those two easings and it reads
       as a pulse, which is exactly what the first version looked like. */
    const RISE = 0.22; // the run-up is a fifth of the cycle; the drain is the rest
    let reach: number;
    let speed: number;
    if (t < RISE) {
      const k = t / RISE;
      reach = (1 - Math.pow(1 - k, 3)) * p.a;
      speed = 1 - k;
    } else {
      const k = (t - RISE) / (1 - RISE);
      reach = (1 - Math.pow(k, 1.7)) * p.a;
      speed = 0;
    }

    const edgeY = h - reach; // where the leading edge is, in screen px

    // Sun on the water further out. Cheap, and it stops the sea behind the break
    // reading as a flat painted band.
    if (Math.random() < 0.09) api.spawn(0, 0, 1, GLINT);

    // Foam is torn off the edge for as long as the sheet is still moving up.
    if (speed > 0.15 && Math.random() < 0.6) {
      api.spawn(rand(w * 0.08, w * 0.92), edgeY, 1, FOAM);
    }

    // At the top of the run, the sheet stalls: throw a burst of foam along the
    // whole edge and stain the sand behind it.
    if (p.c === 0 && t >= RISE) {
      p.c = 1;
      for (let i = 0; i < 26; i++) api.spawn(rand(0, w), edgeY, 1, FOAM);
    }
    if (p.d === 0 && t >= RISE * 0.55) {
      p.d = 1;
      api.spawn(0, edgeY, 1, WETLINE);
    }

    const drift = p.b * t;
    const y = edgeY - 4; // the sheet's own top edge sits on the waterline
    p.el.style.transform = `translate3d(${p.x + drift}px, ${y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 14) * (t > 0.75 ? (1 - t) / 0.25 : 1));
  },
};

/* ----------------------------------------------------------------- handpan */

/** A ring of tone fields, plus the dome in the middle. */
const PAD_COUNT = 8;
const DOME = 1;

const handpan: RelaxEffect = {
  id: 'handpan',
  label: 'Handpan',
  group: 'Stillness',
  blurb: 'A real instrument, tuned so it cannot sound wrong. Tap the tone fields — every note is in key, so play as fast or as slow as you like.',
  space: 'screen',
  flash: '',
  burstMs: 0,
  openingPop: PAD_COUNT,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 12,
  interactive: true,
  consumeOnPop: false, // you strike a pan; you don't destroy it
  onBurst(_x, _y, api) {
    api.clear();
    api.spawn(0, 0, 1, DOME);
  },
  create(_x, _y, now, api, kind = 0, _tint, index = 0) {
    const { w, h } = api.viewport;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.26;

    if (kind === DOME) {
      const size = radius * 0.62;
      const el = document.createElement('div');
      baseStyle(
        el,
        size,
        'border-radius:50%;cursor:pointer;' +
          'background:radial-gradient(circle at 38% 32%, #e9eef4 0%, #9fb0c2 34%, #5d6f83 72%, #3d4c5c 100%);' +
          'box-shadow:inset -6px -8px 20px rgba(0,0,0,0.35), inset 6px 8px 20px rgba(255,255,255,0.35),' +
          ' 0 18px 40px -14px rgba(0,0,0,0.55);'
      );
      const p = particle(el, cx - size / 2, cy - size / 2, size, 600_000, now);
      p.kind = DOME;
      p.d = PENTATONIC[0] / 2; // the ding: the pan's root, an octave down
      return p;
    }

    // Tone fields around the rim. Going anticlockwise from the top puts the low
    // notes on one side and the high on the other, so a sweep is a scale.
    const angle = -Math.PI / 2 + (index / PAD_COUNT) * Math.PI * 2;
    const size = radius * rand(0.34, 0.4);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        'background:radial-gradient(circle at 40% 34%, #dfe7ef 0%, #a8b8c8 38%, #6b7d90 78%, #4a5a6b 100%);' +
        'box-shadow:inset -4px -5px 12px rgba(0,0,0,0.30), inset 4px 5px 12px rgba(255,255,255,0.40),' +
        ' 0 10px 24px -10px rgba(0,0,0,0.5);'
    );

    const p = particle(
      el,
      cx + Math.cos(angle) * radius - size / 2,
      cy + Math.sin(angle) * radius * 0.86 - size / 2,
      size,
      600_000,
      now
    );
    p.kind = 0;
    p.a = 0; // strike energy, decays to nothing
    p.c = 0; // last strike, for the retrigger cooldown
    p.d = PENTATONIC[index % PENTATONIC.length] * (index >= PENTATONIC.length ? 2 : 1);
    return p;
  },
  step(p, t) {
    // A struck field swells and settles. That's the whole animation: the sound is
    // the point, the motion just has to confirm you hit the thing you aimed at.
    // (A filter here would break rule 2 for a hot particle system — but a pan is
    // nine nodes that never move, so the flash costs nothing. `b` remembers what
    // we last wrote, so an idle pan isn't restyled sixty times a second.)
    p.a *= 0.9;
    const glow = p.a > 0.02 ? 1 + p.a * 0.5 : 1;
    if (glow !== p.b) {
      p.b = glow;
      p.el.style.filter = glow > 1 ? `brightness(${glow})` : '';
    }
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 + p.a * 0.12})`;
    p.el.style.opacity = String(Math.min(1, t * 200));
  },
  onPop(p) {
    const now = performance.now();
    if (now - p.c < 90) return; // a jittering cursor must not machine-gun a note
    p.c = now;
    p.a = 1;
    playHandpan(p.d);
  },
};

/* -------------------------------------------------------------------- snow */

const snow: RelaxEffect = {
  id: 'snow',
  label: 'Snowfall',
  group: 'Sky',
  blurb: 'Everything goes quiet. Snow drifts down across the whole canvas for a minute, with a soft wind behind it.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 90,
  spawnEveryMs: 120,
  spawnPerTick: 3,
  maxParticles: 320,
  onStart() {
    startAmbience('wind');
  },
  onStop() {
    stopAmbience('wind');
  },
  create(_x, _y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(3, 9);
    const el = document.createElement('div');
    // White-on-white vanishes: in light mode a flake gets a cool blue body and a
    // soft blue shadow so it reads as snow against the paper, not a hole in it.
    const flake = api.isDark
      ? 'background:rgba(255,255,255,0.92);box-shadow:0 0 6px rgba(255,255,255,0.7);'
      : 'background:rgba(238,247,255,0.96);box-shadow:0 0 5px rgba(120,155,205,0.6), 0 1px 2px rgba(60,95,150,0.4);';
    baseStyle(el, size, `border-radius:50%;${flake}`);

    const p = particle(el, rand(-40, w + 40), rand(-h * 0.4, -20), size, rand(9000, 16000), now);
    // Big flakes are near, so they fall faster and are brighter; small ones hang
    // back. That single correlation is what gives the fall any depth at all.
    const near = (size - 3) / 6;
    p.vy = 0.5 + near * 1.5;
    p.vx = rand(-0.25, 0.25);
    p.b = 0.35 + near * 0.55; // opacity
    p.c = rand(0.15, 0.5); // drift frequency
    p.d = rand(0, Math.PI * 2);
    p.a = rand(14, 46); // drift amplitude
    return p;
  },
  step(p, t, now, api) {
    p.y += p.vy;
    p.x += p.vx;

    if (p.y > api.viewport.h + 20) {
      p.y = rand(-60, -10);
      p.x = rand(-40, api.viewport.w + 40);
    }

    const drift = Math.sin(now / 1000 * p.c + p.d) * p.a;
    p.el.style.transform = `translate3d(${p.x + drift}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(p.b * (t > 0.94 ? (1 - t) / 0.06 : Math.min(1, t * 12)));
  },
};

/* --------------------------------------------------------------- fireflies */

const FIREFLY_COLORS = ['#FFF3A0', '#D9FF9E', '#FFE68A', '#C8FFB0'];
// On light paper the pale glow washes out — deeper amber/olive bodies read.
const FIREFLY_COLORS_LIGHT = ['#F0A400', '#A7B800', '#E6A800', '#7BAE1E'];
const GLOW = 1;

const fireflies: RelaxEffect = {
  id: 'fireflies',
  label: 'Fireflies',
  group: 'Garden',
  blurb: 'Dusk in a field. They wander, they pulse, they blink out. Catch one and it flares and rings.',
  space: 'world',
  flash: '',
  burstMs: 45_000,
  openingPop: 14,
  spawnEveryMs: 1600,
  spawnPerTick: 1,
  maxParticles: 46,
  interactive: true,
  create(x, y, now, api, kind = 0, tint) {
    if (kind === GLOW) {
      const size = rand(3, 7);
      const el = document.createElement('div');
      baseStyle(el, size, `border-radius:50%;background:${tint ?? '#FFF3A0'};box-shadow:0 0 8px ${tint ?? '#FFF3A0'};`);
      const p = particle(el, x, y, size, rand(400, 800), now);
      p.kind = GLOW;
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(1.5, 5);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      return p;
    }

    const color = pick(api.isDark ? FIREFLY_COLORS : FIREFLY_COLORS_LIGHT);
    const size = rand(9, 15);
    const el = document.createElement('div');
    // Light mode: warmer core, stronger glow, and a hairline dark ring so each
    // firefly keeps a crisp edge against the bright page instead of dissolving.
    const coreColor = api.isDark ? '#ffffff' : '#fff2b0';
    const glow = api.isDark
      ? `box-shadow:0 0 16px 4px ${color}88;`
      : `box-shadow:0 0 15px 4px ${color}aa, 0 0 0 1px rgba(55,42,0,0.28);`;
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        `background:radial-gradient(circle at 50% 50%, ${coreColor} 0%, ${color} 42%, ${color}00 72%);` +
        glow
    );

    const p = particle(el, x + rand(-260, 260), y + rand(-200, 200), size, rand(14000, 22000), now);
    p.kind = 0;
    p.tint = color;
    // A firefly doesn't fly in a straight line; it wanders. Two sine drifts at
    // unrelated rates, one per axis, is a cheap and convincing wander.
    p.a = rand(30, 90); // wander radius x
    p.b = rand(24, 70); // wander radius y
    p.c = rand(0.1, 0.28); // wander rate
    p.d = rand(0, Math.PI * 2);
    p.vx = rand(0.4, 1.3); // pulse rate of the glow
    return p;
  },
  step(p, t, now) {
    if (p.kind === GLOW) {
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.x += p.vx;
      p.y += p.vy;
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${1 - t})`;
      p.el.style.opacity = String(1 - t);
      return;
    }

    const s = now / 1000;
    const wx = p.x + Math.sin(s * p.c + p.d) * p.a + Math.sin(s * p.c * 2.7 + p.d) * (p.a * 0.25);
    const wy = p.y + Math.cos(s * p.c * 1.3 + p.d) * p.b;

    // The pulse: on, off, on. Never fully out, or you'd be trying to click a
    // target that isn't there.
    const pulse = 0.35 + 0.65 * Math.pow((Math.sin(s * p.vx * 2 + p.d) + 1) / 2, 2);
    const fade = t < 0.05 ? t / 0.05 : t > 0.9 ? (1 - t) / 0.1 : 1;

    p.el.style.transform = `translate3d(${wx - p.size / 2}px, ${wy - p.size / 2}px, 0) scale(${0.85 + pulse * 0.3})`;
    p.el.style.opacity = String(pulse * fade);
  },
  onPop(p, api) {
    playSparkle();
    api.spawn(p.x, p.y, 8, GLOW, p.tint);
  },
};

/* ---------------------------------------------------------------- lanterns */

const LANTERN_COLORS = ['#FFB65C', '#FF8E53', '#FFD08A', '#FF7043'];

const lanterns: RelaxEffect = {
  id: 'lanterns',
  label: 'Sky Lanterns',
  group: 'Firelight',
  blurb: 'Let them go. Paper lanterns lift off, sway on the warm air and shrink away into the dark.',
  space: 'world',
  flash: 'rgba(255, 182, 92, 0.35)',
  burstMs: 12_000,
  openingPop: 6,
  spawnEveryMs: 900,
  spawnPerTick: 1,
  maxParticles: 60,
  onBurst() {
    playWhoosh();
  },
  create(x, y, now) {
    const color = pick(LANTERN_COLORS);
    const w = rand(26, 46);
    const h = w * 1.28;
    const el = document.createElement('div');
    baseStyle(
      el,
      w,
      `height:${h}px;border-radius:46% 46% 38% 38%/38% 38% 52% 52%;` +
        `background:radial-gradient(ellipse at 50% 68%, #FFF6E0 0%, ${color} 42%, ${color}CC 78%, ${color}66 100%);` +
        `box-shadow:0 0 26px 6px ${color}55, inset 0 -6px 12px ${color}AA;` +
        'border-top:2px solid rgba(255,240,210,0.55);'
    );

    const p = particle(el, x + rand(-90, 90), y + rand(-20, 30), w, rand(11000, 17000), now);
    p.a = h;
    // Rise rate. Big lanterns are nearer, so they climb faster and look bigger —
    // the same near/far trick the snow uses, and it's what gives the sky depth.
    p.vy = -(0.45 + (w - 26) / 20 * 0.55);
    p.b = rand(18, 46); // sway amplitude
    p.c = rand(0.12, 0.3); // sway rate
    p.d = rand(0, Math.PI * 2);
    p.spin = rand(-0.25, 0.25);
    return p;
  },
  step(p, t, now) {
    p.y += p.vy;
    const sway = Math.sin(now / 1000 * p.c + p.d) * p.b;
    p.rot += p.spin;

    // Shrink as it climbs — it isn't getting smaller, it's getting further away.
    const scale = 1 - t * 0.45;
    const glow = 0.9 + Math.sin(now / 1000 * 3 + p.d) * 0.1; // the flame guttering

    p.el.style.transform =
      `translate3d(${p.x + sway - p.size / 2}px, ${p.y - p.a / 2}px, 0) rotate(${p.rot}deg) scale(${scale})`;
    p.el.style.opacity = String(Math.min(1, t * 8) * (t > 0.7 ? (1 - t) / 0.3 : 1) * glow);
  },
};

/* -------------------------------------------------------------------- gate */

/** A wall of characters under a palace roof. Sweep the cursor and it scatters. */
const GLYPHS =
  '静心安寧和風雅道無為自然山水雲月花鳥虚実空明清幽玄寂閑遠深淡柔剛動止行観思夢光影露霜雪春秋夏冬海川林森石砂庭門橋灯茶禅悟慈悲縁夕朝夜星天地人';

const GATE_CHAR = 0;
const GATE_ROOF = 1;

/** Grid geometry for the current wall — laid in onBurst, read back in create. */
let gateGrid = { cols: 0, rows: 0, ox: 0, oy: 0, step: 26, top: 0 };
/** Rate-limits the koto so a fast sweep is a run of notes, not a machine gun. */
let lastKoto = 0;

/** One swooping tier of a Chinese palace roof. Concave, with upturned eaves. */
function roofTier(cx: number, halfW: number, top: number, eave: number): string {
  const fascia = 13;
  return [
    `M ${cx - halfW} ${eave}`,
    `C ${cx - halfW * 0.74} ${eave - 8} ${cx - halfW * 0.54} ${top + 30} ${cx - halfW * 0.3} ${top + 4}`,
    `L ${cx + halfW * 0.3} ${top + 4}`,
    `C ${cx + halfW * 0.54} ${top + 30} ${cx + halfW * 0.74} ${eave - 8} ${cx + halfW} ${eave}`,
    `L ${cx + halfW - 12} ${eave + fascia}`,
    `C ${cx + halfW * 0.62} ${eave + fascia - 5} ${cx + halfW * 0.46} ${top + 38} ${cx + halfW * 0.26} ${top + 16}`,
    `L ${cx - halfW * 0.26} ${top + 16}`,
    `C ${cx - halfW * 0.46} ${top + 38} ${cx - halfW * 0.62} ${eave + fascia - 5} ${cx - halfW + 12} ${eave + fascia}`,
    'Z',
  ].join(' ');
}

function gateRoofSvg(): string {
  const ridgeOrnaments = Array.from({ length: 7 }, (_, i) => {
    const x = 176 + i * 24;
    return `<circle cx="${x}" cy="30" r="3.4" fill="#F6D77A"/>`;
  }).join('');

  return `
<svg viewBox="0 0 640 230" width="100%" height="100%" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tileG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F7D978"/>
      <stop offset="0.42" stop-color="#E0A93A"/>
      <stop offset="1" stop-color="#A86E17"/>
    </linearGradient>
    <linearGradient id="beamG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9C352C"/>
      <stop offset="1" stop-color="#5E1B16"/>
    </linearGradient>
  </defs>

  <!-- upper tier -->
  <rect x="284" y="24" width="72" height="12" rx="5" fill="url(#tileG)"/>
  ${ridgeOrnaments}
  <path d="${roofTier(320, 148, 34, 84)}" fill="url(#tileG)"/>
  <rect x="196" y="96" width="248" height="15" rx="3" fill="url(#beamG)"/>
  <rect x="196" y="111" width="248" height="5" rx="2" fill="#C9A24A" opacity="0.7"/>

  <!-- lower tier -->
  <path d="${roofTier(320, 250, 126, 182)}" fill="url(#tileG)"/>
  <rect x="96" y="194" width="448" height="17" rx="3" fill="url(#beamG)"/>
  <rect x="96" y="211" width="448" height="6" rx="2" fill="#C9A24A" opacity="0.7"/>
</svg>`;
}

const gate: RelaxEffect = {
  id: 'gate',
  label: 'Gate of Stillness',
  group: 'Stillness',
  blurb: 'A hall of characters beneath a golden roof. Run the cursor through them — they scatter, they settle, and every one you touch plucks a koto string.',
  space: 'screen',
  flash: '',
  burstMs: 0, // the wall is laid by hand; nothing to emit
  openingPop: 0,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 700,
  interactive: true,
  consumeOnPop: false, // you push a character aside; you don't destroy it
  onStart() {
    startAmbience('wind');
  },
  onStop() {
    stopAmbience('wind');
  },
  onBurst(_x, _y, api) {
    const { w, h } = api.viewport;

    const step = 26;
    const roofH = Math.min(230, h * 0.3);
    const top = Math.max(70, h * 0.06) + roofH - 18; // the wall starts under the eaves
    const cols = Math.max(8, Math.floor(Math.min(w * 0.52, 460) / step));
    const rows = Math.max(6, Math.floor((h - top - 90) / step));

    gateGrid = {
      cols,
      rows,
      step,
      top,
      ox: (w - cols * step) / 2 + step / 2,
      oy: top + step / 2,
    };

    api.clear();
    api.spawn(0, 0, 1, GATE_ROOF);
    api.spawn(0, 0, cols * rows, GATE_CHAR);
  },
  create(_x, _y, now, api, kind = GATE_CHAR, _tint, index = 0) {
    const { w, h } = api.viewport;

    if (kind === GATE_ROOF) {
      const width = Math.min(w * 0.92, 760);
      const height = width * (230 / 640);
      const el = document.createElement('div');
      baseStyle(el, width, `height:${height}px;filter:drop-shadow(0 26px 34px rgba(0,0,0,0.45));`);
      el.innerHTML = gateRoofSvg();
      const p = particle(el, (w - width) / 2, Math.max(70, h * 0.06) - 20, width, 600_000, now);
      p.kind = GATE_ROOF;
      return p;
    }

    const col = index % gateGrid.cols;
    const row = Math.floor(index / gateGrid.cols);
    const hx = gateGrid.ox + col * gateGrid.step;
    const hy = gateGrid.oy + row * gateGrid.step;

    const el = document.createElement('div');
    baseStyle(
      el,
      gateGrid.step - 4,
      `height:${gateGrid.step - 4}px;cursor:pointer;` +
        'display:flex;align-items:center;justify-content:center;' +
        `font:400 ${gateGrid.step - 8}px/1 "Noto Serif SC","Songti SC","SimSun",serif;` +
        'color:rgba(38,30,24,0.92);text-shadow:0 1px 0 rgba(255,255,255,0.35);'
    );
    el.textContent = GLYPHS[(row * gateGrid.cols + col * 7) % GLYPHS.length];

    const p = particle(el, hx, hy, gateGrid.step - 4, 600_000, now);
    p.kind = GATE_CHAR;
    p.a = hx; // home
    p.b = hy;
    p.c = 0; // was it displaced last frame? (edge-triggers the note)
    p.d = HIRAJOSHI[(col + row) % HIRAJOSHI.length];
    // Stagger the fade-in so the wall writes itself in, column by column.
    p.vx = 0;
    p.vy = 0;
    p.spin = (col + row) * 16; // reused as the intro delay, in ms
    return p;
  },
  step(p, t, now, api) {
    if (p.kind === GATE_ROOF) {
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      p.el.style.opacity = String(Math.min(1, t * 400));
      return;
    }

    const age = now - p.born - p.spin;
    if (age < 0) {
      p.el.style.opacity = '0';
      return;
    }
    const intro = Math.min(1, age / 420);

    /* Cursor physics. Two forces and a drag, which is all a settling object ever
       needs: the cursor SHOVES a character away with a force that falls off to
       nothing at the edge of its reach, a spring hauls it back to the square it
       belongs in, and friction stops the pair of them arguing forever. */
    const dx = p.x - api.pointer.x;
    const dy = p.y - api.pointer.y;
    const dist = Math.hypot(dx, dy);
    const REACH = 116;

    if (dist < REACH && dist > 0.01) {
      const push = Math.pow(1 - dist / REACH, 2) * 3.4;
      p.vx += (dx / dist) * push;
      p.vy += (dy / dist) * push;
    }

    p.vx += (p.a - p.x) * 0.045; // spring home
    p.vy += (p.b - p.y) * 0.045;
    p.vx *= 0.86; // friction
    p.vy *= 0.86;

    p.x += p.vx;
    p.y += p.vy;

    const disp = Math.hypot(p.x - p.a, p.y - p.b);

    /* Pluck the string as the character is knocked loose, ONCE per disturbance —
       an edge trigger, not a level one, or brushing past a hundred of them would
       fire a hundred notes a frame. */
    if (disp > 9 && p.c === 0) {
      p.c = 1;
      if (now - lastKoto > 55) {
        lastKoto = now;
        playKoto(p.d, 0.2 + Math.min(0.18, disp / 260));
      }
    } else if (disp < 3) {
      p.c = 0;
    }

    // It leans into the shove, and it dims as it strays from home — the wall
    // "heals" back to full ink as everything settles.
    const lean = (p.x - p.a) * 0.6;
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) ` +
      `rotate(${lean}deg) scale(${intro * (1 + Math.min(0.25, disp / 200))})`;
    p.el.style.opacity = String(intro * (0.55 + 0.45 * Math.max(0, 1 - disp / 90)));
  },
  onPop(p) {
    // A deliberate click rings it properly and knocks it further than a brush.
    playKoto(p.d, 0.4);
    p.vx += rand(-7, 7);
    p.vy += rand(-9, 3);
    if (Math.random() < 0.18) playBamboo();
  },
};

/* ---------------------------------------------------------------- breathing */

const breathing: RelaxEffect = {
  id: 'breathing',
  label: 'Breathing Space',
  group: 'Stillness',
  blurb: 'A centering box breathing guide. Breathe in as the glowing ring expands, hold at the peak, and breathe out as it contracts.',
  space: 'screen',
  flash: 'rgba(230, 240, 255, 0.15)',
  burstMs: 0,
  openingPop: 1,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 50,
  onStart(_x, _y, api) {
    startAmbience('drone');
  },
  onStop(api) {
    stopAmbience('drone');
  },
  create(x, y, now, api, kind = 0) {
    const { w, h } = api.viewport;
    // On light paper a pale-blue ring on a pale page is barely there — switch to
    // a deep slate ink so the guide reads clearly in either theme.
    const light = !api.isDark;
    if (kind === 1) {
      const size = rand(3, 7);
      const el = document.createElement('div');
      const bub = light
        ? 'background:rgba(90,120,165,0.55); box-shadow:0 0 8px rgba(90,120,165,0.4);'
        : 'background:rgba(215,235,255,0.7); box-shadow:0 0 8px rgba(200,225,255,0.5);';
      baseStyle(el, size, `border-radius:50%; ${bub}`);
      const p = particle(el, rand(w * 0.2, w * 0.8), h - rand(40, 120), size, rand(4000, 6000), now);
      p.kind = 1;
      p.vx = rand(-0.2, 0.2);
      p.vy = rand(-0.6, -1.2);
      return p;
    }

    const size = 180;
    const el = document.createElement('div');
    const ring = light ? '58, 78, 112' : '255, 255, 255';
    baseStyle(
      el,
      size,
      `border-radius:50%; border: 1.5px solid rgba(${ring}, ${light ? 0.5 : 0.45});` +
        (light
          ? 'background: radial-gradient(circle, rgba(120,150,195,0.14) 0%, rgba(120,150,195,0.05) 70%, transparent 100%);' +
            'box-shadow: 0 0 40px rgba(90,120,170,0.18), inset 0 0 30px rgba(120,150,195,0.12);'
          : 'background: radial-gradient(circle, rgba(235,245,255,0.12) 0%, rgba(200,220,255,0.05) 70%, transparent 100%);' +
            'box-shadow: 0 0 40px rgba(200, 220, 255, 0.2), inset 0 0 30px rgba(255, 255, 255, 0.1);') +
        'display: flex; align-items: center; justify-content: center;' +
        `color: rgba(${ring}, 0.92); font-family: "Outfit", sans-serif; font-size: 11px; font-weight: 700;` +
        'text-transform: uppercase; letter-spacing: 0.15em; text-align: center;'
    );
    el.innerHTML = '<span class="breath-text">Breathe</span>';
    const p = particle(el, w / 2, h / 2, size, 600_000, now);
    p.kind = 0;
    return p;
  },
  step(p, t, now, api) {
    const { w, h } = api.viewport;
    if (p.kind === 1) {
      p.x += p.vx;
      p.y += p.vy;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      p.el.style.opacity = String((1 - t) * 0.7);
      return;
    }

    const cycle = 16000;
    const age = now - p.born;
    const phase = age % cycle;
    let labelText = '';
    let scale = 1.0;

    if (phase < 4000) {
      const progress = phase / 4000;
      scale = 0.75 + progress * 0.5;
      labelText = 'Inhale';
    } else if (phase < 8000) {
      scale = 1.25;
      labelText = 'Hold';
    } else if (phase < 12000) {
      const progress = (phase - 8000) / 4000;
      scale = 1.25 - progress * 0.5;
      labelText = 'Exhale';
    } else {
      scale = 0.75;
      labelText = 'Hold';
    }

    const txtNode = p.el.querySelector('.breath-text');
    if (txtNode && txtNode.textContent !== labelText) {
      txtNode.textContent = labelText;
    }

    p.x = w / 2;
    p.y = h / 2;

    p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = '1';

    if (Math.random() < 0.02) {
      api.spawn(0, 0, 1, 1);
    }
  },
};

/* ------------------------------------------------------------------ aurora */

const AURORA_HUES = [150, 165, 185, 275, 300];

const aurora: RelaxEffect = {
  id: 'aurora',
  label: 'Aurora',
  group: 'Sky',
  blurb: 'Curtains of light over a dark sky. They fold, drift and dissolve, and there is nothing to do but watch them.',
  space: 'screen',
  flash: '',
  burstMs: 45_000,
  openingPop: 5,
  spawnEveryMs: 2400,
  spawnPerTick: 1,
  maxParticles: 26,
  onStart(_x, _y, api) {
    startAmbience('drone');

    const sky = document.createElement('div');
    sky.dataset.sky = '';
    sky.style.cssText =
      'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1800ms ease;' +
      'background:radial-gradient(ellipse at 50% 110%, rgba(12,24,44,0.35) 0%, rgba(4,8,18,0.82) 70%);';
    api.screen.appendChild(sky);
    requestAnimationFrame(() => { sky.style.opacity = '1'; });
  },
  onStop(api) {
    stopAmbience('drone');
    const sky = api.screen.querySelector<HTMLElement>('[data-sky]');
    if (!sky) return;
    sky.style.opacity = '0';
    window.setTimeout(() => sky.remove(), 1900);
  },
  create(_x, _y, now, api) {
    const { w, h } = api.viewport;
    const hue = pick(AURORA_HUES);
    const width = rand(w * 0.18, w * 0.42);

    /* A curtain, not a glowing rectangle. The vertical gradient does the work:
       bright and hard at the top where the sheet is edge-on to you, streaked and
       thinning downward, gone before it reaches the ground. The heavy blur and
       `screen` blending are what let two curtains cross and get BRIGHTER, which
       is the thing your eye actually recognises as an aurora. */
    const el = document.createElement('div');
    baseStyle(
      el,
      width,
      `height:${Math.round(h * 0.72)}px;mix-blend-mode:screen;filter:blur(22px);` +
        'background:linear-gradient(180deg,' +
        ` hsl(${hue} 95% 72% / 0) 0%,` +
        ` hsl(${hue} 95% 74% / 0.55) 12%,` +
        ` hsl(${hue} 90% 62% / 0.42) 34%,` +
        ` hsl(${hue + 25} 85% 55% / 0.20) 62%,` +
        ` hsl(${hue + 40} 80% 50% / 0) 100%);`
    );

    const p = particle(el, rand(-w * 0.1, w * 0.9), rand(-40, 40), width, rand(14000, 22000), now);
    p.a = rand(0.06, 0.16); // fold rate
    p.b = rand(6, 20); // fold depth, in degrees of skew
    p.c = rand(0, Math.PI * 2);
    p.vx = rand(-0.22, 0.22); // the whole curtain drifts sideways
    return p;
  },
  step(p, t, now) {
    p.x += p.vx;
    const s = now / 1000;
    // Two skews at unrelated rates = a sheet folding, rather than a slab leaning.
    const skew = Math.sin(s * p.a * Math.PI * 2 + p.c) * p.b
      + Math.sin(s * p.a * 2.7 + p.c) * (p.b * 0.3);
    const stretch = 1 + Math.sin(s * p.a * 1.7 + p.c) * 0.12;

    p.el.style.transform =
      `translate3d(${p.x}px, ${p.y}px, 0) skewX(${skew}deg) scaleY(${stretch})`;
    // Long, slow breaths in and out — a curtain never snaps on.
    p.el.style.opacity = String(Math.min(1, t * 5) * (t > 0.6 ? (1 - t) / 0.4 : 1));
  },
};

/* -------------------------------------------------------------------------- */


/** The pane the beads sit on, built once per shower. */
let glassPane: HTMLElement | null = null;

/* ============================== the second shelf ==========================
   Ten effects added 2026-08-21. The brief for all of them was the same: it has
   to be worth doing a second time. That rules out anything that is only a
   burst — the ones that earn their place either have something in them that
   behaves (koi, candles, stones), or they do the one thing your eye cannot stop
   watching (ink unfurling, a bead finally letting go of a window).

   Every one obeys the three rules at the top of this file. Where an effect
   needs to remember something between particles it keeps a module-level scrap
   of state, the way bubblewrap keeps its sheet.
   ========================================================================= */

/* ------------------------------------------------------------------- koi -- */
/**
 * A pond. Not fish on a board — water, with fish in it.
 *
 * The first version was eleven stock fish sliding over the canvas on a sine,
 * and it read exactly like that: no water, no depth, no body. This one builds
 * the water first and then puts nothing in it that a pond does not have.
 *
 * THE WATER is five stacked layers with the fish threaded BETWEEN them, and
 * that threading is the whole trick — a fish near the floor sits behind two
 * washes of murk and a ceiling of caustics, a fish near the surface sits in
 * front of them, and that difference is what depth IS. None of it is per-frame:
 * the caustics, the wind lines and the sky reflection are CSS animations on
 * composited layers, so an empty pond costs the main thread nothing at all.
 *
 * THE KOI are built, not drawn. Each is a chain of eight ellipses with a
 * travelling wave running down it — amplitude growing toward the tail, which is
 * the carangiform stroke a carp actually swims — so the body bends because it
 * is swimming, and lags through a turn because the tail is following the head
 * rather than being told where to point. Fins, eyes and barbels hang off the
 * segments as children and come along for the ride for free. Twelve fish is
 * about 130 transform writes a frame and nothing else.
 *
 * THE BEHAVIOUR is a small steering model: inertia, a slow wander, separation
 * from neighbours, and a bank they follow rather than bounce off. Food is a
 * real object — it falls from above the surface, splashes, sinks at its own
 * rate, and is EATEN, which is the thing the old version never did: the fish
 * used to converge on a coordinate and then mill there forever.
 */

const KOI_TAU = Math.PI * 2;
const POND_W = 1580;
const POND_H = 1080;

/* The species. There is deliberately no kind 0: the engine spawns kind 0 for
   `openingPop` and for every emitter tick, and a pond wants neither — every
   node this effect owns is asked for by name, from onStart or onBurst. */
const K_BED = 1;
const K_MURK = 2;
const K_FISH = 3;
const K_FOOD = 4;
const K_RING = 5;
const K_SURFACE = 6;
const K_RIM = 7;
const K_DROP = 8;
const K_BUBBLE = 9;

/**
 * Paint order, and the only reason any of this reads as water.
 *
 * The fish are not children of the pond; they are siblings of it at a z-index
 * chosen by how deep they are, so the murk and the caustics can come BETWEEN
 * them. DOM order can't express that — the fish that is deepest changes every
 * few seconds.
 */
const Z_BED = 10;
const Z_DEEP = 12;      // and 14, 16 for the two shallower bands
const Z_MURK = 13;      // and 15
const Z_SURFACE = 17;
const Z_RIPPLE = 18;
const Z_RIM = 19;

interface KoiPond {
  x: number;
  y: number;
  dark: boolean;
}

let pond: KoiPond | null = null;
/** The bed node, kept only so a second visit can tell a live pond from a ghost. */
let pondBed: HTMLElement | null = null;
/** When the water started draining. Every node reads it and fades together. */
let pondEnd = 0;
/** Every fish in the water — they need each other for separation. */
const school: Particle[] = [];
/** Every pellet still worth swimming for. */
const crumbs: Particle[] = [];
/** One clock for the whole pond, so fish don't sprint on a 120Hz display. */
let koiK = 1;
let koiLast = 0;
let lastGulp = 0;

function koiWater(dark: boolean) {
  return dark
    ? {
        deep: '#03121a', mid: '#08262e', shallow: '#124342', bank: '#1b5245',
        murk: '3,18,26', silt: 'rgba(120,180,170,0.10)',
        stone: ['#3a4148', '#323940', '#464c51', '#2c3639', '#4a5055', '#3f3a34', '#514b42', '#2a2f33'],
      }
    : {
        deep: '#082224', mid: '#123c39', shallow: '#245c4a', bank: '#3d7355',
        murk: '10,44,46', silt: 'rgba(255,255,255,0.10)',
        stone: ['#8f8c84', '#7c7870', '#a29c92', '#6e6b64', '#98928a', '#8a7d6b', '#6f6558', '#a8a294'],
      };
}

/**
 * Caustics, as a LATTICE of rings rather than families of concentric ones.
 *
 * Concentric was the first try and it was a spirograph: three enormous
 * bullseyes that the eye locks onto in half a second, because a caustic net
 * has no centre and a repeating-radial-gradient is nothing but centre. This
 * tiles ONE small ring instead, four times over, at sizes with no common
 * factor — the crossings then drift in and out of phase across the whole pond
 * and never settle into a pattern you can name. Two of these layers, rotated
 * against each other and drifting at different rates, is water.
 */
function koiCaustic(a: number, scale: number, seed: number) {
  const cells: [number, number][] = [[233, 167], [151, 113], [89, 67]];
  const img: string[] = [];
  const size: string[] = [];
  const pos: string[] = [];
  cells.forEach(([w, h], i) => {
    const k = ((i * 7 + seed) % 9) - 4;
    const al = a * (1 - i * 0.26);
    img.push(
      `radial-gradient(ellipse ${(w * 0.5) | 0}px ${(h * 0.5) | 0}px at 50% 50%,` +
      ' rgba(255,255,255,0) 0 ' + (34 + k) + '%,' +
      ` rgba(255,255,255,${(al * 0.3).toFixed(3)}) ${44 + k}%,` +
      ` rgba(255,255,255,${al.toFixed(3)}) ${52 + k}%,` +
      ` rgba(255,255,255,${(al * 0.26).toFixed(3)}) ${60 + k}%,` +
      ` rgba(255,255,255,0) ${74 + k}%)`
    );
    size.push(`${(w * scale) | 0}px ${(h * scale) | 0}px`);
    pos.push(`${(i * 37 + seed * 13) % 91}px ${(i * 53 + seed * 29) % 67}px`);
  });
  return `background-image:${img.join(',')};background-size:${size.join(',')};background-position:${pos.join(',')};`;
}

/**
 * One net of light, in three nodes.
 *
 *  - `outer` carries the blend and the mask, and never moves.
 *  - `drift` carries the animation. It is exactly pond-sized ON PURPOSE: it is
 *    the node that gets its own compositor layer, and the layer costs width x
 *    height of video memory. The first version put the animation on the
 *    oversized node instead and asked the GPU for a 5000px texture per net.
 *  - `tilt` is oversized and static, so it is only ever painted INTO the layer
 *    above it. Tilted AND stretched: round cells all of one size tile into a
 *    honeycomb the eye reads as wallpaper in about a second, and stretching one
 *    net wide against another tall means their crossings are never the same
 *    shape twice.
 */
function koiCausticNet(
  host: HTMLElement, css: string, rot: number, a: number, scale: number, seed: number, anim: string,
  sx = 1, sy = 1
) {
  const outer = koiInner(host, 'mix-blend-mode:screen;' + css);
  const drift = document.createElement('div');
  drift.style.cssText = `position:absolute;inset:0;will-change:transform;animation:${anim};`;
  const tilt = document.createElement('div');
  tilt.style.cssText =
    `position:absolute;inset:-40%;transform:rotate(${rot}deg) scale(${sx}, ${sy});` +
    koiCaustic(a, scale, seed);
  drift.appendChild(tilt);
  outer.appendChild(drift);
  return outer;
}

/** Suspended silt, hanging in the water column. Two scales, no motion of its
 *  own — the layer it lives on drifts, which is how dust in water behaves. */
const KOI_SILT = (c: string) =>
  'background-image:' +
  `radial-gradient(circle, ${c} 0 1.1px, transparent 1.6px) 0 0/83px 71px,` +
  `radial-gradient(circle, ${c} 0 0.8px, transparent 1.2px) 37px 23px/59px 47px;`;

/* -- the fish ------------------------------------------------------------- */

const KOI_SEG = 8;
/** Body width at each joint, as a fraction of the widest point. A carp seen
 *  from above is widest at the shoulders and thins to almost nothing at the
 *  peduncle; get this curve wrong and you have drawn a sausage. */
const KOI_WIDTH = [0.52, 0.88, 1, 0.94, 0.8, 0.6, 0.4, 0.22];
/** Link lengths as fractions of the body — shorter toward the tail, so the
 *  last third can whip without the whole fish folding. */
const KOI_LINK = [0, 0.158, 0.152, 0.144, 0.134, 0.122, 0.11, 0.096];

/**
 * The varieties, which are real ones. Kohaku is white with red; Showa is a
 * black fish with red and white on it; Ogon is a single metal colour and gets
 * a much stronger sheen because that is the entire point of an Ogon.
 */
const KOI_COATS = [
  { base: '#f7f3ec', hi: '#d9451c', sumi: '', sheen: 0.55, runs: 2 },   // kohaku
  { base: '#f7f3ec', hi: '#dd4f1c', sumi: '#26221f', sheen: 0.55, runs: 2 }, // sanke
  { base: '#262220', hi: '#cf4419', sumi: '#f2eee5', sheen: 0.5, runs: 3 },  // showa
  { base: '#dda637', hi: '#f6dc94', sumi: '', sheen: 0.95, runs: 1 },   // ogon
  { base: '#a3784a', hi: '#c69c66', sumi: '', sheen: 0.5, runs: 1 },    // chagoi
  { base: '#8496a8', hi: '#c2512b', sumi: '#2c3b4a', sheen: 0.55, runs: 2 }, // asagi
  { base: '#eceff2', hi: '#fbfdff', sumi: '', sheen: 0.92, runs: 1 },   // platinum
];

function koiCoat() {
  const c = pick(KOI_COATS);
  const cols = new Array<string>(KOI_SEG).fill(c.base);
  const runs = 1 + ((Math.random() * c.runs) | 0);
  for (let r = 0; r < runs; r++) {
    const at = 1 + ((Math.random() * (KOI_SEG - 2)) | 0);
    const long = 1 + ((Math.random() * 3) | 0);
    for (let i = at; i < Math.min(KOI_SEG, at + long); i++) cols[i] = c.hi;
  }
  if (c.sumi) {
    const n = 1 + ((Math.random() * 2) | 0);
    for (let k = 0; k < n; k++) cols[1 + ((Math.random() * (KOI_SEG - 2)) | 0)] = c.sumi;
  }
  /* Tancho: one red crown on an otherwise unmarked white fish. Rare, and the
     one people point at, so it is worth having a one-in-six chance of. */
  const tancho = c.base === '#f7f3ec' && !c.sumi && Math.random() < 0.17;
  if (tancho) cols.fill(c.base);
  return { cols, sheen: c.sheen, tancho, hi: c.hi, dark: c.base === '#262220' };
}

/** Everything about one fish that will not fit in a Particle's four slots. */
interface KoiFish {
  seg: HTMLElement[];
  ang: number[];
  jx: number[];
  jy: number[];
  link: number[];
  shadow: HTMLElement;
  len: number;
  head: number;
  speed: number;
  cruise: number;
  beat: number;
  z: number;
  zWant: number;
  zBase: number;
  zHz: number;
  zPh: number;
  moodHz: number;
  moodPh: number;
  wanderHz: number;
  wanderPh: number;
  /** which way round the pond this one prefers to patrol */
  spin: number;
  /** how hard it commits to food — a pond has bold fish and shy ones */
  bold: number;
  /** how far from the bank its body must stay */
  margin: number;
  band: number;
  gulp: number;
  bubble: number;
}

const koiState = new WeakMap<Particle, KoiFish>();

/** A translucent fin, with the rays fanning out of the point it is joined at. */
function koiFin(w: number, h: number, css: string, from: string, rays: string) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;pointer-events:none;max-width:none;max-height:none;' +
    `width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;` +
    'background-image:' +
    `repeating-conic-gradient(from ${rays}, rgba(255,255,255,0.2) 0 1.3deg, rgba(255,255,255,0) 1.3deg 6.5deg),` +
    `linear-gradient(${from}, rgba(255,255,255,0.4), rgba(255,255,255,0.07));` +
    css;
  return el;
}

/**
 * One koi, as DOM.
 *
 * Everything that can be a child of a segment is a child of a segment: fins,
 * eyes and barbels then inherit the segment's rotation for nothing, and the
 * only per-frame writes for the whole fish are the wrapper, the shadow and the
 * eight ellipses of its spine.
 */
function koiBody(len: number) {
  const coat = koiCoat();
  const maxW = len * 0.26;

  const el = document.createElement('div');
  baseStyle(el, 0, `width:0;height:0;z-index:${Z_DEEP};`);

  /* The cast shadow goes on first so it sits under its own fish. It is a soft
     smear rather than a fish-shaped cut-out, because that is what a shadow
     through a metre of moving water actually is — and it is drawn with gradient
     stops rather than a blur filter, which would re-raster every frame. */
  const shadow = document.createElement('div');
  shadow.style.cssText =
    'position:absolute;left:0;top:0;pointer-events:none;max-width:none;max-height:none;' +
    `width:${(len * 1.12).toFixed(1)}px;height:${(maxW * 1.7).toFixed(1)}px;` +
    'background:radial-gradient(closest-side ellipse, rgba(0,0,0,0.62), rgba(0,0,0,0.3) 54%, rgba(0,0,0,0) 78%);';
  el.appendChild(shadow);

  const seg: HTMLElement[] = [];
  const link: number[] = [];
  for (let i = 0; i < KOI_SEG; i++) {
    link.push(KOI_LINK[i] * len);
    /* Each ellipse is nearly three link-lengths long, so its ends are always
       buried inside its neighbours. At 2.05 you could count the segments: the
       fish had a scalloped outline and read as a caterpillar. */
    const segLen = (i === 0 ? len * 0.24 : link[i] * 2.9);
    const segW = KOI_WIDTH[i] * maxW;
    const from = i === 0 ? coat.cols[0] : coat.cols[i - 1];
    const to = coat.cols[i];

    const s = document.createElement('div');
    s.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;max-width:none;max-height:none;' +
      `width:${segLen.toFixed(1)}px;height:${segW.toFixed(1)}px;border-radius:50%;` +
      'background-image:' +
      /* Lit from the sky, seen from directly above: a bright line down the
         spine and both flanks falling away. This is the layer that turns a flat
         oval into something with a back. */
      `linear-gradient(180deg, rgba(0,0,0,0.17) 0%, rgba(0,0,0,0) 30%,` +
      ` rgba(255,255,255,${(0.19 * coat.sheen).toFixed(2)}) 48%, rgba(255,255,255,0) 70%,` +
      ` rgba(0,0,0,0.15) 100%),` +
      // Scales: two hatchings crossing at low alpha. Invisible as lines, visible as skin.
      'repeating-linear-gradient(56deg, rgba(0,0,0,0.032) 0 1px, rgba(0,0,0,0) 1px 8px),' +
      'repeating-linear-gradient(-56deg, rgba(255,255,255,0.032) 0 1px, rgba(255,255,255,0) 1px 8px),' +
      `linear-gradient(90deg, ${from} 0%, ${from} 12%, ${to} 62%, ${to} 100%);`;
    el.appendChild(s);
    seg.push(s);
  }

  /* --- the head: eyes, barbels, and a tancho crown if it has one --- */
  const headW = KOI_WIDTH[0] * maxW;
  const eyeR = Math.max(2, headW * 0.13);
  for (const side of [-1, 1]) {
    const eye = document.createElement('div');
    eye.style.cssText =
      'position:absolute;pointer-events:none;border-radius:50%;' +
      `width:${(eyeR * 2).toFixed(1)}px;height:${(eyeR * 2).toFixed(1)}px;` +
      `left:${(len * 0.24 * 0.7).toFixed(1)}px;` +
      `top:${(headW / 2 + side * headW * 0.32 - eyeR).toFixed(1)}px;` +
      'background:radial-gradient(circle at 36% 32%, rgba(255,255,255,0.75) 0 18%, #1b1714 34%, #000 100%);';
    seg[0].appendChild(eye);
  }
  // Barbels. Two of them, and they are the reason it reads as a carp and not a goldfish.
  for (const side of [-1, 1]) {
    const w = document.createElement('div');
    w.style.cssText =
      'position:absolute;pointer-events:none;border-radius:2px;' +
      `width:${(len * 0.1).toFixed(1)}px;height:1.6px;` +
      `left:${(len * 0.24 * 0.86).toFixed(1)}px;` +
      `top:${(headW / 2 + side * headW * 0.24).toFixed(1)}px;` +
      'background:linear-gradient(90deg, rgba(90,80,70,0.5), rgba(90,80,70,0));' +
      `transform-origin:0 50%;animation:relaxKoiBarbel ${rand(1.6, 2.6).toFixed(2)}s ease-in-out infinite alternate;` +
      `animation-delay:${(side * 0.4).toFixed(2)}s;`;
    seg[0].appendChild(w);
  }
  if (coat.tancho) {
    const spot = document.createElement('div');
    const d = headW * 0.86;
    spot.style.cssText =
      'position:absolute;pointer-events:none;border-radius:50%;' +
      `width:${d.toFixed(1)}px;height:${(d * 0.82).toFixed(1)}px;` +
      `left:${(len * 0.24 * 0.34).toFixed(1)}px;top:${(headW / 2 - d * 0.41).toFixed(1)}px;` +
      `background:radial-gradient(closest-side ellipse, ${coat.hi} 62%, rgba(217,69,28,0) 100%);`;
    seg[0].appendChild(spot);
  }

  /* --- pectoral fins, on the shoulders. They flutter on a CSS animation of
         their own, on top of whatever the segment they hang from is doing. --- */
  const shoulder = KOI_WIDTH[1] * maxW;
  const fw = len * 0.145;
  const fh = shoulder * 0.6;
  const pecL = koiFin(fw, fh,
    `left:${(link[1] * 0.4).toFixed(1)}px;top:${(-fh * 0.72).toFixed(1)}px;` +
    'border-radius:70% 20% 40% 60% / 80% 30% 70% 20%;transform-origin:88% 94%;' +
    `animation:relaxKoiFinL ${rand(1.1, 1.7).toFixed(2)}s ease-in-out infinite alternate;`,
    '206deg', '188deg at 88% 94%');
  const pecR = koiFin(fw, fh,
    `left:${(link[1] * 0.4).toFixed(1)}px;top:${(shoulder - fh * 0.28).toFixed(1)}px;` +
    'border-radius:70% 20% 60% 40% / 20% 70% 30% 80%;transform-origin:88% 6%;' +
    `animation:relaxKoiFinR ${rand(1.1, 1.7).toFixed(2)}s ease-in-out infinite alternate;`,
    '154deg', '124deg at 88% 6%');
  seg[1].appendChild(pecL);
  seg[1].appendChild(pecR);

  /* --- the dorsal ridge. From above it is barely a fin at all, which is
         exactly how much of it there should be. --- */
  const dorsal = document.createElement('div');
  const dW = KOI_WIDTH[3] * maxW;
  dorsal.style.cssText =
    'position:absolute;pointer-events:none;border-radius:50%;' +
    `width:${(link[3] * 2.6).toFixed(1)}px;height:${(dW * 0.42).toFixed(1)}px;` +
    `left:${(-link[3] * 0.6).toFixed(1)}px;top:${(dW * 0.29).toFixed(1)}px;` +
    'background:linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06));';
  seg[3].appendChild(dorsal);

  /* --- the caudal fin: forked, translucent, and joined at its right edge so
         the last segment's sweep carries it. --- */
  const tailLen = len * 0.27;
  const tailH = maxW * 1.3;
  const tail = koiFin(tailLen, tailH,
    `left:${(-tailLen + link[7] * 1.5).toFixed(1)}px;top:${(KOI_WIDTH[7] * maxW / 2 - tailH / 2).toFixed(1)}px;` +
    'clip-path:polygon(100% 50%, 10% 4%, 42% 50%, 10% 96%);transform-origin:100% 50%;opacity:0.82;' +
    `animation:relaxKoiTail ${rand(0.9, 1.4).toFixed(2)}s ease-in-out infinite alternate;`,
    '270deg', '150deg at 100% 50%');
  seg[7].appendChild(tail);

  return { el, seg, link, shadow, sheen: coat.sheen };
}

/* -- the pond ------------------------------------------------------------- */

/** A layer of the water: pond-sized, pond-shaped, and clipped to it. It is
 *  placed once, here, and the loop never touches its transform again. */
function koiLayer(at: KoiPond, z: number, css: string) {
  const el = document.createElement('div');
  baseStyle(el, 0,
    `width:${POND_W}px;height:${POND_H}px;border-radius:50%;overflow:hidden;z-index:${z};` +
    `transform:translate3d(${(at.x - POND_W / 2).toFixed(1)}px, ${(at.y - POND_H / 2).toFixed(1)}px, 0);` +
    css);
  return el;
}

function koiInner(parent: HTMLElement, css: string) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;pointer-events:none;inset:0;' + css;
  parent.appendChild(el);
  return el;
}

/** Fade every node of the pond in on arrival and out together at the end. */
function koiFade(p: Particle, now: number, ms = 1300) {
  const rise = Math.min(1, (now - p.born) / ms);
  if (!pondEnd) return rise;
  const out = 1 - (now - pondEnd) / 1600;
  if (out <= 0) {
    // Retire it: t must come out ABOVE 1 or the engine will keep stepping it.
    p.born = now - p.life - 1;
    return 0;
  }
  return rise * out;
}

const koi: RelaxEffect = {
  id: 'koi',
  label: 'Koi Pond',
  group: 'Water',
  blurb: 'Real water, a stone edge, and twelve fish that swim with their whole bodies. Click anywhere to scatter food — they turn, race for it, and eat it.',
  space: 'world',
  flash: '',
  burstMs: 120_000,
  openingPop: 0,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 260,

  onStart(x, y, api) {
    startAmbience('ocean');
    /* A second visit while the water is still draining should un-drain it, not
       dig a second pond on top of the first. */
    if (pond && pondBed && pondBed.isConnected) {
      pondEnd = 0;
      return;
    }
    pond = { x, y, dark: api.isDark };
    pondEnd = 0;
    koiLast = 0;
    school.length = 0;
    crumbs.length = 0;

    api.spawn(x, y, 1, K_BED);
    api.spawn(x, y, 2, K_MURK);
    api.spawn(x, y, 1, K_SURFACE);
    api.spawn(x, y, 1, K_RIM);
    api.spawn(x, y, 12, K_FISH);
  },

  onStop() {
    stopAmbience('ocean');
    // Not a teardown — a drain. Everything fades on the same clock and then dies.
    if (pondEnd === 0) pondEnd = performance.now();
  },

  onBurst(x, y, api) {
    if (!pond) return;
    /* Food thrown at the bank lands in the water anyway. Nobody aims, and a
       handful that vanishes into the stones is just a click that did nothing. */
    const ux = (x - pond.x) / (POND_W / 2);
    const uy = (y - pond.y) / (POND_H / 2);
    const r = Math.hypot(ux, uy);
    const fx = r > 0.82 ? pond.x + (ux / r) * 0.82 * (POND_W / 2) : x;
    const fy = r > 0.82 ? pond.y + (uy / r) * 0.82 * (POND_H / 2) : y;
    api.spawn(fx, fy, 5 + ((Math.random() * 4) | 0), K_FOOD);
  },

  create(x, y, now, api, kind = 0, tint, index = 0) {
    const P = pond ?? { x, y, dark: api.isDark };
    const c = koiWater(P.dark);

    /* --------------------------------------------------------- the floor -- */
    if (kind === K_BED) {
      const el = koiLayer(P, Z_BED,
        `background:radial-gradient(closest-side ellipse at 50% 47%, ${c.deep} 0%, ${c.deep} 18%, ${c.mid} 46%, ${c.shallow} 78%, ${c.bank} 100%);` +
        'box-shadow:inset 0 0 110px 40px rgba(0,0,0,0.55);');

      // Silt and weed on the bottom, in patches rather than evenly — a pond bed
      // is not a texture, it is a few darker places.
      koiInner(el,
        'background-image:' +
        `radial-gradient(closest-side ellipse at 24% 66%, ${c.silt} 0%, transparent 100%),` +
        `radial-gradient(closest-side ellipse at 71% 33%, ${c.silt} 0%, transparent 100%),` +
        `radial-gradient(closest-side ellipse at 58% 78%, ${c.silt} 0%, transparent 100%);` +
        'background-size:44% 38%, 36% 30%, 30% 26%;background-repeat:no-repeat;opacity:0.75;');

      // Pebbles, gathered toward the shallows where the light finds them.
      for (let i = 0; i < 44; i++) {
        const th = rand(0, KOI_TAU);
        const rr = Math.sqrt(rand(0.24, 1)) * 0.99;
        const w = rand(11, 30);
        const st = document.createElement('div');
        st.style.cssText =
          'position:absolute;pointer-events:none;' +
          `width:${w.toFixed(1)}px;height:${(w * rand(0.6, 0.86)).toFixed(1)}px;` +
          `left:${(50 + 50 * rr * Math.cos(th)).toFixed(2)}%;top:${(50 + 50 * rr * Math.sin(th)).toFixed(2)}%;` +
          `margin:${(-w * 0.36).toFixed(1)}px 0 0 ${(-w / 2).toFixed(1)}px;` +
          'border-radius:52% 48% 46% 54% / 50% 54% 46% 50%;' +
          `transform:rotate(${rand(0, 180).toFixed(0)}deg);opacity:${rand(0.18, 0.42).toFixed(2)};` +
          `background:linear-gradient(150deg, ${pick(c.stone)} 0%, rgba(0,0,0,0.45) 100%);`;
        el.appendChild(st);
      }

      /* Two nets of light on the floor, drifting against each other. Masked
         away from the middle: caustics reach the bottom in the shallows and are
         swallowed by the depth in the centre, which is most of why the centre
         reads as deep at all. */
      const g = 'radial-gradient(closest-side ellipse, rgba(0,0,0,0.05) 0 18%, rgba(0,0,0,0.32) 52%, rgba(0,0,0,0.86) 82%, #000 100%)';
      const mask = `-webkit-mask-image:${g};mask-image:${g};`;
      koiCausticNet(el, mask, -12, P.dark ? 0.13 : 0.17, 1.15, 0, 'relaxKoiCausA 47s ease-in-out infinite', 1.24, 0.85);
      koiCausticNet(el, mask, 37, P.dark ? 0.09 : 0.11, 2.3, 5, 'relaxKoiCausB 71s ease-in-out infinite', 0.84, 1.26);

      pondBed = el;
      const bed = particle(el, P.x, P.y, POND_W, 900_000, now);
      bed.kind = K_BED;
      return bed;
    }

    /* ----------------------------------------- the water above the fish -- */
    if (kind === K_MURK) {
      const up = index === 1;   // the upper slab is thinner and catches more light
      const a = up ? 0.14 : 0.26;
      const el = koiLayer(P, up ? Z_MURK + 2 : Z_MURK,
        `background:radial-gradient(closest-side ellipse at 50% 47%, rgba(${c.murk},${a}) 0%,` +
        ` rgba(${c.murk},${(a * 0.55).toFixed(2)}) 62%, rgba(${c.murk},${(a * 0.2).toFixed(2)}) 100%);`);
      koiInner(el, 'inset:-10%;opacity:0.5;will-change:transform;' + KOI_SILT(c.silt) +
        `animation:relaxKoiDrift ${up ? 96 : 132}s ease-in-out infinite;`);
      if (up) {
        koiCausticNet(el, 'opacity:0.5;', 7, P.dark ? 0.06 : 0.08, 1.5, 3,
          'relaxKoiCausB 58s ease-in-out infinite', 1.16, 0.9);
      }
      const murk = particle(el, P.x, P.y, POND_W, 900_000, now);
      murk.kind = K_MURK;
      return murk;
    }

    /* ------------------------------------------------------- the surface -- */
    if (kind === K_SURFACE) {
      const el = koiLayer(P, Z_SURFACE, 'box-shadow:inset 0 0 76px 26px rgba(0,0,0,0.42);');

      // The sky, lying on the water. One soft shape, moving too slowly to catch.
      koiInner(el,
        'inset:-20%;mix-blend-mode:screen;will-change:transform;' +
        `background:radial-gradient(closest-side ellipse at 34% 26%, rgba(${P.dark ? '150,190,255' : '255,255,255'},0.3) 0%, transparent 74%),` +
        `radial-gradient(closest-side ellipse at 74% 68%, rgba(${P.dark ? '120,160,230' : '235,245,255'},0.2) 0%, transparent 76%);` +
        'background-size:74% 56%, 58% 44%;background-repeat:no-repeat;' +
        'animation:relaxKoiSky 118s ease-in-out infinite;');

      /* Wind on the water. The bands run across, so the gradient angle is ~178°
         — a repeating-linear-gradient draws its bands PERPENDICULAR to its
         angle, and 92° here gave the pond vertical stripes for an hour. */
      koiInner(el,
        'inset:-8%;will-change:transform;opacity:0.55;' +
        'background-image:repeating-linear-gradient(178deg,' +
        ' rgba(255,255,255,0.055) 0 1.5px, rgba(0,0,0,0.035) 1.5px 3px, rgba(255,255,255,0) 3px 11px);' +
        'animation:relaxKoiWind 19s linear infinite;');

      // The glitter: the same net as the floor, but finer, faster and on top.
      koiCausticNet(el, 'animation:relaxKoiShimmer 7s ease-in-out infinite alternate;', -37,
        P.dark ? 0.1 : 0.12, 0.6, 2, 'relaxKoiCausA 31s ease-in-out infinite', 1.45, 0.78);

      // The dark ring the stones throw onto the water they overhang.
      koiInner(el,
        'background:radial-gradient(closest-side ellipse, transparent 78%, rgba(0,0,0,0.34) 94%, rgba(0,0,0,0.5) 100%);');

      const surf = particle(el, P.x, P.y, POND_W, 900_000, now);
      surf.kind = K_SURFACE;
      return surf;
    }

    /* ------------------------------------------- the bank: stones, pads -- */
    if (kind === K_RIM) {
      const RW = POND_W + 170;
      const RH = POND_H + 170;
      const el = document.createElement('div');
      baseStyle(el, 0,
        `width:${RW}px;height:${RH}px;z-index:${Z_RIM};` +
        `transform:translate3d(${(P.x - RW / 2).toFixed(1)}px, ${(P.y - RH / 2).toFixed(1)}px, 0);`);

      // Wet ground and moss outside the stones.
      koiInner(el,
        'border-radius:50%;background:' +
        `radial-gradient(closest-side ellipse, transparent 72%, rgba(${P.dark ? '18,36,24' : '42,74,40'},0.62) 86%,` +
        ` rgba(${P.dark ? '8,18,12' : '22,44,24'},0.85) 100%),` +
        // Moss in patches, so the bank is a place rather than a band.
        `radial-gradient(closest-side ellipse at 18% 34%, rgba(${P.dark ? '30,58,34' : '74,110,52'},0.55), transparent 100%),` +
        `radial-gradient(closest-side ellipse at 76% 71%, rgba(${P.dark ? '26,50,30' : '66,100,48'},0.5), transparent 100%),` +
        `radial-gradient(closest-side ellipse at 62% 14%, rgba(${P.dark ? '22,44,26' : '58,92,44'},0.45), transparent 100%);` +
        'background-size:100% 100%, 40% 26%, 34% 22%, 26% 18%;background-repeat:no-repeat;');

      /* The stone edge. The stones follow their own wandering radius rather than
         the water's ellipse, so some sit out on the bank and some stand in the
         shallows — which is what stops a laid edge looking like a laid edge. */
      const w1 = rand(0, KOI_TAU);
      const w2 = rand(0, KOI_TAU);
      /* Two passes: the laid edge, then a scatter of smaller ones tucked in
         among it. One even row of identical lozenges is a necklace rather than
         a bank, and the second pass is what breaks the rhythm. */
      const laid = 44;
      for (let i = 0; i < laid + 24; i++) {
        const edge = i < laid;
        const th = edge ? (i / laid) * KOI_TAU + rand(-0.03, 0.03) : rand(0, KOI_TAU);
        const rr = 1 + 0.038 * Math.sin(3 * th + w1) + 0.026 * Math.sin(5 * th + w2) +
          (edge ? rand(-0.014, 0.014) : rand(-0.055, 0.05));
        const w = edge ? rand(58, 142) : rand(22, 62);
        const h = w * rand(0.5, 0.84);
        const wet = rr < 1;
        const st = document.createElement('div');
        st.style.cssText =
          'position:absolute;pointer-events:none;' +
          `width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;` +
          `left:${(RW / 2 + (POND_W / 2) * rr * Math.cos(th)).toFixed(1)}px;` +
          `top:${(RH / 2 + (POND_H / 2) * rr * Math.sin(th)).toFixed(1)}px;` +
          `margin:${(-h / 2).toFixed(1)}px 0 0 ${(-w / 2).toFixed(1)}px;` +
          `border-radius:${rand(42, 58) | 0}% ${rand(42, 58) | 0}% ${rand(42, 58) | 0}% ${rand(42, 58) | 0}% /` +
          ` ${rand(44, 56) | 0}% ${rand(44, 56) | 0}% ${rand(44, 56) | 0}% ${rand(44, 56) | 0}%;` +
          `transform:rotate(${rand(-30, 30).toFixed(1)}deg);` +
          `background:linear-gradient(${rand(120, 165).toFixed(0)}deg, ${pick(c.stone)} 0%,` +
          ` rgba(0,0,0,${wet ? 0.55 : 0.3}) 100%);` +
          `box-shadow:0 8px 18px rgba(0,0,0,0.42), inset 0 1px 2px rgba(255,255,255,${wet ? 0.16 : 0.1}),` +
          ' inset 0 -5px 10px rgba(0,0,0,0.36);' +
          `opacity:${(edge ? rand(0.9, 1) : rand(0.72, 0.95)).toFixed(2)};`;
        el.appendChild(st);
      }

      /* Lily pads. Notched with a mask rather than drawn with a notch, so the
         leaf underneath can be a proper gradient instead of a flat wedge. */
      for (let i = 0; i < 9; i++) {
        const th = rand(0, KOI_TAU);
        const rr = rand(0.28, 0.78);
        // A raft of pads is mostly small ones, with two or three big.
        const d = i < 3 ? rand(112, 178) : rand(48, 104);
        const notch = rand(0, 360);
        const wrap = document.createElement('div');
        wrap.style.cssText =
          'position:absolute;pointer-events:none;' +
          `width:${d.toFixed(1)}px;height:${(d * rand(0.82, 0.96)).toFixed(1)}px;` +
          `left:${(RW / 2 + (POND_W / 2) * rr * Math.cos(th)).toFixed(1)}px;` +
          `top:${(RH / 2 + (POND_H / 2) * rr * Math.sin(th)).toFixed(1)}px;` +
          `margin:${(-d * 0.46).toFixed(1)}px 0 0 ${(-d / 2).toFixed(1)}px;` +
          `opacity:${rand(0.86, 0.97).toFixed(2)};` +
          `animation:relaxKoiPad ${rand(8, 14).toFixed(1)}s ease-in-out infinite alternate;` +
          `animation-delay:${rand(-8, 0).toFixed(1)}s;will-change:transform;`;
        const sh = document.createElement('div');
        sh.style.cssText =
          'position:absolute;inset:0;border-radius:50%;transform:translate(9px, 16px) scale(1.02);' +
          'background:radial-gradient(closest-side ellipse, rgba(0,0,0,0.34), rgba(0,0,0,0.16) 62%, transparent 82%);';
        const leaf = document.createElement('div');
        leaf.style.cssText =
          'position:absolute;inset:0;border-radius:50%;' +
          `-webkit-mask-image:conic-gradient(from ${notch}deg, transparent 0 15deg, #000 15deg 100%);` +
          `mask-image:conic-gradient(from ${notch}deg, transparent 0 15deg, #000 15deg 100%);` +
          'background-image:' +
          /* Ribs, but barely: at 0.07 they fanned out like a beach umbrella. A
             pad shows its ribs where the light catches them and nowhere else,
             so they go under the sheen rather than over it. */
          `repeating-conic-gradient(from ${notch + 8}deg at 50% 50%, rgba(255,255,255,0.038) 0 0.6deg, transparent 0.6deg 19deg),` +
          'radial-gradient(circle at 62% 74%, rgba(255,255,255,0.12) 0%, transparent 46%),' +
          'linear-gradient(158deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 34%),' +
          `radial-gradient(circle at 34% 28%, ${P.dark ? '#33613a' : '#59904c'} 0%, ${P.dark ? '#22492a' : '#3a6b3a'} 44%,` +
          ` ${P.dark ? '#153320' : '#244d2b'} 78%, ${P.dark ? '#0e2717' : '#1a3d23'} 100%);` +
          'box-shadow:inset 0 -6px 14px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.08);';
        wrap.appendChild(sh);
        wrap.appendChild(leaf);
        el.appendChild(wrap);
      }

      /* Two water lilies, because a pond wants somewhere for the eye to land.
         Two rings of narrow petals rather than one ring of fat ones — nine fat
         petals is a daisy, and a daisy floating on a pond is a sticker. */
      for (let i = 0; i < 2; i++) {
        const th = rand(0, KOI_TAU);
        const rr = rand(0.34, 0.66);
        const d = rand(58, 78);
        const wrap = document.createElement('div');
        wrap.style.cssText =
          'position:absolute;pointer-events:none;' +
          `width:${d}px;height:${d}px;` +
          `left:${(RW / 2 + (POND_W / 2) * rr * Math.cos(th)).toFixed(1)}px;` +
          `top:${(RH / 2 + (POND_H / 2) * rr * Math.sin(th)).toFixed(1)}px;` +
          `margin:${(-d / 2).toFixed(1)}px 0 0 ${(-d / 2).toFixed(1)}px;` +
          `animation:relaxKoiLotus ${rand(11, 16).toFixed(1)}s ease-in-out infinite alternate;will-change:transform;`;
        const petals = (n: number, len: number, wide: number, lift: number, top: string, mid: string, tip: string, turn: number) => {
          for (let k = 0; k < n; k++) {
            const petal = document.createElement('div');
            petal.style.cssText =
              'position:absolute;left:50%;top:50%;pointer-events:none;' +
              `width:${(d * wide).toFixed(1)}px;height:${(d * len).toFixed(1)}px;` +
              `margin:${(-d * len).toFixed(1)}px 0 0 ${(-d * wide * 0.5).toFixed(1)}px;` +
              'border-radius:52% 52% 40% 40% / 66% 66% 34% 34%;transform-origin:50% 100%;' +
              `transform:rotate(${((k / n) * 360 + turn).toFixed(1)}deg) translateY(${(d * lift).toFixed(1)}px);` +
              `background:linear-gradient(180deg, ${top} 0%, ${mid} 58%, ${tip} 100%);` +
              'box-shadow:0 1px 2px rgba(0,0,0,0.14);';
            wrap.appendChild(petal);
          }
        };
        // Sepals, then the open flower, then a tight pale heart.
        petals(7, 0.44, 0.13, 0.2, '#7fa86a', '#5d8a52', '#456b3e', 26);
        petals(9, 0.42, 0.14, 0.12, '#fffafc', '#f6dfe8', '#e6b8cd', 0);
        petals(7, 0.3, 0.12, 0.06, '#ffffff', '#fdf1f5', '#f3d3e0', 22);
        const heart = document.createElement('div');
        heart.style.cssText =
          'position:absolute;left:50%;top:50%;pointer-events:none;border-radius:50%;' +
          `width:${(d * 0.2).toFixed(1)}px;height:${(d * 0.2).toFixed(1)}px;` +
          `margin:${(-d * 0.1).toFixed(1)}px 0 0 ${(-d * 0.1).toFixed(1)}px;` +
          'background:radial-gradient(circle at 42% 38%, #fff4c4 0 30%, #edcb62 68%, #c9a032 100%);';
        wrap.appendChild(heart);
        el.appendChild(wrap);
      }

      const rim = particle(el, P.x, P.y, POND_W, 900_000, now);
      rim.kind = K_RIM;
      return rim;
    }

    /* ---------------------------------------------------------- the fish -- */
    if (kind === K_FISH) {
      const len = rand(76, 132);
      const built = koiBody(len);
      const th = rand(0, KOI_TAU);
      const rr = Math.sqrt(Math.random()) * 0.62;
      const p = particle(built.el, P.x + Math.cos(th) * rr * (POND_W / 2), P.y + Math.sin(th) * rr * (POND_H / 2), len, 900_000, now);
      p.kind = K_FISH;
      const z = rand(0.15, 0.85);
      koiState.set(p, {
        seg: built.seg,
        link: built.link,
        shadow: built.shadow,
        ang: new Array(KOI_SEG).fill(th),
        jx: new Array(KOI_SEG).fill(0),
        jy: new Array(KOI_SEG).fill(0),
        len,
        head: th,
        speed: rand(0.4, 0.9),
        // Big fish are slower. It is the single cue that makes them read as big.
        cruise: rand(0.62, 1.15) * (1.28 - len / 210),
        beat: rand(0, KOI_TAU),
        z,
        zWant: z,
        zBase: z,
        zHz: rand(0.00004, 0.00011),
        zPh: rand(0, KOI_TAU),
        moodHz: rand(0.00006, 0.00016),
        moodPh: rand(0, KOI_TAU),
        wanderHz: rand(0.0004, 0.0011),
        wanderPh: rand(0, KOI_TAU),
        spin: Math.random() < 0.5 ? -1 : 1,
        bold: rand(0.35, 1),
        margin: 40 + len * 0.62,
        band: -1,
        gulp: 0,
        bubble: now + rand(8000, 60_000),
      });
      school.push(p);
      return p;
    }

    /* ---------------------------------------------------------- the food -- */
    if (kind === K_FOOD) {
      const d = rand(7, 11);
      const el = document.createElement('div');
      baseStyle(el, d, `border-radius:50%;z-index:${Z_DEEP + 4};` +
        'background:radial-gradient(circle at 34% 28%, #ffe0ad 0 16%, #d98f3e 52%, #7d4b1a 100%);' +
        'box-shadow:0 1px 2px rgba(0,0,0,0.35);');
      const p = particle(el, x + rand(-46, 46), y + rand(-40, 40), d, 30_000, now);
      p.kind = K_FOOD;
      p.a = -rand(0.55, 1.15);        // above the water, still falling
      p.b = rand(0.75, 1.3);          // how fast this one sinks
      p.c = 0;                        // eaten
      p.d = rand(0, KOI_TAU);         // its wobble
      crumbs.push(p);
      return p;
    }

    /* --------------------------------------------------- rings and spray -- */
    if (kind === K_RING) {
      const el = document.createElement('div');
      const size = 46;
      const g = P.dark ? '190,232,255' : '255,255,255';
      baseStyle(el, size,
        `border-radius:50%;z-index:${Z_RIPPLE};` +
        `border:1.5px solid rgba(${g},0.5);` +
        `box-shadow:0 0 8px rgba(${g},0.2), inset 0 0 10px rgba(0,0,0,0.16);`);
      const p = particle(el, x, y, size, rand(1700, 2600), now);
      p.kind = K_RING;
      p.a = index * 0.12;                    // each ring of a splash leaves later
      p.b = rand(3.4, 6.2);
      p.c = rand(0.4, 0.75);
      return p;
    }

    if (kind === K_DROP) {
      const d = rand(3, 6);
      const el = document.createElement('div');
      baseStyle(el, d, `border-radius:50%;z-index:${Z_RIPPLE};` +
        `background:radial-gradient(circle at 36% 30%, rgba(255,255,255,0.95), rgba(${P.dark ? '170,220,255' : '210,235,240'},0.6));`);
      const p = particle(el, x, y, d, rand(420, 700), now);
      p.kind = K_DROP;
      const th = rand(0, KOI_TAU);
      const sp = rand(1.4, 3.6);
      p.vx = Math.cos(th) * sp;
      p.vy = Math.sin(th) * sp;
      p.a = rand(0.06, 0.12);                // gravity, such as it is from above
      return p;
    }

    if (kind === K_BUBBLE) {
      const d = rand(4, 9);
      const el = document.createElement('div');
      baseStyle(el, d, `border-radius:50%;z-index:${Z_DEEP + 4};` +
        'background:radial-gradient(circle at 34% 30%, rgba(255,255,255,0.8) 0 20%, rgba(255,255,255,0.12) 46%, rgba(255,255,255,0.34) 82%, rgba(255,255,255,0.05) 100%);' +
        'box-shadow:inset 0 0 4px rgba(255,255,255,0.4);');
      const p = particle(el, x, y, d, 14_000, now);
      p.kind = K_BUBBLE;
      /* The depth it was let go at, handed over as the tint — the only
         per-spawn value the engine passes through. Spawned at `index` it was
         born at the surface and popped on the frame it appeared. */
      p.a = Number(tint) || 0.5;
      p.b = rand(0.0022, 0.0045);
      p.c = rand(0, KOI_TAU);
      return p;
    }

    // Unreachable in practice — the engine only ever spawns what onStart asks for.
    const el = document.createElement('div');
    baseStyle(el, 1, '');
    return particle(el, x, y, 1, 100, now);
  },

  step(p, t, now, api) {
    const fade = koiFade(p, now);
    if (fade <= 0) return;

    switch (p.kind) {
      /* The pond itself never moves: its transform was written once, at build
         time, and the loop only ever touches its opacity. */
      case K_BED: {
        /* One clock for everybody. The bed is spawned first, so it steps first,
           and every fish this frame integrates against the same dt — otherwise
           the pond runs at double speed on a 120Hz display. */
        const dt = koiLast ? now - koiLast : 16.7;
        koiLast = now;
        koiK = Math.max(0.25, Math.min(2.6, dt / 16.7));
        for (let i = school.length - 1; i >= 0; i--) if (!school[i].el.isConnected) school.splice(i, 1);
        for (let i = crumbs.length - 1; i >= 0; i--) if (!crumbs[i].el.isConnected) crumbs.splice(i, 1);
        p.el.style.opacity = String(fade);
        return;
      }
      case K_MURK:
      case K_SURFACE:
      case K_RIM:
        p.el.style.opacity = String(fade);
        return;

      /* ------------------------------------------------------------ koi -- */
      case K_FISH: {
        const f = koiState.get(p);
        if (!f || !pond) return;
        const k = koiK;
        const P = pond;

        /* What it wants, as a vector. Steering is summed as directions and
           resolved once — averaging ANGLES wraps at π and sends a fish that
           wanted to go slightly left into a spin. */
        let dx = Math.cos(f.head);
        let dy = Math.sin(f.head);
        let urge = 0;

        // A slow meander, so a fish with nothing to do still has an opinion.
        const wob = Math.sin(now * f.wanderHz + f.wanderPh);
        dx += -Math.sin(f.head) * wob * 0.55;
        dy += Math.cos(f.head) * wob * 0.55;

        /* Food. Nearest wins, but depth counts against distance — a pellet on
           the floor is not interesting to a fish cruising the surface until it
           has nothing better, which is what stops all twelve stacking on the
           first crumb to land. */
        let best: Particle | null = null;
        let bestD = 1e9;
        for (const c of crumbs) {
          if (c.a < 0 || c.c) continue;
          const ax = c.x - p.x;
          const ay = c.y - p.y;
          const d = Math.sqrt(ax * ax + ay * ay) + Math.abs(c.a - f.z) * 300 * (1.2 - f.bold);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best && bestD < 700) {
          const ax = best.x - p.x;
          const ay = best.y - p.y;
          const d = Math.sqrt(ax * ax + ay * ay) || 1;
          /* Ease off as it arrives. At full weight right on top of the pellet
             every fish in range drove into the same point and they welded into
             one animal — a koi that has reached the food mills in it. */
          const w = (2.4 + f.bold * 1.6) * Math.min(1, d / 90);
          dx += (ax / d) * w;
          dy += (ay / d) * w;
          urge = 1;
          f.zWant = best.a;

          // The mouth is at the front of the head segment, not at the middle.
          const mx = p.x + Math.cos(f.head) * f.len * 0.4;
          const my = p.y + Math.sin(f.head) * f.len * 0.4;
          const bite = Math.hypot(best.x - mx, best.y - my);
          if (bite < 16 + f.len * 0.1 && Math.abs(best.a - f.z) < 0.24) {
            best.c = 1;                         // taken
            best.born = now - best.life + 180;  // and gone, over a couple of frames
            f.gulp = now + 260;
            f.speed *= 1.35;
            if (now - lastGulp > 110) { lastGulp = now; playPlop(); }
            if (best.a < 0.14) api.spawn(best.x, best.y, 1, K_RING);
          }
        }

        /* Neighbours. Separation only, and only from fish at roughly the same
           depth — two koi passing over each other is a thing that happens. */
        for (const o of school) {
          if (o === p) continue;
          const of_ = koiState.get(o);
          if (!of_) continue;
          const ox = p.x - o.x;
          const oy = p.y - o.y;
          const near = 74 + f.len * 0.58;
          const d2 = ox * ox + oy * oy;
          if (d2 > near * near || d2 < 0.5) continue;
          const zGap = Math.min(1, Math.abs(of_.z - f.z) * 3.4);
          const d = Math.sqrt(d2);
          const push = (1 - d / near) * 3.4 * (1 - zGap);
          dx += (ox / d) * push;
          dy += (oy / d) * push;
        }

        /* The bank. A koi that meets the edge turns and runs along it; a koi
           that bounces off it reads as a screensaver, so the correction is
           mostly tangent and only a little inward. */
        const ax = POND_W / 2 - f.margin;
        const ay = POND_H / 2 - f.margin;
        const ux = (p.x - P.x) / ax;
        const uy = (p.y - P.y) / ay;
        const r = Math.sqrt(ux * ux + uy * uy);
        if (r > 0.7) {
          const push = Math.min(4.2, ((r - 0.7) / 0.3) * 4.2);
          const inx = -ux / r;
          const iny = -uy / r;
          dx += (inx * 0.42 - iny * f.spin * 0.58) * push;
          dy += (iny * 0.42 + inx * f.spin * 0.58) * push;
        }
        if (r > 1) {
          p.x = P.x + (ux / r) * ax;
          p.y = P.y + (uy / r) * ay;
        }

        /* Turn toward it, rate-limited — and limited harder the faster it is
           going, because a body with momentum turns in a wider arc. */
        const want = Math.atan2(dy, dx);
        let diff = want - f.head;
        while (diff > Math.PI) diff -= KOI_TAU;
        while (diff < -Math.PI) diff += KOI_TAU;
        const agility = (0.058 - Math.min(0.034, f.speed * 0.013)) * k;
        f.head += Math.max(-agility, Math.min(agility, diff));

        /* Speed. Koi do not cruise: they beat, glide, and hang almost still for
           minutes at a time. `mood` is that hour-long lull, and it is the
           difference between a pond and a screensaver. */
        const mood = 0.5 + 0.5 * Math.sin(now * f.moodHz + f.moodPh);
        let goal = f.cruise * (0.16 + mood * 1.05);
        if (urge) goal = f.cruise * 2.5;
        else if (now < f.gulp) goal = f.cruise * 1.6;
        f.speed += (goal - f.speed) * 0.04 * k;

        // The tail beats faster the harder it is working. It is never zero.
        f.beat += (0.06 + f.speed * 0.058) * k;
        const surge = 0.86 + 0.26 * Math.abs(Math.sin(f.beat));
        p.x += Math.cos(f.head) * f.speed * surge * k;
        p.y += Math.sin(f.head) * f.speed * surge * k;

        // Depth: a slow rise and fall, overruled by anything worth eating.
        if (!urge) f.zWant = f.zBase + Math.sin(now * f.zHz + f.zPh) * 0.28;
        f.z += (Math.max(0.04, Math.min(0.96, f.zWant)) - f.z) * 0.014 * k;

        /* The spine. Each joint's angle is the one in front of it plus a
           travelling wave whose amplitude grows toward the tail — that is the
           carangiform stroke, and it is why the fish looks like it is pushing
           water rather than being dragged along a path. The rate limit on top
           is what makes the body LAG through a turn. */
        const flick = now < f.gulp ? 2.1 : 1;
        const amp = (0.1 + Math.min(0.16, f.speed * 0.075)) * flick;
        f.ang[0] = f.head;
        f.jx[0] = 0;
        f.jy[0] = 0;
        for (let i = 1; i < KOI_SEG; i++) {
          const s = i / (KOI_SEG - 1);
          const wave = Math.sin(f.beat - s * 3.9) * amp * (0.28 + s * s * 1.45);
          let d = f.ang[i - 1] + wave - f.ang[i];
          while (d > Math.PI) d -= KOI_TAU;
          while (d < -Math.PI) d += KOI_TAU;
          f.ang[i] += Math.max(-0.22 * k, Math.min(0.22 * k, d));
          // No folding: a carp is a stiff animal compared with an eel.
          let rel = f.ang[i] - f.ang[i - 1];
          while (rel > Math.PI) rel -= KOI_TAU;
          while (rel < -Math.PI) rel += KOI_TAU;
          f.ang[i] = f.ang[i - 1] + Math.max(-0.4, Math.min(0.4, rel));
          f.jx[i] = f.jx[i - 1] - Math.cos(f.ang[i]) * f.link[i];
          f.jy[i] = f.jy[i - 1] - Math.sin(f.ang[i]) * f.link[i];
        }

        // Nearer the surface is nearer the eye: bigger, brighter, sharper.
        const lift = 1 - f.z;
        const scale = 0.74 + lift * 0.34;
        p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        p.el.style.opacity = String(fade * (0.74 + lift * 0.26));

        const band = f.z < 0.36 ? 2 : f.z < 0.68 ? 1 : 0;
        if (band !== f.band) {
          f.band = band;
          p.el.style.zIndex = String(Z_DEEP + band * 2);
        }

        for (let i = 0; i < KOI_SEG; i++) {
          const s = f.seg[i];
          const w = i === 0 ? f.len * 0.24 : f.link[i] * 2.9;
          const h = KOI_WIDTH[i] * f.len * 0.26;
          s.style.transform =
            `translate3d(${(f.jx[i] - w / 2).toFixed(1)}px, ${(f.jy[i] - h / 2).toFixed(1)}px, 0)` +
            ` rotate(${((f.ang[i] * 180) / Math.PI).toFixed(1)}deg)`;
        }

        /* The shadow on the floor. It lies under the middle of the body, slides
           away from the fish as the fish rises, and softens and spreads as it
           goes — which is the cue that tells you how deep the fish is even when
           you are not looking at it. */
        const sx = -Math.cos(f.ang[3]) * f.len * 0.34 + lift * 34;
        const sy = -Math.sin(f.ang[3]) * f.len * 0.34 + lift * 78;
        f.shadow.style.transform =
          `translate3d(${(sx - f.len * 0.56).toFixed(1)}px, ${(sy - f.len * 0.22).toFixed(1)}px, 0)` +
          ` rotate(${((f.ang[3] * 180) / Math.PI).toFixed(1)}deg) scale(${(1 + lift * 0.4).toFixed(2)})`;
        f.shadow.style.opacity = String((0.22 + f.z * 0.36) * fade);

        // Every so often one lets a bubble go, and it climbs.
        if (now > f.bubble) {
          f.bubble = now + rand(30_000, 120_000);
          api.spawn(p.x - Math.cos(f.head) * f.len * 0.2, p.y - Math.sin(f.head) * f.len * 0.2,
            1, K_BUBBLE, String(f.z));
        }
        return;
      }

      /* ----------------------------------------------------------- food -- */
      case K_FOOD: {
        const k = koiK;
        if (p.a < 0) {
          // Still in the air. It is closer to the eye, so it is bigger.
          p.a += 0.055 * k;
          if (p.a >= 0) {
            p.a = 0;
            api.spawn(p.x, p.y, 2, K_RING);
            api.spawn(p.x, p.y, 3, K_DROP);
            if (now - lastGulp > 90) { lastGulp = now; playPlop(); }
          }
          const s = 1 + Math.max(0, -p.a) * 1.6;
          p.el.style.transform =
            `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${s.toFixed(2)})`;
          p.el.style.opacity = String(fade * 0.9);
          return;
        }
        if (!p.c) {
          // Sinking, and wobbling as it goes the way a light thing does in water.
          p.a = Math.min(1, p.a + 0.0016 * p.b * k);
          p.x += Math.sin(now * 0.0022 + p.d) * 0.14 * k;
          p.y += Math.cos(now * 0.0019 + p.d * 1.7) * 0.1 * k;
        }
        const zi = p.a < 0.36 ? 2 : p.a < 0.68 ? 1 : 0;
        if (p.vx !== zi + 1) { p.vx = zi + 1; p.el.style.zIndex = String(Z_DEEP + zi * 2 + 1); }
        const s = (1.05 - p.a * 0.3) * (p.c ? Math.max(0, 1 - (t - (1 - 180 / p.life)) * 8) : 1);
        p.el.style.transform =
          `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${Math.max(0, s).toFixed(2)})`;
        // Uneaten food dissolves into the silt rather than lying there forever.
        p.el.style.opacity = String(fade * (t > 0.75 ? (1 - t) * 4 : 1) * (0.95 - p.a * 0.25));
        return;
      }

      /* ---------------------------------------------------------- rings -- */
      case K_RING: {
        const local = (t - p.a) / (1 - p.a);
        if (local <= 0) { p.el.style.opacity = '0'; return; }
        // Rings slow as they widen; the water is taking the energy back.
        const eased = 1 - Math.pow(1 - local, 2.6);
        p.el.style.transform =
          `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${(0.16 + eased * p.b).toFixed(3)})`;
        p.el.style.opacity = String(fade * Math.pow(1 - local, 1.4) * p.c);
        return;
      }

      case K_DROP: {
        p.vy += p.a * koiK;
        p.x += p.vx * koiK;
        p.y += p.vy * koiK;
        p.el.style.transform =
          `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${(1 - t * 0.4).toFixed(2)})`;
        p.el.style.opacity = String(fade * (1 - t) * 0.85);
        return;
      }

      case K_BUBBLE: {
        p.a -= p.b * koiK;
        if (p.a <= 0.02) {
          api.spawn(p.x, p.y, 1, K_RING);
          p.born = now - p.life - 1;
          return;
        }
        const wob = Math.sin(now * 0.004 + p.c) * 9;
        const s = 0.8 + (1 - p.a) * 0.5;
        p.el.style.transform =
          `translate3d(${(p.x + wob - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${s.toFixed(2)})`;
        p.el.style.opacity = String(fade * 0.7);
        return;
      }
    }
  },
};

/* ------------------------------------------------------------------- ink -- */
/**
 * A drop of ink let into still water.
 *
 * The whole thing is one gesture and it is over in four seconds, but it is the
 * hardest to look away from in the set. Three species: the head, which falls
 * and blooms; the tendrils, which are thrown outward and curl as they slow; and
 * the veil, a wide soft stain that arrives last and holds the shape together.
 *
 * On dark paper real ink would be invisible, so the same physics carries a
 * luminous pigment instead and blends on screen rather than multiply.
 */
const INK_DARK = ['#63e8ff', '#7aa2ff', '#c58bff', '#5affc8'];
const INK_LIGHT = ['#1b2a6b', '#2d1550', '#0b3a52', '#3a0f2e'];

const ink: RelaxEffect = {
  id: 'ink',
  label: 'Ink in Water',
  group: 'Water',
  blurb: 'One drop, and then four seconds you will not look away from. It unfurls, throws out threads, and settles into a stain.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 1,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 420,
  onBurst(x, y, api) {
    playPlop();
    api.spawn(x, y, 14, 1);   // tendrils
    api.spawn(x, y, 3, 2);    // veil
  },
  create(x, y, now, api, kind = 0) {
    const tint = pick(api.isDark ? INK_DARK : INK_LIGHT);
    const blend = api.isDark ? 'mix-blend-mode:screen;' : 'mix-blend-mode:multiply;';
    const el = document.createElement('div');

    if (kind === 1) {
      // A thread: long, soft, and thrown outward on its own bearing.
      const size = rand(30, 62);
      baseStyle(
        el, size,
        `${blend}border-radius:50%;filter:blur(${rand(3, 7).toFixed(1)}px);` +
          `background:radial-gradient(closest-side ellipse, ${tint} 0 40%, transparent 100%);`
      );
      const p = particle(el, x, y, size, rand(2600, 4200), now);
      p.a = rand(0, Math.PI * 2);
      p.c = rand(0.9, 2.6);          // how far it is thrown
      p.b = rand(-0.5, 0.5);         // the curl
      p.d = rand(2.4, 5.6);          // how much it stretches as it goes
      p.tint = tint;
      p.kind = 1;
      return p;
    }

    if (kind === 2) {
      // The stain. Arrives late, spreads wide, never fully leaves.
      const size = rand(150, 240);
      baseStyle(
        el, size,
        `${blend}border-radius:50%;filter:blur(${rand(14, 26).toFixed(0)}px);opacity:0;` +
          `background:radial-gradient(closest-side circle, ${tint} 0 46%, transparent 100%);`
      );
      const p = particle(el, x + rand(-30, 30), y + rand(-30, 30), size, rand(4200, 5600), now);
      p.a = rand(0.16, 0.34);
      p.b = rand(1.5, 2.4);
      p.kind = 2;
      return p;
    }

    // The head of the drop.
    const size = rand(54, 80);
    baseStyle(
      el, size,
      `${blend}border-radius:50%;filter:blur(6px);` +
        `background:radial-gradient(closest-side circle, ${tint} 0 52%, transparent 100%);`
    );
    const p = particle(el, x, y, size, 3600, now);
    p.b = rand(2.6, 3.6);
    return p;
  },
  step(p, t) {
    if (p.kind === 1) {
      // Ease-out along a curving bearing, stretching as it slows — that stretch
      // is the difference between a thread of ink and a flying dot.
      const e = 1 - Math.pow(1 - t, 2.6);
      const ang = p.a + p.b * e;
      const dist = e * p.c * 120;
      const stretch = 1 + e * p.d;
      p.el.style.transform =
        `translate3d(${p.x - p.size / 2 + Math.cos(ang) * dist}px, ${p.y - p.size / 2 + Math.sin(ang) * dist}px, 0) ` +
        `rotate(${(ang * 180) / Math.PI}deg) scale(${stretch}, ${1 + e * 0.5})`;
      p.el.style.opacity = String(Math.min(1, t * 6) * (1 - t) * 0.7);
      return;
    }

    if (p.kind === 2) {
      const local = Math.max(0, (t - p.a) / (1 - p.a));
      const e = 1 - Math.pow(1 - local, 2);
      p.el.style.transform =
        `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${0.4 + e * p.b})`;
      p.el.style.opacity = String(Math.min(1, local * 3) * (1 - local) * 0.42);
      return;
    }

    const e = 1 - Math.pow(1 - t, 2.2);
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${0.3 + e * p.b})`;
    p.el.style.opacity = String(Math.min(1, t * 8) * (1 - t) * 0.85);
  },
};

/* ------------------------------------------------------------------ soap -- */
/**
 * Bubbles you have to chase.
 *
 * Bubblewrap is a grid that waits for you; this is the opposite — they rise,
 * they wobble, and if you dawdle they are gone off the top of the screen. The
 * iridescence is a conic gradient rather than a colour, because a soap film
 * shifts hue around its circumference and a flat tint reads as a marble.
 */
const soap: RelaxEffect = {
  id: 'soap',
  label: 'Soap Bubbles',
  group: 'Play',
  blurb: 'They rise on their own and they do not wait. Catch one and it bursts into mist.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 7,
  spawnEveryMs: 620,
  spawnPerTick: 1,
  maxParticles: 46,
  interactive: true,
  onPop(p, api) {
    playSnap();
    api.spawn(p.x, p.y, 9, 1);
  },
  create(x, y, now, api, kind = 0) {
    const el = document.createElement('div');

    if (kind === 1) {
      // The mist a bubble leaves. Small, fast, and gone.
      const size = rand(4, 9);
      baseStyle(el, size, 'border-radius:50%;background:rgba(255,255,255,0.75);');
      const p = particle(el, x, y, size, rand(380, 720), now);
      const a = rand(0, Math.PI * 2);
      p.vx = Math.cos(a) * rand(1.4, 4.2);
      p.vy = Math.sin(a) * rand(1.4, 4.2);
      p.kind = 1;
      return p;
    }

    const size = rand(34, 84);
    baseStyle(
      el, size,
      'border-radius:50%;cursor:pointer;' +
        'background:' +
        // the film: hue running right round the rim
        'conic-gradient(from 210deg, rgba(255,120,190,0.55), rgba(120,220,255,0.55) 25%, ' +
        'rgba(180,255,190,0.5) 45%, rgba(255,230,130,0.55) 65%, rgba(200,150,255,0.55) 85%, rgba(255,120,190,0.55)),' +
        // the shell: bright rim, empty middle
        'radial-gradient(circle at 50% 50%, transparent 46%, rgba(255,255,255,0.55) 74%, rgba(255,255,255,0.12) 100%);' +
        'box-shadow:inset -6px -8px 18px rgba(120,180,255,0.34), inset 6px 8px 16px rgba(255,255,255,0.5),' +
        ' 0 0 22px rgba(180,220,255,0.4);'
    );
    // The highlight — one small hot spot, up and to the left, as on every
    // photograph of a bubble ever taken.
    const spec = document.createElement('i');
    spec.style.cssText =
      'position:absolute;left:22%;top:16%;width:22%;height:16%;border-radius:50%;' +
      'background:radial-gradient(circle, rgba(255,255,255,0.95), transparent 70%);';
    el.appendChild(spec);

    const { h } = api.viewport;
    /* The opening handful start already spread up the screen, so the effect
       has something in it the instant you click rather than forty seconds
       later when the first one has finally climbed into frame. */
    const seeded = Math.random() < 0.45;
    const p = particle(
      el, x + rand(-300, 300),
      seeded ? rand(h * 0.12, h * 0.94) : h + rand(20, 160),
      size, rand(11_000, 19_000), now
    );
    p.vy = -rand(0.28, 0.62);
    p.a = rand(0, Math.PI * 2);   // wobble phase
    p.b = rand(0.0009, 0.0021);   // wobble rate
    p.c = rand(16, 46);           // wobble width
    return p;
  },
  step(p, t, now) {
    if (p.kind === 1) {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.93; p.vy *= 0.93;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 - t})`;
      p.el.style.opacity = String((1 - t) * 0.8);
      return;
    }

    p.y += p.vy;
    const sway = Math.sin(now * p.b + p.a) * p.c;
    // A real bubble is never quite a circle — the film breathes.
    const wob = 1 + Math.sin(now * p.b * 3.1 + p.a) * 0.045;
    p.el.style.transform =
      `translate3d(${p.x + sway - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${wob}, ${2 - wob})`;
    p.el.style.opacity = String(Math.min(1, t * 12) * Math.min(1, (1 - t) * 5));
  },
};

/* ------------------------------------------------------------- glass rain -- */
/**
 * Rain on a window, which is the good half of rain.
 *
 * The satisfaction is entirely in the WAIT: a bead sits, swells, sits some
 * more, and then all at once lets go and runs, leaving a wet track that dries
 * behind it. Nothing here falls at a constant rate, because nothing on a real
 * pane does.
 */
const glassrain: RelaxEffect = {
  id: 'glassrain',
  label: 'Rain on Glass',
  group: 'Water',
  blurb: 'Beads gather on the pane, hang there — and then one lets go and runs the whole way down.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 60,
  spawnEveryMs: 200,
  spawnPerTick: 4,
  maxParticles: 260,
  onStart(_x, _y, api) {
    startRain();
    /* The pane itself: a cold wash and a breath of condensation, so the beads
       are sitting ON something. Built once, in onStart, so a second click during
       a shower doesn't stack a second window. */
    if (!glassPane) {
      glassPane = document.createElement('div');
      glassPane.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease;' +
        (api.isDark
          ? 'background:radial-gradient(120% 90% at 50% 0%, rgba(120,170,220,0.16), transparent 70%),' +
            'linear-gradient(180deg, rgba(10,20,34,0.34), rgba(6,12,22,0.5));'
          : 'background:radial-gradient(120% 90% at 50% 0%, rgba(150,190,225,0.22), transparent 70%),' +
            'linear-gradient(180deg, rgba(60,90,125,0.16), rgba(40,64,95,0.26));');
      api.screen.appendChild(glassPane);
      requestAnimationFrame(() => { if (glassPane) glassPane.style.opacity = '1'; });
    }
  },
  onStop() {
    stopRain();
    const pane = glassPane;
    glassPane = null;
    if (pane) {
      pane.style.opacity = '0';
      window.setTimeout(() => pane.remove(), 1300);
    }
  },
  create(x, y, now, api) {
    const el = document.createElement('div');
    // Most beads just sit. One in six is a runner — and the runners are the
    // big ones, because on real glass it is weight that breaks the surface hold.
    const runner = Math.random() < 0.17;
    const size = runner ? rand(9, 16) : rand(3, 8);
    baseStyle(
      el, size,
      'border-radius:50% 50% 54% 54% / 46% 46% 58% 58%;' +
        'background:radial-gradient(circle at 34% 28%, rgba(255,255,255,0.85), rgba(190,225,255,0.35) 42%,' +
        ' rgba(120,170,215,0.22) 78%);' +
        'box-shadow:inset -1px -2px 3px rgba(60,110,160,0.4), inset 1px 1px 2px rgba(255,255,255,0.7),' +
        ' 0 1px 3px rgba(0,0,0,0.18);'
    );

    const { w, h } = api.viewport;
    const p = particle(el, rand(0, w), rand(0, h * 0.92), size, runner ? rand(4200, 7000) : rand(6000, 12_000), now);
    p.kind = runner ? 1 : 0;
    p.a = runner ? rand(0.12, 0.5) : 0;  // how long it hangs before it goes
    p.b = rand(0, Math.PI * 2);           // the waver of the track
    p.c = rand(0.9, 1.8);                 // how fast it runs once it goes
    return p;
  },
  step(p, t) {
    if (p.kind === 0) {
      // A sitting bead only swells, very slightly.
      const grow = 1 + Math.min(1, t * 2.2) * 0.22;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${grow})`;
      p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 4));
      return;
    }

    if (t < p.a) {
      // Still holding on. This pause is the whole effect.
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 + t * 0.5})`;
      p.el.style.opacity = String(Math.min(1, t * 8));
      return;
    }

    // Gone. Accelerating, wavering, stretched by its own speed.
    const run = (t - p.a) / (1 - p.a);
    const drop = run * run * p.c * 900;
    const waver = Math.sin(run * 9 + p.b) * 7;
    p.el.style.transform =
      `translate3d(${p.x + waver}px, ${p.y + drop}px, 0) scale(${1 - run * 0.3}, ${1 + run * 1.5})`;
    p.el.style.opacity = String(Math.min(1, (1 - run) * 2.4));
  },
};

/* ------------------------------------------------------------- dandelion -- */
/**
 * A clock, and the one thing anybody has ever done with one.
 *
 * The head is Icons8 artwork; the seeds are CSS, because a parachute is a disc
 * and a hair and it would be silly to fetch sixty images to say that. They do
 * not fly straight — each one holds a lateral drift and a slow spin, so the
 * puff spreads into a drifting field instead of a cone.
 */
const dandelion: RelaxEffect = {
  id: 'dandelion',
  label: 'Dandelion',
  group: 'Garden',
  blurb: 'Blow the clock. Sixty seeds lift off and take their time about leaving.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 1,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 340,
  onBurst(x, y, api) {
    playWhoosh();
    api.spawn(x, y, 46, 1);
  },
  create(x, y, now, api, kind = 0) {
    if (kind === 1) {
      const el = document.createElement('div');
      const size = rand(9, 16);
      /* A pappus: a soft crown of hairs with a seed under it. White is right on
         dark paper and invisible on cream, so the light theme gets a warm grey
         crown with a dark core — the seed you can actually see against paper. */
      baseStyle(
        el, size,
        api.isDark
          ? 'background:radial-gradient(circle at 50% 34%, rgba(255,255,255,0.92) 0 16%,' +
            ' rgba(255,255,255,0.30) 34%, transparent 62%);'
          : 'background:radial-gradient(circle at 50% 34%, rgba(126,118,96,0.9) 0 15%,' +
            ' rgba(150,142,118,0.42) 34%, transparent 64%);'
      );
      const hair = document.createElement('i');
      hair.style.cssText =
        'position:absolute;left:49%;top:52%;width:2%;height:44%;' +
        (api.isDark
          ? 'background:linear-gradient(180deg, rgba(255,255,255,0.5), rgba(120,110,84,0.85));'
          : 'background:linear-gradient(180deg, rgba(120,112,90,0.7), rgba(70,62,44,0.95));');
      el.appendChild(hair);

      const p = particle(el, x + rand(-14, 14), y + rand(-14, 14), size, rand(5200, 9000), now);
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
      p.vx = Math.cos(a) * rand(0.6, 2.4) + rand(0.2, 1.1);
      p.vy = Math.sin(a) * rand(0.5, 1.8);
      p.a = rand(0, Math.PI * 2);
      p.b = rand(0.0007, 0.0018);
      p.spin = rand(-0.4, 0.4);
      p.kind = 1;
      return p;
    }

    // The head, left standing where you clicked.
    const el = document.createElement('img');
    const size = rand(52, 74);
    el.src = pick(RELAX_SEEDHEAD);
    el.draggable = false;
    baseStyle(el, size, 'object-fit:contain;');
    const p = particle(el, x, y, size, 2600, now);
    return p;
  },
  step(p, t, now) {
    if (p.kind === 1) {
      // Air is not still: the drift wanders, and the seed rocks about its hair.
      p.vy += Math.sin(now * p.b + p.a) * 0.006 - 0.0016;
      p.x += p.vx + Math.sin(now * p.b * 1.7 + p.a) * 0.5;
      p.y += p.vy;
      p.rot += p.spin;
      p.el.style.transform =
        `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) rotate(${p.rot}deg)`;
      p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 3));
      return;
    }

    // The head sags as it empties.
    const e = 1 - Math.pow(1 - t, 3);
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${1 - e * 0.4}) rotate(${e * 8}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 10) * (1 - e));
  },
};

/* ------------------------------------------------------------ kaleidoscope -- */
/**
 * Symmetry, which the eye will accept for a very long time.
 *
 * Twelve shards on one ring, each a mirror of the last, all turning together
 * and breathing in and out. Because every shard shares one phase, the figure
 * stays a figure — drift the phases apart and it degrades into confetti within
 * about two seconds.
 */
const KALEIDO_HUES = [[196, 90], [280, 78], [330, 80], [42, 92], [160, 80]];

/* One ring's shared parameters. These MUST be rolled once per burst and read by
   every shard: rolling them inside create gives each shard its own radius and
   its own spin, and twelve shards that disagree are not a kaleidoscope, they
   are confetti — which is precisely what the first version looked like. */
let kaleidoRing = { r: 140, spin: 0.0005, breath: 0.0012, hue: 196, sat: 90, size: 100 };

const kaleido: RelaxEffect = {
  id: 'kaleido',
  label: 'Kaleidoscope',
  group: 'Play',
  blurb: 'Twelve mirrors of the same shard, turning together. Click again to fold another ring into it.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 12,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 240,
  onBurst() {
    const [hue, sat] = pick(KALEIDO_HUES);
    kaleidoRing = {
      r: rand(96, 190),
      spin: rand(0.00028, 0.00075) * (Math.random() < 0.5 ? -1 : 1),
      breath: rand(0.0009, 0.0016),
      hue, sat,
      size: rand(78, 128),
    };
    playChime();
  },
  create(x, y, now, api, _kind, _tint, index = 0) {
    const el = document.createElement('div');
    const size = kaleidoRing.size;
    const { hue, sat } = kaleidoRing;
    const light = api.isDark ? 62 : 46;
    baseStyle(
      el, size,
      `${api.isDark ? 'mix-blend-mode:screen;' : 'mix-blend-mode:multiply;'}` +
        'border-radius:82% 18% 82% 18% / 18% 82% 18% 82%;' +
        `background:radial-gradient(closest-side ellipse at 30% 30%, hsla(${hue},${sat}%,${light + 16}%,0.85),` +
        ` hsla(${hue + 26},${sat}%,${light}%,0.34) 62%, transparent 100%);` +
        'filter:blur(0.6px);'
    );

    /* Every shard in one ring shares a phase and a radius and differs only by
       its slot on the circle. That shared phase IS the symmetry. */
    const p = particle(el, x, y, size, 6400, now);
    p.a = (index / 12) * Math.PI * 2;   // its slot on the ring
    p.b = kaleidoRing.r;                // shared radius
    p.c = kaleidoRing.spin;             // shared spin
    p.d = kaleidoRing.breath;           // shared breath
    return p;
  },
  step(p, t, now) {
    const spin = now * p.c;
    const breath = 1 + Math.sin(now * p.d) * 0.28;
    const ang = p.a + spin;
    const r = p.b * breath * (0.3 + (1 - Math.pow(1 - Math.min(1, t * 3), 2)) * 0.7);
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2 + Math.cos(ang) * r}px, ${p.y - p.size / 2 + Math.sin(ang) * r}px, 0) ` +
      `rotate(${(ang * 180) / Math.PI + 90}deg) scale(${breath})`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.min(1, (1 - t) * 3.4) * 0.8);
  },
};

/* ---------------------------------------------------------------- stones -- */
/**
 * Balancing stones, which is a thing people do on beaches for no reason at all.
 *
 * Each click adds a stone to the nearest cairn, or starts a new one. They land
 * with a settle — over-shoot, squash, recover — and the whole stack sways very
 * slightly afterwards, more the taller it gets, so a tall cairn always looks a
 * little like it is about to go. Click a stone to knock it off.
 */
interface Cairn { x: number; y: number; n: number }
let cairns: Cairn[] = [];

const stones: RelaxEffect = {
  id: 'stones',
  label: 'Zen Stones',
  group: 'Stillness',
  blurb: 'Stack them one at a time. The taller it gets the more it sways — and a stone you click falls off.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 1,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 90,
  interactive: true,
  onStop() {
    cairns = [];
  },
  onPop(p) {
    playSnap();
    // The cairn it belonged to is one shorter now, so the next stone lands in
    // the gap rather than out in mid-air.
    const c = cairns.find((k) => Math.abs(k.x - p.a) < 1);
    if (c) c.n = Math.max(0, c.n - 1);
  },
  onBurst() {
    playBoom();
  },
  create(x, y, now, api) {
    let c = cairns.find((k) => Math.hypot(k.x - x, k.y - y) < 150);
    if (!c) { c = { x, y, n: 0 }; cairns.push(c); }

    /* Stones get smaller and flatter as the stack rises, which is both what
       actually happens and what makes a stack read as a stack rather than a
       column of identical pebbles. */
    const level = c.n;
    const w = Math.max(34, 118 - level * 11) * rand(0.92, 1.08);
    const h = w * rand(0.42, 0.62);

    const el = document.createElement('div');
    const face = api.isDark
      ? 'radial-gradient(closest-side ellipse at 36% 26%, #8c96a2, #4e5661 58%, #262b33 100%)'
      : 'radial-gradient(closest-side ellipse at 36% 26%, #b9bcc0, #7e848d 58%, #454b55 100%)';
    baseStyle(
      el, w,
      `height:${h}px;cursor:pointer;border-radius:50%;background:${face};` +
        'box-shadow:0 8px 14px -6px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,255,255,0.22),' +
        ' inset 0 -6px 10px rgba(0,0,0,0.32);'
    );

    // Stacked upward from the base, each stone sitting on the one below.
    const restY = c.y - level * (h * 0.86);
    const p = particle(el, c.x + rand(-5, 5), restY, w, 600_000, now);
    p.b = h;
    p.a = c.x;              // which cairn, for onPop
    p.c = level;            // how high — drives the sway
    p.d = rand(-7, 7);      // this stone's own lie
    c.n = level + 1;
    return p;
  },
  step(p, _t, now) {
    const age = now - p.born;
    // Settle: fall the last few px, overshoot, squash, recover.
    const s = Math.min(1, age / 520);
    const e = 1 - Math.pow(1 - s, 3);
    const drop = (1 - e) * -34;
    const squash = 1 + Math.sin(s * Math.PI) * 0.14 * (1 - s);

    // Sway, and the higher the stone the more of it — the top of a tall cairn
    // is never quite still.
    const swayAmp = Math.min(9, p.c * 1.1);
    const sway = Math.sin(now * 0.0011 + p.c * 0.7) * swayAmp * s;
    const lean = Math.sin(now * 0.0011 + p.c * 0.7) * (p.c * 0.28) * s;

    p.el.style.transform =
      `translate3d(${p.x - p.size / 2 + sway}px, ${p.y - p.b / 2 + drop}px, 0) ` +
      `rotate(${p.d * 0.25 + lean}deg) scale(${2 - squash}, ${squash})`;
    p.el.style.opacity = String(Math.min(1, age / 200));
  },
};

/* ---------------------------------------------------------------- embers -- */
/**
 * A fire that has burned down, which is the best part of a fire.
 *
 * No flames — flames are busy. This is the bed of coals afterwards: a low glow
 * across the bottom of the screen that pulses on its own slow schedule, and
 * embers that lift off it, cool from white to red as they climb, and go out.
 * An ember dies by COOLING, not by fading, which is why the colour is animated
 * through the opacity of a second layer rather than the particle's own.
 */
let emberBed: HTMLElement | null = null;

const embers: RelaxEffect = {
  id: 'embers',
  label: 'Embers',
  group: 'Firelight',
  blurb: 'The fire has burned down to coals. They breathe, they throw off sparks, and the sparks go out on the way up.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 26,
  spawnEveryMs: 130,
  spawnPerTick: 2,
  maxParticles: 220,
  onStart(_x, _y, api) {
    if (!emberBed) {
      emberBed = document.createElement('div');
      emberBed.style.cssText =
        'position:absolute;left:0;right:0;bottom:0;height:46%;pointer-events:none;opacity:0;' +
        'transition:opacity 1.6s ease;' +
        (api.isDark
          ? 'mix-blend-mode:screen;' +
            'background:radial-gradient(120% 100% at 50% 100%, rgba(255,146,42,0.5), rgba(210,60,10,0.22) 42%, transparent 76%);'
          : 'mix-blend-mode:multiply;' +
            'background:radial-gradient(120% 100% at 50% 100%, rgba(255,138,40,0.85), rgba(206,74,18,0.42) 44%, transparent 78%);') +
        'animation:relaxEmberBreath 6.5s ease-in-out infinite alternate;';
      api.screen.appendChild(emberBed);
      requestAnimationFrame(() => { if (emberBed) emberBed.style.opacity = '1'; });
    }
  },
  onStop() {
    const bed = emberBed;
    emberBed = null;
    if (bed) {
      bed.style.opacity = '0';
      window.setTimeout(() => bed.remove(), 1700);
    }
  },
  create(x, y, now, api) {
    const el = document.createElement('div');
    const size = rand(4, 10);
    /* Screen blend is how a spark reads against a dark room — and it is also
       why the whole effect vanished on cream paper, because screen has nothing
       to add to white. Light paper gets an opaque coal with a soft halo drawn
       under it instead. */
    baseStyle(
      el, size,
      api.isDark
        ? 'border-radius:50%;mix-blend-mode:screen;' +
          'background:radial-gradient(circle, #fffbe8 0 30%, #ffc064 56%, #e8500c 100%);' +
          'box-shadow:0 0 16px 5px rgba(255,160,70,0.9), 0 0 34px 10px rgba(255,110,30,0.45);'
        : 'border-radius:50%;' +
          'background:radial-gradient(circle, #fff2c8 0 22%, #ff8c1a 48%, #c2320a 100%);' +
          'box-shadow:0 0 12px 4px rgba(226,96,20,0.55), 0 0 26px 9px rgba(180,60,10,0.28);'
    );
    const { w, h } = api.viewport;
    const p = particle(el, rand(w * 0.06, w * 0.94), h + rand(0, 30), size, rand(2600, 6200), now);
    p.vy = -rand(0.5, 1.7);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0011, 0.0029);
    p.c = rand(12, 44);          // how far it wanders sideways
    return p;
  },
  step(p, t, now) {
    // Rising air slows as it cools, so an ember decelerates on the way up.
    p.y += p.vy * (1 - t * 0.55);
    const sway = Math.sin(now * p.b + p.a) * p.c * t;
    // The wink: an ember is not a steady light.
    const wink = 0.68 + Math.sin(now * 0.011 + p.a) * 0.32;
    p.el.style.transform =
      `translate3d(${p.x + sway}px, ${p.y}px, 0) scale(${1 - t * 0.5})`;
    p.el.style.opacity = String(Math.min(1, t * 9) * Math.pow(1 - t, 1.3) * wink);
  },
};

/* ------------------------------------------------------------- jellyfish -- */
/**
 * The slowest thing here, on purpose.
 *
 * A jellyfish swims by pulsing and then coasting, and the coast is longer than
 * the pulse — so the motion is a sawtooth, not a sine. Getting that asymmetry
 * right is the whole difference between a jellyfish and a floating balloon.
 * The art is drawn hanging, so these only ever scale: rotate one and it is
 * upside down and it stops being a jellyfish.
 */
const jellyfish: RelaxEffect = {
  id: 'jellyfish',
  label: 'Jellyfish',
  group: 'Water',
  blurb: 'Nothing to do here. They pulse, they coast, they go up. Watching is the whole activity.',
  space: 'world',
  flash: '',
  burstMs: 60_000,
  openingPop: 4,
  spawnEveryMs: 3400,
  spawnPerTick: 1,
  maxParticles: 18,
  onStart() {
    startAmbience('ocean');
  },
  onStop() {
    stopAmbience('ocean');
  },
  onBurst() {
    playChime();
  },
  create(x, y, now) {
    const el = document.createElement('img');
    const size = rand(46, 96);
    el.src = pick(RELAX_DRIFT);
    el.draggable = false;
    baseStyle(el, size, 'object-fit:contain;filter:saturate(0.62) blur(0.7px);');

    const p = particle(el, x + rand(-360, 360), y + rand(60, 340), size, rand(26_000, 44_000), now);
    p.a = rand(0, Math.PI * 2);    // pulse phase
    p.b = rand(0.0012, 0.0022);    // pulse rate
    p.c = rand(0.16, 0.4);         // how much of the pulse becomes lift
    p.d = rand(0.00035, 0.0009);   // lateral wander
    return p;
  },
  step(p, t, now) {
    /* The pulse: a fast squeeze and a long coast. `pow(sin, 6)` spends most of
       its cycle near zero and spikes briefly — which is exactly the shape of a
       jellyfish's bell, and nothing like a sine. */
    const raw = Math.sin(now * p.b + p.a);
    const pulse = Math.pow(Math.max(0, raw), 6);

    // Thrust arrives with the squeeze; the animal keeps gliding afterwards.
    p.y -= (0.24 + pulse * 1.9) * p.c * 2.2;
    p.x += Math.sin(now * p.d + p.a) * 0.42;

    const squeeze = 1 - pulse * 0.22;
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${2 - squeeze}, ${squeeze})`;
    p.el.style.opacity = String(Math.min(1, t * 14) * Math.min(1, (1 - t) * 6) * 0.62);
  },
};

/* --------------------------------------------------------------- candles -- */
/**
 * Lighting candles, and then putting them out.
 *
 * Both halves matter. Clicking empty canvas sets one and lights it; clicking a
 * lit candle snuffs it, and it stands there smoking. `consumeOnPop: false`
 * keeps the node alive through that change of state — this is the only effect
 * in the catalogue where a click transforms a particle instead of ending it.
 */
const LIT = 0;
const SNUFFED = 3;

const candles: RelaxEffect = {
  id: 'candles',
  label: 'Candlelight',
  group: 'Firelight',
  blurb: 'Set a candle anywhere and it takes. Click a burning one and it goes out, with the little curl of smoke you were hoping for.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 1,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 60,
  interactive: true,
  consumeOnPop: false,
  onBurst() {
    playBell(pick(PENTATONIC));
  },
  onPop(p, api) {
    if (p.kind === SNUFFED) return;
    p.kind = SNUFFED;
    p.d = performance.now();
    playWhoosh();
    const flame = p.el.querySelector('.relax-flame') as HTMLElement | null;
    if (flame) flame.style.opacity = '0';
    const halo = p.el.querySelector('.relax-halo') as HTMLElement | null;
    if (halo) halo.style.opacity = '0';
    api.spawn(p.x, p.y - p.b * 0.52, 7, 1);
  },
  create(x, y, now, api, kind = 0) {
    if (kind === 1) {
      // Smoke: it should be barely there, and it should widen as it climbs.
      const el = document.createElement('div');
      const size = rand(12, 26);
      baseStyle(
        el, size,
        'border-radius:50%;filter:blur(5px);' +
          `background:radial-gradient(circle, ${api.isDark ? 'rgba(226,230,238,0.5)' : 'rgba(90,96,110,0.42)'}, transparent 70%);`
      );
      const p = particle(el, x + rand(-4, 4), y, size, rand(1600, 3000), now);
      p.vy = -rand(0.35, 0.9);
      p.a = rand(0, Math.PI * 2);
      p.b = rand(0.0016, 0.0034);
      p.kind = 1;
      return p;
    }

    const el = document.createElement('div');
    const h = rand(52, 96);
    const w = h * rand(0.2, 0.28);
    baseStyle(el, w, `height:${h}px;cursor:pointer;overflow:visible;`);

    // The candle body, its lip, and the wick.
    const body = document.createElement('i');
    body.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;top:14%;border-radius:14% 14% 22% 22%;' +
      'background:linear-gradient(90deg, #b9ab90 0 12%, #f4ead2 34%, #fff8ea 50%, #e2d5b8 74%, #a89a80 100%);' +
      'box-shadow:inset 0 3px 0 rgba(255,255,255,0.7), 0 6px 10px -4px rgba(0,0,0,0.5);';
    el.appendChild(body);

    const halo = document.createElement('i');
    halo.className = 'relax-halo';
    halo.style.cssText =
      'position:absolute;left:-260%;right:-260%;top:-190%;bottom:-40%;border-radius:50%;pointer-events:none;' +
      'transition:opacity 0.5s ease;mix-blend-mode:screen;' +
      'background:radial-gradient(circle, rgba(255,182,88,0.42), rgba(255,150,50,0.14) 44%, transparent 72%);';
    el.appendChild(halo);

    const flame = document.createElement('i');
    flame.className = 'relax-flame';
    flame.style.cssText =
      'position:absolute;left:50%;bottom:100%;width:52%;height:34%;margin-left:-26%;pointer-events:none;' +
      'border-radius:50% 50% 44% 44% / 74% 74% 26% 26%;transition:opacity 0.28s ease;' +
      'background:radial-gradient(circle at 50% 74%, #fff6d2 0 26%, #ffc247 52%, #ff7a10 78%, transparent 96%);' +
      'box-shadow:0 0 16px 5px rgba(255,168,60,0.6);' +
      `animation:relaxFlame ${rand(0.62, 1.05).toFixed(2)}s ease-in-out infinite alternate;`;
    el.appendChild(flame);

    const p = particle(el, x, y, w, 600_000, now);
    p.b = h;
    p.kind = LIT;
    p.a = rand(0, Math.PI * 2);
    return p;
  },
  step(p, _t, now) {
    if (p.kind === 1) {
      const t = (now - p.born) / p.life;
      p.y += p.vy;
      const drift = Math.sin(now * p.b + p.a) * 14 * t;
      p.el.style.transform =
        `translate3d(${p.x + drift - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${0.5 + t * 2.2})`;
      p.el.style.opacity = String(Math.min(1, t * 5) * (1 - t) * 0.5);
      return;
    }

    const age = now - p.born;
    const rise = 1 - Math.pow(1 - Math.min(1, age / 420), 3);
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.b}px, 0) scale(${0.6 + rise * 0.4})`;
    p.el.style.opacity = String(Math.min(1, age / 260));
  },
};


/**
 * One star field, shared by every immersion that needs a sky.
 *
 * Written once as a background string rather than spawned as particles: four
 * hundred stars that never move are four hundred DOM nodes doing nothing, and
 * two layers of radial-gradient at different scales are indistinguishable from
 * them at a tenth of the cost.
 */
const RELAX_STARFIELD =
  'background:' +
  'radial-gradient(circle, rgba(255,255,255,0.95) 0 0.9px, transparent 1.2px) 0 0/97px 83px,' +
  'radial-gradient(circle, rgba(226,236,255,0.75) 0 0.7px, transparent 1px) 41px 29px/61px 71px,' +
  'radial-gradient(circle, rgba(255,255,255,0.5) 0 0.6px, transparent 0.9px) 17px 53px/43px 47px;' +
  'animation:relaxTwinkleField 9s ease-in-out infinite alternate;';

/* ============================== immersions ================================
   Twenty effects that are not bursts at all.

   Everything above this line is something you DO — you click, and the canvas
   answers. These are the opposite: you pick one, touch the canvas once, and
   then you stop touching it. The whole viewport becomes somewhere else for two
   minutes, and the only thing asked of you is to look at it.

   Three rules, on top of the three at the top of the file:

    1. The PLACE is built in `onStart`, not spawned. A sky, a sea, a wall of
       light — these are two or three DOM layers with CSS animations on them,
       which costs the main thread nothing however long you sit there. Particles
       are the garnish, never the substance.
    2. Nothing sudden. No flashes, no snaps, no bright edges. Every fade is
       measured in seconds, and every drift cycle is long enough that you cannot
       catch it repeating. Peace is mostly a matter of SLOW.
    3. Both papers, always. A screen-blended glow has nothing to add to cream,
       and a pale wash has nothing to say against black — so anything that
       carries the mood reads `api.isDark` and picks its side.
   ========================================================================= */

/**
 * One full-viewport layer, faded in.
 *
 * A place has to exist before anything can drift through it, and it has to
 * leave the way it arrived: an ambience that vanishes on a single frame undoes
 * the calm it spent a minute building.
 */
function veil(api: EffectApi, css: string, fadeMs = 1600): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    `position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity ${fadeMs}ms ease;` + css;
  api.screen.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  return el;
}

/** Every layer each immersion has hung, so it can take them all down again. */
const stages = new Map<string, HTMLElement[]>();

/** Build the place. A second click during one must not hang a second sky. */
function raise(id: string, api: EffectApi, build: (add: (css: string, fade?: number) => HTMLElement) => void) {
  if (stages.has(id)) return;
  const layers: HTMLElement[] = [];
  build((css, fade) => {
    const el = veil(api, css, fade);
    layers.push(el);
    return el;
  });
  stages.set(id, layers);
}

function lower(id: string) {
  const layers = stages.get(id);
  if (!layers) return;
  stages.delete(id);
  for (const el of layers) el.style.opacity = '0';
  window.setTimeout(() => { for (const el of layers) el.remove(); }, 1800);
}

/** Two minutes. Long enough to stop watching the clock, short enough to end. */
const SIT = 120_000;

/** Shared shape for the immersions' quiet drifting motes. */
function mote(x: number, y: number, now: number, css: string, size: number, life: number) {
  const el = document.createElement('div');
  baseStyle(el, size, css);
  return particle(el, x, y, size, life, now);
}

/* ========================== the cinematic kit =============================
   Rebuilt 2026-08-22. Every immersion below used to be two or three blurred
   gradients stacked on each other, and they all read the same way: an
   out-of-focus photograph of nothing. A gradient has no EDGE, so nothing in
   the frame was ever a thing — no horizon, no ridge, no branch, no surface.
   Blur was doing the work that composition should have been doing.

   What a shot actually needs, and what everything below this line now gets:

    1. SOMETHING WITH AN EDGE. A silhouette — a ridge, a skyline, a stand of
       grass — drawn as an inline SVG background. It costs one rasterisation
       and parallaxes with a transform like any other layer.
    2. DEPTH IN BANDS. Three or four planes, each drifting at its own rate,
       with haze BETWEEN them. Distance in a photograph is mostly contrast
       loss, not size.
    3. ONE LIGHT SOURCE, and everything in the frame agreeing about where it
       is — the glow, the rim on the silhouette, the direction of the shadow.
    4. THE FILM ITSELF: grain, a grade, and a vignette, over the top of
       everything. This is the whole difference between "a CSS gradient" and
       "a frame of something", and it is three layers.
   ========================================================================= */

/** One inline SVG, as a background layer. `preserveAspectRatio:none` so a shape
 *  authored in its own comfortable coordinates stretches to whatever cell it
 *  lands in. */
function svgLayer(vw: number, vh: number, body: string) {
  /* Write plain `#rrggbb` in the body. Pre-encoding it as `%23` gets encoded
     AGAIN here into `%2523`, which silently invalidates every fill, gradient
     and filter reference — and an invalid fill falls back to black, so the
     silhouettes still looked right and nothing else did. */
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${vw} ${vh}' preserveAspectRatio='none'>${body}</svg>`;
  return (
    `background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}");` +
    'background-size:100% 100%;background-repeat:no-repeat;'
  );
}

/**
 * A ridge line, by midpoint displacement.
 *
 * The standard way to get a skyline that looks eroded instead of drawn: split
 * every segment, kick the middle by a random amount, halve the amount, repeat.
 * `rough` is how violent the first kick is — 0.06 is distant hills, 0.3 is the
 * Alps. Returns a closed path filled down to the bottom of the box.
 */
function ridgePath(w: number, h: number, top: number, rough: number, steps = 6) {
  let pts: [number, number][] = [
    [0, top + rand(-h * 0.03, h * 0.03)],
    [w, top + rand(-h * 0.03, h * 0.03)],
  ];
  let amp = h * rough;
  for (let s = 0; s < steps; s++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(pts[i]);
      next.push([
        (pts[i][0] + pts[i + 1][0]) / 2,
        (pts[i][1] + pts[i + 1][1]) / 2 + rand(-amp, amp),
      ]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    amp *= 0.52;
  }
  return (
    `M0,${h} L` +
    pts.map(([x, y]) => `${x.toFixed(1)},${Math.max(0, Math.min(h, y)).toFixed(1)}`).join(' ') +
    ` L${w},${h} Z`
  );
}

/**
 * One range of hills, as a layer.
 *
 * The trick is that every range is anchored to the BOTTOM of the frame and
 * differs only in how tall its box is: the far ones are tall boxes with their
 * crest high up, the near ones are short boxes with their crest low down, and
 * each one drawn later covers the feet of the one behind it. Float the boxes
 * instead — bottom:20%, bottom:12% — and the near ranges hang in mid-air with
 * a straight edge along the bottom, which is exactly what the first attempt at
 * this looked like.
 */
function ridgeLayer(
  add: (css: string, fade?: number) => HTMLElement,
  heightPct: number, crest: number, rough: number, fill: string, extra = ''
) {
  const w = 1400;
  const h = 400;
  return add(
    `top:auto;bottom:0;height:${heightPct.toFixed(1)}%;` +
    svgLayer(w, h, `<path d='${ridgePath(w, h, h * crest, rough)}' fill='${fill}'/>`) + extra
  );
}

/**
 * A branch, grown rather than drawn.
 *
 * Recursive: each limb spawns one or two thinner limbs at a diverging angle,
 * shortening as it goes. Straight lines were what the old shoji had, and a
 * straight brown bar across a paper screen reads as a crack in the screen.
 */
function branchPath(
  x: number, y: number, ang: number, len: number, wide: number, depth: number,
  out: string[], buds?: { x: number; y: number; r: number }[]
) {
  if (depth <= 0 || len < 3) {
    if (buds && Math.random() < 0.8) buds.push({ x, y, r: rand(1, 2.6) });
    return;
  }
  // A limb bows; only dead wood is straight.
  const bow = rand(-0.3, 0.3);
  const mx = x + Math.cos(ang + bow) * len * 0.5;
  const my = y + Math.sin(ang + bow) * len * 0.5;
  const ex = x + Math.cos(ang) * len;
  const ey = y + Math.sin(ang) * len;
  out.push(
    `<path d='M${x.toFixed(1)},${y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}'` +
    ` stroke-width='${wide.toFixed(2)}' fill='none' stroke-linecap='round'/>`
  );
  const forks = Math.random() < 0.72 ? 2 : 1;
  for (let i = 0; i < forks; i++) {
    branchPath(
      ex, ey,
      ang + (i === 0 ? rand(-0.62, -0.12) : rand(0.12, 0.62)),
      len * rand(0.6, 0.82), wide * 0.66, depth - 1, out, buds
    );
  }
}

/**
 * Film grain: one tile of monochrome turbulence, JUMPED rather than slid.
 *
 * Grain that slides is dirt on the lens; grain that jumps a few pixels every
 * other frame is film. `overlay` against a mid-grey noise leaves the midtones
 * alone and only pushes the extremes, which is what a real emulsion does.
 */
const GRAIN_TILE =
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>" +
  "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix type='saturate' values='0'/></filter>" +
  "<rect width='220' height='220' filter='url(#g)'/></svg>";

function grain(a = 0.15) {
  return (
    'inset:-8%;pointer-events:none;' +
    `background-image:url("data:image/svg+xml,${encodeURIComponent(GRAIN_TILE)}");` +
    'background-size:220px 220px;background-repeat:repeat;' +
    `opacity:${a};mix-blend-mode:overlay;will-change:transform;` +
    'animation:relaxGrain 0.56s steps(1) infinite;'
  );
}

/** The grade: cool in the shadows, warm in the highlights, or whatever the
 *  scene wants. `soft-light` is the blend a colourist reaches for because it
 *  tints without flattening — `overlay` at this strength would crush it. */
function grade(shadow: string, highlight: string, a = 0.5) {
  return (
    `background:linear-gradient(163deg, ${highlight} 0%, transparent 46%, transparent 58%, ${shadow} 100%);` +
    `mix-blend-mode:soft-light;opacity:${a};`
  );
}

/** The vignette. Every lens has one and every frame is read through it. */
function vignette(a = 0.5, at = '50% 46%') {
  return `background:radial-gradient(122% 104% at ${at}, transparent 40%, rgba(0,0,0,${a}) 100%);`;
}

/** Atmospheric perspective: the wash of sky that gets between you and a thing
 *  that is far away. Sits ON TOP of the layer it is pushing back. */
function haze(rgb: string, a: number, from = 40) {
  return `background:linear-gradient(180deg, rgba(${rgb},0) 0%, rgba(${rgb},${a}) ${from}%, rgba(${rgb},${a * 1.25}) 100%);`;
}

/** The finish, in the order it has to go on: grade, vignette, grain. Called
 *  last by every immersion so the whole set shares one look. */
function filmPass(
  add: (css: string, fade?: number) => HTMLElement,
  shadow: string, highlight: string, vig = 0.5, gr = 0.15, gradeA = 0.5
) {
  add(grade(shadow, highlight, gradeA));
  add(vignette(vig));
  add(grain(gr));
}

/* ---------------------------------------------------------------- stargaze */


const stargaze: RelaxEffect = {
  id: 'stargaze',
  label: 'Stargazing',
  group: 'Immersion',
  blurb: 'Flat on your back in a field, the Milky Way overhead, and the treeline black all the way round.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 3,
  spawnEveryMs: 4200,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('stargaze', api, (add) => {
      /* A night sky is not one colour. It is darkest overhead and holds a
         little light all the way to the horizon, however far you are from a
         town — and the horizon is where the eye checks whether it believes you. */
      add('background:radial-gradient(128% 108% at 50% 4%, #16204a 0%, #0a1030 34%, #05081c 62%, #020410 100%),' +
        'linear-gradient(0deg, rgba(60,80,140,0.4) 0%, transparent 34%);');

      /* The galaxy: a band, its dust lane, and the bulge — three shapes, not
         one blurred stripe. It leans, because it is never level. */
      add('background:' +
        'radial-gradient(closest-side ellipse at 63% 33%, rgba(255,240,216,0.4), rgba(190,180,220,0.12) 54%, transparent 78%),' +
        'linear-gradient(104deg, transparent 28%, rgba(178,192,255,0.14) 38%, rgba(238,234,255,0.34) 48%,' +
        ' rgba(196,204,255,0.16) 58%, transparent 70%);' +
        'background-size:52% 40%, 100% 100%;background-position:63% 33%, 0 0;background-repeat:no-repeat;' +
        'filter:blur(11px);animation:relaxSkyTurn 300s linear infinite;');
      // The rift — the dark dust IN the band is what makes it read as a galaxy.
      add('background:linear-gradient(102deg, transparent 40%, rgba(4,6,18,0.62) 48%, rgba(4,6,18,0.3) 53%, transparent 60%);' +
        'filter:blur(9px);animation:relaxSkyTurn 300s linear infinite;');

      add(RELAX_STARFIELD + 'animation:relaxSkyTurn 300s linear infinite;');
      // A second field, finer and turning with it, so the sky has two depths.
      add('background:radial-gradient(circle, rgba(214,226,255,0.55) 0 0.6px, transparent 0.9px) 23px 11px/37px 41px;' +
        'opacity:0.7;animation:relaxSkyTurn 300s linear infinite;');

      /* The treeline. Black, ragged, and across the bottom of the frame: the
         one edge that tells you you are lying in a field and not staring at a
         screensaver. */
      const w = 1200, h = 300;
      const trees: string[] = [];
      for (let i = 0; i < 60; i++) {
        const x = (i / 60) * w + rand(-11, 11);
        const hh = rand(80, 200) * (i % 6 === 0 ? 1.45 : 1);
        const ww = hh * rand(0.3, 0.46);
        /* A fir is a stack of skirts, not a triangle — three tiers with the
           gaps between them is the whole silhouette, and at this size that is
           all you need. Narrow spikes read as grass. */
        const tiers: string[] = [];
        for (let k = 0; k < 3; k++) {
          const ty = h - hh * (0.12 + k * 0.3);
          const tw = ww * (1 - k * 0.26);
          tiers.push(`${x - tw / 2},${ty} ${x},${ty - hh * 0.42} ${x + tw / 2},${ty}`);
        }
        trees.push(`<polygon points='${tiers.join(' ')}' fill='#000'/>`);
      }
      add('top:auto;bottom:0;height:30%;' +
        svgLayer(w, h, `<rect y='${(h * 0.86).toFixed(0)}' width='${w}' height='${(h * 0.14).toFixed(0)}' fill='#000'/>` + trees.join('')));

      filmPass(add, '#0a1436', '#2a3a6e', 0.56, 0.17, 0.42);
    });
    startAmbience('drone');
  },
  onStop() { lower('stargaze'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const el = document.createElement('div');
    const len = rand(90, 260);
    baseStyle(
      el, len,
      'height:1.5px;border-radius:2px;' +
        'background:linear-gradient(90deg, transparent, rgba(214,230,255,0.85), #fff);' +
        'box-shadow:0 0 10px rgba(190,215,255,0.8);'
    );
    const { w, h } = api.viewport;
    const p = particle(el, rand(w * 0.1, w * 0.95), rand(0, h * 0.5), len, rand(900, 1700), now);
    p.a = rand(0.36, 0.72);
    p.c = rand(420, 900);
    return p;
  },
  step(p, t) {
    const e = 1 - Math.pow(1 - t, 1.6);
    const d = e * p.c;
    p.el.style.transform =
      `translate3d(${p.x + Math.cos(p.a) * d}px, ${p.y + Math.sin(p.a) * d}px, 0) rotate(${(p.a * 180) / Math.PI}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.pow(1 - t, 0.7));
  },
};

/* -------------------------------------------------------------------- tide */


const tide: RelaxEffect = {
  id: 'tide',
  label: 'Slow Tide',
  group: 'Immersion',
  blurb: 'A horizon, and water that comes in and goes out again for as long as you want it to.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 10,
  spawnEveryMs: 1500,
  spawnPerTick: 1,
  maxParticles: 30,
  onStart(_x, _y, api) {
    raise('tide', api, (add) => {
      const dark = api.isDark;
      // Full-bleed first: every scene has to reach all four edges, or the film
      // pass grades and grains the gap and it shows up as a band of noise.
      add(dark ? 'background:#070d18;' : 'background:#1f3549;');
      // Sky. The horizon is the brightest part of it, always.
      add(dark
        ? 'background:linear-gradient(180deg,#0a1430 0%,#16244a 26%,#2c3c62 44%,#4a4a68 51%);' +
          'bottom:49%;'
        : 'background:linear-gradient(180deg,#5f86b4 0%,#9fb6cd 26%,#d5cdbe 44%,#efd9b4 51%);' +
          'bottom:49%;');
      // The sun sitting on the line, and its glow eating the horizon.
      add(`bottom:44%;height:34%;top:auto;mix-blend-mode:screen;` +
        `background:radial-gradient(46% 100% at 56% 100%, rgba(255,${dark ? '214,170' : '232,186'},0.55), transparent 74%);` +
        'animation:relaxImmBreath 24s ease-in-out infinite alternate;');

      // A headland, far off to one side. One edge is enough to place the sea.
      const hw = 1200, hh = 160;
      add('top:auto;bottom:49%;height:9%;opacity:0.9;' +
        svgLayer(hw, hh, `<path d='M0,${hh} L0,${hh * 0.7} Q${hw * 0.1},${hh * 0.3} ${hw * 0.22},${hh * 0.52}` +
          ` Q${hw * 0.3},${hh * 0.72} ${hw * 0.38},${hh} Z' fill='${dark ? '#050a18' : '#3c4655'}'/>`));

      /* The sea. Bands of swell that get taller and further apart as they come
         toward you — that spacing IS the perspective, and it is why the old
         evenly-striped version read as a barcode. */
      add(`top:51%;background:linear-gradient(180deg, ${dark ? '#22314e' : '#5d7f9c'} 0%,` +
        ` ${dark ? '#16223a' : '#42627e'} 32%, ${dark ? '#0c1526' : '#2d4a63'} 72%, ${dark ? '#070d18' : '#1f3549'} 100%);`);
      const swell: string[] = [];
      for (let i = 0; i < 44; i++) {
        const t = i / 44;
        const yy = Math.pow(t, 1.9) * 100;
        /* Each crest is broken into a few dashes rather than one rule across
           the frame: an unbroken line at this spacing is a barcode, and the sea
           has never once drawn a straight line all the way to both edges. */
        let x = -6;
        while (x < 104) {
          const seg = rand(6, 30) * (0.4 + t);
          swell.push(`<rect x='${x.toFixed(1)}' y='${yy.toFixed(2)}' width='${seg.toFixed(1)}' height='${(0.15 + t * 0.8).toFixed(2)}'` +
            ` rx='${(0.1 + t * 0.4).toFixed(2)}' fill='#ffffff' opacity='${(0.04 + t * 0.1 + rand(-0.02, 0.03)).toFixed(3)}'/>`);
          x += seg + rand(2, 14);
        }
      }
      add('top:51%;mix-blend-mode:screen;filter:blur(1.1px);opacity:0.8;' +
        'animation:relaxCrawlA 44s linear infinite;' + svgLayer(100, 100, swell.join('')));
      // The glitter path under the sun.
      const glit: string[] = [];
      for (let i = 0; i < 260; i++) {
        const t = Math.pow(Math.random(), 0.7);
        glit.push(`<ellipse cx='${(56 + rand(-4 - t * 26, 4 + t * 26)).toFixed(1)}' cy='${(t * 100).toFixed(1)}'` +
          ` rx='${rand(0.5, 2.4).toFixed(2)}' ry='${rand(0.1, 0.4).toFixed(2)}' fill='#fff2d8'` +
          ` opacity='${(0.55 - t * 0.3).toFixed(2)}'/>`);
      }
      add('top:51%;mix-blend-mode:screen;animation:relaxKoiWind 7s linear infinite;' + svgLayer(100, 100, glit.join('')));

      /* The tide itself: the whole point. One wave sheet that runs UP the sand
         and drains back over eleven seconds, with the wet line it leaves
         lagging behind it. */
      add(`top:auto;bottom:0;height:26%;background:linear-gradient(180deg, ${dark ? '#2a2a30' : '#b9a288'} 0%,` +
        ` ${dark ? '#1c1c22' : '#a08d76'} 100%);`);
      add('top:auto;bottom:0;height:26%;background:linear-gradient(180deg, rgba(255,255,255,0.16) 0%, transparent 40%);' +
        'animation:relaxTideWet 11s ease-in-out infinite;');
      add('top:auto;bottom:0;height:30%;transform-origin:50% 100%;' +
        svgLayer(200, 60,
          "<path d='M0,60 L0,30 Q18,18 40,27 Q62,36 86,24 Q108,14 132,26 Q158,38 178,25 Q192,17 200,24 L200,60 Z'" +
          " fill='#ffffff' opacity='0.5'/>" +
          // The lace at the leading edge: foam is holes, not a solid sheet.
          "<path d='M0,30 Q18,18 40,27 Q62,36 86,24 Q108,14 132,26 Q158,38 178,25 Q192,17 200,24'" +
          " stroke='#ffffff' stroke-width='2.6' fill='none' opacity='0.95'/>") +
        'animation:relaxTideRun 11s ease-in-out infinite;');

      filmPass(add, dark ? '#0a1226' : '#20344c', dark ? '#4a5a80' : '#ffe6bc', 0.5, 0.15, 0.46);
    });
    startAmbience('ocean');
  },
  onStop() { lower('tide'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(60, 190);
    const p = mote(
      rand(-40, w + 40), rand(h * 0.56, h * 0.8), now,
      'border-radius:50%;filter:blur(12px);' +
        'background:radial-gradient(closest-side ellipse, rgba(255,255,255,0.5), transparent 72%);',
      size, rand(9000, 17_000)
    );
    p.el.style.height = `${size * 0.2}px`;
    p.b = rand(-0.24, 0.24);
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.b * 200}px, ${p.y}px, 0) scale(${0.6 + e * 0.7}, ${0.5 + e})`;
    p.el.style.opacity = String(e * 0.45);
  },
};

/* ------------------------------------------------------------------ clouds */


const clouds: RelaxEffect = {
  id: 'clouds',
  label: 'Cloudwatching',
  group: 'Immersion',
  blurb: 'Looking straight up on a summer afternoon. They come over slowly, and they never come over twice.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 4,
  spawnEveryMs: 13_000,
  spawnPerTick: 1,
  maxParticles: 9,
  onStart(_x, _y, api) {
    raise('clouds', api, (add) => {
      /* Straight up, the sky is deepest overhead and pales toward every
         horizon — the gradient runs OUTWARD, not down. That one change is most
         of the difference between lying in a field and looking at a wall. */
      add(api.isDark
        ? 'background:radial-gradient(120% 108% at 50% 46%, #1a2c52 0%, #24406c 44%, #3d5c86 78%, #56728f 100%);'
        : 'background:radial-gradient(120% 108% at 50% 46%, #2f74c4 0%, #62a3dd 46%, #a8cbe9 80%, #d3e2ee 100%);');
      // Sun, out of frame, but its light is not.
      add('background:radial-gradient(46% 40% at 22% 16%, rgba(255,246,214,0.5), transparent 72%);mix-blend-mode:screen;' +
        'animation:relaxImmBreath 26s ease-in-out infinite alternate;');
      // The high cirrus, way above the cumulus, barely moving.
      /* Cirrus: torn streaks at one angle, all of different lengths. A
         repeating-linear-gradient here was corduroy — evenly spaced identical
         lines are the one thing the sky never does. */
      const wisps: string[] = [];
      for (let i = 0; i < 26; i++) {
        const y0 = rand(0, 100);
        const x0 = rand(-10, 80);
        const l = rand(14, 52);
        wisps.push(`<path d='M${x0.toFixed(1)},${y0.toFixed(1)} q${(l / 2).toFixed(1)},${rand(-4, 4).toFixed(1)} ${l.toFixed(1)},${rand(-7, 3).toFixed(1)}'` +
          ` stroke='#ffffff' stroke-width='${rand(0.4, 1.8).toFixed(2)}' fill='none' stroke-linecap='round'` +
          ` opacity='${rand(0.1, 0.42).toFixed(2)}'/>`);
      }
      add('opacity:0.42;filter:blur(2.6px);animation:relaxCrawlB 220s linear infinite;' +
        svgLayer(100, 100, wisps.join('')));
      filmPass(add, '#20406a', '#fff2cd', 0.4, 0.13, 0.4);
    });
    startAmbience('wind');
  },
  onStop() { lower('clouds'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* A cumulus is a stack of lobes with a FLAT bottom and a cauliflower top,
       lit from one side. Five lobes with soft inner stops read as cloud; three
       leaves a stair-step silhouette, and one is a smudge. */
    const cw = rand(w * 0.3, w * 0.78);
    const el = document.createElement('div');
    /* All of the geometry keeps well inside the box: an ellipse that runs off
       its own viewBox is sliced square, and the blur is clipped by the filter
       region as well, which is why every cloud used to have a rectangle cut
       through it. The flat base and the cauliflower top are the whole read. */
    const lobes: string[] = [];
    const n = 5 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const lx = 18 + k * 64 + rand(-4, 4);
      const ly = 44 - Math.sin(k * Math.PI) * rand(9, 20);
      const r = rand(10, 15);
      lobes.push(`<ellipse cx='${lx.toFixed(1)}' cy='${ly.toFixed(1)}' rx='${r.toFixed(1)}' ry='${(r * rand(0.74, 1)).toFixed(1)}'/>`);
    }
    const body =
      /* ONE gradient for the whole cloud, in user space, running top to
         bottom. Two mistakes are baked out of this: with the default
         objectBoundingBox every lobe got its own light and dark side, so a
         small lobe on a big one showed as a grey bruise — and a separate
         "shaded underside" rectangle just read as a grey bar lying across the
         cloud. A cumulus is white on top and flat grey underneath, and that is
         one gradient over one silhouette. */
      "<defs><linearGradient id='c' gradientUnits='userSpaceOnUse' x1='0' y1='16' x2='0' y2='58'>" +
      "<stop offset='0%' stop-color='#ffffff'/><stop offset='42%' stop-color='#f4f7fb'/>" +
      "<stop offset='78%' stop-color='#cbd8e7'/><stop offset='100%' stop-color='#a3b6cc'/></linearGradient>" +
      "<filter id='s' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='1.1'/></filter></defs>" +
      `<g filter='url(#s)' fill='url(#c)'>${lobes.join('')}` +
      // The body, up behind the lobes so the arch of them is never hollow.
      "<rect x='17' y='36' width='66' height='20' rx='9'/></g>";
    baseStyle(el, cw, svgLayer(100, 70, body) + `height:${(cw * 0.7).toFixed(0)}px;`);
    const p = particle(el, -cw, rand(-h * 0.15, h * 0.85), cw, rand(58_000, 104_000), now);
    p.c = w + cw * 2;
    // Distance: the far ones are smaller, paler and higher.
    p.maxScale = rand(0.5, 1.1);
    p.b = rand(-0.04, 0.04);
    p.d = 0.42 + p.maxScale * 0.5;
    return p;
  },
  step(p, t) {
    p.el.style.transform =
      `translate3d(${p.x + t * p.c}px, ${p.y + t * p.b * 200}px, 0) scale(${p.maxScale})`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 8) * p.d);
  },
};

/* ---------------------------------------------------------------- duskwash */


const duskwash: RelaxEffect = {
  id: 'duskwash',
  label: 'Last Light',
  group: 'Immersion',
  blurb: 'The twenty minutes after the sun goes. The colour keeps changing and the birds go over.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 5,
  spawnEveryMs: 9000,
  spawnPerTick: 1,
  maxParticles: 22,
  onStart(_x, _y, api) {
    raise('duskwash', api, (add) => {
      // Day, still hanging on at the top.
      add('background:linear-gradient(180deg, #2a4a7c 0%, #6d7fa6 28%, #c99a76 58%, #e8a765 72%, #f0b96b 84%, #cf8352 100%);');
      /* Dusk arrives as a whole layer crossfading over that one, rather than
         as animated gradient stops: same picture, one composited opacity
         instead of a full repaint every frame. Two crossfades, staggered. */
      add('background:linear-gradient(180deg, #101c40 0%, #353a68 26%, #8a5a70 52%, #c4675c 70%, #d97a4e 86%, #7c3c30 100%);' +
        'animation:relaxDusk1 76s ease-in-out forwards;');
      add('background:linear-gradient(180deg, #060a20 0%, #14183c 30%, #3d2b48 52%, #6b3448 72%, #8a3f36 88%, #3a1a18 100%);' +
        'animation:relaxDusk2 76s ease-in-out forwards;');

      /* Cloud BARS. At this hour the sky is banded, and those bars catching
         the last orange from underneath are the whole reason anyone stops to
         look at a sunset. */
      const bars: string[] = [];
      for (let i = 0; i < 9; i++) {
        const yy = 30 + i * rand(7, 13);
        const x0 = rand(-20, 40);
        bars.push(`<rect x='${x0}' y='${yy.toFixed(1)}' width='${rand(60, 140).toFixed(0)}' height='${rand(1.4, 5).toFixed(1)}'` +
          ` rx='2' fill='#000' opacity='${rand(0.16, 0.44).toFixed(2)}'/>`);
      }
      add('top:34%;height:38%;filter:blur(1.4px);' + svgLayer(200, 140, bars.join('')));
      add('top:34%;height:38%;mix-blend-mode:screen;opacity:0.85;filter:blur(1.6px);' +
        svgLayer(200, 140, bars.join('').replace(/#000/g, '#ffc182')) + 'background-position:0 3px;');

      // The land: flat, black, and low, so the sky gets the whole frame.
      const w = 1200, h = 200;
      add('top:auto;bottom:0;height:15%;' +
        svgLayer(w, h, `<path d='${ridgePath(w, h, h * 0.5, 0.12)}' fill='#120b14'/>`));
      filmPass(add, '#1a1030', '#ffc27a', 0.46, 0.16, 0.5);
    });
    startAmbience('wind');
  },
  onStop() { lower('duskwash'); stopAmbience('wind'); },
  create(x, y, now, api) {
    // Birds going home: a V of three, a long way off.
    const { w, h } = api.viewport;
    const size = rand(9, 20);
    const el = document.createElement('div');
    baseStyle(el, size,
      `height:${(size * 0.4).toFixed(1)}px;` +
      svgLayer(20, 8, "<path d='M1,6 Q5,1 9.5,5.5 Q14,1 19,6' stroke='#140c12' stroke-width='1.4' fill='none'/>"));
    const p = particle(el, rand(-40, w * 0.3), rand(h * 0.16, h * 0.5), size, rand(26_000, 44_000), now);
    p.c = w + 120;
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0009, 0.0018);
    return p;
  },
  step(p, t, now) {
    // A bird a mile off does not flap so much as bob.
    const bob = Math.sin(now * p.b + p.a) * 9;
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y + bob - t * 30}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 10) * Math.min(1, (1 - t) * 10) * 0.7);
  },
};

/* --------------------------------------------------------------- deepwater */


const deepwater: RelaxEffect = {
  id: 'deepwater',
  label: 'Deep Water',
  group: 'Immersion',
  blurb: 'Ten metres down, looking up. Light moving on the ceiling, something big going by, and everything a long way away.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 40,
  spawnEveryMs: 700,
  spawnPerTick: 2,
  maxParticles: 150,
  onStart(_x, _y, api) {
    raise('deepwater', api, (add) => {
      add('background:linear-gradient(180deg,#2a93b4 0%,#12688c 16%,#0a4667 38%,#052a42 64%,#01121d 88%,#000508 100%);');

      /* The ceiling. Under water the surface is not a line, it is a lens: a
         mesh of moving light with the bright side facing you. The old version
         used repeating-radial-gradient here, which draws a bullseye — the same
         mistake the koi pond made, and it is just as obvious. */
      const g = 'radial-gradient(closest-side ellipse, #000 0 40%, rgba(0,0,0,0.5) 72%, transparent 100%)';
      koiCausticNet(add(`top:0;height:34%;-webkit-mask-image:${g};mask-image:${g};`), '', -14, 0.3, 1.1, 1,
        'relaxKoiCausA 26s ease-in-out infinite', 1.5, 0.6);
      koiCausticNet(add('top:0;height:26%;opacity:0.7;'), '', 26, 0.2, 1.9, 4,
        'relaxKoiCausB 37s ease-in-out infinite', 0.8, 1.3);
      add('top:0;height:22%;mix-blend-mode:screen;opacity:0.5;' +
        'background:linear-gradient(180deg, rgba(196,240,255,0.5), transparent 100%);');

      /* Shafts. They come from ONE place — the sun through the surface — so
         they converge, and each one is a soft-edged wedge rather than a bar. */
      const beams: string[] = [];
      for (let i = 0; i < 7; i++) {
        const top = rand(6, 88);
        const spread = rand(1.4, 5);
        beams.push(`<path d='M${top.toFixed(1)},0 L${(top + spread).toFixed(1)},0` +
          ` L${(top + spread * 4 + rand(6, 22)).toFixed(1)},100 L${(top + rand(2, 14)).toFixed(1)},100 Z'` +
          ` fill='#bfeeff' opacity='${rand(0.05, 0.15).toFixed(3)}'/>`);
      }
      add('mix-blend-mode:screen;filter:blur(7px);animation:relaxShaftSway 23s ease-in-out infinite alternate;' +
        svgLayer(100, 100, beams.join('')));

      // Something big, a long way off, that never quite comes into focus.
      add('top:34%;height:26%;opacity:0.5;filter:blur(2.4px);animation:relaxDeepPass 96s linear infinite;' +
        svgLayer(300, 120,
          "<path d='M20,66 Q70,34 150,44 Q210,52 258,64 Q214,74 150,84 Q70,92 20,66 Z' fill='#02202f'/>" +
          "<path d='M258,64 L292,42 L286,66 L292,88 Z' fill='#02202f'/>" +
          "<path d='M120,48 L140,18 L162,48 Z' fill='#02202f'/>"));

      add('background:radial-gradient(122% 100% at 50% 4%, transparent 30%, rgba(0,6,14,0.78) 100%);');
      filmPass(add, '#021624', '#4fb4d8', 0.34, 0.16, 0.44);
    });
    startAmbience('ocean');
  },
  onStop() { lower('deepwater'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const s = rand(2, 7);
    const p = mote(
      rand(0, w), h + rand(0, 60), now,
      `height:${s}px;border-radius:50%;background:rgba(214,244,255,0.55);` +
        'box-shadow:0 0 6px rgba(180,230,255,0.45);',
      s, rand(14_000, 30_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0004, 0.0012);
    p.c = rand(16, 54);
    p.vy = -rand(0.18, 0.5);
    return p;
  },
  step(p, t, now) {
    p.y += p.vy;
    const sway = Math.sin(now * p.b + p.a) * p.c;
    p.el.style.transform = `translate3d(${p.x + sway}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 4) * 0.7);
  },
};

/* ----------------------------------------------------------------- godrays */


const godrays: RelaxEffect = {
  id: 'godrays',
  label: 'Cathedral Light',
  group: 'Immersion',
  blurb: 'Three shafts through a high window, the pools they put on the floor, and every speck of dust in them.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 60,
  spawnEveryMs: 900,
  spawnPerTick: 2,
  maxParticles: 160,
  onStart(_x, _y, api) {
    raise('godrays', api, (add) => {
      add('background:linear-gradient(180deg,#14100c 0%,#1c1712 34%,#191410 66%,#0c0a08 100%);');

      /* The windows the light is coming from. They are the source, so they are
         the brightest thing in frame and everything else agrees with them. */
      const win: string[] = [];
      for (let i = 0; i < 3; i++) {
        const x = 16 + i * 30;
        win.push(`<path d='M${x},34 L${x},14 Q${x + 6},2 ${x + 12},14 L${x + 12},34 Z' fill='#ffe9c0'/>`);
        // Tracery: a lancet is never one pane.
        win.push(`<path d='M${x + 6},34 L${x + 6},6' stroke='#4a3a28' stroke-width='0.9'/>`);
        for (let k = 1; k < 4; k++) {
          win.push(`<path d='M${x},${14 + k * 5} L${x + 12},${14 + k * 5}' stroke='#4a3a28' stroke-width='0.7'/>`);
        }
      }
      add('bottom:56%;filter:blur(0.6px);' + svgLayer(100, 40, win.join('')));
      add('bottom:52%;mix-blend-mode:screen;filter:blur(14px);opacity:0.8;' +
        svgLayer(100, 40, win.join('').replace(/#4a3a28/g, '#ffe9c0')));

      /* The shafts. Volumetric light is brightest where it leaves the window
         and dies out as it crosses the room, so each wedge is a gradient along
         its own length rather than a flat wash — and they all lean the same
         way, because there is one sun. */
      const beams: string[] = [];
      for (let i = 0; i < 3; i++) {
        const x = 16 + i * 30;
        beams.push(`<path d='M${x},18 L${x + 12},18 L${x + 44},100 L${x + 20},100 Z' fill='url(#b)'/>`);
      }
      add('mix-blend-mode:screen;filter:blur(6px);animation:relaxShaftSway 28s ease-in-out infinite alternate;' +
        svgLayer(100, 100,
          "<defs><linearGradient id='b' x1='0' y1='0' x2='0' y2='1'>" +
          "<stop offset='0%' stop-color='#ffdfa8' stop-opacity='0.5'/>" +
          "<stop offset='46%' stop-color='#ffd79a' stop-opacity='0.22'/>" +
          "<stop offset='100%' stop-color='#ffcf8c' stop-opacity='0.03'/></linearGradient></defs>" +
          beams.join('')));

      /* Where they land. The pool on the floor is what tells you the shafts are
         real light and not three painted stripes. */
      add('top:auto;bottom:0;height:26%;mix-blend-mode:screen;filter:blur(9px);' +
        svgLayer(100, 100,
          "<ellipse cx='40' cy='62' rx='16' ry='7' fill='#ffdca2' opacity='0.55'/>" +
          "<ellipse cx='70' cy='70' rx='17' ry='7.5' fill='#ffdca2' opacity='0.5'/>" +
          "<ellipse cx='99' cy='78' rx='18' ry='8' fill='#ffdca2' opacity='0.42'/>") +
        'animation:relaxShaftSway 28s ease-in-out infinite alternate;');

      // Columns, and the floor they stand on.
      add('top:auto;bottom:0;height:100%;opacity:0.9;' +
        svgLayer(100, 100,
          "<rect x='0' y='0' width='7' height='100' fill='#0a0806'/>" +
          "<rect x='93' y='0' width='7' height='100' fill='#0a0806'/>" +
          "<rect x='0' y='88' width='100' height='12' fill='#100c09'/>"));
      filmPass(add, '#0b0906', '#ffd9a0', 0.6, 0.18, 0.5);
    });
    startAmbience('drone');
  },
  onStop() { lower('godrays'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(1.5, 4.5);
    /* Dust is everywhere in the room but you can only SEE it in the light, so
       every mote is born in a shaft and carries how bright that makes it. */
    const lane = (Math.random() * 3) | 0;
    const px = w * (0.2 + lane * 0.3) + rand(-w * 0.05, w * 0.05);
    const p = mote(
      px, rand(h * 0.1, h * 0.95), now,
      'border-radius:50%;background:rgba(255,236,204,0.9);box-shadow:0 0 5px rgba(255,224,170,0.8);',
      d, rand(9000, 20_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00025, 0.0009);
    p.c = rand(20, 70);
    p.vy = rand(-0.16, 0.1);
    p.d = 0.34 + Math.random() * 0.5;
    return p;
  },
  step(p, t, now) {
    p.y += p.vy;
    // Dust does not fall so much as wander; it is lighter than the air moves.
    const sway = Math.sin(now * p.b + p.a) * p.c;
    const lift = Math.cos(now * p.b * 0.7 + p.a) * 14;
    p.el.style.transform = `translate3d(${p.x + sway + t * 40}px, ${p.y + lift}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 5) * p.d);
  },
};

/* ------------------------------------------------------------------- shoji */


const shoji: RelaxEffect = {
  id: 'shoji',
  label: 'Paper Screen',
  group: 'Immersion',
  blurb: 'Morning through a paper screen, and the shadow of the tree outside moving on it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 4,
  spawnEveryMs: 11_000,
  spawnPerTick: 1,
  maxParticles: 10,
  onStart(_x, _y, api) {
    raise('shoji', api, (add) => {
      const dark = api.isDark;
      // The paper, lit from behind. Warm in the middle, cooler at the edges.
      add(dark
        ? 'background:radial-gradient(120% 100% at 50% 42%, #3a352c 0%, #2b2721 52%, #1d1a16 100%);'
        : 'background:radial-gradient(120% 100% at 50% 42%, #fdf6e4 0%, #f2e8d0 54%, #ddd0b2 100%);');
      // Paper is made of fibres and you can see them when it is backlit.
      const fib: string[] = [];
      for (let i = 0; i < 90; i++) {
        fib.push(`<path d='M${rand(0, 100).toFixed(1)},${rand(0, 100).toFixed(1)} l${rand(-9, 9).toFixed(1)},${rand(-3, 3).toFixed(1)}'` +
          ` stroke='${dark ? '#5c5446' : '#c9b894'}' stroke-width='${rand(0.1, 0.35).toFixed(2)}' opacity='${rand(0.2, 0.6).toFixed(2)}'/>`);
      }
      add('opacity:0.6;' + svgLayer(100, 100, fib.join('')));

      /* The tree outside. Grown, not drawn: a straight brown bar across a paper
         screen reads as a crack in the screen, which is exactly what the old
         one looked like. Two passes — a soft far shadow and a sharper near one,
         because a shadow on paper is sharpest where the branch is closest. */
      const limbs: string[] = [];
      const buds: { x: number; y: number; r: number }[] = [];
      branchPath(-6, 104, -1.06, 34, 3.4, 5, limbs, buds);
      branchPath(-6, 104, -0.72, 26, 2.6, 4, limbs, buds);
      const ink = dark ? '#0f0d0b' : '#6b5c45';
      const tree = `<g stroke='${ink}'>${limbs.join('')}</g>` +
        buds.map((b) => `<circle cx='${b.x.toFixed(1)}' cy='${b.y.toFixed(1)}' r='${b.r.toFixed(1)}' fill='${ink}'/>`).join('');
      add(`opacity:${dark ? 0.5 : 0.3};filter:blur(3.4px);transform-origin:0% 100%;` +
        svgLayer(100, 110, tree) + 'animation:relaxBranchSway 17s ease-in-out infinite alternate;');
      add(`opacity:${dark ? 0.72 : 0.46};filter:blur(1.1px);transform-origin:0% 100%;` +
        svgLayer(100, 110, tree) + 'background-position:-2% 1%;' +
        'animation:relaxBranchSway 17s ease-in-out infinite alternate reverse;');

      /* The kumiko: the wooden lattice the paper is stretched over. It is in
         FRONT of everything, so the branch shadow passes behind it. */
      const grid: string[] = [];
      for (let i = 1; i < 4; i++) grid.push(`<rect x='${i * 25 - 0.35}' y='0' width='0.7' height='100' fill='${dark ? '#100e0c' : '#7a6244'}'/>`);
      for (let i = 1; i < 5; i++) grid.push(`<rect x='0' y='${i * 20 - 0.35}' width='100' height='0.7' fill='${dark ? '#100e0c' : '#7a6244'}'/>`);
      grid.push(`<rect x='0' y='0' width='100' height='2.4' fill='${dark ? '#0c0a08' : '#5f4b32'}'/>`);
      grid.push(`<rect x='0' y='97.6' width='100' height='2.4' fill='${dark ? '#0c0a08' : '#5f4b32'}'/>`);
      add('opacity:0.9;' + svgLayer(100, 100, grid.join('')));

      // The tatami below, and the light spilling onto it.
      add(`top:auto;bottom:0;height:14%;background:linear-gradient(180deg, ${dark ? '#16130f' : '#c3b184'} 0%, ${dark ? '#0c0a08' : '#9d8c62'} 100%);`);
      add('top:auto;bottom:0;height:14%;background:repeating-linear-gradient(90deg, rgba(0,0,0,0.12) 0 1px, transparent 1px 9px);');
      filmPass(add, dark ? '#171410' : '#8a7a58', dark ? '#4a4438' : '#fff6e0', 0.36, 0.14, 0.4);
    });
    startAmbience('wind');
  },
  onStop() { lower('shoji'); stopAmbience('wind'); },
  create(x, y, now, api) {
    // A bird goes past outside, as a shadow, and is gone.
    const { w, h } = api.viewport;
    const size = rand(20, 46);
    const el = document.createElement('div');
    baseStyle(el, size,
      `height:${(size * 0.42).toFixed(1)}px;opacity:0;filter:blur(2.2px);` +
      svgLayer(20, 8, `<path d='M1,6 Q5,1 9.5,5.5 Q14,1 19,6' stroke='${api.isDark ? '#0d0b09' : '#6b5c45'}' stroke-width='1.8' fill='none'/>`));
    const p = particle(el, rand(-60, 0), rand(h * 0.12, h * 0.62), size, rand(3400, 6000), now);
    p.c = w + 140;
    p.a = rand(0, Math.PI * 2);
    return p;
  },
  step(p, t, now) {
    const bob = Math.sin(now * 0.004 + p.a) * 12;
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y + bob}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 8) * 0.5);
  },
};

/* ------------------------------------------------------------------- wheat */


const wheat: RelaxEffect = {
  id: 'wheat',
  label: 'Wind in the Field',
  group: 'Immersion',
  blurb: 'A whole field of it, and the wind crossing in waves you can watch arrive from the far side.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 64,
  spawnEveryMs: 5000,
  spawnPerTick: 1,
  maxParticles: 80,
  onStart(_x, _y, api) {
    raise('wheat', api, (add) => {
      const dark = api.isDark;
      add(dark ? 'background:#241d24;' : 'background:#8a7444;');
      add(dark
        ? 'background:linear-gradient(180deg,#101a35 0%,#22243f 28%,#3d3348 44%,#4a3a38 52%);bottom:46%;'
        : 'background:linear-gradient(180deg,#5d8dc0 0%,#9fb9d2 26%,#dcc9a4 44%,#f0d9a8 52%);bottom:46%;');
      // Low sun, and the haze it puts along the horizon.
      add(`bottom:44%;top:auto;height:30%;mix-blend-mode:screen;` +
        `background:radial-gradient(38% 100% at 66% 100%, rgba(255,${dark ? '196,140' : '236,176'},0.62), transparent 76%);` +
        'animation:relaxImmBreath 23s ease-in-out infinite alternate;');
      // A treeline, a field's width away.
      const tw = 1200, th = 120;
      const tl: string[] = [];
      for (let i = 0; i < 70; i++) {
        const x = (i / 70) * tw + rand(-12, 12);
        const hh = rand(28, 76);
        tl.push(`<ellipse cx='${x.toFixed(0)}' cy='${(th - hh * 0.4).toFixed(0)}' rx='${rand(14, 34).toFixed(0)}' ry='${(hh * 0.6).toFixed(0)}'/>`);
      }
      add(`top:auto;bottom:46%;height:7%;opacity:${dark ? 0.9 : 0.7};` +
        svgLayer(tw, th, `<g fill='${dark ? '#0d1420' : '#5b6a5a'}'>${tl.join('')}</g>` +
          `<rect y='${th - 10}' width='${tw}' height='10' fill='${dark ? '#0d1420' : '#5b6a5a'}'/>`));

      /* The field, in three bands. The far two are ONE svg each with a sway on
         it — six hundred stalks as six hundred particles is a waste of a main
         thread, and at that distance they move as a sheet anyway. Only the near
         band gets real stalks, because that is the band you can see move. */
      const band = (n: number, hgt: number, wide: number, fill: string, ear: string) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = (i / n) * 104 - 2 + rand(-0.6, 0.6);
          const hh = rand(hgt * 0.66, hgt);
          const lean = rand(-4, 4);
          out.push(`<path d='M${x.toFixed(2)},100 q${(lean * 0.4).toFixed(2)},${(-hh * 0.6).toFixed(1)} ${lean.toFixed(2)},${(-hh).toFixed(1)}'` +
            ` stroke='${fill}' stroke-width='${wide.toFixed(2)}' fill='none'/>`);
          // The ear. A field of bare stems is a field of wire.
          out.push(`<ellipse cx='${(x + lean).toFixed(2)}' cy='${(100 - hh).toFixed(1)}' rx='${(wide * 1.5).toFixed(2)}'` +
            ` ry='${(hh * 0.1).toFixed(2)}' fill='${ear}' transform='rotate(${(lean * 1.4).toFixed(1)} ${(x + lean).toFixed(2)} ${(100 - hh).toFixed(1)})'/>`);
        }
        return out.join('');
      };
      const far = dark ? '#3a3550' : '#c7a86a';
      const mid = dark ? '#2b2740' : '#a8874c';
      add(`top:auto;bottom:0;height:30%;opacity:0.85;transform-origin:50% 100%;` +
        svgLayer(100, 100, band(150, 60, 0.28, far, far)) + 'animation:relaxWheatFar 13s ease-in-out infinite alternate;');
      add(`top:auto;bottom:0;height:42%;opacity:0.95;transform-origin:50% 100%;` +
        svgLayer(100, 100, band(90, 74, 0.45, mid, mid)) + 'animation:relaxWheatMid 9s ease-in-out infinite alternate;');
      // Haze between the bands: distance is contrast loss before it is anything else.
      add(`top:auto;bottom:24%;height:24%;` +
        haze(dark ? '40,44,70' : '236,214,168', dark ? 0.34 : 0.44, 10));
      filmPass(add, dark ? '#171a2e' : '#5a4a2c', dark ? '#5a4a48' : '#ffe6b0', 0.46, 0.16, 0.46);
    });
    startAmbience('wind');
  },
  onStop() { lower('wheat'); stopAmbience('wind'); },
  create(x, y, now, api, _kind, _tint, index = 0) {
    const { w, h } = api.viewport;
    const dark = api.isDark;
    /* The near band. Each stalk's phase comes from its own x, which is what
       makes a gust visibly ARRIVE from one side rather than the whole field
       twitching at once. */
    const px = (index / 64) * (w + 60) - 30 + rand(-16, 16);
    const depth = Math.random();
    const hh = h * (0.26 + depth * 0.3);
    const el = document.createElement('div');
    const wide = 1.6 + depth * 2.2;
    baseStyle(el, wide, `height:${hh.toFixed(0)}px;transform-origin:bottom center;`);
    const stem = document.createElement('div');
    stem.style.cssText =
      `position:absolute;inset:0;border-radius:${wide}px;` +
      `background:linear-gradient(180deg, ${dark ? 'rgba(120,110,140,0.9)' : 'rgba(226,196,132,0.95)'},` +
      ` ${dark ? 'rgba(40,36,58,0.95)' : 'rgba(140,108,52,0.95)'});`;
    el.appendChild(stem);
    // The ear: fat, drooping, and the reason it reads as wheat and not grass.
    const ear = document.createElement('div');
    const ew = wide * 2;
    ear.style.cssText =
      `position:absolute;left:50%;top:${(-hh * 0.02).toFixed(1)}px;width:${ew.toFixed(1)}px;height:${(hh * 0.13).toFixed(1)}px;` +
      `margin-left:${(-ew / 2).toFixed(1)}px;border-radius:50% 50% 46% 46%/70% 70% 30% 30%;` +
      `background:linear-gradient(180deg, ${dark ? '#6a6288' : '#f0d79a'}, ${dark ? '#332e4c' : '#b98f45'});` +
      'transform:rotate(6deg);';
    el.appendChild(ear);
    const p = particle(el, px, h + 4, wide, SIT + 8000, now);
    p.a = px * 0.011;
    p.b = hh;
    p.c = 4 + depth * 6;
    p.maxScale = 0.55 + depth * 0.45;
    return p;
  },
  step(p, _t, now) {
    // Two gusts at different speeds, so the field never pulses in step.
    const gust = Math.sin(now * 0.0009 - p.a) * 0.62 + Math.sin(now * 0.00041 - p.a * 0.6) * 0.38;
    p.el.style.transform = `translate3d(${p.x}px, ${p.y - p.b}px, 0) rotate(${(gust * p.c).toFixed(2)}deg)`;
    p.el.style.opacity = String(p.maxScale);
  },
};

/* ---------------------------------------------------------------- lavalamp */


const lavalamp: RelaxEffect = {
  id: 'lavalamp',
  label: 'Lava Lamp',
  group: 'Immersion',
  blurb: 'One glass, one hot plate, and forty years of the same slow argument between wax and water.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 9,
  spawnEveryMs: 5200,
  spawnPerTick: 1,
  maxParticles: 15,
  onStart(_x, _y, api) {
    raise('lavalamp', api, (add) => {
      // The room behind it is nearly black; the lamp is the only light in it.
      add('background:radial-gradient(60% 70% at 50% 62%, #2a1030 0%, #150818 46%, #060309 100%);');
      // The glass: a tall vessel, lit from the base, with the wall of the tube
      // catching the light down both sides.
      add('background:radial-gradient(30% 62% at 50% 56%, rgba(255,120,180,0.24), transparent 74%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 15s ease-in-out infinite alternate;');
      /* The glass. Dark INSIDE — a lava lamp is a black column with hot wax
         in it, and if the tube glows the wax has nothing to be brighter than.
         The two vertical highlights are the tube wall catching the room. */
      add('left:31%;right:31%;top:6%;bottom:8%;border-radius:44% 44% 12% 12%/16% 16% 6% 6%;' +
        'background:linear-gradient(180deg, rgba(10,4,12,0.72) 0%, rgba(24,6,20,0.5) 60%, rgba(60,10,40,0.34) 100%);' +
        'box-shadow:inset 0 0 50px rgba(0,0,0,0.6);');
      add('left:33%;width:2.5%;top:9%;bottom:12%;right:auto;border-radius:50%;' +
        'background:linear-gradient(180deg, rgba(255,220,240,0.22), rgba(255,190,220,0.04));filter:blur(2px);');
      add('left:auto;right:33.5%;width:1.4%;top:12%;bottom:16%;border-radius:50%;' +
        'background:linear-gradient(180deg, rgba(255,220,240,0.14), rgba(255,190,220,0.02));filter:blur(2px);');
      // The hot plate at the bottom: the brightest thing, and the reason any of
      // it moves at all.
      add('left:26%;right:26%;top:auto;bottom:2%;height:12%;mix-blend-mode:screen;filter:blur(10px);' +
        'background:radial-gradient(60% 100% at 50% 100%, rgba(255,180,90,0.85), rgba(255,90,140,0.3) 46%, transparent 78%);' +
        'animation:relaxImmBreath 9s ease-in-out infinite alternate;');
      add('left:24%;right:24%;top:auto;bottom:0;height:5%;background:linear-gradient(180deg,#2a1218,#0a0508);' +
        'border-radius:4px 4px 8px 8px;');
      filmPass(add, '#12060f', '#ff9ac0', 0.5, 0.16, 0.46);
    });
    startAmbience('drone');
  },
  onStop() { lower('lavalamp'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(h * 0.06, h * 0.19);
    const el = document.createElement('div');
    baseStyle(el, d, '');
    /* A wax blob is a bag of liquid: it stretches as it climbs and squashes
       when it stops. That squash is a CSS animation on a CHILD, never on the
       node the loop is positioning — an animation on `transform` beats the
       inline transform outright, and every blob ends up stacked in the corner
       of the frame wearing nothing but its own wobble. */
    const wax = document.createElement('div');
    wax.style.cssText =
      'position:absolute;inset:0;border-radius:50%;filter:blur(0.6px);' +
      'background:radial-gradient(circle at 36% 30%, #ffe6b4 0 10%, #ff9a5a 34%, #f23f7a 68%, #a3125e 100%);' +
      `box-shadow:0 0 ${(d * 0.55).toFixed(0)}px rgba(255,90,140,0.55);` +
      `animation:relaxWaxWobble ${rand(7, 13).toFixed(1)}s ease-in-out infinite alternate;`;
    el.appendChild(wax);
    const p = particle(el, w * 0.5 + rand(-w * 0.07, w * 0.07), h * rand(0.74, 0.9), d, rand(34_000, 62_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00004, 0.00011);
    p.c = h * rand(0.34, 0.62);
    return p;
  },
  step(p, t, now) {
    /* Up on the heat, hang at the top while it cools, then back down. A sine
       does that on its own, and the wax has been doing it for forty years. */
    const climb = -Math.cos(now * p.b + p.a) * 0.5 + 0.5;
    const sway = Math.sin(now * p.b * 2.3 + p.a) * 14;
    p.el.style.transform =
      `translate3d(${p.x + sway - p.size / 2}px, ${p.y - climb * p.c - p.size / 2}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 12) * Math.min(1, (1 - t) * 12) * 0.92);
  },
};

/* ------------------------------------------------------------ blossomstorm */


const blossomstorm: RelaxEffect = {
  id: 'blossomstorm',
  label: 'Blossom Storm',
  group: 'Immersion',
  blurb: 'The week the cherry goes over, and a gust takes half of it at once.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 60,
  spawnEveryMs: 260,
  spawnPerTick: 2,
  maxParticles: 190,
  onStart(_x, _y, api) {
    raise('blossomstorm', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(180deg,#2a1830 0%,#42203c 34%,#5a2b42 62%,#3a1c2c 100%);'
        : 'background:linear-gradient(180deg,#cfe0ea 0%,#e8d6dd 38%,#f2dbdd 66%,#dcc3c6 100%);');
      add(`background:radial-gradient(40% 34% at 24% 18%, rgba(255,${dark ? '190,220' : '246,226'},0.5), transparent 74%);` +
        'mix-blend-mode:screen;animation:relaxImmBreath 27s ease-in-out infinite alternate;');

      /* The tree it is all coming off. One heavy limb across the top corner,
         loaded with blossom — the storm needs a source or it is just confetti. */
      const limbs: string[] = [];
      const buds: { x: number; y: number; r: number }[] = [];
      branchPath(-8, 6, 0.42, 30, 4.4, 5, limbs, buds);
      branchPath(-8, 6, 0.08, 24, 3.2, 5, limbs, buds);
      const bark = dark ? '#20141c' : '#5c4038';
      add('top:0;height:64%;transform-origin:0% 0%;animation:relaxBranchSway 21s ease-in-out infinite alternate;' +
        svgLayer(100, 100,
          `<g stroke='${bark}' fill='none'>${limbs.join('')}</g>` +
          buds.map((b) => `<circle cx='${b.x.toFixed(1)}' cy='${b.y.toFixed(1)}' r='${(b.r * 0.9).toFixed(2)}'` +
            ` fill='${dark ? '#e88fb4' : '#f7c9d8'}' opacity='${rand(0.55, 0.95).toFixed(2)}'/>`).join('') +
          // A blossom is a cluster of small flowers, never one big ball.
          buds.map((b) => Array.from({ length: 7 }, () =>
            `<circle cx='${(b.x + rand(-3.4, 3.4)).toFixed(1)}' cy='${(b.y + rand(-3.4, 3.4)).toFixed(1)}'` +
            ` r='${rand(0.5, 1.3).toFixed(2)}' fill='${dark ? '#ffb7d0' : '#ffe4ec'}'` +
            ` opacity='${rand(0.4, 0.95).toFixed(2)}'/>`).join('')).join('')));

      // Drifts of fallen petals along the bottom.
      const drift: string[] = [];
      for (let i = 0; i < 160; i++) {
        drift.push(`<ellipse cx='${rand(0, 100).toFixed(1)}' cy='${(100 - Math.pow(Math.random(), 2) * 18).toFixed(1)}'` +
          ` rx='${rand(0.4, 1.3).toFixed(2)}' ry='${rand(0.2, 0.6).toFixed(2)}' fill='${dark ? '#e79bbc' : '#fbdde6'}'` +
          ` opacity='${rand(0.3, 0.9).toFixed(2)}'/>`);
      }
      add('top:auto;bottom:0;height:26%;' + svgLayer(100, 100, drift.join('')));
      filmPass(add, dark ? '#2a1226' : '#7a5a66', dark ? '#6a3050' : '#fff0f4', 0.44, 0.15, 0.44);
    });
    startAmbience('wind');
  },
  onStop() { lower('blossomstorm'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(7, 17);
    const el = document.createElement('div');
    const dark = api.isDark;
    baseStyle(el, d,
      `height:${(d * 0.86).toFixed(1)}px;border-radius:56% 44% 52% 48%/70% 66% 34% 30%;` +
      `background:linear-gradient(150deg, ${dark ? '#ffd0e2' : '#ffffff'} 0%, ${dark ? '#f19cc0' : '#fcd8e4'} 52%, ${dark ? '#c76d98' : '#f3b9cd'} 100%);` +
      'box-shadow:0 1px 2px rgba(120,60,90,0.16);');
    const p = particle(el, rand(-w * 0.15, w * 0.5), rand(-h * 0.2, h * 0.5), d, rand(7000, 13_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0016, 0.0042);
    p.c = rand(0.9, 2.4);          // how fast the gust carries it
    p.d = rand(-1, 1);
    p.maxScale = rand(0.7, 1.15);
    return p;
  },
  step(p, t, now) {
    /* A petal is a wing: it is carried sideways much faster than it falls, and
       it ROCKS rather than somersaults. Full 3D tumbling turns them edge-on and
       they read as white cards flipping. */
    const gust = 1 + Math.sin(now * 0.00034) * 0.5;
    const sway = Math.sin(now * p.b + p.a) * 60;
    const px = p.x + t * 900 * p.c * gust + sway;
    const py = p.y + t * 300 * p.c + Math.cos(now * p.b * 0.8 + p.a) * 20;
    const rock = Math.sin(now * p.b * 1.7 + p.a) * 62;
    p.el.style.transform =
      `translate3d(${px}px, ${py}px, 0) rotate(${(rock * 0.4 + p.d * 30).toFixed(1)}deg) rotate3d(1,0.4,0,${rock.toFixed(1)}deg) scale(${p.maxScale})`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 5));
  },
};

/* ----------------------------------------------------------------- fogbank */


const fogbank: RelaxEffect = {
  id: 'fogbank',
  label: 'Fog',
  group: 'Immersion',
  blurb: 'Everything past arm’s length, gone. Layers of it, moving at different speeds.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 12,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 30,
  onStart(_x, _y, api) {
    raise('fogbank', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(180deg,#141821 0%,#1d222c 46%,#252a33 78%,#1a1e25 100%);'
        : 'background:linear-gradient(180deg,#b9bfc6 0%,#c9cdd2 44%,#d5d7d8 76%,#bcbfc2 100%);');
      // The sun, or a streetlamp: fog always has one thing burning in it.
      add(`background:radial-gradient(30% 26% at 62% 34%, rgba(255,${dark ? '226,180' : '250,226'},${dark ? 0.2 : 0.5}), transparent 70%);` +
        'mix-blend-mode:screen;animation:relaxImmBreath 30s ease-in-out infinite alternate;');

      /* Fog is measured in what it takes away. Three stands of trees at three
         distances, each one paler and softer than the one behind — that
         contrast loss IS the fog, far more than any amount of grey wash. */
      const stand = (n: number, hgt: number, wide: number, fill: string) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = rand(0, 100);
          const hh = rand(hgt * 0.6, hgt);
          out.push(`<rect x='${x.toFixed(1)}' y='${(100 - hh).toFixed(1)}' width='${wide.toFixed(2)}' height='${hh.toFixed(1)}' fill='${fill}'/>`);
          // A bare crown, because a bare trunk is a fencepost.
          for (let k = 0; k < 4; k++) {
            const yy = 100 - hh + rand(0, hh * 0.5);
            out.push(`<path d='M${x.toFixed(1)},${yy.toFixed(1)} l${rand(-7, 7).toFixed(1)},${rand(-9, -2).toFixed(1)}'` +
              ` stroke='${fill}' stroke-width='${(wide * 0.5).toFixed(2)}' fill='none'/>`);
          }
        }
        return out.join('');
      };
      const ink = dark ? '#0d1016' : '#6d7278';
      add(`top:auto;bottom:0;height:46%;opacity:${dark ? 0.34 : 0.3};filter:blur(2.2px);` +
        svgLayer(100, 100, stand(14, 52, 0.5, ink)) + 'animation:relaxFogA 190s linear infinite;');
      add(`top:auto;bottom:0;height:58%;opacity:${dark ? 0.55 : 0.5};filter:blur(1.2px);` +
        svgLayer(100, 100, stand(9, 74, 0.9, ink)) + 'animation:relaxFogB 130s linear infinite;');
      add(`top:auto;bottom:0;height:82%;opacity:${dark ? 0.85 : 0.78};` +
        svgLayer(100, 100, stand(4, 100, 1.7, ink)) + 'animation:relaxFogA 84s linear infinite;');

      // The banks themselves, crossing at their own speeds.
      const wash = dark ? '190,198,210' : '255,255,255';
      add(`background:radial-gradient(60% 34% at 20% 62%, rgba(${wash},0.5), transparent 72%),` +
        `radial-gradient(70% 30% at 78% 74%, rgba(${wash},0.42), transparent 74%);` +
        'animation:relaxFogB 96s linear infinite;');
      add(`background:radial-gradient(90% 40% at 50% 86%, rgba(${wash},0.6), transparent 76%);` +
        'animation:relaxFogA 62s linear infinite;');
      filmPass(add, dark ? '#0e1319' : '#8e969e', dark ? '#3a424e' : '#ffffff', 0.42, 0.18, 0.4);
    });
    startAmbience('wind');
  },
  onStop() { lower('fogbank'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(w * 0.3, w * 0.8);
    const p = mote(
      -size, rand(h * 0.2, h), now,
      'border-radius:50%;filter:blur(26px);' +
        `background:radial-gradient(closest-side ellipse, rgba(${api.isDark ? '176,186,200' : '255,255,255'},0.4), transparent 72%);`,
      size, rand(40_000, 78_000)
    );
    p.el.style.height = `${size * rand(0.2, 0.4)}px`;
    p.c = w + size * 2;
    return p;
  },
  step(p, t) {
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 6) * 0.7);
  },
};

/* ---------------------------------------------------------------- citynight */


const citynight: RelaxEffect = {
  id: 'citynight',
  label: 'City at Night',
  group: 'Immersion',
  blurb: 'A high window, the grid going on for miles, and rain on the glass in front of it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 26,
  spawnEveryMs: 1400,
  spawnPerTick: 1,
  maxParticles: 60,
  onStart(_x, _y, api) {
    raise('citynight', api, (add) => {
      add('background:linear-gradient(180deg,#0a0f1e 0%,#141a30 34%,#2a2440 58%,#3a2c3e 74%,#241c28 100%);');
      // The sodium haze a city puts on its own sky.
      add('background:radial-gradient(70% 40% at 50% 92%, rgba(255,168,90,0.34), transparent 74%);mix-blend-mode:screen;');

      /* The skyline: three ranks of towers, each further back, each paler.
         Windows are the point — a block silhouette with no windows in it is a
         mountain, and the old version had no silhouette at all. */
      const rank = (n: number, maxH: number, fill: string, lit: number, alpha: number) => {
        const out: string[] = [];
        let x = -4;
        while (x < 104) {
          const bw = rand(4, 13);
          const bh = rand(maxH * 0.35, maxH);
          out.push(`<rect x='${x.toFixed(1)}' y='${(100 - bh).toFixed(1)}' width='${(bw - 0.6).toFixed(1)}' height='${bh.toFixed(1)}' fill='${fill}'/>`);
          // Aerials, water tanks — the things that stop a skyline being a bar chart.
          if (Math.random() < 0.3) {
            out.push(`<rect x='${(x + bw * 0.4).toFixed(1)}' y='${(100 - bh - rand(2, 7)).toFixed(1)}' width='0.5' height='7' fill='${fill}'/>`);
          }
          for (let wy = 100 - bh + 1.5; wy < 99; wy += 2.6) {
            for (let wx = x + 0.8; wx < x + bw - 1.4; wx += 2.2) {
              if (Math.random() > lit) continue;
              out.push(`<rect x='${wx.toFixed(1)}' y='${wy.toFixed(1)}' width='1' height='1.3'` +
                ` fill='${pick(['#ffd9a0', '#ffe9c4', '#cfe0ff', '#ffc98a'])}' opacity='${(alpha * rand(0.4, 1)).toFixed(2)}'/>`);
            }
          }
          x += bw;
        }
        return out.join('');
      };
      add('top:auto;bottom:0;height:52%;opacity:0.5;filter:blur(1.2px);' + svgLayer(100, 100, rank(1, 60, '#141a2e', 0.3, 0.5)));
      add('top:auto;bottom:0;height:64%;opacity:0.8;filter:blur(0.5px);' + svgLayer(100, 100, rank(1, 78, '#0d1120', 0.34, 0.75)));
      add('top:auto;bottom:0;height:82%;' + svgLayer(100, 100, rank(1, 100, '#05070e', 0.26, 1)));
      // Haze between the ranks.
      add('top:auto;bottom:0;height:60%;' + haze('40,52,86', 0.28, 20));
      filmPass(add, '#080c18', '#ffb070', 0.52, 0.17, 0.46);
    });
    startAmbience('drone');
  },
  onStop() { lower('citynight'); stopAmbience('drone'); },
  create(x, y, now, api) {
    /* Bokeh: the rain on the glass you are standing behind, with the city
       thrown out of focus in it. A disc with a bright RIM, because that is what
       a defocused point of light actually looks like. */
    const { w, h } = api.viewport;
    const d = rand(18, 72);
    const c = pick(['255,196,120', '255,224,170', '190,214,255', '255,150,110', '160,255,220']);
    const p = mote(
      rand(0, w), rand(h * 0.2, h), now,
      `border-radius:50%;mix-blend-mode:screen;` +
        `background:radial-gradient(circle, rgba(${c},0.26) 0 58%, rgba(${c},0.6) 78%, rgba(${c},0.72) 92%, transparent 100%);`,
      d, rand(9000, 18_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0002, 0.0006);
    return p;
  },
  step(p, t, now) {
    const e = Math.sin(t * Math.PI);
    const dx = Math.sin(now * p.b + p.a) * 20;
    const dy = Math.cos(now * p.b * 0.7 + p.a) * 14;
    p.el.style.transform = `translate3d(${p.x + dx}px, ${p.y + dy}px, 0) scale(${0.8 + e * 0.35})`;
    p.el.style.opacity = String(e * 0.7);
  },
};

/* ---------------------------------------------------------------- meteors */


const meteors: RelaxEffect = {
  id: 'meteors',
  label: 'Meteor Shower',
  group: 'Immersion',
  blurb: 'The peak of a shower: they come in ones and threes out of one point in the sky, and some of them flare.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 3,
  spawnEveryMs: 900,
  spawnPerTick: 1,
  maxParticles: 40,
  onStart(_x, _y, api) {
    raise('meteors', api, (add) => {
      add('background:radial-gradient(120% 110% at 74% 8%, #101c40 0%, #070d24 44%, #020408 100%);');
      add(RELAX_STARFIELD);
      add('background:radial-gradient(circle, rgba(200,214,255,0.45) 0 0.5px, transparent 0.8px) 19px 7px/29px 33px;opacity:0.6;');
      // A thin band of galaxy, low and off to one side, so the sky has a grain.
      add('background:linear-gradient(118deg, transparent 30%, rgba(184,196,255,0.1) 44%, rgba(214,220,255,0.15) 50%,' +
        ' rgba(184,196,255,0.09) 57%, transparent 70%);filter:blur(13px);');
      // The horizon, and the ground light under it.
      const w = 1200, h = 260;
      add('top:auto;bottom:0;height:22%;' +
        svgLayer(w, h, `<path d='${ridgePath(w, h, h * 0.44, 0.16)}' fill='#030509'/>`));
      add('top:auto;bottom:0;height:26%;background:linear-gradient(0deg, rgba(70,90,150,0.28), transparent 70%);');
      filmPass(add, '#050a1e', '#38508c', 0.5, 0.18, 0.4);
    });
    startAmbience('drone');
  },
  onStop() { lower('meteors'); stopAmbience('drone'); },
  create(x, y, now, api, kind = 0) {
    const { w, h } = api.viewport;
    /* Every meteor in a shower comes out of one point — the radiant — and the
       further from it a streak starts the longer it looks. Random directions
       is what made the old one read as scratches on the print. */
    const rx = w * 0.74;
    const ry = h * 0.08;

    if (kind === 1) {
      // The flare: a fireball's terminal burst.
      const d = rand(26, 60);
      const el = document.createElement('div');
      baseStyle(el, d, 'border-radius:50%;mix-blend-mode:screen;' +
        'background:radial-gradient(circle, rgba(255,250,235,0.9) 0 18%, rgba(180,205,255,0.4) 44%, transparent 72%);');
      return particle(el, x, y, d, rand(500, 900), now);
    }

    const ang = Math.atan2(rand(h * 0.2, h * 1.1) - ry, rand(-w * 0.4, w * 0.5));
    const from = rand(0.12, 0.55);
    const px = rx + Math.cos(ang) * w * from;
    const py = ry + Math.sin(ang) * w * from;
    const len = rand(70, 300) * (from + 0.5);
    const el = document.createElement('div');
    baseStyle(el, len,
      'height:2px;border-radius:2px;transform-origin:100% 50%;' +
      'background:linear-gradient(90deg, transparent 0%, rgba(150,190,255,0.5) 46%, rgba(235,245,255,0.95) 88%, #fff 100%);' +
      'box-shadow:0 0 14px rgba(180,210,255,0.85);');
    const p = particle(el, px, py, len, rand(700, 1500), now);
    p.a = ang;
    p.c = rand(320, 760);
    p.b = Math.random() < 0.16 ? 1 : 0;    // does this one flare out?
    return p;
  },
  step(p, t, now, api) {
    if (p.kind !== 0) {
      const e = 1 - Math.pow(1 - t, 2);
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${0.2 + e * 1.9})`;
      p.el.style.opacity = String(Math.pow(1 - t, 1.5));
      return;
    }
    const e = 1 - Math.pow(1 - t, 1.5);
    const d = e * p.c;
    const nx = p.x + Math.cos(p.a) * d;
    const ny = p.y + Math.sin(p.a) * d;
    p.el.style.transform = `translate3d(${nx}px, ${ny}px, 0) rotate(${(p.a * 180) / Math.PI}deg)`;
    // They brighten as they burn and go out all at once, not by fading evenly.
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.pow(1 - t, 0.55));
    if (p.b && t > 0.86) {
      p.b = 0;
      api.spawn(nx, ny, 1, 1);
    }
  },
};

/* -------------------------------------------------------------------- silk */


const silk: RelaxEffect = {
  id: 'silk',
  label: 'Silk',
  group: 'Immersion',
  blurb: 'Yards of it moving in a slow draught, with the sheen running along the folds.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 5,
  spawnEveryMs: 3600,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('silk', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(152deg,#2a1636 0%,#3d1c46 34%,#241540 68%,#120a20 100%);'
        : 'background:linear-gradient(152deg,#f0c8d8 0%,#dba8c8 34%,#b9a0d8 68%,#8f8ac8 100%);');

      /* Folds. A fold is a pair of edges — a lit face and a shaded one — and
         the pair is what makes cloth read as cloth instead of as a gradient.
         Three sheets at three depths, each drifting at its own rate. */
      const sheet = (n: number, amp: number, seed: number) => {
        const out: string[] = [
          "<defs><linearGradient id='f" + seed + "' x1='0' y1='0' x2='1' y2='0'>" +
          "<stop offset='0%' stop-color='#000' stop-opacity='0.5'/>" +
          "<stop offset='26%' stop-color='#fff' stop-opacity='0'/>" +
          "<stop offset='50%' stop-color='#fff' stop-opacity='0.5'/>" +
          "<stop offset='74%' stop-color='#fff' stop-opacity='0'/>" +
          "<stop offset='100%' stop-color='#000' stop-opacity='0.5'/></linearGradient></defs>",
        ];
        for (let i = 0; i < n; i++) {
          const w2 = 116 / n;
          const x0 = (i / n) * 116 - 8;
          const ph = rand(0, Math.PI * 2);
          const per = rand(50, 120);
          // Each edge of the fold wanders down the cloth on its own sine, so
          // the fold pinches and swells the way hanging fabric does.
          const edge = (off: number) => {
            const pts: string[] = [];
            for (let y = -12; y <= 112; y += 8) {
              pts.push(`${(x0 + off + Math.sin((y / per) * Math.PI * 2 + ph) * amp).toFixed(1)},${y}`);
            }
            return pts;
          };
          const l = edge(0);
          const r = edge(w2 * rand(0.7, 1.1)).reverse();
          out.push(`<polygon points='${l.concat(r).join(' ')}' fill='url(#f${seed})' opacity='${rand(0.5, 1).toFixed(2)}'/>`);
        }
        return out.join('');
      };
      add('opacity:0.4;filter:blur(8px);' + svgLayer(100, 100, sheet(5, 7, 1)) +
        'animation:relaxSilkA 46s ease-in-out infinite alternate;');
      add('opacity:0.5;filter:blur(2.6px);' + svgLayer(100, 100, sheet(8, 5, 2)) +
        'animation:relaxSilkB 33s ease-in-out infinite alternate;');
      add('opacity:0.32;filter:blur(1.2px);' + svgLayer(100, 100, sheet(13, 3, 3)) +
        'animation:relaxSilkB 58s ease-in-out infinite alternate reverse;');

      /* The sheen: one bright band travelling across the folds. Satin is
         defined by the fact that the highlight MOVES when the cloth does. */
      add('mix-blend-mode:screen;opacity:0.4;filter:blur(26px);' +
        'background:linear-gradient(96deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 68%);' +
        'animation:relaxSilkSheen 27s ease-in-out infinite alternate;');
      filmPass(add, dark ? '#180f28' : '#7a5a86', dark ? '#5a3a70' : '#fff0f6', 0.4, 0.13, 0.44);
    });
    startAmbience('drone');
  },
  onStop() { lower('silk'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(w * 0.4, w * 0.9);
    const p = mote(
      rand(-w * 0.2, w * 0.6), rand(-h * 0.1, h * 0.9), now,
      'border-radius:50%;filter:blur(30px);mix-blend-mode:screen;' +
        'background:radial-gradient(closest-side ellipse, rgba(255,240,250,0.34), transparent 74%);',
      size, rand(16_000, 30_000)
    );
    p.el.style.height = `${size * rand(0.3, 0.6)}px`;
    p.b = rand(-0.3, 0.3);
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.b * 260}px, ${p.y - t * 60}px, 0) scale(${0.7 + e * 0.5})`;
    p.el.style.opacity = String(e * 0.5);
  },
};

/* -------------------------------------------------------------- sandgarden */


const sandgarden: RelaxEffect = {
  id: 'sandgarden',
  label: 'Sand Garden',
  group: 'Immersion',
  blurb: 'Raked gravel, five stones, and nothing else happening at all.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 5,
  spawnEveryMs: 9000,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('sandgarden', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(178deg,#2a2620 0%,#221f1a 40%,#1a1714 100%);'
        : 'background:linear-gradient(178deg,#d8cdb4 0%,#cdc0a4 40%,#bdb094 100%);');

      /* The rake. Parallel courses across the whole garden, and rings only
         AROUND each stone — which is how a karesansui is actually raked. The
         old one drew one set of rings from the middle of the frame, which is a
         dartboard, and the eye never once read it as gravel. */
      const line = dark ? '#4a4438' : '#f2ead4';
      const shade = dark ? '#100e0b' : '#9d9078';
      const stones: [number, number, number][] = [
        [26, 42, 9], [62, 34, 6], [74, 62, 11], [40, 74, 5], [16, 66, 4],
      ];
      const rake: string[] = [];
      for (let y = 2; y < 100; y += 2.4) {
        // A course bends around every stone it passes near, and rejoins after.
        const pts: string[] = [];
        for (let x = -2; x <= 102; x += 2) {
          let yy = y;
          for (const [sx, sy, sr] of stones) {
            const dx = x - sx;
            const dy = y - sy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < sr * 2.6) yy += ((sr * 2.6 - d) / (sr * 2.6)) * Math.sign(dy || 1) * sr * 1.5;
          }
          pts.push(`${x},${yy.toFixed(2)}`);
        }
        rake.push(`<polyline points='${pts.join(' ')}' fill='none' stroke='${line}' stroke-width='0.55' opacity='0.55'/>`);
        rake.push(`<polyline points='${pts.join(' ')}' fill='none' stroke='${shade}' stroke-width='0.5' opacity='0.34'` +
          ` transform='translate(0,0.75)'/>`);
      }
      add(svgLayer(100, 100, rake.join('')));

      // The stones, and the shadows that make them sit ON the gravel.
      const rock: string[] = [];
      for (const [sx, sy, sr] of stones) {
        rock.push(`<ellipse cx='${sx + sr * 0.24}' cy='${sy + sr * 0.34}' rx='${sr * 1.15}' ry='${sr * 0.5}'` +
          ` fill='${dark ? '#000' : '#6e6350'}' opacity='0.42'/>`);
        rock.push(`<path d='M${sx - sr},${sy + sr * 0.4} Q${sx - sr * 0.9},${sy - sr * 0.8} ${sx},${sy - sr}` +
          ` Q${sx + sr * 0.95},${sy - sr * 0.6} ${sx + sr},${sy + sr * 0.35}` +
          ` Q${sx},${sy + sr * 0.8} ${sx - sr},${sy + sr * 0.4} Z' fill='url(#st)'/>`);
        // Moss on the shaded side, which is the only colour in the whole frame.
        rock.push(`<ellipse cx='${sx - sr * 0.3}' cy='${sy + sr * 0.1}' rx='${sr * 0.5}' ry='${sr * 0.3}'` +
          ` fill='${dark ? '#28331f' : '#6d7f4a'}' opacity='0.5'/>`);
      }
      add(svgLayer(100, 100,
        "<defs><linearGradient id='st' x1='0' y1='0' x2='0.4' y2='1'>" +
        `<stop offset='0%' stop-color='${dark ? '#5a5449' : '#a89c88'}'/>` +
        `<stop offset='100%' stop-color='${dark ? '#1c1a16' : '#5c5445'}'/></linearGradient></defs>` +
        rock.join('')));

      // A wall along the back, and the low sun coming over it.
      add(`top:0;height:14%;background:linear-gradient(180deg, ${dark ? '#171410' : '#8d7d62'} 0%, ${dark ? '#221e18' : '#a2916f'} 74%, rgba(0,0,0,0.34) 100%);`);
      add(`background:radial-gradient(70% 50% at 76% 8%, rgba(255,${dark ? '210,150' : '244,200'},0.3), transparent 72%);mix-blend-mode:screen;`);
      filmPass(add, dark ? '#181510' : '#5c5240', dark ? '#4a4234' : '#fff6dc', 0.5, 0.19, 0.44);
    });
    startAmbience('wind');
  },
  onStop() { lower('sandgarden'); stopAmbience('wind'); },
  create(x, y, now, api) {
    // One leaf, blown in from somewhere else. Nothing else happens here.
    const { w, h } = api.viewport;
    const d = rand(8, 16);
    const el = document.createElement('div');
    baseStyle(el, d,
      `height:${(d * 0.55).toFixed(1)}px;border-radius:50% 8% 50% 8%;` +
      `background:linear-gradient(120deg, ${api.isDark ? '#6a5230' : '#b98b3e'}, ${api.isDark ? '#3a2c18' : '#7d5a24'});`);
    const p = particle(el, rand(-40, w * 0.3), rand(h * 0.2, h * 0.8), d, rand(16_000, 30_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0006, 0.0016);
    p.c = w * rand(0.5, 1.3);
    return p;
  },
  step(p, t, now) {
    const e = Math.sin(t * Math.PI);
    const tumble = Math.sin(now * p.b + p.a) * 40;
    p.el.style.transform =
      `translate3d(${p.x + t * p.c}px, ${p.y + Math.sin(now * p.b * 0.7 + p.a) * 26}px, 0) rotate(${tumble.toFixed(1)}deg)`;
    p.el.style.opacity = String(e * 0.85);
  },
};

/* ---------------------------------------------------------------- moonrise */


const moonrise: RelaxEffect = {
  id: 'moonrise',
  label: 'Moonrise',
  group: 'Immersion',
  blurb: 'A full moon coming up out of the hills, with its road laid across the water.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 8,
  spawnEveryMs: 3400,
  spawnPerTick: 1,
  maxParticles: 20,
  onStart(_x, _y, api) {
    raise('moonrise', api, (add) => {
      add('background:linear-gradient(180deg, #050a1e 0%, #0b1636 30%, #16264e 52%, #1d2f56 58%,' +
        ' #0d1730 60%, #070d1e 82%, #03060f 100%);');

      /* The moon, and the sky it lights. A full moon is not a white disc: it
         is a disc with a huge soft corona around it that washes the sky out
         for a third of the frame, and THAT is what says "moon". */
      /* The corona: a full moon washes a third of the sky out around itself,
         and that wash is what says "moon" long before the disc does. */
      add('background:radial-gradient(circle at 50% 34%, rgba(226,236,255,0.34) 0%, rgba(150,180,240,0.13) 22%, transparent 56%);' +
        'mix-blend-mode:screen;animation:relaxMoonLift 240s ease-out infinite alternate;');
      /* The disc, with its maria. A plain white circle reads as a dead pixel;
         the grey patches are the only reason it reads as the moon. */
      add('top:26%;left:44%;width:12%;height:0;padding-bottom:12%;border-radius:50%;bottom:auto;right:auto;' +
        'background:radial-gradient(circle at 38% 32%, #fffdf4 0%, #f3f0e2 52%, #ddd8c6 82%, #b9b4a4 100%),' +
        ' radial-gradient(closest-side circle at 62% 38%, rgba(120,124,140,0.34) 0 40%, transparent 100%),' +
        ' radial-gradient(closest-side circle at 40% 62%, rgba(110,116,136,0.3) 0 34%, transparent 100%),' +
        ' radial-gradient(closest-side circle at 66% 66%, rgba(126,130,146,0.24) 0 28%, transparent 100%);' +
        'background-size:100% 100%, 46% 46%, 38% 38%, 30% 30%;' +
        'background-position:0 0, 58% 34%, 34% 62%, 64% 68%;background-repeat:no-repeat;' +
        'box-shadow:0 0 46px 12px rgba(216,230,255,0.5);' +
        'animation:relaxMoonLift 240s ease-out infinite alternate;');
      add(RELAX_STARFIELD + 'opacity:0.42;');

      // The far shore, dead flat and dead black.
      const w = 1200, h = 220;
      add(`top:auto;bottom:40%;height:16%;` +
        svgLayer(w, h, `<path d='${ridgePath(w, h, h * 0.62, 0.1)}' fill='#040814'/>`));

      /* The water, and the moon's road on it. The road is not a beam — it is
         a column of separate broken highlights that gets wider as it comes
         toward you, because each wavelet is its own little mirror. */
      add('top:60%;bottom:0;background:linear-gradient(180deg, #0a1430 0%, #060d22 40%, #030713 100%);');
      const road: string[] = [];
      for (let i = 0; i < 420; i++) {
        const t = Math.pow(i / 420, 0.8);
        const yy = 2 + t * 198;
        // The column widens toward you because each wavelet nearer the shore
        // subtends more of the sky; every glint is its own little mirror.
        const spread = 5 + t * t * 130;
        const cx = 300 + rand(-spread, spread);
        road.push(`<ellipse cx='${cx.toFixed(1)}' cy='${yy.toFixed(1)}' rx='${rand(3, 10 + t * 26).toFixed(1)}'` +
          ` ry='${rand(0.5, 1.5).toFixed(1)}' fill='#e6efff' opacity='${(0.66 - t * 0.3).toFixed(2)}'/>`);
      }
      add('top:60%;bottom:0;mix-blend-mode:screen;animation:relaxKoiWind 9s linear infinite;' +
        svgLayer(600, 200, road.join('')));
      add('top:60%;bottom:0;background:repeating-linear-gradient(178deg, rgba(190,214,255,0.05) 0 1px, transparent 1px 7px);' +
        'animation:relaxKoiWind 13s linear infinite;');

      filmPass(add, '#060b22', '#4a5c92', 0.54, 0.15, 0.44);
    });
    startAmbience('ocean');
  },
  onStop() { lower('moonrise'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(40, 130);
    const p = mote(
      rand(-40, w + 40), rand(h * 0.62, h),
      now,
      'border-radius:50%;background:radial-gradient(closest-side ellipse, rgba(220,235,255,0.4), transparent 74%);',
      size, rand(8000, 15_000)
    );
    p.el.style.height = `${size * 0.16}px`;
    p.b = rand(-0.16, 0.16);
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.b * 180}px, ${p.y}px, 0) scale(${0.7 + e * 0.5}, 1)`;
    p.el.style.opacity = String(e * 0.5);
  },
};

/* --------------------------------------------------------- bioluminescence */


const bioluminescence: RelaxEffect = {
  id: 'bioluminescence',
  label: 'Sea Fire',
  group: 'Immersion',
  blurb: 'The surf lighting itself up. Blue, cold, and it happens in patches, never all at once.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 20,
  spawnEveryMs: 900,
  spawnPerTick: 2,
  maxParticles: 120,
  onStart(_x, _y, api) {
    raise('bioluminescence', api, (add) => {
      add('background:linear-gradient(180deg,#03060f 0%,#061224 34%,#04101f 52%,#050a12 74%,#0a0c10 100%);');
      add(RELAX_STARFIELD + 'bottom:52%;opacity:0.4;');
      // The sea, black, with the horizon barely there.
      add('top:48%;background:linear-gradient(180deg,#040a16 0%,#03070f 40%,#060709 100%);');
      add('top:47.6%;height:0.4%;background:linear-gradient(90deg, transparent, rgba(120,190,255,0.22), transparent);');

      /* The break line: where the wave turns over is where it lights up, and
         it lights up in PATCHES. A continuous glowing stripe is a neon sign. */
      const surf: string[] = [];
      for (let i = 0; i < 26; i++) {
        const x = rand(-6, 100);
        const wdt = rand(4, 22);
        surf.push(`<rect x='${x.toFixed(1)}' y='${rand(18, 58).toFixed(1)}' width='${wdt.toFixed(1)}' height='${rand(2, 7).toFixed(1)}'` +
          ` rx='2.5' fill='#5ce6ff' opacity='${rand(0.55, 1).toFixed(2)}'/>`);
      }
      add('top:50%;height:34%;mix-blend-mode:screen;filter:blur(3px);' + svgLayer(100, 100, surf.join('')) +
        'animation:relaxSurf 13s ease-in-out infinite;');
      // The bloom around it. Bioluminescence is mostly the glow, not the line.
      add('top:46%;height:42%;mix-blend-mode:screen;filter:blur(20px);opacity:0.9;' + svgLayer(100, 100, surf.join('')) +
        'animation:relaxSurf 13s ease-in-out infinite;');
      // Wet sand, holding the light for a second after the water goes back.
      add('top:auto;bottom:0;height:24%;background:linear-gradient(180deg, rgba(40,140,190,0.55) 0%, rgba(10,14,20,0.92) 100%);' +
        'animation:relaxSurfWet 13s ease-in-out infinite;');
      filmPass(add, '#020610', '#2a86b8', 0.52, 0.17, 0.44);
    });
    startAmbience('ocean');
  },
  onStop() { lower('bioluminescence'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(2, 8);
    const p = mote(
      rand(-20, w + 20), rand(h * 0.56, h * 0.86), now,
      'border-radius:50%;mix-blend-mode:screen;' +
        'background:radial-gradient(circle, rgba(220,250,255,0.95) 0 22%, rgba(60,200,255,0.6) 46%, transparent 74%);' +
        'box-shadow:0 0 10px rgba(60,200,255,0.6);',
      d, rand(1600, 4200)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.001, 0.004);
    return p;
  },
  step(p, t, now) {
    // Plankton flare and fade; they do not travel.
    const e = Math.sin(t * Math.PI);
    const drift = Math.sin(now * p.b + p.a) * 8;
    p.el.style.transform = `translate3d(${p.x + drift}px, ${p.y}px, 0) scale(${0.4 + e * 1.4})`;
    p.el.style.opacity = String(e * 0.95);
  },
};

/* --------------------------------------------------------------- steamroom */


const steamroom: RelaxEffect = {
  id: 'steamroom',
  label: 'Steam',
  group: 'Immersion',
  blurb: 'A stone bath in the dark, one lamp, and warm wet air rolling off the water.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 14,
  spawnEveryMs: 900,
  spawnPerTick: 1,
  maxParticles: 46,
  onStart(_x, _y, api) {
    raise('steamroom', api, (add) => {
      add('background:linear-gradient(180deg,#0d0a08 0%,#151009 34%,#1b140d 52%,#100c08 72%,#070504 100%);');
      // One lamp, low and warm, and the wall it is standing against.
      add('background:radial-gradient(26% 22% at 74% 30%, rgba(255,192,110,0.42), rgba(255,150,60,0.1) 48%, transparent 76%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 17s ease-in-out infinite alternate;');
      // Stone: courses of block, lit from that lamp.
      /* Wet stone in the dark, not brickwork in daylight. Courses of uneven
         blocks at low contrast, and the only reason you can see any of them is
         the lamp — so the whole layer is masked down to where the lamp reaches. */
      const stones: string[] = [];
      for (let r = 0; r < 8; r++) {
        let x = -rand(2, 10);
        while (x < 100) {
          const bw = rand(8, 19);
          stones.push(`<rect x='${x.toFixed(1)}' y='${(r * 8 + rand(-0.4, 0.4)).toFixed(1)}' width='${(bw - 0.8).toFixed(1)}' height='7.2' rx='1.2'` +
            ` fill='#8a6a4c' opacity='${rand(0.06, 0.2).toFixed(2)}'/>`);
          x += bw;
        }
      }
      const lampMask = 'radial-gradient(50% 46% at 74% 32%, #000 0%, rgba(0,0,0,0.35) 52%, transparent 82%)';
      add(`bottom:44%;opacity:0.9;-webkit-mask-image:${lampMask};mask-image:${lampMask};` +
        svgLayer(100, 64, stones.join('')));

      /* The water, and the lamp coming back off it. A bath at night is mostly
         the reflection — a dark surface with one long broken highlight down it. */
      add('top:56%;background:linear-gradient(180deg,#2a201a 0%,#1a1310 40%,#0e0a08 100%);');
      const refl: string[] = [];
      for (let i = 0; i < 120; i++) {
        const t = Math.random();
        refl.push(`<ellipse cx='${(74 + rand(-3 - t * 16, 3 + t * 16)).toFixed(1)}' cy='${(t * 100).toFixed(1)}'` +
          ` rx='${rand(1.5, 9).toFixed(1)}' ry='${rand(0.3, 0.9).toFixed(2)}' fill='#ffb765'` +
          ` opacity='${(0.5 - t * 0.3).toFixed(2)}'/>`);
      }
      add('top:56%;mix-blend-mode:screen;animation:relaxKoiWind 6s linear infinite;' + svgLayer(100, 100, refl.join('')));
      filmPass(add, '#140d08', '#ffbe72', 0.56, 0.17, 0.5);
    });
    startAmbience('drone');
  },
  onStop() { lower('steamroom'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(w * 0.18, w * 0.5);
    const p = mote(
      rand(-w * 0.1, w * 1.1), h * rand(0.5, 0.62), now,
      'border-radius:50%;filter:blur(20px);' +
        'background:radial-gradient(closest-side ellipse, rgba(255,232,206,0.16), rgba(255,220,186,0.05) 56%, transparent 78%);',
      size, rand(11_000, 20_000)
    );
    p.el.style.height = `${size * rand(0.5, 0.9)}px`;
    p.b = rand(-0.5, 0.5);
    p.c = rand(0.4, 1.1);
    return p;
  },
  step(p, t) {
    // Steam rises, spreads, and thins — it never just drifts sideways.
    const rise = Math.pow(t, 0.85);
    p.el.style.transform =
      `translate3d(${p.x + t * p.b * 140}px, ${p.y - rise * 340 * p.c}px, 0) scale(${0.4 + rise * 1.5})`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.pow(1 - t, 1.2) * 0.7);
  },
};

/* ------------------------------------------------------------------- prism */


const prism: RelaxEffect = {
  id: 'prism',
  label: 'Prism',
  group: 'Immersion',
  blurb: 'A cut-glass thing in a window, and the spectra it throws around the room all afternoon.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 9,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 26,
  onStart(_x, _y, api) {
    raise('prism', api, (add) => {
      const dark = api.isDark;
      // A plain wall. Everything interesting in this one is thrown onto it.
      add(dark
        ? 'background:linear-gradient(168deg,#1a1a20 0%,#141419 46%,#0e0e12 100%);'
        : 'background:linear-gradient(168deg,#efe7db 0%,#e2d9cc 46%,#cfc5b6 100%);');
      // Plaster: a wall with no texture is a swatch.
      const pl: string[] = [];
      for (let i = 0; i < 70; i++) {
        pl.push(`<ellipse cx='${rand(0, 100).toFixed(1)}' cy='${rand(0, 100).toFixed(1)}' rx='${rand(2, 12).toFixed(1)}'` +
          ` ry='${rand(2, 9).toFixed(1)}' fill='${dark ? '#ffffff' : '#000000'}' opacity='${rand(0.008, 0.03).toFixed(3)}'/>`);
      }
      add(svgLayer(100, 100, pl.join('')));

      // The window itself, throwing a hard-edged patch of daylight.
      add('mix-blend-mode:screen;opacity:0.26;filter:blur(20px);' +
        svgLayer(100, 100,
          "<path d='M6,10 L38,2 L52,58 L18,72 Z' fill='#ffeccc' opacity='0.3'/>" +
          "<path d='M22,6 L24,66' stroke='#000' stroke-width='3.4' opacity='0.55'/>" +
          "<path d='M10,34 L48,26' stroke='#000' stroke-width='3.4' opacity='0.55'/>") +
        'animation:relaxPrismCrawl 150s ease-in-out infinite alternate;');

      /* The spectra. A refracted band is ordered — red through violet, always
         in that order and always in that direction — and it is soft at both
         ends and brightest in the middle where the glass is thickest. */
      const bow = (x: number, y: number, w2: number, h2: number, rot: number, a: number) =>
        `<g transform='translate(${x},${y}) rotate(${rot})'>` +
        `<rect x='0' y='0' width='${w2}' height='${h2}' rx='${(h2 / 2).toFixed(1)}' fill='url(#sp)' opacity='${a}'/></g>`;
      const spectra =
        "<defs><linearGradient id='sp' x1='0' y1='0' x2='1' y2='0'>" +
        "<stop offset='0%' stop-color='#ff2d2d' stop-opacity='0'/>" +
        "<stop offset='16%' stop-color='#ff4a2a'/><stop offset='32%' stop-color='#ffd24a'/>" +
        "<stop offset='48%' stop-color='#5cff8a'/><stop offset='66%' stop-color='#3fd0ff'/>" +
        "<stop offset='84%' stop-color='#8a5cff'/><stop offset='100%' stop-color='#c04aff' stop-opacity='0'/>" +
        "</linearGradient></defs>" +
        bow(38, 44, 46, 7, 12, 0.85) + bow(30, 62, 34, 5, -8, 0.6) +
        bow(56, 26, 28, 4, 26, 0.5) + bow(20, 78, 40, 6, 4, 0.45);
      add('mix-blend-mode:screen;filter:blur(5px);animation:relaxPrismCrawl 150s ease-in-out infinite alternate;' +
        svgLayer(100, 100, spectra));
      add('mix-blend-mode:screen;filter:blur(22px);opacity:0.6;animation:relaxPrismCrawl 150s ease-in-out infinite alternate;' +
        svgLayer(100, 100, spectra));
      filmPass(add, dark ? '#101018' : '#6a6070', dark ? '#3a3a4a' : '#fff4e4', 0.44, 0.15, 0.4);
    });
    startAmbience('drone');
  },
  onStop() { lower('prism'); stopAmbience('drone'); },
  create(x, y, now, api) {
    // The little sharp glints the facets throw, wandering as the sun moves.
    const { w, h } = api.viewport;
    const d = rand(4, 16);
    const hue = pick(['#ff6a4a', '#ffd24a', '#6cff9a', '#4fd4ff', '#9a6cff']);
    const p = mote(
      rand(w * 0.1, w * 0.9), rand(h * 0.15, h * 0.85), now,
      `border-radius:50%;mix-blend-mode:screen;background:radial-gradient(circle, #fff 0 14%, ${hue} 40%, transparent 72%);` +
        `box-shadow:0 0 14px ${hue};`,
      d, rand(4000, 9000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0004, 0.0012);
    return p;
  },
  step(p, t, now) {
    const e = Math.sin(t * Math.PI);
    const dx = Math.sin(now * p.b + p.a) * 26;
    const dy = Math.cos(now * p.b * 0.8 + p.a) * 18;
    p.el.style.transform = `translate3d(${p.x + dx}px, ${p.y + dy}px, 0) scale(${0.5 + e})`;
    p.el.style.opacity = String(e * 0.8);
  },
};

/* ---------------------------------------------------------------- wisteria */


const wisteria: RelaxEffect = {
  id: 'wisteria',
  label: 'Wisteria',
  group: 'Immersion',
  blurb: 'Standing under a loaded pergola in May, with the light coming through it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 24,
  spawnEveryMs: 1100,
  spawnPerTick: 1,
  maxParticles: 60,
  onStart(_x, _y, api) {
    raise('wisteria', api, (add) => {
      const dark = api.isDark;
      // The light beyond the pergola, which is what you are actually looking at.
      add(dark
        ? 'background:radial-gradient(90% 70% at 50% 84%, #4a3a6a 0%, #2a2148 44%, #150f28 100%);'
        : 'background:radial-gradient(90% 70% at 50% 84%, #f6ecd6 0%, #d8d0e4 44%, #a89cc8 100%);');
      // The beams of the pergola, across the top.
      const beam = dark ? '#181026' : '#6b5340';
      add('top:0;height:24%;' + svgLayer(100, 24,
        `<rect y='0' width='100' height='4.5' fill='${beam}'/>` +
        [0, 1, 2, 3, 4, 5].map((i) => `<rect x='${i * 18 + 3}' y='0' width='3' height='14' fill='${beam}' opacity='0.9'/>`).join('')));

      /* The racemes. Each is a hanging cone of small blossoms, densest at the
         top and finishing in a point — and they hang at different lengths, or
         it reads as a fringe on a lampshade. */
      const race = (n: number, seed: number) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = (i / n) * 106 - 3 + rand(-2, 2);
          const len = rand(24, 66);
          const flo: string[] = [];
          for (let k = 0; k < 46; k++) {
            const t = k / 46;
            const yy = 4 + t * len;
            const spread = (1 - t * 0.82) * 3.4;
            flo.push(`<circle cx='${(x + rand(-spread, spread)).toFixed(1)}' cy='${yy.toFixed(1)}'` +
              ` r='${(rand(0.6, 1.5) * (1 - t * 0.4)).toFixed(2)}' fill='${pick(dark ? ['#a98fe0', '#8c6fd0', '#c9b4f0'] : ['#b9a3e8', '#9a80d8', '#d8caf6'])}'` +
              ` opacity='${rand(0.5, 1).toFixed(2)}'/>`);
          }
          out.push(`<g>${flo.join('')}</g>`);
        }
        return out.join('');
      };
      add('top:0;height:76%;transform-origin:50% 0%;opacity:0.75;filter:blur(1.6px);' +
        svgLayer(100, 76, race(26, 1)) + 'animation:relaxWisteriaA 15s ease-in-out infinite alternate;');
      add('top:0;height:88%;transform-origin:50% 0%;' +
        svgLayer(100, 88, race(18, 2)) + 'animation:relaxWisteriaB 11s ease-in-out infinite alternate;');
      // Leaves, in among them.
      const lv: string[] = [];
      for (let i = 0; i < 60; i++) {
        lv.push(`<ellipse cx='${rand(0, 100).toFixed(1)}' cy='${rand(2, 30).toFixed(1)}' rx='${rand(1.4, 3.4).toFixed(1)}'` +
          ` ry='${rand(0.7, 1.6).toFixed(1)}' fill='${dark ? '#2c4a30' : '#4d7a44'}' opacity='${rand(0.4, 0.9).toFixed(2)}'` +
          ` transform='rotate(${rand(-40, 40).toFixed(0)} ${rand(0, 100).toFixed(1)} ${rand(2, 30).toFixed(1)})'/>`);
      }
      add('top:0;height:40%;' + svgLayer(100, 40, lv.join('')) + 'animation:relaxWisteriaB 11s ease-in-out infinite alternate;');
      filmPass(add, dark ? '#1a1030' : '#6a5a80', dark ? '#5a4a80' : '#fff4e0', 0.42, 0.14, 0.44);
    });
    startAmbience('wind');
  },
  onStop() { lower('wisteria'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(4, 9);
    const p = mote(
      rand(0, w), rand(-h * 0.1, h * 0.3), now,
      `border-radius:60% 40% 50% 50%/70% 60% 40% 30%;` +
        `background:linear-gradient(150deg, ${api.isDark ? '#c9b4f0' : '#d8caf6'}, ${api.isDark ? '#8c6fd0' : '#9a80d8'});`,
      d, rand(9000, 16_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0009, 0.0022);
    p.c = rand(60, 200);
    return p;
  },
  step(p, t, now) {
    const sway = Math.sin(now * p.b + p.a) * 34;
    p.el.style.transform =
      `translate3d(${p.x + sway}px, ${p.y + t * p.c + t * t * 300}px, 0) rotate(${(sway * 2).toFixed(1)}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.9);
  },
};


/* ------------------------------------------------------------- mountains -- */
/**
 * The reason this one is first among the new immersions: it is the cleanest
 * demonstration of the only rule that matters up here. Distance is CONTRAST
 * LOSS. Five ridges, each one paler and bluer and softer than the one in front,
 * and the eye reads miles into a flat screen without being told anything else.
 */
const mountains: RelaxEffect = {
  id: 'mountains',
  label: 'Blue Ridges',
  group: 'Immersion',
  blurb: 'Range behind range, going pale with distance, and the mist still lying in the valleys.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 7,
  spawnEveryMs: 5200,
  spawnPerTick: 1,
  maxParticles: 20,
  onStart(_x, _y, api) {
    raise('mountains', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(180deg,#0d1730 0%,#1d2a4a 34%,#38405e 62%,#5a5468 84%,#6a5c62 100%);'
        : 'background:linear-gradient(180deg,#5f8ec4 0%,#9dbcd8 34%,#c9d6e0 62%,#e2dfd8 84%,#efe4d2 100%);');
      add(`background:radial-gradient(16% 13% at 74% 20%, rgba(255,${dark ? '214,176' : '250,228'},0.62), transparent 70%);` +
        'mix-blend-mode:screen;animation:relaxImmBreath 34s ease-in-out infinite alternate;');

      /* Five ranges. Each is its own midpoint-displaced ridge, gets its own
         haze on top of it, and sits a little lower in the frame than the last. */
      const rock = dark ? [88, 96, 122] : [96, 114, 140];
      for (let i = 0; i < 5; i++) {
        const k = i / 4;
        // Far ranges are pale and blue; near ones are dark and have edges.
        const shade = dark
          ? `rgb(${(rock[0] * (0.5 - k * 0.34)) | 0},${(rock[1] * (0.54 - k * 0.36)) | 0},${(rock[2] * (0.66 - k * 0.44)) | 0})`
          : `rgb(${(rock[0] * (1.5 - k * 0.9)) | 0},${(rock[1] * (1.4 - k * 0.85)) | 0},${(rock[2] * (1.3 - k * 0.75)) | 0})`;
        ridgeLayer(add, 54 - i * 9, 0.36 - k * 0.12, 0.1 + k * 0.22, shade);
        // The haze that puts it behind the one in front of it.
        if (i < 4) {
          add(`top:auto;bottom:0;height:${(54 - i * 9).toFixed(0)}%;` +
            haze(dark ? '40,56,92' : '188,208,228', 0.42 - i * 0.08, 0));
        }
      }
      // Mist, lying in the folds rather than covering them.
      /* Mist LIES IN the folds — it pools where the ground is low and shows
         nothing where a ridge stands above it. A band across the whole frame is
         a strip of gauze taped to the lens. */
      const pool: string[] = [];
      for (let i = 0; i < 9; i++) {
        pool.push(`<ellipse cx='${rand(-10, 110).toFixed(1)}' cy='${rand(30, 80).toFixed(1)}' rx='${rand(14, 44).toFixed(1)}'` +
          ` ry='${rand(3, 11).toFixed(1)}' fill='${dark ? '#9aacd0' : '#ffffff'}' opacity='${rand(0.16, 0.42).toFixed(2)}'/>`);
      }
      add('top:auto;bottom:6%;height:30%;filter:blur(11px);' + svgLayer(100, 100, pool.join('')) +
        'animation:relaxFogA 120s linear infinite;');
      filmPass(add, dark ? '#101a34' : '#4a5a78', dark ? '#4a5a86' : '#fff0d8', 0.44, 0.15, 0.46);
    });
    startAmbience('wind');
  },
  onStop() { lower('mountains'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(w * 0.2, w * 0.6);
    const p = mote(
      rand(-size, w), rand(h * 0.5, h * 0.86), now,
      'border-radius:50%;filter:blur(18px);' +
        `background:radial-gradient(closest-side ellipse, rgba(${api.isDark ? '160,180,220' : '255,255,255'},0.5), transparent 74%);`,
      size, rand(30_000, 60_000)
    );
    p.el.style.height = `${size * rand(0.1, 0.2)}px`;
    p.c = rand(-90, 90);
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y - t * 20}px, 0) scale(${0.8 + e * 0.4}, 1)`;
    p.el.style.opacity = String(e * 0.6);
  },
};

/* -------------------------------------------------------------- campfire -- */
const campfire: RelaxEffect = {
  id: 'campfire',
  label: 'Campfire',
  group: 'Immersion',
  blurb: 'One fire, three logs, and the dark pressing in at the edge of the light.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 34,
  spawnEveryMs: 150,
  spawnPerTick: 1,
  maxParticles: 120,
  onStart(_x, _y, api) {
    raise('campfire', api, (add) => {
      add('background:radial-gradient(60% 50% at 50% 76%, #2e1a0e 0%, #1a0f08 40%, #0a0705 74%, #030202 100%);');
      /* The light the fire is throwing. It pulses, and everything in the frame
         pulses WITH it — that agreement is what makes it read as one fire
         rather than an orange gradient with a flame drawn on it. */
      add('background:radial-gradient(62% 52% at 50% 72%, rgba(255,172,80,0.55), rgba(255,110,40,0.2) 44%, transparent 76%);' +
        'mix-blend-mode:screen;animation:relaxFireLight 3.1s ease-in-out infinite alternate;');
      // The ground it is standing on, lit from the middle out.
      add('top:auto;bottom:0;height:34%;background:radial-gradient(50% 100% at 50% 0%, rgba(120,70,34,0.5), transparent 76%),' +
        'linear-gradient(180deg,#1a120c 0%,#0a0705 100%);');
      // Logs. Three, crossed, in silhouette against their own fire.
      add('top:auto;bottom:20%;height:20%;' + svgLayer(100, 30,
        "<g fill='#170f09'>" +
        "<rect x='26' y='16' width='48' height='7' rx='3.5' transform='rotate(-7 50 19)'/>" +
        "<rect x='30' y='13' width='42' height='6' rx='3' transform='rotate(9 50 16)'/>" +
        "<rect x='38' y='9' width='30' height='5' rx='2.5' transform='rotate(-15 50 12)'/></g>" +
        "<g fill='#3a2415' opacity='0.7'>" +
        "<rect x='27' y='16' width='46' height='2' rx='1' transform='rotate(-7 50 19)'/></g>"));
      // The bed of coals under it all.
      add('top:auto;bottom:22%;height:5%;left:36%;right:36%;mix-blend-mode:screen;filter:blur(5px);' +
        'background:radial-gradient(closest-side ellipse, rgba(255,190,90,0.9), rgba(255,90,30,0.4) 60%, transparent 100%);' +
        'animation:relaxEmberBreath 2.4s ease-in-out infinite alternate;');
      filmPass(add, '#0a0503', '#ffb060', 0.6, 0.19, 0.5);
    });
    startAmbience('drone');
  },
  onStop() { lower('campfire'); stopAmbience('drone'); },
  create(x, y, now, api, kind = 0, _tint, index = 0) {
    const { w, h } = api.viewport;
    if (kind === 1 || index < 12) {
      // A tongue of flame: tall, narrow, and gone in half a second.
      const fw = rand(w * 0.035, w * 0.09);
      const el = document.createElement('div');
      baseStyle(el, fw,
        'mix-blend-mode:screen;' +
        'border-radius:50% 50% 42% 42%/76% 76% 24% 24%;filter:blur(3px);' +
        'background:radial-gradient(ellipse at 50% 84%, rgba(255,248,214,0.95) 0 18%, rgba(255,196,80,0.9) 42%,' +
        ' rgba(255,110,30,0.7) 72%, transparent 100%);');
      const fh = fw * rand(3, 5.4);
      el.style.height = `${fh.toFixed(0)}px`;
      const p = particle(el, w * 0.5 + rand(-w * 0.08, w * 0.08), h * 0.72, fw, rand(700, 1500), now);
      p.kind = 1;
      p.a = rand(-1, 1);
      p.b = fh;
      return p;
    }
    const d = rand(1.5, 4);
    const p = mote(
      w * 0.5 + rand(-w * 0.07, w * 0.07), h * 0.71, now,
      'border-radius:50%;mix-blend-mode:screen;background:radial-gradient(circle, #fff2c4 0 30%, #ff9a30 70%, transparent 100%);' +
        'box-shadow:0 0 6px rgba(255,150,50,0.9);',
      d, rand(1800, 4200)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.002, 0.006);
    p.c = rand(0.7, 1.8);
    return p;
  },
  step(p, t, now, api) {
    if (p.kind === 1) {
      // A flame leans and narrows as it goes up; it never just scales.
      const e = t;
      p.el.style.transform =
        `translate3d(${p.x + p.a * e * 26 - p.size / 2}px, ${p.y - p.b - e * 70}px, 0)` +
        ` scale(${(1 - e * 0.4).toFixed(2)}, ${(0.6 + e * 0.7).toFixed(2)})`;
      p.el.style.opacity = String(Math.min(1, t * 4) * Math.pow(1 - t, 0.8) * 0.9);
      if (t > 0.94 && !p.d) { p.d = 1; api.spawn(0, 0, 1, 1); }
      return;
    }
    /* An ember rises fast, slows as it cools, and wanders more the higher it
       gets — the wander widening is the whole tell that it is hot air and not a
       spark on a string. */
    const rise = Math.pow(t, 0.62);
    const wander = Math.sin(now * p.b + p.a) * (10 + rise * 60);
    p.el.style.transform =
      `translate3d(${p.x + wander}px, ${p.y - rise * 340 * p.c}px, 0) scale(${(1 - t * 0.5).toFixed(2)})`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.pow(1 - t, 1.4));
    if (t > 0.985 && Math.random() < 0.5) api.spawn(0, 0, 1, 1);
  },
};

/* ------------------------------------------------------------- snowfield -- */
const snowfield: RelaxEffect = {
  id: 'snowfield',
  label: 'Snowfield',
  group: 'Immersion',
  blurb: 'Late afternoon, nobody about, and it has been coming down since lunchtime.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 90,
  spawnEveryMs: 220,
  spawnPerTick: 2,
  maxParticles: 200,
  onStart(_x, _y, api) {
    raise('snowfield', api, (add) => {
      const dark = api.isDark;
      add(dark ? 'background:#2a3048;' : 'background:#c2c6d2;');
      add(dark
        ? 'background:linear-gradient(180deg,#141c34 0%,#28304c 34%,#3e4258 54%,#4a4a5c 62%);bottom:38%;'
        : 'background:linear-gradient(180deg,#8fa4c0 0%,#b6c0d0 34%,#d2d2d8 54%,#dcd6d4 62%);bottom:38%;');
      // Low winter sun, no warmth in it at all.
      add(`bottom:36%;top:auto;height:26%;mix-blend-mode:screen;` +
        `background:radial-gradient(30% 100% at 30% 100%, rgba(255,${dark ? '206,180' : '240,222'},0.42), transparent 74%);`);
      // A treeline, snow on it, going grey with the distance and the falling snow.
      const tw = 1200, th = 240;
      const trees: string[] = [];
      for (let i = 0; i < 54; i++) {
        const x = (i / 54) * tw + rand(-10, 10);
        const hh = rand(70, 190);
        const ww = hh * rand(0.26, 0.4);
        trees.push(`<polygon points='${x - ww / 2},${th} ${x},${th - hh} ${x + ww / 2},${th}' fill='${dark ? '#0e1420' : '#4a5560'}'/>`);
        trees.push(`<polygon points='${x - ww * 0.3},${th - hh * 0.3} ${x},${th - hh * 0.86} ${x + ww * 0.3},${th - hh * 0.3}'` +
          ` fill='${dark ? '#2c3648' : '#c6ccd4'}' opacity='0.55'/>`);
      }
      add(`top:auto;bottom:38%;height:20%;opacity:${dark ? 0.95 : 0.8};` + svgLayer(tw, th, trees.join('')));
      add('top:auto;bottom:38%;height:20%;' + haze(dark ? '60,68,92' : '210,216,224', 0.34, 0));

      /* The ground. Snow is not white — it is the sky's colour, slightly
         darker, and it holds long blue shadows wherever it is not flat. */
      add(`top:auto;bottom:0;height:40%;background:linear-gradient(180deg, ${dark ? '#3e4660' : '#d8dae2'} 0%,` +
        ` ${dark ? '#2a3048' : '#c2c6d2'} 40%, ${dark ? '#1c2036' : '#aab0c0'} 100%);`);
      const drift: string[] = [];
      for (let i = 0; i < 22; i++) {
        const cx = rand(-10, 110);
        const cy = rand(10, 100);
        drift.push(`<ellipse cx='${cx.toFixed(1)}' cy='${cy.toFixed(1)}' rx='${rand(12, 44).toFixed(1)}' ry='${rand(2, 8).toFixed(1)}'` +
          ` fill='${dark ? '#4e5674' : '#ffffff'}' opacity='${rand(0.1, 0.3).toFixed(2)}'/>`);
        drift.push(`<ellipse cx='${(cx + 3).toFixed(1)}' cy='${(cy + 3).toFixed(1)}' rx='${rand(10, 38).toFixed(1)}' ry='${rand(1.6, 6).toFixed(1)}'` +
          ` fill='${dark ? '#141a2e' : '#93a0bc'}' opacity='${rand(0.1, 0.26).toFixed(2)}'/>`);
      }
      add('top:auto;bottom:0;height:40%;' + svgLayer(100, 100, drift.join('')));
      filmPass(add, dark ? '#141a30' : '#6a7a96', dark ? '#5a6486' : '#ffffff', 0.4, 0.16, 0.4);
    });
    startAmbience('wind');
  },
  onStop() { lower('snowfield'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* Three depths, and the near ones are BLURRED — snow close to the lens is
       out of focus, and without that the whole fall sits on one plane. */
    const depth = Math.random();
    const d = 2 + depth * 9;
    const p = mote(
      rand(-30, w + 30), rand(-h * 0.2, h * 0.1), now,
      `border-radius:50%;background:rgba(255,255,255,${(0.5 + depth * 0.45).toFixed(2)});` +
        (depth > 0.66 ? 'filter:blur(2.4px);' : depth > 0.33 ? 'filter:blur(0.7px);' : ''),
      d, rand(9000, 20_000) * (1.2 - depth * 0.6)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0006, 0.0018);
    p.c = h * (0.7 + depth * 0.7);
    p.d = rand(20, 90) * (0.3 + depth);
    return p;
  },
  step(p, t, now) {
    const sway = Math.sin(now * p.b + p.a) * p.d;
    p.el.style.transform = `translate3d(${p.x + sway}px, ${p.y + t * p.c}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 6));
  },
};

/* ---------------------------------------------------------------- desert -- */
const desert: RelaxEffect = {
  id: 'desert',
  label: 'Dunes',
  group: 'Immersion',
  blurb: 'Sand to the horizon, wind combing the ridges, and the light going long and gold.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 20,
  spawnEveryMs: 500,
  spawnPerTick: 2,
  maxParticles: 90,
  onStart(_x, _y, api) {
    raise('desert', api, (add) => {
      const dark = api.isDark;
      add(dark ? 'background:#3a2418;' : 'background:#c89a62;');
      add(dark
        ? 'background:linear-gradient(180deg,#1a1630 0%,#3a2a44 28%,#6a4442 44%,#8a5a3e 52%);bottom:48%;'
        : 'background:linear-gradient(180deg,#4b86c4 0%,#9fb8cc 26%,#e0c396 44%,#f2cf94 52%);bottom:48%;');
      add(`bottom:46%;top:auto;height:26%;mix-blend-mode:screen;` +
        `background:radial-gradient(26% 100% at 72% 100%, rgba(255,${dark ? '170,110' : '236,180'},0.7), transparent 72%);` +
        'animation:relaxImmBreath 26s ease-in-out infinite alternate;');

      /* Dunes. A dune has a long windward face and a short, dark slip face, and
         getting that asymmetry right is the whole difference between sand and
         a row of hills. Four ranks, each with its own shadow side. */
      for (let i = 0; i < 5; i++) {
        const k = i / 4;
        /* Backlit: the sun is ON the horizon, so the nearer a dune is the
           DARKER it gets, which is the opposite of a hazy landscape and is most
           of why a desert at sunset looks like one. Each crest keeps a rim of
           light along the top of it. */
        const lit = dark
          ? `rgb(${(126 - k * 80) | 0},${(80 - k * 52) | 0},${(60 - k * 40) | 0})`
          : `rgb(${(248 - k * 130) | 0},${(210 - k * 122) | 0},${(156 - k * 104) | 0})`;
        const hp = 46 - i * 9;
        ridgeLayer(add, hp, 0.34 - k * 0.1, 0.05 + k * 0.05, lit);
        ridgeLayer(add, hp, 0.34 - k * 0.1, 0.05 + k * 0.05, dark ? '#ff9a5a' : '#fff0c0',
          `mix-blend-mode:screen;opacity:${(0.45 - k * 0.3).toFixed(2)};background-position:0 -0.5%;`);
      }
      // Wind combing the sand: fine ripples, following the ground rather than the frame.
      add('top:auto;bottom:0;height:34%;opacity:0.16;filter:blur(0.6px);' +
        'background:repeating-linear-gradient(171deg, rgba(255,255,255,0.14) 0 1px, transparent 1px 9px);' +
        'animation:relaxKoiWind 26s linear infinite;');
      filmPass(add, dark ? '#241426' : '#7a4a2c', dark ? '#8a5a3e' : '#ffe0a4', 0.46, 0.18, 0.5);
    });
    startAmbience('wind');
  },
  onStop() { lower('desert'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(1, 3.4);
    const p = mote(
      rand(-40, w * 0.2), rand(h * 0.5, h), now,
      `border-radius:50%;background:rgba(${api.isDark ? '210,170,130' : '255,240,206'},0.7);`,
      d, rand(2600, 6000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.004, 0.012);
    p.c = rand(300, 900);
    return p;
  },
  step(p, t, now) {
    // Blown sand runs almost flat and hops; it does not float.
    const hop = Math.abs(Math.sin(now * p.b + p.a)) * 14;
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y - hop}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 3) * 0.7);
  },
};

/* ---------------------------------------------------------------- bamboo -- */
const bamboo: RelaxEffect = {
  id: 'bamboo',
  label: 'Bamboo Grove',
  group: 'Immersion',
  blurb: 'Green light, culms going up out of frame, and the whole grove creaking gently.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 8,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 26,
  onStart(_x, _y, api) {
    raise('bamboo', api, (add) => {
      const dark = api.isDark;
      add(dark
        ? 'background:linear-gradient(180deg,#0e1a12 0%,#16281a 42%,#0c1a10 100%);'
        : 'background:linear-gradient(180deg,#cfe6c0 0%,#a8cf96 42%,#6d9e62 100%);');
      /* Everything in a grove is lit green from above, because the light has
         been through a hundred feet of leaves before it reaches you. */
      add(`background:radial-gradient(60% 50% at 44% 0%, rgba(${dark ? '120,220,140' : '236,255,196'},0.42), transparent 74%);` +
        'mix-blend-mode:screen;animation:relaxImmBreath 21s ease-in-out infinite alternate;');

      const culms = (n: number, wide: number, fill: string, node: string, seed: number) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = (i / n) * 108 - 4 + rand(-2.4, 2.4);
          const lean = rand(-2.2, 2.2);
          out.push(`<path d='M${x.toFixed(1)},104 Q${(x + lean).toFixed(1)},50 ${(x + lean * 2).toFixed(1)},-4'` +
            ` stroke='${fill}' stroke-width='${wide.toFixed(2)}' fill='none'/>`);
          // Nodes: the rings are what make it bamboo and not a green pipe.
          for (let k = 0; k < 9; k++) {
            const yy = 100 - k * rand(9, 14);
            const xx = x + lean * ((104 - yy) / 108) * 2;
            out.push(`<rect x='${(xx - wide * 0.7).toFixed(1)}' y='${yy.toFixed(1)}' width='${(wide * 1.4).toFixed(1)}' height='${(wide * 0.28).toFixed(2)}'` +
              ` fill='${node}' opacity='0.8'/>`);
          }
          // A branch or two, high up.
          if (seed && Math.random() < 0.6) {
            out.push(`<path d='M${(x + lean * 1.6).toFixed(1)},${rand(10, 40).toFixed(1)} l${rand(-14, 14).toFixed(1)},${rand(-8, 4).toFixed(1)}'` +
              ` stroke='${fill}' stroke-width='${(wide * 0.3).toFixed(2)}' fill='none'/>`);
          }
        }
        return out.join('');
      };
      add(`opacity:${dark ? 0.5 : 0.42};filter:blur(2.6px);transform-origin:50% 100%;` +
        svgLayer(100, 100, culms(22, 0.8, dark ? '#2c4a30' : '#8fb87e', dark ? '#1c3220' : '#7aa46a', 0)) +
        'animation:relaxGroveA 19s ease-in-out infinite alternate;');
      add(`opacity:${dark ? 0.8 : 0.72};filter:blur(0.8px);transform-origin:50% 100%;` +
        svgLayer(100, 100, culms(13, 1.5, dark ? '#3e6a3c' : '#6f9e5c', dark ? '#26421f' : '#587e46', 1)) +
        'animation:relaxGroveB 14s ease-in-out infinite alternate;');
      add(`transform-origin:50% 100%;` +
        svgLayer(100, 100, culms(7, 2.8, dark ? '#54804a' : '#4f7a3c', dark ? '#2c4a26' : '#3d6030', 1)) +
        'animation:relaxGroveA 11s ease-in-out infinite alternate;');
      // Shafts coming down between them.
      add('mix-blend-mode:screen;filter:blur(8px);opacity:0.5;' +
        'background:linear-gradient(184deg, rgba(220,255,190,0.34) 0 3%, transparent 26%) 22% 0/12% 100% no-repeat,' +
        'linear-gradient(176deg, rgba(220,255,190,0.28) 0 3%, transparent 30%) 62% 0/9% 100% no-repeat;' +
        'animation:relaxShaftSway 25s ease-in-out infinite alternate;');
      filmPass(add, dark ? '#0a1a10' : '#2c4a26', dark ? '#3e6a3c' : '#f0ffcc', 0.46, 0.16, 0.44);
    });
    startAmbience('wind');
  },
  onStop() { lower('bamboo'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(10, 22);
    const dark = api.isDark;
    const p = mote(
      rand(0, w), rand(-h * 0.2, h * 0.2), now,
      `height:${(d * 0.3).toFixed(1)}px;border-radius:50% 6% 50% 6%;` +
        `background:linear-gradient(120deg, ${dark ? '#6a9a5a' : '#8fbe72'}, ${dark ? '#2c4a26' : '#4f7a3c'});`,
      d, rand(12_000, 22_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0009, 0.0024);
    p.c = h * rand(0.7, 1.2);
    return p;
  },
  step(p, t, now) {
    // A bamboo leaf falls flat and slides sideways, like a paper dart.
    const sway = Math.sin(now * p.b + p.a) * 70;
    p.el.style.transform =
      `translate3d(${p.x + sway}px, ${p.y + t * p.c}px, 0) rotate(${(Math.sin(now * p.b * 1.4 + p.a) * 40).toFixed(1)}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.9);
  },
};

/* ----------------------------------------------------------- rainwindow -- */
const rainwindow: RelaxEffect = {
  id: 'rainwindow',
  label: 'Rain on Glass',
  group: 'Immersion',
  blurb: 'Inside, warm, with the world outside gone soft behind the water on the pane.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 70,
  spawnEveryMs: 220,
  spawnPerTick: 2,
  maxParticles: 190,
  onStart(_x, _y, api) {
    raise('rainwindow', api, (add) => {
      const dark = api.isDark;
      /* Everything beyond the glass is out of focus, so it can be built out of
         soft shapes with no edges at all — which is the one time in this whole
         file that a blurred gradient is the correct answer. */
      add(dark
        ? 'background:linear-gradient(180deg,#0e1424 0%,#161e33 46%,#1d2438 74%,#141a28 100%);'
        : 'background:linear-gradient(180deg,#8fa2b8 0%,#a9b6c4 46%,#b8bfc6 74%,#9aa3ad 100%);');
      const blobs: string[] = [];
      for (let i = 0; i < 22; i++) {
        const c = pick(dark ? ['#ffb45a', '#ff8a4a', '#7aa8ff', '#ffd88a'] : ['#e8d0a8', '#cfd8e4', '#b8c8d8', '#f0e0c0']);
        blobs.push(`<ellipse cx='${rand(0, 100).toFixed(1)}' cy='${rand(30, 100).toFixed(1)}'` +
          ` rx='${rand(2, 9).toFixed(1)}' ry='${rand(2, 8).toFixed(1)}' fill='${c}' opacity='${rand(0.2, 0.7).toFixed(2)}'/>`);
      }
      add(`filter:blur(${dark ? 14 : 10}px);opacity:${dark ? 0.9 : 0.6};` + svgLayer(100, 100, blobs.join('')));
      // The window frame, in the near dark.
      add('background:linear-gradient(90deg, rgba(0,0,0,0.55) 0 3%, transparent 8%, transparent 92%, rgba(0,0,0,0.55) 97%),' +
        'linear-gradient(180deg, rgba(0,0,0,0.5) 0 3%, transparent 9%, transparent 88%, rgba(0,0,0,0.62) 96%);');
      // The sheet of water the whole pane is under.
      add('background:linear-gradient(180deg, rgba(190,214,255,0.06) 0%, rgba(190,214,255,0.12) 100%);');
      filmPass(add, dark ? '#0c1220' : '#5a6470', dark ? '#3a4a6a' : '#e8eef4', 0.5, 0.16, 0.42);
    });
    startRain();
  },
  onStop() { lower('rainwindow'); stopRain(); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* A drop on glass is a LENS: bright at the top where it catches the sky and
       dark at the bottom where it is looking at the ground, with a hard rim.
       Get that inversion the wrong way round and it reads as a bubble. */
    const d = rand(3, 15);
    const el = document.createElement('div');
    baseStyle(el, d,
      `height:${(d * rand(1, 1.35)).toFixed(1)}px;border-radius:50% 50% 52% 52%/44% 44% 56% 56%;` +
      'background:radial-gradient(ellipse at 38% 26%, rgba(255,255,255,0.62) 0 12%, rgba(220,235,255,0.24) 34%,' +
      ' rgba(10,16,28,0.3) 72%, rgba(255,255,255,0.34) 100%);' +
      'box-shadow:inset 0 -1px 2px rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.3);');
    const p = particle(el, rand(0, w), rand(0, h), d, rand(9000, 24_000), now);
    p.a = 0;                              // how far it has run
    p.b = d > 9 ? rand(0.2, 0.9) : 0;     // only the heavy ones ever run
    p.c = rand(0, 1);
    return p;
  },
  step(p, t, now, api) {
    /* Most drops sit. A big one hangs until it is heavy enough and then goes
       all at once, accelerating, and the sitting-still is what makes the
       running read as sudden. */
    if (p.b > 0 && t > p.c * 0.4) {
      p.a += p.b * (1 + p.a * 0.02);
      if (Math.random() < 0.04 && p.a > 12) api.spawn(p.x + rand(-2, 2), p.y + p.a - rand(4, 20), 1);
    }
    p.el.style.transform = `translate3d(${p.x}px, ${p.y + p.a}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 5) * 0.95);
  },
};


/* ---------------------------------------------------------- lanternriver -- */
const lanternriver: RelaxEffect = {
  id: 'lanternriver',
  label: 'Lantern River',
  group: 'Immersion',
  blurb: 'Paper lanterns let go upstream, coming down past you one at a time.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 7,
  spawnEveryMs: 4200,
  spawnPerTick: 1,
  maxParticles: 22,
  onStart(_x, _y, api) {
    raise('lanternriver', api, (add) => {
      add('background:#05070c;');
      add('background:linear-gradient(180deg,#080c16 0%,#0d131f 34%,#121826 46%,#080c14 52%,#05080e 100%);');
      // The far bank: a black mass with a few windows in it.
      const bank: string[] = [];
      for (let i = 0; i < 30; i++) {
        bank.push(`<rect x='${rand(0, 100).toFixed(1)}' y='${rand(2, 16).toFixed(1)}' width='${rand(0.4, 1.2).toFixed(2)}'` +
          ` height='${rand(0.6, 1.6).toFixed(2)}' fill='#ffcf8a' opacity='${rand(0.3, 0.9).toFixed(2)}'/>`);
      }
      add('top:auto;bottom:48%;height:20%;' +
        svgLayer(100, 24, `<path d='${ridgePath(100, 24, 15, 0.14)}' fill='#04060a'/>` + bank.join('')));
      // The water. Black, and everything on it is a reflection.
      add('top:52%;background:linear-gradient(180deg,#070b12 0%,#04070c 60%,#020407 100%);');
      add('top:52%;background:repeating-linear-gradient(177deg, rgba(150,180,255,0.05) 0 1px, transparent 1px 8px);' +
        'animation:relaxKoiWind 11s linear infinite;');
      filmPass(add, '#04060c', '#ffb060', 0.56, 0.16, 0.46);
    });
    startAmbience('ocean');
  },
  onStop() { lower('lanternriver'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* One lantern is a paper box, its own glow, and — the part that sells it —
       a long broken reflection under it on the water. */
    const d = rand(8, 26);
    const el = document.createElement('div');
    baseStyle(el, d, `height:${(d * 2.4).toFixed(0)}px;`);
    const glow = document.createElement('div');
    glow.style.cssText =
      `position:absolute;left:${(-d * 1.4).toFixed(0)}px;top:${(-d * 1.2).toFixed(0)}px;` +
      `width:${(d * 3.8).toFixed(0)}px;height:${(d * 3.8).toFixed(0)}px;border-radius:50%;mix-blend-mode:screen;` +
      'background:radial-gradient(circle, rgba(255,186,96,0.5) 0 14%, rgba(255,140,50,0.2) 38%, transparent 72%);';
    const body = document.createElement('div');
    body.style.cssText =
      `position:absolute;left:0;top:0;width:${d}px;height:${(d * 1.15).toFixed(0)}px;border-radius:12% 12% 8% 8%;` +
      'background:linear-gradient(180deg, #ffd79a 0%, #ffab52 46%, #d9752a 100%);' +
      'box-shadow:0 0 12px rgba(255,170,80,0.7), inset 0 -2px 4px rgba(140,60,10,0.5);';
    const refl = document.createElement('div');
    /* The reflection sits directly under the lantern, is longer than it, and
       fades out downward — a solid block of light under a lantern reads as a
       second lantern hanging upside down. */
    refl.style.cssText =
      `position:absolute;left:${(d * 0.12).toFixed(0)}px;top:${(d * 1.2).toFixed(0)}px;` +
      `width:${(d * 0.76).toFixed(0)}px;height:${(d * 2.2).toFixed(0)}px;mix-blend-mode:screen;` +
      'background:repeating-linear-gradient(180deg, rgba(255,170,80,0.42) 0 1.5px, transparent 1.5px 4px);' +
      '-webkit-mask-image:linear-gradient(180deg, #000 0%, transparent 100%);' +
      'mask-image:linear-gradient(180deg, #000 0%, transparent 100%);filter:blur(1.2px);opacity:0.8;';
    el.appendChild(glow);
    el.appendChild(body);
    el.appendChild(refl);
    const near = Math.random();
    const p = particle(el, rand(-w * 0.1, w * 1.1), h * (0.54 + near * 0.4), d, rand(40_000, 78_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0004, 0.0011);
    p.c = rand(-1, 1) * w * 0.4;
    p.maxScale = 0.45 + near * 0.75;
    return p;
  },
  step(p, t, now) {
    // A lantern on a river turns slowly as it goes, and rocks as it turns.
    const rock = Math.sin(now * p.b + p.a) * 5;
    p.el.style.transform =
      `translate3d(${p.x + t * p.c}px, ${p.y + Math.sin(now * p.b * 1.6 + p.a) * 4}px, 0)` +
      ` rotate(${rock.toFixed(2)}deg) scale(${p.maxScale.toFixed(2)})`;
    p.el.style.opacity = String(Math.min(1, t * 10) * Math.min(1, (1 - t) * 10) * (0.45 + p.maxScale * 0.45));
  },
};

/* -------------------------------------------------------------- waterfall -- */
const waterfall: RelaxEffect = {
  id: 'waterfall',
  label: 'Waterfall',
  group: 'Immersion',
  blurb: 'A long drop into a green pool, and the spray hanging in the air at the bottom of it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 40,
  spawnEveryMs: 200,
  spawnPerTick: 2,
  maxParticles: 150,
  onStart(_x, _y, api) {
    raise('waterfall', api, (add) => {
      const dark = api.isDark;
      add(dark ? 'background:#08120e;' : 'background:#1a3226;');
      // Wet rock, dark and vertical, on both sides of the drop.
      add(dark
        ? 'background:linear-gradient(180deg,#12201a 0%,#0e1a16 46%,#0a1410 100%);'
        : 'background:linear-gradient(180deg,#2e4436 0%,#24382c 46%,#1a2a20 100%);');
      const rockFace = (x0: number, wide: number, fill: string) => {
        const out: string[] = [];
        for (let i = 0; i < 14; i++) {
          const x = x0 + rand(0, wide);
          out.push(`<path d='M${x.toFixed(1)},0 l${rand(-3, 3).toFixed(1)},${rand(20, 60).toFixed(1)}` +
            ` l${rand(-3, 3).toFixed(1)},${rand(20, 50).toFixed(1)}' stroke='${fill}' stroke-width='${rand(0.6, 3).toFixed(1)}'` +
            ` fill='none' opacity='${rand(0.2, 0.6).toFixed(2)}'/>`);
        }
        return out.join('');
      };
      add(svgLayer(100, 100,
        `<rect x='0' y='0' width='34' height='100' fill='${dark ? '#0a1310' : '#1e2e24'}'/>` +
        `<rect x='66' y='0' width='34' height='100' fill='${dark ? '#0a1310' : '#1e2e24'}'/>` +
        rockFace(0, 34, dark ? '#1c2c24' : '#3a5442') + rockFace(66, 34, dark ? '#1c2c24' : '#3a5442')));
      // Moss on the wet edges, because everything beside a waterfall is green.
      add(`background:radial-gradient(20% 60% at 32% 60%, rgba(${dark ? '40,90,50' : '90,150,80'},0.5), transparent 74%),` +
        `radial-gradient(20% 60% at 68% 50%, rgba(${dark ? '40,90,50' : '90,150,80'},0.44), transparent 74%);`);

      /* The fall itself. Water going over an edge is not a white bar: it is a
         hundred separate threads that break up as they go down, so the top is
         glassy and the bottom is all foam. */
      const threads: string[] = [];
      for (let i = 0; i < 70; i++) {
        const x = 34 + rand(0, 32);
        const start = rand(0, 30);
        threads.push(`<rect x='${x.toFixed(2)}' y='${start.toFixed(1)}' width='${rand(0.3, 1.8).toFixed(2)}'` +
          ` height='${rand(30, 90).toFixed(0)}' rx='0.4' fill='#ffffff' opacity='${rand(0.16, 0.5).toFixed(2)}'/>`);
      }
      /* Feathered at both sides and thinning downward: water spreads and
         breaks up as it falls, so the sheet is solid at the lip and nearly all
         spray by the time it lands. */
      const feather = 'linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%)';
      add('left:30%;right:30%;' +
        `-webkit-mask-image:${feather};mask-image:${feather};` +
        'background:linear-gradient(180deg, rgba(226,246,255,0.75) 0%, rgba(255,255,255,0.55) 30%,' +
        ' rgba(255,255,255,0.32) 66%, rgba(255,255,255,0.12) 100%);');
      add('left:30%;right:30%;mix-blend-mode:screen;' +
        `-webkit-mask-image:${feather};mask-image:${feather};` +
        svgLayer(40, 100, threads.join('')) + 'background-size:100% 50%;animation:relaxFallRun 0.8s linear infinite;');
      add('left:28%;right:28%;filter:blur(4px);opacity:0.6;mix-blend-mode:screen;' +
        `-webkit-mask-image:${feather};mask-image:${feather};` +
        svgLayer(44, 100, threads.join('')) + 'background-size:100% 34%;animation:relaxFallRun 1.3s linear infinite;');
      // The lip. Water bends over an edge before it falls off it.
      add('left:28%;right:28%;top:0;height:9%;' +
        'background:linear-gradient(180deg, rgba(10,20,16,0.8) 0%, rgba(180,220,230,0.5) 60%, transparent 100%);' +
        'border-radius:0 0 40% 40%/0 0 100% 100%;');
      // The pool, and the boil where the fall lands in it.
      add(`top:auto;bottom:0;height:22%;background:linear-gradient(180deg, ${dark ? '#16403a' : '#2e6a5c'} 0%, ${dark ? '#0a201e' : '#194038'} 100%);`);
      add('top:auto;bottom:0;height:30%;left:22%;right:22%;filter:blur(12px);' +
        'background:radial-gradient(closest-side ellipse at 50% 14%, rgba(255,255,255,0.8), rgba(220,250,255,0.3) 46%, transparent 76%);' +
        'animation:relaxImmBreath 4.6s ease-in-out infinite alternate;');
      // The wash running out from where it lands, as broken lines, not rings.
      const wash: string[] = [];
      for (let i = 0; i < 16; i++) {
        const t = i / 16;
        wash.push(`<rect x='${rand(2, 70).toFixed(1)}' y='${(8 + t * 88).toFixed(1)}' width='${rand(18, 46).toFixed(1)}'` +
          ` height='${rand(0.8, 2.4).toFixed(2)}' rx='1.2' fill='#ffffff' opacity='${(0.3 - t * 0.2).toFixed(2)}'/>`);
      }
      add('top:auto;bottom:0;height:22%;mix-blend-mode:screen;filter:blur(1.4px);' + svgLayer(100, 100, wash.join('')) +
        'animation:relaxKoiWind 3.4s linear infinite;');
      filmPass(add, dark ? '#08160f' : '#16301f', dark ? '#4a7a68' : '#e8fff4', 0.5, 0.16, 0.42);
    });
    startAmbience('ocean');
  },
  onStop() { lower('waterfall'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    // Spray: it comes off the bottom, goes UP, and hangs there.
    const d = rand(10, 60);
    const p = mote(
      w * 0.5 + rand(-w * 0.24, w * 0.24), h * rand(0.74, 0.9), now,
      'border-radius:50%;mix-blend-mode:screen;filter:blur(7px);' +
        'background:radial-gradient(closest-side ellipse, rgba(255,255,255,0.5), transparent 74%);',
      d, rand(2600, 6000)
    );
    p.b = rand(-0.5, 0.5);
    p.c = rand(0.5, 1.6);
    return p;
  },
  step(p, t) {
    const rise = Math.pow(t, 0.7);
    p.el.style.transform =
      `translate3d(${p.x + t * p.b * 120}px, ${p.y - rise * 180 * p.c}px, 0) scale(${0.5 + rise * 1.6})`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.pow(1 - t, 1.3) * 0.6);
  },
};

/* ------------------------------------------------------------------ nebula -- */
const nebula: RelaxEffect = {
  id: 'nebula',
  label: 'Nebula',
  group: 'Immersion',
  blurb: 'A long exposure of somewhere very far away: gas, dust, and a great many stars behind it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 26,
  spawnEveryMs: 2200,
  spawnPerTick: 1,
  maxParticles: 60,
  onStart(_x, _y, api) {
    raise('nebula', api, (add) => {
      add('background:radial-gradient(120% 110% at 40% 40%, #0b0a1e 0%, #05040e 50%, #010104 100%);');
      add(RELAX_STARFIELD + 'opacity:0.8;animation:relaxSkyTurn 460s linear infinite;');

      /* Emission nebula: hydrogen glows red, oxygen glows blue-green, and the
         DUST in front of them glows not at all — it just blocks. Three
         luminous clouds and one dark lane is the whole recipe. */
      /* Gas is not a shape, it is a CLOUD OF SHAPES with holes between them.
         Twenty small overlapping ellipses along a wandering spine give the
         ragged filaments a nebula actually has; three big ones give a lozenge,
         which is what the first pass of this looked like. */
      const gas = (n: number, cx: number, cy: number, spread: number, cols: string[], a: number) => {
        const out: string[] = [];
        let px = cx;
        let py = cy;
        for (let i = 0; i < n; i++) {
          px += rand(-spread, spread);
          py += rand(-spread * 0.6, spread * 0.6);
          out.push(`<ellipse cx='${px.toFixed(1)}' cy='${py.toFixed(1)}' rx='${rand(4, 15).toFixed(1)}'` +
            ` ry='${rand(3, 10).toFixed(1)}' fill='${pick(cols)}' opacity='${(a * rand(0.4, 1)).toFixed(2)}'` +
            ` transform='rotate(${rand(-60, 60).toFixed(0)} ${px.toFixed(1)} ${py.toFixed(1)})'/>`);
        }
        return out.join('');
      };
      add('mix-blend-mode:screen;filter:blur(14px);animation:relaxNebulaA 180s ease-in-out infinite alternate;' +
        svgLayer(100, 100, gas(30, 46, 46, 13, ['#d8365c', '#ff6a4a', '#b83a7a'], 0.3)));
      add('mix-blend-mode:screen;filter:blur(9px);animation:relaxNebulaB 240s ease-in-out infinite alternate;' +
        svgLayer(100, 100, gas(22, 56, 44, 11, ['#2ad0ff', '#5affc8', '#4a7aff'], 0.22)));
      add('mix-blend-mode:screen;filter:blur(4px);opacity:0.5;' +
        svgLayer(100, 100, gas(34, 50, 48, 14, ['#ff9a7a', '#ffd2b0', '#c8a0ff'], 0.12)));
      // The bright core the whole thing is lit from.
      add('mix-blend-mode:screen;filter:blur(16px);' +
        'background:radial-gradient(5% 4.5% at 47% 46%, rgba(255,244,226,0.55), rgba(255,190,160,0.16) 44%, transparent 76%);' +
        'animation:relaxImmBreath 26s ease-in-out infinite alternate;');
      // The dust lane. Nothing shines through it, which is what makes it read.
      // The dust in FRONT of it, which glows not at all and only ever blocks.
      add('filter:blur(9px);opacity:0.9;' +
        svgLayer(100, 100,
          "<path d='M4,64 Q22,56 34,61 Q46,66 58,60 Q72,53 86,58 Q94,61 100,56 L100,72 Q88,76 74,71" +
          " Q58,65 44,72 Q30,79 14,74 Q8,72 4,74 Z' fill='#03030a'/>" +
          "<ellipse cx='30' cy='38' rx='9' ry='5' fill='#03030a' opacity='0.7' transform='rotate(-24 30 38)'/>" +
          "<ellipse cx='70' cy='66' rx='11' ry='4' fill='#03030a' opacity='0.6' transform='rotate(18 70 66)'/>"));
      filmPass(add, '#05040f', '#4a2a5a', 0.5, 0.2, 0.44);
    });
    startAmbience('drone');
  },
  onStop() { lower('nebula'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(1.5, 5);
    const col = pick(['255,240,220', '190,214,255', '255,200,170', '220,230,255']);
    const p = mote(
      rand(0, w), rand(0, h), now,
      `border-radius:50%;mix-blend-mode:screen;background:radial-gradient(circle, rgba(${col},1) 0 26%, transparent 74%);` +
        `box-shadow:0 0 ${rand(4, 12).toFixed(0)}px rgba(${col},0.8);`,
      d, rand(6000, 16_000)
    );
    return p;
  },
  step(p, t) {
    // Stars do not move. They come up out of the exposure and go back into it.
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${0.6 + e * 0.7})`;
    p.el.style.opacity = String(e * 0.9);
  },
};

/* ------------------------------------------------------------------ autumn -- */
const autumn: RelaxEffect = {
  id: 'autumn',
  label: 'Falling Leaves',
  group: 'Immersion',
  blurb: 'A beech wood in the third week of October, quietly taking itself apart.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 40,
  spawnEveryMs: 420,
  spawnPerTick: 1,
  maxParticles: 110,
  onStart(_x, _y, api) {
    raise('autumn', api, (add) => {
      const dark = api.isDark;
      add(dark ? 'background:#140d09;' : 'background:#8a6a3a;');
      add(dark
        ? 'background:linear-gradient(180deg,#241608 0%,#3a2410 40%,#241708 74%,#140c06 100%);'
        : 'background:linear-gradient(180deg,#e8c176 0%,#d99a4e 40%,#a86a34 74%,#6b431f 100%);');
      // Light coming through the canopy from up and behind.
      add(`background:radial-gradient(40% 34% at 62% 12%, rgba(255,${dark ? '190,110' : '244,200'},0.55), transparent 74%);` +
        'mix-blend-mode:screen;animation:relaxImmBreath 24s ease-in-out infinite alternate;');

      /* Trunks. Beeches are tall, straight and pale, and they get closer
         together the further away they are — which is the only perspective cue
         a wood needs. */
      const wood = (n: number, wide: number, fill: string) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = rand(0, 100);
          const lean = rand(-1.4, 1.4);
          out.push(`<path d='M${x.toFixed(1)},100 Q${(x + lean).toFixed(1)},50 ${(x + lean * 2.4).toFixed(1)},-6'` +
            ` stroke='${fill}' stroke-width='${wide.toFixed(2)}' fill='none'/>`);
          for (let k = 0; k < 3; k++) {
            const yy = rand(6, 46);
            out.push(`<path d='M${(x + lean * 1.6).toFixed(1)},${yy.toFixed(1)} l${rand(-16, 16).toFixed(1)},${rand(-12, -2).toFixed(1)}'` +
              ` stroke='${fill}' stroke-width='${(wide * 0.34).toFixed(2)}' fill='none'/>`);
          }
        }
        return out.join('');
      };
      add(`opacity:${dark ? 0.4 : 0.34};filter:blur(2.4px);` + svgLayer(100, 100, wood(16, 0.7, dark ? '#3e2c1c' : '#c9a878')));
      add(`opacity:${dark ? 0.7 : 0.6};filter:blur(0.9px);` + svgLayer(100, 100, wood(8, 1.5, dark ? '#2c1e12' : '#9c7c52')));
      add(svgLayer(100, 100, wood(4, 3.2, dark ? '#1c130b' : '#6b5232')));
      // The leaf litter, already thick on the ground.
      const litter: string[] = [];
      for (let i = 0; i < 220; i++) {
        litter.push(`<ellipse cx='${rand(0, 100).toFixed(1)}' cy='${(100 - Math.pow(Math.random(), 1.6) * 30).toFixed(1)}'` +
          ` rx='${rand(0.6, 2).toFixed(2)}' ry='${rand(0.3, 0.9).toFixed(2)}'` +
          ` fill='${pick(dark ? ['#6a3a16', '#8a4a1e', '#a35c22', '#4a2a12'] : ['#c9762c', '#e09a3e', '#a85a24', '#8a4a1e'])}'` +
          ` opacity='${rand(0.4, 1).toFixed(2)}' transform='rotate(${rand(0, 180).toFixed(0)} ${rand(0, 100).toFixed(1)} 90)'/>`);
      }
      add('top:auto;bottom:0;height:34%;' + svgLayer(100, 100, litter.join('')));
      filmPass(add, dark ? '#1a1008' : '#5a3a18', dark ? '#7a4a1e' : '#ffe0a0', 0.5, 0.17, 0.5);
    });
    startAmbience('wind');
  },
  onStop() { lower('autumn'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(9, 22);
    const dark = api.isDark;
    const el = document.createElement('div');
    const col = pick(dark ? ['#b9631e', '#d98a2e', '#8a4a1e', '#c97a2a'] : ['#e8952e', '#f0b64a', '#c96a24', '#d98a2e']);
    baseStyle(el, d,
      `height:${(d * 0.8).toFixed(1)}px;` +
      svgLayer(20, 16,
        `<path d='M10,15 Q1,10 3,4 Q9,1 10,0 Q11,1 17,4 Q19,10 10,15 Z' fill='${col}'/>` +
        `<path d='M10,15 L10,3' stroke='#00000044' stroke-width='0.6'/>`));
    const p = particle(el, rand(-40, w + 40), rand(-h * 0.3, 0), d, rand(9000, 17_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0012, 0.0032);
    p.c = h * rand(0.9, 1.5);
    p.d = rand(-1, 1);
    return p;
  },
  step(p, t, now) {
    /* A leaf does not fall, it SLIPS: it slides sideways along its own plane,
       stalls, tips over and slides the other way. One sine on the x and a
       matching one on the rotation is nearly the whole thing. */
    const swing = Math.sin(now * p.b + p.a);
    p.el.style.transform =
      `translate3d(${p.x + swing * 90 + p.d * t * 120}px, ${p.y + t * p.c}px, 0)` +
      ` rotate(${(swing * 70).toFixed(1)}deg) rotate3d(1,0.6,0,${(swing * 80).toFixed(1)}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 8));
  },
};

/* ----------------------------------------------------------------- harbour -- */
const harbour: RelaxEffect = {
  id: 'harbour',
  label: 'Harbour Lights',
  group: 'Immersion',
  blurb: 'The far side of the water at midnight, and every light on it written twice.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 16,
  spawnEveryMs: 3400,
  spawnPerTick: 1,
  maxParticles: 34,
  onStart(_x, _y, api) {
    raise('harbour', api, (add) => {
      add('background:#04060c;');
      add('background:linear-gradient(180deg,#070c18 0%,#0d1426 32%,#141d33 46%,#0a1120 50%,#04070e 100%);');
      add(RELAX_STARFIELD + 'bottom:54%;opacity:0.3;');

      /* The far shore: a low black line with a row of lights along it. The
         REFLECTION is the point of the whole scene, so every light gets one —
         directly below it, broken into dashes, and longer than the light is. */
      const lights: { x: number; c: string }[] = [];
      for (let i = 0; i < 46; i++) {
        lights.push({ x: rand(0, 100), c: pick(['#ffcf8a', '#ffe6b8', '#a8d0ff', '#ff9a6a', '#d8ffe0']) });
      }
      add('top:auto;bottom:50%;height:14%;' +
        svgLayer(100, 16,
          `<path d='${ridgePath(100, 16, 11, 0.1)}' fill='#03050a'/>` +
          lights.map((l) => `<circle cx='${l.x.toFixed(1)}' cy='${rand(9, 12.5).toFixed(1)}' r='${rand(0.22, 0.6).toFixed(2)}'` +
            ` fill='${l.c}'/>`).join('')));
      add('top:auto;bottom:50%;height:14%;mix-blend-mode:screen;filter:blur(3px);opacity:0.8;' +
        svgLayer(100, 16, lights.map((l) => `<circle cx='${l.x.toFixed(1)}' cy='11' r='${rand(0.8, 2).toFixed(2)}' fill='${l.c}'/>`).join('')));

      add('top:50%;background:linear-gradient(180deg,#0a1020 0%,#060a14 50%,#03050a 100%);');
      const refl: string[] = [];
      for (const l of lights) {
        const len = rand(18, 70);
        for (let k = 0; k < 26; k++) {
          const t = k / 26;
          refl.push(`<rect x='${(l.x - rand(0.4, 1.6) * (0.4 + t)).toFixed(2)}' y='${(t * len).toFixed(1)}'` +
            ` width='${(rand(0.5, 2.2) * (0.4 + t)).toFixed(2)}' height='${rand(0.3, 1).toFixed(2)}' rx='0.3'` +
            ` fill='${l.c}' opacity='${((1 - t) * rand(0.2, 0.8)).toFixed(2)}'/>`);
        }
      }
      add('top:50%;mix-blend-mode:screen;filter:blur(0.8px);' + svgLayer(100, 100, refl.join('')) +
        'animation:relaxKoiWind 5s linear infinite;');
      filmPass(add, '#04060e', '#ffb878', 0.54, 0.16, 0.46);
    });
    startAmbience('ocean');
  },
  onStop() { lower('harbour'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const d = rand(30, 90);
    const c = pick(['255,196,120', '190,214,255', '255,150,110']);
    const p = mote(
      rand(0, w), rand(h * 0.54, h), now,
      `border-radius:50%;mix-blend-mode:screen;filter:blur(12px);` +
        `background:radial-gradient(closest-side ellipse, rgba(${c},0.34), transparent 74%);`,
      d, rand(6000, 13_000)
    );
    p.el.style.height = `${d * 0.16}px`;
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${0.6 + e * 0.8}, 1)`;
    p.el.style.opacity = String(e * 0.5);
  },
};

/* -------------------------------------------------------------- thunderhead -- */
const thunderhead: RelaxEffect = {
  id: 'thunderhead',
  label: 'Distant Storm',
  group: 'Immersion',
  blurb: 'A storm forty miles off over the plain. All the light, none of the noise.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 4,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('thunderhead', api, (add) => {
      add('background:#070a14;');
      add('background:linear-gradient(180deg,#0d1424 0%,#182036 34%,#2a2c3e 56%,#1a1c28 74%,#0a0c14 100%);');

      /* An anvil. A storm cell that far away is one enormous shape with a flat
         top where it hit the tropopause and spread — and it is only ever
         visible because it is lit from inside. */
      /* A cumulonimbus is a tower of boiling lobes with a flat sheared top
         where it hit the tropopause and spread sideways. Two smooth curves gave
         a grey pillow with a rectangle in it. */
      const lobes: string[] = [];
      for (let i = 0; i < 26; i++) {
        const t = i / 26;
        const cx = 50 + Math.sin(t * 5) * 14 + rand(-7, 7);
        const cy = 56 - t * 34 + rand(-3, 3);
        lobes.push(`<ellipse cx='${cx.toFixed(1)}' cy='${cy.toFixed(1)}' rx='${rand(5, 13).toFixed(1)}'` +
          ` ry='${rand(4, 9).toFixed(1)}'/>`);
      }
      // The anvil: it spreads flat and thin, and it is the tell for the whole cell.
      const anvil =
        `<g fill='#0e1422'>${lobes.join('')}` +
        "<ellipse cx='52' cy='18' rx='40' ry='4'/><ellipse cx='64' cy='15.5' rx='28' ry='2.6'/></g>";
      add('top:4%;height:60%;filter:blur(4px);opacity:0.95;' + svgLayer(100, 60, anvil));
      // One pale rim along the top, where what is left of the daylight catches it.
      add('top:4%;height:60%;filter:blur(7px);opacity:0.22;mix-blend-mode:screen;' +
        svgLayer(100, 60, anvil.replace('#0e1422', '#6a7c9e')) + 'background-position:0 -0.5%;');
      add('top:4%;height:60%;filter:blur(2px);opacity:0.34;' +
        svgLayer(100, 60, anvil.replace('#0e1422', '#1e2740')) + 'background-position:1% -2%;');
      // Lit from inside: the flash is a patch in the belly, not the whole cloud.
      add('top:22%;height:36%;left:22%;right:34%;filter:blur(18px);mix-blend-mode:screen;opacity:0;' +
        'background:radial-gradient(closest-side ellipse, rgba(190,214,255,0.95), rgba(120,160,240,0.3) 54%, transparent 100%);' +
        'animation:relaxLightning 9s steps(1) infinite;');
      add('top:10%;height:52%;filter:blur(26px);mix-blend-mode:screen;opacity:0;' +
        svgLayer(100, 60, anvil.replace('#0e1422', '#5a80d8')) +
        'animation:relaxLightning 9s steps(1) infinite;animation-delay:0.06s;');
      // Rain, hanging under it in a slanted curtain.
      const curtain = 'radial-gradient(closest-side ellipse at 50% 20%, #000 0%, rgba(0,0,0,0.6) 60%, transparent 100%)';
      add('top:42%;height:30%;left:20%;right:24%;opacity:0.26;filter:blur(2.4px);' +
        `-webkit-mask-image:${curtain};mask-image:${curtain};` +
        'background:repeating-linear-gradient(100deg, rgba(150,180,220,0.3) 0 1px, transparent 1px 6px);');
      // The plain it is standing on.
      add('top:auto;bottom:0;height:26%;' +
        svgLayer(1400, 200, `<path d='${ridgePath(1400, 200, 150, 0.06)}' fill='#05070e'/>`));
      add('top:auto;bottom:0;height:30%;background:linear-gradient(0deg, rgba(30,40,70,0.42), transparent 70%);');
      filmPass(add, '#080c16', '#4a5a86', 0.54, 0.17, 0.44);
    });
    startAmbience('wind');
  },
  onStop() { lower('thunderhead'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(w * 0.2, w * 0.6);
    const p = mote(
      rand(-size * 0.4, w), rand(h * 0.5, h * 0.8), now,
      'border-radius:50%;filter:blur(20px);' +
        'background:radial-gradient(closest-side ellipse, rgba(120,140,180,0.34), transparent 74%);',
      size, rand(24_000, 44_000)
    );
    p.el.style.height = `${size * 0.16}px`;
    p.c = rand(-60, 120);
    return p;
  },
  step(p, t) {
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y}px, 0) scale(${0.7 + e * 0.5}, 1)`;
    p.el.style.opacity = String(e * 0.5);
  },
};

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers, blooming, petalfall, rain, fireworks, galaxy, bubblewrap, chimes,
  ripples, ocean, handpan, snow, fireflies, lanterns, gate, breathing, aurora,
  koi, ink, soap, glassrain, dandelion, kaleido, stones, embers, jellyfish, candles,
  stargaze, tide, clouds, duskwash, deepwater, godrays, shoji, wheat, lavalamp, blossomstorm,
  fogbank, citynight, meteors, silk, sandgarden, moonrise, bioluminescence, steamroom, prism, wisteria,
  mountains, campfire, snowfield, desert, bamboo, rainwindow,
  lanternriver, waterfall, nebula, autumn, harbour, thunderhead,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  /* Ordered by group, so the picker can render them in shelves without having
     to sort at render time. */
  stargaze, moonrise, meteors, duskwash, clouds, fogbank, tide, deepwater,
  bioluminescence, godrays, shoji, wheat, blossomstorm, wisteria, sandgarden,
  citynight, silk, lavalamp, prism, steamroom,
  mountains, snowfield, desert, bamboo, campfire, rainwindow,
  nebula, thunderhead, autumn, waterfall, harbour, lanternriver,
  ocean, ripples, rain, koi, ink, glassrain, jellyfish,
  blooming, flowers, petalfall, fireflies, dandelion,
  aurora, galaxy, snow, fireworks,
  lanterns, embers, candles,
  bubblewrap, soap, kaleido,
  gate, breathing, handpan, chimes, stones,
];
