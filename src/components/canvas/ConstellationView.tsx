'use client';

/**
 * Constellation View — a warm galaxy you compose yourself.
 *
 * Every block on the board is a star. There is NO auto-clustering and NO
 * auto-naming: the sky only holds the shapes you draw in it. You drag stars
 * where you want them, wire them into your own constellations, name the
 * constellations (shown always) and the stars (shown on hover). A star always
 * remembers the real block it stands for, so a tap flies you back down to it.
 *
 * The view has its OWN camera (pan + zoom), fully decoupled from the canvas —
 * you can zoom deep into a corner of the sky without ever falling back to the
 * board. It's opened from the minimap and closed with Land / Esc.
 *
 * The look is the warm "galaxy" the user chose: a deep gradient, warm nebula
 * haze, drifting parallax starlight and amber-cored constellations — not a cold
 * observatory. Interaction lives in a thin DOM layer over one canvas.
 *
 * The whole sky is mounted only while open (a thin wrapper gates it), so the
 * inner component initialises its camera lazily at mount — no init effect, no
 * synchronous setState during an effect.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { cameraForRect } from '@/lib/frames';
import {
  buildStars,
  skyComponents,
  validLinks,
  nearestLinks,
  sameLink,
  skyFit,
  projSky,
  unprojSky,
  SKY_MIN_ZOOM,
  SKY_MAX_ZOOM,
  type DataStar,
  type SkyCam,
} from '@/lib/constellations';
import AstronautCat from './AstronautCat';

export default function ConstellationView() {
  const open = useCanvasStore((s) => s.constellationOpen);
  if (!open || typeof document === 'undefined') return null;
  return <ConstellationSky />;
}

/* Warm, brand-matched starlight — embers in deep space. */
const AMBIENT_RGB = '255,246,232'; // warm-white ambient
const CORE_RGB = '255,239,214';    // cream star core
const GLOW_RGB = '242,169,80';     // amber / ginger bloom + constellation lines

/* --------------------------------------------------------- backdrop model */

interface BgStar { x: number; y: number; a: number; size: number; depth: number; phase: number; rgb: string; tw: number }
interface Neb { x: number; y: number; r: number; rgb: string; phase: number }
interface Shoot { x: number; y: number; vx: number; vy: number; life: number; max: number }

function genBackdrop(w: number, h: number): { dust: BgStar[]; mid: BgStar[]; bright: BgStar[]; neb: Neb[] } {
  const area = w * h;
  // Far fewer, smaller and dimmer than before — this is deliberate. The only
  // stars that should catch the eye are YOUR blocks (the amber ones); the
  // background is just a faint dusting so those never get lost in the noise.
  const dust: BgStar[] = [];
  const nDust = Math.min(360, Math.max(140, Math.floor(area / 5600)));
  for (let i = 0; i < nDust; i++) {
    dust.push({
      x: Math.random(), y: Math.random(),
      a: 0.05 + Math.random() * 0.14, size: 0.45 + Math.random() * 0.5,
      depth: 0.08 + (i % 3) * 0.06, phase: Math.random() * 6.28, rgb: AMBIENT_RGB, tw: 0.12 + Math.random() * 0.22,
    });
  }
  const mid: BgStar[] = [];
  for (let i = 0; i < 64; i++) {
    mid.push({
      x: Math.random(), y: Math.random(),
      a: 0.16 + Math.random() * 0.22, size: 0.7 + Math.random() * 0.7,
      depth: 0.34 + Math.random() * 0.08, phase: Math.random() * 6.28, rgb: AMBIENT_RGB, tw: 0.28 + Math.random() * 0.3,
    });
  }
  const bright: BgStar[] = [];
  for (let i = 0; i < 12; i++) {
    bright.push({
      x: Math.random(), y: Math.random(),
      a: 0.34 + Math.random() * 0.26, size: 1.1 + Math.random() * 1.0,
      depth: 0.5 + Math.random() * 0.12, phase: Math.random() * 6.28, rgb: CORE_RGB, tw: 0.35 + Math.random() * 0.4,
    });
  }
  const neb: Neb[] = [
    { x: 0.26, y: 0.32, r: 0.52, rgb: '214,126,60', phase: 0 },   // warm
    { x: 0.74, y: 0.64, r: 0.55, rgb: '150,84,48', phase: 2 },    // dim warm
    { x: 0.6, y: 0.2, r: 0.42, rgb: '70,96,168', phase: 4 },      // one cool for depth
  ];
  return { dust, mid, bright, neb };
}

const wrapMod = (v: number, m: number) => ((v % m) + m) % m;

/* ================================================================== sky */

function ConstellationSky() {
  const setConstellationOpen = useCanvasStore((s) => s.setConstellationOpen);
  const objects = useCanvasStore((s) => s.objects);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const sky = useCanvasStore((s) => s.sky);
  const moveSkyStar = useCanvasStore((s) => s.moveSkyStar);
  const nameSkyStar = useCanvasStore((s) => s.nameSkyStar);
  const addSkyLink = useCanvasStore((s) => s.addSkyLink);
  const removeSkyLink = useCanvasStore((s) => s.removeSkyLink);
  const nameSkyConstellation = useCanvasStore((s) => s.nameSkyConstellation);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const residentEnabled = useCanvasStore((s) => s.residentEnabled);
  const workspaceTitle = useCanvasStore((s) => s.workspaceTitle);

  const parentId = resolveParentId(canvasStack, urlCanvasId);
  const levelObjects = useMemo(
    () => objects.filter((o) => (o.parentId ?? undefined) === parentId),
    [objects, parentId],
  );
  const stars = useMemo(() => buildStars(levelObjects, sky), [levelObjects, sky]);
  const idSet = useMemo(() => new Set(stars.map((s) => s.id)), [stars]);
  const links = useMemo(() => validLinks(sky.links || [], idSet), [sky.links, idSet]);
  // Gentle nearest-neighbour tethers so a fresh sky reads as a map, not confetti.
  const autoLinks = useMemo(() => nearestLinks(stars, links), [stars, links]);
  const components = useMemo(() => skyComponents(stars.map((s) => s.id), links, sky.names || {}), [stars, links, sky.names]);
  const starById = useMemo(() => new Map(stars.map((s) => [s.id, s])), [stars]);

  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const [skyCam, setSkyCam] = useState<SkyCam>(() =>
    skyFit(stars, typeof window !== 'undefined' ? window.innerWidth : 1440, typeof window !== 'undefined' ? window.innerHeight : 900),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'star' | 'const'; id: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [dragStar, setDragStar] = useState<{ id: string; wx: number; wy: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp);
  const skyCamRef = useRef(skyCam);
  const starsRef = useRef<DataStar[]>(stars);
  const linksRef = useRef<[string, string][]>(links);
  const autoLinksRef = useRef<[string, string][]>(autoLinks);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const linkFromRef = useRef<string | null>(null);
  const dragStarRef = useRef<{ id: string; wx: number; wy: number } | null>(null);
  const tempLinkRef = useRef<{ fromId: string; fromWX: number; fromWY: number; sx: number; sy: number } | null>(null);
  const bgRef = useRef<ReturnType<typeof genBackdrop> | null>(null);
  const shootRef = useRef<Shoot[]>([]);

  useEffect(() => { vpRef.current = vp; }, [vp]);
  useEffect(() => { skyCamRef.current = skyCam; }, [skyCam]);
  useEffect(() => { starsRef.current = stars; }, [stars]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { autoLinksRef.current = autoLinks; }, [autoLinks]);
  useEffect(() => { hoverRef.current = hovered; }, [hovered]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { linkFromRef.current = linkFrom; }, [linkFrom]);
  useEffect(() => { dragStarRef.current = dragStar; }, [dragStar]);

  const posOf = (s: DataStar) => (dragStar && dragStar.id === s.id ? { x: dragStar.wx, y: dragStar.wy } : { x: s.wx, y: s.wy });
  const proj = (wx: number, wy: number) => projSky(skyCam, wx, wy, vp.w, vp.h);

  useEffect(() => {
    const onResize = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      bgRef.current = genBackdrop(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---------------------------------------------------------- the render loop */
  useEffect(() => {
    let raf = 0;
    let lastShoot = performance.now() + 3000;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current;
      if (!cv) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!bgRef.current) bgRef.current = genBackdrop(w, h);
      const bg = bgRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      const cam = skyCamRef.current;
      const zk = 0.75 + 0.4 * Math.min(2, cam.zoom);

      // 1) nebulae — warm haze (+ one cool for depth), additive so they glow
      ctx.globalCompositeOperation = 'lighter';
      for (const n of bg.neb) {
        const cx = wrapMod(n.x * w - cam.x * 0.03, w);
        const cy = wrapMod(n.y * h - cam.y * 0.03, h);
        const r = n.r * Math.min(w, h) * (0.95 + 0.05 * Math.sin(t * 0.15 + n.phase));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${n.rgb},0.15)`);
        g.addColorStop(0.5, `rgba(${n.rgb},0.05)`);
        g.addColorStop(1, `rgba(${n.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }

      // 2) the tiling, parallax star field — three depths
      const drawLayer = (arr: BgStar[], useArc: boolean) => {
        for (const st of arr) {
          const sx = wrapMod(st.x * w - cam.x * st.depth * 0.4 + t * st.depth * 3, w);
          const sy = wrapMod(st.y * h - cam.y * st.depth * 0.4, h);
          const tw = 1 - st.tw + st.tw * (0.5 + 0.5 * Math.sin(t * (0.5 + st.size) + st.phase));
          const a = st.a * tw;
          const sz = st.size * zk;
          ctx.fillStyle = `rgba(${st.rgb},${a.toFixed(3)})`;
          if (useArc) { ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(sx, sy, sz, sz);
        }
      };
      drawLayer(bg.dust, false);
      drawLayer(bg.mid, true);
      for (const st of bg.bright) {
        const sx = wrapMod(st.x * w - cam.x * st.depth * 0.4 + t * st.depth * 3, w);
        const sy = wrapMod(st.y * h - cam.y * st.depth * 0.4, h);
        const tw = 1 - st.tw + st.tw * (0.5 + 0.5 * Math.sin(t * (0.4 + st.size) + st.phase));
        drawGlowStar(ctx, sx, sy, st.size * zk, st.rgb, st.a * tw);
      }

      // 3) shooting star, occasionally
      if (now > lastShoot && shootRef.current.length < 2) {
        lastShoot = now + 5000 + Math.random() * 9000;
        const fromLeft = Math.random() < 0.5;
        shootRef.current.push({
          x: fromLeft ? -0.05 * w : 1.05 * w, y: Math.random() * h * 0.55,
          vx: (fromLeft ? 1 : -1) * (560 + Math.random() * 340), vy: 150 + Math.random() * 150,
          life: 0, max: 0.8 + Math.random() * 0.5,
        });
      }
      shootRef.current = shootRef.current.filter((s) => s.life < s.max);
      for (const s of shootRef.current) {
        s.life += 0.016; s.x += s.vx * 0.016; s.y += s.vy * 0.016;
        const fade = 1 - s.life / s.max;
        const tx = s.x - s.vx * 0.05, ty = s.y - s.vy * 0.05;
        const g = ctx.createLinearGradient(tx, ty, s.x, s.y);
        g.addColorStop(0, `rgba(${CORE_RGB},0)`);
        g.addColorStop(1, `rgba(${CORE_RGB},${(0.85 * fade).toFixed(3)})`);
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
      }

      // 4) YOUR constellations — links first, then the amber stars
      const dstars = starsRef.current;
      const drag = dragStarRef.current;
      const posLive = (s: DataStar) => (drag && drag.id === s.id ? { x: drag.wx, y: drag.wy } : { x: s.wx, y: s.wy });
      const P = (wx: number, wy: number) => projSky(cam, wx, wy, vpRef.current.w, vpRef.current.h);
      const byId = new Map(dstars.map((s) => [s.id, s]));
      const hov = hoverRef.current;

      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';

      // faint nearest-neighbour tethers — a quiet sense of "what's near what".
      // They're guide lines only: never named, never stored, always under your
      // own wiring so the sky reads as a map even before you connect anything.
      ctx.strokeStyle = `rgba(${GLOW_RGB},0.12)`;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 6]);
      for (const [a, b] of autoLinksRef.current) {
        const sa = byId.get(a), sb = byId.get(b);
        if (!sa || !sb) continue;
        const pa = P(posLive(sa).x, posLive(sa).y);
        const pb = P(posLive(sb).x, posLive(sb).y);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const [a, b] of linksRef.current) {
        const sa = byId.get(a), sb = byId.get(b);
        if (!sa || !sb) continue;
        const pa = P(posLive(sa).x, posLive(sa).y);
        const pb = P(posLive(sb).x, posLive(sb).y);
        const on = hov === a || hov === b;
        ctx.strokeStyle = `rgba(${GLOW_RGB},${on ? 0.62 : 0.3})`;
        ctx.lineWidth = on ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }

      const tl = tempLinkRef.current;
      if (tl && tl.sx > -9000) {
        const pa = P(tl.fromWX, tl.fromWY);
        ctx.strokeStyle = `rgba(120,210,255,0.75)`;
        ctx.lineWidth = 1.3; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(tl.sx, tl.sy); ctx.stroke();
        ctx.setLineDash([]);
      }

      const sel = selectedRef.current;
      const lf = linkFromRef.current;
      ctx.globalCompositeOperation = 'lighter';
      for (const s of dstars) {
        const p = P(posLive(s).x, posLive(s).y);
        const active = hov === s.id || sel === s.id || lf === s.id;
        const tw = 0.72 + 0.28 * Math.sin(t * 1.4 + s.seed * 11);
        // your blocks burn brighter and a touch bigger than before, so "which
        // one is my star" is never a question against the dimmed backdrop.
        const rad = (s.r + 1.1) * (0.9 + 0.1 * tw) * (active ? 1.4 : 1);
        drawGlowStar(ctx, p.x, p.y, rad, GLOW_RGB, (active ? 1 : 0.82 + s.bright * 0.18) * tw);
        if (active) {
          ctx.globalCompositeOperation = 'source-over';
          const ringOn = sel === s.id || lf === s.id;
          ctx.strokeStyle = lf === s.id ? 'rgba(120,210,255,0.95)' : ringOn ? 'rgba(255,214,150,0.95)' : 'rgba(255,214,150,0.7)';
          ctx.lineWidth = ringOn ? 1.6 : 1.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, rad * 2.6 + 5, 0, Math.PI * 2); ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------------------------------------------------------- interactions */

  const goTo = (s: DataStar) => {
    const pad = Math.max(140, s.goW * 0.4);
    const rect = { x: s.goX - pad, y: s.goY - pad, width: s.goW + pad * 2, height: s.goH + pad * 2 };
    animateCamera(cameraForRect(rect, vp.w, vp.h, 0.2), 850);
    setConstellationOpen(false);
  };

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const cam0 = { ...skyCamRef.current };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > 4) moved = true;
      const cam = { x: cam0.x - dx / cam0.zoom, y: cam0.y - dy / cam0.zoom, zoom: cam0.zoom };
      skyCamRef.current = cam;
      setSkyCam(cam);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // a click on empty sky clears everything: editing, selection, connect mode
      if (!moved) {
        setEditing(null);
        setSelected(null);
        setLinkFrom(null);
        tempLinkRef.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginStarPress = (e: React.PointerEvent, s: DataStar) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const cam0 = { ...skyCamRef.current };
    const grab = unprojSky(cam0, sx, sy, vpRef.current.w, vpRef.current.h);
    const off = { x: s.wx - grab.x, y: s.wy - grab.y };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) moved = true;
      if (moved) {
        const wpt = unprojSky(cam0, ev.clientX, ev.clientY, vpRef.current.w, vpRef.current.h);
        const next = { id: s.id, wx: wpt.x + off.x, wy: wpt.y + off.y };
        dragStarRef.current = next;
        setDragStar(next);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        if (dragStarRef.current) moveSkyStar(s.id, dragStarRef.current.wx, dragStarRef.current.wy);
      } else {
        // a tap, not a drag
        const from = linkFromRef.current;
        if (from && from !== s.id) {
          // second star of a connection: toggle the link, then select the target
          if (linksRef.current.some((l) => sameLink(l, from, s.id))) removeSkyLink(from, s.id);
          else addSkyLink(from, s.id);
          setLinkFrom(null);
          tempLinkRef.current = null;
          setSelected(s.id);
        } else if (from && from === s.id) {
          // tapped the source again — cancel connect mode
          setLinkFrom(null);
          tempLinkRef.current = null;
        } else {
          // plain tap: select this star and pin its controls (fly is a button now)
          setSelected(s.id);
          setEditing(null);
        }
      }
      dragStarRef.current = null;
      setDragStar(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Connect mode (opened from a star's "Connect" button): trail a dashed line
  // from the source star to the cursor until you tap the second star.
  useEffect(() => {
    if (!linkFrom) { tempLinkRef.current = null; return; }
    const s = starById.get(linkFrom);
    if (!s) return;
    const from = dragStar && dragStar.id === s.id ? { x: dragStar.wx, y: dragStar.wy } : { x: s.wx, y: s.wy };
    tempLinkRef.current = { fromId: s.id, fromWX: from.x, fromWY: from.y, sx: -9999, sy: -9999 };
    const onMove = (ev: PointerEvent) => {
      if (tempLinkRef.current) { tempLinkRef.current.sx = ev.clientX; tempLinkRef.current.sy = ev.clientY; }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [linkFrom, starById, dragStar]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = skyCamRef.current;
      const nz = Math.min(SKY_MAX_ZOOM, Math.max(SKY_MIN_ZOOM, cam.zoom * Math.exp(-e.deltaY * 0.0016)));
      const before = unprojSky(cam, e.clientX, e.clientY, vpRef.current.w, vpRef.current.h);
      const after = unprojSky({ ...cam, zoom: nz }, e.clientX, e.clientY, vpRef.current.w, vpRef.current.h);
      const ncam = { x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), zoom: nz };
      skyCamRef.current = ncam;
      setSkyCam(ncam);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      // unwind one layer at a time: connect → edit → selection → leave
      if (linkFrom) { setLinkFrom(null); tempLinkRef.current = null; }
      else if (editing) setEditing(null);
      else if (selected) setSelected(null);
      else setConstellationOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, linkFrom, selected, setConstellationOpen]);

  const commitStarName = (id: string) => { nameSkyStar(id, draft); setEditing(null); setDraft(''); };
  const commitConstName = (anchor: string) => { nameSkyConstellation(anchor, draft); setEditing(null); setDraft(''); };

  return createPortal(
    <div
      ref={rootRef}
      onPointerDown={beginPan}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, overflow: 'hidden', userSelect: 'none', cursor: 'grab',
        // deep space that stays dark no matter the board's paper colour
        background: 'radial-gradient(120% 90% at 50% 12%, #10131f 0%, #0a0c15 45%, #05060c 100%)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />

      {/* constellation names — always shown, above each group */}
      {components.map((c) => {
        const members = c.ids.map((id) => starById.get(id)).filter((s): s is DataStar => !!s);
        if (members.length === 0) return null;
        const cx = members.reduce((a, s) => a + posOf(s).x, 0) / members.length;
        const topY = Math.min(...members.map((s) => posOf(s).y));
        const p = proj(cx, topY);
        const isEd = editing?.kind === 'const' && editing.id === c.anchor;
        return (
          <div
            key={`c-${c.anchor}`}
            style={{ position: 'absolute', left: p.x, top: p.y - 26, transform: 'translate(-50%,-50%)', zIndex: 5 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isEd ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitConstName(c.anchor)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitConstName(c.anchor); }
                  else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setDraft(''); }
                }}
                placeholder="name this constellation"
                style={inputStyle}
              />
            ) : (
              <button
                onClick={() => { setEditing({ kind: 'const', id: c.anchor }); setDraft(c.name); }}
                title="Rename constellation"
                style={{ ...chipStyle, color: c.name ? '#FFEFD6' : 'rgba(255,239,214,0.55)', letterSpacing: '0.16em', fontSize: 12 }}
              >
                {c.name || '＋ name'}
              </button>
            )}
          </div>
        );
      })}

      {/* stars — the interaction layer (the canvas draws their light) */}
      {stars.map((s) => {
        const p = proj(posOf(s).x, posOf(s).y);
        const isHover = hovered === s.id;
        const isSel = selected === s.id;
        const isEd = editing?.kind === 'star' && editing.id === s.id;
        const isLinkSrc = linkFrom === s.id;
        const isTarget = !!linkFrom && !isLinkSrc; // a candidate second star while connecting
        const showPanel = isSel || isEd;
        const hasLinks = links.some((l) => l[0] === s.id || l[1] === s.id);
        const raised = isHover || isSel || isEd || isLinkSrc;
        return (
          <div
            key={s.id}
            style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-50%)', zIndex: showPanel ? 8 : raised ? 7 : 4 }}
            onMouseEnter={() => setHovered(s.id)}
            onMouseLeave={() => setHovered((h) => (h === s.id ? null : h))}
          >
            {/* generous, easy-to-hit target */}
            <div
              onPointerDown={(e) => beginStarPress(e, s)}
              title={isTarget ? 'Tap to connect' : s.name || s.gist || 'star'}
              style={{ width: 44, height: 44, borderRadius: '50%', cursor: isTarget ? 'crosshair' : 'pointer', pointerEvents: 'auto' }}
            />

            {/* quick read-only name on hover (when its panel isn't already open) */}
            {isHover && !showPanel && (s.name || s.gist) && (
              <div
                style={{ position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap' }}
              >
                <span style={{ ...chipStyle, cursor: 'default', textTransform: 'none', letterSpacing: '0.02em', color: s.name ? '#FFEFD6' : 'rgba(255,239,214,0.6)', fontStyle: s.name ? 'normal' : 'italic' }}>
                  {s.name || s.gist}
                </span>
              </div>
            )}

            {/* pinned control panel — tap a star to open it, stays put so the
                buttons are actually clickable (no fragile hover to hold) */}
            {showPanel && (
              <div
                style={{ position: 'absolute', left: '50%', bottom: 28, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'auto', whiteSpace: 'nowrap' }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {isEd ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitStarName(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitStarName(s.id); }
                      else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setDraft(''); }
                    }}
                    placeholder="name this star"
                    style={{ ...inputStyle, fontSize: 12, width: 170 }}
                  />
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing({ kind: 'star', id: s.id }); setDraft(s.name); }}
                      title="Rename this star"
                      style={{ ...chipStyle, textTransform: 'none', letterSpacing: '0.02em', gap: 6, color: s.name ? '#FFEFD6' : 'rgba(255,239,214,0.6)', fontStyle: s.name ? 'normal' : 'italic' }}
                    >
                      {s.name || s.gist || 'name this star'} <span style={{ opacity: 0.7, fontStyle: 'normal' }}>✎</span>
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setLinkFrom(isLinkSrc ? null : s.id); }}
                        title={isLinkSrc ? 'Cancel connecting' : 'Connect a line to another star'}
                        style={{ ...pillBtn, ...(isLinkSrc ? pillBtnActive : null) }}
                      >
                        {isLinkSrc ? 'Pick a star…' : '🔗 Connect'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); goTo(s); }} title="Fly to this block on the canvas" style={pillBtn}>➤ Fly</button>
                      {hasLinks && (
                        <button
                          onClick={(e) => { e.stopPropagation(); links.filter((l) => l[0] === s.id || l[1] === s.id).forEach(([a, b]) => removeSkyLink(a, b)); }}
                          title="Remove every line from this star"
                          style={pillBtn}
                        >
                          ⤫ Unlink
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <AstronautCat active={residentEnabled} />

      {stars.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', color: 'rgba(255,239,214,0.5)', fontFamily: "'Outfit', sans-serif" }}>
            <div style={{ fontSize: 18, fontWeight: 300, marginBottom: 6 }}>An empty sky</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Add blocks to your canvas and they&apos;ll rise as stars here.</div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: 34, left: 40, pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.34em', textTransform: 'uppercase', color: 'rgba(242,169,80,0.85)', marginBottom: 6 }}>
          Constellation View
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, fontWeight: 300, letterSpacing: '-0.01em', color: '#F7EFE2', textShadow: '0 0 30px rgba(242,169,80,0.22)' }}>
          {workspaceTitle || 'Untitled'}
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(255,246,232,0.4)', marginTop: 6 }}>
          {stars.length} star{stars.length === 1 ? '' : 's'} · {components.length} constellation{components.length === 1 ? '' : 's'}
        </div>
      </div>

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setConstellationOpen(false)}
        style={{
          position: 'absolute', top: 34, right: 40, display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(242,169,80,0.35)',
          background: 'rgba(20,16,10,0.5)', color: '#FFEFD6', fontFamily: "'Outfit', sans-serif",
          fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', backdropFilter: 'blur(4px)',
        }}
        title="Return to the board (Esc)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
        </svg>
        Land
      </button>

      {/* connect-mode banner — clear, top-centre, so wiring is never a mystery */}
      {linkFrom && (
        <div style={{ position: 'absolute', top: 34, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderRadius: 999, background: 'rgba(24,40,54,0.8)', border: '1px solid rgba(120,210,255,0.5)', color: '#DBF1FF', fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, backdropFilter: 'blur(4px)', boxShadow: '0 0 24px rgba(120,210,255,0.25)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7AC8FF', boxShadow: '0 0 8px #7AC8FF' }} />
          Tap another star to connect · Esc to cancel
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(255,246,232,0.45)', letterSpacing: '0.02em', textAlign: 'center', whiteSpace: 'nowrap' }}>
        Tap a star to open it · drag to arrange · Connect to wire a line · Fly to jump to the block · Esc to leave
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- draw helper */

function drawGlowStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  const a = Math.max(0, Math.min(1, alpha));
  const glowR = r * 4.4;
  const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  g.addColorStop(0, `rgba(${CORE_RGB},${(0.9 * a).toFixed(3)})`);
  g.addColorStop(0.32, `rgba(${rgb},${(0.3 * a).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(${CORE_RGB},${a.toFixed(3)})`;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, r * 0.5), 0, Math.PI * 2); ctx.fill();
}

/* ------------------------------------------------------------------ styles */

const chipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
  background: 'rgba(20,16,10,0.55)', border: '1px solid rgba(242,169,80,0.22)', color: '#FFEFD6',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 12, textTransform: 'uppercase',
  backdropFilter: 'blur(3px)', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(16,12,6,0.92)', border: '1px solid rgba(242,169,80,0.6)', borderRadius: 8,
  color: '#FFEFD6', font: "600 13px 'Outfit', sans-serif", letterSpacing: '0.05em', textAlign: 'center',
  padding: '4px 10px', outline: 'none', width: 200, boxShadow: '0 0 22px rgba(242,169,80,0.25)',
};

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(242,169,80,0.3)',
  background: 'rgba(20,16,10,0.6)', color: '#FFEFD6', cursor: 'pointer',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap',
  backdropFilter: 'blur(3px)',
};

const pillBtnActive: React.CSSProperties = {
  border: '1px solid rgba(120,210,255,0.75)', background: 'rgba(24,40,54,0.75)', color: '#DBF1FF',
};
