'use client';

import { useEffect, useRef } from 'react';

/**
 * Stress Reliefer — Flower Burst.
 *
 * Listens for `spawn-flower-burst` (world coords) and emits flowers from that
 * point for BURST_MS.
 *
 * This layer lives inside `.canvas-world`, which is a 0x0 shrink-to-fit box (it
 * only ever holds absolutely-positioned children). Two consequences drive the
 * implementation:
 *
 *  1. Tailwind preflight's `img { max-width: 100% }` resolves against that 0px
 *     parent, so every flower would collapse to zero width. Each particle must
 *     pin `max-width/max-height: none`.
 *  2. Particles are driven imperatively rather than through React state.
 *     Reconciling several hundred nodes every frame is far too slow, and
 *     animating `left`/`top` re-runs layout for each one. Writing `transform`
 *     straight to the node keeps the whole burst on the compositor.
 */

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

const BURST_MS = 10_000; // how long one click keeps emitting
const OPENING_POP = 55; // flowers thrown out on the very first frame
const SPAWN_EVERY_MS = 50; // steady-state emission cadence
const SPAWN_PER_TICK = 3; // flowers per cadence tick
const MAX_PARTICLES = 900; // hard ceiling so held-down clicking can't melt the tab

interface Emitter {
  x: number;
  y: number;
  endTime: number;
  lastSpawn: number;
}

interface Particle {
  el: HTMLImageElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  maxScale: number;
  buoyancy: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  born: number;
  life: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export default function FlowerParticlesLayer() {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const emittersRef = useRef<Emitter[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const spawnOne = (originX: number, originY: number) => {
      if (particlesRef.current.length >= MAX_PARTICLES) return;

      const size = rand(26, 64);
      const angle = Math.random() * Math.PI * 2;
      // Bias toward the outer edge so the ring reads as a burst, not a blob.
      const speed = rand(3.5, 11) * (0.55 + Math.random() * 0.45);

      const el = document.createElement('img');
      el.src = FLOWER_SVGS[Math.floor(Math.random() * FLOWER_SVGS.length)];
      el.alt = '';
      el.draggable = false;
      el.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        `width:${size}px`,
        `height:${size}px`,
        'max-width:none',
        'max-height:none',
        'opacity:0',
        'pointer-events:none',
        'user-select:none',
        'will-change:transform,opacity',
        'filter:drop-shadow(0 3px 5px rgba(0,0,0,0.18))',
      ].join(';');
      layer.appendChild(el);

      particlesRef.current.push({
        el,
        x: originX + rand(-10, 10),
        y: originY + rand(-10, 10),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size,
        rotation: rand(0, 360),
        spin: rand(-5, 5),
        maxScale: rand(0.75, 1.25),
        // Most flowers drift up and away; a few settle downward. The mix is what
        // makes the cloud look alive instead of like a single explosion.
        buoyancy: rand(-0.075, 0.03),
        swayAmp: rand(6, 22),
        swayFreq: rand(0.8, 2.4),
        swayPhase: rand(0, Math.PI * 2),
        born: performance.now(),
        life: rand(3200, 5200),
      });
    };

    const tick = () => {
      const now = performance.now();

      // 1. Emission
      emittersRef.current = emittersRef.current.filter((e) => e.endTime > now);
      for (const emitter of emittersRef.current) {
        if (now - emitter.lastSpawn >= SPAWN_EVERY_MS) {
          emitter.lastSpawn = now;
          const count = SPAWN_PER_TICK + (Math.random() < 0.5 ? 1 : 0);
          for (let i = 0; i < count; i++) spawnOne(emitter.x, emitter.y);
        }
      }

      // 2. Integrate + paint
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        const age = now - p.born;
        const t = age / p.life;

        if (t >= 1) {
          p.el.remove();
          continue;
        }

        p.vx *= 0.955;
        p.vy = p.vy * 0.955 + p.buoyancy;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        // Elastic pop-in over the first 18%, with a little overshoot.
        let scale = p.maxScale;
        if (t < 0.18) {
          const k = t / 0.18;
          const back = 1 - Math.pow(1 - k, 3);
          scale = p.maxScale * (back + Math.sin(k * Math.PI) * 0.16);
        }

        const opacity = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
        const sway = Math.sin(t * p.swayFreq * Math.PI * 2 + p.swayPhase) * p.swayAmp;

        const px = p.x + sway - p.size / 2;
        const py = p.y - p.size / 2;

        p.el.style.transform = `translate3d(${px}px, ${py}px, 0) rotate(${p.rotation}deg) scale(${scale})`;
        p.el.style.opacity = String(opacity);

        alive.push(p);
      }
      particlesRef.current = alive;

      if (alive.length > 0 || emittersRef.current.length > 0) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
        frameRef.current = null;
      }
    };

    const handleSpawn = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const now = performance.now();

      emittersRef.current.push({ x, y, endTime: now + BURST_MS, lastSpawn: now });
      for (let i = 0; i < OPENING_POP; i++) spawnOne(x, y);

      if (!runningRef.current) {
        runningRef.current = true;
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    window.addEventListener('spawn-flower-burst', handleSpawn);
    return () => {
      window.removeEventListener('spawn-flower-burst', handleSpawn);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      runningRef.current = false;
      for (const p of particlesRef.current) p.el.remove();
      particlesRef.current = [];
      emittersRef.current = [];
    };
  }, []);

  return (
    <div
      ref={layerRef}
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, pointerEvents: 'none', zIndex: 5 }}
    />
  );
}
