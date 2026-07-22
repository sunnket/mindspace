'use client';

/**
 * The Canvas Resident — a pixel cat that lives on the board.
 *
 * Design rules this file works hard to honor:
 *  - It's a companion, not a screensaver. It reacts to YOU (cursor proximity
 *    makes it LOOK — pupils first, then a head turn — not move) and to the
 *    canvas (piles, connectors, running pomodoros, urgent countdowns, mirrors).
 *  - Nothing repeats identically. Blink timing, ear flicks, tail speed, idle
 *    durations all come from a persisted per-cat personality seed plus fresh
 *    randomness every cycle.
 *  - It never fights the user: drag it anywhere, it hangs by the scruff and
 *    resumes its life where you drop it.
 *
 * Rendering is a tiny <canvas> redrawn procedurally each frame (no sprite
 * sheets) so gait, tail physics and micro-expressions are continuous.
 * The wrapper lives inside .canvas-world, so the cat pans/zooms with the
 * board like any real resident of it.
 *
 * NOTE: Tailwind padding/margin utilities are dead in this app (unlayered
 * global reset) — all spacing is inline styles.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import {
  mulberry32, makePersonality, loadProfile, saveProfile,
  perceive, chooseBehavior, COAT_PALETTES,
  type CatProfile, type CatPersonality, type Behavior, type BrainState, type NestScrap,
} from '@/lib/catBrain';

/* ---------------- sprite geometry ---------------- */
const GW = 48;            // art-pixel grid width
const GH = 36;            // art-pixel grid height
const GY = 34;            // ground row (feet)
const PX = 3;             // device pixels per art pixel (crispness)
const SCALE = 1.4;        // world px per art pixel → cat ≈ 67 world px long
const TAIL_SEGS = 9;

type Pose =
  | 'stand' | 'walk' | 'sit' | 'sleep' | 'groom' | 'stretch'
  | 'scruff' | 'startle' | 'tightrope' | 'perch' | 'celebrate';

interface Sim {
  x: number; y: number;
  vx: number; vy: number;
  facing: 1 | -1;
  speed: number;
  gait: number;
  pose: Pose;
  poseT: number;
  behavior: Behavior | null;
  phase: 'travel' | 'dwell';
  dwellUntil: number;
  travelDeadline: number;
  // eyes
  eyeOpen: number;
  nextBlink: number;
  blinkT: number;          // >0 while a blink is in flight
  slowBlinkT: number;      // >0 while a slow blink is in flight
  // ears
  earFlickL: number;
  earFlickR: number;
  // attention
  attentive: number;       // 0..1 head-turn blend
  attentiveSince: number;
  lookX: number; lookY: number;
  headTilt: number;        // -1..1 target
  headTiltCur: number;
  petMs: number;
  lastPurr: number;
  // tail
  tail: number[];
  tailPuff: number;
  // tightrope / perch script
  ropeT: number;
  rotation: number;
  perchStage: number;
  // drag
  dragging: boolean;
  dragOff: { x: number; y: number };
  dragVX: number;
  dragMoved: number;
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
      vx: 0, vy: 0, facing: 1, speed: 0, gait: 0,
      pose: 'sit', poseT: 0,
      behavior: null, phase: 'dwell', dwellUntil: 0, travelDeadline: 0,
      eyeOpen: 1, nextBlink: performance.now() + 2000, blinkT: 0, slowBlinkT: 0,
      earFlickL: 0, earFlickR: 0,
      attentive: 0, attentiveSince: 0, lookX: 0, lookY: 0, headTilt: 0, headTiltCur: 0,
      petMs: 0, lastPurr: 0,
      tail: new Array(TAIL_SEGS).fill(-0.5),
      tailPuff: 0,
      ropeT: 0, rotation: 0, perchStage: 0,
      dragging: false, dragOff: { x: 0, y: 0 }, dragVX: 0, dragMoved: 0,
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
    const onPomodoro = () => {
      profileRef.current.pomodoros += 1;
      persist();
      bumpCard((v) => v + 1);
      celebrate('✓');
    };
    const onGoal = () => {
      profileRef.current.medalUntil = Date.now() + 24 * 3600_000;
      persist();
      bumpCard((v) => v + 1);
      celebrate('★');
    };
    const celebrate = (glyph: string) => {
      const sim = simRef.current;
      if (sim.dragging) return;
      sim.behavior = { kind: 'celebrate', dwell: 2600 };
      sim.phase = 'dwell';
      sim.dwellUntil = performance.now() + 2600;
      sim.pose = 'celebrate';
      sim.poseT = 0;
      sim.bubble = glyph;
      sim.bubbleUntil = performance.now() + 2200;
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
     THE LOOP — physics, brain ticks, and the pixel renderer
     ================================================================ */
  useEffect(() => {
    if (!enabled || readOnly) return;
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

      /* ---------- attention: the cursor makes it LOOK, not move ---------- */
      const c = cursorRef.current;
      const cx = sim.x, cy = sim.y - 24 * SCALE; // roughly the head
      const dCursor = Math.hypot(c.wx - cx, c.wy - cy);
      const nearCursor = dCursor < 170;

      if (nearCursor && !sim.dragging) {
        if (sim.attentive < 0.01) sim.attentiveSince = now;
        sim.attentive = Math.min(1, sim.attentive + dt * 4);
        const dx = c.wx - cx, dy = c.wy - cy;
        const m = Math.max(1, Math.hypot(dx, dy));
        sim.lookX = dx / m;
        sim.lookY = dy / m;
        // an occasional tiny head tilt once it's been watching a moment
        if (now - sim.attentiveSince > 900 && rng() < dt * 0.5) {
          sim.headTilt = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5);
        }
        // petting: cursor resting ON the cat
        const onCat = Math.abs(c.wx - sim.x) < 34 && c.wy > sim.y - 52 && c.wy < sim.y + 6;
        const cursorSpeed = Math.hypot(c.vx, c.vy);
        if (onCat && cursorSpeed < 260 && (sim.pose === 'sit' || sim.pose === 'stand' || sim.pose === 'sleep')) {
          sim.petMs += dt * 1000;
          if (sim.petMs > 1200 && now - sim.lastPurr > 8000) {
            sim.lastPurr = now;
            sim.slowBlinkT = 0.0001; // start a slow, trusting blink
            sim.petMs = 0;
          }
        } else {
          sim.petMs = Math.max(0, sim.petMs - dt * 2000);
        }
        // a cursor RUSHING at the cat startles it (and wakes it)
        const approach = ((cx - c.wx) * c.vx + (cy - c.wy) * c.vy) / Math.max(1, dCursor);
        if (dCursor < 150 && approach > 1300 && sim.pose !== 'startle' && !sim.dragging) {
          sim.pose = 'startle';
          sim.poseT = 0;
          sim.tailPuff = 1;
          sim.behavior = null;
          const away = Math.sign(cx - c.wx) || 1;
          sim.x += away * 12;
          sim.facing = (away < 0 ? 1 : -1) as 1 | -1; // face the threat
        }
      } else {
        sim.attentive = Math.max(0, sim.attentive - dt * 2);
        sim.headTilt *= Math.max(0, 1 - dt * 3);
        sim.petMs = 0;
      }
      sim.headTiltCur += (sim.headTilt - sim.headTiltCur) * Math.min(1, dt * 8);

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

      /* ---------- ear flicks ---------- */
      if (sim.pose !== 'sleep' || rng() < 0.3) {
        if (sim.earFlickL <= 0 && rng() < persona.earTwitchiness * dt) sim.earFlickL = 140;
        if (sim.earFlickR <= 0 && rng() < persona.earTwitchiness * dt * 0.8) sim.earFlickR = 140;
      }
      sim.earFlickL = Math.max(0, sim.earFlickL - dt * 1000);
      sim.earFlickR = Math.max(0, sim.earFlickR - dt * 1000);

      /* ---------- brain: choose / advance behaviors ---------- */
      if (!sim.dragging && sim.pose !== 'startle') {
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
              sim.x += sim.vx * dt;
              sim.y += sim.vy * dt;
              if (Math.abs(sim.vx) > 4) sim.facing = (sim.vx > 0 ? 1 : -1) as 1 | -1;
              sim.pose = 'walk';
            }
          } else {
            // dwell payloads
            advanceDwell(sim, b, now, dt, rng);
            if (now >= sim.dwellUntil) {
              sim.behavior = null;
              sim.rotation = 0;
              if (sim.pose !== 'sleep') sim.pose = 'stand';
              nextThinkRef.current = now + 150 + rng() * 400;
            }
          }
        }
      }

      if (sim.pose === 'startle') {
        sim.poseT += dt * 1000;
        if (sim.poseT > 520) { sim.pose = 'stand'; sim.poseT = 0; }
      }
      sim.tailPuff = Math.max(0, sim.tailPuff - dt * 0.4);

      /* ---------- gait + speed ---------- */
      sim.speed = Math.hypot(sim.vx, sim.vy);
      if (sim.pose === 'walk' || sim.pose === 'tightrope' || sim.pose === 'perch') {
        sim.gait += dt * (3.2 + sim.speed * 0.055);
      }
      sim.poseT += dt * 1000;

      /* ---------- tail spring physics ---------- */
      updateTail(sim, persona, dt, now);

      /* ---------- push to the DOM ---------- */
      const wrap = wrapRef.current;
      if (wrap) {
        wrap.style.left = `${sim.x}px`;
        wrap.style.top = `${sim.y}px`;
        wrap.style.transform = `translate(-50%, -100%) rotate(${sim.rotation}rad)`;
      }
      const shadow = shadowRef.current;
      if (shadow) {
        const lift = sim.pose === 'celebrate' ? Math.abs(Math.sin(sim.poseT / 130)) : 0;
        shadow.style.opacity = String(0.18 - lift * 0.1);
        shadow.style.transform = `translateX(-50%) scaleX(${sim.pose === 'sleep' ? 1.15 : 1 - lift * 0.25})`;
      }
      const bubble = bubbleRef.current;
      if (bubble) {
        const show = sim.bubble && now < sim.bubbleUntil;
        bubble.style.opacity = show ? '1' : '0';
        bubble.style.transform = show ? 'translateY(0) scale(1)' : 'translateY(4px) scale(0.6)';
        if (show) bubble.textContent = sim.bubble;
      }

      drawCat(sim, persona, profileRef.current);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readOnly, spaceKey, nest]);

  /* ---------- behavior helpers (module-scope-ish, close over nothing) ---------- */

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
        sim.ropeT = Math.min(1, sim.ropeT + (dt * 1000) / dur);
        const pt = ropePoint(c, sim.ropeT);
        sim.x = pt.x; sim.y = pt.y;
        const balance = Math.sin(sim.poseT / 260) * 0.06 + Math.sin(sim.poseT / 730) * 0.04;
        sim.rotation = Math.max(-0.55, Math.min(0.55, pt.angle * (Math.abs(pt.angle) > Math.PI / 2 ? 0 : 1))) + balance;
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
          sim.x += 34 * dt;
          sim.facing = 1;
          sim.pose = 'perch';
          if (sim.x >= endX) { sim.perchStage = 1; sim.poseT = 0; }
        } else {
          // dismount — charts get the little slide, everything else a hop
          const slide = obj.style?.isChart === true;
          const t = Math.min(1, sim.poseT / (slide ? 460 : 320));
          sim.x += (slide ? 60 : 40) * dt;
          sim.y = obj.y - 1 + t * t * (obj.height + 1);
          sim.rotation = slide ? 0.3 * (1 - t) : 0;
          if (t >= 1) { sim.rotation = 0; sim.dwellUntil = now; }
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
        // stare, tilt, one experimental paw
        if (sim.poseT > 1500 && sim.poseT < 1600 && !sim.bubble) {
          sim.bubble = '?';
          sim.bubbleUntil = now + 1500;
        }
        if (rng() < dt * 0.7) sim.headTilt = (rng() < 0.5 ? -1 : 1) * 0.8;
        break;
      }
      case 'sleep': {
        // nothing to do — sleeping IS the behavior. Breathing lives in the draw.
        break;
      }
      default: break;
    }
  }

  /* ---------- tail ---------- */
  function updateTail(sim: Sim, persona: CatPersonality, dt: number, now: number) {
    const t = now / 1000;
    const excited = sim.pose === 'celebrate' || sim.tailPuff > 0.4;
    const lashing = sim.attentive > 0.6 && (sim.pose === 'sit' || sim.pose === 'stand');
    const asleep = sim.pose === 'sleep';
    const speedMul = asleep ? 0.15 : lashing ? 1.9 : excited ? 2.2 : 1;
    const ampMul = asleep ? 0.12 : lashing ? 1.5 : excited ? 1.3 : 1;
    for (let i = 0; i < TAIL_SEGS; i++) {
      const k = i / (TAIL_SEGS - 1);
      let base: number;
      if (sim.pose === 'walk' || sim.pose === 'stand' || sim.pose === 'perch') {
        base = -0.9 - k * 0.9; // relaxed up-curve
      } else if (sim.pose === 'tightrope') {
        base = -1.5 - k * 0.4 - sim.rotation * 2.2 * k; // counter-balance pole
      } else if (sim.pose === 'startle' || sim.tailPuff > 0.5) {
        base = -1.5 - k * 0.2;
      } else if (asleep) {
        base = 0.6 + k * 2.4; // wrapped around the body
      } else if (sim.pose === 'celebrate') {
        base = -1.6 - k * 0.2;
      } else {
        base = -0.4 - k * 1.4; // sitting: draped
      }
      const wave = Math.sin(t * persona.tailSpeed * 2.4 * speedMul + i * 0.62) * 0.14 * ampMul * (0.3 + k);
      const target = base + wave;
      sim.tail[i] += (target - sim.tail[i]) * Math.min(1, dt * (5 + k * 5));
    }
  }

  /* ================================================================
     THE PIXEL CAT — drawn from scratch every frame
     ================================================================ */
  function drawCat(sim: Sim, persona: CatPersonality, profile: CatProfile) {
    const cv = spriteRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const pal = COAT_PALETTES[persona.coat % COAT_PALETTES.length];
    ctx.clearRect(0, 0, GW * PX, GH * PX);
    ctx.save();
    ctx.scale(PX, PX);
    if (sim.facing < 0) { ctx.translate(GW, 0); ctx.scale(-1, 1); }

    const px = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    const month = new Date().getMonth();
    const hasScarf = month === 11 || month === 0 || month === 1;
    const hasHat = profile.pomodoros >= 100;
    const hasMedal = profile.medalUntil > Date.now();

    /* --- tail (drawn first, behind the body) --- */
    const drawTail = (baseX: number, baseY: number) => {
      let tx = baseX, ty = baseY, ang = Math.PI; // start pointing backward
      const size = sim.tailPuff > 0.4 ? 3 : 2;
      for (let i = 0; i < TAIL_SEGS; i++) {
        ang = Math.PI + sim.tail[i];
        tx += Math.cos(ang) * 2.1;
        ty += Math.sin(ang) * 2.1;
        const ring = pal.stripe && i % 3 === 2 ? pal.stripe : i >= TAIL_SEGS - 2 ? pal.dark : pal.body;
        px(tx - size / 2, ty - size / 2, size, size, ring);
      }
    };

    /* --- ears (shared by profile + front heads) --- */
    const ear = (x: number, y: number, flick: number, inner: boolean) => {
      const drop = flick > 0 ? 1 : 0;
      px(x, y + 2 + drop, 4, 2, pal.body);
      px(x + 1, y + drop, 2, 2, pal.body);
      if (inner && flick <= 0) px(x + 1, y + 2, 1, 1, pal.earInner);
    };

    /* --- eyes --- */
    const eye = (x: number, y: number, pupilShift: number) => {
      px(x, y, 2, 2, pal.eye);
      const open = sim.eyeOpen;
      if (open > 0.15) {
        px(x + Math.max(0, Math.min(1, pupilShift)), y + (sim.lookY > 0.4 ? 1 : 0), 1, open > 0.6 ? 2 : 1, '#1B1B1F');
      }
      const lid = Math.round((1 - open) * 2);
      if (lid > 0) px(x, y, 2, lid, pal.body);
    };

    const attentiveHead = sim.attentive > 0.55 && sim.pose !== 'sleep' && sim.pose !== 'scruff' && sim.pose !== 'stretch';
    const tiltPx = Math.round(sim.headTiltCur * 1.6);
    // pupils toward cursor, mapped into the sprite's local flip
    const pupilShift = sim.facing < 0 ? (sim.lookX < -0.2 ? 1 : 0) : (sim.lookX > 0.2 ? 1 : 0);

    const drawHeadProfile = (hx: number, hy: number) => {
      px(hx, hy, 11, 10, pal.body);
      px(hx + 9, hy + 5, 4, 4, pal.body);           // muzzle
      px(hx + 9, hy + 8, 3, 1, pal.belly);          // chin
      px(hx + 12, hy + 6, 1, 1, pal.nose);
      ear(hx, hy - 3, sim.earFlickL, true);
      ear(hx + 6, hy - 3, sim.earFlickR, true);
      eye(hx + 6, hy + 3, pupilShift);
      if (pal.stripe) { px(hx + 2, hy, 1, 3, pal.stripe); px(hx + 5, hy, 1, 2, pal.stripe); }
      if (hasHat) { px(hx - 1, hy - 4, 12, 2, '#3E63DD'); px(hx + 1, hy - 6, 8, 2, '#3E63DD'); px(hx + 4, hy - 7, 2, 1, '#F5EFE7'); }
    };

    const drawHeadFront = (hx: number, hy: number) => {
      // the over-the-shoulder look: both eyes on you
      const lY = hy + (tiltPx > 0 ? 1 : 0);
      const rY = hy + (tiltPx < 0 ? 1 : 0);
      px(hx, hy, 12, 11, pal.body);
      ear(hx - 1, lY - 3, sim.earFlickL, true);
      ear(hx + 8, rY - 3, sim.earFlickR, true);
      eye(hx + 2, lY + 4, pupilShift);
      eye(hx + 8, rY + 4, pupilShift);
      px(hx + 5, hy + 7, 2, 1, pal.nose);
      px(hx + 4, hy + 9, 4, 1, pal.belly);          // muzzle
      if (pal.stripe) px(hx + 5, hy, 2, 3, pal.stripe);
      if (hasHat) { px(hx - 1, hy - 4, 14, 2, '#3E63DD'); px(hx + 1, hy - 6, 10, 2, '#3E63DD'); px(hx + 5, hy - 7, 2, 1, '#F5EFE7'); }
    };

    const drawScarf = (x: number, y: number, w: number) => {
      px(x, y, w, 2, '#D64545');
      px(x + 1, y + 2, 2, 3, '#B93A3A');
    };

    /* ---------------- poses ---------------- */
    const bob = (sim.pose === 'walk' || sim.pose === 'perch' || sim.pose === 'tightrope')
      ? Math.round(Math.sin(sim.gait * 2) * 1) : 0;

    if (sim.pose === 'sleep') {
      const breathe = Math.sin(sim.poseT / 1100) > 0.6 ? 1 : 0;
      // curled loaf: stacked rows approximating a circle
      px(12, 26 - breathe, 20, 6 + breathe, pal.body);
      px(14, 22 - breathe, 16, 4, pal.body);
      px(17, 20 - breathe, 10, 2, pal.body);
      px(14, 30, 16, 2, pal.dark);
      // tucked head
      px(24, 22, 9, 8, pal.body);
      px(31, 26, 2, 2, pal.nose);
      px(26, 25, 4, 1, pal.dark);                    // closed eye line
      ear(24, 19, sim.earFlickL, false);
      ear(29, 19, sim.earFlickR, false);
      // tail wrapped to the nose
      px(10, 29, 16, 2, pal.stripe || pal.dark);
      px(24, 28, 3, 2, pal.dark);
      if (hasScarf) drawScarf(22, 28, 8);
    } else if (sim.pose === 'sit' || sim.pose === 'groom') {
      const grooming = sim.pose === 'groom';
      const lick = grooming ? Math.round(Math.sin(sim.poseT / 160) * 1) : 0;
      drawTail(11, 27);
      // haunches
      px(10, 18, 14, 10, pal.body);
      px(12, 16, 10, 2, pal.body);
      px(10, 28, 14, 4, pal.body);
      px(11, 31, 12, 1, pal.dark);
      // chest + front legs
      px(22, 14, 8, 18, pal.body);
      px(23, 20, 3, 12, pal.belly);
      px(23, 32, 2, 2, pal.body);
      px(27, 32, 2, 2, pal.body);
      if (grooming) {
        // one paw up, head bent to it
        px(27, 22 + lick, 3, 3, pal.body);
        drawHeadProfile(23, 8 + 2 + lick);
      } else if (attentiveHead) {
        drawHeadFront(21, 4);
      } else {
        drawHeadProfile(23, 6);
      }
      if (hasScarf) drawScarf(22, 13, 8);
      if (hasMedal) px(25, 16, 2, 2, '#E8C547');
    } else if (sim.pose === 'stretch') {
      const t = Math.min(1, sim.poseT / 700);
      const butt = Math.round(4 * t);
      drawTail(9, 20 - butt);
      px(8, 20 - butt, 12, 8, pal.body);             // raised rear
      px(9, 27, 2, 7, pal.body); px(15, 27, 2, 7, pal.body);
      px(18, 24, 12, 5, pal.body);                    // sloping back
      px(28, 27, 8, 3, pal.body);                     // chest low
      px(30, 30, 2, 4, pal.body); px(34, 30, 2, 4, pal.body); // front paws forward
      drawHeadProfile(32, 16);
    } else if (sim.pose === 'scruff') {
      // hanging from the cursor by the scruff — limp, judging you
      const sway = Math.round(Math.sin(sim.poseT / 300) * 1 + Math.max(-2, Math.min(2, sim.dragVX * 0.015)));
      px(19 + sway, 12, 10, 14, pal.body);
      px(21 + sway, 18, 6, 7, pal.belly);
      const dangle = (i: number) => Math.round(Math.sin(sim.poseT / 240 + i * 1.4) * 1);
      px(19 + sway, 26 + dangle(0), 2, 5, pal.body);
      px(22 + sway, 26 + dangle(1), 2, 6, pal.body);
      px(25 + sway, 26 + dangle(2), 2, 5, pal.body);
      px(27 + sway, 26 + dangle(3), 2, 6, pal.body);
      // tail hangs too
      px(23 + sway, 31, 2, 4, pal.stripe || pal.dark);
      // flat-eared, half-lidded head
      px(18 + sway, 2, 12, 11, pal.body);
      px(17 + sway, 3, 4, 2, pal.body); px(27 + sway, 3, 4, 2, pal.body); // flattened ears
      px(20 + sway, 7, 2, 1, pal.eye); px(26 + sway, 7, 2, 1, pal.eye);   // narrowed eyes
      px(23 + sway, 9, 2, 1, pal.nose);
    } else if (sim.pose === 'startle') {
      // the Halloween arch
      drawTail(9, 14);
      px(8, 16, 6, 8, pal.body);
      px(12, 12, 8, 10, pal.body);                    // arched middle
      px(18, 14, 8, 9, pal.body);
      px(9, 24, 2, 10, pal.body); px(13, 24, 2, 10, pal.body);
      px(21, 24, 2, 10, pal.body); px(25, 24, 2, 10, pal.body);
      px(24, 4, 11, 10, pal.body);                    // head high, eyes wide
      ear(24, 1, 0, true); ear(30, 1, 0, true);
      px(27, 8, 2, 2, pal.eye); px(31, 8, 2, 2, pal.eye);
      px(27, 8, 2, 2, '#1B1B1F'); px(31, 8, 2, 2, '#1B1B1F'); // dilated pupils
      px(34, 10, 1, 1, pal.nose);
    } else if (sim.pose === 'celebrate') {
      const hop = Math.abs(Math.sin(sim.poseT / 130)) * 5;
      const y0 = -Math.round(hop);
      drawTail(10, 17 + y0);
      px(9, 16 + y0, 22, 10, pal.body);
      px(11, 24 + y0, 18, 2, pal.belly);
      px(11, 26 + y0, 2, 8 - y0, pal.body); px(15, 26 + y0, 2, 8 - y0, pal.body);
      px(23, 26 + y0, 2, 8 - y0, pal.body); px(27, 26 + y0, 2, 8 - y0, pal.body);
      drawHeadFront(24, 5 + y0);
      if (hasScarf) drawScarf(26, 15 + y0, 8);
      if (hasMedal) px(29, 18 + y0, 2, 2, '#E8C547');
    } else {
      /* stand / walk / tightrope / perch — the workhorse pose */
      const bodyTop = 16 + bob;
      const bodyBot = 26 + bob;
      drawTail(10, bodyTop + 1);
      // legs — diagonal-pair gait, far legs darker for depth
      const legs = [
        { x: 12, ph: Math.PI, far: true },
        { x: 15, ph: 0, far: false },
        { x: 25, ph: 0, far: true },
        { x: 28, ph: Math.PI, far: false },
      ];
      const moving = sim.speed > 6 || sim.pose === 'perch' || sim.pose === 'tightrope';
      for (const leg of legs) {
        const lift = moving ? Math.max(0, Math.sin(sim.gait + leg.ph)) * 2 : 0;
        const stride = moving ? Math.cos(sim.gait + leg.ph) * 1.6 : 0;
        px(leg.x + stride, bodyBot, 2, GY - bodyBot - lift, leg.far ? pal.dark : pal.body);
      }
      // body
      px(9, bodyTop, 22, bodyBot - bodyTop, pal.body);
      px(10, bodyTop - 1, 20, 1, pal.body);
      px(11, bodyBot - 2, 18, 2, pal.belly);
      px(10, bodyBot, 20, 1, pal.dark);
      if (pal.stripe) for (let sx = 12; sx < 28; sx += 5) px(sx, bodyTop, 1, 4, pal.stripe);
      // head
      if (attentiveHead) drawHeadFront(26, 5 + bob);
      else drawHeadProfile(29, 7 + bob);
      if (hasScarf) drawScarf(27, bodyTop - 2, 8);
      if (hasMedal) px(30, bodyTop + 2, 2, 2, '#E8C547');
    }

    ctx.restore();
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
      if (sim.dragMoved > 6) sim.pose = 'scruff';
      sim.dragVX = (ev.clientX - lastX) * 3;
      lastX = ev.clientX;
      sim.x = nwx + sim.dragOff.x;
      sim.y = nwy + sim.dragOff.y + (sim.pose === 'scruff' ? 46 : 0); // hangs below the hand
      sim.rotation = 0;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const wasDrag = sim.dragMoved > 6;
      sim.dragging = false;
      sim.dragVX = 0;
      if (wasDrag) {
        sim.pose = 'stand';
        sim.poseT = 0;
        sim.tailPuff = 0.5;                     // mild indignity
        nextThinkRef.current = performance.now() + 2500; // a beat to recompose
        profileRef.current.pos[spaceKey] = { x: sim.x, y: sim.y };
        persist();
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
  const coat = COAT_PALETTES[persona.coat % COAT_PALETTES.length];
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
          width: GW * SCALE,
          height: GH * SCALE,
          zIndex: 99999,
          transform: 'translate(-50%, -100%)',
          cursor: 'grab',
          pointerEvents: 'auto',
        }}
        onPointerDown={onPointerDown}
      >
        <div
          ref={shadowRef}
          className="absolute pointer-events-none"
          style={{
            left: '50%', bottom: -3,
            width: GW * SCALE * 0.6, height: 8,
            borderRadius: '50%',
            background: 'rgba(30,20,10,1)',
            opacity: 0.16,
            transform: 'translateX(-50%)',
            transition: 'opacity 0.2s',
          }}
        />
        <canvas
          ref={spriteRef}
          width={GW * PX}
          height={GH * PX}
          className="pointer-events-none"
          style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
        />
        <div
          ref={bubbleRef}
          className="absolute pointer-events-none font-bold text-center"
          style={{
            left: '58%', top: -16,
            minWidth: 18, height: 18,
            lineHeight: '15px',
            fontSize: 11,
            fontFamily: 'monospace',
            background: '#FFFDFA',
            color: '#2D2A26',
            border: '2px solid #2D2A26',
            borderRadius: '7px 7px 7px 1px',
            padding: '0 3px',
            opacity: 0,
            transition: 'opacity 0.18s, transform 0.18s',
          }}
        />
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
              ? 'Earned the beanie. 100 focus sessions.'
              : `Beanie at 100 focus sessions (${100 - profile.pomodoros} to go)`}
          </div>
        </div>
      )}
    </>
  );
}
