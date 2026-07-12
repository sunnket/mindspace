/**
 * Sound for the Stress Reliefer effects.
 *
 * The pop and the chime are synthesised rather than shipped as files: they need
 * to fire dozens of times a second with a different pitch each time, and a
 * single sample retriggered at speed sounds like a machine gun. Rain is a real
 * recording because you cannot fake ten seconds of ASMR downpour with two
 * oscillators.
 *
 * Everything here is lazy. An AudioContext may only be created from a user
 * gesture, and these are all click-driven, so first use is always safe.
 */

const RAIN_SRC = '/mixkit-rain-and-thunder-storm-2390.wav';

/** Pentatonic — any two notes sound good together, so mashing the canvas stays musical. */
const PENTATONIC = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5];

let ctx: AudioContext | null = null;
let rainEl: HTMLAudioElement | null = null;
let rainFade: number | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * Bubble pop. A pitch drop gives the "thup", a short filtered noise burst gives
 * the wet click on the front. Small bubbles pop higher than big ones.
 */
export function playPop(size = 40) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;

  // 18px bubble -> ~880Hz, 80px bubble -> ~260Hz.
  const base = 950 - Math.min(1, (size - 18) / 62) * 690;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(base * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.45, t + 0.09);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.15);

  const noise = ac.createBufferSource();
  const buf = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  noise.buffer = buf;

  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = base * 2.2;
  band.Q.value = 1.1;

  const nGain = ac.createGain();
  nGain.gain.setValueAtTime(0.16, t);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

  noise.connect(band).connect(nGain).connect(ac.destination);
  noise.start(t);
  noise.stop(t + 0.06);
}

/** Soft water-drop chime for the ripples. Fundamental plus a fifth, long tail. */
export function playChime() {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const root = PENTATONIC[(Math.random() * PENTATONIC.length) | 0];

  for (const [freq, level, type] of [
    [root, 0.16, 'sine'],
    [root * 1.5, 0.05, 'triangle'],
  ] as [number, number, OscillatorType][]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 1.5);
  }
}

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
    rainEl.volume = Math.min(target, rainEl.volume + 0.04);
    if (rainEl.volume >= target) clearRainFade();
  }, 60);
}

export function stopRain() {
  if (!rainEl) return;
  clearRainFade();
  rainFade = window.setInterval(() => {
    if (!rainEl) return clearRainFade();
    rainEl.volume = Math.max(0, rainEl.volume - 0.03);
    if (rainEl.volume <= 0.001) {
      rainEl.pause();
      rainEl.currentTime = 0;
      clearRainFade();
    }
  }, 60);
}
