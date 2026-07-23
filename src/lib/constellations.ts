import type { CanvasObjectData, SkyState } from './db';
import { gistOf, isSemanticCandidate, effectiveFontSize } from './semanticZoom';

/**
 * The Constellation View's sky — a real, dark, user-composed star map.
 *
 * Every block on the canvas is a star. The stars are yours to arrange: drag
 * them anywhere, wire them together into your own constellations, name the
 * constellations and the individual stars. Nothing is auto-grouped and nothing
 * is auto-named — the sky only holds the shapes you draw in it. A star always
 * remembers the real spot on the canvas it stands for, so tapping one flies you
 * straight back down to that block.
 *
 * This module is pure geometry + data. The look (the actual night sky) and the
 * interactions live in ConstellationView. Persistence lives in `SkyState`
 * (db.ts): star position/name overrides, the links you drew, and constellation
 * names keyed by a component anchor.
 */

/* ------------------------------------------------------------------ stars */

export interface DataStar {
  id: string;
  /** where the star sits in the sky (your arrangement, or the block's spot) */
  wx: number;
  wy: number;
  /** the real block rectangle on the canvas — where "go to this star" lands */
  goX: number;
  goY: number;
  goW: number;
  goH: number;
  /** the name you gave it ('' if none) */
  name: string;
  /** a quiet fallback shown on hover when you haven't named it */
  gist: string;
  /** base radius in screen px at zoom 1 */
  r: number;
  /** stable per-star randomness (twinkle phase, colour, spikes) */
  seed: number;
  /** brightness 0..1 — headings and big blocks burn brighter */
  bright: number;
}

/** Blocks that become stars — frames/arrows/ink are structure, not thoughts. */
function isStarObject(o: CanvasObjectData): boolean {
  if (o.style?.isMinimized) return false;
  if (o.type === 'frame' || o.type === 'arrow' || o.type === 'drawing') return false;
  return true;
}

function centre(o: CanvasObjectData) {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

export function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function starIdSet(objects: CanvasObjectData[]): Set<string> {
  return new Set(objects.filter(isStarObject).map((o) => o.id));
}

/**
 * The stars for a canvas level. Position is your override if you moved it, else
 * the block's own spot; name is your override, else empty (the gist is only a
 * hover hint). `go*` is always the block's true rectangle.
 */
export function buildStars(objects: CanvasObjectData[], sky: SkyState): DataStar[] {
  const overrides = sky.stars || {};
  return objects.filter(isStarObject).map((o) => {
    const c = centre(o);
    const ov = overrides[o.id];
    const seed = hashSeed(o.id);
    const area = Math.max(1, o.width * o.height);
    const fs = effectiveFontSize(o);
    const bright =
      o.type === 'heading' ? 1 : Math.max(0.4, Math.min(0.95, 0.45 + fs / 90 + Math.sqrt(area) / 5000));
    return {
      id: o.id,
      wx: typeof ov?.x === 'number' ? ov.x : c.x,
      wy: typeof ov?.y === 'number' ? ov.y : c.y,
      goX: o.x, goY: o.y, goW: o.width, goH: o.height,
      name: (ov?.name || '').trim(),
      gist: isSemanticCandidate(o) ? gistOf(o, 30).text : '',
      r: 1.3 + bright * 2.0,
      seed,
      bright,
    };
  });
}

/* ------------------------------------------------------- constellations */

export interface SkyComponent {
  anchor: string;     // stable id for naming: the smallest member id
  ids: string[];
  name: string;       // your name for it ('' if none)
}

/**
 * Connected components of the link graph, size ≥ 2 — a constellation is simply
 * a group of stars you wired together. Naming is keyed by the component's
 * anchor (its smallest member id), which stays stable as long as that star is
 * in the group.
 */
export function skyComponents(
  starIds: string[],
  links: [string, string][],
  names: Record<string, string> = {},
): SkyComponent[] {
  const idset = new Set(starIds);
  const adj = new Map<string, Set<string>>();
  for (const id of starIds) adj.set(id, new Set());
  for (const [a, b] of links) {
    if (a === b) continue;
    if (idset.has(a) && idset.has(b)) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const seen = new Set<string>();
  const out: SkyComponent[] = [];
  for (const id of starIds) {
    if (seen.has(id)) continue;
    const stack = [id];
    seen.add(id);
    const comp: string[] = [id];
    while (stack.length) {
      const x = stack.pop()!;
      for (const n of adj.get(x)!) {
        if (!seen.has(n)) { seen.add(n); comp.push(n); stack.push(n); }
      }
    }
    if (comp.length >= 2) {
      const anchor = comp.slice().sort()[0];
      out.push({ anchor, ids: comp, name: (names[anchor] || '').trim() });
    }
  }
  return out;
}

/** Only the links whose endpoints both still exist (a block was deleted, etc). */
export function validLinks(links: [string, string][], ids: Set<string>): [string, string][] {
  return links.filter(([a, b]) => a !== b && ids.has(a) && ids.has(b));
}

export function sameLink(l: [string, string], a: string, b: string): boolean {
  return (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a);
}

/* ------------------------------------------------------------- sky camera */

export interface SkyCam { x: number; y: number; zoom: number } // x,y = world centre

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export const SKY_MIN_ZOOM = 0.05;
export const SKY_MAX_ZOOM = 6;

/** A camera that frames every star, centred, with breathing room. */
export function skyFit(stars: DataStar[], vw: number, vh: number, pad = 0.16): SkyCam {
  if (stars.length === 0) return { x: 0, y: 0, zoom: 0.5 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of stars) {
    minX = Math.min(minX, s.wx); maxX = Math.max(maxX, s.wx);
    minY = Math.min(minY, s.wy); maxY = Math.max(maxY, s.wy);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const zoom = clampNum(Math.min((vw * (1 - pad * 2)) / bw, (vh * (1 - pad * 2)) / bh), SKY_MIN_ZOOM, 1.1);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: stars.length === 1 ? 0.8 : zoom };
}

export function projSky(cam: SkyCam, wx: number, wy: number, vw: number, vh: number) {
  return { x: (wx - cam.x) * cam.zoom + vw / 2, y: (wy - cam.y) * cam.zoom + vh / 2 };
}

export function unprojSky(cam: SkyCam, sx: number, sy: number, vw: number, vh: number) {
  return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
}

/* --------------------------------------------------------- star colours */

/**
 * Real stars are mostly white with a faint temperature tint — blue-white for
 * the hot ones, warm white to amber for the cool ones. Never saturated. This
 * returns an `r,g,b` string keyed off the star's stable seed.
 */
export function starRGB(seed: number): string {
  if (seed < 0.60) return '255,255,255';   // white — most stars
  if (seed < 0.80) return '205,224,255';   // blue-white
  if (seed < 0.93) return '255,247,228';   // warm white
  return '255,216,182';                    // faint amber
}
