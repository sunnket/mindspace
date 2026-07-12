/**
 * Stress Reliefer — the effect catalogue.
 *
 * Every effect is a tiny particle system: `create` builds one DOM node and its
 * physics state, `step` advances it and writes the result to that node. The
 * engine in RelaxEffectsLayer owns emission, the RAF loop, and teardown.
 *
 * Two hard rules for anything added here, both learned the hard way:
 *
 *  1. Particles mount inside `.canvas-world`, a 0x0 shrink-to-fit box. Tailwind
 *     preflight's `img { max-width: 100% }` resolves against it, so any node
 *     that doesn't pin `max-width/max-height: none` collapses to zero width and
 *     silently renders nothing. `baseStyle` does this for you — use it.
 *  2. `step` may only touch `transform` and `opacity`. Anything else (width,
 *     left/top, filter) re-runs layout or paint for every particle every frame,
 *     and these effects routinely put 200+ nodes on screen.
 */

export type RelaxEffectId =
  | 'flowers'
  | 'letters'
  | 'starfield'
  | 'galaxy'
  | 'bubbles'
  | 'fireflies';

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
  /** free scratch slots — meaning is per-effect */
  kind: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface RelaxEffect {
  id: RelaxEffectId;
  label: string;
  glyph: string;
  blurb: string;
  /** colour of the shockwave ring that opens the burst */
  flash: string;
  burstMs: number;
  openingPop: number;
  spawnEveryMs: number;
  spawnPerTick: number;
  /** 0 disables the cursor trail */
  trailEveryMs: number;
  maxParticles: number;
  create: (x: number, y: number, now: number) => Particle;
  step: (p: Particle, t: number, now: number) => void;
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
    el,
    x,
    y,
    vx: 0,
    vy: 0,
    size,
    rot: 0,
    spin: 0,
    born: now,
    life,
    maxScale: 1,
    kind: 0,
    a: 0,
    b: 0,
    c: 0,
    d: 0,
  };
}

/** Elastic pop-in with a touch of overshoot, used by most effects. */
function popIn(t: number, window_ = 0.18) {
  if (t >= window_) return 1;
  const k = t / window_;
  return 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.16;
}

/** Full opacity through the middle of life, easing in fast and out slowly. */
function fade(t: number, inEnd = 0.06, outStart = 0.65) {
  if (t < inEnd) return t / inEnd;
  if (t > outStart) return 1 - (t - outStart) / (1 - outStart);
  return 1;
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
];

const flowers: RelaxEffect = {
  id: 'flowers',
  label: 'Flower Burst',
  glyph: '🌸',
  blurb: 'Hundreds of blooms pop from your cursor, tumble open, and drift away on the breeze.',
  flash: 'rgba(255, 140, 170, 0.55)',
  burstMs: 10_000,
  openingPop: 55,
  spawnEveryMs: 50,
  spawnPerTick: 3,
  trailEveryMs: 110,
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
    p.kind = rand(0.6, 2.2); // petal tumble speed
    return p;
  },
  step(p, t) {
    p.vx *= 0.955;
    p.vy = p.vy * 0.955 + p.a;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;

    const sway = Math.sin(t * p.c * Math.PI * 2 + p.d) * p.b;
    const scale = p.maxScale * popIn(t);
    // Petals turning over as they fall — cheap 3D, no extra paint cost.
    const tumble = Math.sin(t * p.kind * Math.PI * 2 + p.d) * 55;

    p.el.style.transform =
      `perspective(500px) translate3d(${p.x + sway - p.size / 2}px, ${p.y - p.size / 2}px, 0) ` +
      `rotateX(${tumble}deg) rotateZ(${p.rot}deg) scale(${scale})`;
    p.el.style.opacity = String(fade(t, 0.04, 0.65));
  },
};

/* ------------------------------------------------------------------ letters */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&@#%*?!'.split('');
const LETTER_COLORS = [
  '#FF4D6D', '#FF9E00', '#FFD60A', '#38B000', '#00BBF9',
  '#4361EE', '#9B5DE5', '#F15BB5', '#00F5D4', '#FB5607',
];

const letters: RelaxEffect = {
  id: 'letters',
  label: 'Letter Storm',
  glyph: '🔤',
  blurb: 'Confetti alphabet. Letters fire out in every colour, arc through the air, and rain down — and they trail your cursor as you move.',
  flash: 'rgba(155, 93, 229, 0.5)',
  burstMs: 10_000,
  openingPop: 45,
  spawnEveryMs: 45,
  spawnPerTick: 3,
  trailEveryMs: 40,
  maxParticles: 900,
  create(x, y, now) {
    const size = rand(18, 54);
    const color = pick(LETTER_COLORS);
    const el = document.createElement('span');
    el.textContent = pick(GLYPHS);
    baseStyle(
      el,
      size,
      'width:auto;height:auto;display:block;font-weight:800;line-height:1;' +
        `font-size:${size}px;color:${color};` +
        `text-shadow:0 0 12px ${color}66, 0 2px 4px rgba(0,0,0,0.18);`
    );

    const p = particle(el, x + rand(-8, 8), y + rand(-8, 8), size, rand(2600, 4200), now);
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(4, 13);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 2.5; // bias upward so they arc over
    p.rot = rand(-40, 40);
    p.spin = rand(-7, 7);
    p.maxScale = 1;
    p.a = rand(0.1, 0.2); // gravity
    return p;
  },
  step(p, t) {
    p.vx *= 0.985;
    p.vy = p.vy * 0.99 + p.a;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;

    const scale = popIn(t, 0.12);
    p.el.style.transform =
      `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg) scale(${scale})`;
    p.el.style.opacity = String(fade(t, 0.05, 0.7));
  },
};

/* ---------------------------------------------------------------- starfield */

const STAR_COLORS = ['#FFFFFF', '#CFE6FF', '#9FB8FF', '#D9C2FF', '#FFE6A8'];

const starfield: RelaxEffect = {
  id: 'starfield',
  label: 'Warp Drive',
  glyph: '🚀',
  blurb: 'Punch to lightspeed. Stars streak past you in every direction while the far field drifts and twinkles.',
  flash: 'rgba(160, 200, 255, 0.6)',
  burstMs: 10_000,
  openingPop: 60,
  spawnEveryMs: 40,
  spawnPerTick: 5,
  trailEveryMs: 60,
  maxParticles: 1000,
  create(x, y, now) {
    const color = pick(STAR_COLORS);
    // A quarter of the field is slow distant twinkles — they give the warp depth.
    const distant = Math.random() < 0.28;
    const el = document.createElement('div');

    if (distant) {
      const size = rand(1.5, 3.5);
      baseStyle(el, size, `border-radius:50%;background:${color};box-shadow:0 0 6px ${color};`);
      const p = particle(el, x + rand(-140, 140), y + rand(-140, 140), size, rand(2200, 4000), now);
      p.kind = 1;
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.15, 0.7);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.a = rand(3, 7); // twinkle rate
      p.b = rand(0, Math.PI * 2);
      return p;
    }

    const len = rand(14, 42);
    const thick = rand(1.5, 3);
    baseStyle(
      el,
      len,
      `height:${thick}px;border-radius:${thick}px;transform-origin:100% 50%;` +
        `background:linear-gradient(to right, ${color}00, ${color});box-shadow:0 0 8px ${color}AA;`
    );

    const p = particle(el, x, y, len, rand(1100, 2100), now);
    p.kind = 0;
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(5, 16);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.a = thick;
    p.b = speed; // reference speed, for stretch
    return p;
  },
  step(p, t, now) {
    if (p.kind === 1) {
      p.x += p.vx;
      p.y += p.vy;
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(now / 1000 * p.a + p.b));
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0)`;
      p.el.style.opacity = String(fade(t, 0.1, 0.6) * twinkle);
      return;
    }

    // Accelerating away — the streak stretches as it picks up speed.
    p.vx *= 1.022;
    p.vy *= 1.022;
    p.x += p.vx;
    p.y += p.vy;

    const speed = Math.hypot(p.vx, p.vy);
    const stretch = Math.min(3.2, Math.max(0.45, speed / p.b));
    const angle = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;

    // transform-origin sits at the streak's head, so scaleX drags the tail back
    // toward the burst point instead of smearing the whole node.
    p.el.style.transform =
      `translate3d(${p.x - p.size}px, ${p.y - p.a / 2}px, 0) rotate(${angle}deg) scaleX(${stretch})`;
    p.el.style.opacity = String(fade(t, 0.05, 0.5));
  },
};

/* ------------------------------------------------------------------- galaxy */

const GALAXY_COLORS = ['#B892FF', '#8093F1', '#72DDF7', '#F7AEF8', '#FFD6A5', '#FFFFFF'];

const galaxy: RelaxEffect = {
  id: 'galaxy',
  label: 'Galaxy Swirl',
  glyph: '🌌',
  blurb: 'A spiral galaxy unwinds from your cursor — stars sweep out along its arms and fade into deep space.',
  flash: 'rgba(184, 146, 255, 0.55)',
  burstMs: 10_000,
  openingPop: 70,
  spawnEveryMs: 55,
  spawnPerTick: 4,
  trailEveryMs: 0,
  maxParticles: 900,
  create(x, y, now) {
    const color = pick(GALAXY_COLORS);
    const size = rand(2.5, 7);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      `border-radius:50%;background:${color};box-shadow:0 0 ${size * 2.5}px ${size / 2}px ${color}99;`
    );

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
    p.el.style.opacity = String(fade(t, 0.08, 0.55));
  },
};

/* ------------------------------------------------------------------ bubbles */

const bubbles: RelaxEffect = {
  id: 'bubbles',
  label: 'Bubble Drift',
  glyph: '🫧',
  blurb: 'Iridescent soap bubbles wobble up off the canvas, catch the light, and pop.',
  flash: 'rgba(150, 220, 255, 0.45)',
  burstMs: 10_000,
  openingPop: 22,
  spawnEveryMs: 90,
  spawnPerTick: 2,
  trailEveryMs: 130,
  maxParticles: 400,
  create(x, y, now) {
    const size = rand(18, 74);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      'border-radius:50%;border:1px solid rgba(255,255,255,0.55);' +
        'background:radial-gradient(circle at 30% 27%, rgba(255,255,255,0.92), rgba(255,255,255,0.10) 38%,' +
        ' rgba(150,220,255,0.20) 58%, rgba(255,175,240,0.24) 76%, rgba(190,255,235,0.10) 92%);' +
        'box-shadow:inset 0 0 14px rgba(255,255,255,0.40), 0 0 12px rgba(150,210,255,0.28);'
    );

    const p = particle(el, x + rand(-14, 14), y + rand(-14, 14), size, rand(4200, 7200), now);
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(1, 4.5);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.a = rand(-1.3, -0.35); // rise rate — big bubbles drift up lazily
    p.b = rand(10, 30); // wobble amplitude
    p.c = rand(0.5, 1.4); // wobble frequency
    p.d = rand(0, Math.PI * 2);
    p.maxScale = 1;
    return p;
  },
  step(p, t) {
    p.vx *= 0.94;
    p.vy = p.vy * 0.94 + p.a * 0.06;
    p.x += p.vx;
    p.y += p.vy + p.a * 0.35;

    const wobble = Math.sin(t * p.c * Math.PI * 2 + p.d) * p.b;
    // Surface tension jiggle, then a quick swell as it pops.
    const breathe = 1 + Math.sin(t * 9 + p.d) * 0.035;
    const pop = t > 0.9 ? 1 + (t - 0.9) / 0.1 * 0.45 : 1;
    const scale = popIn(t, 0.14) * breathe * pop;
    const opacity = t > 0.9 ? (1 - (t - 0.9) / 0.1) * 0.9 : fade(t, 0.08, 0.75) * 0.9;

    p.el.style.transform =
      `translate3d(${p.x + wobble - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String(opacity);
  },
};

/* ---------------------------------------------------------------- fireflies */

const FIREFLY_COLORS = ['#FFD97D', '#FFE9A8', '#C7F9A0', '#FFC46B', '#FFF3C4'];

const fireflies: RelaxEffect = {
  id: 'fireflies',
  label: 'Fireflies',
  glyph: '✨',
  blurb: 'A warm swarm wakes up around your cursor, wandering and blinking in the dark. The slow one. Just breathe.',
  flash: 'rgba(255, 217, 125, 0.4)',
  burstMs: 10_000,
  openingPop: 16,
  spawnEveryMs: 120,
  spawnPerTick: 2,
  trailEveryMs: 150,
  maxParticles: 320,
  create(x, y, now) {
    const color = pick(FIREFLY_COLORS);
    const size = rand(5, 13);
    const el = document.createElement('div');
    baseStyle(
      el,
      size,
      `border-radius:50%;background:${color};` +
        `box-shadow:0 0 ${size * 2}px ${size * 0.8}px ${color}AA, 0 0 ${size * 5}px ${size * 1.5}px ${color}44;`
    );

    const p = particle(el, x + rand(-30, 30), y + rand(-30, 30), size, rand(5000, 9000), now);
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(0.8, 3);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.a = rand(2.5, 6); // blink rate
    p.b = rand(0, Math.PI * 2); // blink phase
    p.c = rand(0.25, 0.7); // wander frequency
    p.d = rand(0, Math.PI * 2); // wander phase
    return p;
  },
  step(p, t, now) {
    // Bleed off the initial scatter, then wander aimlessly and rise a little.
    p.vx *= 0.97;
    p.vy *= 0.97;
    const s = now / 1000;
    p.x += p.vx + Math.sin(s * p.c + p.d) * 0.55;
    p.y += p.vy + Math.cos(s * p.c * 0.8 + p.b) * 0.45 - 0.14;

    const blink = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(s * p.a + p.b)), 1.6);
    const scale = popIn(t, 0.2) * (0.85 + blink * 0.25);

    p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) scale(${scale})`;
    p.el.style.opacity = String(fade(t, 0.12, 0.6) * blink);
  },
};

/* -------------------------------------------------------------------------- */

export const RELAX_EFFECTS: Record<RelaxEffectId, RelaxEffect> = {
  flowers,
  letters,
  starfield,
  galaxy,
  bubbles,
  fireflies,
};

export const RELAX_EFFECT_LIST: RelaxEffect[] = [
  flowers,
  letters,
  starfield,
  galaxy,
  bubbles,
  fireflies,
];
