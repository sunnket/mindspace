/**
 * Sound for the Stress Reliefer effects.
 *
 * Almost everything here is synthesised rather than shipped as a file. These
 * sounds fire dozens of times a second and need a different pitch each time — a
 * single sample retriggered at speed sounds like a machine gun, which is the
 * opposite of ASMR. Rain is the one recording, because you cannot fake a minute
 * of downpour with two oscillators.
 *
 * Everything runs through a shared bus with a plate-style reverb on a send. The
 * reverb is what makes these read as "in a room" instead of "in a browser", and
 * it is the single biggest reason the pops and chimes feel good rather than
 * cheap. Voices choose how wet they want to be.
 *
 * All lazy: an AudioContext may only be created from a user gesture, and every
 * one of these is click-driven, so first use is always safe.
 */

const RAIN_SRC = '/mixkit-rain-and-thunder-storm-2390.wav';

/** Pentatonic — any two notes sound good together, so mashing the canvas stays musical. */
export const PENTATONIC = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66];

let ctx: AudioContext | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;
let rainEl: HTMLAudioElement | null = null;
let rainFade: number | null = null;

/** A decaying noise burst is a perfectly good impulse response for a soft plate. */
function buildReverb(ac: AudioContext): ConvolverNode {
  const seconds = 2.6;
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      // Exponential decay, slightly different per channel so the tail is wide.
      const decay = Math.pow(1 - i / len, 2.6 + c * 0.2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    dry = ctx.createGain();
    dry.gain.value = 0.9;
    dry.connect(ctx.destination);

    const send = ctx.createGain();
    send.gain.value = 0.85;
    const conv = buildReverb(ctx);
    wet = ctx.createGain();
    wet.gain.value = 1;
    wet.connect(conv).connect(send).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * A voice's output stage. `wetness` is how much of it goes to the reverb send —
 * percussive things want a hint, bells and water want a lot.
 */
function voiceOut(ac: AudioContext, wetness: number): GainNode {
  const out = ac.createGain();
  out.gain.value = 1;
  out.connect(dry!);
  const send = ac.createGain();
  send.gain.value = wetness;
  out.connect(send).connect(wet!);
  return out;
}

/** Short burst of noise, shaped by a filter. The raw material for most of these. */
function noise(ac: AudioContext, seconds: number, curve = 1): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
  }
  src.buffer = buf;
  return src;
}

/** Bubble wrap. Drier, crisper and higher than a soap bubble — a snap, not a thup. */
export function playSnap() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.16);

  const n = noise(ac, 0.035, 6);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400 + Math.random() * 900;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  n.connect(hp).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.04);

  // A tiny pitched tick under the noise gives the snap a body.
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(420 + Math.random() * 260, t);
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.05);
  og.gain.setValueAtTime(0.18, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.07);
}

/* ------------------------------------------------------------------- water */

/** Soft water-drop chime for the ripples. */
export function playChime() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.9);
  const root = PENTATONIC[(Math.random() * PENTATONIC.length) | 0];

  for (const [freq, level, type] of [
    [root, 0.15, 'sine'],
    [root * 1.5, 0.045, 'triangle'],
  ] as [number, number, OscillatorType][]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.6);
  }
}

/** Ink hitting water: a deep, round plop with a long wet tail. */
export function playPlop() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 1);

  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(rand(420, 620), t);
  osc.frequency.exponentialRampToValueAtTime(rand(70, 110), t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.34, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.4);

  const n = noise(ac, 0.12, 2);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.1, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  n.connect(lp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.13);
}

/* ------------------------------------------------------------------- chimes */

/**
 * Wind chime rod. Real bells are inharmonic — their overtones are not whole
 * multiples of the fundamental — so these ratios are deliberately "wrong". Use
 * 2x and 3x here and it stops sounding like metal and starts sounding like an
 * organ.
 */
export function playBell(freq: number) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 1);

  const partials: [number, number, number][] = [
    [1, 0.2, 3.4],
    [2.76, 0.09, 2.4],
    [5.4, 0.05, 1.6],
    [8.9, 0.02, 1.0],
  ];

  for (const [ratio, level, secs] of partials) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + secs + 0.1);
  }

  // The little metallic "tick" of the strike itself.
  const n = noise(ac, 0.03, 5);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 5;
  bp.Q.value = 0.8;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.09, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  n.connect(bp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.04);
}

/* ---------------------------------------------------------------- fireworks */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The whistle of the shell going up. Quiet — it's the anticipation, not the event. */
export function playLaunch() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.5);
  const dur = rand(0.7, 0.95);

  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(rand(380, 520), t);
  osc.frequency.exponentialRampToValueAtTime(rand(1100, 1500), t + dur);

  // A touch of vibrato stops it sounding like a test tone.
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 11;
  lfoGain.gain.value = 22;
  lfo.connect(lfoGain).connect(osc.frequency);
  lfo.start(t);
  lfo.stop(t + dur);

  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/**
 * The burst: a low chest thump, a bright shell of noise, and then the crackle
 * raining down after it. The delay between the flash and the crackle is what
 * makes it feel like it's happening far away and high up.
 */
export function playBoom() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.75);

  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(rand(90, 130), t);
  osc.frequency.exponentialRampToValueAtTime(rand(32, 45), t + 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.55);

  const n = noise(ac, 0.45, 2.2);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2600, t);
  lp.frequency.exponentialRampToValueAtTime(320, t + 0.45);
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.26, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  n.connect(lp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.5);

  // Crackle: a scatter of tiny high pops over the following second.
  const count = 22 + ((Math.random() * 14) | 0);
  for (let i = 0; i < count; i++) {
    const at = t + 0.1 + Math.random() * 1.0;
    const c = noise(ac, 0.02, 6);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = rand(2200, 5200);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(rand(0.05, 0.13), at);
    cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
    c.connect(hp).connect(cg).connect(out);
    c.start(at);
    c.stop(at + 0.03);
  }
}

/* ------------------------------------------------------------------ handpan */

/**
 * A handpan note. Unlike the wind chime, a handpan is nearly HARMONIC — its
 * overtones sit close to whole multiples of the fundamental, which is why it
 * sings rather than clangs. Soft mallet attack, long bloom, drenched in reverb.
 */
export function playHandpan(freq: number) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 1);

  const partials: [number, number, number][] = [
    [1, 0.26, 3.6],
    [2, 0.1, 2.6],
    [3, 0.045, 1.7],
    [4.02, 0.018, 1.1], // just off 4 — the tiny detune is the metal in it
  ];

  for (const [ratio, level, secs] of partials) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, t);
    g.gain.setValueAtTime(0.0001, t);
    // A slow attack (12ms, not 4) is the difference between a struck bell and a
    // hand on steel.
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + secs + 0.1);
  }

  const n = noise(ac, 0.04, 4);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * 4;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.05, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  n.connect(lp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.05);
}

/** A lantern catching the air — breathy, rising, gone. */
export function playWhoosh() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.6);
  const dur = rand(0.5, 0.8);

  const n = noise(ac, dur, 1.4);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(rand(240, 380), t);
  bp.frequency.exponentialRampToValueAtTime(rand(900, 1400), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(g).connect(out);
  n.start(t);
  n.stop(t + dur + 0.05);
}

/* ------------------------------------------------------------------ paper */
/* The flipbook's paper. These are the sounds you actually hear on every turn,
   so they get more care than anything else in this file.

   The thing that makes paper sound like paper is not the filter sweep — it's the
   CRINKLE: an irregular, grainy flutter riding on the noise, because a sheet
   under tension releases in dozens of tiny snaps rather than one smooth hiss.
   Filtered white noise alone gives you a cymbal, or a whoosh. So the flutter is
   baked straight into the buffer here (cheaper and more convincing than
   modulating a gain node), and the whole thing PANS across the stereo field in
   the direction the sheet travels, which is most of what sells the illusion. */

/**
 * Noise with paper's texture: a decay curve, an irregular flutter, and grains.
 *  · `flutter` — depth of the slow random-walk amplitude wobble (0–1)
 *  · `grain`   — how many hard little snaps get scattered through it
 */
function paperNoise(ac: AudioContext, seconds: number, curve = 1, flutter = 0.55, grain = 26): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);

  // Random walk, smoothed — the fibre releasing unevenly along the sheet.
  let walk = 1;
  const step = 240 / ac.sampleRate;
  for (let i = 0; i < len; i++) {
    walk += (Math.random() * 2 - 1) * step;
    walk = Math.max(0.25, Math.min(1.6, walk * 0.997 + 0.003));
    const env = Math.pow(1 - i / len, curve);
    const mod = 1 - flutter + flutter * walk;
    data[i] = (Math.random() * 2 - 1) * env * mod;
  }
  // Grains: single-sample-ish spikes, the audible edge of paper letting go.
  for (let g = 0; g < grain; g++) {
    const at = Math.floor(Math.random() * (len - 40));
    const amp = 0.5 + Math.random() * 0.9;
    for (let k = 0; k < 24; k++) {
      const d = Math.pow(1 - k / 24, 2.4);
      data[at + k] += (Math.random() * 2 - 1) * amp * d * Math.pow(1 - at / len, curve);
    }
  }
  src.buffer = buf;
  return src;
}

/**
 * A sheet peeling off the stack, arcing over and dropping onto the block.
 *
 * Five overlapping events, because that is what a real turn is: the FLICK of a
 * thumbnail leaving the corner, the peel (bright, thin), the sweep (the body of
 * the sheet moving air, opening then closing), the flap as it meets the block,
 * and the soft thud of the block taking its weight.
 *
 * `seconds` is the length of the TURN THIS BELONGS TO, and it matters more than
 * any of the timbre work below. The sound used to run a flat 500–660ms over a
 * sheet that landed in 420, so every turn finished with a swish still playing
 * over a book that had stopped — the one thing that unmistakably reads as
 * "sound effect" rather than "paper". Now the sheet and the sound land
 * together, whatever speed the turn is running at.
 */
export function playPageTurn(depth = 0.5, dir: 'next' | 'prev' = 'next', seconds?: number) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.22);
  /* Slightly SHORTER than the turn: the sheet's last few degrees are silent in
     life too — it has already flopped onto the block by then. */
  const dur = Math.max(0.16, Math.min(0.9, (seconds ?? 0.5 + depth * 0.16) * 0.92));
  const sign = dir === 'next' ? 1 : -1;

  /* The sheet crosses the book, so the sound crosses the listener. Without this
     every turn happens in the middle of your head and sounds like a UI blip. */
  const pan = ac.createStereoPanner?.();
  const bus = ac.createGain();
  if (pan) {
    pan.pan.setValueAtTime(0.5 * sign, t);
    pan.pan.linearRampToValueAtTime(-0.42 * sign, t + dur);
    bus.connect(pan).connect(out);
  } else {
    bus.connect(out);
  }

  /* 0. the flick — the single hard transient of a thumbnail letting go of the
     corner. Four milliseconds of it, and it is the whole reason a turn now
     starts crisply instead of fading in. Without a transient the ear hears a
     whoosh; with one it hears something being DONE. */
  const flick = noise(ac, 0.05, 3.4);
  const kf = ac.createBiquadFilter();
  kf.type = 'highpass'; kf.frequency.value = rand(2600, 3400);
  const kg = ac.createGain();
  kg.gain.setValueAtTime(0.045 + depth * 0.03, t);
  kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  flick.connect(kf).connect(kg).connect(bus);
  flick.start(t); flick.stop(t + 0.06);

  // 1. the peel — high and dry, the corner separating
  const peelDur = Math.min(0.2, dur * 0.42);
  const peel = paperNoise(ac, peelDur, 1.9, 0.7, 16);
  const pf = ac.createBiquadFilter();
  pf.type = 'bandpass'; pf.Q.value = 0.75;
  pf.frequency.setValueAtTime(rand(1700, 2300), t);
  pf.frequency.exponentialRampToValueAtTime(rand(3800, 5200), t + peelDur * 0.9);
  const pg = ac.createGain();
  pg.gain.setValueAtTime(0.0001, t);
  pg.gain.exponentialRampToValueAtTime(0.042 + depth * 0.02, t + 0.028);
  pg.gain.exponentialRampToValueAtTime(0.0001, t + peelDur);
  peel.connect(pf).connect(pg).connect(bus);
  peel.start(t); peel.stop(t + peelDur + 0.04);

  // 2. the sweep — the body of it, brightening as the sheet stands up and
  //    darkening as it falls away. This is the layer you actually recognise.
  const sweep = paperNoise(ac, dur, 0.9, 0.62, 34);
  const sf = ac.createBiquadFilter();
  sf.type = 'bandpass'; sf.Q.value = 0.62;
  sf.frequency.setValueAtTime(rand(900, 1150), t + 0.02);
  sf.frequency.exponentialRampToValueAtTime(rand(2400, 3100), t + dur * 0.42);
  sf.frequency.exponentialRampToValueAtTime(rand(620, 820), t + dur);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0.0001, t + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.055 + depth * 0.03, t + dur * 0.34);
  sg.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.72);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  sweep.connect(sf).connect(sg).connect(bus);
  sweep.start(t + 0.02); sweep.stop(t + dur + 0.04);

  /* 3. the flap — the sheet meeting the ones already turned. Placed near the
     END of the turn rather than at 70% of a made-up length, so on a fast turn
     it still lands with the page instead of arriving before it. */
  const at = t + dur * 0.82;
  const flap = paperNoise(ac, 0.2, 2.4, 0.5, 14);
  const ff = ac.createBiquadFilter();
  ff.type = 'lowpass';
  ff.frequency.setValueAtTime(3200, at);
  ff.frequency.exponentialRampToValueAtTime(620, at + 0.2);
  const fg = ac.createGain();
  fg.gain.setValueAtTime(0.0001, at);
  fg.gain.exponentialRampToValueAtTime(0.05 + depth * 0.035, at + 0.022);
  fg.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
  flap.connect(ff).connect(fg).connect(bus);
  flap.start(at); flap.stop(at + 0.24);

  // 4. the block taking the weight — felt more than heard, and the reason the
  //    turn lands instead of just stopping
  const thud = ac.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(rand(96, 124), at);
  thud.frequency.exponentialRampToValueAtTime(58, at + 0.09);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.0001, at);
  tg.gain.exponentialRampToValueAtTime(0.03 + depth * 0.02, at + 0.012);
  tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
  thud.connect(tg).connect(bus);
  thud.start(at); thud.stop(at + 0.12);
}

/** The cover swinging open: board, hinge and the whole block shifting at once. */
export function playCoverOpen() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.42);

  // the hinge: glue and board under strain, sliding up
  const n = paperNoise(ac, 0.62, 1.2, 0.45, 10);
  const b1 = ac.createBiquadFilter();
  b1.type = 'bandpass'; b1.Q.value = 7;
  b1.frequency.setValueAtTime(150, t);
  b1.frequency.exponentialRampToValueAtTime(310, t + 0.6);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
  n.connect(b1).connect(g).connect(out);
  n.start(t); n.stop(t + 0.66);

  // the block of paper lifting away from the board, a beat later
  const lift = paperNoise(ac, 0.4, 1.5, 0.6, 22);
  const lf = ac.createBiquadFilter();
  lf.type = 'bandpass'; lf.Q.value = 0.7;
  lf.frequency.setValueAtTime(700, t + 0.1);
  lf.frequency.exponentialRampToValueAtTime(2200, t + 0.44);
  const lg = ac.createGain();
  lg.gain.setValueAtTime(0.0001, t + 0.1);
  lg.gain.exponentialRampToValueAtTime(0.05, t + 0.24);
  lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  lift.connect(lf).connect(lg).connect(out);
  lift.start(t + 0.1); lift.stop(t + 0.54);
}

/** Shutting it: the block compressing, then the board landing on top. */
export function playCoverClose() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.4);

  const air = paperNoise(ac, 0.34, 1.4, 0.5, 18);
  const af = ac.createBiquadFilter();
  af.type = 'bandpass'; af.Q.value = 0.7;
  af.frequency.setValueAtTime(1800, t);
  af.frequency.exponentialRampToValueAtTime(520, t + 0.32);
  const ag = ac.createGain();
  ag.gain.setValueAtTime(0.0001, t);
  ag.gain.exponentialRampToValueAtTime(0.05, t + 0.06);
  ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  air.connect(af).connect(ag).connect(out);
  air.start(t); air.stop(t + 0.38);

  // the board: a real thump, low and short
  const at = t + 0.26;
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(112, at);
  body.frequency.exponentialRampToValueAtTime(48, at + 0.14);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, at);
  bg.gain.exponentialRampToValueAtTime(0.07, at + 0.014);
  bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  body.connect(bg).connect(out);
  body.start(at); body.stop(at + 0.18);

  const knock = paperNoise(ac, 0.16, 3, 0.3, 8);
  const kf = ac.createBiquadFilter();
  kf.type = 'lowpass';
  kf.frequency.setValueAtTime(1400, at);
  kf.frequency.exponentialRampToValueAtTime(300, at + 0.16);
  const kg = ac.createGain();
  kg.gain.setValueAtTime(0.0001, at);
  kg.gain.exponentialRampToValueAtTime(0.055, at + 0.01);
  kg.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  knock.connect(kf).connect(kg).connect(out);
  knock.start(at); knock.stop(at + 0.2);
}

/** Opening the covers: a low resonant creak from the spine. Used once, on open. */
export function playSpineCreak() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.5);
  const dur = 0.85;

  const n = noise(ac, dur, 1.1);
  // Two narrow peaks sliding upward — the sound of glue and board under strain.
  const b1 = ac.createBiquadFilter();
  b1.type = 'bandpass'; b1.Q.value = 9;
  b1.frequency.setValueAtTime(180, t);
  b1.frequency.exponentialRampToValueAtTime(300, t + dur);
  const b2 = ac.createBiquadFilter();
  b2.type = 'bandpass'; b2.Q.value = 14;
  b2.frequency.setValueAtTime(430, t);
  b2.frequency.exponentialRampToValueAtTime(680, t + dur);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  // a slow wobble, because a creak is never smooth
  const wob = ac.createOscillator();
  const wobDepth = ac.createGain();
  wob.frequency.value = 11;
  wobDepth.gain.value = 26;
  wob.connect(wobDepth).connect(b2.frequency);
  wob.start(t); wob.stop(t + dur);

  n.connect(b1).connect(g).connect(out);
  n.connect(b2).connect(g);
  n.start(t);
  n.stop(t + dur + 0.05);
}

/** The book settling closed — a soft, dull thump of paper meeting paper. */
export function playPaperSettle() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.35);
  const n = noise(ac, 0.3, 3.2);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, t);
  lp.frequency.exponentialRampToValueAtTime(240, t + 0.3);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  n.connect(lp).connect(g).connect(out);
  n.start(t);
  n.stop(t + 0.34);
}

/** Catching a firefly: a tiny glassy ping, high and brief. */
export function playSparkle() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 1);
  const root = PENTATONIC[(Math.random() * PENTATONIC.length) | 0] * 2;

  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(root, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 1);
}

/* ------------------------------------------------------------------- japan */

/** Hirajoshi — the classic Japanese pentatonic. Every pair of notes consoles. */
export const HIRAJOSHI = [261.63, 277.18, 349.23, 392.0, 415.3, 523.25, 554.37, 698.46];

/**
 * A koto pluck, by Karplus-Strong.
 *
 * A plucked string is not a sine with an envelope on it, and it never sounds
 * like one. It's a burst of noise trapped in a delay line the length of the
 * string, averaged with itself on every lap — which rounds off the high partials
 * a little faster than the low ones, exactly as a real string loses them. Five
 * lines of arithmetic and it sounds like wood and silk instead of a synthesiser.
 */
export function playKoto(freq: number, level = 0.34) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.9);

  const sr = ac.sampleRate;
  const N = Math.max(2, Math.round(sr / freq)); // delay line = one wavelength
  const dur = 2.6;
  const len = Math.floor(sr * dur);

  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
  // Smooth the excitation twice: a hard noise burst is a harpsichord, a soft one
  // is a finger. The koto is plucked with a plectrum but voiced warm.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < N; i++) line[i] = (line[i] + line[i - 1]) * 0.5;
  }

  const buf = ac.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const damp = 0.9965; // string loss per lap — this IS the decay time
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const next = line[(idx + 1) % N];
    line[idx] = (cur + next) * 0.5 * damp;
    data[i] = cur;
    idx = (idx + 1) % N;
  }
  // Take the click off the front and the cliff off the back.
  for (let i = 0; i < len; i++) {
    data[i] *= Math.min(1, i / 240) * Math.pow(1 - i / len, 0.7);
  }

  const src = ac.createBufferSource();
  src.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  const g = ac.createGain();
  g.gain.value = level;
  src.connect(lp).connect(g).connect(out);
  src.start(t);
}

/** Shishi-odoshi: the hollow knock of a bamboo pipe tipping onto a stone. */
export function playBamboo() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const out = voiceOut(ac, 0.95);
  const pitch = rand(300, 420);

  // The knock: noise rung through a high-Q band = a hollow tube.
  const n = noise(ac, 0.06, 7);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = pitch * 2.4;
  bp.Q.value = 7;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  n.connect(bp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.2);

  // The body of the wood under it.
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(pitch, t);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.35);
}

/* ---------------------------------------------------------------- ambiences */

/**
 * Continuous beds — surf and wind — synthesised rather than shipped.
 *
 * A wave is not a sample you loop; a loop of surf gives itself away inside ten
 * seconds because the same swell keeps arriving. This is brown noise pushed
 * through a filter whose cutoff and level are swept by TWO slow oscillators at
 * incommensurable rates (0.09 Hz and 0.13 Hz). They drift in and out of phase
 * and never quite repeat, so the sea keeps breathing unevenly, the way it does.
 */
type AmbienceId = 'ocean' | 'wind' | 'drone';

interface Ambience {
  src: AudioBufferSourceNode | null;
  gain: GainNode;
  lfos: OscillatorNode[];
  voices: OscillatorNode[];
  fade: number | null;
}

const ambiences = new Map<AmbienceId, Ambience>();

/** Brown noise — heavier at the bottom than white, which is what water sounds like. */
function brownNoiseLoop(ac: AudioContext, seconds = 8): AudioBufferSourceNode {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    // Cross-fade the tail into the head so the loop point isn't a click.
    const blend = Math.min(4096, len >> 2);
    for (let i = 0; i < blend; i++) {
      const k = i / blend;
      data[i] = data[i] * k + data[len - blend + i] * (1 - k);
    }
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export function startAmbience(id: AmbienceId) {
  const ac = audioCtx();
  if (!ac || ambiences.has(id)) return;

  /* The drone is a different animal: a low chord, not weather. Three voices a
     few cents apart beat slowly against each other, which is what gives a pad
     its slow shimmer — perfectly tuned unisons just sound thin. */
  if (id === 'drone') {
    const out = voiceOut(ac, 1);
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(out);

    const voices: OscillatorNode[] = [];
    for (const [freq, level, type] of [
      [55, 0.5, 'sine'],
      [82.41, 0.3, 'sine'],
      [110.3, 0.22, 'triangle'],  // ~2 cents sharp of 110 — the beat is the point
      [164.81, 0.1, 'sine'],
    ] as [number, number, OscillatorType][]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start();
      voices.push(osc);
    }

    // A slow tremolo so the pad breathes rather than sits.
    const breath = ac.createOscillator();
    const breathDepth = ac.createGain();
    breath.frequency.value = 0.07;
    breathDepth.gain.value = 0.05;
    breath.connect(breathDepth).connect(gain.gain);
    breath.start();

    const now = ac.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 4);

    ambiences.set(id, { src: null, gain, lfos: [breath], voices, fade: null });
    return;
  }

  const src = brownNoiseLoop(ac);
  const out = voiceOut(ac, id === 'ocean' ? 0.55 : 0.3);

  const gain = ac.createGain();
  gain.gain.value = 0; // faded up below

  const body = ac.createBiquadFilter();
  body.type = 'lowpass';
  body.Q.value = 0.7;
  body.frequency.value = id === 'ocean' ? 900 : 520;

  // The swell: cutoff opens as the wave rears up, closes as it drains back.
  const swell = ac.createOscillator();
  const swellDepth = ac.createGain();
  swell.frequency.value = 0.09;
  swellDepth.gain.value = id === 'ocean' ? 620 : 260;
  swell.connect(swellDepth).connect(body.frequency);

  // …and a second, slower one on the level, at a rate that shares no factor with
  // the first, so the two never line back up into an audible loop.
  const surge = ac.createOscillator();
  const surgeDepth = ac.createGain();
  surge.frequency.value = 0.13;
  surgeDepth.gain.value = id === 'ocean' ? 0.42 : 0.16;
  surge.connect(surgeDepth).connect(gain.gain);

  src.connect(body).connect(gain).connect(out);

  if (id === 'ocean') {
    // The hiss of foam over the top of the swell — a thin high band, riding the
    // same swell so it only appears as each wave actually breaks.
    const foam = ac.createBiquadFilter();
    foam.type = 'bandpass';
    foam.frequency.value = 3400;
    foam.Q.value = 0.6;
    const foamGain = ac.createGain();
    foamGain.gain.value = 0.05;
    const foamRide = ac.createGain();
    foamRide.gain.value = 0.05;
    surge.connect(foamRide).connect(foamGain.gain);
    src.connect(foam).connect(foamGain).connect(out);
  }

  src.start();
  swell.start();
  surge.start();

  const target = id === 'ocean' ? 0.5 : 0.22;
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(target, now + 2.5);

  ambiences.set(id, { src, gain, lfos: [swell, surge], voices: [], fade: null });
}

export function stopAmbience(id: AmbienceId) {
  const a = ambiences.get(id);
  if (!a) return;
  ambiences.delete(id);

  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  // Cancel the LFO's writes to gain.gain first, or it would keep wobbling the
  // level right through the fade-out and the sea would never actually stop.
  a.gain.gain.cancelScheduledValues(now);
  a.gain.gain.setValueAtTime(Math.max(0.0001, a.gain.gain.value), now);
  a.gain.gain.linearRampToValueAtTime(0.0001, now + 1.4);

  window.setTimeout(() => {
    try {
      a.src?.stop();
      for (const lfo of a.lfos) lfo.stop();
      for (const v of a.voices) v.stop();
    } catch {
      /* already stopped */
    }
  }, 1600);
}

/* --------------------------------------------------------------------- rain */

function clearRainFade() {
  if (rainFade !== null) {
    clearInterval(rainFade);
    rainFade = null;
  }
}

/** Fade the downpour up. Re-clicking during a storm just keeps it going. */
export function startRain() {
  if (typeof window === 'undefined') return;
  if (!rainEl) {
    rainEl = new Audio(RAIN_SRC);
    rainEl.loop = true;
  }
  clearRainFade();
  rainEl.volume = 0;
  void rainEl.play().catch(() => {
    /* blocked without a gesture — the visuals still run */
  });

  const target = 0.55;
  rainFade = window.setInterval(() => {
    if (!rainEl) return clearRainFade();
    rainEl.volume = Math.min(target, rainEl.volume + 0.03);
    if (rainEl.volume >= target) clearRainFade();
  }, 60);
}

export function stopRain() {
  if (!rainEl) return;
  clearRainFade();
  rainFade = window.setInterval(() => {
    if (!rainEl) return clearRainFade();
    rainEl.volume = Math.max(0, rainEl.volume - 0.02);
    if (rainEl.volume <= 0.001) {
      rainEl.pause();
      rainEl.currentTime = 0;
      clearRainFade();
    }
  }, 60);
}
