/**
 * The Canvas Resident's brain.
 *
 * Pure logic, no React: personality (seeded randomness so no two cats — and no
 * two sessions — behave identically), perception (what's on the canvas worth a
 * cat's attention), and the behavior scheduler (weighted choice + cooldowns).
 *
 * The renderer (CanvasResident.tsx) owns physics and pixels; this file owns
 * "what would a cat do here, now".
 */

import { CanvasObjectData } from '@/lib/db';

/* ------------------------------------------------------------------ */
/* Seeded randomness — the personality must be stable across sessions  */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CatPersonality {
  /** ms between blinks, sampled fresh every blink from [min, max] */
  blinkMin: number;
  blinkMax: number;
  /** probability per second of an ear flick while awake */
  earTwitchiness: number;
  /** multiplier on tail wave speed */
  tailSpeed: number;
  /** multiplier on idle state duration */
  laziness: number;
  /** 0..1 — how strongly block-visiting behaviors are weighted */
  curiosity: number;
  /** walking speed, world px/s */
  walkSpeed: number;
  /** index into COAT_PALETTES */
  coat: number;
}

export const COAT_PALETTES: {
  name: string;
  body: string; dark: string; belly: string; earInner: string; eye: string; nose: string; stripe?: string;
}[] = [
  { name: 'orange tabby', body: '#E8933A', dark: '#B96A1F', belly: '#F7DCB8', earInner: '#E8A9A0', eye: '#7FB069', nose: '#D97B6C', stripe: '#C9772A' },
  { name: 'charcoal',     body: '#4A4A52', dark: '#33333A', belly: '#8C8C96', earInner: '#A08088', eye: '#E8C547', nose: '#3A3A40' },
  { name: 'grey tabby',   body: '#9A9AA4', dark: '#6E6E78', belly: '#D8D8DE', earInner: '#C9A0A8', eye: '#6FA86F', stripe: '#7E7E8A', nose: '#8A6E74' },
  { name: 'cream',        body: '#E8D5B5', dark: '#C4AC85', belly: '#F8F0E0', earInner: '#E0B0A8', eye: '#5F8FB0', nose: '#D9958A' },
  { name: 'tuxedo',       body: '#3A3A42', dark: '#26262E', belly: '#F2EFE8', earInner: '#B08890', eye: '#C9A227', nose: '#2E2E36' },
];

export function makePersonality(seed: number): CatPersonality {
  const r = mulberry32(seed);
  return {
    blinkMin: 2200 + r() * 1800,       // 2.2–4.0s floor
    blinkMax: 5200 + r() * 3600,       // 5.2–8.8s ceiling
    earTwitchiness: 0.10 + r() * 0.22, // per-second chance
    tailSpeed: 0.65 + r() * 0.9,
    laziness: 0.7 + r() * 0.9,
    curiosity: 0.35 + r() * 0.55,
    walkSpeed: 46 + r() * 26,
    coat: Math.floor(r() * COAT_PALETTES.length),
  };
}

/* ------------------------------------------------------------------ */
/* Persistent profile                                                  */
/* ------------------------------------------------------------------ */

export interface NestScrap { word: string; color: string }

export interface CatProfile {
  seed: number;
  name: string;
  pomodoros: number;
  medalUntil: number;
  /** per-space passport stamps: spaceKey -> { name, firstVisit } */
  stamps: Record<string, { name: string; firstVisit: number }>;
  /** per-space last-seen time, drives the footprint trail on return */
  lastSeen: Record<string, number>;
  /** per-space stored position */
  pos: Record<string, { x: number; y: number }>;
  /** per-space nest: where it is and what's been hoarded */
  nests: Record<string, { x: number; y: number; scraps: NestScrap[] }>;
}

const PROFILE_KEY = 'mindspace-cat-profile';

export function loadProfile(): CatProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CatProfile>;
      if (typeof p.seed === 'number') {
        return {
          seed: p.seed,
          name: p.name || 'Pixel',
          pomodoros: p.pomodoros || 0,
          medalUntil: p.medalUntil || 0,
          stamps: p.stamps || {},
          lastSeen: p.lastSeen || {},
          pos: p.pos || {},
          nests: p.nests || {},
        };
      }
    }
  } catch { /* corrupted profile → adopt a new cat */ }
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    name: 'Pixel',
    pomodoros: 0,
    medalUntil: 0,
    stamps: {},
    lastSeen: {},
    pos: {},
    nests: {},
  };
}

export function saveProfile(p: CatProfile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* full/blocked storage — cat forgets, app survives */ }
}

/* ------------------------------------------------------------------ */
/* Perception — what on this canvas deserves cat attention             */
/* ------------------------------------------------------------------ */

export interface ConnectorInfo {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
  bendX?: number; bendY?: number;
  length: number;
}

export interface Perception {
  /** everything solid on the current space (no arrows/drawings) */
  blocks: CanvasObjectData[];
  /** blocks stacked into piles (stackId groups of 2+) — top member each */
  pileTops: CanvasObjectData[];
  /** blocks edited in the last 10 minutes — "warm" spots a cat would nap on */
  warm: CanvasObjectData[];
  /** oldest untouched blocks, staleness descending */
  stale: CanvasObjectData[];
  /** running focus timers */
  runningTimers: CanvasObjectData[];
  /** countdowns inside their final 24 hours */
  urgentCountdowns: CanvasObjectData[];
  mirrors: CanvasObjectData[];
  charts: CanvasObjectData[];
  /** long connector arrows — tightropes */
  connectors: ConnectorInfo[];
  /** blocks big and sturdy enough to walk along the top of */
  perchable: CanvasObjectData[];
  /** center of mass of the content, for wandering near the action */
  centroid: { x: number; y: number } | null;
}

export function perceive(objects: CanvasObjectData[], spaceId: string | undefined, now: number): Perception {
  const inSpace = objects.filter((o) => (o.parentId ?? undefined) === spaceId);
  const blocks = inSpace.filter((o) => o.type !== 'arrow' && o.type !== 'drawing' && o.type !== 'frame');

  const byStack = new Map<string, CanvasObjectData[]>();
  for (const o of blocks) {
    const sid = o.style?.stackId as string | undefined;
    if (sid) {
      const arr = byStack.get(sid) || [];
      arr.push(o);
      byStack.set(sid, arr);
    }
  }
  const pileTops: CanvasObjectData[] = [];
  for (const members of byStack.values()) {
    if (members.length >= 2) {
      pileTops.push(members.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)));
    }
  }

  const warm = blocks.filter((o) => now - (o.updatedAt || 0) < 10 * 60_000);
  const stale = [...blocks]
    .filter((o) => (o.content || '').trim() !== '' && now - (o.updatedAt || 0) > 24 * 3600_000)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(0, 5);

  const runningTimers = blocks.filter((o) => {
    const ends = o.style?.timerEndsAt as number | null | undefined;
    return o.style?.isTimer === true && typeof ends === 'number' && ends > now;
  });

  const urgentCountdowns = blocks.filter((o) => {
    if (o.style?.isCountdown !== true) return false;
    const t = new Date((o.style?.countdownDate as string) || '').getTime();
    return isFinite(t) && t > now && t - now < 24 * 3600_000;
  });

  const mirrors = inSpace.filter((o) => o.type === 'mirror');
  const charts = blocks.filter((o) => o.style?.isChart === true && o.style?.chartReady === true);

  const connectors: ConnectorInfo[] = inSpace
    .filter((o) => o.type === 'arrow')
    .map((o) => {
      const x1 = (o.style?.startX as number) ?? o.x;
      const y1 = (o.style?.startY as number) ?? o.y;
      const x2 = (o.style?.endX as number) ?? o.x;
      const y2 = (o.style?.endY as number) ?? o.y;
      return {
        id: o.id, x1, y1, x2, y2,
        bendX: o.style?.bendX as number | undefined,
        bendY: o.style?.bendY as number | undefined,
        length: Math.hypot(x2 - x1, y2 - y1),
      };
    })
    .filter((c) => c.length > 220);

  const perchable = blocks.filter((o) => o.width >= 200 && o.height >= 110);

  let centroid: { x: number; y: number } | null = null;
  if (blocks.length > 0) {
    let sx = 0, sy = 0;
    for (const o of blocks) { sx += o.x + o.width / 2; sy += o.y + o.height / 2; }
    centroid = { x: sx / blocks.length, y: sy / blocks.length };
  }

  return { blocks, pileTops, warm, stale, runningTimers, urgentCountdowns, mirrors, charts, connectors, perchable, centroid };
}

/* ------------------------------------------------------------------ */
/* Behavior scheduling                                                 */
/* ------------------------------------------------------------------ */

export type BehaviorKind =
  | 'idle_sit'      // sit, look around
  | 'idle_stand'    // stand still, small weight shifts
  | 'groom'         // sit + lick a paw
  | 'stretch'       // long cat stretch
  | 'wander'        // walk to a nearby free-ish point
  | 'sleep'         // curl up (prefers piles / warm blocks)
  | 'perch_walk'    // hop up and walk along the top edge of a big block
  | 'tightrope'     // walk a connector arrow like a tightrope
  | 'timer_perch'   // sit on the pomodoro block while it runs
  | 'mirror'        // stare at the camera mirror, tilt head, paw it once
  | 'countdown'     // sit beside an urgent countdown and worry at you
  | 'nest_visit'    // check on the nest, fuss with the scraps
  | 'celebrate';    // a completed goal — bounce, tail high

export interface Behavior {
  kind: BehaviorKind;
  /** world-space destination the walk phase targets (if any) */
  target?: { x: number; y: number };
  /** the object involved, if any */
  objId?: string;
  /** connector data for tightrope */
  connector?: ConnectorInfo;
  /** how long the "payload" phase lasts once arrived, ms */
  dwell: number;
}

/** Minimum gap between repeats of the flashier behaviors. */
const COOLDOWN: Partial<Record<BehaviorKind, number>> = {
  mirror: 10 * 60_000,
  tightrope: 7 * 60_000,
  perch_walk: 5 * 60_000,
  timer_perch: 4 * 60_000,
  countdown: 15 * 60_000,
  nest_visit: 12 * 60_000,
  sleep: 6 * 60_000,
  groom: 100_000,
  stretch: 3 * 60_000,
};

export interface BrainState {
  lastDone: Partial<Record<BehaviorKind, number>>;
  rng: () => number;
}

function ready(state: BrainState, kind: BehaviorKind, now: number): boolean {
  const last = state.lastDone[kind] || 0;
  return now - last > (COOLDOWN[kind] || 0);
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Choose what the cat does next. `pos` is where the cat is standing.
 * Weighted by personality, distance and cooldowns — with idle filler as the
 * ever-present default so the cat never looks like it's running a playlist.
 */
export function chooseBehavior(
  state: BrainState,
  p: Perception,
  personality: CatPersonality,
  pos: { x: number; y: number },
  now: number,
  nest?: { x: number; y: number } | null,
): Behavior {
  const r = state.rng;
  const options: { w: number; make: () => Behavior }[] = [];
  const near = (o: CanvasObjectData) => Math.hypot(o.x + o.width / 2 - pos.x, o.y + o.height / 2 - pos.y);
  const distW = (d: number) => Math.max(0.25, 1 - d / 2600); // closer things tempt more

  // --- idle filler (always available) ---
  options.push({ w: 2.6 * personality.laziness, make: () => ({ kind: 'idle_sit', dwell: (4000 + r() * 9000) * personality.laziness }) });
  options.push({ w: 1.1, make: () => ({ kind: 'idle_stand', dwell: 2200 + r() * 4200 }) });
  if (ready(state, 'groom', now)) {
    options.push({ w: 1.3, make: () => ({ kind: 'groom', dwell: 3800 + r() * 4800 }) });
  }
  if (ready(state, 'stretch', now)) {
    options.push({ w: 0.8, make: () => ({ kind: 'stretch', dwell: 2600 + r() * 1400 }) });
  }

  // --- wandering keeps it near the action, never marching to nowhere ---
  {
    const anchor = p.centroid || pos;
    options.push({
      w: 1.7,
      make: () => {
        const spread = 380 + r() * 520;
        const cx = anchor.x * 0.35 + pos.x * 0.65;
        const cy = anchor.y * 0.35 + pos.y * 0.65;
        return {
          kind: 'wander',
          target: { x: cx + (r() - 0.5) * 2 * spread, y: cy + (r() - 0.5) * 2 * spread },
          dwell: 600 + r() * 1800,
        };
      },
    });
  }

  // --- sleep, preferring piles and warm (recently edited) blocks ---
  if (ready(state, 'sleep', now)) {
    const spots = [...p.pileTops, ...p.warm.filter((o) => o.width >= 150)];
    const spot = spots.length && r() < 0.75 ? pick(r, spots) : null;
    options.push({
      w: 1.5 * personality.laziness,
      make: () => ({
        kind: 'sleep',
        objId: spot?.id,
        target: spot
          ? { x: spot.x + spot.width * (0.3 + r() * 0.4), y: spot.y + spot.height * (0.28 + r() * 0.3) }
          : undefined,
        dwell: 45_000 + r() * 100_000,
      }),
    });
  }

  // --- the flashy, canvas-aware stuff (curiosity-weighted) ---
  if (p.runningTimers.length && ready(state, 'timer_perch', now)) {
    const t = p.runningTimers[0];
    options.push({
      w: 3.2, // a running focus session is a strong draw — it keeps you company
      make: () => ({
        kind: 'timer_perch',
        objId: t.id,
        target: { x: t.x + t.width * 0.5, y: t.y - 2 },
        dwell: 60_000 + r() * 120_000,
      }),
    });
  }

  if (p.urgentCountdowns.length && ready(state, 'countdown', now)) {
    const c = p.urgentCountdowns[0];
    options.push({
      w: 2.6,
      make: () => ({
        kind: 'countdown',
        objId: c.id,
        target: { x: c.x - 26, y: c.y + c.height },
        dwell: 14_000 + r() * 10_000,
      }),
    });
  }

  if (p.mirrors.length && ready(state, 'mirror', now)) {
    const m = pick(r, p.mirrors);
    options.push({
      w: 1.6 * personality.curiosity * distW(near(m)),
      make: () => ({
        kind: 'mirror',
        objId: m.id,
        target: { x: m.x + m.width * 0.5, y: m.y + m.height + 6 },
        dwell: 9000 + r() * 6000,
      }),
    });
  }

  if (p.connectors.length && ready(state, 'tightrope', now)) {
    const c = pick(r, p.connectors);
    options.push({
      w: 1.5 * personality.curiosity,
      make: () => ({
        kind: 'tightrope',
        connector: c,
        target: { x: c.x1, y: c.y1 },
        dwell: 0, // dwell is the crossing itself, computed from length
      }),
    });
  }

  if (p.perchable.length && ready(state, 'perch_walk', now)) {
    // charts are the preferred parkour — the slide off the end is the point
    const candidates = p.charts.length && r() < 0.6 ? p.charts : p.perchable;
    const b = pick(r, candidates.filter((o) => o.width >= 200));
    if (b) {
      options.push({
        w: 1.2 * personality.curiosity * distW(near(b)),
        make: () => ({
          kind: 'perch_walk',
          objId: b.id,
          target: { x: b.x + 8, y: b.y - 1 },
          dwell: 2500 + r() * 2500,
        }),
      });
    }
  }

  if (nest && ready(state, 'nest_visit', now)) {
    options.push({
      w: 0.9 * personality.curiosity,
      make: () => ({
        kind: 'nest_visit',
        target: { x: nest.x, y: nest.y + 10 },
        dwell: 6000 + r() * 6000,
      }),
    });
  }

  // --- weighted draw ---
  const total = options.reduce((s, o) => s + o.w, 0);
  let roll = r() * total;
  for (const o of options) {
    roll -= o.w;
    if (roll <= 0) return o.make();
  }
  return options[0].make();
}
