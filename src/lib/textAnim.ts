/**
 * Text-animation engine — the data half.
 *
 * A single tiny engine (see AnimatedText.tsx) drives every effect. Each preset is
 * pure data describing WHICH unit moves (whole block / line / word / char), WHEN
 * it fires, and which CSS keyframe (or JS "special") to run. That means the visual
 * library is unbounded: a new effect is one row here plus one @keyframes in the
 * `text-anim` block of globals.css — no engine changes.
 *
 * Two families:
 *   • surface  — the whole rendered block animates via one CSS class. Full markdown
 *                / math / callouts survive untouched (gradient sweeps, glow, glitch,
 *                float, holograms…).
 *   • kinetic  — the text is tokenised into line→word→char spans, each with a
 *                staggered delay, and animated independently (typewriter, cascade,
 *                bloom, karaoke captions, decrypt…). Kinetic renders plain text, so
 *                it's meant for punchy lines & headings the way Reels captions are.
 *
 * Config lives on `obj.style.textAnim` (a free-form bag, same as toggleCollapsed),
 * so it persists, syncs in collab, and replays in present / share views for free.
 */

export type AnimUnit = 'char' | 'word' | 'line';
export type AnimTrigger = 'appear' | 'loop' | 'click';
export type AnimKind = 'surface' | 'kinetic';
/** Effects that need a JS clock rather than pure CSS keyframes. */
export type AnimSpecial = 'typewriter' | 'scramble';

export interface TextAnimConfig {
  /** Preset id. Empty / absent means "no animation" (plain render). */
  preset: string;
  /** How it fires. Default 'appear' (plays when scrolled into view / in present). */
  trigger?: AnimTrigger;
  /** Global speed multiplier, 0.25–3. Default 1. */
  speed?: number;
  /** Per-unit stagger override in ms (kinetic only). Falls back to the preset. */
  stagger?: number;
}

export interface AnimPreset {
  id: string;
  name: string;
  category: AnimCategory;
  kind: AnimKind;
  /** kinetic only — the token size that animates. */
  unit?: AnimUnit;
  /** kinetic default stagger (ms per unit). */
  stagger?: number;
  /** base duration of one unit / one loop, in ms. */
  dur?: number;
  /** true for ambient effects that repeat forever. */
  loop?: boolean;
  /** JS-driven effect. */
  special?: AnimSpecial;
  /** Whether 'appear' vs 'loop' vs 'click' all make sense (defaults allow all). */
  triggers?: AnimTrigger[];
  /** one-line description shown in the picker. */
  hint: string;
  /** short preview string (defaults to a generic sample). */
  sample?: string;
  /** an emoji-free glyph shown on the tile when a live preview is overkill. */
  tag?: string;
}

export type AnimCategory =
  | 'Reveal'
  | 'Caption'
  | 'Ambient'
  | 'Signature'
  | 'Playful';

export const ANIM_CATEGORIES: AnimCategory[] = ['Reveal', 'Caption', 'Ambient', 'Signature', 'Playful'];

/**
 * The library. IDs are the CSS class suffix (`ct-<id>`) AND the value stored on the
 * block, so they must stay stable once shipped.
 */
export const TEXT_ANIM_PRESETS: AnimPreset[] = [
  /* ------------------------------- Reveal ------------------------------- */
  { id: 'typewriter',   name: 'Typewriter',     category: 'Reveal', kind: 'kinetic', unit: 'char', special: 'typewriter', dur: 55,  triggers: ['appear', 'loop', 'click'], hint: 'Types out char by char with a caret' },
  { id: 'cascade-up',   name: 'Cascade Up',     category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 42, dur: 620, hint: 'Words rise & fade in, one by one' },
  { id: 'cascade-down', name: 'Cascade Down',   category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 42, dur: 620, hint: 'Words drop & fade in from above' },
  { id: 'bloom',        name: 'Letter Bloom',   category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 26, dur: 620, hint: 'Each letter blooms out with a spin' },
  { id: 'blur-in',      name: 'Blur In',        category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 24, dur: 620, hint: 'Blurred letters sharpen into focus' },
  { id: 'slide-left',   name: 'Slide In',       category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 40, dur: 560, hint: 'Words glide in from the right' },
  { id: 'drop-bounce',  name: 'Drop & Bounce',  category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 34, dur: 720, hint: 'Letters fall in and bounce to rest' },
  { id: 'flip-x',       name: 'Flip Down',      category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 30, dur: 640, hint: 'Letters flip in on the X axis' },
  { id: 'flip-y',       name: 'Flip Reveal',    category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 34, dur: 640, hint: 'Letters swing in on the Y axis' },
  { id: 'slot',         name: 'Slot Machine',   category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 40, dur: 700, hint: 'Letters spin up and land like reels' },
  { id: 'split-flap',   name: 'Split Flap',     category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 46, dur: 560, hint: 'Airport departure-board flip' },
  { id: 'ripple',       name: 'Ripple',         category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 30, dur: 700, hint: 'A wave of scale rolls across the letters' },
  { id: 'spring-in',    name: 'Spring In',      category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 46, dur: 720, hint: 'Words pop in with an elastic overshoot' },
  { id: 'unfold',       name: 'Unfold',         category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 30, dur: 640, hint: 'Letters unfold from a crease at the top' },
  { id: 'skew-in',      name: 'Skew In',        category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 40, dur: 560, hint: 'Words shear into place' },
  { id: 'line-wipe',    name: 'Line Wipe',      category: 'Reveal', kind: 'kinetic', unit: 'line', stagger: 120, dur: 640, hint: 'Each line slides out from a mask' },
  { id: 'expand',       name: 'Focus In',       category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 22, dur: 720, hint: 'Letters snap in from big & blurred' },
  { id: 'roll-in',      name: 'Roll In',        category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 28, dur: 640, hint: 'Letters roll in with a tumble' },

  /* ------------------------------- Caption ------------------------------ */
  { id: 'karaoke',      name: 'Karaoke Fill',   category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 150, dur: 320, triggers: ['appear', 'loop', 'click'], hint: 'Words fill with color left-to-right' },
  { id: 'word-pop',     name: 'Word Pop',       category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 150, dur: 420, triggers: ['appear', 'loop', 'click'], hint: 'Each word punches up as it "speaks"' },
  { id: 'spotlight',    name: 'Spotlight',      category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 170, dur: 500, loop: true, triggers: ['loop', 'appear'], hint: 'A bright focus sweeps word to word' },
  { id: 'highlighter',  name: 'Highlighter',    category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 130, dur: 380, hint: 'A marker underline draws under each word' },
  { id: 'bounce-read',  name: 'Bounce Read',    category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 130, dur: 480, hint: 'Each word hops as you read along' },
  { id: 'pop-in',       name: 'Punch In',       category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 90,  dur: 380, hint: 'Reels-style snappy word punch-in' },

  /* ------------------------------- Ambient ------------------------------ */
  { id: 'gradient-sweep', name: 'Gradient Sweep', category: 'Ambient', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'A color gradient flows through the text', tag: 'Aa' },
  { id: 'rainbow',        name: 'Rainbow',        category: 'Ambient', kind: 'surface', loop: true, dur: 4000, triggers: ['loop'], hint: 'Full-spectrum hue cycle', tag: 'Aa' },
  { id: 'shimmer',        name: 'Gold Shimmer',   category: 'Ambient', kind: 'surface', loop: true, dur: 2600, triggers: ['loop'], hint: 'A metallic glint sweeps across', tag: 'Aa' },
  { id: 'neon-pulse',     name: 'Neon Pulse',     category: 'Ambient', kind: 'surface', loop: true, dur: 1800, triggers: ['loop'], hint: 'A breathing neon glow', tag: 'Aa' },
  { id: 'neon-flicker',   name: 'Neon Flicker',   category: 'Ambient', kind: 'surface', loop: true, dur: 3000, triggers: ['loop'], hint: 'A buzzing sign that flickers', tag: 'Aa' },
  { id: 'wave',           name: 'Wave',           category: 'Ambient', kind: 'kinetic', unit: 'char', loop: true, stagger: 60, dur: 1400, triggers: ['loop'], hint: 'Letters bob in a sine wave' },
  { id: 'float',          name: 'Float',          category: 'Ambient', kind: 'surface', loop: true, dur: 4000, triggers: ['loop'], hint: 'Gently drifts up and down', tag: 'Aa' },
  { id: 'breathe',        name: 'Breathe',        category: 'Ambient', kind: 'surface', loop: true, dur: 3400, triggers: ['loop'], hint: 'Slow scale in and out', tag: 'Aa' },
  { id: 'glow-drift',     name: 'Glow Drift',     category: 'Ambient', kind: 'surface', loop: true, dur: 3000, triggers: ['loop'], hint: 'A soft accent glow that drifts', tag: 'Aa' },
  { id: 'underline-flow', name: 'Underline Flow', category: 'Ambient', kind: 'surface', loop: true, dur: 2400, triggers: ['loop'], hint: 'An animated underline flows across', tag: 'Aa' },
  { id: 'chromatic',      name: 'Chromatic',      category: 'Ambient', kind: 'surface', loop: true, dur: 2600, triggers: ['loop'], hint: 'Subtle RGB split drift', tag: 'Aa' },

  /* ------------------------------ Signature ----------------------------- */
  { id: 'decrypt',      name: 'Decrypt',        category: 'Signature', kind: 'kinetic', unit: 'char', special: 'scramble', stagger: 34, dur: 620, triggers: ['appear', 'loop', 'click'], hint: 'Random glyphs settle into the real text' },
  { id: 'glitch',       name: 'Glitch',         category: 'Signature', kind: 'surface', loop: true, dur: 2400, triggers: ['loop', 'appear'], hint: 'RGB-split slicing glitch', tag: 'Aa' },
  { id: 'hologram',     name: 'Hologram',       category: 'Signature', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'Cyan/magenta holo-shimmer with scanlines', tag: 'Aa' },
  { id: 'assemble',     name: 'Assemble',       category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 18, dur: 760, hint: 'Letters fly in from scattered positions' },
  { id: 'scatter-in',   name: 'Scatter In',     category: 'Signature', kind: 'kinetic', unit: 'word', stagger: 40, dur: 700, hint: 'Words swirl in from random offsets' },
  { id: 'sweep-light',  name: 'Light Sweep',    category: 'Signature', kind: 'surface', loop: true, dur: 2800, triggers: ['loop', 'appear'], hint: 'A band of light passes over the text', tag: 'Aa' },
  { id: 'fire',         name: 'Ember',          category: 'Signature', kind: 'surface', loop: true, dur: 2600, triggers: ['loop'], hint: 'A warm ember flicker glow', tag: 'Aa' },
  { id: 'depth-echo',   name: 'Depth Echo',     category: 'Signature', kind: 'surface', loop: true, dur: 2600, triggers: ['loop'], hint: 'Layered echo copies pulse in 3D', tag: 'Aa' },
  { id: 'matrix',       name: 'Matrix',         category: 'Signature', kind: 'kinetic', unit: 'char', special: 'scramble', stagger: 40, dur: 700, triggers: ['appear', 'loop', 'click'], hint: 'Green digital-rain decode', sample: 'DECODE' },

  /* ------------------------------- Playful ------------------------------ */
  { id: 'rubber',       name: 'Rubber',         category: 'Playful', kind: 'surface', loop: true, dur: 1600, triggers: ['loop', 'appear'], hint: 'Squash-and-stretch wobble', tag: 'Aa' },
  { id: 'tada',         name: 'Ta-da',          category: 'Playful', kind: 'surface', loop: true, dur: 1600, triggers: ['loop', 'appear'], hint: 'An attention-grabbing shake & pop', tag: 'Aa' },
  { id: 'heartbeat',    name: 'Heartbeat',      category: 'Playful', kind: 'surface', loop: true, dur: 1500, triggers: ['loop'], hint: 'Double-thump pulse', tag: 'Aa' },
  { id: 'swing',        name: 'Swing',          category: 'Playful', kind: 'surface', loop: true, dur: 2200, triggers: ['loop'], hint: 'Swings from a pin at the top', tag: 'Aa' },
  { id: 'jelly',        name: 'Jelly',          category: 'Playful', kind: 'kinetic', unit: 'char', loop: true, stagger: 55, dur: 1600, triggers: ['loop'], hint: 'Letters jiggle like jelly' },
  { id: 'wobble',       name: 'Wobble',         category: 'Playful', kind: 'surface', loop: true, dur: 1800, triggers: ['loop'], hint: 'A tipsy side-to-side wobble', tag: 'Aa' },
  { id: 'bounce-loop',  name: 'Bounce',         category: 'Playful', kind: 'kinetic', unit: 'char', loop: true, stagger: 60, dur: 1200, triggers: ['loop'], hint: 'Letters bounce in a Mexican wave' },
  { id: 'pulse-scale',  name: 'Pulse',          category: 'Playful', kind: 'surface', loop: true, dur: 1400, triggers: ['loop'], hint: 'A steady scale pulse', tag: 'Aa' },
];

const BY_ID = new Map(TEXT_ANIM_PRESETS.map((p) => [p.id, p]));

export function getAnimPreset(id: string | undefined | null): AnimPreset | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function presetsByCategory(cat: AnimCategory): AnimPreset[] {
  return TEXT_ANIM_PRESETS.filter((p) => p.category === cat);
}

/** Normalise a stored config, filling defaults. Returns null when there's nothing to play. */
export function resolveAnim(raw: unknown): { preset: AnimPreset; cfg: Required<Omit<TextAnimConfig, 'stagger'>> & { stagger: number } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as TextAnimConfig;
  const preset = getAnimPreset(c.preset);
  if (!preset) return null;
  const allowed = preset.triggers ?? ['appear', 'loop', 'click'];
  let trigger = c.trigger ?? (preset.loop ? 'loop' : 'appear');
  if (!allowed.includes(trigger)) trigger = allowed[0];
  const speed = clamp(c.speed ?? 1, 0.25, 3);
  const stagger = c.stagger ?? preset.stagger ?? 40;
  return { preset, cfg: { preset: preset.id, trigger, speed, stagger } };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** The glyph pool used by scramble/decrypt specials. */
export const SCRAMBLE_GLYPHS = '!<>-_\\/[]{}—=+*^?#________ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const MATRIX_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF';
