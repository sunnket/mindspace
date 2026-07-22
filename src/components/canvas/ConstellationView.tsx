'use client';

/**
 * Constellation View — the galaxy at the top of the zoom.
 *
 * Semantic zoom stops being useful once type is smaller than a gist. This is
 * the answer to "what then": pull back far enough and the whole board becomes a
 * night sky. Every block is a star at its true position; blocks that cluster in
 * space become a named constellation; clicking one flies the real camera back
 * down into that corner of the canvas. Massive boards stop being intimidating
 * and become somewhere you *explore*.
 *
 * The whole thing is a screen-space overlay that dissolves in as `zoom` crosses
 * the galaxy band (see lib/constellations). It renders into document.body so it
 * sits cleanly above every piece of board chrome without fighting z-index, and
 * runs its own wheel/keyboard handlers so it never depends on the board's.
 *
 * The star map uses a STABLE fit transform (whole board, centred, always fully
 * visible) — deliberately not the live camera — so the sky is a dependable
 * overview however the camera happened to be framed when you pulled out.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { cameraForRect } from '@/lib/frames';
import { clamp } from '@/lib/utils';
import {
  buildGalaxy,
  galaxyFit,
  galaxyProgress,
  fallbackLabel,
  GALAXY_FADE_START,
  type Galaxy,
  type GalaxyFit,
  type Constellation,
  type Star,
} from '@/lib/constellations';
import AstronautCat from './AstronautCat';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

const EMPTY_GALAXY: Galaxy = { stars: [], constellations: [], bounds: null };

/* Warm, brand-matched starlight — embers in deep space, not clinical blue. */
const STAR_CORE = '#FFEFD6';
const LINE_RGB = '242, 169, 80';

/* ------------------------------------------------------------ ambient sky */

interface Amb { x: number; y: number; layer: number; phase: number; a: number; s: number }
interface Neb { x: number; y: number; r: number; warm: boolean; phase: number; vx: number; vy: number }
interface Shoot { x: number; y: number; vx: number; vy: number; life: number; max: number }

function makeAmbient(w: number, h: number): Amb[] {
  const count = Math.min(460, Math.max(160, Math.floor((w * h) / 4200)));
  const out: Amb[] = [];
  for (let i = 0; i < count; i++) {
    const layer = i % 3; // parallax depth
    out.push({
      x: Math.random(),
      y: Math.random(),
      layer,
      phase: Math.random() * Math.PI * 2,
      a: 0.25 + Math.random() * 0.6,
      s: 0.4 + layer * 0.45 + Math.random() * 0.5,
    });
  }
  return out;
}

function makeNebulae(): Neb[] {
  return Array.from({ length: 4 }, (_, i) => ({
    x: 0.2 + Math.random() * 0.6,
    y: 0.2 + Math.random() * 0.6,
    r: 0.24 + Math.random() * 0.22,
    warm: i % 2 === 0,
    phase: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 0.004,
    vy: (Math.random() - 0.5) * 0.004,
  }));
}

/* -------------------------------------------------------- constellation MST */

interface Pt { x: number; y: number }

/** Minimum spanning tree over member stars — the lines that read as a real
 *  constellation (every star linked once, no crossing thicket). */
function mstEdges(pts: Pt[]): [number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const dist = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  dist[0] = 0;
  const edges: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!inTree[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    inTree[u] = true;
    if (parent[u] >= 0) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = (pts[u].x - pts[v].x) ** 2 + (pts[u].y - pts[v].y) ** 2;
      if (d < dist[v]) { dist[v] = d; parent[v] = u; }
    }
  }
  return edges;
}

/* ================================================================== view */

export default function ConstellationView() {
  const camera = useCanvasStore((s) => s.camera);
  const objects = useCanvasStore((s) => s.objects);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const constellationNames = useCanvasStore((s) => s.constellationNames);
  const setConstellationName = useCanvasStore((s) => s.setConstellationName);
  const exitConstellationView = useCanvasStore((s) => s.exitConstellationView);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const residentEnabled = useCanvasStore((s) => s.residentEnabled);
  const readOnly = useCanvasStore((s) => s.readOnly);
  const workspaceTitle = useCanvasStore((s) => s.workspaceTitle);

  const progress = galaxyProgress(camera.zoom);
  const mounted = progress > 0.001;
  const interactive = progress >= 0.55;

  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRef = useRef<string | null>(null);
  const fitRef = useRef<GalaxyFit | null>(null);
  const galaxyRef = useRef<Galaxy | null>(null);
  const edgesRef = useRef<Map<string, [Pt, Pt][]>>(new Map());
  const ambRef = useRef<Amb[]>([]);
  const nebRef = useRef<Neb[]>([]);
  const shootRef = useRef<Shoot[]>([]);

  const parentId = resolveParentId(canvasStack, urlCanvasId);

  const levelObjects = useMemo(
    () => objects.filter((o) => (o.parentId ?? undefined) === parentId),
    [objects, parentId],
  );

  // The clustering is O(n²); a massive board is exactly where this feature
  // matters and exactly where that would sting, so it only ever runs while the
  // sky is actually on screen — normal editing pays nothing.
  const galaxy = useMemo(
    () => (mounted ? buildGalaxy(levelObjects, constellationNames) : EMPTY_GALAXY),
    [mounted, levelObjects, constellationNames],
  );

  const fit = useMemo(
    () => (galaxy.bounds ? galaxyFit(galaxy.bounds, vp.w, vp.h) : null),
    [galaxy.bounds, vp.w, vp.h],
  );

  // Constellation lines, in world coordinates, computed once per galaxy.
  const clusterEdges = useMemo(() => {
    const byId = new Map(galaxy.stars.map((s) => [s.id, s]));
    const out = new Map<string, [Pt, Pt][]>();
    for (const c of galaxy.constellations) {
      const pts: Pt[] = c.starIds
        .map((id) => byId.get(id))
        .filter((s): s is Star => !!s)
        .map((s) => ({ x: s.wx, y: s.wy }));
      out.set(c.id, mstEdges(pts).map(([a, b]) => [pts[a], pts[b]] as [Pt, Pt]));
    }
    return out;
  }, [galaxy]);

  // keep the animation loop's refs current without it depending on React state
  useEffect(() => { fitRef.current = fit; }, [fit]);
  useEffect(() => { galaxyRef.current = galaxy; }, [galaxy]);
  useEffect(() => { edgesRef.current = clusterEdges; }, [clusterEdges]);
  useEffect(() => { hoveredRef.current = hovered; }, [hovered]);

  // track viewport size
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      ambRef.current = makeAmbient(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted]);

  // seed ambient sky once mounted
  useEffect(() => {
    if (!mounted) return;
    if (ambRef.current.length === 0) ambRef.current = makeAmbient(vp.w, vp.h);
    if (nebRef.current.length === 0) nebRef.current = makeNebulae();
  }, [mounted, vp.w, vp.h]);

  /* ---------------------------------------------------------- the render loop */
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let lastShoot = performance.now() + 2500;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current;
      if (!cv) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;

      // 1) nebulae — slow warm/cool clouds, additive so they glow
      ctx.globalCompositeOperation = 'lighter';
      for (const n of nebRef.current) {
        n.x += n.vx * 0.02; n.y += n.vy * 0.02;
        if (n.x < 0.05 || n.x > 0.95) n.vx *= -1;
        if (n.y < 0.05 || n.y > 0.95) n.vy *= -1;
        const cx = n.x * w, cy = n.y * h;
        const r = n.r * Math.min(w, h) * (0.9 + 0.1 * Math.sin(t * 0.2 + n.phase));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        if (n.warm) {
          g.addColorStop(0, 'rgba(214, 126, 60, 0.16)');
          g.addColorStop(0.5, 'rgba(150, 84, 48, 0.06)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
          g.addColorStop(0, 'rgba(70, 96, 168, 0.12)');
          g.addColorStop(0.5, 'rgba(50, 60, 120, 0.05)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2) ambient stars — three parallax layers drifting, each twinkling
      for (const st of ambRef.current) {
        st.x += (0.0006 + st.layer * 0.0004) * 0.016 * st.s;
        if (st.x > 1) st.x -= 1;
        const sx = st.x * w, sy = st.y * h;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + st.s) + st.phase);
        const alpha = st.a * tw;
        const rad = 0.5 + st.layer * 0.5;
        ctx.fillStyle = `rgba(255, 246, 232, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3) shooting star, once in a while
      if (now > lastShoot && shootRef.current.length < 2) {
        lastShoot = now + 4000 + Math.random() * 7000;
        const fromLeft = Math.random() < 0.5;
        shootRef.current.push({
          x: fromLeft ? -0.05 * w : 1.05 * w,
          y: Math.random() * h * 0.5,
          vx: (fromLeft ? 1 : -1) * (520 + Math.random() * 320),
          vy: 160 + Math.random() * 160,
          life: 0,
          max: 0.9 + Math.random() * 0.5,
        });
      }
      shootRef.current = shootRef.current.filter((s) => s.life < s.max);
      for (const s of shootRef.current) {
        s.life += 0.016;
        s.x += s.vx * 0.016; s.y += s.vy * 0.016;
        const fade = 1 - s.life / s.max;
        const tailX = s.x - s.vx * 0.06, tailY = s.y - s.vy * 0.06;
        const g = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
        g.addColorStop(0, 'rgba(255,239,214,0)');
        g.addColorStop(1, `rgba(255,239,214,${(0.9 * fade).toFixed(3)})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }

      // 4) the board itself — constellation lines, then the stars
      const f = fitRef.current;
      const gx = galaxyRef.current;
      const hov = hoveredRef.current;
      if (f && gx) {
        const project = (p: Pt) => ({ x: p.x * f.scale + f.offsetX, y: p.y * f.scale + f.offsetY });

        // lines — normal blend so they read as drawn lines, not just glow
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        for (const c of gx.constellations) {
          const edges = edgesRef.current.get(c.id);
          if (!edges) continue;
          const on = hov === c.id;
          ctx.strokeStyle = `rgba(${LINE_RGB}, ${on ? 0.65 : 0.26})`;
          ctx.lineWidth = on ? 1.6 : 1;
          ctx.beginPath();
          for (const [a, b] of edges) {
            const pa = project(a), pb = project(b);
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
          }
          ctx.stroke();
        }

        // stars (additive glow)
        ctx.globalCompositeOperation = 'lighter';
        for (const s of gx.stars) {
          const p = project({ x: s.wx, y: s.wy });
          const on = hov && s.clusterId === hov;
          const tw = 0.7 + 0.3 * Math.sin(t * 1.6 + s.seed * 12);
          const rad = (s.r + 0.7) * (on ? 1.5 : 1) * (0.85 + 0.15 * tw);
          const glowR = rad * 4.2;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
          g.addColorStop(0, `rgba(255, 233, 199, ${(0.9 * (on ? 1 : s.bright) * tw).toFixed(3)})`);
          g.addColorStop(0.35, `rgba(242, 169, 80, ${(0.28 * (on ? 1 : s.bright)).toFixed(3)})`);
          g.addColorStop(1, 'rgba(242, 169, 80, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
          ctx.fill();
          // crisp core
          ctx.fillStyle = STAR_CORE;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, rad * 0.55), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  /* --------------------------------------------------------- interactions */

  // wheel = zoom toward the centre of the sky; crossing the band closes it.
  // Attached the whole time the sky is up, so descending never briefly hands
  // the wheel back to the board's pan handler mid-gesture.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !mounted) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = useCanvasStore.getState().camera;
      const nz = clamp(cam.zoom * Math.exp(-e.deltaY * 0.005), MIN_ZOOM, MAX_ZOOM);
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const wx = (cx - cam.x) / cam.zoom, wy = (cy - cam.y) / cam.zoom;
      useCanvasStore.getState().setCamera({ x: cx - wx * nz, y: cy - wy * nz, zoom: nz });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [mounted]);

  // Esc leaves the sky — captured so it doesn't also pop a nested canvas
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing) return; // the rename input handles its own Esc
      if (galaxyProgress(useCanvasStore.getState().camera.zoom) < 0.3) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      exitConstellationView();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mounted, editing, exitConstellationView]);

  const flyTo = (c: Constellation) => {
    if (editing) return;
    const b = c.bounds;
    const pad = Math.max(80, (b.maxX - b.minX) * 0.12);
    const rect = {
      x: b.minX - pad,
      y: b.minY - pad,
      width: b.maxX - b.minX + pad * 2,
      height: b.maxY - b.minY + pad * 2,
    };
    const cam = cameraForRect(rect, vp.w, vp.h, 0.16);
    // A cluster that spans most of the board could fit at a zoom still inside
    // the galaxy band — which would leave you stranded in the sky. Guarantee
    // the descent by clamping the landing zoom clear of the band, re-centring
    // on the cluster so it stays framed.
    if (cam.zoom < GALAXY_FADE_START + 0.06) {
      const z = GALAXY_FADE_START + 0.12;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      animateCamera({ x: vp.w / 2 - cx * z, y: vp.h / 2 - cy * z, zoom: z }, 950);
      return;
    }
    animateCamera(cam, 950);
  };

  const commitRename = (c: Constellation) => {
    setConstellationName(c.anchorId, draft);
    setEditing(null);
    setDraft('');
  };

  if (!mounted || typeof document === 'undefined') return null;

  const labelStars = fit
    ? galaxy.constellations.map((c) => ({ c, p: { x: c.cx * fit.scale + fit.offsetX, y: c.cy * fit.scale + fit.offsetY } }))
    : [];

  return createPortal(
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        opacity: progress,
        // The sky owns input the whole time it's up — at this zoom the board is
        // an unreadable smear anyway, so nothing is lost, and the wheel/Esc
        // handlers stay reliable through the dissolve.
        pointerEvents: 'auto',
        // deep space that stays black no matter the canvas's own paper colour
        background:
          'radial-gradient(120% 90% at 50% 12%, #10131f 0%, #0a0c15 45%, #05060c 100%)',
        transition: 'opacity 0.12s linear',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onMouseDown={(e) => {
        // swallow clicks so the board underneath never places a stray block
        if (e.target === e.currentTarget) e.stopPropagation();
      }}
    >
      {/* the sky */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* clickable constellation regions + their names */}
      {labelStars.map(({ c, p }) => {
        const isHover = hovered === c.id;
        const label = c.name || fallbackLabel(c.count);
        return (
          <div key={c.id}>
            {/* hit region over the cluster's footprint */}
            <button
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered((h) => (h === c.id ? null : h))}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => flyTo(c)}
              title={`Fly into “${label}”`}
              style={{
                position: 'absolute',
                left: c.bounds.minX * (fit?.scale ?? 1) + (fit?.offsetX ?? 0),
                top: c.bounds.minY * (fit?.scale ?? 1) + (fit?.offsetY ?? 0),
                width: Math.max(48, (c.bounds.maxX - c.bounds.minX) * (fit?.scale ?? 1)),
                height: Math.max(48, (c.bounds.maxY - c.bounds.minY) * (fit?.scale ?? 1)),
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
              aria-label={`Fly into ${label}`}
            />

            {/* the name */}
            <div
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y,
                transform: 'translate(-50%, -50%)',
                pointerEvents: editing === c.id ? 'auto' : 'none',
                zIndex: 5,
              }}
            >
              {editing === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(c); }
                    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setDraft(''); }
                  }}
                  placeholder="name this constellation"
                  style={{
                    background: 'rgba(12,14,22,0.9)',
                    border: '1px solid rgba(242,169,80,0.7)',
                    borderRadius: 8,
                    color: '#FFEFD6',
                    font: "600 13px 'Outfit', sans-serif",
                    letterSpacing: '0.04em',
                    textAlign: 'center',
                    padding: '4px 10px',
                    outline: 'none',
                    width: 200,
                    boxShadow: '0 0 24px rgba(242,169,80,0.25)',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 10px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                    background: isHover ? 'rgba(20,16,10,0.66)' : 'rgba(10,12,20,0.28)',
                    border: `1px solid rgba(242,169,80,${isHover ? 0.55 : 0.22})`,
                    color: c.name ? '#FFEFD6' : 'rgba(255,239,214,0.6)',
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 600,
                    fontSize: isHover ? 13 : 12,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    textShadow: '0 0 14px rgba(242,169,80,0.45)',
                    boxShadow: isHover ? '0 0 26px rgba(242,169,80,0.22)' : 'none',
                    transition: 'all 0.18s ease',
                    backdropFilter: 'blur(2px)',
                  }}
                >
                  <span>{label}</span>
                  <span style={{ opacity: 0.5, fontSize: 10, fontWeight: 500 }}>{c.count}</span>
                  {!readOnly && interactive && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c.id);
                        setDraft(c.custom ? c.name : '');
                      }}
                      title="Rename constellation"
                      style={{
                        pointerEvents: 'auto',
                        display: isHover ? 'inline-flex' : 'none',
                        alignItems: 'center',
                        border: 'none',
                        background: 'transparent',
                        color: 'rgba(255,239,214,0.75)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 11,
                      }}
                    >
                      ✎
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* the suited-up resident, adrift */}
      <AstronautCat active={residentEnabled && progress > 0.35} />

      {/* title */}
      <div style={{ position: 'absolute', top: 34, left: 40, pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'rgba(242,169,80,0.85)',
            marginBottom: 6,
          }}
        >
          Constellation View
        </div>
        <div
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 30,
            fontWeight: 300,
            letterSpacing: '-0.01em',
            color: '#F7EFE2',
            textShadow: '0 0 30px rgba(242,169,80,0.25)',
          }}
        >
          {workspaceTitle || 'Untitled'}
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(255,246,232,0.4)', marginTop: 6 }}>
          {galaxy.constellations.length} constellation{galaxy.constellations.length === 1 ? '' : 's'} · {galaxy.stars.length} star{galaxy.stars.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* exit */}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => exitConstellationView()}
        style={{
          position: 'absolute',
          top: 34,
          right: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 999,
          border: '1px solid rgba(242,169,80,0.35)',
          background: 'rgba(12,14,22,0.5)',
          color: '#FFEFD6',
          fontFamily: "'Outfit', sans-serif",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'auto',
        }}
        title="Return to the board (Esc)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        Land
      </button>

      {/* hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 26,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          fontFamily: "'Outfit', sans-serif",
          fontSize: 12,
          color: 'rgba(255,246,232,0.5)',
          letterSpacing: '0.02em',
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        Click a constellation to fly in · scroll to descend · Esc to return
      </div>
    </div>,
    document.body,
  );
}
