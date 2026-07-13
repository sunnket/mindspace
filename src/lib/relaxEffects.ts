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
  PENTATONIC,
  playBell,
  playBoom,
  playChime,
  playHandpan,
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
  | 'ink'
  | 'ripples'
  | 'ocean'
  | 'handpan'
  | 'snow'
  | 'fireflies'
  | 'lanterns';

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

/* ---------------------------------------------------------------------- ink */

const INK_COLORS = ['#6DD3FF', '#B48CFF', '#FF7BC8', '#5AE6C0', '#FFC46B', '#8FA3FF'];

const ink: RelaxEffect = {
  id: 'ink',
  label: 'Ink Bloom',
  blurb: 'Drop ink into still water and watch it unfurl. Deep, slow, and impossible to rush.',
  space: 'world',
  flash: '',
  burstMs: 0,
  openingPop: 18,
  spawnEveryMs: 0,
  spawnPerTick: 0,
  maxParticles: 220,
  onBurst() {
    playPlop();
  },
  create(x, y, now) {
    // Luminous ink, not black ink. Real ink would vanish against the dark canvas;
    // this reads like dye lit from behind, which works on either background.
    const color = pick(INK_COLORS);
    const size = rand(34, 96);
    const el = document.createElement('div');
    // The edge falls off fast. Soften it further and the clouds all melt into one
    // featureless glow instead of reading as separate plumes drifting apart.
    baseStyle(
      el,
      size,
      'border-radius:50%;mix-blend-mode:screen;' +
        `background:radial-gradient(circle at 50% 50%, ${color}E6 0%, ${color}A0 36%, ${color}42 62%, transparent 78%);`
    );

    const p = particle(el, x + rand(-26, 26), y + rand(-26, 26), size, rand(4500, 7500), now);
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(0.6, 2.9);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.a = rand(1.5, 2.7); // how far it swells
    p.b = rand(0.25, 0.7); // curl frequency
    p.c = rand(0, Math.PI * 2);
    p.d = rand(-0.4, 0.4); // slow rotation
    return p;
  },
  step(p, t, now) {
    // Ink in still water spreads fast at first and then almost stops. Everything
    // here is decelerating — nothing in this effect is allowed to feel urgent.
    p.vx *= 0.985;
    p.vy *= 0.985;
    const curl = Math.sin(now / 1000 * p.b + p.c) * 0.35;
    p.x += p.vx + curl * 0.4;
    p.y += p.vy + Math.cos(now / 1000 * p.b + p.c) * 0.25;

    const swell = 1 + (1 - Math.pow(1 - t, 2.2)) * p.a;
    const opacity = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 1.7);

    p.el.style.transform =
      `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) ` +
      `rotate(${p.d * t * 90}deg) scale(${swell})`;
    p.el.style.opacity = String(Math.max(0, opacity) * 0.85);
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

const WAVE = 0;
const FOAM = 1;

const ocean: RelaxEffect = {
  id: 'ocean',
  label: 'Ocean Shore',
  blurb: 'Stand at the waterline. Waves roll up the sand, hiss into foam and drain away — for a full minute, with real surf underneath.',
  space: 'screen',
  flash: '',
  burstMs: 60_000,
  openingPop: 2,
  spawnEveryMs: 2600,
  spawnPerTick: 1,
  maxParticles: 140,
  onStart(_x, _y, api) {
    startAmbience('ocean');

    // The water itself: a still band across the bottom that the waves run out of.
    // Without it the crests look like they're arriving from nowhere.
    const sea = document.createElement('div');
    sea.dataset.sea = '';
    sea.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;height:34%;pointer-events:none;opacity:0;' +
      'transition:opacity 1400ms ease;' +
      'background:linear-gradient(180deg, rgba(28,78,120,0) 0%, rgba(30,92,140,0.34) 40%, rgba(24,70,112,0.62) 100%);';
    api.screen.appendChild(sea);
    requestAnimationFrame(() => { sea.style.opacity = '1'; });
  },
  onStop(api) {
    stopAmbience('ocean');
    const sea = api.screen.querySelector<HTMLElement>('[data-sea]');
    if (!sea) return;
    sea.style.opacity = '0';
    window.setTimeout(() => sea.remove(), 1500);
  },
  create(x, y, now, api, kind = WAVE) {
    const { w, h } = api.viewport;

    if (kind === FOAM) {
      const size = rand(3, 9);
      const el = document.createElement('div');
      baseStyle(el, size, 'border-radius:50%;background:rgba(255,255,255,0.85);');
      const p = particle(el, x + rand(-w * 0.5, w * 0.5), y + rand(-6, 10), size, rand(900, 1800), now);
      p.kind = FOAM;
      p.vx = rand(-0.25, 0.25);
      p.vy = rand(-0.12, 0.18);
      return p;
    }

    // A crest: a very wide, very flat ellipse. It is scaled, never resized —
    // width is set once and the whole run happens on the compositor.
    const width = w * rand(1.05, 1.35);
    const el = document.createElement('div');
    baseStyle(
      el,
      width,
      'height:120px;border-radius:50%;' +
        'background:linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(214,238,255,0.55) 22%,' +
        ' rgba(120,180,225,0.30) 55%, rgba(40,100,150,0.10) 100%);' +
        'box-shadow:0 -2px 18px rgba(190,230,255,0.35);'
    );

    const p = particle(el, (w - width) / 2, h, width, rand(9000, 13000), now);
    p.kind = WAVE;
    p.a = rand(0.20, 0.40) * h; // how far up the shore this one reaches
    p.b = rand(0.9, 1.25); // vertical squash — no two crests are the same weight
    p.c = 0; // has it broken yet (foam is thrown once, at the peak)
    return p;
  },
  step(p, t, _now, api) {
    if (p.kind === FOAM) {
      p.x += p.vx;
      p.y += p.vy;
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 - t * 0.6})`;
      p.el.style.opacity = String((1 - t) * 0.8);
      return;
    }

    /* Run up, hold, drain back. The rise is fast and eased-out (a wave arrives in
       a rush) and the retreat is slow and eased-in (it drains reluctantly) — get
       those two the same way round and it reads as a pulsing blob, not the sea. */
    const RISE = 0.34;
    let reach: number;
    if (t < RISE) {
      const k = t / RISE;
      reach = (1 - Math.pow(1 - k, 2.6)) * p.a;
    } else {
      const k = (t - RISE) / (1 - RISE);
      reach = (1 - Math.pow(k, 2.2)) * p.a;
    }

    // At the top of the run the wave breaks — throw the foam once.
    if (p.c === 0 && t >= RISE * 0.9) {
      p.c = 1;
      api.spawn(api.viewport.w / 2, api.viewport.h - reach, 14, FOAM);
    }

    const y = p.y - reach - 60;
    p.el.style.transform = `translate3d(${p.x}px, ${y}px, 0) scaleY(${p.b})`;
    p.el.style.opacity = String(Math.min(1, t * 6) * (t > 0.8 ? (1 - t) / 0.2 : 1) * 0.9);
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

/* -------------------------------------------------------------------------- */

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers, rain, fireworks, galaxy, bubbles, bubblewrap, chimes, ink, ripples,
  ocean, handpan, snow, fireflies, lanterns,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  flowers, rain, fireworks, galaxy, bubbles, bubblewrap, chimes, ink, ripples,
  ocean, handpan, snow, fireflies, lanterns,
];
