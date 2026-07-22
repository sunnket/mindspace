import type { CanvasObjectData } from './db';
import { effectiveFontSize, gistOf, isSemanticCandidate } from './semanticZoom';
import { frameTitle, getFrameKind, centreInRect, frameRect } from './frames';

/**
 * Constellation View — semantic zoom taken to its logical extreme.
 *
 * Semantic zoom already trades unreadable text for a gist as you pull the
 * camera back. Keep pulling and even the gists become dust: at that point the
 * board stops being a document and becomes a *place*. This module is the map of
 * that place — every block is a star, and blocks that live near each other form
 * a named constellation you can fly back down into.
 *
 * Three ideas hold it together:
 *
 *   1. THE WHOLE BOARD IS THE SKY. Every real block becomes a star at its true
 *      position, so the galaxy is a faithful, clickable map of the canvas — not
 *      decoration. Nothing is invented and nothing is dropped.
 *
 *   2. PROXIMITY IS MEANING. People cluster related thoughts in space without
 *      being told to. Single-linkage clustering on that spatial habit recovers
 *      the groups for free — no tags, no folders.
 *
 *   3. A CLUSTER ALREADY KNOWS ITS NAME. The frame you drew around it, or the
 *      heading you gave it, IS the name of the constellation. We only fall back
 *      to a derived gist when you never named it — and you can always rename.
 */

/* --------------------------------------------------------------- zoom bands */

/** Above this zoom the sky hasn't begun to bloom — the board is fully itself. */
export const GALAXY_FADE_START = 0.26;
/** At/below this zoom the night sky is fully drawn and the board is gone. */
export const GALAXY_FADE_FULL = 0.15;
/** Where the "enter" affordance drops the camera — comfortably into the sky. */
export const GALAXY_ENTER_ZOOM = 0.12;
/** Leaving the sky lands you here at most, so exit never re-triggers the sky. */
export const GALAXY_EXIT_ZOOM = 0.62;

/**
 * How fully the night sky is drawn at a given zoom: 0 = board, 1 = full galaxy.
 * The dissolve between the two is the signature morph.
 */
export function galaxyProgress(zoom: number): number {
  if (zoom >= GALAXY_FADE_START) return 0;
  if (zoom <= GALAXY_FADE_FULL) return 1;
  return (GALAXY_FADE_START - zoom) / (GALAXY_FADE_START - GALAXY_FADE_FULL);
}

/* ------------------------------------------------------------------ types */

export interface Star {
  id: string;
  /** world-space centre of the block this star stands for */
  wx: number;
  wy: number;
  /** star radius in screen px at scale 1 (scaled by brightness/footprint) */
  r: number;
  /** 0..1 — headings and framed regions burn brighter than a stray note */
  bright: number;
  /** stable per-star phase so twinkle never reshuffles frame to frame */
  seed: number;
  /** the constellation this star belongs to, if any */
  clusterId?: string;
}

export interface Constellation {
  /** stable identity: the id of the naming block (frame / heading / anchor) */
  id: string;
  anchorId: string;
  /** the name as derived from the board (before any user override) */
  autoName: string;
  /** what to actually show — the override if set, else the auto name */
  name: string;
  /** true when the user has renamed it away from the derived name */
  custom: boolean;
  starIds: string[];
  count: number;
  /** world centroid of the member stars, for the label anchor */
  cx: number;
  cy: number;
  /** world bounds of the member blocks, for the fly-in camera */
  bounds: Bounds;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Galaxy {
  stars: Star[];
  constellations: Constellation[];
  bounds: Bounds | null;
}

/* ------------------------------------------------------------- what's a star */

/**
 * Blocks that become stars. Frames and arrows/drawings are the *connective
 * tissue* of a board, not thoughts in their own right — a frame names a
 * constellation, an arrow is a line between stars — so neither is a star.
 */
function isStarObject(o: CanvasObjectData): boolean {
  if (o.style?.isMinimized) return false;
  if (o.type === 'frame' || o.type === 'arrow' || o.type === 'drawing') return false;
  return true;
}

function centre(o: CanvasObjectData) {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/* ------------------------------------------------------------- union-find */

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}
function union(parent: number[], a: number, b: number) {
  parent[find(parent, a)] = find(parent, b);
}

/**
 * The linking distance for single-linkage clustering, adapted to the board.
 *
 * A fixed threshold groups a dense mood-board into one blob and leaves a sparse
 * outline as all singletons. Deriving it from the median nearest-neighbour gap
 * makes "near" mean near *for this board* — the same gesture on any density.
 */
function linkDistance(centres: { x: number; y: number }[]): number {
  const n = centres.length;
  if (n < 2) return 260;
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const median = nn[Math.floor(nn.length / 2)] || 260;
  return Math.max(170, Math.min(640, median * 1.8));
}

/* ------------------------------------------------------------------ naming */

function boundsOf(objs: CanvasObjectData[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    if (o.x < minX) minX = o.x;
    if (o.y < minY) minY = o.y;
    if (o.x + o.width > maxX) maxX = o.x + o.width;
    if (o.y + o.height > maxY) maxY = o.y + o.height;
  }
  return { minX, minY, maxX, maxY };
}

/** Strip a single leading markdown heading marker and collapse whitespace. */
function cleanTitle(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The name a cluster carries, and the block that owns that name.
 *
 * Priority is the order of intent: a frame you drew around the group is the
 * loudest signal, then a heading inside it, then — only if you never labelled
 * it — the gist of its weightiest note. An image-only pile keeps no label but
 * is still a real, clickable constellation.
 */
function nameCluster(
  members: CanvasObjectData[],
  frames: CanvasObjectData[],
): { anchorId: string; name: string } {
  const centres = members.map(centre);

  // 1) A frame that wraps the group. Prefer the one covering the most members;
  //    a normal grouping frame outranks a delete/scene/agent frame of equal
  //    coverage, because grouping is what a constellation actually is.
  let bestFrame: CanvasObjectData | null = null;
  let bestScore = 0;
  for (const f of frames) {
    const r = frameRect(f);
    let inside = 0;
    for (const c of centres) if (centreInRect(c.x, c.y, r)) inside++;
    if (inside === 0) continue;
    const kindBonus = getFrameKind(f) === 'normal' ? 0.25 : 0;
    const score = inside + kindBonus - f.width * f.height * 1e-9; // ties → tighter frame
    if (inside >= Math.max(1, Math.ceil(members.length * 0.45)) && score > bestScore) {
      bestScore = score;
      bestFrame = f;
    }
  }
  if (bestFrame) {
    const t = cleanTitle(frameTitle(bestFrame));
    if (t) return { anchorId: bestFrame.id, name: t };
  }

  // 2) The biggest heading in the cluster.
  const headings = members
    .filter((o) => o.type === 'heading' && (o.content || '').trim())
    .sort((a, b) => effectiveFontSize(b) - effectiveFontSize(a));
  for (const h of headings) {
    const t = cleanTitle(gistOf(h, 40).text);
    if (t) return { anchorId: h.id, name: t };
  }

  // 3) The weightiest note's gist — display type first, then sheer size.
  const notes = members
    .filter((o) => isSemanticCandidate(o) && (o.content || o.summary || '').trim())
    .sort((a, b) => weight(b) - weight(a));
  for (const nte of notes) {
    const t = cleanTitle(gistOf(nte, 34).text);
    if (t) return { anchorId: nte.id, name: t };
  }

  // 4) Nothing nameable — anchor on the largest block, no label.
  const biggest = [...members].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return { anchorId: biggest.id, name: '' };
}

function weight(o: CanvasObjectData): number {
  const fs = effectiveFontSize(o);
  const displayBonus = o.type === 'heading' ? 4000 : fs >= 22 ? 1500 : 0;
  return displayBonus + fs * 30 + Math.sqrt(Math.max(1, o.width * o.height));
}

/* ------------------------------------------------------------------ build */

/**
 * Turn a canvas level into a galaxy: a star for every block, and a named
 * constellation for every spatial cluster of two or more.
 *
 * `nameOverrides` is anchorId → custom name; an entry always wins over the
 * derived name, and a cleared entry simply isn't present.
 */
export function buildGalaxy(
  objects: CanvasObjectData[],
  nameOverrides: Record<string, string> = {},
): Galaxy {
  const starObjs = objects.filter(isStarObject);
  const frames = objects.filter((o) => o.type === 'frame' && !o.style?.isMinimized);

  if (starObjs.length === 0) {
    return { stars: [], constellations: [], bounds: null };
  }

  const centres = starObjs.map(centre);
  const parent = starObjs.map((_, i) => i);
  const link = linkDistance(centres);
  const link2 = link * link;

  for (let i = 0; i < starObjs.length; i++) {
    for (let j = i + 1; j < starObjs.length; j++) {
      const dx = centres[i].x - centres[j].x;
      const dy = centres[i].y - centres[j].y;
      if (dx * dx + dy * dy <= link2) union(parent, i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < starObjs.length; i++) {
    const root = find(parent, i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const stars: Star[] = starObjs.map((o, i) => {
    const area = Math.max(1, o.width * o.height);
    const fs = effectiveFontSize(o);
    const bright =
      o.type === 'heading' ? 1 : Math.min(0.92, 0.5 + fs / 90 + Math.sqrt(area) / 4000);
    return {
      id: o.id,
      wx: centres[i].x,
      wy: centres[i].y,
      r: Math.max(0.9, Math.min(3.4, Math.sqrt(area) / 34 + bright * 0.9)),
      bright: Math.max(0.35, Math.min(1, bright)),
      seed: hashSeed(o.id),
    };
  });
  const starById = new Map(stars.map((s) => [s.id, s]));

  const constellations: Constellation[] = [];
  const usedAnchors = new Set<string>();

  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue; // lone stars stay lone
    const members = idxs.map((i) => starObjs[i]);
    const named = nameCluster(members, frames);
    const autoName = named.name;
    let anchorId = named.anchorId;

    // Anchors must be unique — two clusters that both resolve to the same block
    // would fight over one label. Fall back to the biggest member's id.
    if (usedAnchors.has(anchorId)) {
      anchorId = members.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0].id;
    }
    usedAnchors.add(anchorId);

    const override = nameOverrides[anchorId];
    const custom = typeof override === 'string' && override.trim().length > 0;
    const name = custom ? override.trim() : autoName;

    const cx = members.reduce((s, o) => s + o.x + o.width / 2, 0) / members.length;
    const cy = members.reduce((s, o) => s + o.y + o.height / 2, 0) / members.length;

    const c: Constellation = {
      id: anchorId,
      anchorId,
      autoName,
      name,
      custom,
      starIds: members.map((o) => o.id),
      count: members.length,
      cx,
      cy,
      bounds: boundsOf(members),
    };
    constellations.push(c);
    for (const id of c.starIds) {
      const s = starById.get(id);
      if (s) s.clusterId = c.id;
    }
  }

  // Brightest / biggest constellations first, so their labels win the z-order.
  constellations.sort((a, b) => b.count - a.count);

  return { stars, constellations, bounds: boundsOf(starObjs) };
}

/* ---------------------------------------------------------- screen mapping */

export interface GalaxyFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Never blow a three-note board up until the notes are the size of planets. */
const MAX_GALAXY_SCALE = 0.42;

/**
 * The transform that lays the whole board out inside the viewport, centred with
 * breathing room. Deliberately independent of the live camera: the star map is
 * a stable, always-fully-visible overview, however the board was framed when
 * you pulled back into it. `screen = world * scale + offset`.
 */
export function galaxyFit(
  bounds: Bounds,
  vw: number,
  vh: number,
  pad = 0.14,
): GalaxyFit {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const usableW = vw * (1 - pad * 2);
  const usableH = vh * (1 - pad * 2);
  const scale = Math.min(MAX_GALAXY_SCALE, usableW / bw, usableH / bh);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    offsetX: vw / 2 - cx * scale,
    offsetY: vh / 2 - cy * scale,
  };
}

export function projectStar(fit: GalaxyFit, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * fit.scale + fit.offsetX, y: wy * fit.scale + fit.offsetY };
}

/**
 * A short, natural label for a nameless cluster, so the sky is never littered
 * with blanks the eye can't parse. Used only when a constellation has no name.
 */
export function fallbackLabel(count: number): string {
  return `${count} stars`;
}
