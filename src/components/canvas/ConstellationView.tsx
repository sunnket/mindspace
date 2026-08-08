'use client';

/**
 * Constellation View — a night sky you compose yourself.
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
 * THE LOOK IS REAL SPACE, and that is a deliberate reversal — this was a warm
 * amber "galaxy" until the user asked for space that actually reads as space.
 * What the reversal is really made of is four fixes, none of them a palette:
 *
 *   1. The field does not repeat. It used to be a fixed list of stars drawn at
 *      `wrapMod(x - cam.x, w)`, which tiles across the viewport — pan far enough
 *      and the same stars come back around. It is now generated per tile from
 *      the tile's own coordinates (lib/skyField.ts), so it is infinite, never
 *      repeats, and is the SAME sky every time you open the board.
 *   2. Brightness follows a steep power law and colour follows the main
 *      sequence as the naked eye sees it, so the field is mostly faint and
 *      mostly white-blue instead of an even wash of identical dots.
 *   3. Scintillation bites the faint stars hardest, the way atmosphere does.
 *      Twinkling everything by the same amount is what made it read as tinsel.
 *   4. There are OBJECTS in it — a Milky Way band with a dust lane down its
 *      spine, filament nebulae, and planets parked at depth — so the sky is a
 *      place with things in it rather than a texture.
 *
 * Your own stars stay the brightest objects in it and are the only ones drawn
 * with a full diffraction cross, so "which one is mine" is answered by
 * brightness and shape rather than by giving them a colour nothing else has.
 *
 * Interaction lives in a thin DOM layer over one canvas.
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
import {
  FIELD_LAYERS,
  visitFieldStars,
  buildNebulae,
  placeBodies,
  skySeed,
  type NebulaCloud,
  type PlacedBody,
} from '@/lib/skyField';
import { DEEP_BODIES } from '@/lib/deepBodies';

export default function ConstellationView() {
  const open = useCanvasStore((s) => s.constellationOpen);
  if (!open || typeof document === 'undefined') return null;
  return <ConstellationSky />;
}

/* Real starlight. Your blocks are the brightest objects in the sky and burn
   pure white with a cool bloom; nothing in the backdrop is allowed to be
   brighter than they are. The amber the sky used to be lives on only in the
   Stress Reliefer — here it read as firelight, which is the one thing space
   does not have. */
const CORE_RGB = '255,255,255';  // star core — white-hot at any temperature
const GLOW_RGB = '142,188,255';  // cool bloom + constellation lines
const LINK_RGB = '120,210,255';  // connect mode

interface Shoot { x: number; y: number; vx: number; vy: number; life: number; max: number }

/**
 * Pre-render each nebula to its own small offscreen canvas.
 *
 * A cloud is fourteen-plus overlapping squashed lobes; drawing that many radial
 * gradients every frame is the most expensive thing on the canvas, and none of
 * it ever changes — the cloud only ever translates. So it is baked once. The
 * buffer is deliberately a third of final size: nebulae are pure soft gradient,
 * so upscaling it costs nothing visually and saves 9x the memory.
 */
const NEB_SCALE = 3;

function bakeNebula(cloud: NebulaCloud): { cv: HTMLCanvasElement; r: number } {
  let r = 0;
  for (const f of cloud.filaments) r = Math.max(r, Math.hypot(f.x, f.y) + f.r);
  r = Math.ceil(r * 1.05);
  const px = Math.max(64, Math.ceil((r * 2) / NEB_SCALE));
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const c = cv.getContext('2d');
  if (!c) return { cv, r };
  c.scale(px / (r * 2), px / (r * 2));
  c.translate(r, r);
  c.globalCompositeOperation = 'lighter';
  for (const f of cloud.filaments) {
    c.save();
    c.translate(f.x, f.y);
    c.rotate(f.rot);
    c.scale(1, f.squash);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, f.r);
    g.addColorStop(0, `rgba(${f.rgb},${f.a.toFixed(4)})`);
    g.addColorStop(0.45, `rgba(${f.rgb},${(f.a * 0.42).toFixed(4)})`);
    g.addColorStop(1, `rgba(${f.rgb},0)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, f.r, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  return { cv, r };
}

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
  const shootRef = useRef<Shoot[]>([]);
  const nebRef = useRef<{ cloud: NebulaCloud; cv: HTMLCanvasElement; r: number }[] | null>(null);
  const bodiesRef = useRef<PlacedBody[] | null>(null);
  const bodyImgRef = useRef<HTMLImageElement[]>([]);
  const reduceRef = useRef(false);

  /* The sky is seeded from the board it belongs to, not from Math.random(), so
     that closing and reopening returns you to the SAME sky — same nebulae, same
     planets, same stars in the same places. A sky that reshuffles every time you
     look at it is not a place. */
  const seed = useMemo(() => skySeed(`${urlCanvasId || 'root'}::${parentId || 'top'}`), [urlCanvasId, parentId]);

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
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* Bake the sky's fixed furniture once per board: the nebula buffers and where
     the planets sit. Both are pure functions of the seed. */
  useEffect(() => {
    nebRef.current = buildNebulae(seed).map((cloud) => ({ cloud, ...bakeNebula(cloud) }));
    bodiesRef.current = placeBodies(seed, 13, DEEP_BODIES.length);
    bodyImgRef.current = DEEP_BODIES.map((b) => {
      const img = new Image();
      img.src = b.src;
      return img;
    });
  }, [seed]);

  /* Drift and scintillation are continuous motion over the whole viewport —
     exactly what reduced-motion is asking us to stop. The sky itself stays;
     it simply holds still. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reduceRef.current = mq.matches; };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
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
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cam = skyCamRef.current;
      const still = reduceRef.current;
      const t = still ? 0 : now / 1000;

      /* How far each layer has slid, in screen px. Unbounded on purpose: the
         field's tile identity comes from this number, so panning always uncovers
         new sky instead of re-entering sky you have already seen. Zoom feeds the
         RATE rather than the pattern's scale — a star is a point source, and a
         point source does not get bigger because you leaned in. */
      const offOf = (pk: number) => ({
        x: cam.x * cam.zoom * pk + t * pk * 2.2 - w / 2,
        y: cam.y * cam.zoom * pk - h / 2,
      });
      const farOff = offOf(FIELD_LAYERS[0].parallax);

      // 1) nebulae — baked filament clouds, riding the far layer
      ctx.globalCompositeOperation = 'lighter';
      for (const n of nebRef.current || []) {
        const cx = n.cloud.u - farOff.x;
        const cy = n.cloud.v - farOff.y;
        if (cx + n.r < 0 || cx - n.r > w || cy + n.r < 0 || cy - n.r > h) continue;
        ctx.drawImage(n.cv, cx - n.r, cy - n.r, n.r * 2, n.r * 2);
      }

      // 2) planets and moons, parked in the deep field
      ctx.globalCompositeOperation = 'source-over';
      for (const b of bodiesRef.current || []) {
        const img = bodyImgRef.current[b.idx];
        const meta = DEEP_BODIES[b.idx];
        if (!img || !img.complete || !img.naturalWidth || !meta) continue;
        const bx = b.u + b.driftX * t - farOff.x;
        const by = b.v + b.driftY * t - farOff.y;
        const long = Math.max(meta.w, meta.h);
        const bw = b.size * (meta.w / long);
        const bh = b.size * (meta.h / long);
        if (bx + bw < 0 || bx - bw > w || by + bh < 0 || by - bh > h) continue;
        ctx.save();
        ctx.globalAlpha = b.alpha;
        /* Distance desaturates. Icons8 draws a planet at full poster saturation,
           which is right for an icon and wrong for a body a long way off — a
           vivid blue-green Earth in the deep field reads as a sticker pasted on
           the sky. Dropping the saturation is what puts it BEHIND the stars.
           Cheap here because only two or three are ever on screen. */
        ctx.filter = 'saturate(0.62) brightness(0.9)';
        ctx.translate(bx, by);
        ctx.rotate((b.spin * t) / 60);
        ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
        ctx.restore();
      }

      // 3) the star field — three depths, procedural, non-repeating
      ctx.globalCompositeOperation = 'lighter';
      const spikes: { x: number; y: number; r: number; rgb: string; a: number }[] = [];
      for (const layer of FIELD_LAYERS) {
        const off = offOf(layer.parallax);
        visitFieldStars(layer, off.x, off.y, w, h, (s) => {
          /* Scintillation is atmosphere, and it bites the FAINT stars hardest —
             a bright star barely wavers. Twinkling everything equally by the
             same amount is the third fake-sky tell after tiling and flat
             brightness. */
          const tw = still ? 1 : 1 - (1 - s.mag) * 0.42 * (0.5 + 0.5 * Math.sin(t * (1.1 + s.mag * 2.4) + s.phase));
          const a = s.alpha * tw;
          if (a < 0.02) return;
          if (s.mag > 0.88) {
            spikes.push({ x: s.x, y: s.y, r: s.size, rgb: s.rgb, a });
            return;
          }
          ctx.fillStyle = `rgba(${s.rgb},${a.toFixed(3)})`;
          ctx.fillRect(s.x, s.y, s.size, s.size);
        });
      }
      // The brightest few get a bloom and a diffraction cross — the mark every
      // real photograph of a bright star carries.
      for (const s of spikes) {
        drawGlowStar(ctx, s.x, s.y, s.r * 1.15, s.rgb, s.a);
        drawSpikes(ctx, s.x, s.y, s.r * 9, s.rgb, s.a * 0.5);
      }

      // 4) shooting star, occasionally
      if (!still && now > lastShoot && shootRef.current.length < 2) {
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

      // 5) YOUR constellations — links first, then your stars
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
        ctx.strokeStyle = `rgba(${LINK_RGB},0.75)`;
        ctx.lineWidth = 1.3; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(tl.sx, tl.sy); ctx.stroke();
        ctx.setLineDash([]);
      }

      const sel = selectedRef.current;
      const lf = linkFromRef.current;
      ctx.globalCompositeOperation = 'lighter';
      for (const s of dstars) {
        const p = P(posLive(s).x, posLive(s).y);
        if (p.x < -80 || p.x > w + 80 || p.y < -80 || p.y > h + 80) continue;
        const active = hov === s.id || sel === s.id || lf === s.id;
        const tw = still ? 1 : 0.82 + 0.18 * Math.sin(t * 1.4 + s.seed * 11);

        /* `bright` only spans 0.4..1 — a heading against a small note — and
           drawing that range linearly gave fifty near-identical stars laid out
           in the grid the blocks happen to sit in, which reads as a UI, not a
           sky. Magnitude is a LOG scale: a modest difference in importance has
           to become a large difference in apparent brightness. Gamma 2.6 turns
           that 2.5x span into a 13x one, so a heading blazes with a long cross
           and a small note is a quiet point. */
        const mag = Math.pow(active ? 1 : s.bright, 2.6);
        const rad = (1.2 + mag * 3.6) * (0.9 + 0.1 * tw) * (active ? 1.35 : 1);
        const amp = (0.42 + mag * 0.58) * tw;
        // Only the genuinely bright ones earn a cross; on a faint star it would
        // be a decoration rather than an optical effect.
        if (mag > 0.16) drawSpikes(ctx, p.x, p.y, rad * (7 + mag * 7), GLOW_RGB, amp * 0.38);
        drawGlowStar(ctx, p.x, p.y, rad, GLOW_RGB, amp);
        if (active) {
          ctx.globalCompositeOperation = 'source-over';
          const ringOn = sel === s.id || lf === s.id;
          ctx.strokeStyle = lf === s.id ? `rgba(${LINK_RGB},0.95)` : ringOn ? 'rgba(200,224,255,0.95)' : 'rgba(200,224,255,0.7)';
          ctx.lineWidth = ringOn ? 1.6 : 1.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, rad * 2.6 + 5, 0, Math.PI * 2); ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
        }
      }

      /* 6) vignette. Every real photograph of the sky has one — a lens simply
         gathers less light at the edge of its field — so it earns its place on
         realism alone. It also does a job: the chrome lives in the corners, and
         a planet drifting under the Land button used to fight it for contrast.
         The corners are now always the darkest part of the frame. */
      ctx.globalCompositeOperation = 'source-over';
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.78);
      // Kept deliberately gentle: it falls on YOUR stars too, and a star parked
      // in a corner still has to be findable.
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(0.68, 'rgba(0,2,8,0.22)');
      vig.addColorStop(1, 'rgba(0,1,5,0.56)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
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
        background: 'radial-gradient(135% 105% at 50% 6%, #0a1022 0%, #050810 38%, #010206 100%)',
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
                style={{ ...chipStyle, color: c.name ? TEXT : 'rgba(228,236,255,0.55)', letterSpacing: '0.16em', fontSize: 12 }}
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
                <span style={{ ...chipStyle, cursor: 'default', textTransform: 'none', letterSpacing: '0.02em', color: s.name ? TEXT : TEXT_DIM, fontStyle: s.name ? 'normal' : 'italic' }}>
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
                      style={{ ...chipStyle, textTransform: 'none', letterSpacing: '0.02em', gap: 6, color: s.name ? TEXT : TEXT_DIM, fontStyle: s.name ? 'normal' : 'italic' }}
                    >
                      {s.name || s.gist || 'name this star'}
                      <SkyIcon d={ICON_PEN} />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setLinkFrom(isLinkSrc ? null : s.id); }}
                        title={isLinkSrc ? 'Cancel connecting' : 'Connect a line to another star'}
                        style={{ ...pillBtn, ...(isLinkSrc ? pillBtnActive : null) }}
                      >
                        <SkyIcon d={ICON_LINK} />
                        {isLinkSrc ? 'Pick a star…' : 'Connect'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); goTo(s); }} title="Fly to this block on the canvas" style={pillBtn}>
                        <SkyIcon d={ICON_FLY} />
                        Fly
                      </button>
                      {hasLinks && (
                        <button
                          onClick={(e) => { e.stopPropagation(); links.filter((l) => l[0] === s.id || l[1] === s.id).forEach(([a, b]) => removeSkyLink(a, b)); }}
                          title="Remove every line from this star"
                          style={pillBtn}
                        >
                          <SkyIcon d={ICON_UNLINK} />
                          Unlink
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

      {stars.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', color: 'rgba(228,236,255,0.52)', fontFamily: "'Outfit', sans-serif" }}>
            <div style={{ fontSize: 18, fontWeight: 300, marginBottom: 6 }}>An empty sky</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Add blocks to your canvas and they&apos;ll rise as stars here.</div>
          </div>
        </div>
      )}

      {/* A scrim under the header. The deep field now has PLANETS drifting
          through it, and a body passing behind the board's title was fighting it
          for contrast — the sky is allowed to be busy, but the chrome has to
          hold a contrast floor whatever happens to be behind it. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: 0, left: 0, width: 620, height: 250, pointerEvents: 'none',
          background: 'radial-gradient(120% 130% at 6% 18%, rgba(1,3,9,0.82) 0%, rgba(1,3,9,0.45) 42%, rgba(1,3,9,0) 74%)',
        }}
      />

      <div style={{ position: 'absolute', top: 34, left: 40, pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.34em', textTransform: 'uppercase', color: 'rgba(142,188,255,0.85)', marginBottom: 6 }}>
          Constellation View
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, fontWeight: 300, letterSpacing: '-0.01em', color: '#F2F6FF', textShadow: '0 0 34px rgba(142,188,255,0.28)' }}>
          {workspaceTitle || 'Untitled'}
        </div>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(228,236,255,0.42)', marginTop: 6 }}>
          {stars.length} star{stars.length === 1 ? '' : 's'} · {components.length} constellation{components.length === 1 ? '' : 's'}
        </div>
      </div>

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setConstellationOpen(false)}
        style={{
          position: 'absolute', top: 34, right: 40, display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 999, border: `1px solid ${EDGE}`,
          background: SURFACE, color: TEXT, fontFamily: "'Outfit', sans-serif",
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

      <div
        aria-hidden
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 110, pointerEvents: 'none',
          background: 'linear-gradient(to top, rgba(1,3,9,0.78) 0%, rgba(1,3,9,0.30) 46%, rgba(1,3,9,0) 100%)',
        }}
      />

      <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(228,236,255,0.58)', letterSpacing: '0.02em', textAlign: 'center', whiteSpace: 'nowrap' }}>
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

/**
 * The four-point diffraction cross a bright star wears in every real photograph
 * of the sky — light bending around the spider vanes that hold a telescope's
 * secondary mirror.
 *
 * Drawn as two solid slivers rather than gradient strokes. Four linear
 * gradients per star would be the obvious way and is far too expensive at this
 * count; a thin diamond filled flat in `lighter` mode is visually identical
 * once it is this narrow, because the additive blend does the falloff.
 */
function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, rgb: string, alpha: number) {
  const a = Math.max(0, Math.min(1, alpha));
  if (a < 0.015 || len < 3) return;
  const wid = Math.max(0.5, len * 0.035);
  ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(x - len, y); ctx.lineTo(x, y - wid); ctx.lineTo(x + len, y); ctx.lineTo(x, y + wid);
  ctx.closePath(); ctx.fill();
  const vlen = len * 0.72; // the vertical vane reads slightly shorter
  ctx.beginPath();
  ctx.moveTo(x, y - vlen); ctx.lineTo(x + wid, y); ctx.lineTo(x, y + vlen); ctx.lineTo(x - wid, y);
  ctx.closePath(); ctx.fill();
}

/* ------------------------------------------------------------------ icons */

/* Line icons, not emoji. An emoji is a font glyph: it renders differently on
   every platform, ignores currentColor, and cannot be tuned against a dark
   surface — all three of which show badly on chrome sitting over a black sky. */
const ICON_PEN = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z';
const ICON_LINK = 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7';
const ICON_FLY = 'M22 2 11 13M22 2l-7 20-4-9-9-4Z';
const ICON_UNLINK = 'm18.8 12.2 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 11.8 3.5 13.5a5 5 0 0 0 7 7l1.7-1.7M3 3l18 18';

function SkyIcon({ d, size = 12 }: { d: string; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.85 }}
    >
      <path d={d} />
    </svg>
  );
}

/* ------------------------------------------------------------------ styles */

/* Cool chrome for a cool sky. Surfaces are near-black with a blue cast rather
   than the warm browns this had, so nothing on top of the field reads as
   firelight. */
const TEXT = '#E4ECFF';
const TEXT_DIM = 'rgba(228,236,255,0.6)';
const EDGE = 'rgba(142,188,255,0.26)';
const SURFACE = 'rgba(8,12,22,0.62)';

const chipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
  background: SURFACE, border: `1px solid ${EDGE}`, color: TEXT,
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 12, textTransform: 'uppercase',
  backdropFilter: 'blur(3px)', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(6,9,18,0.94)', border: '1px solid rgba(142,188,255,0.6)', borderRadius: 8,
  color: TEXT, font: "600 13px 'Outfit', sans-serif", letterSpacing: '0.05em', textAlign: 'center',
  padding: '4px 10px', outline: 'none', width: 200, boxShadow: '0 0 22px rgba(142,188,255,0.22)',
};

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '5px 11px', borderRadius: 999, border: `1px solid ${EDGE}`,
  background: SURFACE, color: TEXT, cursor: 'pointer',
  fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap',
  backdropFilter: 'blur(3px)',
};

const pillBtnActive: React.CSSProperties = {
  border: '1px solid rgba(120,210,255,0.75)', background: 'rgba(20,38,56,0.8)', color: '#DBF1FF',
};
