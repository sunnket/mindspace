'use client';

/**
 * Constellation View — a real, dark night sky you compose yourself.
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
 * The sky is drawn on one canvas for depth and detail: a parallax, tiling star
 * field (thousands of points across three depths), a soft Milky Way band, faint
 * deep-blue nebulae, twinkle, diffraction spikes on the bright ones, and bloom.
 * Stars are white with only a faint temperature tint — never saturated.
 * Interaction lives in a thin DOM layer on top.
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
  skyFit,
  projSky,
  unprojSky,
  starRGB,
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

/* --------------------------------------------------------- backdrop model */

interface BgStar { x: number; y: number; a: number; size: number; depth: number; phase: number; rgb: string; tw: number }
interface Neb { x: number; y: number; r: number; rgb: string; phase: number }
interface Shoot { x: number; y: number; vx: number; vy: number; life: number; max: number }

function genBackdrop(w: number, h: number): { dust: BgStar[]; mid: BgStar[]; bright: BgStar[]; neb: Neb[] } {
  const area = w * h;
  const dust: BgStar[] = [];
  const nDust = Math.min(1300, Math.max(500, Math.floor(area / 1700)));
  for (let i = 0; i < nDust; i++) {
    dust.push({
      x: Math.random(), y: Math.random(),
      a: 0.12 + Math.random() * 0.4, size: 0.6 + Math.random() * 0.7,
      depth: 0.08 + (i % 3) * 0.06, phase: Math.random() * 6.28, rgb: starRGB(Math.random()), tw: 0.1 + Math.random() * 0.2,
    });
  }
  const mid: BgStar[] = [];
  for (let i = 0; i < 220; i++) {
    mid.push({
      x: Math.random(), y: Math.random(),
      a: 0.45 + Math.random() * 0.45, size: 0.9 + Math.random() * 1.1,
      depth: 0.34 + Math.random() * 0.08, phase: Math.random() * 6.28, rgb: starRGB(Math.random()), tw: 0.25 + Math.random() * 0.3,
    });
  }
  const bright: BgStar[] = [];
  for (let i = 0; i < 46; i++) {
    bright.push({
      x: Math.random(), y: Math.random(),
      a: 0.7 + Math.random() * 0.3, size: 1.5 + Math.random() * 1.6,
      depth: 0.5 + Math.random() * 0.12, phase: Math.random() * 6.28, rgb: starRGB(Math.random() * 0.9), tw: 0.35 + Math.random() * 0.4,
    });
  }
  const neb: Neb[] = [
    { x: 0.22, y: 0.28, r: 0.5, rgb: '60,84,150', phase: 0 },
    { x: 0.78, y: 0.66, r: 0.55, rgb: '78,58,120', phase: 2 },
    { x: 0.6, y: 0.2, r: 0.4, rgb: '40,86,110', phase: 4 },
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
  const components = useMemo(() => skyComponents(stars.map((s) => s.id), links, sky.names || {}), [stars, links, sky.names]);
  const starById = useMemo(() => new Map(stars.map((s) => [s.id, s])), [stars]);

  // Lazy init at mount — the sky only mounts when opened, so this fits the
  // stars once with no init effect.
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const [skyCam, setSkyCam] = useState<SkyCam>(() =>
    skyFit(stars, typeof window !== 'undefined' ? window.innerWidth : 1440, typeof window !== 'undefined' ? window.innerHeight : 900),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'star' | 'const'; id: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [dragStar, setDragStar] = useState<{ id: string; wx: number; wy: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp);
  const skyCamRef = useRef(skyCam);
  const starsRef = useRef<DataStar[]>(stars);
  const linksRef = useRef<[string, string][]>(links);
  const hoverRef = useRef<string | null>(null);
  const dragStarRef = useRef<{ id: string; wx: number; wy: number } | null>(null);
  const tempLinkRef = useRef<{ fromId: string; fromWX: number; fromWY: number; sx: number; sy: number } | null>(null);
  const bgRef = useRef<ReturnType<typeof genBackdrop> | null>(null);
  const shootRef = useRef<Shoot[]>([]);

  useEffect(() => { vpRef.current = vp; }, [vp]);
  useEffect(() => { skyCamRef.current = skyCam; }, [skyCam]);
  useEffect(() => { starsRef.current = stars; }, [stars]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { hoverRef.current = hovered; }, [hovered]);
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

      // 1) nebulae — faint deep-blue/violet clouds, additive
      ctx.globalCompositeOperation = 'lighter';
      for (const n of bg.neb) {
        const cx = wrapMod(n.x * w - cam.x * 0.03, w);
        const cy = wrapMod(n.y * h - cam.y * 0.03, h);
        const r = n.r * Math.min(w, h) * (0.95 + 0.05 * Math.sin(t * 0.15 + n.phase));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${n.rgb},0.10)`);
        g.addColorStop(0.5, `rgba(${n.rgb},0.035)`);
        g.addColorStop(1, `rgba(${n.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }

      // 2) Milky Way — a soft diagonal band of light
      ctx.save();
      ctx.translate(w * 0.5 - cam.x * 0.02, h * 0.44 - cam.y * 0.02);
      ctx.rotate(-0.52);
      const bandH = Math.max(w, h) * 0.42;
      const bg1 = ctx.createLinearGradient(0, -bandH / 2, 0, bandH / 2);
      bg1.addColorStop(0, 'rgba(70,92,150,0)');
      bg1.addColorStop(0.5, 'rgba(120,140,205,0.05)');
      bg1.addColorStop(1, 'rgba(70,92,150,0)');
      ctx.fillStyle = bg1;
      ctx.fillRect(-w, -bandH / 2, w * 2, bandH);
      const core = ctx.createLinearGradient(0, -bandH * 0.18, 0, bandH * 0.18);
      core.addColorStop(0, 'rgba(150,168,220,0)');
      core.addColorStop(0.5, 'rgba(180,195,235,0.045)');
      core.addColorStop(1, 'rgba(150,168,220,0)');
      ctx.fillStyle = core;
      ctx.fillRect(-w, -bandH * 0.18, w * 2, bandH * 0.36);
      ctx.restore();

      // 3) the tiling, parallax star field — three depths
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
        drawGlowStar(ctx, sx, sy, st.size * zk, st.rgb, st.a * tw, true, 0.5);
      }

      // 4) shooting star, occasionally
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
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, `rgba(255,255,255,${(0.85 * fade).toFixed(3)})`);
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
      }

      // 5) YOUR constellations — links first, then the data stars
      const dstars = starsRef.current;
      const drag = dragStarRef.current;
      const posLive = (s: DataStar) => (drag && drag.id === s.id ? { x: drag.wx, y: drag.wy } : { x: s.wx, y: s.wy });
      const P = (wx: number, wy: number) => projSky(cam, wx, wy, vpRef.current.w, vpRef.current.h);
      const byId = new Map(dstars.map((s) => [s.id, s]));
      const hov = hoverRef.current;

      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      for (const [a, b] of linksRef.current) {
        const sa = byId.get(a), sb = byId.get(b);
        if (!sa || !sb) continue;
        const pa = P(posLive(sa).x, posLive(sa).y);
        const pb = P(posLive(sb).x, posLive(sb).y);
        const on = hov === a || hov === b;
        ctx.strokeStyle = on ? 'rgba(150,185,230,0.55)' : 'rgba(120,150,195,0.3)';
        ctx.lineWidth = on ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }

      const tl = tempLinkRef.current;
      if (tl) {
        const pa = P(tl.fromWX, tl.fromWY);
        ctx.strokeStyle = 'rgba(170,200,240,0.6)';
        ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(tl.sx, tl.sy); ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const s of dstars) {
        const p = P(posLive(s).x, posLive(s).y);
        const on = hov === s.id;
        const tw = 0.72 + 0.28 * Math.sin(t * 1.4 + s.seed * 11);
        const rad = (s.r + 0.6) * (0.9 + 0.1 * tw) * (on ? 1.35 : 1);
        drawGlowStar(ctx, p.x, p.y, rad, s.name ? '255,255,255' : starRGB(s.seed), (on ? 1 : 0.7 + s.bright * 0.3) * tw, true, s.bright);
        if (on) {
          ctx.strokeStyle = 'rgba(190,215,255,0.85)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, rad * 2.6 + 4, 0, Math.PI * 2); ctx.stroke();
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
      if (!moved) setEditing(null);
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
      if (!moved) goTo(s);
      else if (dragStarRef.current) moveSkyStar(s.id, dragStarRef.current.wx, dragStarRef.current.wy);
      dragStarRef.current = null;
      setDragStar(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginLink = (e: React.PointerEvent, s: DataStar) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    tempLinkRef.current = { fromId: s.id, fromWX: s.wx, fromWY: s.wy, sx: e.clientX, sy: e.clientY };
    const onMove = (ev: PointerEvent) => {
      if (tempLinkRef.current) { tempLinkRef.current.sx = ev.clientX; tempLinkRef.current.sy = ev.clientY; }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const target = starsRef.current.find((o) => {
        if (o.id === s.id) return false;
        const p = projSky(skyCamRef.current, o.wx, o.wy, vpRef.current.w, vpRef.current.h);
        return Math.hypot(p.x - ev.clientX, p.y - ev.clientY) < 26;
      });
      if (target) {
        // toggle: dragging between two already-wired stars pulls the wire out
        const already = linksRef.current.some(
          (l) => (l[0] === s.id && l[1] === target.id) || (l[0] === target.id && l[1] === s.id),
        );
        if (already) removeSkyLink(s.id, target.id);
        else addSkyLink(s.id, target.id);
      }
      tempLinkRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
      if (editing) setEditing(null);
      else setConstellationOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, setConstellationOpen]);

  const commitStarName = (id: string) => { nameSkyStar(id, draft); setEditing(null); setDraft(''); };
  const commitConstName = (anchor: string) => { nameSkyConstellation(anchor, draft); setEditing(null); setDraft(''); };

  return createPortal(
    <div
      ref={rootRef}
      onPointerDown={beginPan}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, overflow: 'hidden', userSelect: 'none', cursor: 'grab',
        // deep, dark space — stays black whatever the board's paper colour is
        background: 'radial-gradient(150% 130% at 50% 22%, #0b1122 0%, #060814 42%, #01020a 100%)',
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
                style={{ ...chipStyle, color: c.name ? '#EAF1FF' : 'rgba(200,215,245,0.55)', letterSpacing: '0.16em', fontSize: 12 }}
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
        const isEd = editing?.kind === 'star' && editing.id === s.id;
        return (
          <div
            key={s.id}
            style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-50%)', zIndex: isHover || isEd ? 6 : 4 }}
            onMouseEnter={() => setHovered(s.id)}
            onMouseLeave={() => setHovered((h) => (h === s.id ? null : h))}
          >
            <div
              onPointerDown={(e) => beginStarPress(e, s)}
              title={s.name || s.gist || 'star'}
              style={{ width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', pointerEvents: 'auto' }}
            />

            {(isHover || isEd) && (
              <div
                style={{ position: 'absolute', left: '50%', bottom: 22, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', whiteSpace: 'nowrap' }}
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
                    style={{ ...inputStyle, fontSize: 12, width: 150 }}
                  />
                ) : (
                  <div style={{ ...chipStyle, cursor: 'default', gap: 6 }}>
                    <span style={{ color: s.name ? '#EAF1FF' : 'rgba(200,215,245,0.6)', fontStyle: s.name ? 'normal' : 'italic', fontWeight: s.name ? 700 : 500 }}>
                      {s.name || s.gist || 'unnamed'}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); setEditing({ kind: 'star', id: s.id }); setDraft(s.name); }} title="Name this star" style={miniBtn}>✎</button>
                    <button onClick={(e) => { e.stopPropagation(); goTo(s); }} title="Fly to this spot on the canvas" style={miniBtn}>➤</button>
                  </div>
                )}
              </div>
            )}

            {isHover && !isEd && (
              <div
                onPointerDown={(e) => beginLink(e, s)}
                title="Drag to another star to connect them"
                style={{
                  position: 'absolute', left: 20, top: -20, width: 14, height: 14, borderRadius: '50%',
                  border: '1.5px solid rgba(170,200,240,0.9)', background: 'rgba(30,44,80,0.6)', cursor: 'crosshair', pointerEvents: 'auto',
                }}
              />
            )}
          </div>
        );
      })}

      <AstronautCat active={residentEnabled} />

      {stars.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', color: 'rgba(220,230,255,0.5)', fontFamily: "'Outfit', sans-serif" }}>
            <div style={{ fontSize: 18, fontWeight: 300, marginBottom: 6 }}>An empty sky</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Add blocks to your canvas and they&apos;ll rise as stars here.</div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: 34, left: 40, pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.34em', textTransform: 'uppercase', color: 'rgba(150,180,230,0.8)', marginBottom: 6 }}>
          Constellation View
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, fontWeight: 300, letterSpacing: '-0.01em', color: '#EEF3FF' }}>
          {workspaceTitle || 'Untitled'}
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(210,224,255,0.4)', marginTop: 6 }}>
          {stars.length} star{stars.length === 1 ? '' : 's'} · {components.length} constellation{components.length === 1 ? '' : 's'}
        </div>
      </div>

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setConstellationOpen(false)}
        style={{
          position: 'absolute', top: 34, right: 40, display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(150,180,230,0.3)',
          background: 'rgba(12,18,34,0.55)', color: '#EAF1FF', fontFamily: "'Outfit', sans-serif",
          fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', backdropFilter: 'blur(4px)',
        }}
        title="Return to the board (Esc)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
        </svg>
        Land
      </button>

      <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(210,224,255,0.45)', letterSpacing: '0.02em', textAlign: 'center', whiteSpace: 'nowrap' }}>
        Tap a star to fly to it · drag to arrange · drag the ring to connect · scroll to zoom · Esc to leave
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- draw helper */

function drawGlowStar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, rgb: string, alpha: number, spike: boolean, bright: number,
) {
  const a = Math.max(0, Math.min(1, alpha));
  const glowR = r * 5;
  const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  g.addColorStop(0, `rgba(${rgb},${(0.9 * a).toFixed(3)})`);
  g.addColorStop(0.25, `rgba(${rgb},${(0.28 * a).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();

  if (spike && bright > 0.45) {
    const len = r * (5 + bright * 6);
    const sg = ctx.createLinearGradient(x - len, y, x + len, y);
    sg.addColorStop(0, `rgba(${rgb},0)`);
    sg.addColorStop(0.5, `rgba(${rgb},${(0.5 * a).toFixed(3)})`);
    sg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.strokeStyle = sg; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - len, y); ctx.lineTo(x + len, y); ctx.stroke();
    const sv = ctx.createLinearGradient(x, y - len, x, y + len);
    sv.addColorStop(0, `rgba(${rgb},0)`);
    sv.addColorStop(0.5, `rgba(${rgb},${(0.5 * a).toFixed(3)})`);
    sv.addColorStop(1, `rgba(${rgb},0)`);
    ctx.strokeStyle = sv;
    ctx.beginPath(); ctx.moveTo(x, y - len); ctx.lineTo(x, y + len); ctx.stroke();
  }

  ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, r * 0.5), 0, Math.PI * 2); ctx.fill();
}

/* ------------------------------------------------------------------ styles */

const chipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
  background: 'rgba(10,16,32,0.55)', border: '1px solid rgba(150,180,230,0.22)', color: '#EAF1FF',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 12, textTransform: 'uppercase',
  backdropFilter: 'blur(3px)', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(8,12,26,0.92)', border: '1px solid rgba(150,180,230,0.6)', borderRadius: 8,
  color: '#EAF1FF', font: "600 13px 'Outfit', sans-serif", letterSpacing: '0.05em', textAlign: 'center',
  padding: '4px 10px', outline: 'none', width: 200, boxShadow: '0 0 22px rgba(120,160,230,0.25)',
};

const miniBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18,
  border: 'none', background: 'transparent', color: 'rgba(200,220,255,0.7)', cursor: 'pointer',
  fontSize: 11, padding: 0, borderRadius: 4,
};
