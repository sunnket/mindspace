'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas } from '@/lib/utils';
import { RELAX_EFFECTS, type Particle, type RelaxEffect } from '@/lib/relaxEffects';

/**
 * Stress Reliefer engine.
 *
 * Mounts inside `.canvas-world`, so particles are positioned in world
 * coordinates and pan/zoom with the canvas for free.
 *
 * Particles are driven imperatively rather than through React state: a burst is
 * routinely 200+ nodes, and reconciling that list 60 times a second is hopeless.
 * The loop writes `transform`/`opacity` straight to each node, which keeps the
 * whole thing on the compositor.
 */

interface Emitter {
  fx: RelaxEffect;
  x: number;
  y: number;
  endTime: number;
  lastSpawn: number;
}

interface Live {
  p: Particle;
  fx: RelaxEffect;
}

export default function RelaxEffectsLayer() {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const emittersRef = useRef<Emitter[]>([]);
  const liveRef = useRef<Live[]>([]);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastTrailRef = useRef(0);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const countFor = (id: string) => {
      let n = 0;
      for (const l of liveRef.current) if (l.fx.id === id) n++;
      return n;
    };

    const spawn = (fx: RelaxEffect, x: number, y: number, n: number) => {
      const room = fx.maxParticles - countFor(fx.id);
      const count = Math.min(n, room);
      const now = performance.now();
      for (let i = 0; i < count; i++) {
        const p = fx.create(x, y, now);
        layer.appendChild(p.el);
        liveRef.current.push({ p, fx });
      }
    };

    /** The shockwave that opens a burst. Handed to the compositor and forgotten. */
    const flash = (fx: RelaxEffect, x: number, y: number) => {
      const ring = document.createElement('div');
      const r = 90;
      ring.style.cssText =
        `position:absolute;left:0;top:0;width:${r * 2}px;height:${r * 2}px;` +
        'border-radius:50%;pointer-events:none;max-width:none;max-height:none;' +
        `background:radial-gradient(circle, ${fx.flash} 0%, transparent 62%);`;
      layer.appendChild(ring);
      const anim = ring.animate(
        [
          { transform: `translate3d(${x - r}px, ${y - r}px, 0) scale(0.15)`, opacity: 0.95 },
          { transform: `translate3d(${x - r}px, ${y - r}px, 0) scale(2.8)`, opacity: 0 },
        ],
        { duration: 900, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
      anim.onfinish = () => ring.remove();
      anim.oncancel = () => ring.remove();
    };

    const tick = () => {
      const now = performance.now();

      emittersRef.current = emittersRef.current.filter((e) => e.endTime > now);
      for (const e of emittersRef.current) {
        if (now - e.lastSpawn >= e.fx.spawnEveryMs) {
          e.lastSpawn = now;
          spawn(e.fx, e.x, e.y, e.fx.spawnPerTick + (Math.random() < 0.5 ? 1 : 0));
        }
      }

      const alive: Live[] = [];
      for (const l of liveRef.current) {
        const t = (now - l.p.born) / l.p.life;
        if (t >= 1) {
          l.p.el.remove();
          continue;
        }
        l.fx.step(l.p, t, now);
        alive.push(l);
      }
      liveRef.current = alive;

      if (alive.length > 0 || emittersRef.current.length > 0) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
        frameRef.current = null;
      }
    };

    const ensureRunning = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      frameRef.current = requestAnimationFrame(tick);
    };

    const activeEffect = (): RelaxEffect | null => {
      const { mode, relaxEffect } = useCanvasStore.getState();
      if (mode !== 'relax' || !relaxEffect) return null;
      return RELAX_EFFECTS[relaxEffect] ?? null;
    };

    const handleBurst = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      const fx = activeEffect();
      if (!fx || !detail) return;

      emittersRef.current.push({
        fx,
        x: detail.x,
        y: detail.y,
        endTime: performance.now() + fx.burstMs,
        lastSpawn: performance.now(),
      });
      flash(fx, detail.x, detail.y);
      spawn(fx, detail.x, detail.y, fx.openingPop);
      ensureRunning();
    };

    // Cursor trail: particles fall out of the pointer as it moves, so the mode
    // feels alive even between clicks.
    const handleMove = (e: MouseEvent) => {
      if (e.buttons !== 0) return; // dragging or panning — don't fight the gesture
      const fx = activeEffect();
      if (!fx || fx.trailEveryMs <= 0) return;
      if (!(e.target as HTMLElement | null)?.closest?.('.canvas-container')) return;

      const now = performance.now();
      if (now - lastTrailRef.current < fx.trailEveryMs) return;
      lastTrailRef.current = now;

      const { camera } = useCanvasStore.getState();
      const world = screenToCanvas(e.clientX, e.clientY, camera);
      spawn(fx, world.x, world.y, 1);
      ensureRunning();
    };

    window.addEventListener('spawn-relax-burst', handleBurst);
    window.addEventListener('mousemove', handleMove);

    return () => {
      window.removeEventListener('spawn-relax-burst', handleBurst);
      window.removeEventListener('mousemove', handleMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      runningRef.current = false;
      for (const l of liveRef.current) l.p.el.remove();
      liveRef.current = [];
      emittersRef.current = [];
    };
  }, []);

  return (
    <div
      ref={layerRef}
      data-relax-layer=""
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
