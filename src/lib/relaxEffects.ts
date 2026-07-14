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
  playPop,
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
  | 'rain'
  | 'fireworks'
  | 'galaxy'
  | 'bubbles'
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
  | 'aurora';

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
}

export interface RelaxEffect {
  id: RelaxEffectId;
  label: string;
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

/* --------------------------------------------------------------------- rain */

/** Every timer the storm owns, so onStop can kill the lot. */
let stormTimers: number[] = [];

const rain: RelaxEffect = {
  id: 'rain',
  label: 'Rainfall',
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

/* ------------------------------------------------------------------- galaxy */

const GALAXY_COLORS = ['#B892FF', '#8093F1', '#72DDF7', '#F7AEF8', '#FFD6A5', '#FFFFFF'];

const galaxy: RelaxEffect = {
  id: 'galaxy',
  label: 'Galaxy Swirl',
  blurb: 'A spiral galaxy unwinds from your cursor — stars sweep out along its arms and fade into deep space.',
  space: 'world',
  flash: 'rgba(184, 146, 255, 0.55)',
  burstMs: 10_000,
  openingPop: 70,
  spawnEveryMs: 55,
  spawnPerTick: 4,
  maxParticles: 900,
  create(x, y, now) {
    const color = pick(GALAXY_COLORS);
    const size = rand(2.5, 7);
    const el = document.createElement('div');
    baseStyle(el, size, `border-radius:50%;background:${color};box-shadow:0 0 ${size * 2.5}px ${size / 2}px ${color}99;`);

    const p = particle(el, x, y, size, rand(4000, 7000), now);
    // Two arms. The jitter has to stay tight — widen it and the arms wash out
    // into a featureless disc.
    const arm = Math.random() < 0.5 ? 0 : Math.PI;
    p.a = arm + rand(-0.2, 0.2); // angle
    p.b = rand(4, 22); // radius — start near the core so the arms have a root
    p.c = rand(0.3, 0.75); // radial growth
    // Total sweep over a lifetime lands around 2 radians. Much more than that and
    // each arm wraps the core several times and you're back to a disc.
    p.d = rand(0.045, 0.085);
    return p;
  },
  step(p, t) {
    p.b += p.c; // spiral outward
    // Keplerian-ish: the further out, the slower the sweep. This differential is
    // the whole trick — it's what bends straight radial spokes into arms.
    // Direction is fixed, not per-particle: randomise it and half the stars
    // counter-rotate and shred the arms.
    p.a += p.d / Math.sqrt(p.b);

    const gx = p.x + Math.cos(p.a) * p.b;
    // Squash the orbit vertically so the disc reads as tilted, not head-on.
    const gy = p.y + Math.sin(p.a) * p.b * 0.45;

    const scale = popIn(t, 0.1);
    p.el.style.transform = `translate3d(${gx - p.size / 2}px, ${gy - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String(t < 0.08 ? t / 0.08 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1);
  },
};

/* -------------------------------------------------------------- bubble pop */

const BUBBLE = 0;
const SHARD = 1;

const bubbles: RelaxEffect = {
  id: 'bubbles',
  label: 'Bubble Pop',
  blurb: 'A handful of bubbles drift up across the screen. Hunt down every last one — each bursts with a satisfying little thup.',
  space: 'screen',
  flash: '',
  // Sparse and slow on purpose. The satisfaction is in clearing the screen, and
  // you can't clear a screen that refills faster than you can pop it — so only a
  // few are ever in play, and they hang around long enough to be caught.
  burstMs: 45_000,
  openingPop: 9,
  spawnEveryMs: 2200,
  spawnPerTick: 1,
  maxParticles: 30,
  interactive: true,
  create(x, y, now, api, kind = BUBBLE, tint) {
    if (kind === SHARD) {
      const size = rand(3, 8);
      const el = document.createElement('div');
      baseStyle(el, size, `border-radius:50%;background:${tint ?? 'rgba(200,235,255,0.85)'};`);
      const p = particle(el, x, y, size, rand(340, 620), now);
      p.kind = SHARD;
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(2, 7);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.a = 0.18;
      return p;
    }

    const size = rand(40, 96);
    const el = document.createElement('div');
    // Background-agnostic by construction. Rather than painting a pale bubble and
    // hoping the canvas behind it is dark, this refracts whatever is actually
    // there: backdrop-filter bends and brightens the background, the rim is drawn
    // in both a dark and a light stroke so one of them always has contrast, and
    // the fill is mostly transparent. It reads on the cream paper and on the dark
    // board without changing a thing. Affordable because only ~30 exist at once.
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        'backdrop-filter:blur(2px) saturate(1.5) brightness(1.08);' +
        '-webkit-backdrop-filter:blur(2px) saturate(1.5) brightness(1.08);' +
        'border:1px solid rgba(255,255,255,0.55);' +
        'background:radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75), rgba(255,255,255,0.06) 34%,' +
        ' rgba(120,200,255,0.14) 55%, rgba(255,150,230,0.16) 74%, rgba(160,255,225,0.10) 90%);' +
        'box-shadow:inset -6px -8px 18px rgba(70,110,160,0.28), inset 6px 8px 20px rgba(255,255,255,0.40),' +
        ' 0 0 14px rgba(140,200,255,0.30), 0 2px 10px rgba(0,0,0,0.16);'
    );

    // Spread across the viewport rather than piling up on the cursor — the point
    // is to give the user a screen full of targets to hunt down.
    const { w, h } = api.viewport;
    const px = x + rand(-w * 0.42, w * 0.42);
    const py = y + rand(-h * 0.3, h * 0.34);
    const p = particle(
      el,
      Math.min(w - size, Math.max(0, px)),
      Math.min(h - size, Math.max(0, py)),
      size,
      rand(17000, 27000),
      now
    );
    p.kind = BUBBLE;
    p.vx = rand(-0.35, 0.35);
    p.a = rand(-0.55, -0.16); // rise rate
    p.b = rand(12, 34); // wobble amplitude
    p.c = rand(0.35, 0.9); // wobble frequency
    p.d = rand(0, Math.PI * 2);
    return p;
  },
  step(p, t) {
    if (p.kind === SHARD) {
      p.vy += p.a;
      p.x += p.vx;
      p.y += p.vy;
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${1 - t})`;
      p.el.style.opacity = String(1 - t);
      return;
    }

    p.x += p.vx;
    p.y += p.a;

    const wobble = Math.sin(t * p.c * Math.PI * 2 * 6 + p.d) * p.b;
    const breathe = 1 + Math.sin(t * 26 + p.d) * 0.03;
    const scale = popIn(t, 0.12) * breathe;

    p.el.style.transform = `translate3d(${p.x + wobble}px, ${p.y}px, 0) scale(${scale})`;
    // Hold full opacity almost the whole way: a bubble you can click has to stay
    // clearly visible, and it should only start ghosting once it's nearly gone.
    p.el.style.opacity = String(t > 0.88 ? (1 - t) / 0.12 : Math.min(1, t * 10));
  },
  onPop(p, api) {
    playPop(p.size);
    api.spawn(p.x + p.size / 2, p.y + p.size / 2, 9, SHARD);
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
  create(x, y, now) {
    const el = document.createElement('div');
    const size = 40;
    baseStyle(
      el,
      size,
      'border-radius:50%;border:2px solid rgba(160,215,255,0.85);' +
        'box-shadow:0 0 18px rgba(150,210,255,0.35), inset 0 0 18px rgba(190,235,255,0.25);'
    );

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
    baseStyle(
      el,
      size,
      'border-radius:50%;background:rgba(255,255,255,0.92);' +
        'box-shadow:0 0 6px rgba(255,255,255,0.7);'
    );

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
const GLOW = 1;

const fireflies: RelaxEffect = {
  id: 'fireflies',
  label: 'Fireflies',
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

    const color = pick(FIREFLY_COLORS);
    const size = rand(9, 15);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        `background:radial-gradient(circle at 50% 50%, #ffffff 0%, ${color} 40%, ${color}00 72%);` +
        `box-shadow:0 0 16px 4px ${color}88;`
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
    if (kind === 1) {
      const size = rand(3, 7);
      const el = document.createElement('div');
      baseStyle(el, size, 'border-radius:50%; background:rgba(215,235,255,0.7); box-shadow:0 0 8px rgba(200,225,255,0.5);');
      const p = particle(el, rand(w * 0.2, w * 0.8), h - rand(40, 120), size, rand(4000, 6000), now);
      p.kind = 1;
      p.vx = rand(-0.2, 0.2);
      p.vy = rand(-0.6, -1.2);
      return p;
    }

    const size = 180;
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      'border-radius:50%; border: 1.5px solid rgba(255, 255, 255, 0.45);' +
        'background: radial-gradient(circle, rgba(235,245,255,0.12) 0%, rgba(200,220,255,0.05) 70%, transparent 100%);' +
        'box-shadow: 0 0 40px rgba(200, 220, 255, 0.2), inset 0 0 30px rgba(255, 255, 255, 0.1);' +
        'display: flex; align-items: center; justify-content: center;' +
        'color: rgba(255,255,255,0.9); font-family: "Outfit", sans-serif; font-size: 11px; font-weight: 700;' +
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

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers, rain, fireworks, galaxy, bubbles, bubblewrap, chimes, ripples,
  ocean, handpan, snow, fireflies, lanterns, gate, breathing, aurora,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  gate, ocean, aurora, breathing, handpan, chimes,
  flowers, fireworks, lanterns, fireflies, galaxy, ripples,
  bubbles, bubblewrap, rain, snow,
];
