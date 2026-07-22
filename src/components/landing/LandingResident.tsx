'use client';

/**
 * The same cat, loitering on the landing page.
 *
 * Deliberately NOT the canvas resident. That one lives in world coordinates
 * inside `.canvas-world`, perceives blocks, keeps a nest and a passport, and
 * needs a board to do any of it. None of that exists here, and bolting a fake
 * camera onto the landing page to reuse it would be far more code than this.
 *
 * So this is the shallow version: screen coordinates, a strip along the bottom
 * of the window to walk, and the same sprite sheet, personality seed and coat
 * as the real one — so it reads as the cat you already have, not a mascot.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { loadProfile, makePersonality, mulberry32, type CatPersonality } from '@/lib/catBrain';
import { pickThought, type ThoughtKind } from '@/lib/catThoughts';
import { ART_W, ART_H, POSE_FRAMES, COATS, getSheet, type Sheet } from '@/lib/catSprites';

const ART_PX = 1.6;
const STRIDE = 11;

type Pose = 'stand' | 'walk' | 'sit' | 'sleep' | 'groom' | 'stretch' | 'roll' | 'paw';

interface Sim {
  x: number;
  vx: number;
  facing: 1 | -1;
  stridePhase: number;
  pose: Pose;
  poseT: number;
  targetX: number | null;
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

function frameFor(sim: Sim): string {
  const t = sim.poseT;
  switch (sim.pose) {
    case 'walk': {
      const seq = POSE_FRAMES.walk;
      return seq[((Math.floor(sim.stridePhase) % seq.length) + seq.length) % seq.length];
    }
    case 'sit': {
      const seq = sim.earFlick > 0 ? POSE_FRAMES.sitEar : POSE_FRAMES.sit;
      return seq[Math.floor(t / 1100) % seq.length];
    }
    case 'groom': return POSE_FRAMES.groom[Math.floor(t / 280) % 2];
    case 'sleep': return POSE_FRAMES.sleep[Math.floor(t / 1600) % 2];
    case 'paw': return POSE_FRAMES.paw[Math.floor(t / 230) % 2];
    case 'roll': {
      const seq = [0, 1, 2, 3, 2, 1];
      return POSE_FRAMES.roll[seq[Math.floor(t / 280) % seq.length]];
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

export default function LandingResident() {
  const enabled = useCanvasStore((s) => s.residentEnabled);
  const wrapRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);

  const recentRef = useRef<Map<ThoughtKind, string>>(new Map());
  const backingRef = useRef(0);
  const cursorRef = useRef({ x: -9999, y: -9999 });

  /* Adopted once, lazily: loadProfile touches localStorage, so it can't run
     during render on the server. The landing page is already ssr:false, but a
     lazy initialiser keeps that from being load-bearing. */
  const [boot] = useState<{ sim: Sim; persona: CatPersonality; rng: () => number; sheet: Sheet | null } | null>(() => {
    if (typeof window === 'undefined') return null;
    const profile = loadProfile();
    const persona = makePersonality(profile.seed);
    return {
      persona,
      rng: mulberry32((profile.seed ^ Date.now()) >>> 0),
      sheet: getSheet(persona.coat),
      sim: {
        x: window.innerWidth * (0.25 + Math.random() * 0.5),
        vx: 0, facing: 1, stridePhase: 0,
        pose: 'sit', poseT: 0, targetX: null, until: 0,
        eyeOpen: 1, nextBlink: performance.now() + 1800, blinkT: 0,
        earFlick: 0, attentive: 0, lookX: 0, lookY: 0,
        bubble: '', bubbleUntil: 0, lastBubble: 0,
      },
    };
  });

  useEffect(() => {
    if (!enabled || !boot) return;
    const onMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [enabled, boot]);

  useEffect(() => {
    if (!enabled || !boot) return;
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const { sim, persona, rng } = boot;

      const groundY = window.innerHeight - 26;
      const headY = groundY - 26 * ART_PX;
      const c = cursorRef.current;
      const near = Math.hypot(c.x - sim.x, c.y - headY) < 190;

      if (near) {
        sim.attentive = Math.min(1, sim.attentive + dt * 4);
        const dx = c.x - sim.x, dy = c.y - headY;
        const m = Math.max(1, Math.hypot(dx, dy));
        sim.lookX = dx / m;
        sim.lookY = dy / m;
        if (sim.pose === 'stand' && Math.abs(dx) > 12) sim.facing = (dx > 0 ? 1 : -1) as 1 | -1;
      } else {
        sim.attentive = Math.max(0, sim.attentive - dt * 2);
      }

      // blinks, sampled fresh every time
      if (sim.blinkT > 0) {
        sim.blinkT += dt * 1000;
        sim.eyeOpen = sim.blinkT < 70 ? 1 - sim.blinkT / 70 : sim.blinkT < 140 ? (sim.blinkT - 70) / 70 : 1;
        if (sim.blinkT >= 140) {
          sim.blinkT = 0;
          sim.nextBlink = now + (rng() < 0.18 ? 190 + rng() * 120 : persona.blinkMin + rng() * (persona.blinkMax - persona.blinkMin));
        }
      } else if (now >= sim.nextBlink && sim.pose !== 'sleep') {
        sim.blinkT = 0.001;
      }
      if (sim.pose === 'sleep') sim.eyeOpen = 0;

      if (sim.earFlick <= 0 && sim.pose !== 'sleep' && rng() < persona.earTwitchiness * dt) sim.earFlick = 170;
      sim.earFlick = Math.max(0, sim.earFlick - dt * 1000);

      /* --- pick something to do --- */
      if (now >= sim.until) {
        const margin = 70;
        const roll = rng();
        if (roll < 0.42) {
          sim.pose = 'walk';
          sim.targetX = margin + rng() * Math.max(1, window.innerWidth - margin * 2);
          sim.until = now + 16_000;
        } else if (roll < 0.66) {
          sim.pose = 'sit'; sim.targetX = null; sim.until = now + 4000 + rng() * 9000;
        } else if (roll < 0.76) {
          sim.pose = 'groom'; sim.targetX = null; sim.until = now + 3600 + rng() * 3600;
        } else if (roll < 0.84) {
          sim.pose = 'stretch'; sim.targetX = null; sim.until = now + 2600;
        } else if (roll < 0.9) {
          sim.pose = 'roll'; sim.targetX = null; sim.until = now + 3400;
        } else if (roll < 0.95) {
          sim.pose = 'paw'; sim.targetX = null; sim.until = now + 2600;
        } else {
          sim.pose = 'sleep'; sim.targetX = null; sim.until = now + 22_000 + rng() * 30_000;
        }
        sim.poseT = 0;
      }

      if (sim.pose === 'walk' && sim.targetX !== null) {
        const dx = sim.targetX - sim.x;
        if (Math.abs(dx) < 6) {
          sim.pose = 'stand';
          sim.poseT = 0;
          sim.targetX = null;
          sim.until = now + 1200 + rng() * 2600;
          sim.vx = 0;
        } else {
          const sp = persona.walkSpeed;
          sim.vx += ((Math.sign(dx) * sp) - sim.vx) * Math.min(1, dt * 3.2);
          const mx = sim.vx * dt;
          sim.x += mx;
          sim.stridePhase += Math.abs(mx) / STRIDE;
          if (Math.abs(sim.vx) > 4) sim.facing = (sim.vx > 0 ? 1 : -1) as 1 | -1;
        }
      }
      // the window can be resized out from under it
      sim.x = Math.max(30, Math.min(window.innerWidth - 30, sim.x));
      sim.poseT += dt * 1000;

      /* --- the occasional thought --- */
      if (sim.pose === 'sleep') {
        if (now - sim.lastBubble > 11_000 + rng() * 7000) {
          sim.bubble = pickThought('sleep', rng, recentRef.current);
          sim.bubbleUntil = now + 2400;
          sim.lastBubble = now;
        }
      } else if (rng() < dt * 0.04 && now - sim.lastBubble > 38_000) {
        sim.bubble = pickThought(sim.pose === 'walk' ? 'walk' : 'idle', rng, recentRef.current);
        sim.bubbleUntil = now + 2900;
        sim.lastBubble = now;
      }

      /* --- draw --- */
      const frame = boot.sheet?.[frameFor(sim)];
      const cv = spriteRef.current;
      const wrap = wrapRef.current;
      if (!frame || !cv || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.min(10, Math.round(ART_PX * dpr)));
      if (k !== backingRef.current) {
        backingRef.current = k;
        cv.width = ART_W * k;
        cv.height = ART_H * k;
      }

      const rx = Math.round(sim.x / ART_PX) * ART_PX;
      const ax = sim.facing < 0 ? ART_W - frame.anchorX : frame.anchorX;
      wrap.style.left = `${rx - ax * ART_PX}px`;
      wrap.style.top = `${Math.round(groundY) - ART_H * ART_PX}px`;

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
          if (sim.eyeOpen < 0.2) {
            ctx.fillStyle = pal.detail;
            ctx.fillRect(eye.x, eye.y + Math.floor(eye.h / 2), eye.w, 1);
          }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const bubble = bubbleRef.current;
      const box = boxRef.current;
      if (bubble && box) {
        const show = !!sim.bubble && now < sim.bubbleUntil;
        bubble.style.opacity = show ? '1' : '0';
        if (show && box.textContent !== sim.bubble) box.textContent = sim.bubble;
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, boot]);

  if (!enabled || !boot) return null;

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        width: ART_W * ART_PX,
        height: ART_H * ART_PX,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute', left: '50%', bottom: -2,
          width: ART_W * ART_PX * 0.45, height: 7,
          borderRadius: '50%', background: 'rgba(30,20,10,1)', opacity: 0.14,
          transform: 'translateX(-50%)',
        }}
      />
      <canvas
        ref={spriteRef}
        style={{
          width: ART_W * ART_PX, height: ART_H * ART_PX,
          imageRendering: 'pixelated', display: 'block',
        }}
      />
      <div
        ref={bubbleRef}
        style={{
          position: 'absolute', left: '58%', bottom: '88%',
          opacity: 0, transition: 'opacity 0.16s',
        }}
      >
        <span
          ref={boxRef}
          style={{
            display: 'block',
            background: '#FFFDF8', color: '#1B1B22',
            border: '2px solid #1B1B22', borderRadius: 9,
            padding: '3px 6px', maxWidth: 124, width: 'max-content',
            textAlign: 'center', fontSize: 9, lineHeight: '11px', fontWeight: 800,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <span style={{ position: 'absolute', left: 4, top: '100%' }}>
          <span
            style={{
              display: 'block', width: 5, height: 5, marginLeft: 2,
              background: '#FFFDF8', border: '2px solid #1B1B22', borderRadius: '50%',
            }}
          />
          <span
            style={{
              display: 'block', width: 3, height: 3, marginTop: 1,
              background: '#FFFDF8', border: '2px solid #1B1B22', borderRadius: '50%',
            }}
          />
        </span>
      </div>
    </div>
  );
}
