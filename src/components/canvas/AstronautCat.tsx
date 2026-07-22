'use client';

/**
 * The Resident, suited up and adrift in the Constellation View.
 *
 * Same cat you already have — same personality seed, same ginger coat, same
 * baked sprite sheet — but weightless, in a helmet, wandering the night sky
 * your board becomes when you pull all the way out. It is deliberately NOT the
 * canvas resident (that one lives in world coordinates and perceives blocks);
 * up here there is no ground, no blocks, only stars, so this is the shallow,
 * screen-space cousin.
 *
 * Two hard rules carry over from the sprite work and must not be broken:
 *   - the pixel art is NEVER rotated (nearest-neighbour rotation shreds it), so
 *     "zero gravity" is translation + the authored barrel-roll frames, never a
 *     CSS rotate on the sprite;
 *   - positions snap to whole art pixels so the sprite doesn't shimmer as it
 *     drifts.
 *
 * The suit (glass dome, antenna, oxygen pack, hose) is an SVG overlay pinned to
 * the head each frame using the frame's own eye bounding box — so it tracks the
 * head across every pose without a second copy of the art.
 *
 * Mutable simulation lives in refs, not state — the same discipline as
 * CanvasResident, and the only pattern the immutability lint allows.
 */

import React, { useEffect, useRef } from 'react';
import { loadProfile, makePersonality, mulberry32, type CatPersonality } from '@/lib/catBrain';
import { ART_W, ART_H, POSE_FRAMES, COATS, getSheet, type Sheet, type CompiledFrame } from '@/lib/catSprites';

/** A touch larger than on the board — it's the hero of the empty sky. */
const ART_PX = 1.9;

type Pose = 'stand' | 'stretch' | 'roll' | 'paw' | 'sit';

interface Sim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  pose: Pose;
  poseT: number;
  bob: number;
  targetX: number;
  targetY: number;
  until: number;
  eyeOpen: number;
  nextBlink: number;
  blinkT: number;
  earFlick: number;
  attentive: number;
  lookX: number;
  lookY: number;
  bubble: string;
  bubbleUntil: number;
  lastBubble: number;
}

/** Small, thematic, low-frequency. A companion that narrates constantly stops
 *  being read; these only surface every so often. */
const SPACE_LINES = [
  'weightless…', 'so much sky', 'one small step', 'is that a whole galaxy?',
  'floating', 'i see everything from here', 'stars everywhere', 'wheee',
  'to infinity', 'quiet up here', 'which one is home?', 'drifting',
];

function frameFor(sim: Sim): string {
  const t = sim.poseT;
  switch (sim.pose) {
    case 'roll': {
      // over and back — a barrel roll, not a spin in one direction
      const seq = [0, 1, 2, 3, 2, 1];
      return POSE_FRAMES.roll[seq[Math.floor(t / 240) % seq.length]];
    }
    case 'paw':
      return POSE_FRAMES.paw[Math.floor(t / 230) % 2];
    case 'sit': {
      const seq = sim.earFlick > 0 ? POSE_FRAMES.sitEar : POSE_FRAMES.sit;
      return seq[Math.floor(t / 1100) % seq.length];
    }
    case 'stretch': {
      const seq = [0, 1, 2, 2, 2, 2, 1, 0];
      return POSE_FRAMES.stretch[seq[Math.min(seq.length - 1, Math.floor(t / 340))]];
    }
    default: {
      if (sim.attentive > 0.55) {
        const a = POSE_FRAMES.standAttentive;
        return a[Math.floor(t / 1100) % a.length];
      }
      const seq = sim.earFlick > 0 ? POSE_FRAMES.standEar : POSE_FRAMES.stand;
      return seq[Math.floor(t / 1100) % seq.length];
    }
  }
}

export default function AstronautCat({ active }: { active: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  const domeRef = useRef<SVGGElement>(null);
  const packRef = useRef<SVGGElement>(null);
  const antennaTipRef = useRef<SVGCircleElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);

  // Everything mutable is created inside the effect and reached through refs
  // that are only ever written from effects / handlers — never during render.
  const simRef = useRef<Sim | null>(null);
  const backingRef = useRef(0);
  const cursorRef = useRef({ x: -9999, y: -9999 });
  const recentRef = useRef('');

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();

    // adopt the cat here (client-only, in an effect) — same seed / coat / sheet
    // as everywhere else, so it reads as the resident you already have.
    const profile = loadProfile();
    const persona: CatPersonality = makePersonality(profile.seed);
    const rng = mulberry32((profile.seed ^ (Date.now() & 0xffff)) >>> 0);
    const sheet: Sheet | null = getSheet(persona.coat);
    const cx0 = window.innerWidth * (0.35 + Math.random() * 0.3);
    const cy0 = window.innerHeight * (0.32 + Math.random() * 0.3);
    const sim: Sim = {
      x: cx0, y: cy0, vx: 0, vy: 0, facing: 1,
      pose: 'stand', poseT: 0, bob: Math.random() * Math.PI * 2,
      targetX: cx0, targetY: cy0, until: 0,
      eyeOpen: 1, nextBlink: performance.now() + 1600, blinkT: 0,
      earFlick: 0, attentive: 0, lookX: 0, lookY: 0,
      bubble: '', bubbleUntil: 0, lastBubble: 0,
    };
    simRef.current = sim;

    const speak = (line: string, now: number, gap = 16_000) => {
      if (now - sim.lastBubble < gap || line === recentRef.current) return;
      sim.bubble = line;
      sim.bubbleUntil = now + 2600;
      sim.lastBubble = now;
      recentRef.current = line;
    };

    const pickTarget = (now: number) => {
      const m = 120;
      sim.targetX = m + rng() * Math.max(1, window.innerWidth - m * 2);
      // keep clear of the title (top) and hint (bottom) bands
      sim.targetY = 130 + rng() * Math.max(1, window.innerHeight - 260);
      sim.until = now + 6000 + rng() * 7000;
    };

    const positionGear = (frame: CompiledFrame, facing: 1 | -1, now: number) => {
      const dome = domeRef.current;
      const pack = packRef.current;
      if (!dome || !pack) return;
      let hx = 26, hy = 11;
      if (frame.eyes.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const e of frame.eyes) {
          x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
          x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h);
        }
        hx = (x0 + x1) / 2; hy = (y0 + y1) / 2;
      }
      const artX = facing < 0 ? ART_W - hx : hx;
      const sx = artX * ART_PX;
      const sy = (hy - 2) * ART_PX;
      dome.setAttribute('transform', `translate(${sx.toFixed(1)}, ${sy.toFixed(1)})`);
      const rear = facing < 0 ? 1 : -1;
      pack.setAttribute(
        'transform',
        `translate(${(sx + rear * 12).toFixed(1)}, ${(sy + 20).toFixed(1)}) scale(${facing < 0 ? -1 : 1}, 1)`,
      );
      const tip = antennaTipRef.current;
      if (tip) tip.setAttribute('opacity', (0.55 + 0.45 * Math.abs(Math.sin(now / 380))).toFixed(2));
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(50, now - last) / 1000;
      last = now;

      const c = cursorRef.current;
      const headY = sim.y - 22 * ART_PX;
      const near = Math.hypot(c.x - sim.x, c.y - headY) < 200;
      if (near) {
        sim.attentive = Math.min(1, sim.attentive + dt * 4);
        const dx = c.x - sim.x, dy = c.y - headY;
        const m = Math.max(1, Math.hypot(dx, dy));
        sim.lookX = dx / m; sim.lookY = dy / m;
        if ((sim.pose === 'stand' || sim.pose === 'stretch') && Math.abs(dx) > 14) {
          sim.facing = (dx > 0 ? 1 : -1) as 1 | -1;
        }
      } else {
        sim.attentive = Math.max(0, sim.attentive - dt * 2);
      }

      // blinks
      if (sim.blinkT > 0) {
        sim.blinkT += dt * 1000;
        sim.eyeOpen = sim.blinkT < 70 ? 1 - sim.blinkT / 70 : sim.blinkT < 140 ? (sim.blinkT - 70) / 70 : 1;
        if (sim.blinkT >= 140) {
          sim.blinkT = 0;
          sim.nextBlink = now + (rng() < 0.18 ? 200 + rng() * 120 : persona.blinkMin + rng() * (persona.blinkMax - persona.blinkMin));
        }
      } else if (now >= sim.nextBlink) {
        sim.blinkT = 0.001;
      }
      if (sim.earFlick <= 0 && rng() < persona.earTwitchiness * dt) sim.earFlick = 170;
      sim.earFlick = Math.max(0, sim.earFlick - dt * 1000);

      // choose a new drifting behaviour
      if (now >= sim.until) {
        const roll = rng();
        if (roll < 0.5) { sim.pose = 'stand'; pickTarget(now); }
        else if (roll < 0.66) { sim.pose = 'roll'; sim.until = now + 3200; }
        else if (roll < 0.8) { sim.pose = 'stretch'; sim.until = now + 2700; pickTarget(now); }
        else if (roll < 0.9) { sim.pose = 'paw'; sim.until = now + 2600; }
        else { sim.pose = 'sit'; sim.until = now + 4000 + rng() * 4000; }
        sim.poseT = 0;
      }

      // drift toward the target — always gentle, this is zero-g
      const dx = sim.targetX - sim.x;
      const dy = sim.targetY - sim.y;
      const dist = Math.hypot(dx, dy);
      const drifting = sim.pose === 'stand' || sim.pose === 'stretch';
      if (drifting && dist > 4) {
        const sp = persona.walkSpeed * 0.42;
        sim.vx += ((dx / dist) * sp - sim.vx) * Math.min(1, dt * 1.6);
        sim.vy += ((dy / dist) * sp - sim.vy) * Math.min(1, dt * 1.6);
      } else {
        sim.vx += (0 - sim.vx) * Math.min(1, dt * 1.2);
        sim.vy += (0 - sim.vy) * Math.min(1, dt * 1.2);
      }
      sim.x += sim.vx * dt;
      sim.y += sim.vy * dt;
      sim.bob += dt * 1.4;
      sim.y += Math.sin(sim.bob) * 6 * dt; // a slow buoyant bob

      // soft walls — bounce back into the field rather than sticking to an edge
      const wm = 60;
      if (sim.x < wm) { sim.x = wm; sim.vx = Math.abs(sim.vx) * 0.5; sim.targetX = window.innerWidth * 0.5; }
      if (sim.x > window.innerWidth - wm) { sim.x = window.innerWidth - wm; sim.vx = -Math.abs(sim.vx) * 0.5; sim.targetX = window.innerWidth * 0.5; }
      if (sim.y < 110) { sim.y = 110; sim.vy = Math.abs(sim.vy) * 0.5; }
      if (sim.y > window.innerHeight - 110) { sim.y = window.innerHeight - 110; sim.vy = -Math.abs(sim.vy) * 0.5; }

      if (drifting && Math.abs(sim.vx) > 5) sim.facing = (sim.vx > 0 ? 1 : -1) as 1 | -1;
      sim.poseT += dt * 1000;

      if (rng() < dt * 0.06) speak(SPACE_LINES[Math.floor(rng() * SPACE_LINES.length)], now, 14_000);

      // ---- draw the sprite ----
      const frame = sheet?.[frameFor(sim)];
      const cv = spriteRef.current;
      const wrap = wrapRef.current;
      if (!frame || !cv || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.min(10, Math.round(ART_PX * dpr)));
      if (k !== backingRef.current) { backingRef.current = k; cv.width = ART_W * k; cv.height = ART_H * k; }

      const rx = Math.round(sim.x / ART_PX) * ART_PX;
      const ry = Math.round(sim.y / ART_PX) * ART_PX;
      const ax = sim.facing < 0 ? ART_W - frame.anchorX : frame.anchorX;
      wrap.style.left = `${rx - ax * ART_PX}px`;
      wrap.style.top = `${ry - ART_H * ART_PX}px`;

      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const pal = COATS[persona.coat % COATS.length];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      ctx.scale(k, k);
      if (sim.facing < 0) { ctx.translate(ART_W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(frame.img, 0, 0);

      const localLookX = sim.facing < 0 ? -sim.lookX : sim.lookX;
      const track = sim.attentive > 0.25 ? 1 : 0;
      const px = track ? Math.round(Math.max(-1, Math.min(1, localLookX * 1.6))) : 0;
      const py = track ? Math.round(Math.max(-1, Math.min(1, sim.lookY * 1.6))) : 0;
      if (sim.eyeOpen > 0.32) {
        ctx.fillStyle = pal.pupil;
        frame.pupils.forEach((p, i) => {
          const eye = frame.eyes[i];
          const x = eye ? Math.max(eye.x, Math.min(eye.x + eye.w - p.w, p.x + px)) : p.x + px;
          const y = eye ? Math.max(eye.y, Math.min(eye.y + eye.h - p.h, p.y + py)) : p.y + py;
          ctx.fillRect(x, y, p.w, p.h);
        });
      }
      if (sim.eyeOpen < 0.995) {
        for (const eye of frame.eyes) {
          const lid = Math.min(eye.h, Math.round(eye.h * (1 - sim.eyeOpen)));
          if (lid > 0) { ctx.fillStyle = pal.body; ctx.fillRect(eye.x, eye.y, eye.w, lid); }
          if (sim.eyeOpen < 0.2) { ctx.fillStyle = pal.detail; ctx.fillRect(eye.x, eye.y + Math.floor(eye.h / 2), eye.w, 1); }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      positionGear(frame, sim.facing, now);

      // ---- bubble ----
      const bubble = bubbleRef.current;
      const box = boxRef.current;
      if (bubble && box) {
        const show = !!sim.bubble && now < sim.bubbleUntil;
        bubble.style.opacity = show ? '1' : '0';
        if (show && box.textContent !== sim.bubble) box.textContent = sim.bubble;
      }
    };

    pickTarget(performance.now());
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); simRef.current = null; };
  }, [active]);

  if (!active) return null;

  const R = 12 * ART_PX; // dome radius, in screen px

  return (
    <div
      ref={wrapRef}
      onPointerDown={(e) => {
        // a poke sends it tumbling — a tiny bit of joy, never a fly-in
        e.stopPropagation();
        const s = simRef.current;
        if (!s) return;
        s.pose = 'roll';
        s.poseT = 0;
        s.until = performance.now() + 2600;
        s.bubble = 'wheee';
        s.bubbleUntil = performance.now() + 2200;
        s.lastBubble = performance.now();
      }}
      style={{
        position: 'fixed',
        width: ART_W * ART_PX,
        height: ART_H * ART_PX,
        zIndex: 6,
        pointerEvents: 'auto',
        cursor: 'grab',
        filter: 'drop-shadow(0 0 10px rgba(217,123,46,0.35))',
      }}
    >
      <canvas
        ref={spriteRef}
        style={{ width: ART_W * ART_PX, height: ART_H * ART_PX, imageRendering: 'pixelated', display: 'block' }}
      />

      {/* the suit — pinned to the head each frame */}
      <svg
        width={ART_W * ART_PX}
        height={ART_H * ART_PX}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="astro-glass" cx="0.38" cy="0.32" r="0.75">
            <stop offset="0%" stopColor="rgba(230,244,255,0.20)" />
            <stop offset="55%" stopColor="rgba(150,200,255,0.10)" />
            <stop offset="100%" stopColor="rgba(120,175,255,0.20)" />
          </radialGradient>
        </defs>

        {/* oxygen pack + hose (drawn first so the dome overlaps it) */}
        <g ref={packRef}>
          <path
            d={`M 0 -2 Q ${R * 0.7} -${R * 0.4} ${R * 0.9} -${R * 0.9}`}
            fill="none"
            stroke="#B9C2CC"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.85"
          />
          <rect x={-7} y={-4} width={14} height={17} rx={3} fill="#2A2622" stroke="#0E0C0A" strokeWidth="1" />
          <rect x={-4.5} y={-1.5} width={9} height={5} rx={1.5} fill="#3A342E" />
          <circle cx={-2.2} cy={8} r={1.3} fill="#FFB44D" />
          <circle cx={2.2} cy={8} r={1.3} fill="#5FD0FF" />
        </g>

        {/* glass dome */}
        <g ref={domeRef}>
          {/* faint warm halo, so the helmet belongs to a ginger cat in warm space */}
          <circle cx={0} cy={0} r={R + 2.5} fill="none" stroke="rgba(217,123,46,0.30)" strokeWidth="2.5" />
          <circle cx={0} cy={0} r={R} fill="url(#astro-glass)" stroke="#FFF4E4" strokeWidth="1.7" />
          {/* specular crescent */}
          <path
            d={`M ${-R * 0.55} ${-R * 0.35} A ${R * 0.7} ${R * 0.7} 0 0 1 ${-R * 0.05} ${-R * 0.72}`}
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          {/* antenna */}
          <line x1={0} y1={-R} x2={0} y2={-R - 6} stroke="#FFF4E4" strokeWidth="1.4" strokeLinecap="round" />
          <circle ref={antennaTipRef} cx={0} cy={-R - 7.5} r={2.1} fill="#FFB44D" />
        </g>
      </svg>

      {/* thought bubble */}
      <div
        ref={bubbleRef}
        style={{ position: 'absolute', left: '62%', bottom: '92%', opacity: 0, transition: 'opacity 0.18s' }}
      >
        <span
          ref={boxRef}
          style={{
            display: 'block', background: '#FFFDF8', color: '#1B1B22',
            border: '2px solid #1B1B22', borderRadius: 9, padding: '3px 6px',
            maxWidth: 130, width: 'max-content', textAlign: 'center',
            fontSize: 9, lineHeight: '11px', fontWeight: 800,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <span style={{ position: 'absolute', left: 6, top: '100%' }}>
          <span style={{ display: 'block', width: 5, height: 5, marginLeft: 2, background: '#FFFDF8', border: '2px solid #1B1B22', borderRadius: '50%' }} />
          <span style={{ display: 'block', width: 3, height: 3, marginTop: 1, background: '#FFFDF8', border: '2px solid #1B1B22', borderRadius: '50%' }} />
        </span>
      </div>
    </div>
  );
}
