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
  | 'God Mode'
  | 'Reveal'
  | 'Caption'
  | 'Ambient'
  | 'Signature'
  | 'Playful';

export const ANIM_CATEGORIES: AnimCategory[] = ['God Mode', 'Reveal', 'Caption', 'Ambient', 'Signature', 'Playful'];

/**
 * The library. IDs are the CSS class suffix (`ct-<id>`) AND the value stored on the
 * block, so they must stay stable once shipped.
 */
export const TEXT_ANIM_PRESETS: AnimPreset[] = [
  /* ------------------------------- God Mode ------------------------------- */
  { id: 'supernova',       name: 'Supernova',      category: 'God Mode', kind: 'kinetic', unit: 'char', stagger: 35, dur: 850, hint: 'Explosive gold/cyan starburst lens flare reveal' },
  { id: 'hyperdrive',      name: 'Hyperdrive',     category: 'God Mode', kind: 'kinetic', unit: 'word', stagger: 45, dur: 700, hint: 'Space-warp zoom from extreme Z distance with motion streak' },
  { id: 'god-ray',         name: 'God Ray',        category: 'God Mode', kind: 'surface', loop: true, dur: 3600, triggers: ['loop', 'appear'], hint: 'Heavenly divine rays streaming down behind gold text', tag: 'Aa' },
  { id: 'quantum-flux',    name: 'Quantum Flux',   category: 'God Mode', kind: 'kinetic', unit: 'char', stagger: 24, dur: 780, hint: 'Subatomic particle vibration with cyan-violet spectral shifts' },
  { id: 'singularity',     name: 'Singularity',    category: 'God Mode', kind: 'kinetic', unit: 'char', stagger: 30, dur: 900, hint: 'Black hole collapse into explosive Big Bang text surge' },
  { id: 'plasma-storm',    name: 'Plasma Storm',   category: 'God Mode', kind: 'surface', loop: true, dur: 2200, triggers: ['loop'], hint: 'High-voltage electric plasma aura with lightning arcing', tag: 'Aa' },
  { id: 'thunder-god',     name: 'Thunder God',    category: 'God Mode', kind: 'kinetic', unit: 'char', stagger: 38, dur: 750, hint: 'Blinding white-gold lightning impact with shockwave' },
  { id: 'solar-flare',     name: 'Solar Flare',    category: 'God Mode', kind: 'surface', loop: true, dur: 2800, triggers: ['loop'], hint: 'Intense coronal mass ejection burn with pulsing solar glow', tag: 'Aa' },
  { id: 'dimension-tear',  name: 'Dimension Tear', category: 'God Mode', kind: 'surface', loop: true, dur: 3000, triggers: ['loop'], hint: 'Spatial distortion slicing reality into a 3D chromatic rift', tag: 'Aa' },
  { id: 'chrono-shift',    name: 'Chrono Shift',   category: 'God Mode', kind: 'kinetic', unit: 'word', stagger: 50, dur: 800, hint: 'Time-bending timeline echos snapping into present sync' },
  { id: 'nebula-bloom',    name: 'Nebula Bloom',   category: 'God Mode', kind: 'surface', loop: true, dur: 4500, triggers: ['loop'], hint: 'Deep cosmic gas clouds swirling into vibrant glowing letters', tag: 'Aa' },
  { id: 'astral-projection', name: 'Astral Shift', category: 'God Mode', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'Ethereal spirit duplicate drifting out in multi-plane Z', tag: 'Aa' },

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
  { id: 'origami',         name: 'Origami Fold',   category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 32, dur: 680, hint: '3D paper crease unfolding into place' },
  { id: 'stardust',        name: 'Stardust Wave',  category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 26, dur: 720, hint: 'Sparkling celestial dust assembling into letters' },
  { id: 'prism-split',     name: 'Prism Split',    category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 42, dur: 650, hint: 'Spectral RGB dispersion converging into clear white text' },
  { id: 'telescope',       name: 'Lens Focus',     category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 44, dur: 620, hint: 'Optical camera lens zooming in with focal adjustment' },
  { id: 'miracle-wave',    name: 'Ocean Ripple',   category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 28, dur: 700, hint: 'Rolling sea wave lifting letters into position' },
  { id: 'ghost-fade',      name: 'Ghost Apparition', category: 'Reveal', kind: 'kinetic', unit: 'word', stagger: 40, dur: 750, hint: 'Ethereal phantom opacity solidifying into typography' },
  { id: 'z-depth-drop',    name: '3D Plunge',      category: 'Reveal', kind: 'kinetic', unit: 'char', stagger: 30, dur: 680, hint: 'Deep perspective drop from infinite Z screen depth' },
  { id: 'curtain-call',    name: 'Stage Curtain',  category: 'Reveal', kind: 'kinetic', unit: 'line', stagger: 130, dur: 700, hint: 'Velvet theater curtain sweep revealing text' },

  /* ------------------------------- Caption ------------------------------ */
  { id: 'karaoke',      name: 'Karaoke Fill',   category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 150, dur: 320, triggers: ['appear', 'loop', 'click'], hint: 'Words fill with color left-to-right' },
  { id: 'word-pop',     name: 'Word Pop',       category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 150, dur: 420, triggers: ['appear', 'loop', 'click'], hint: 'Each word punches up as it "speaks"' },
  { id: 'spotlight',    name: 'Spotlight',      category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 170, dur: 500, loop: true, triggers: ['loop', 'appear'], hint: 'A bright focus sweeps word to word' },
  { id: 'highlighter',  name: 'Highlighter',    category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 130, dur: 380, hint: 'A marker underline draws under each word' },
  { id: 'bounce-read',  name: 'Bounce Read',    category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 130, dur: 480, hint: 'Each word hops as you read along' },
  { id: 'pop-in',       name: 'Punch In',       category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 90,  dur: 380, hint: 'Reels-style snappy word punch-in' },
  { id: 'firefly-bounce',  name: 'Firefly Jump',   category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 140, dur: 450, hint: 'Luminous firefly dot guiding through each word' },
  { id: 'target-scope',    name: 'Tactical Scope', category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 160, dur: 480, hint: 'Crosshair reticle targeting words in rhythm' },
  { id: 'underline-flame', name: 'Flame Streak',   category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 130, dur: 420, hint: 'Fiery under-line painting as words read' },
  { id: 'scale-magnifier', name: 'Magnifier',      category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 140, dur: 400, hint: 'Lens zoom magnifying active word' },
  { id: 'glow-follower',   name: 'Glow Follower',  category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 150, dur: 460, hint: 'Soft aura halo trailing along speech' },
  { id: 'pulse-reader',    name: 'Heartbeat Read', category: 'Caption', kind: 'kinetic', unit: 'word', stagger: 135, dur: 440, hint: 'Kinetic pulse punch on each spoken word' },

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
  { id: 'aurora',       name: 'Aurora',         category: 'Ambient', kind: 'surface', loop: true, dur: 5000, triggers: ['loop'], hint: 'Soft aurora colours drift through', tag: 'Aa' },
  { id: 'liquid',       name: 'Liquid',         category: 'Ambient', kind: 'surface', loop: true, dur: 4200, triggers: ['loop'], hint: 'Liquid colour morph', tag: 'Aa' },
  { id: 'iridescent',   name: 'Iridescent',     category: 'Ambient', kind: 'surface', loop: true, dur: 4200, triggers: ['loop'], hint: 'Pearlescent iridescent sheen', tag: 'Aa' },
  { id: 'electric',     name: 'Electric',       category: 'Ambient', kind: 'surface', loop: true, dur: 2200, triggers: ['loop'], hint: 'Crackling electric-blue glow', tag: 'Aa' },
  { id: 'ice',          name: 'Ice',            category: 'Ambient', kind: 'surface', loop: true, dur: 3400, triggers: ['loop'], hint: 'Frosted icy shimmer', tag: 'Aa' },
  { id: 'magma',        name: 'Magma',          category: 'Ambient', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'Molten magma flow', tag: 'Aa' },
  { id: 'ocean',          name: 'Ocean',          category: 'Ambient', kind: 'surface', loop: true, dur: 4600, triggers: ['loop'], hint: 'Cool ocean gradient waves', tag: 'Aa' },
  { id: 'sunset',       name: 'Sunset',         category: 'Ambient', kind: 'surface', loop: true, dur: 4600, triggers: ['loop'], hint: 'Warm sunset gradient flow', tag: 'Aa' },
  { id: 'toxic',        name: 'Toxic',          category: 'Ambient', kind: 'surface', loop: true, dur: 2400, triggers: ['loop'], hint: 'Radioactive toxic-green pulse', tag: 'Aa' },
  { id: 'gold-foil',    name: 'Gold Foil',      category: 'Ambient', kind: 'surface', loop: true, dur: 2400, triggers: ['loop'], hint: 'Pressed gold-foil sheen', tag: 'Aa' },
  { id: 'bevel',        name: 'Bevel',          category: 'Ambient', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'A 3D bevel with rotating light', tag: 'Aa' },
  { id: 'glow-cycle',   name: 'Halo Cycle',     category: 'Ambient', kind: 'surface', loop: true, dur: 5000, triggers: ['loop'], hint: 'A halo that cycles through hues', tag: 'Aa' },
  { id: 'shadow-drift', name: 'Shadow Drift',   category: 'Ambient', kind: 'surface', loop: true, dur: 3400, triggers: ['loop'], hint: 'A long shadow that drifts around', tag: 'Aa' },
  { id: 'pendulum',     name: 'Pendulum',       category: 'Ambient', kind: 'kinetic', unit: 'char', loop: true, stagger: 55, dur: 2000, triggers: ['loop'], hint: 'Letters swing like pendulums' },
  { id: 'rainbow-letters', name: 'Rainbow Letters', category: 'Ambient', kind: 'kinetic', unit: 'char', loop: true, stagger: 60, dur: 3000, triggers: ['loop'], hint: 'Each letter cycles the rainbow' },
  { id: 'cosmic-pulsar',   name: 'Cosmic Pulsar',  category: 'Ambient', kind: 'surface', loop: true, dur: 3800, triggers: ['loop'], hint: 'Rhythmic deep-space pulsar radiation beacon', tag: 'Aa' },
  { id: 'bioluminescence', name: 'Biolume',        category: 'Ambient', kind: 'surface', loop: true, dur: 4200, triggers: ['loop'], hint: 'Deep ocean creature soft cyan glow pulse', tag: 'Aa' },
  { id: 'crystal-shimmer', name: 'Diamond Glint',  category: 'Ambient', kind: 'surface', loop: true, dur: 2800, triggers: ['loop'], hint: 'High-clarity crystal facet glint sweeps', tag: 'Aa' },
  { id: 'cyber-grid',      name: 'Synth Grid',     category: 'Ambient', kind: 'surface', loop: true, dur: 3200, triggers: ['loop'], hint: 'Retro 80s neon grid beam scanning underneath', tag: 'Aa' },
  { id: 'lava-lamp',       name: 'Lava Wax',       category: 'Ambient', kind: 'surface', loop: true, dur: 5200, triggers: ['loop'], hint: 'Warm organic wax gradient morphing slowly', tag: 'Aa' },
  { id: 'starfield',       name: 'Starfield',      category: 'Ambient', kind: 'surface', loop: true, dur: 3600, triggers: ['loop'], hint: 'Twinkling night sky star sparkles across text', tag: 'Aa' },
  { id: 'neon-wireframe',  name: 'Neon Wireframe', category: 'Ambient', kind: 'surface', loop: true, dur: 2500, triggers: ['loop'], hint: 'Pulsing hollow neon outline glow', tag: 'Aa' },
  { id: 'chroma-wave',     name: 'Chroma Wave',    category: 'Ambient', kind: 'surface', loop: true, dur: 4000, triggers: ['loop'], hint: 'Multi-hue spectrum rolling horizontally', tag: 'Aa' },

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
  { id: 'domino',       name: 'Domino',         category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 34, dur: 620, hint: '3D domino flip cascade' },
  { id: 'vortex',       name: 'Vortex',         category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 24, dur: 740, hint: 'Letters spiral in from a vortex' },
  { id: 'warp',         name: 'Warp',           category: 'Signature', kind: 'kinetic', unit: 'word', stagger: 46, dur: 640, hint: 'Words warp in from deep space' },
  { id: 'shockwave',    name: 'Shockwave',      category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 26, dur: 640, hint: 'A shockwave pops each letter' },
  { id: 'burn-in',      name: 'Burn In',        category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 30, dur: 760, hint: 'Letters ignite, then cool to normal' },
  { id: 'freeze',       name: 'Freeze',         category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 30, dur: 700, hint: 'Letters frost in from a chilly blur' },
  { id: 'comet',        name: 'Comet',          category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 30, dur: 660, hint: 'Letters streak in like comets' },
  { id: 'elastic-band', name: 'Elastic Band',   category: 'Signature', kind: 'kinetic', unit: 'word', stagger: 46, dur: 760, hint: 'Words snap in on an elastic band' },
  { id: 'squeeze',      name: 'Squeeze',        category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 26, dur: 620, hint: 'Letters squeeze up into place' },
  { id: 'flicker-in',   name: 'Flicker On',     category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 42, dur: 760, hint: 'Letters flicker on like old bulbs' },
  { id: 'neon-sign',    name: 'Neon Sign',      category: 'Signature', kind: 'surface', loop: true, dur: 2800, triggers: ['loop'], hint: 'A buzzing outlined neon sign', tag: 'Aa' },
  { id: 'rgb-split',    name: 'RGB Split',      category: 'Signature', kind: 'surface', loop: true, dur: 2200, triggers: ['loop'], hint: 'Hard RGB chromatic aberration', tag: 'Aa' },
  { id: 'laser',        name: 'Laser Scan',     category: 'Signature', kind: 'surface', loop: true, dur: 2600, triggers: ['loop'], hint: 'A laser line scans across', tag: 'Aa' },
  { id: 'cipher',       name: 'Cipher',         category: 'Signature', kind: 'kinetic', unit: 'char', special: 'scramble', stagger: 34, dur: 640, triggers: ['appear', 'loop', 'click'], hint: 'Violet cipher decode' },
  { id: 'cyberpunk-hack',  name: 'Cyber Breach',   category: 'Signature', kind: 'surface', loop: true, dur: 2600, triggers: ['loop', 'appear'], hint: 'Mainframe data corruption with red alert slice', tag: 'Aa' },
  { id: 'portal-ring',     name: 'Portal Ring',    category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 28, dur: 760, hint: 'Spatial portal ring opening & projecting letters' },
  { id: 'black-hole',      name: 'Black Hole',     category: 'Signature', kind: 'surface', loop: true, dur: 3400, triggers: ['loop'], hint: 'Gravitational lensing pulling light into text center', tag: 'Aa' },
  { id: 'infernal-blaze',  name: 'Inferno Blaze',  category: 'Signature', kind: 'surface', loop: true, dur: 2400, triggers: ['loop'], hint: 'Raging inferno flames with rising embers', tag: 'Aa' },
  { id: 'arc-reactor',     name: 'Arc Core',       category: 'Signature', kind: 'surface', loop: true, dur: 2000, triggers: ['loop'], hint: 'Hyper-bright cyan arc reactor core pulse', tag: 'Aa' },
  { id: 'neural-pulse',    name: 'Neural Spark',   category: 'Signature', kind: 'kinetic', unit: 'char', stagger: 30, dur: 700, hint: 'Synaptic electricity firing through letter paths' },
  { id: 'retro-wave',      name: '80s Chrome',     category: 'Signature', kind: 'surface', loop: true, dur: 3600, triggers: ['loop'], hint: 'Polished chrome text with retro sunset glow', tag: 'Aa' },
  { id: 'matrix-rain',     name: 'Digital Rain',   category: 'Signature', kind: 'kinetic', unit: 'char', special: 'scramble', stagger: 36, dur: 750, triggers: ['appear', 'loop', 'click'], hint: 'Cascading green digital code decode' },

  /* ------------------------------- Playful ------------------------------ */
  { id: 'rubber',       name: 'Rubber',         category: 'Playful', kind: 'surface', loop: true, dur: 1600, triggers: ['loop', 'appear'], hint: 'Squash-and-stretch wobble', tag: 'Aa' },
  { id: 'tada',         name: 'Ta-da',          category: 'Playful', kind: 'surface', loop: true, dur: 1600, triggers: ['loop', 'appear'], hint: 'An attention-grabbing shake & pop', tag: 'Aa' },
  { id: 'heartbeat',    name: 'Heartbeat',      category: 'Playful', kind: 'surface', loop: true, dur: 1500, triggers: ['loop'], hint: 'Double-thump pulse', tag: 'Aa' },
  { id: 'swing',        name: 'Swing',          category: 'Playful', kind: 'surface', loop: true, dur: 2200, triggers: ['loop'], hint: 'Swings from a pin at the top', tag: 'Aa' },
  { id: 'jelly',        name: 'Jelly',          category: 'Playful', kind: 'kinetic', unit: 'char', loop: true, stagger: 55, dur: 1600, triggers: ['loop'], hint: 'Letters jiggle like jelly' },
  { id: 'wobble',       name: 'Wobble',         category: 'Playful', kind: 'surface', loop: true, dur: 1800, triggers: ['loop'], hint: 'A tipsy side-to-side wobble', tag: 'Aa' },
  { id: 'bounce-loop',  name: 'Bounce',         category: 'Playful', kind: 'kinetic', unit: 'char', loop: true, stagger: 60, dur: 1200, triggers: ['loop'], hint: 'Letters bounce in a Mexican wave' },
  { id: 'pulse-scale',  name: 'Pulse',          category: 'Playful', kind: 'surface', loop: true, dur: 1400, triggers: ['loop'], hint: 'A steady scale pulse', tag: 'Aa' },
  { id: 'popcorn',         name: 'Popcorn Pop',    category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 38, dur: 620, hint: 'Letters snapping up like hot popcorn' },
  { id: 'jelly-jump',      name: 'Jelly Bounce',   category: 'Playful', kind: 'kinetic', unit: 'word', stagger: 50, dur: 700, hint: 'Squishy jelly bouncing with elastic inertia' },
  { id: 'trampoline',      name: 'Trampoline',     category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 32, dur: 740, hint: 'High-vaulting trampoline bounce with overshoot' },
  { id: 'pinball',         name: 'Pinball Bumper', category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 34, dur: 660, hint: 'Pinball bumper ricochet popping each letter' },
  { id: 'yo-yo',           name: 'Yo-Yo String',   category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 36, dur: 720, hint: 'Letters dropping on string and yo-yoing back' },
  { id: 'wiggle-pop',      name: 'Wiggle Pop',     category: 'Playful', kind: 'kinetic', unit: 'word', stagger: 45, dur: 600, hint: 'Cartoon head-shake wobble before snapping in' },
  { id: 'slime-slide',     name: 'Slime Drip',     category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 30, dur: 700, hint: 'Gooey slime sliding down into position' },
  { id: 'balloon-inflate', name: 'Balloon Pop',    category: 'Playful', kind: 'kinetic', unit: 'char', stagger: 34, dur: 650, hint: 'Inflating like party balloons to full size' },
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
  // Default to looping so effects keep replaying — a reveal that fires once and
  // freezes reads as broken. 'appear' (once per view) stays a deliberate choice.
  let trigger = c.trigger ?? (allowed.includes('loop') ? 'loop' : allowed[0]);
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
