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

import { playChime, playPop, startRain, stopRain } from './relaxAudio';

export type RelaxEffectId = 'flowers' | 'rain' | 'fireworks' | 'galaxy' | 'bubbles' | 'ripples';

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
  create: (x: number, y: number, now: number, api: EffectApi, kind?: number, tint?: string) => Particle;
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

const flowers: RelaxEffect = {
  id: 'flowers',
  label: 'Flower Burst',
  blurb: 'Hundreds of blooms pop from your cursor and drift away on the breeze.',
  space: 'world',
  flash: 'rgba(255, 140, 170, 0.55)',
  burstMs: 10_000,
  openingPop: 55,
  spawnEveryMs: 50,
  spawnPerTick: 3,
  maxParticles: 900,
  create(x, y, now) {
    const size = rand(26, 64);
    const el = document.createElement('img');
    (el as HTMLImageElement).src = pick(FLOWER_SVGS);
    (el as HTMLImageElement).alt = '';
    (el as HTMLImageElement).draggable = false;
    baseStyle(el, size, 'filter:drop-shadow(0 3px 5px rgba(0,0,0,0.18));');

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

const rain: RelaxEffect = {
  id: 'rain',
  label: 'Rainfall',
  blurb: 'A downpour sweeps the whole canvas, with real rain on the soundtrack. Lightning cracks once, a couple of seconds in.',
  space: 'screen',
  flash: '',
  burstMs: 12_000,
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

    // The bolt, two seconds in, once per storm.
    window.setTimeout(() => {
      if (!veil.isConnected) return; // storm already over

      const strike = document.createElement('div');
      strike.dataset.lightning = '';
      strike.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;' +
        // thunder.svg is a solid-black potrace trace, so it is used as a mask and
        // lit from behind rather than drawn directly.
        "-webkit-mask:url('/thunder.svg') no-repeat center 12%/70% auto;" +
        "mask:url('/thunder.svg') no-repeat center 12%/70% auto;" +
        'background:linear-gradient(180deg, #ffffff 0%, #dceaff 45%, #9ec5ff 100%);' +
        'filter:drop-shadow(0 0 40px rgba(190, 225, 255, 0.9));';
      api.screen.appendChild(strike);

      const glow = document.createElement('div');
      glow.style.cssText =
        'position:absolute;inset:0;pointer-events:none;opacity:0;' +
        'background:radial-gradient(ellipse at 50% 10%, rgba(215,235,255,0.75), transparent 62%);';
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

      const a1 = strike.animate(flicker, timing);
      const a2 = glow.animate(flicker, timing);
      a1.onfinish = () => strike.remove();
      a1.oncancel = () => strike.remove();
      a2.onfinish = () => glow.remove();
      a2.oncancel = () => glow.remove();
    }, 2000);
  },
  onStop(api) {
    stopRain();
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
  blurb: 'Bubbles drift up across the screen. Pop every one of them — they burst with a satisfying little thup.',
  space: 'screen',
  flash: '',
  burstMs: 9_000,
  openingPop: 14,
  spawnEveryMs: 420,
  spawnPerTick: 2,
  maxParticles: 260,
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

    const size = rand(34, 92);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      'border-radius:50%;cursor:pointer;' +
        'border:1.5px solid rgba(190,225,255,0.75);' +
        'background:radial-gradient(circle at 30% 27%, rgba(255,255,255,0.95), rgba(255,255,255,0.14) 36%,' +
        ' rgba(150,220,255,0.24) 56%, rgba(255,175,240,0.28) 74%, rgba(190,255,235,0.14) 92%);' +
        'box-shadow:inset 0 0 18px rgba(255,255,255,0.45), 0 0 16px rgba(150,210,255,0.35);'
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
      rand(9000, 15000),
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

/* -------------------------------------------------------------------------- */

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers, rain, fireworks, galaxy, bubbles, ripples,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  flowers, rain, fireworks, galaxy, bubbles, ripples,
];
