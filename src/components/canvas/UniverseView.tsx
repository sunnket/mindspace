'use client';

/**
 * Universe View — a real 3D universe you fly through.
 *
 * This replaces the flat Constellation star map and its hand-wired
 * constellations. Nothing here is drawn by the user and nothing has to be
 * maintained: the board seeds a star system, and the system runs.
 *
 * Everything moves, and moves for a reason. Inner planets orbit faster than
 * outer ones because Kepler says so, moons run faster still, the asteroid belt
 * shears, comet tails point away from the star rather than trailing behind the
 * motion, and the accretion disk winds up because its inside orbits faster than
 * its outside. None of that is decoration — it is the difference between a
 * diorama and a place.
 *
 * three.js is loaded lazily, inside the open effect. It is a large dependency
 * and this view is opt-in, so it must never touch the first load of the board.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { cameraForRect } from '@/lib/frames';
import type * as THREE_NS from 'three';
import type { Body, Universe } from '@/lib/universe/world';
import type { Rig } from '@/lib/universe/rig';

export default function UniverseView() {
  const open = useCanvasStore((s) => s.constellationOpen);
  if (!open || typeof document === 'undefined') return null;
  return <Universe3D />;
}

interface HudBody {
  label: string;
  kind: Body['kind'];
  x: number;
  y: number;
  blockId?: string;
}

/** How far out you are, in words. Cheap orientation for a camera with a 4000x
 *  dolly range, where a number would mean nothing. */
function altitudeName(d: number): string {
  if (d < 14) return 'Close orbit';
  if (d < 70) return 'High orbit';
  if (d < 420) return 'Inner system';
  if (d < 2200) return 'Outer system';
  if (d < 9000) return 'Interstellar';
  return 'Deep space';
}

function Universe3D() {
  const setConstellationOpen = useCanvasStore((s) => s.setConstellationOpen);
  const objects = useCanvasStore((s) => s.objects);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const workspaceTitle = useCanvasStore((s) => s.workspaceTitle);

  const parentId = resolveParentId(canvasStack, urlCanvasId);
  const levelObjects = useMemo(
    () => objects.filter((o) => (o.parentId ?? undefined) === parentId),
    [objects, parentId],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const uniRef = useRef<Universe | null>(null);
  const threeRef = useRef<typeof THREE_NS | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: number; down: boolean }>({ x: 0, y: 0, moved: 0, down: false });
  const pointerRef = useRef({ x: -9999, y: -9999 });

  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<HudBody | null>(null);
  const [altitude, setAltitude] = useState('Inner system');
  const [failed, setFailed] = useState<string | null>(null);
  // Mirrored into state purely so the cursor can change: React 19 forbids
  // reading a ref during render, and the drag itself must stay on the ref
  // because it is written from pointermove at pointer rate.
  const [dragging, setDragging] = useState(false);

  /* The board decides the universe: how many worlds there are, and the seed
     everything else is generated from. Same board, same universe, every time. */
  const spec = useMemo(() => {
    const blocks = levelObjects
      .filter((o) => o.type !== 'frame' && o.type !== 'arrow' && o.type !== 'drawing')
      .slice(0, 11)
      .map((o) => ({
        id: o.id,
        label: (o.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 42) || 'Unnamed world',
        weight: Math.sqrt(Math.max(1, o.width * o.height)),
      }));
    return { blocks, key: `${urlCanvasId || 'root'}::${parentId || 'top'}` };
  }, [levelObjects, urlCanvasId, parentId]);

  /* The scene is built ONCE, from whatever the board looked like when you
     entered it.
     `spec` is derived from `objects`, and the board's store ticks constantly —
     autosave, the agent, a peer's cursor, a block being dragged underneath.
     Depending on it directly meant every one of those tore down the renderer,
     rebuilt forty thousand stars and threw the camera back to the establishing
     shot, mid-flight. A universe is not a render of live state; it is a place
     you went to. */
  const specRef = useRef(spec);

  /* ------------------------------------------------------------- the scene */
  useEffect(() => {
    let alive = true;
    let raf = 0;
    const spec = specRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      let THREE: typeof THREE_NS;
      let world: typeof import('@/lib/universe/world');
      let rigMod: typeof import('@/lib/universe/rig');
      try {
        [THREE, world, rigMod] = await Promise.all([
          import('three'),
          import('@/lib/universe/world'),
          import('@/lib/universe/rig'),
        ]);
      } catch (e) {
        if (alive) setFailed(e instanceof Error ? e.message : 'Could not load the renderer');
        return;
      }
      if (!alive) return;

      let rig: Rig;
      try {
        rig = rigMod.createRig({ canvas, reducedMotion: reduced });
      } catch {
        // No WebGL — say so rather than showing a black rectangle.
        if (alive) setFailed('This device could not open a 3D context (WebGL unavailable).');
        return;
      }

      const uni = world.buildUniverse({
        seed: world.hashString(spec.key),
        blocks: spec.blocks,
        reducedMotion: reduced,
      });

      /* This effect is asynchronous, and React invokes effects twice in
         development. The cleanup for the first invocation therefore runs BEFORE
         this line — so if we don't check, we hand a live renderer and a live
         RAF loop to a component that has already been torn down. Both loops
         then paint the same canvas, and the one the UI holds a ref to is not
         necessarily the one you can see: clicking "fly to the black hole" moved
         a camera that was no longer being rendered. */
      if (!alive) {
        uni.dispose();
        rig.dispose();
        return;
      }

      rig.scene.add(uni.root);
      threeRef.current = THREE;
      rigRef.current = rig;
      uniRef.current = uni;

      const size = () => rig.setSize(window.innerWidth, window.innerHeight);
      size();
      window.addEventListener('resize', size);

      // Open on the system, then push in — an establishing shot, not a cut.
      rig.focus.set(0, 0, 0);
      rig.flyTo(new THREE.Vector3(0, 0, 0), 900, 0.001);
      rig.flyTo(new THREE.Vector3(0, 0, 0), 340, reduced ? 0.001 : 4.2);

      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const projected = new THREE.Vector3();
      let last = performance.now();
      let hoverTick = 0;

      const loop = (now: number) => {
        // The loop stops itself. Cleanup cannot cancel a RAF id that did not
        // exist yet when cleanup ran.
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        /* Two clocks, deliberately.
           The camera runs on WALL TIME: a flight is choreography, and "two and
           a half seconds" has to mean two and a half seconds whether the
           machine is managing 120fps or 4. Clamping this is what made the trip
           to the black hole crawl — every slow frame advanced the flight by
           less than the time it actually took, so the slower the renderer, the
           longer the journey, without bound.
           The simulation runs on clamped time, because there a huge step is a
           real hazard: coming back from a backgrounded tab with a ten-second
           dt would teleport every planet a third of the way round its orbit. */
        const raw = (now - last) / 1000;
        const camDt = Math.min(1.0, raw);
        const simDt = Math.min(0.2, raw);
        last = now;
        const t = now / 1000;

        uni.update(t, simDt, rig.camera);
        rig.update(camDt);
        (rig.filmPass.uniforms.uTime as { value: number }).value = t;

        rigMod.updateLensing(
          rig.lensPass,
          rig.camera,
          uni.bodies.find((b) => b.kind === 'blackhole')!.world,
          26 * 1.9,
        );

        // Hover picking, four times a second — a raycast every frame against
        // every body is wasted work for something the eye can't follow anyway.
        hoverTick += camDt;
        if (hoverTick > 0.1) {
          hoverTick = 0;
          const p = pointerRef.current;
          if (p.x > -9000) {
            ndc.set((p.x / window.innerWidth) * 2 - 1, -(p.y / window.innerHeight) * 2 + 1);
            raycaster.setFromCamera(ndc, rig.camera);
            const meshes = uni.bodies.filter((b) => b.kind !== 'star').map((b) => b.mesh);
            const hit = raycaster.intersectObjects(meshes, false)[0];
            if (hit) {
              const body = uni.bodies.find((b) => b.mesh === hit.object);
              if (body) {
                projected.copy(body.world).project(rig.camera);
                setHover({
                  label: body.label,
                  kind: body.kind,
                  blockId: body.blockId,
                  x: ((projected.x + 1) / 2) * window.innerWidth,
                  y: ((-projected.y + 1) / 2) * window.innerHeight,
                });
              }
            } else {
              setHover(null);
            }
          }
          setAltitude(altitudeName((rig as Rig & { distance: number }).distance));
        }

        rig.composer.render();
      };
      raf = requestAnimationFrame(loop);
      setReady(true);

      return () => window.removeEventListener('resize', size);
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      uniRef.current?.dispose();
      rigRef.current?.dispose();
      uniRef.current = null;
      rigRef.current = null;
    };
    // Mount-once. See the note on specRef above — this must not re-run.
  }, []);

  /* -------------------------------------------------------- interactions */

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0, down: true };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const d = dragRef.current;
    if (!d.down) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    rigRef.current?.orbitBy(dx, dy);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    d.down = false;
    setDragging(false);
    // A drag rotates. Only a genuine tap travels.
    if (d.moved > 6) return;

    const rig = rigRef.current;
    const uni = uniRef.current;
    const THREE = threeRef.current;
    if (!rig || !uni || !THREE) return;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, rig.camera);
    const meshes = uni.bodies.map((b) => b.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return;
    const body = uni.bodies.find((b) => b.mesh === hit.object);
    if (!body) return;
    // Frame it the way a lens would: far enough back that the body fills a
    // comfortable portion of the frame, whatever its size.
    rig.flyTo(body.world.clone(), Math.max(4, body.radius * (body.kind === 'blackhole' ? 26 : 5.4)), 2.6);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    rigRef.current?.dollyBy(e.deltaY > 0 ? 1 : -1);
  }, []);

  const pullBack = useCallback(() => {
    const rig = rigRef.current;
    const THREE = threeRef.current;
    if (!rig || !THREE) return;
    rig.flyTo(new THREE.Vector3(0, 0, 0), 900, 2.8);
  }, []);

  const toBlackHole = useCallback(() => {
    const rig = rigRef.current;
    const uni = uniRef.current;
    if (!rig || !uni) return;
    const bh = uni.bodies.find((b) => b.kind === 'blackhole');
    // The disk reaches out to about six times the hole's radius, so framing it
    // needs an order of magnitude more standoff than a planet does. At 210 the
    // camera arrives inside the disk and the frame is a wall of white.
    if (bh) rig.flyTo(bh.world.clone(), bh.radius * 26, 5.2);
  }, []);

  /** Fly down to the block a world stands for, and land on the canvas. */
  const landOnBlock = useCallback((blockId: string) => {
    const o = useCanvasStore.getState().objects.find((x) => x.id === blockId);
    setConstellationOpen(false);
    if (!o) return;
    const cam = cameraForRect(
      { x: o.x, y: o.y, width: o.width, height: o.height },
      window.innerWidth,
      window.innerHeight,
      Math.max(140, o.width * 0.4),
    );
    animateCamera(cam, 700);
    useCanvasStore.getState().setSelectedId?.(blockId);
  }, [animateCamera, setConstellationOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setConstellationOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setConstellationOpen]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400, overflow: 'hidden', userSelect: 'none',
        background: '#02030a', cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { dragRef.current.down = false; setDragging(false); pointerRef.current = { x: -9999, y: -9999 }; }}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />

      {!ready && !failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", color: 'rgba(214,228,255,0.62)', fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Entering orbit
          </div>
        </div>
      )}

      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 40, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", color: 'rgba(226,236,255,0.8)', maxWidth: 460 }}>
            <div style={{ fontSize: 17, marginBottom: 8 }}>The universe could not open</div>
            <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.6 }}>{failed}</div>
          </div>
        </div>
      )}

      {/* label for whatever the cursor is over */}
      {hover && (
        <div
          style={{
            position: 'absolute', left: hover.x, top: hover.y - 34, transform: 'translateX(-50%)',
            pointerEvents: hover.blockId ? 'auto' : 'none', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span style={chip}>{hover.label}</span>
          {hover.blockId && (
            <button onPointerUp={(e) => e.stopPropagation()} onClick={() => landOnBlock(hover.blockId!)} style={pill} title="Go to this block on the canvas">
              Land here
            </button>
          )}
        </div>
      )}

      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: 640, height: 240, pointerEvents: 'none', background: 'radial-gradient(120% 130% at 6% 16%, rgba(1,3,9,0.82) 0%, rgba(1,3,9,0.42) 44%, rgba(1,3,9,0) 76%)' }} />

      <div style={{ position: 'absolute', top: 34, left: 40, pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.34em', textTransform: 'uppercase', color: 'rgba(142,188,255,0.85)', marginBottom: 6 }}>
          Universe
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, fontWeight: 300, color: '#F2F6FF', textShadow: '0 0 34px rgba(142,188,255,0.28)' }}>
          {workspaceTitle || 'Untitled'}
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(228,236,255,0.42)', marginTop: 6 }}>
          {altitude}
        </div>
      </div>

      <div style={{ position: 'absolute', top: 34, right: 40, display: 'flex', gap: 8 }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={pullBack} style={pill} title="Pull back to see the whole system">System</button>
        <button onClick={toBlackHole} style={pill} title="Travel to the black hole">Gargantua</button>
        <button onClick={() => setConstellationOpen(false)} style={{ ...pill, paddingLeft: 14, paddingRight: 14 }} title="Return to the board (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
          </svg>
          Land
        </button>
      </div>

      <div aria-hidden style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 110, pointerEvents: 'none', background: 'linear-gradient(to top, rgba(1,3,9,0.78) 0%, rgba(1,3,9,0.28) 46%, rgba(1,3,9,0) 100%)' }} />

      <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(228,236,255,0.55)', whiteSpace: 'nowrap' }}>
        Drag to look · scroll to travel · tap a world to fly to it · Esc to leave
      </div>
    </div>,
    document.body,
  );
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999,
  background: 'rgba(8,12,22,0.72)', border: '1px solid rgba(142,188,255,0.26)', color: '#E4ECFF',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 12, backdropFilter: 'blur(3px)',
};

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(142,188,255,0.26)',
  background: 'rgba(8,12,22,0.62)', color: '#E4ECFF', cursor: 'pointer',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  backdropFilter: 'blur(4px)',
};
