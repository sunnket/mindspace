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
import { RELAX_DRIFT, RELAX_KOI, RELAX_SEEDHEAD } from './relaxAssets';
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
  | 'wisteria';

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


/** koi's second species — the ring a scatter of food leaves on the surface. */
const RIPPLE = 1;
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
 * The only creatures in the catalogue with an opinion.
 *
 * Koi wander on a lazy sine until you drop food, and then every fish in the
 * pond turns and comes for it — which is the entire pleasure of feeding fish,
 * and the reason this is worth clicking twice. They steer rather than snap:
 * heading is chased toward the target a few hundredths of a radian per frame,
 * so a fish arrives in a long curve like something with a body.
 */
let koiFood: { x: number; y: number; until: number } | null = null;
/** Where the pond is. Without an edge the fish simply leave, which they did. */
let koiHome: { x: number; y: number } | null = null;
const KOI_POND = 760;

const koi: RelaxEffect = {
  id: 'koi',
  label: 'Koi Pond',
  group: 'Water',
  blurb: 'Fish the size of your hand, going nowhere in particular. Click the water to scatter food — every one of them turns and comes.',
  space: 'world',
  flash: '',
  burstMs: 60_000,
  openingPop: 6,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 30,
  onStart(x, y) {
    startAmbience('ocean');
    koiHome = { x, y };
  },
  onStop() {
    stopAmbience('ocean');
    koiFood = null;
    koiHome = null;
  },
  onBurst(x, y, api) {
    koiFood = { x, y, until: performance.now() + 5600 };
    playPlop();
    api.spawn(x, y, 3, RIPPLE);
  },
  create(x, y, now, api, kind = 0) {
    if (kind === RIPPLE) {
      const el = document.createElement('div');
      const size = 44;
      const ring = api.isDark
        ? 'border:2px solid rgba(170,220,255,0.55);'
        : 'border:2px solid rgba(60,130,180,0.5);';
      baseStyle(el, size, `border-radius:50%;${ring}`);
      const p = particle(el, x, y, size, rand(1500, 2200), now);
      p.a = rand(0, 0.3);
      p.b = rand(3, 6);
      return p;
    }

    const el = document.createElement('img');
    const size = rand(48, 92);
    el.src = pick(RELAX_KOI);
    el.draggable = false;
    /* Fish sit UNDER the surface, so they are never quite in focus and never
       quite at full strength. That one line of separation is what stops them
       reading as stickers dropped on the board. */
    baseStyle(el, size, 'object-fit:contain;filter:saturate(0.86) blur(0.35px);');

    const p = particle(el, x + rand(-420, 420), y + rand(-300, 300), size, 600_000, now);
    p.a = rand(0, Math.PI * 2);       // heading
    p.c = rand(0.42, 0.86);           // cruise speed
    p.b = rand(0.0016, 0.0042);       // how fast it wanders off course
    p.d = rand(0, Math.PI * 2);       // wander phase
    p.maxScale = rand(0.9, 1.1);
    return p;
  },
  step(p, t, now) {
    if (p.kind === RIPPLE) {
      const local = (t - p.a) / (1 - p.a);
      if (local <= 0) { p.el.style.opacity = '0'; return; }
      const eased = 1 - Math.pow(1 - local, 2.4);
      p.el.style.transform =
        `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${0.3 + eased * p.b})`;
      p.el.style.opacity = String((1 - local) * 0.55);
      return;
    }

    /* Wandering: a slow sine on the heading. Turning toward food overrides it,
       and the turn is RATE-LIMITED — a fish that snapped instantly to the new
       bearing would read as a cursor, not an animal. */
    let turn = Math.sin(now * p.b + p.d) * 0.03;
    let speed = p.c;

    /* Two things can override the wander, and the order matters: food first,
       then the edge of the pond. Without the edge the fish just leave — which
       is exactly what they did the first time, and a pond you have to keep
       re-stocking is not restful. */
    let target: { x: number; y: number } | null = null;
    let chasing = false;
    if (koiFood && now < koiFood.until) {
      target = koiFood;
      chasing = true;
    } else if (koiHome) {
      const out = Math.hypot(p.x - koiHome.x, p.y - koiHome.y);
      if (out > KOI_POND) target = koiHome;
    }

    if (target) {
      /* Each fish aims at its own point on a ring around the food rather than
         at the food itself. Aimed at one point they arrive and stack into a
         single clot of fish, which looks like a bug and not like feeding. */
      const spread = chasing ? 74 : 0;
      const dx = target.x + Math.cos(p.d * 7.3) * spread - p.x;
      const dy = target.y + Math.sin(p.d * 7.3) * spread - p.y;
      const want = Math.atan2(dy, dx);
      let diff = want - p.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const near = Math.hypot(dx, dy);
      // Steer, never snap: a fish that turned instantly would read as a cursor.
      turn = Math.max(-0.05, Math.min(0.05, diff * 0.045));
      // Crowd the food, then mill about in it rather than piling on one point.
      if (chasing) speed = near > 60 ? p.c * 2.1 : p.c * 0.6;
    }

    p.a += turn;
    p.x += Math.cos(p.a) * speed;
    p.y += Math.sin(p.a) * speed;

    // The tail beat: a small roll, faster when the fish is hurrying.
    const beat = Math.sin(now * 0.006 + p.d) * (speed > p.c ? 7 : 4);
    const fade = Math.min(1, (now - p.born) / 1400);

    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) ` +
      `rotate(${(p.a * 180) / Math.PI + 90 + beat}deg) scale(${p.maxScale})`;
    p.el.style.opacity = String(fade * 0.92);
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

/* ---------------------------------------------------------------- stargaze */

const stargaze: RelaxEffect = {
  id: 'stargaze',
  label: 'Stargazing',
  group: 'Immersion',
  blurb: 'Lie back. The whole sky, turning at the speed it actually turns, and something falls through it every so often.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 3,
  spawnEveryMs: 4200,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('stargaze', api, (add) => {
      add(
        api.isDark
          ? 'background:radial-gradient(140% 110% at 50% 0%, #131a3e 0%, #080c22 44%, #02030a 100%);'
          : 'background:radial-gradient(140% 110% at 50% 0%, #1b2450 0%, #0c1230 46%, #04060f 100%);'
      );
      // The band. It leans, and it turns — a sky that holds still is a poster.
      add(
        'background:linear-gradient(101deg, transparent 30%, rgba(186,196,255,0.16) 44%,' +
          ' rgba(232,226,255,0.26) 50%, rgba(178,192,255,0.14) 57%, transparent 71%);' +
          'filter:blur(22px);animation:relaxSkyTurn 240s linear infinite;'
      );
      add(RELAX_STARFIELD + 'animation:relaxSkyTurn 240s linear infinite;');
      add('background:radial-gradient(120% 100% at 50% 52%, transparent 44%, rgba(0,0,0,0.55) 100%);');
    });
    startAmbience('drone');
  },
  onStop() { lower('stargaze'); stopAmbience('drone'); },
  create(x, y, now, api) {
    // A meteor: a hairline that is mostly tail.
    const el = document.createElement('div');
    const len = rand(90, 260);
    baseStyle(
      el, len,
      'height:2px;border-radius:2px;' +
        'background:linear-gradient(90deg, transparent, rgba(214,230,255,0.9), #fff);' +
        'box-shadow:0 0 12px rgba(190,215,255,0.9);'
    );
    const { w, h } = api.viewport;
    const p = particle(el, rand(w * 0.1, w * 0.95), rand(0, h * 0.5), len, rand(900, 1700), now);
    p.a = rand(0.36, 0.72);              // its angle down the sky
    p.c = rand(420, 900);                // how far it gets
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
  spawnEveryMs: 1800,
  spawnPerTick: 1,
  maxParticles: 26,
  onStart(_x, _y, api) {
    raise('tide', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#1a2740 0%,#2b3a54 34%,#3d4f66 52%,#12202e 53%,#050b12 100%);'
        : 'background:linear-gradient(180deg,#a8c2d8 0%,#cdd8dc 32%,#e6d8c0 50%,#3f5f74 51%,#16303f 100%);');
      // The sun or moon sitting on the line, and its path on the water.
      add('background:radial-gradient(38% 26% at 50% 50%, rgba(255,214,164,0.5), transparent 70%),' +
        'linear-gradient(180deg, transparent 51%, rgba(255,206,150,0.16) 54%, transparent 88%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 19s ease-in-out infinite alternate;');
      /* Three bands of water, each crawling at its own rate. One band is a
         gradient; three at different speeds is a sea. */
      add('top:52%;bottom:0;left:-14%;right:-14%;' +
        'background:repeating-linear-gradient(178deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 26px);' +
        'animation:relaxCrawlA 34s linear infinite;');
      add('top:60%;bottom:0;left:-14%;right:-14%;' +
        'background:repeating-linear-gradient(182deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 38px);' +
        'animation:relaxCrawlB 52s linear infinite;');
      add('top:70%;bottom:0;left:-14%;right:-14%;' +
        'background:repeating-linear-gradient(177deg, rgba(255,255,255,0.05) 0 3px, transparent 3px 54px);' +
        'animation:relaxCrawlA 78s linear infinite;');
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 46%, rgba(0,0,0,0.5) 100%);');
    });
    startAmbience('ocean');
  },
  onStop() { lower('tide'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(60, 190);
    const p = mote(
      rand(-40, w + 40), rand(h * 0.54, h * 0.98), now,
      'border-radius:50%;filter:blur(14px);' +
        'background:radial-gradient(closest-side ellipse, rgba(255,255,255,0.5), transparent 72%);',
      size, rand(9000, 17_000)
    );
    p.el.style.height = `${size * 0.24}px`;
    p.b = rand(-0.24, 0.24);
    return p;
  },
  step(p, t) {
    // Foam swells, slides, and is gone — never a hard edge anywhere.
    const e = Math.sin(t * Math.PI);
    p.el.style.transform = `translate3d(${p.x + t * p.b * 200}px, ${p.y}px, 0) scale(${0.6 + e * 0.7}, ${0.5 + e})`;
    p.el.style.opacity = String(e * 0.5);
  },
};

/* ------------------------------------------------------------------ clouds */

const clouds: RelaxEffect = {
  id: 'clouds',
  label: 'Cloud Drift',
  group: 'Immersion',
  blurb: 'Nothing but weather going past. Big ones near, small ones far, none of them in a hurry.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 9,
  spawnEveryMs: 5200,
  spawnPerTick: 1,
  maxParticles: 20,
  onStart(_x, _y, api) {
    raise('clouds', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#101a30 0%,#1c2b46 46%,#2a3c58 100%);'
        : 'background:linear-gradient(180deg,#6ea8d8 0%,#a8cbe4 44%,#d8e6ee 100%);');
      add('background:radial-gradient(90% 70% at 50% 110%, rgba(255,240,214,0.28), transparent 70%);' +
        'mix-blend-mode:screen;');
    });
    startAmbience('wind');
  },
  onStop() { lower('clouds'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* Depth is carried by three things at once: size, blur and speed. Any one
       of them alone and the sky reads as a flat sheet of stickers. */
    const near = Math.random();
    const size = rand(160, 520) * (0.5 + near);
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `height:${size * rand(0.34, 0.5)}px;filter:blur(${(16 + (1 - near) * 26).toFixed(0)}px);` +
        'background:' +
        'radial-gradient(closest-side ellipse, rgba(255,255,255,0.7) 0 14%, rgba(255,255,255,0.26) 52%, transparent 98%)  8% 70%/42% 66% no-repeat,' +
        'radial-gradient(closest-side ellipse, rgba(255,255,255,0.78) 0 16%, rgba(255,255,255,0.3) 54%, transparent 98%) 30% 46%/48% 88% no-repeat,' +
        'radial-gradient(closest-side ellipse, rgba(255,255,255,0.82) 0 16%, rgba(255,255,255,0.32) 54%, transparent 98%) 52% 32%/54% 100% no-repeat,' +
        'radial-gradient(closest-side ellipse, rgba(255,255,255,0.74) 0 15%, rgba(255,255,255,0.28) 54%, transparent 98%) 74% 54%/46% 82% no-repeat,' +
        'radial-gradient(closest-side ellipse, rgba(255,255,255,0.66) 0 14%, rgba(255,255,255,0.24) 52%, transparent 98%) 92% 74%/38% 60% no-repeat;'
    );
    const p = particle(el, -size, rand(-h * 0.1, h * 0.72), size, rand(40_000, 96_000) / (0.4 + near), now);
    p.c = w + size * 2;
    p.maxScale = 0.34 + near * 0.5;
    return p;
  },
  step(p, t) {
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 8) * p.maxScale);
  },
};

/* ---------------------------------------------------------------- duskwash */

const duskwash: RelaxEffect = {
  id: 'duskwash',
  label: 'Dusk to Dark',
  group: 'Immersion',
  blurb: 'The light going, over two whole minutes. Slow enough that you will not catch it happening.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 40,
  spawnEveryMs: 3400,
  spawnPerTick: 2,
  maxParticles: 120,
  onStart(_x, _y, api) {
    raise('duskwash', api, (add) => {
      /* One layer per hour of the evening, each fading up in turn. Animating a
         gradient's stops is a paint per frame; cross-fading whole layers is
         three composited opacities, and it looks identical. */
      add('background:linear-gradient(180deg,#2b3f6e 0%,#7d6f92 34%,#e0a074 62%,#f4c98e 80%,#8a6a54 100%);');
      add('background:linear-gradient(180deg,#1a2450 0%,#4a3a6a 36%,#a85a5e 64%,#d08a66 82%,#4a3038 100%);' +
        'animation:relaxDusk1 120s ease-in forwards;');
      add('background:linear-gradient(180deg,#080d24 0%,#161a3c 40%,#3a2440 70%,#4a2c34 88%,#140c16 100%);' +
        'animation:relaxDusk2 120s ease-in forwards;');
      add('background:radial-gradient(120% 100% at 50% 60%, transparent 42%, rgba(0,0,0,0.5) 100%);');
    });
  },
  onStop() { lower('duskwash'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const s = rand(1.2, 2.8);
    const p = mote(
      rand(0, w), rand(0, h * 0.62), now,
      `height:${s}px;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(206,220,255,0.9);`,
      s, rand(50_000, 110_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0006, 0.0018);
    return p;
  },
  step(p, t, now) {
    /* Stars arrive as the sky goes: they hold at nothing for the first third of
       their life, then come up. Nobody sees a star at seven o'clock. */
    const arrive = Math.max(0, (t - 0.28) / 0.4);
    const tw = 0.55 + Math.sin(now * p.b + p.a) * 0.45;
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, arrive) * Math.min(1, (1 - t) * 6) * tw);
  },
};

/* --------------------------------------------------------------- deepwater */

const deepwater: RelaxEffect = {
  id: 'deepwater',
  label: 'Deep Water',
  group: 'Immersion',
  blurb: 'Under the surface, looking up. Light moving on the ceiling, and everything a long way away.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 40,
  spawnEveryMs: 700,
  spawnPerTick: 2,
  maxParticles: 150,
  onStart(_x, _y, api) {
    raise('deepwater', api, (add) => {
      add('background:linear-gradient(180deg,#1d7c9e 0%,#0d5170 24%,#062c44 58%,#02141f 88%,#010a10 100%);');
      // Caustics: two nets of light at different scales, sliding against each
      // other. One net alone reads as a pattern; two read as water.
      add('top:0;height:56%;mix-blend-mode:screen;opacity:0.55;filter:blur(5px);' +
        'background:repeating-radial-gradient(circle at 30% 0%, rgba(190,244,255,0.34) 0 3px, transparent 3px 40px),' +
        'repeating-radial-gradient(circle at 74% 0%, rgba(160,230,255,0.28) 0 2px, transparent 2px 54px);' +
        'animation:relaxCaustics 17s ease-in-out infinite alternate;');
      add('mix-blend-mode:screen;opacity:0.4;' +
        'background:linear-gradient(174deg, rgba(190,240,255,0.34) 0 3%, transparent 22%) 14% 0/9% 100% no-repeat,' +
        'linear-gradient(186deg, rgba(190,240,255,0.28) 0 3%, transparent 26%) 42% 0/7% 100% no-repeat,' +
        'linear-gradient(178deg, rgba(190,240,255,0.3) 0 3%, transparent 24%) 76% 0/11% 100% no-repeat;' +
        'filter:blur(10px);animation:relaxShaftSway 21s ease-in-out infinite alternate;');
      add('background:radial-gradient(120% 100% at 50% 8%, transparent 34%, rgba(0,8,16,0.7) 100%);');
    });
    startAmbience('ocean');
  },
  onStop() { lower('deepwater'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const s = rand(2, 7);
    const p = mote(
      rand(0, w), h + rand(0, 60), now,
      `height:${s}px;border-radius:50%;background:rgba(214,244,255,0.6);` +
        'box-shadow:0 0 6px rgba(180,230,255,0.5);',
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
  blurb: 'Three shafts through a high window, and every speck of dust in them.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 70,
  spawnEveryMs: 620,
  spawnPerTick: 2,
  maxParticles: 200,
  onStart(_x, _y, api) {
    raise('godrays', api, (add) => {
      add(api.isDark
        ? 'background:radial-gradient(120% 100% at 50% 0%, #2b2a26 0%, #14130f 46%, #070605 100%);'
        : 'background:radial-gradient(120% 100% at 50% 0%, #3e3a30 0%, #201d18 48%, #0b0a08 100%);');
      add('mix-blend-mode:screen;opacity:0.5;filter:blur(16px);' +
        'background:linear-gradient(168deg, rgba(255,238,196,0.5) 0 6%, transparent 62%) 12% 0/22% 100% no-repeat,' +
        'linear-gradient(180deg, rgba(255,242,206,0.55) 0 6%, transparent 66%) 46% 0/26% 100% no-repeat,' +
        'linear-gradient(192deg, rgba(255,236,192,0.45) 0 6%, transparent 60%) 82% 0/20% 100% no-repeat;' +
        'animation:relaxImmBreath 27s ease-in-out infinite alternate;');
      add('background:radial-gradient(110% 90% at 50% 20%, transparent 40%, rgba(0,0,0,0.62) 100%);');
    });
  },
  onStop() { lower('godrays'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const s = rand(1.6, 4.4);
    const p = mote(
      rand(0, w), rand(0, h), now,
      `height:${s}px;border-radius:50%;background:rgba(255,244,214,0.9);`,
      s, rand(11_000, 22_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00025, 0.0008);
    p.vy = rand(-0.14, 0.1);
    p.c = rand(20, 70);
    return p;
  },
  step(p, t, now) {
    // Dust does not fall; it hangs, and the room's own air moves it around.
    p.y += p.vy;
    const drift = Math.sin(now * p.b + p.a) * p.c;
    const bob = Math.cos(now * p.b * 1.4 + p.a) * 14;
    p.el.style.transform = `translate3d(${p.x + drift}px, ${p.y + bob}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.55);
  },
};

/* ------------------------------------------------------------------- shoji */

const shoji: RelaxEffect = {
  id: 'shoji',
  label: 'Paper Screens',
  group: 'Immersion',
  blurb: 'Warm light through rice paper, and the shadow of one branch moving on it.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 24,
  spawnEveryMs: 1500,
  spawnPerTick: 1,
  maxParticles: 60,
  onStart(_x, _y, api) {
    raise('shoji', api, (add) => {
      add('background:linear-gradient(172deg,#f2e6cc 0%,#e2d2b0 46%,#c2ac86 100%);');
      // The lattice. Wide panes, a heavier frame, and the light behind it.
      add('background:' +
        'repeating-linear-gradient(90deg, rgba(96,74,48,0.42) 0 4px, transparent 4px 132px),' +
        'repeating-linear-gradient(180deg, rgba(96,74,48,0.42) 0 4px, transparent 4px 118px);');
      add('background:radial-gradient(70% 60% at 50% 42%, rgba(255,232,180,0.5), transparent 74%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 23s ease-in-out infinite alternate;');
      // The branch, in silhouette, on the far side of the paper.
      add('opacity:0.28;filter:blur(4px);transform-origin:88% 8%;' +
        'background:' +
        // the bough, thinning as it goes — two strokes at slightly different angles
        'linear-gradient(203deg, transparent 46.4%, rgba(46,36,24,0.9) 46.4% 49.4%, transparent 49.4%),' +
        'linear-gradient(214deg, transparent 47.6%, rgba(46,36,24,0.7) 47.6% 49%, transparent 49%),' +
        // and the blossom hanging off it
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 70% 22%/4.4% 7% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 62% 33%/3.6% 5.6% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 55% 41%/4.8% 7.4% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 47% 52%/3.8% 6% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 39% 61%/4.6% 7.2% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 31% 70%/3.4% 5.4% no-repeat,' +
        'radial-gradient(closest-side circle, #2e2418 0 62%, transparent 100%) 76% 14%/3.2% 5% no-repeat;' +
        'animation:relaxBranchSway 14s ease-in-out infinite alternate;');
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 48%, rgba(60,44,24,0.36) 100%);');
    });
  },
  onStop() { lower('shoji'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const s = rand(1.6, 4);
    const p = mote(
      rand(0, w), rand(0, h), now,
      `height:${s}px;border-radius:50%;background:rgba(120,96,58,0.5);`,
      s, rand(9000, 18_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0003, 0.0009);
    p.vy = rand(-0.06, 0.12);
    return p;
  },
  step(p, t, now) {
    p.y += p.vy;
    p.el.style.transform = `translate3d(${p.x + Math.sin(now * p.b + p.a) * 34}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.5);
  },
};

/* ------------------------------------------------------------------- wheat */

const wheat: RelaxEffect = {
  id: 'wheat',
  label: 'Wind in the Field',
  group: 'Immersion',
  blurb: 'A whole field, and the wind crossing it in waves you can watch arrive.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 190,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 200,
  onStart(_x, _y, api) {
    raise('wheat', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#2a2f46 0%,#4a4257 34%,#6a5a4a 60%,#3a3020 100%);'
        : 'background:linear-gradient(180deg,#8fb3d4 0%,#d8cfa8 40%,#c9ab68 62%,#8a6c34 100%);');
      add('background:radial-gradient(60% 40% at 62% 40%, rgba(255,216,150,0.5), transparent 72%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 21s ease-in-out infinite alternate;');
      add('background:radial-gradient(130% 100% at 50% 46%, transparent 46%, rgba(30,20,8,0.5) 100%);');
    });
    startAmbience('wind');
  },
  onStop() { lower('wheat'); stopAmbience('wind'); },
  create(x, y, now, api, _kind, _tint, index = 0) {
    const { w, h } = api.viewport;
    /* One stalk per particle. The wave is carried by each stalk's PHASE being a
       function of its x — which is what makes the gust visibly travel across
       the field instead of the whole field twitching at once. */
    const px = (index / 190) * w + rand(-14, 14);
    const depth = Math.random();
    const hh = h * (0.2 + depth * 0.34);
    const el = document.createElement('div');
    baseStyle(
      el, rand(2, 4),
      `height:${hh}px;transform-origin:bottom center;border-radius:2px;` +
        `background:linear-gradient(180deg, rgba(240,214,150,${0.35 + depth * 0.5}), rgba(120,92,40,${0.5 + depth * 0.4}));`
    );
    const p = particle(el, px, h + 4, 3, SIT + 8000, now);
    p.a = px * 0.012;                 // phase from position — this is the wave
    p.b = hh;
    p.c = 3.4 + depth * 5;            // how far this one bends
    p.maxScale = 0.4 + depth * 0.6;
    return p;
  },
  step(p, _t, now) {
    const gust = Math.sin(now * 0.0009 - p.a) * 0.6 + Math.sin(now * 0.00042 - p.a * 0.6) * 0.4;
    p.el.style.transform =
      `translate3d(${p.x}px, ${p.y - p.b}px, 0) rotate(${gust * p.c}deg)`;
    p.el.style.opacity = String(p.maxScale);
  },
};

/* ---------------------------------------------------------------- lavalamp */

const lavalamp: RelaxEffect = {
  id: 'lavalamp',
  label: 'Lava Lamp',
  group: 'Immersion',
  blurb: 'Big soft shapes going up, thinking about it, and coming back down. That is the entire show.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 9,
  spawnEveryMs: 5600,
  spawnPerTick: 1,
  maxParticles: 16,
  onStart(_x, _y, api) {
    raise('lavalamp', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#1a0b2e 0%,#2c1046 44%,#160a24 100%);'
        : 'background:linear-gradient(180deg,#2a1240 0%,#3e1a56 44%,#1c0c2c 100%);');
      add('background:radial-gradient(64% 30% at 50% 108%, rgba(255,140,60,0.34), transparent 70%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 11s ease-in-out infinite alternate;');
      add('background:radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.55) 100%);');
    });
  },
  onStop() { lower('lavalamp'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(120, 300);
    const hue = rand(-14, 26);
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `border-radius:50%;filter:blur(${rand(10, 22).toFixed(0)}px);mix-blend-mode:screen;` +
        `background:radial-gradient(closest-side circle, hsla(${18 + hue},95%,66%,0.95) 0 42%,` +
        ` hsla(${2 + hue},92%,50%,0.5) 72%, transparent 100%);`
    );
    const p = particle(el, rand(w * 0.08, w * 0.92), h + size * 0.4, size, rand(34_000, 62_000), now);
    p.c = h + size;
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00016, 0.00042);
    return p;
  },
  step(p, t, now) {
    /* Up, hesitate, down. `sin(t*PI)` is the shape — it leaves the bottom, rests
       at the top of its arc, and returns, which is what wax actually does. */
    const rise = Math.sin(t * Math.PI) * p.c * 0.86;
    const sway = Math.sin(now * p.b + p.a) * 40;
    const squash = 1 + Math.sin(now * p.b * 2.2 + p.a) * 0.09;
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2 + sway}px, ${p.y - p.size / 2 - rise}px, 0) scale(${squash}, ${2 - squash})`;
    p.el.style.opacity = String(Math.min(1, t * 7) * Math.min(1, (1 - t) * 7) * 0.85);
  },
};

/* ------------------------------------------------------------ blossomstorm */

const blossomstorm: RelaxEffect = {
  id: 'blossomstorm',
  label: 'Blossom Storm',
  group: 'Immersion',
  blurb: 'The whole screen going under in petals, three depths of them, for two minutes.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 90,
  spawnEveryMs: 190,
  spawnPerTick: 3,
  maxParticles: 300,
  onStart(_x, _y, api) {
    raise('blossomstorm', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#3a1c34 0%,#5e2a44 40%,#2a1424 100%);'
        : 'background:linear-gradient(180deg,#f6cdd8 0%,#dda2b6 40%,#8a5a72 100%);');
      add('background:radial-gradient(80% 50% at 50% 0%, rgba(255,224,236,0.5), transparent 72%);' +
        'mix-blend-mode:screen;');
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 46%, rgba(40,10,28,0.45) 100%);');
    });
    startAmbience('wind');
  },
  onStop() { lower('blossomstorm'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w } = api.viewport;
    const depth = Math.random();
    const size = 9 + depth * 16;
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `height:${size * 0.72}px;border-radius:76% 24% 70% 30% / 34% 70% 30% 66%;` +
        `filter:blur(${(0.5 + (1 - depth) * 2.4).toFixed(1)}px);` +
        'background:radial-gradient(circle at 26% 24%, #ffeef4 0 10%, #f7c4d8 44%, #e087ab 88%);'
    );
    const p = particle(el, rand(-60, w + 60), rand(-140, -20), size, rand(9000, 17_000) / (0.5 + depth), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.0009, 0.0022);
    p.c = rand(60, 180);
    p.maxScale = 0.3 + depth * 0.7;
    return p;
  },
  step(p, t, now, api) {
    const fall = t * (api.viewport.h + 220);
    const sway = Math.sin(now * p.b + p.a) * p.c;
    /* Rock, don't tumble. Swept fully edge-on a petal is a two-pixel line for
       several frames, which reads as a white card flipping rather than a petal
       turning — the same trap the bloom effects document. */
    const rock = Math.sin(now * p.b * 0.9 + p.a) * 62;
    const spin = (now * p.b * 34 + p.a * 40) % 360;
    p.el.style.transform =
      `translate3d(${p.x + sway}px, ${p.y + fall}px, 0) rotate(${spin}deg) rotate3d(1, 0.4, 0, ${rock}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 10) * Math.min(1, (1 - t) * 6) * p.maxScale);
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
  openingPop: 10,
  spawnEveryMs: 3800,
  spawnPerTick: 1,
  maxParticles: 22,
  onStart(_x, _y, api) {
    raise('fogbank', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#2c3238 0%,#3e464e 46%,#20262c 100%);'
        : 'background:linear-gradient(180deg,#b8c2c8 0%,#98a4ac 48%,#67727a 100%);');
      add('background:repeating-linear-gradient(184deg, rgba(255,255,255,0.05) 0 40px, transparent 40px 130px);' +
        'filter:blur(20px);animation:relaxCrawlA 70s linear infinite;');
      add('background:radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(30,36,40,0.5) 100%);');
    });
    startAmbience('wind');
  },
  onStop() { lower('fogbank'); stopAmbience('wind'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(320, 780);
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `height:${size * rand(0.2, 0.36)}px;border-radius:50%;filter:blur(${rand(28, 52).toFixed(0)}px);` +
        'background:radial-gradient(closest-side ellipse, rgba(246,250,252,0.95), transparent 70%);'
    );
    const p = particle(el, -size, rand(h * 0.1, h * 0.94), size, rand(38_000, 78_000), now);
    p.c = w + size * 2;
    p.maxScale = rand(0.42, 0.9);
    return p;
  },
  step(p, t) {
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y - p.size / 2}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 6) * p.maxScale);
  },
};

/* ---------------------------------------------------------------- citynight */

const citynight: RelaxEffect = {
  id: 'citynight',
  label: 'City at Night',
  group: 'Immersion',
  blurb: 'Somebody else’s window, seen out of focus. A whole city doing its evening without you.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 34,
  spawnEveryMs: 1500,
  spawnPerTick: 1,
  maxParticles: 70,
  onStart(_x, _y, api) {
    raise('citynight', api, (add) => {
      add('background:linear-gradient(180deg,#0a1024 0%,#141c34 42%,#241c30 74%,#0d0a14 100%);');
      add('bottom:0;top:auto;height:34%;' +
        'background:linear-gradient(180deg, transparent, rgba(255,170,90,0.18) 60%, rgba(255,140,60,0.26));' +
        'mix-blend-mode:screen;filter:blur(14px);');
      add('background:radial-gradient(120% 100% at 50% 40%, transparent 38%, rgba(0,0,0,0.6) 100%);');
    });
  },
  onStop() { lower('citynight'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* Bokeh: the size and the blur go UP together as the light gets further out
       of focus, and the opacity goes down. Get that backwards and it reads as a
       balloon rather than a light. */
    const blurAmt = rand(3, 22);
    const size = 12 + blurAmt * 2.6;
    const tint = pick(['255,196,120', '255,236,190', '150,200,255', '255,150,120', '190,255,220']);
    const p = mote(
      rand(-40, w + 40), rand(h * 0.1, h * 0.98), now,
      `height:${size}px;border-radius:50%;filter:blur(${blurAmt.toFixed(0)}px);mix-blend-mode:screen;` +
        `background:radial-gradient(circle, rgba(${tint},0.95) 0 42%, rgba(${tint},0.24) 72%, transparent 100%);`,
      size, rand(16_000, 34_000)
    );
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00018, 0.0006);
    p.maxScale = 0.9 - blurAmt * 0.028;
    return p;
  },
  step(p, t, now) {
    const dx = Math.sin(now * p.b + p.a) * 40;
    const dy = Math.cos(now * p.b * 0.7 + p.a) * 26;
    p.el.style.transform = `translate3d(${p.x + dx - p.size / 2}px, ${p.y + dy - p.size / 2}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.min(1, (1 - t) * 5) * p.maxScale);
  },
};

/* ---------------------------------------------------------------- meteors */

const meteors: RelaxEffect = {
  id: 'meteors',
  label: 'Meteor Shower',
  group: 'Immersion',
  blurb: 'Wait, and then several at once, and then wait again. That is how they actually come.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 6,
  spawnEveryMs: 460,
  spawnPerTick: 1,
  maxParticles: 40,
  onStart(_x, _y, api) {
    raise('meteors', api, (add) => {
      add('background:radial-gradient(140% 110% at 70% 0%, #10162e 0%, #070b1c 46%, #02030a 100%);');
      add(RELAX_STARFIELD);
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 44%, rgba(0,0,0,0.5) 100%);');
    });
    startAmbience('drone');
  },
  onStop() { lower('meteors'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const len = rand(180, 520);
    const el = document.createElement('div');
    baseStyle(
      el, len,
      'height:3px;border-radius:3px;mix-blend-mode:screen;' +
        'background:linear-gradient(90deg, transparent, rgba(190,214,255,0.6) 40%, rgba(236,244,255,0.98) 86%, #fff);' +
        'box-shadow:0 0 20px 3px rgba(190,215,255,0.95), 0 0 44px 8px rgba(140,180,255,0.5);'
    );
    /* They come from one radiant, the way a real shower does — a sky of streaks
       all going different ways reads as a screensaver. */
    const p = particle(el, rand(w * 0.5, w * 1.15), rand(-h * 0.25, h * 0.4), len, rand(1300, 2400), now);
    p.a = rand(2.5, 2.85);
    p.c = rand(500, 1100);
    return p;
  },
  step(p, t) {
    const e = 1 - Math.pow(1 - t, 1.5);
    const d = e * p.c;
    p.el.style.transform =
      `translate3d(${p.x + Math.cos(p.a) * d}px, ${p.y - Math.sin(p.a) * d * -1}px, 0) rotate(${(p.a * 180) / Math.PI}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.pow(1 - t, 0.8));
  },
};

/* -------------------------------------------------------------------- silk */

const silk: RelaxEffect = {
  id: 'silk',
  label: 'Silk',
  group: 'Immersion',
  blurb: 'Long ribbons of colour, crossing and folding. Nothing means anything and that is the point.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 7,
  spawnEveryMs: 3200,
  spawnPerTick: 1,
  maxParticles: 18,
  onStart(_x, _y, api) {
    raise('silk', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(150deg,#0e1024 0%,#1a1234 50%,#080a18 100%);'
        : 'background:linear-gradient(150deg,#151a34 0%,#241a44 50%,#0c0e1e 100%);');
      add('background:radial-gradient(120% 100% at 50% 50%, transparent 42%, rgba(0,0,0,0.5) 100%);');
    });
  },
  onStop() { lower('silk'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const hue = rand(0, 360);
    const len = rand(w * 0.7, w * 1.5);
    const el = document.createElement('div');
    baseStyle(
      el, len,
      `height:${rand(50, 150).toFixed(0)}px;border-radius:50%;mix-blend-mode:screen;` +
        `filter:blur(${rand(16, 38).toFixed(0)}px);` +
        `background:linear-gradient(90deg, transparent, hsla(${hue},88%,62%,0.55) 30%,` +
        ` hsla(${(hue + 48) % 360},88%,66%,0.6) 55%, hsla(${(hue + 96) % 360},88%,60%,0.4) 78%, transparent);`
    );
    const p = particle(el, -len * 0.4, rand(h * 0.05, h * 0.95), len, rand(26_000, 48_000), now);
    p.c = w + len;
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00022, 0.00058);
    return p;
  },
  step(p, t, now) {
    // The fold: a ribbon twists as it travels, so it thins and fattens.
    const twist = 0.35 + Math.abs(Math.sin(now * p.b + p.a)) * 0.9;
    const lift = Math.sin(now * p.b * 1.3 + p.a) * 60;
    p.el.style.transform =
      `translate3d(${p.x + t * p.c * 0.6}px, ${p.y + lift}px, 0) rotate(${Math.sin(now * p.b + p.a) * 9}deg) scaleY(${twist})`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.min(1, (1 - t) * 5) * 0.7);
  },
};

/* -------------------------------------------------------------- sandgarden */

const sandgarden: RelaxEffect = {
  id: 'sandgarden',
  label: 'Raked Sand',
  group: 'Immersion',
  blurb: 'Rings raked round a stone, breathing in and out. Somebody spent an hour on this and then left.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 14,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 20,
  onStart(_x, _y, api) {
    raise('sandgarden', api, (add) => {
      add(api.isDark
        ? 'background:radial-gradient(120% 100% at 50% 40%, #4a4438 0%, #2c2820 52%, #16140f 100%);'
        : 'background:radial-gradient(120% 100% at 50% 40%, #ded3b8 0%, #c2b492 52%, #97886a 100%);');
      add('background:radial-gradient(rgba(0,0,0,0.10) 0.6px, transparent 0.8px);background-size:4px 4px;');
      add('background:radial-gradient(120% 100% at 50% 44%, transparent 42%, rgba(20,16,8,0.45) 100%);');
    });
  },
  onStop() { lower('sandgarden'); },
  create(x, y, now, api, _kind, _tint, index = 0) {
    const { w, h } = api.viewport;
    const el = document.createElement('div');
    const size = 120;
    baseStyle(
      el, size,
      `height:${size * 0.6}px;border-radius:50%;` +
        (api.isDark
          ? 'border:3px solid rgba(226,214,184,0.24);box-shadow:0 2px 0 rgba(0,0,0,0.28);'
          : 'border:3px solid rgba(255,252,242,0.7);box-shadow:0 2px 0 rgba(120,104,72,0.3);')
    );
    const p = particle(el, w / 2, h * 0.5, size, SIT + 8000, now);
    /* The ring's NUMBER is what makes it a ring and not a hoop. Rolling a random
       radius here gave sixteen rings all the same size sitting on top of each
       other, which is one thick oval. */
    p.b = index;
    p.a = 1 + rand(-0.03, 0.03);
    return p;
  },
  step(p, _t, now, api) {
    /* Every ring shares one breath and differs only by its index, which is what
       makes the garden read as one figure rather than sixteen hoops. */
    const idx = p.b;
    const breathe = 1 + Math.sin(now * 0.00028 + idx * 0.8) * 0.045;
    const { w, h } = api.viewport;
    const scale = (0.24 + idx * 0.42) * p.a * breathe;
    p.el.style.transform =
      `translate3d(${w / 2 - p.size / 2}px, ${h * 0.5 - p.size * 0.3}px, 0) scale(${scale})`;
    p.el.style.opacity = '1';
  },
};

/* ---------------------------------------------------------------- moonrise */

const moonrise: RelaxEffect = {
  id: 'moonrise',
  label: 'Moonrise',
  group: 'Immersion',
  blurb: 'One moon, climbing the whole two minutes, with cloud crossing it now and then.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 5,
  spawnEveryMs: 7000,
  spawnPerTick: 1,
  maxParticles: 12,
  onStart(_x, _y, api) {
    raise('moonrise', api, (add) => {
      add('background:linear-gradient(180deg,#050a1c 0%,#0d1630 44%,#1a2440 72%,#070c1a 100%);');
      add(RELAX_STARFIELD);
      // The moon itself, climbing. One long transform over the whole sitting.
      add('background:radial-gradient(circle at 50% 50%, #f6f2e2 0 3.6%, rgba(238,232,210,0.9) 4.4%,' +
        ' rgba(214,222,236,0.28) 7%, transparent 16%);' +
        'mix-blend-mode:screen;animation:relaxMoonClimb 120s linear forwards;');
      add('background:radial-gradient(120% 100% at 50% 50%, transparent 42%, rgba(0,0,0,0.55) 100%);');
    });
    startAmbience('drone');
  },
  onStop() { lower('moonrise'); stopAmbience('drone'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(300, 700);
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `height:${size * rand(0.14, 0.24)}px;border-radius:50%;filter:blur(${rand(18, 34).toFixed(0)}px);` +
        'background:radial-gradient(closest-side ellipse, rgba(190,206,232,0.5), transparent 74%);'
    );
    const p = particle(el, -size, rand(h * 0.08, h * 0.7), size, rand(30_000, 60_000), now);
    p.c = w + size * 2;
    return p;
  },
  step(p, t) {
    p.el.style.transform = `translate3d(${p.x + t * p.c}px, ${p.y}px, 0)`;
    p.el.style.opacity = String(Math.min(1, t * 6) * Math.min(1, (1 - t) * 6) * 0.5);
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
  openingPop: 80,
  spawnEveryMs: 200,
  spawnPerTick: 4,
  maxParticles: 300,
  onStart(_x, _y, api) {
    raise('bioluminescence', api, (add) => {
      add('background:linear-gradient(180deg,#040a16 0%,#071426 44%,#0a1c30 68%,#04101c 100%);');
      add('top:56%;bottom:0;' +
        'background:repeating-linear-gradient(179deg, rgba(80,190,230,0.09) 0 2px, transparent 2px 30px);' +
        'animation:relaxCrawlA 44s linear infinite;');
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 44%, rgba(0,4,10,0.6) 100%);');
    });
    startAmbience('ocean');
  },
  onStop() { lower('bioluminescence'); stopAmbience('ocean'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    /* Plankton light in PATCHES — the whole shoreline flaring evenly would look
       like a strip light. Each spawn picks a wandering centre and clusters near
       it, so the glow travels along the surf. */
    const cx = (Math.sin(now * 0.00016) * 0.5 + 0.5) * w;
    const px = cx + rand(-w * 0.3, w * 0.3);
    const s = rand(4, 13);
    const p = mote(
      px, rand(h * 0.56, h * 0.99), now,
      `height:${s}px;border-radius:50%;mix-blend-mode:screen;` +
        'background:radial-gradient(circle, #eafeff 0 30%, #5cd6ff 58%, rgba(40,150,220,0.3) 100%);' +
        'box-shadow:0 0 18px 6px rgba(90,214,255,0.95), 0 0 40px 12px rgba(50,160,230,0.45);',
      s, rand(1800, 4200)
    );
    p.a = rand(0, Math.PI * 2);
    return p;
  },
  step(p, t, now) {
    const drift = Math.sin(now * 0.0009 + p.a) * 12;
    p.el.style.transform = `translate3d(${p.x + drift}px, ${p.y}px, 0) scale(${0.5 + Math.sin(t * Math.PI) * 0.8})`;
    p.el.style.opacity = String(Math.sin(t * Math.PI) * 0.85);
  },
};

/* --------------------------------------------------------------- steamroom */

const steamroom: RelaxEffect = {
  id: 'steamroom',
  label: 'Steam',
  group: 'Immersion',
  blurb: 'Warm, wet air rolling past. You cannot see very far and you do not need to.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 14,
  spawnEveryMs: 1400,
  spawnPerTick: 1,
  maxParticles: 34,
  onStart(_x, _y, api) {
    raise('steamroom', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#2e2a2c 0%,#3e3634 46%,#221e1e 100%);'
        : 'background:linear-gradient(180deg,#d8cfc8 0%,#bfb2a8 48%,#8e8078 100%);');
      add('background:radial-gradient(60% 44% at 34% 22%, rgba(255,226,190,0.4), transparent 70%);' +
        'mix-blend-mode:screen;animation:relaxImmBreath 17s ease-in-out infinite alternate;');
      add('background:radial-gradient(120% 100% at 50% 50%, transparent 34%, rgba(30,24,22,0.5) 100%);');
    });
  },
  onStop() { lower('steamroom'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const size = rand(220, 560);
    const el = document.createElement('div');
    baseStyle(
      el, size,
      `border-radius:50%;filter:blur(${rand(16, 34).toFixed(0)}px);` +
        'background:radial-gradient(closest-side circle at 38% 34%, rgba(255,252,248,0.95) 0 18%,' +
        ' rgba(255,248,242,0.42) 46%, rgba(210,196,186,0.18) 70%, transparent 84%);'
    );
    const p = particle(el, rand(-80, w + 80), h + size * 0.3, size, rand(16_000, 32_000), now);
    p.a = rand(0, Math.PI * 2);
    p.b = rand(0.00024, 0.0007);
    p.c = h + size;
    p.maxScale = rand(0.18, 0.42);
    return p;
  },
  step(p, t, now) {
    const rise = t * p.c * 0.9;
    const roll = Math.sin(now * p.b + p.a) * 70;
    p.el.style.transform =
      `translate3d(${p.x - p.size / 2 + roll}px, ${p.y - p.size / 2 - rise}px, 0) scale(${0.6 + t * 0.9})`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.min(1, (1 - t) * 3) * p.maxScale);
  },
};

/* ------------------------------------------------------------------- prism */

const prism: RelaxEffect = {
  id: 'prism',
  label: 'Prism',
  group: 'Immersion',
  blurb: 'White light taken apart very slowly, and the spectrum walking across the wall.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 6,
  spawnEveryMs: 4400,
  spawnPerTick: 1,
  maxParticles: 14,
  onStart(_x, _y, api) {
    raise('prism', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(160deg,#16161c 0%,#0d0d12 60%,#070709 100%);'
        : 'background:linear-gradient(160deg,#e6e2da 0%,#cac4ba 58%,#9e988e 100%);');
      add('background:radial-gradient(120% 100% at 30% 10%, rgba(255,255,255,0.16), transparent 62%);');
      add('background:radial-gradient(120% 100% at 50% 46%, transparent 46%, rgba(0,0,0,0.4) 100%);');
    });
  },
  onStop() { lower('prism'); },
  create(x, y, now, api) {
    const { w, h } = api.viewport;
    const len = rand(h * 0.5, h * 1.1);
    const el = document.createElement('div');
    baseStyle(
      el, rand(70, 190),
      `height:${len.toFixed(0)}px;filter:blur(${rand(8, 20).toFixed(0)}px);` +
        (api.isDark ? 'mix-blend-mode:screen;' : 'mix-blend-mode:multiply;') +
        'background:linear-gradient(90deg, transparent, rgba(255,60,60,0.5) 12%, rgba(255,190,50,0.5) 28%,' +
        ' rgba(120,230,90,0.5) 44%, rgba(70,190,255,0.5) 62%, rgba(140,90,255,0.5) 80%, transparent);'
    );
    const p = particle(el, rand(-100, w), rand(-h * 0.2, h * 0.3), len, rand(20_000, 38_000), now);
    p.a = rand(-26, 26);
    p.c = rand(160, 460);
    return p;
  },
  step(p, t) {
    // A spectrum walks; it does not fly. Two minutes and it has crossed a wall.
    p.el.style.transform =
      `translate3d(${p.x + t * p.c}px, ${p.y}px, 0) rotate(${p.a}deg)`;
    p.el.style.opacity = String(Math.min(1, t * 5) * Math.min(1, (1 - t) * 5) * 0.6);
  },
};

/* ---------------------------------------------------------------- wisteria */

const wisteria: RelaxEffect = {
  id: 'wisteria',
  label: 'Wisteria',
  group: 'Immersion',
  blurb: 'Racemes hanging the whole width of the screen, moving when the air does, dropping the odd flower.',
  space: 'screen',
  flash: '',
  burstMs: SIT,
  openingPop: 26,
  spawnEveryMs: 900,
  spawnPerTick: 1,
  maxParticles: 90,
  onStart(_x, _y, api) {
    raise('wisteria', api, (add) => {
      add(api.isDark
        ? 'background:linear-gradient(180deg,#241a3a 0%,#38285a 42%,#1a1230 100%);'
        : 'background:linear-gradient(180deg,#c9bce0 0%,#a894cc 40%,#6a5a90 100%);');
      add('background:radial-gradient(80% 40% at 50% 4%, rgba(255,244,220,0.4), transparent 70%);' +
        'mix-blend-mode:screen;');
      // The canopy the racemes hang from.
      add('top:0;height:20%;bottom:auto;filter:blur(9px);opacity:0.85;' +
        'background:radial-gradient(closest-side ellipse, #2a3a1e 0 72%, transparent 100%) 10% 40%/28% 130% no-repeat,' +
        'radial-gradient(closest-side ellipse, #1e2c16 0 72%, transparent 100%) 42% 60%/32% 150% no-repeat,' +
        'radial-gradient(closest-side ellipse, #2a3a1e 0 72%, transparent 100%) 76% 44%/30% 140% no-repeat;');
      add('background:radial-gradient(120% 100% at 50% 40%, transparent 46%, rgba(20,10,34,0.5) 100%);');
    });
    startAmbience('wind');
  },
  onStop() { lower('wisteria'); stopAmbience('wind'); },
  create(x, y, now, api, _kind, _tint, index = 0) {
    const { w, h } = api.viewport;
    if (index < 0) { /* keeps index in the signature for the racemes below */ }

    // Two species: the hanging racemes, and the flowers that let go of them.
    if (Math.random() < 0.22 || index >= 26) {
      const s = rand(7, 13);
      const el = document.createElement('div');
      baseStyle(
        el, s,
        `height:${s * 0.85}px;border-radius:70% 30% 66% 34% / 34% 70% 30% 66%;` +
          'background:radial-gradient(circle at 30% 28%, #f0e6ff 0 14%, #c9a8ee 52%, #8e63c4 94%);'
      );
      const p = particle(el, rand(0, w), rand(h * 0.06, h * 0.3), s, rand(7000, 13_000), now);
      p.kind = 1;
      p.a = rand(0, Math.PI * 2);
      p.b = rand(0.0011, 0.0026);
      return p;
    }

    const len = h * rand(0.24, 0.52);
    const el = document.createElement('div');
    baseStyle(
      el, rand(22, 40),
      `height:${len.toFixed(0)}px;transform-origin:top center;border-radius:0 0 50% 50%;` +
        'background:' +
        'radial-gradient(closest-side circle, rgba(216,196,246,0.95) 0 46%, transparent 100%) 30% 6%/46% 9% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(196,168,236,0.95) 0 46%, transparent 100%) 66% 16%/44% 8% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(178,148,224,0.95) 0 46%, transparent 100%) 34% 28%/42% 8% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(160,130,214,0.9) 0 46%, transparent 100%) 62% 40%/40% 7% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(146,116,202,0.9) 0 46%, transparent 100%) 38% 54%/36% 7% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(132,104,190,0.85) 0 46%, transparent 100%) 56% 68%/32% 6% no-repeat,' +
        'radial-gradient(closest-side circle, rgba(120,94,178,0.8) 0 46%, transparent 100%) 44% 82%/26% 5% no-repeat;' +
        `filter:blur(${rand(0.2, 1.4).toFixed(1)}px);`
    );
    const p = particle(el, (index / 26) * w + rand(-20, 20), rand(-10, h * 0.1), len, SIT + 8000, now);
    p.kind = 0;
    p.a = p.x * 0.01;
    p.c = 2.4 + Math.random() * 3.4;
    return p;
  },
  step(p, t, now, api) {
    if (p.kind === 1) {
      const fall = t * (api.viewport.h * 0.9);
      p.el.style.transform =
        `translate3d(${p.x + Math.sin(now * p.b + p.a) * 46}px, ${p.y + fall}px, 0) rotate(${now * p.b * 40 % 360}deg)`;
      p.el.style.opacity = String(Math.min(1, t * 8) * Math.min(1, (1 - t) * 4) * 0.9);
      return;
    }
    const sway = Math.sin(now * 0.00072 - p.a) * 0.7 + Math.sin(now * 0.00031 - p.a * 0.7) * 0.3;
    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${sway * p.c}deg)`;
    p.el.style.opacity = '0.92';
  },
};

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers, blooming, petalfall, rain, fireworks, galaxy, bubblewrap, chimes,
  ripples, ocean, handpan, snow, fireflies, lanterns, gate, breathing, aurora,
  koi, ink, soap, glassrain, dandelion, kaleido, stones, embers, jellyfish, candles,
  stargaze, tide, clouds, duskwash, deepwater, godrays, shoji, wheat, lavalamp, blossomstorm,
  fogbank, citynight, meteors, silk, sandgarden, moonrise, bioluminescence, steamroom, prism, wisteria,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  /* Ordered by group, so the picker can render them in shelves without having
     to sort at render time. */
  stargaze, moonrise, meteors, duskwash, clouds, fogbank, tide, deepwater,
  bioluminescence, godrays, shoji, wheat, blossomstorm, wisteria, sandgarden,
  citynight, silk, lavalamp, prism, steamroom,
  ocean, ripples, rain, koi, ink, glassrain, jellyfish,
  blooming, flowers, petalfall, fireflies, dandelion,
  aurora, galaxy, snow, fireworks,
  lanterns, embers, candles,
  bubblewrap, soap, kaleido,
  gate, breathing, handpan, chimes, stones,
];
