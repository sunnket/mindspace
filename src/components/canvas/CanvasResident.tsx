'use client';

/**
 * The Canvas Resident — a pixel cat that lives on the board.
 *
 * Design rules this file works hard to honor:
 *  - It's a companion, not a screensaver. It reacts to YOU (cursor proximity
 *    makes it LOOK — pupils first, then a head turn — not move) and to the
 *    canvas (piles, connectors, running pomodoros, urgent countdowns, mirrors).
 *  - Nothing repeats identically. Blink timing, ear flicks, idle durations all
 *    come from a persisted per-cat personality seed plus fresh randomness.
 *  - It never fights the user: drag it anywhere, it hangs by the scruff, and
 *    when you let go it FALLS and lands, rather than teleporting upright.
 *
 * Every pose is a baked sprite frame from lib/catSprites — see the note there
 * for why. Two rules keep the pixels honest at render time:
 *
 *  1. The gait advances by DISTANCE TRAVELLED, not by time. Time-based legs
 *     skate across the board whenever the walk speed isn't exactly the frame
 *     rate's multiple; distance-based legs plant where they land.
 *  2. The cat's position is snapped to whole art pixels and the backing store
 *     is resized to match the camera's zoom, so one art pixel is one screen
 *     pixel block. Sprites that move in fractional pixels shimmer.
 *
 * The wrapper lives inside .canvas-world, so the cat pans/zooms with the board
 * like any real resident of it.
 *
 * NOTE: Tailwind padding/margin utilities are dead in this app (unlayered
 * global reset) — all spacing is inline styles.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import {
  mulberry32, makePersonality, loadProfile, saveProfile,
  perceive, chooseBehavior,
  type CatProfile, type CatPersonality, type Behavior, type BrainState, type NestScrap,
} from '@/lib/catBrain';
import {
  ART_W, ART_H, POSE_FRAMES, COATS, getSheet, type Sheet, type CompiledFrame,
} from '@/lib/catSprites';

/** World px per art pixel. Fixed, so the cat is the same size on every screen. */
const ART_PX = 1.6;
/** World px of travel per walk frame — tuned so the paws never skate. */
const STRIDE = 11;

type Pose =
  | 'stand' | 'walk' | 'sit' | 'sleep' | 'groom' | 'stretch'
  | 'scruff' | 'startle' | 'tightrope' | 'perch' | 'celebrate' | 'squash';

interface Sim {
  x: number; y: number;
  vx: number; vy: number;
  facing: 1 | -1;
  stridePhase: number;     // advanced by distance, not time
  pose: Pose;
  poseT: number;
  behavior: Behavior | null;
  phase: 'travel' | 'dwell';
  dwellUntil: number;
  travelDeadline: number;
  // eyes
  eyeOpen: number;
  nextBlink: number;
  blinkT: number;
  slowBlinkT: number;
  // ears — drives a whole-frame swap, never a half-pixel overlay
  earFlick: number;
  // attention
  attentive: number;
  attentiveSince: number;
  lookX: number; lookY: number;
  petMs: number;
  lastPurr: number;
  // tightrope / perch script
  ropeT: number;
  perchStage: number;
  // drag + the fall that follows it
  dragging: boolean;
  dragOff: { x: number; y: number };
  dragVX: number;
  dragMoved: number;
  falling: boolean;
  fallVY: number;
  landY: number;
  // bubble
  bubble: string;
  bubbleUntil: number;
  lastBubble: number;
}

interface PawPrint { x: number; y: number; angle: number; flip: boolean }

function sampleRange(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}

/** Quadratic bezier point + tangent (connector tightropes support the bend). */
function ropePoint(c: { x1: number; y1: number; x2: number; y2: number; bendX?: number; bendY?: number }, t: number) {
  const bx = c.bendX ?? (c.x1 + c.x2) / 2;
  const by = c.bendY ?? (c.y1 + c.y2) / 2;
  const mt = 1 - t;
  const x = mt * mt * c.x1 + 2 * mt * t * bx + t * t * c.x2;
  const y = mt * mt * c.y1 + 2 * mt * t * by + t * t * c.y2;
  const dx = 2 * mt * (bx - c.x1) + 2 * t * (c.x2 - bx);
  const dy = 2 * mt * (by - c.y1) + 2 * t * (c.y2 - by);
  return { x, y, angle: Math.atan2(dy, dx) };
}

/** Which baked frame this instant of this pose looks like. */
function frameNameFor(sim: Sim): string {
  const t = sim.poseT;
  switch (sim.pose) {
    case 'walk':
    case 'tightrope':
    case 'perch': {
      const seq = POSE_FRAMES.walk;
      const i = Math.floor(sim.stridePhase) % seq.length;
      return seq[(i + seq.length) % seq.length];
    }
    case 'sit': {
      const seq = sim.earFlick > 0 ? POSE_FRAMES.sitEar : POSE_FRAMES.sit;
      return seq[Math.floor(t / 1100) % seq.length];
    }
    case 'groom':
      return POSE_FRAMES.groom[Math.floor(t / 280) % 2];
    case 'sleep':
      return POSE_FRAMES.sleep[Math.floor(t / 1600) % 2];
    case 'stretch': {
      // one-shot: reach out, hold, ease back. A looping stretch looks broken.
      const seq = [0, 1, 2, 2, 2, 2, 1, 0];
      return POSE_FRAMES.stretch[seq[Math.min(seq.length - 1, Math.floor(t / 340))]];
    }
    case 'celebrate': {
      const seq = [0, 1, 1, 2, 0];
      return POSE_FRAMES.celebrate[seq[Math.floor(t / 140) % seq.length]];
    }
    case 'squash':
      return POSE_FRAMES.celebrate[2];
    case 'scruff':
      return POSE_FRAMES.scruff[sim.dragVX < 0 ? 0 : 1];
    case 'startle':
      return POSE_FRAMES.startle[0];
    default: {
      const seq = sim.earFlick > 0 ? POSE_FRAMES.standEar : POSE_FRAMES.stand;
      return seq[Math.floor(t / 1100) % seq.length];
    }
  }
}

export default function CanvasResident() {
  const enabled = useCanvasStore((s) => s.residentEnabled);
  const readOnly = useCanvasStore((s) => s.readOnly);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const spaceKey = canvasStack.length > 0 ? canvasStack[canvasStack.length - 1] : 'root';

  const wrapRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const profileRef = useRef<CatProfile>(null as unknown as CatProfile);
  const personaRef = useRef<CatPersonality>(null as unknown as CatPersonality);
  const brainRef = useRef<BrainState>(null as unknown as BrainState);
  const simRef = useRef<Sim>(null as unknown as Sim);
  const sheetRef = useRef<Sheet | null>(null);
  const backingRef = useRef(0);          // current device-px-per-art-px
  const cursorRef = useRef({ sx: -9999, sy: -9999, wx: -99999, wy: -99999, vx: 0, vy: 0, t: 0 });
  const nextThinkRef = useRef(0);
  const knownObjectsRef = useRef<Map<string, { word: string; color: string }>>(new Map());

  const [cardOpen, setCardOpen] = useState(false);
  const [, bumpCard] = useState(0);
  const [pawTrail, setPawTrail] = useState<PawPrint[]>([]);
  const [trailFading, setTrailFading] = useState(false);
  const [nest, setNest] = useState<{ x: number; y: number; scraps: NestScrap[] } | null>(null);

  /* ---------- one-time init: adopt (or wake) the cat ---------- */
  if (!profileRef.current && typeof window !== 'undefined') {
    const profile = loadProfile();
    profileRef.current = profile;
    personaRef.current = makePersonality(profile.seed);
    brainRef.current = { lastDone: {}, rng: mulberry32(profile.seed ^ (Date.now() & 0xffff)) };
    const saved = profile.pos[spaceKey];
    simRef.current = {
      x: saved?.x ?? 0, y: saved?.y ?? 0,
      vx: 0, vy: 0, facing: 1, stridePhase: 0,
      pose: 'sit', poseT: 0,
      behavior: null, phase: 'dwell', dwellUntil: 0, travelDeadline: 0,
      eyeOpen: 1, nextBlink: performance.now() + 2000, blinkT: 0, slowBlinkT: 0,
      earFlick: 0,
      attentive: 0, attentiveSince: 0, lookX: 0, lookY: 0,
      petMs: 0, lastPurr: 0,
      ropeT: 0, perchStage: 0,
      dragging: false, dragOff: { x: 0, y: 0 }, dragVX: 0, dragMoved: 0,
      falling: false, fallVY: 0, landY: 0,
      bubble: '', bubbleUntil: 0, lastBubble: 0,
    };
  }

  const persist = useCallback(() => saveProfile(profileRef.current), []);

  /* ---------- entering a space: position, stamp, footprints, nest ---------- */
  useEffect(() => {
    if (!enabled || readOnly) return;
    const profile = profileRef.current;
    const sim = simRef.current;
    const now = Date.now();
    const store = useCanvasStore.getState();
    const sid = spaceKey === 'root' ? undefined : spaceKey;
    const objects = store.objects.filter((o) => (o.parentId ?? undefined) === sid);

    // position: the saved spot if you'd actually see it — otherwise the cat
    // STROLLS IN from the edge of the screen. An entrance, never a teleport.
    const saved = profile.pos[spaceKey];
    const cam = store.camera;
    const vw = {
      x: -cam.x / cam.zoom,
      y: -cam.y / cam.zoom,
      w: window.innerWidth / cam.zoom,
      h: window.innerHeight / cam.zoom,
    };
    const inView = (x: number, y: number) =>
      x > vw.x - 200 && x < vw.x + vw.w + 200 && y > vw.y - 200 && y < vw.y + vw.h + 200;

    if (saved && inView(saved.x, saved.y)) {
      sim.x = saved.x; sim.y = saved.y;
      sim.behavior = null;
      sim.pose = 'sit';
    } else {
      const fromLeft = Math.random() < 0.5;
      sim.x = fromLeft ? vw.x - 70 : vw.x + vw.w + 70;
      sim.y = vw.y + vw.h * (0.35 + Math.random() * 0.4);
      sim.behavior = {
        kind: 'wander',
        target: { x: vw.x + vw.w * (fromLeft ? 0.3 : 0.7), y: sim.y + 30 },
        dwell: 1600,
      };
      sim.phase = 'travel';
      sim.travelDeadline = performance.now() + 30_000;
      sim.pose = 'walk';
    }

    // passport stamp
    if (!profile.stamps[spaceKey]) {
      const name = spaceKey === 'root'
        ? (store.workspaceTitle || 'Home canvas')
        : (store.objects.find((o) => o.id === spaceKey)?.content || 'Sub-space');
      profile.stamps[spaceKey] = { name, firstVisit: now };
    }

    // footprints: away > 6h → a trail that wanders past the stalest blocks
    const lastSeen = profile.lastSeen[spaceKey] || 0;
    if (lastSeen && now - lastSeen > 6 * 3600_000) {
      const p = perceive(store.objects, spaceKey === 'root' ? undefined : spaceKey, now);
      const stops = p.stale.slice(0, 3).map((o) => ({ x: o.x + o.width / 2, y: o.y + o.height + 26 }));
      if (stops.length) {
        const prints: PawPrint[] = [];
        let from = { x: sim.x, y: sim.y };
        for (const stop of stops) {
          const d = Math.hypot(stop.x - from.x, stop.y - from.y);
          const steps = Math.min(14, Math.max(3, Math.floor(d / 34)));
          for (let i = 1; i <= steps && prints.length < 40; i++) {
            const t = i / steps;
            const nx = from.x + (stop.x - from.x) * t + Math.sin(t * 7) * 14;
            const ny = from.y + (stop.y - from.y) * t + Math.cos(t * 5) * 10;
            prints.push({
              x: nx, y: ny,
              angle: Math.atan2(stop.y - from.y, stop.x - from.x),
              flip: i % 2 === 0,
            });
          }
          from = stop;
        }
        setPawTrail(prints);
        setTrailFading(false);
        // the cat is found at the end of its trail
        sim.x = from.x; sim.y = from.y;
      }
    }
    profile.lastSeen[spaceKey] = now;

    // nest: lazily claim a quiet corner of this space
    let n = profile.nests[spaceKey] || null;
    if (!n) {
      const solid = objects.filter((o) => o.type !== 'arrow' && o.type !== 'drawing');
      if (solid.length >= 3) {
        const minX = Math.min(...solid.map((o) => o.x));
        const maxX = Math.max(...solid.map((o) => o.x + o.width));
        const minY = Math.min(...solid.map((o) => o.y));
        const maxY = Math.max(...solid.map((o) => o.y + o.height));
        const rng = brainRef.current.rng;
        const corner = Math.floor(rng() * 4);
        n = {
          x: corner % 2 === 0 ? minX - 200 - rng() * 120 : maxX + 200 + rng() * 120,
          y: corner < 2 ? minY - 120 - rng() * 80 : maxY + 120 + rng() * 80,
          scraps: [],
        };
        profile.nests[spaceKey] = n;
      }
    }
    setNest(n ? { ...n, scraps: [...n.scraps] } : null);
    persist();

    const seenTimer = setInterval(() => {
      profile.lastSeen[spaceKey] = Date.now();
      profile.pos[spaceKey] = { x: simRef.current.x, y: simRef.current.y };
      persist();
    }, 20_000);
    return () => {
      profile.lastSeen[spaceKey] = Date.now();
      profile.pos[spaceKey] = { x: simRef.current.x, y: simRef.current.y };
      persist();
      clearInterval(seenTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceKey, enabled, readOnly]);

  /* ---------- scrap hoarding: deleted blocks leave a keepsake ---------- */
  useEffect(() => {
    if (!enabled || readOnly) return;
    const known = knownObjectsRef.current;
    const snapshot = (objs: CanvasObjectData[]) => {
      const ids = new Set<string>();
      for (const o of objs) {
        ids.add(o.id);
        if (!known.has(o.id)) {
          const word = ((o.content || '').trim().split(/\s+/)[0] || '').slice(0, 12);
          const color = (o.style?.color as string) || (o.type === 'sticky' ? '#FFF8DC' : '#C97B4B');
          known.set(o.id, { word, color });
        }
      }
      return ids;
    };
    snapshot(useCanvasStore.getState().objects);
    const unsub = useCanvasStore.subscribe((state) => {
      const ids = snapshot(state.objects);
      const removed: { word: string; color: string }[] = [];
      for (const [id, scrap] of known) {
        if (!ids.has(id)) {
          known.delete(id);
          removed.push(scrap);
        }
      }
      // A workspace swap or bulk clear is not "the user threw something away" —
      // hoarding 30 scraps at once would give the game away.
      if (removed.length === 0 || removed.length > 4) return;
      const profile = profileRef.current;
      const n = profile.nests[spaceKey];
      if (!n) return;
      for (const scrap of removed) {
        if ((scrap.word || scrap.color) && n.scraps.length < 14) {
          n.scraps.push({ word: scrap.word, color: scrap.color });
        }
      }
      persist();
      setNest({ ...n, scraps: [...n.scraps] });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceKey, enabled, readOnly]);

  /* ---------- global reward events ---------- */
  useEffect(() => {
    if (!enabled || readOnly) return;
    const celebrate = (text: string) => {
      const sim = simRef.current;
      if (sim.dragging || sim.falling) return;
      sim.behavior = { kind: 'celebrate', dwell: 2800 };
      sim.phase = 'dwell';
      sim.dwellUntil = performance.now() + 2800;
      sim.pose = 'celebrate';
      sim.poseT = 0;
      sim.bubble = text;
      sim.bubbleUntil = performance.now() + 2600;
    };
    const onPomodoro = () => {
      profileRef.current.pomodoros += 1;
      persist();
      bumpCard((v) => v + 1);
      celebrate('task complete!');
    };
    const onGoal = () => {
      profileRef.current.medalUntil = Date.now() + 24 * 3600_000;
      persist();
      bumpCard((v) => v + 1);
      celebrate('nice one');
    };
    window.addEventListener('mindspace:pomodoro-complete', onPomodoro);
    window.addEventListener('mindspace:goal-complete', onGoal);
    return () => {
      window.removeEventListener('mindspace:pomodoro-complete', onPomodoro);
      window.removeEventListener('mindspace:goal-complete', onGoal);
    };
  }, [enabled, readOnly, persist]);

  /* ---------- cursor tracking (screen → world, with velocity) ---------- */
  useEffect(() => {
    if (!enabled || readOnly) return;
    const onMove = (e: MouseEvent) => {
      const cam = useCanvasStore.getState().camera;
      const c = cursorRef.current;
      const now = performance.now();
      const dt = Math.max(8, now - c.t);
      const wx = (e.clientX - cam.x) / cam.zoom;
      const wy = (e.clientY - cam.y) / cam.zoom;
      c.vx = ((wx - c.wx) / dt) * 1000;
      c.vy = ((wy - c.wy) / dt) * 1000;
      c.sx = e.clientX; c.sy = e.clientY; c.wx = wx; c.wy = wy; c.t = now;
      if (pawTrail.length && !trailFading) setTrailFading(true);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, readOnly, pawTrail.length, trailFading]);

  /* ================================================================
     THE LOOP — physics, brain ticks, and the sprite blitter
     ================================================================ */
  useEffect(() => {
    if (!enabled || readOnly) return;
    sheetRef.current = getSheet(personaRef.current.coat);
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const sim = simRef.current;
      const persona = personaRef.current;
      const brain = brainRef.current;
      const rng = brain.rng;
      const busy = sim.dragging || sim.falling;

      /* ---------- attention: the cursor makes it LOOK, not move ---------- */
      const c = cursorRef.current;
      const cx = sim.x, cy = sim.y - 26 * ART_PX; // roughly the head
      const dCursor = Math.hypot(c.wx - cx, c.wy - cy);
      const nearCursor = dCursor < 170;

      if (nearCursor && !busy) {
        if (sim.attentive < 0.01) sim.attentiveSince = now;
        sim.attentive = Math.min(1, sim.attentive + dt * 4);
        const dx = c.wx - cx, dy = c.wy - cy;
        const m = Math.max(1, Math.hypot(dx, dy));
        sim.lookX = dx / m;
        sim.lookY = dy / m;
        // petting: cursor resting ON the cat
        const onCat = Math.abs(c.wx - sim.x) < 34 && c.wy > sim.y - 52 && c.wy < sim.y + 6;
        const cursorSpeed = Math.hypot(c.vx, c.vy);
        if (onCat && cursorSpeed < 260 && (sim.pose === 'sit' || sim.pose === 'stand' || sim.pose === 'sleep')) {
          sim.petMs += dt * 1000;
          if (sim.petMs > 1200 && now - sim.lastPurr > 8000) {
            sim.lastPurr = now;
            sim.slowBlinkT = 0.0001; // a slow, trusting blink
            sim.petMs = 0;
          }
        } else {
          sim.petMs = Math.max(0, sim.petMs - dt * 2000);
        }
        // a cursor RUSHING at the cat startles it (and wakes it)
        const approach = ((cx - c.wx) * c.vx + (cy - c.wy) * c.vy) / Math.max(1, dCursor);
        if (dCursor < 150 && approach > 1300 && sim.pose !== 'startle') {
          sim.pose = 'startle';
          sim.poseT = 0;
          sim.behavior = null;
          const away = Math.sign(cx - c.wx) || 1;
          sim.x += away * 12;
          sim.facing = (away < 0 ? 1 : -1) as 1 | -1; // face the threat
        }
      } else {
        sim.attentive = Math.max(0, sim.attentive - dt * 2);
        sim.petMs = 0;
      }

      /* ---------- blinking: sampled fresh every single time ---------- */
      if (sim.slowBlinkT > 0) {
        sim.slowBlinkT += dt * 1000;
        const t = sim.slowBlinkT;
        sim.eyeOpen = t < 600 ? 1 - (t / 600) * 0.9
          : t < 1050 ? 0.1
          : t < 1650 ? 0.1 + ((t - 1050) / 600) * 0.9
          : (sim.slowBlinkT = 0, 1);
      } else if (sim.blinkT > 0) {
        sim.blinkT += dt * 1000;
        sim.eyeOpen = sim.blinkT < 70 ? 1 - sim.blinkT / 70 : sim.blinkT < 140 ? (sim.blinkT - 70) / 70 : 1;
        if (sim.blinkT >= 140) {
          sim.blinkT = 0;
          // occasional double-blink — never a metronome
          sim.nextBlink = now + (rng() < 0.18 ? 180 + rng() * 120 : sampleRange(rng, persona.blinkMin, persona.blinkMax));
        }
      } else if (now >= sim.nextBlink && sim.pose !== 'sleep') {
        sim.blinkT = 0.001;
      }
      if (sim.pose === 'sleep') sim.eyeOpen = 0;

      /* ---------- ear flicks (a frame swap, held briefly) ---------- */
      if (sim.earFlick <= 0 && sim.pose !== 'sleep' && rng() < persona.earTwitchiness * dt) {
        sim.earFlick = 170;
      }
      sim.earFlick = Math.max(0, sim.earFlick - dt * 1000);

      /* ---------- the fall after a drop ---------- */
      if (sim.falling) {
        sim.fallVY += 1500 * dt;
        sim.y += sim.fallVY * dt;
        if (sim.y >= sim.landY) {
          sim.y = sim.landY;
          sim.falling = false;
          sim.fallVY = 0;
          sim.pose = 'squash';       // absorb the landing before standing up
          sim.poseT = 0;
          profileRef.current.pos[spaceKey] = { x: sim.x, y: sim.y };
          persist();
          nextThinkRef.current = now + 1400;
        }
      }

      /* ---------- brain: choose / advance behaviors ---------- */
      const scripted = sim.pose === 'startle' || sim.pose === 'squash';
      if (!busy && !scripted) {
        if (!sim.behavior && now >= nextThinkRef.current) {
          const store = useCanvasStore.getState();
          const p = perceive(store.objects, spaceKey === 'root' ? undefined : spaceKey, Date.now());
          const b = chooseBehavior(brain, p, persona, { x: sim.x, y: sim.y }, Date.now(), nest);
          sim.behavior = b;
          sim.phase = b.target ? 'travel' : 'dwell';
          sim.travelDeadline = now + 22_000;
          if (!b.target) {
            sim.dwellUntil = now + b.dwell;
            enterDwellPose(sim, b);
          }
          brain.lastDone[b.kind] = Date.now();
          nextThinkRef.current = now + 400 + rng() * 500;
        }

        const b = sim.behavior;
        if (b) {
          if (sim.phase === 'travel' && b.target) {
            // steering — accelerate, arc, settle; never teleport-snappy
            const dx = b.target.x - sim.x;
            const dy = b.target.y - sim.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 8 || now > sim.travelDeadline) {
              sim.phase = 'dwell';
              sim.dwellUntil = now + b.dwell;
              sim.vx = 0; sim.vy = 0;
              enterDwellPose(sim, b);
            } else {
              const sp = persona.walkSpeed * (dist < 60 ? 0.55 : 1);
              const tx = (dx / dist) * sp;
              const ty = (dy / dist) * sp;
              sim.vx += (tx - sim.vx) * Math.min(1, dt * 3.2);
              sim.vy += (ty - sim.vy) * Math.min(1, dt * 3.2);
              const mx = sim.vx * dt, my = sim.vy * dt;
              sim.x += mx;
              sim.y += my;
              // the gait is driven by ground covered, so the paws don't skate
              sim.stridePhase += Math.hypot(mx, my) / STRIDE;
              if (Math.abs(sim.vx) > 4) sim.facing = (sim.vx > 0 ? 1 : -1) as 1 | -1;
              if (sim.pose !== 'walk') { sim.pose = 'walk'; sim.poseT = 0; }
            }
          } else {
            // dwell payloads
            advanceDwell(sim, b, now, dt, rng);
            if (now >= sim.dwellUntil) {
              sim.behavior = null;
              if (sim.pose !== 'sleep') { sim.pose = 'stand'; sim.poseT = 0; }
              nextThinkRef.current = now + 150 + rng() * 400;
            }
          }
        }
      }

      if (sim.pose === 'startle' && sim.poseT > 620) { sim.pose = 'stand'; sim.poseT = 0; }
      if (sim.pose === 'squash' && sim.poseT > 240) { sim.pose = 'stand'; sim.poseT = 0; }

      sim.poseT += dt * 1000;

      /* ---------- push to the DOM ---------- */
      const sheet = sheetRef.current;
      const frame = sheet?.[frameNameFor(sim)];
      const wrap = wrapRef.current;
      if (wrap && frame) {
        // whole-art-pixel positions only; fractional ones shimmer as they move
        const rx = Math.round(sim.x / ART_PX) * ART_PX;
        const ry = Math.round(sim.y / ART_PX) * ART_PX;
        const ax = sim.facing < 0 ? ART_W - frame.anchorX : frame.anchorX;
        wrap.style.left = `${rx - ax * ART_PX}px`;
        wrap.style.top = `${ry - ART_H * ART_PX}px`;
      }
      const shadow = shadowRef.current;
      if (shadow) {
        // the shadow is the only cue that the jump leaves the ground
        const airborne = sim.pose === 'celebrate' && frameNameFor(sim) === POSE_FRAMES.celebrate[1];
        const wide = sim.pose === 'sleep' || sim.pose === 'squash';
        shadow.style.opacity = String(airborne ? 0.07 : 0.16);
        shadow.style.transform = `translateX(-50%) scaleX(${wide ? 1.2 : airborne ? 0.7 : 1})`;
      }
      const bubble = bubbleRef.current;
      if (bubble) {
        const show = !!sim.bubble && now < sim.bubbleUntil;
        bubble.style.opacity = show ? '1' : '0';
        bubble.style.transform = show ? 'translateY(0)' : 'translateY(4px)';
        const label = bubble.firstElementChild as HTMLElement | null;
        if (show && label && label.textContent !== sim.bubble) label.textContent = sim.bubble;
      }

      drawSprite(sim, frame);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readOnly, spaceKey, nest]);

  /* ---------- behavior helpers ---------- */

  function enterDwellPose(sim: Sim, b: Behavior) {
    sim.poseT = 0;
    sim.perchStage = 0;
    sim.ropeT = 0;
    // scripted behaviors own their own ending — give them room, they will
    // pull dwellUntil forward themselves when the script completes
    if (b.kind === 'tightrope' && b.connector) {
      sim.dwellUntil = performance.now() + Math.max(2600, b.connector.length * 22) + 1500;
    } else if (b.kind === 'perch_walk') {
      sim.dwellUntil = performance.now() + 24_000;
    }
    switch (b.kind) {
      case 'idle_sit': case 'countdown': case 'mirror': case 'timer_perch': case 'nest_visit':
        sim.pose = 'sit'; break;
      case 'groom': sim.pose = 'groom'; break;
      case 'stretch': sim.pose = 'stretch'; break;
      case 'sleep': sim.pose = 'sleep'; break;
      case 'tightrope': sim.pose = 'tightrope'; break;
      case 'perch_walk': sim.pose = 'perch'; break;
      case 'celebrate': sim.pose = 'celebrate'; break;
      default: sim.pose = 'stand';
    }
  }

  function advanceDwell(sim: Sim, b: Behavior, now: number, dt: number, rng: () => number) {
    const store = useCanvasStore.getState();
    switch (b.kind) {
      case 'tightrope': {
        const c = b.connector!;
        const dur = Math.max(2600, c.length * 22); // pace scales with rope length
        const before = { x: sim.x, y: sim.y };
        sim.ropeT = Math.min(1, sim.ropeT + (dt * 1000) / dur);
        const pt = ropePoint(c, sim.ropeT);
        sim.x = pt.x; sim.y = pt.y;
        sim.stridePhase += Math.hypot(sim.x - before.x, sim.y - before.y) / STRIDE;
        sim.facing = (Math.cos(pt.angle) >= 0 ? 1 : -1) as 1 | -1;
        sim.pose = 'tightrope';
        if (sim.ropeT >= 1) sim.dwellUntil = now; // done crossing
        break;
      }
      case 'perch_walk': {
        const obj = store.objects.find((o) => o.id === b.objId);
        if (!obj) { sim.dwellUntil = now; break; }
        sim.y = obj.y - 1;
        if (sim.perchStage === 0) {
          // walk the top edge
          const endX = obj.x + obj.width - 10;
          const step = 34 * dt;
          sim.x += step;
          sim.stridePhase += step / STRIDE;
          sim.facing = 1;
          sim.pose = 'perch';
          if (sim.x >= endX) { sim.perchStage = 1; sim.poseT = 0; }
        } else {
          // dismount — charts get the little slide, everything else a hop
          const slide = obj.style?.isChart === true;
          const t = Math.min(1, sim.poseT / (slide ? 460 : 320));
          sim.x += (slide ? 60 : 40) * dt;
          sim.y = obj.y - 1 + t * t * (obj.height + 1);
          if (t >= 1) sim.dwellUntil = now;
        }
        break;
      }
      case 'timer_perch': {
        const obj = store.objects.find((o) => o.id === b.objId);
        const ends = obj?.style?.timerEndsAt as number | null | undefined;
        if (!obj || typeof ends !== 'number' || ends < Date.now()) { sim.dwellUntil = now; break; }
        // stay glued to the block top even if the user drags the block
        sim.x = obj.x + obj.width * 0.5;
        sim.y = obj.y - 1;
        sim.pose = 'sit';
        break;
      }
      case 'countdown': {
        if (now - sim.lastBubble > 5200 && rng() < dt * 1.6) {
          sim.bubble = '!';
          sim.bubbleUntil = now + 1600;
          sim.lastBubble = now;
          sim.attentive = 1; // turns to look at you: "have you SEEN this?"
          sim.lookX = 0; sim.lookY = 0.3;
        }
        break;
      }
      case 'mirror': {
        if (sim.poseT > 1500 && sim.poseT < 1600 && !sim.bubble) {
          sim.bubble = '?';
          sim.bubbleUntil = now + 1500;
        }
        break;
      }
      case 'sleep': {
        // nothing to do — sleeping IS the behavior. Breathing lives in the frames.
        break;
      }
      default: break;
    }
  }

  /* ================================================================
     THE BLITTER — one baked frame, plus eyes that are actually alive
     ================================================================ */
  function drawSprite(sim: Sim, frame: CompiledFrame | undefined) {
    const cv = spriteRef.current;
    if (!cv || !frame) return;

    // match the backing store to the camera so one art pixel is one pixel block
    const zoom = useCanvasStore.getState().camera.zoom;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const k = Math.max(1, Math.min(10, Math.round(ART_PX * zoom * dpr)));
    if (k !== backingRef.current) {
      backingRef.current = k;
      cv.width = ART_W * k;
      cv.height = ART_H * k;
    }

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const pal = COATS[personaRef.current.coat % COATS.length];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.scale(k, k);
    if (sim.facing < 0) { ctx.translate(ART_W, 0); ctx.scale(-1, 1); }

    ctx.drawImage(frame.img, 0, 0);

    // Pupils are painted here rather than baked, so the cat can watch the
    // cursor without a second copy of every frame.
    const open = sim.eyeOpen;
    const localLookX = sim.facing < 0 ? -sim.lookX : sim.lookX;
    const track = sim.attentive > 0.25 ? 1 : 0;
    const px = track ? Math.round(Math.max(-1, Math.min(1, localLookX * 1.6))) : 0;
    const py = track ? Math.round(Math.max(-1, Math.min(1, sim.lookY * 1.6))) : 0;

    if (open > 0.32) {
      ctx.fillStyle = pal.pupil;
      for (let i = 0; i < frame.pupils.length; i++) {
        const p = frame.pupils[i];
        const eye = frame.eyes[i];
        const x = eye ? Math.max(eye.x, Math.min(eye.x + eye.w - p.w, p.x + px)) : p.x + px;
        const y = eye ? Math.max(eye.y, Math.min(eye.y + eye.h - p.h, p.y + py)) : p.y + py;
        ctx.fillRect(x, y, p.w, p.h);
      }
    }

    // lids close from the top; at the bottom of a blink the eye is one line
    if (open < 0.995) {
      for (const eye of frame.eyes) {
        const lid = Math.min(eye.h, Math.round(eye.h * (1 - open)));
        if (lid > 0) {
          ctx.fillStyle = pal.body;
          ctx.fillRect(eye.x, eye.y, eye.w, lid);
        }
        if (open < 0.2) {
          ctx.fillStyle = pal.detail;
          ctx.fillRect(eye.x, eye.y + Math.floor(eye.h / 2), eye.w, 1);
        }
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------------- pointer: drag, drop, click-for-card ---------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const sim = simRef.current;
    const cam = useCanvasStore.getState().camera;
    const wx = (e.clientX - cam.x) / cam.zoom;
    const wy = (e.clientY - cam.y) / cam.zoom;
    sim.dragging = true;
    sim.falling = false;
    sim.dragMoved = 0;
    sim.dragOff = { x: sim.x - wx, y: sim.y - wy };
    sim.behavior = null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    let lastX = e.clientX;

    const onMove = (ev: PointerEvent) => {
      const cam2 = useCanvasStore.getState().camera;
      const nwx = (ev.clientX - cam2.x) / cam2.zoom;
      const nwy = (ev.clientY - cam2.y) / cam2.zoom;
      sim.dragMoved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
      if (sim.dragMoved > 6 && sim.pose !== 'scruff') { sim.pose = 'scruff'; sim.poseT = 0; }
      sim.dragVX = (ev.clientX - lastX) * 3;
      lastX = ev.clientX;
      sim.x = nwx + sim.dragOff.x;
      sim.y = nwy + sim.dragOff.y + (sim.pose === 'scruff' ? 46 : 0); // hangs below the hand
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const wasDrag = sim.dragMoved > 6;
      sim.dragging = false;
      sim.dragVX = 0;
      if (wasDrag) {
        // let go and the cat DROPS — gravity, then a landing it has to absorb
        sim.falling = true;
        sim.fallVY = 40;
        sim.landY = sim.y + 16;
      } else {
        setCardOpen((v) => !v);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!enabled || readOnly || !profileRef.current) return null;

  const profile = profileRef.current;
  const persona = personaRef.current;
  const coat = COATS[persona.coat % COATS.length];
  const stamps = Object.values(profile.stamps);

  return (
    <>
      {/* returning-home footprint trail */}
      {pawTrail.map((p, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: p.x + (p.flip ? 6 : -6) * Math.cos(p.angle + Math.PI / 2),
            top: p.y + (p.flip ? 6 : -6) * Math.sin(p.angle + Math.PI / 2),
            transform: `translate(-50%,-50%) rotate(${p.angle + Math.PI / 2}rad)`,
            opacity: trailFading ? 0 : 0.34,
            transition: 'opacity 45s linear',
            zIndex: 5,
          }}
        >
          <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
            <ellipse cx="5" cy="8" rx="3" ry="2.6" fill="var(--text-tertiary)" />
            <circle cx="2" cy="4" r="1.1" fill="var(--text-tertiary)" />
            <circle cx="5" cy="3" r="1.1" fill="var(--text-tertiary)" />
            <circle cx="8" cy="4" r="1.1" fill="var(--text-tertiary)" />
          </svg>
        </div>
      ))}

      {/* the nest — twigs and hoarded scraps of deleted thoughts */}
      {nest && (
        <div
          className="absolute pointer-events-auto"
          style={{ left: nest.x, top: nest.y, transform: 'translate(-50%,-50%)', zIndex: 6 }}
          title={
            nest.scraps.length
              ? `${profile.name}'s nest — ` + nest.scraps.map((s) => (s.word ? `a word: “${s.word}”` : 'a torn corner')).join(' · ')
              : `${profile.name}'s nest — empty so far. Deleted things end up here as keepsakes.`
          }
        >
          <svg width="52" height="30" viewBox="0 0 52 30" style={{ imageRendering: 'pixelated' }} aria-hidden="true">
            <ellipse cx="26" cy="18" rx="24" ry="10" fill="#8A6B4A" opacity="0.9" />
            <ellipse cx="26" cy="16" rx="19" ry="7" fill="#6E5238" />
            <ellipse cx="26" cy="17" rx="14" ry="5" fill="#4E3A28" />
            {nest.scraps.slice(0, 12).map((s, i) => (
              <rect
                key={i}
                x={14 + (i % 6) * 4.2}
                y={13 + Math.floor(i / 6) * 4 + (i % 2)}
                width="3" height="3" rx="0.5"
                fill={s.color}
              />
            ))}
          </svg>
        </div>
      )}

      {/* the cat */}
      <div
        ref={wrapRef}
        className="absolute"
        style={{
          width: ART_W * ART_PX,
          height: ART_H * ART_PX,
          zIndex: 99999,
          cursor: 'grab',
          pointerEvents: 'auto',
        }}
        onPointerDown={onPointerDown}
      >
        <div
          ref={shadowRef}
          className="absolute pointer-events-none"
          style={{
            left: '50%', bottom: -2,
            width: ART_W * ART_PX * 0.45, height: 7,
            borderRadius: '50%',
            background: 'rgba(30,20,10,1)',
            opacity: 0.16,
            transform: 'translateX(-50%)',
            transition: 'opacity 0.12s, transform 0.12s',
          }}
        />
        <canvas
          ref={spriteRef}
          className="pointer-events-none"
          style={{
            width: ART_W * ART_PX,
            height: ART_H * ART_PX,
            imageRendering: 'pixelated',
            display: 'block',
          }}
        />
        <div
          ref={bubbleRef}
          className="absolute pointer-events-none"
          style={{
            left: '62%', bottom: '86%',
            opacity: 0,
            transition: 'opacity 0.16s, transform 0.16s',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              display: 'block',
              background: '#FFFDF8',
              color: '#1B1B22',
              border: '2px solid #1B1B22',
              borderRadius: 3,
              padding: '2px 5px',
              fontSize: 9,
              lineHeight: '11px',
              fontWeight: 800,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: '0.02em',
            }}
          />
          {/* the little pixel tail on the bubble */}
          <span
            style={{
              position: 'absolute', left: 5, top: '100%',
              width: 0, height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '5px solid #1B1B22',
            }}
          />
        </div>
      </div>

      {/* profile card — click the cat */}
      {cardOpen && (
        <div
          className="absolute glass-panel"
          style={{
            left: simRef.current.x + 46,
            top: simRef.current.y - 150,
            width: 216,
            zIndex: 100000,
            padding: '12px 14px',
            fontFamily: "'Outfit', sans-serif",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2" style={{ marginBottom: 6 }}>
            <input
              value={profile.name}
              onChange={(e) => {
                profileRef.current.name = e.target.value;
                persist();
                bumpCard((v) => v + 1);
              }}
              className="bg-transparent outline-none text-[13px] font-extrabold text-[var(--text-primary)] min-w-0 flex-1 border-b border-transparent focus:border-[var(--accent)]"
              aria-label="Cat name"
            />
            <button
              onClick={() => setCardOpen(false)}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)] font-semibold" style={{ marginBottom: 8 }}>
            {coat.name} · resident of this board
          </div>

          <div className="flex flex-col gap-1 text-[10.5px] text-[var(--text-secondary)]">
            <div className="flex justify-between">
              <span>Focus sessions kept company</span>
              <span className="font-extrabold tabular-nums">{profile.pomodoros}</span>
            </div>
            <div className="flex justify-between">
              <span>Canvases visited</span>
              <span className="font-extrabold tabular-nums">{stamps.length}</span>
            </div>
            {nest && (
              <div className="flex justify-between">
                <span>Keepsakes in the nest</span>
                <span className="font-extrabold tabular-nums">{nest.scraps.length}</span>
              </div>
            )}
          </div>

          {stamps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]" style={{ marginBottom: 3 }}>
                Passport
              </div>
              <div className="flex flex-wrap gap-1">
                {stamps.slice(0, 6).map((s, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-bold rounded-full text-[var(--accent)]"
                    style={{ background: 'rgba(201,123,75,0.12)', padding: '2px 7px' }}
                    title={`First visited ${new Date(s.firstVisit).toLocaleDateString()}`}
                  >
                    {s.name.slice(0, 14) || 'unnamed'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-[9px] text-[var(--text-muted)]" style={{ marginTop: 8 }}>
            {profile.pomodoros >= 100
              ? 'Has sat through 100 focus sessions with you.'
              : `${100 - profile.pomodoros} more focus sessions and it'll have sat through a hundred.`}
          </div>
        </div>
      )}
    </>
  );
}
