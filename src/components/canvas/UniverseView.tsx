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

function Universe3D() {
  const setConstellationOpen = useCanvasStore((s) => s.setConstellationOpen);
  const objects = useCanvasStore((s) => s.objects);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const animateCamera = useCanvasStore((s) => s.animateCamera);

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
  const [failed, setFailed] = useState<string | null>(null);
  // Mirrored into state purely so the cursor can change: React 19 forbids
  // reading a ref during render, and the drag itself must stay on the ref
  // because it is written from pointermove at pointer rate.
  const [dragging, setDragging] = useState(false);
  const [chromeOn, setChromeOn] = useState(true);
  const chromeTimer = useRef<number | null>(null);

  /* Show the controls on any pointer movement, then retire them again. The
     delay is long enough that reaching for a button never races the fade. */
  const wakeChrome = useCallback(() => {
    setChromeOn(true);
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeOn(false), 2800);
  }, []);
  useEffect(() => {
    chromeTimer.current = window.setTimeout(() => setChromeOn(false), 2800);
    return () => { if (chromeTimer.current) window.clearTimeout(chromeTimer.current); };
  }, []);

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

        /* The shadow is sized just OVER the black sphere standing in for the
           horizon, so the sphere's polygonal silhouette is hidden inside it.
           It used to be passed at nearly twice that, which put the lensing
           shadow way outside the geometry and left the warp folding sky into a
           gap that had nothing in it. */
        rigMod.updateLensing(
          rig.lensPass,
          rig.camera,
          uni.bodies.find((b) => b.kind === 'blackhole')!.world,
          26 * 1.12,
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
    wakeChrome();
    const d = dragRef.current;
    if (!d.down) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    rigRef.current?.orbitBy(dx, dy);
  }, [wakeChrome]);

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

  const toGalaxy = useCallback(() => {
    const rig = rigRef.current;
    const uni = uniRef.current;
    const THREE = threeRef.current;
    if (!rig || !uni || !THREE || !uni.galaxies.length) return;
    const g = uni.galaxies[0];
    const at = new THREE.Vector3();
    g.group.getWorldPosition(at);

    /* Arrive ABOVE its plane, not in it.
       A galaxy is a disk, so the bearing you approach on decides whether you
       are shown a spiral or a sliver — and left to whatever the last drag
       happened to leave, it is a coin toss. This takes the disk's own normal
       and steps forty degrees off it, which is the angle that shows the arms
       winding and still gives the disk some thickness. */
    const n = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(g.group.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(n, ref).normalize();
    const from = n.multiplyScalar(Math.cos(0.7)).addScaledVector(tangent, Math.sin(0.7));

    // Far enough back to hold the whole disk, and a long push so the arms
    // resolve out of the haze on the way in rather than arriving already there.
    rig.flyTo(at, g.radius * 2.4, 7.5, from);
  }, []);

  const toBlackHole = useCallback(() => {
    const rig = rigRef.current;
    const uni = uniRef.current;
    const THREE = threeRef.current;
    if (!rig || !uni || !THREE) return;
    const bh = uni.bodies.find((b) => b.kind === 'blackhole');
    if (!bh) return;

    /* Come in almost along the plane of the disk, about twelve degrees above
       it. That specific angle is the whole shot: side-on, the gravity lifts the
       far half of the disk up over the shadow and folds the near half under it,
       so you see the underside and the top side of the same ring at once. Look
       at it from above and none of that happens — it is a flat orange annulus
       with a dot in the middle, which is what the previous arrival gave you
       whenever the last drag happened to leave the camera up there. */
    const n = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(bh.pivot.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(n, ref).normalize();
    const from = n.multiplyScalar(Math.sin(0.21)).addScaledVector(tangent, Math.cos(0.21));

    // The disk reaches out to about six times the hole's radius, so framing it
    // needs an order of magnitude more standoff than a planet does. At 210 the
    // camera arrives inside the disk and the frame is a wall of white.
    rig.flyTo(bh.world.clone(), bh.radius * 26, 5.2, from);
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

      {/* The only chrome left, and it hides itself.
          This used to be a title block, an altitude readout and three filled
          pills across the top, with dark scrims behind them to stay legible.
          On a full-frame image that is a poster with a caption pasted over it:
          the one thing you are meant to be looking at was the one thing
          competing for attention. Everything now fades out a moment after you
          stop moving the mouse, and comes back the instant you move it. */}
      <div
        style={{
          position: 'absolute', top: 24, right: 26, display: 'flex', gap: 6,
          opacity: chromeOn ? 1 : 0,
          transform: chromeOn ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'opacity 520ms ease, transform 520ms ease',
          pointerEvents: chromeOn ? 'auto' : 'none',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GlassButton onClick={pullBack} label="Whole system" d="M12 3v18M3 12h18" spin />
        <GlassButton onClick={toGalaxy} label="Nearest galaxy" d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 12a8 8 0 0 1-8 8M4 12a8 8 0 0 1 8-8" />
        <GlassButton onClick={toBlackHole} label="Gargantua" d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2a10 10 0 0 1 0 20" />
        <GlassButton onClick={() => setConstellationOpen(false)} label="Leave (Esc)" d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9" />
      </div>
    </div>,
    document.body,
  );
}

/**
 * The only button style in here.
 *
 * Icon-only, no fill, no border until you approach it — over a photographic
 * frame a filled pill reads as a sticker. It earns a surface on hover, which is
 * the moment it stops being decoration and becomes a target.
 */
function GlassButton({ onClick, label, d, spin }: { onClick: () => void; label: string; d: string; spin?: boolean }) {
  const [hot, setHot] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      style={{
        width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 999, cursor: 'pointer',
        border: `1px solid rgba(190,214,255,${hot ? 0.34 : 0.12})`,
        background: hot ? 'rgba(12,18,32,0.66)' : 'rgba(8,12,22,0.28)',
        color: hot ? '#EAF1FF' : 'rgba(214,228,255,0.72)',
        backdropFilter: 'blur(10px)',
        transition: 'background 220ms ease, color 220ms ease, border-color 220ms ease, transform 220ms ease',
        transform: hot ? 'scale(1.06)' : 'scale(1)',
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={spin ? { opacity: 0.95 } : undefined}>
        <path d={d} />
      </svg>
    </button>
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
