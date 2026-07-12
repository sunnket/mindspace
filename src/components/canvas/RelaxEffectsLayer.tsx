'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore } from '@/store/canvasStore';
import { RELAX_EFFECTS, type EffectApi, type Particle, type RelaxEffect } from '@/lib/relaxEffects';

/**
 * Stress Reliefer engine.
 *
 * Particles live in one of two containers, chosen by the effect's `space`:
 *
 *  - world  — a child of `.canvas-world`, so particles sit in canvas coordinates
 *             and pan/zoom with the board.
 *  - screen — a fixed, viewport-sized overlay portalled to <body>. Weather and
 *             the pop games go here: a bubble you have to click must not slide
 *             out from under the cursor when the canvas moves.
 *
 * The screen overlay sits below the toolbar (z-100) and minimap (z-50) so that
 * clickable particles can never swallow a UI click.
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
  const mode = useCanvasStore((s) => s.mode);
  const relaxEffect = useCanvasStore((s) => s.relaxEffect);

  const worldRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const emittersRef = useRef<Emitter[]>([]);
  const liveRef = useRef<Live[]>([]);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const activeRef = useRef<Set<string>>(new Set());
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const world = worldRef.current;
    const screen = screenRef.current;
    if (!world || !screen) return;

    const apis = new Map<string, EffectApi>();

    const apiFor = (fx: RelaxEffect): EffectApi => {
      let api = apis.get(fx.id);
      if (!api) {
        api = {
          screen,
          get viewport() {
            return { w: window.innerWidth, h: window.innerHeight };
          },
          spawn: (x, y, n, kind, tint) => spawn(fx, x, y, n, kind, tint),
          clear: () => {
            liveRef.current = liveRef.current.filter((l) => {
              if (l.fx.id !== fx.id) return true;
              l.p.el.remove();
              return false;
            });
          },
        };
        apis.set(fx.id, api);
      }
      return api;
    };

    const countFor = (id: string) => {
      let n = 0;
      for (const l of liveRef.current) if (l.fx.id === id) n++;
      return n;
    };

    const pop = (l: Live) => {
      if (l.p.kind !== 0) return; // debris isn't clickable
      l.fx.onPop?.(l.p, apiFor(l.fx));

      // Chimes ring and keep swinging; bubbles are destroyed by the click. The
      // default is destroy — the debris an effect throws off *is* the pop, and a
      // lingering husk reads as a missed click.
      if (l.fx.consumeOnPop === false) return;
      l.p.el.remove();
      liveRef.current = liveRef.current.filter((x) => x !== l);
    };

    const spawn = (fx: RelaxEffect, x: number, y: number, n: number, kind?: number, tint?: string) => {
      const room = fx.maxParticles - countFor(fx.id);
      const count = Math.min(n, room);
      if (count <= 0) return;

      const now = performance.now();
      const host = fx.space === 'screen' ? screen : world;
      const api = apiFor(fx);

      for (let i = 0; i < count; i++) {
        const p = fx.create(x, y, now, api, kind, tint, i);
        const live: Live = { p, fx };
        if (fx.interactive && p.kind === 0) {
          p.el.style.pointerEvents = 'auto';
          const hit = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            pop(live);
          };
          p.el.addEventListener('pointerdown', hit);
          // Sweeping the cursor through a rack of chimes should play them.
          if (fx.hover) p.el.addEventListener('pointerenter', hit);
        }
        host.appendChild(p.el);
        liveRef.current.push(live);
      }
    };

    /** The shockwave that opens a burst. Handed to the compositor and forgotten. */
    const flash = (fx: RelaxEffect, x: number, y: number) => {
      if (!fx.flash) return;
      const host = fx.space === 'screen' ? screen : world;
      const ring = document.createElement('div');
      const r = 90;
      ring.style.cssText =
        `position:absolute;left:0;top:0;width:${r * 2}px;height:${r * 2}px;` +
        'border-radius:50%;pointer-events:none;max-width:none;max-height:none;' +
        `background:radial-gradient(circle, ${fx.flash} 0%, transparent 62%);`;
      host.appendChild(ring);
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
        if (e.fx.spawnEveryMs > 0 && now - e.lastSpawn >= e.fx.spawnEveryMs) {
          e.lastSpawn = now;
          spawn(e.fx, e.x, e.y, e.fx.spawnPerTick + (Math.random() < 0.5 ? 1 : 0));
        }
      }

      // An effect that has no emitters left has gone quiet — let it tear down its
      // continuous bits (the rain track, the storm veil) even if particles remain.
      for (const id of [...activeRef.current]) {
        if (emittersRef.current.some((e) => e.fx.id === id)) continue;
        const fx = RELAX_EFFECTS[id as keyof typeof RELAX_EFFECTS];
        activeRef.current.delete(id);
        fx?.onStop?.(apiFor(fx));
      }

      const alive: Live[] = [];
      for (const l of liveRef.current) {
        const t = (now - l.p.born) / l.p.life;
        if (t >= 1) {
          l.fx.onDeath?.(l.p, apiFor(l.fx));
          l.p.el.remove();
          continue;
        }
        l.fx.step(l.p, t, now, apiFor(l.fx));
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

    const handleBurst = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      const { mode: m, relaxEffect: id } = useCanvasStore.getState();
      if (m !== 'relax' || !id || !detail) return;
      const fx = RELAX_EFFECTS[id];
      if (!fx) return;

      const api = apiFor(fx);
      const now = performance.now();

      if (!activeRef.current.has(fx.id)) {
        activeRef.current.add(fx.id);
        fx.onStart?.(detail.x, detail.y, api);
      }
      fx.onBurst?.(detail.x, detail.y, api);

      emittersRef.current.push({
        fx,
        x: detail.x,
        y: detail.y,
        endTime: now + fx.burstMs,
        lastSpawn: now,
      });
      flash(fx, detail.x, detail.y);
      spawn(fx, detail.x, detail.y, fx.openingPop);
      ensureRunning();
    };

    const reset = () => {
      for (const id of [...activeRef.current]) {
        const fx = RELAX_EFFECTS[id as keyof typeof RELAX_EFFECTS];
        activeRef.current.delete(id);
        fx?.onStop?.(apiFor(fx));
      }
      emittersRef.current = [];
      for (const l of liveRef.current) l.p.el.remove();
      liveRef.current = [];
    };
    resetRef.current = reset;

    window.addEventListener('spawn-relax-burst', handleBurst);
    return () => {
      window.removeEventListener('spawn-relax-burst', handleBurst);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      runningRef.current = false;
      reset();
    };
  }, []);

  // Switching effect, or putting the tool down, kills whatever is in flight.
  // Without this the rain track would keep playing over a canvas with no rain.
  useEffect(() => {
    resetRef.current?.();
  }, [mode, relaxEffect]);

  return (
    <>
      <div
        ref={worldRef}
        data-relax-layer="world"
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, pointerEvents: 'none', zIndex: 5 }}
      />
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={screenRef}
            data-relax-layer="screen"
            aria-hidden
            style={{
              position: 'fixed',
              inset: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 45,
            }}
          />,
          document.body
        )}
    </>
  );
}
