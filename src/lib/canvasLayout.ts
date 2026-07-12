/* ------------------------------------------------------------------
   Canvas layout — the single source of truth for "how much room does
   this block ACTUALLY take, and does it collide with anything?".

   Why this exists: text / heading / sticky / workflow-node blocks
   AUTO-GROW to fit their content when rendered, so `obj.height` is a
   nominal floor, not the truth. A note stored as height:120 can render
   600px tall. Anything that positions blocks from the stored height
   (the agent, auto-arrange) under-reserves space and writes new content
   straight over the bottom of existing text — the text-over-text bug.

   So: mounted blocks MEASURE themselves (exact, via ResizeObserver) and
   register here; unmounted / not-yet-created blocks fall back to a
   deliberately generous content-based estimate. Everything that lays
   out blocks — the agent, and the snapshot we hand the model — reads
   heights through `effectiveHeight` and de-overlaps through `settle`.
   ------------------------------------------------------------------ */

import { CanvasObjectData } from './db';

export interface Rect { x: number; y: number; w: number; h: number; }

/** Breathing room left between blocks when one has to be moved to clear another. */
export const PACK_GAP = 52;

/* ----------------------- measurement registry ----------------------- */

/**
 * id → real rendered height in WORLD units, published by each mounted
 * CanvasObject. Kept outside React/zustand on purpose: it changes on every
 * keystroke in a growing text block and must never trigger a re-render.
 * Entries persist after unmount (viewport culling) — a slightly stale real
 * measurement still beats a nominal height that was never true.
 */
const measured = new Map<string, number>();

export function reportMeasuredHeight(id: string, height: number): void {
  if (!id || !Number.isFinite(height) || height <= 0) return;
  measured.set(id, height);
}

export function forgetMeasuredHeight(id: string): void {
  measured.delete(id);
}

/** Block types that grow past their stored height to fit their content. */
function isAutoGrow(type?: string): boolean {
  return type === 'text' || type === 'heading' || type === 'sticky' || type === 'workflow-node';
}

/**
 * Generous content-based height estimate, for blocks we can't measure (not
 * mounted, or not created yet — the agent's own pending output). Over-reserving
 * costs a little whitespace; under-reserving costs overlapping text, so this
 * errs high on purpose.
 */
export function estimateHeight(obj: Partial<CanvasObjectData>): number {
  const base = Number(obj.height) || 100;
  if (!isAutoGrow(obj.type)) return base;

  const content = String(obj.content ?? '');
  if (!content) return base;

  const w = Number(obj.width) || 200;
  const isHeading = obj.type === 'heading';
  // Average glyph advance and line box for each block's render size.
  const charPx = isHeading ? 20 : 8.6;
  const lineH = isHeading ? 46 : 26;
  const pad = obj.type === 'sticky' ? 40 : 30;

  const perLine = Math.max(6, Math.floor((w - 24) / charPx));
  const lines = content
    .split('\n')
    .reduce((n, line) => {
      // Markdown headings inside a text block render ~1.5x, so they eat more room.
      const weight = /^\s*#{1,3}\s/.test(line) ? 1.5 : 1;
      return n + Math.max(1, Math.ceil(line.length / perLine)) * weight;
    }, 0);

  return Math.max(base, Math.ceil(lines * lineH + pad));
}

/**
 * The height a block ACTUALLY occupies: the measured render when we have one,
 * otherwise a generous estimate. Never smaller than the stored height.
 */
export function effectiveHeight(obj: Partial<CanvasObjectData>): number {
  const stored = Number(obj.height) || 100;
  const real = obj.id ? measured.get(obj.id) : undefined;
  if (real !== undefined && isAutoGrow(obj.type)) return Math.max(stored, real);
  if (real !== undefined) return Math.max(stored, real);
  return estimateHeight(obj);
}

/** The block's true footprint on the board. */
export function rectOf(obj: Partial<CanvasObjectData>): Rect {
  return {
    x: Math.round(Number(obj.x) || 0),
    y: Math.round(Number(obj.y) || 0),
    w: Math.max(1, Number(obj.width) || 200),
    h: Math.max(1, effectiveHeight(obj)),
  };
}

/* -------------------------- collision core -------------------------- */

/**
 * True only on a GENUINE overlap — a few px of real intersection. Blocks that
 * merely sit flush against each other are left exactly where the author (user
 * or model) put them, so intentional tight layouts survive.
 */
export function rectsOverlap(a: Rect, b: Rect, tol = 6): boolean {
  return (
    a.x + tol < b.x + b.w && b.x + tol < a.x + a.w &&
    a.y + tol < b.y + b.h && b.y + tol < a.y + a.h
  );
}

/**
 * Frames are backdrops: they're drawn behind their contents and are MEANT to be
 * overlapped. Treating them as solid would shove every child out of its own
 * frame, so they neither block others nor get pushed themselves.
 */
export function isBackdrop(obj: Partial<CanvasObjectData>): boolean {
  return obj.type === 'frame' || obj.type === 'arrow' || Boolean(obj.style?.isMinimized);
}

/**
 * An occupancy map keyed by object id, so MOVING a block updates its footprint
 * instead of leaving a ghost behind at the old spot (the stale-rect bug that let
 * the agent's own reflow land two blocks on the same square).
 */
export class Occupancy {
  private rects = new Map<string, Rect>();

  constructor(objects: Partial<CanvasObjectData>[] = []) {
    for (const o of objects) this.set(o);
  }

  /** Add or move a block's footprint. Backdrops are tracked but never collide. */
  set(obj: Partial<CanvasObjectData>): void {
    if (!obj.id || isBackdrop(obj)) return;
    this.rects.set(obj.id, rectOf(obj));
  }

  setRect(id: string, rect: Rect): void {
    this.rects.set(id, rect);
  }

  remove(id: string): void {
    this.rects.delete(id);
  }

  /** The first block this rect genuinely collides with, ignoring `selfId`. */
  hit(rect: Rect, selfId?: string): Rect | null {
    for (const [id, r] of this.rects) {
      if (id === selfId) continue;
      if (rectsOverlap(rect, r)) return r;
    }
    return null;
  }

  /**
   * Slide `rect` straight DOWN until it sits in clear space. Downward-only keeps
   * the author's columns intact — a block never jumps sideways into another
   * column's flow, it just takes the next free row in its own.
   */
  resolveDown(rect: Rect, selfId?: string): Rect {
    const out = { ...rect };
    for (let guard = 0; guard < 800; guard++) {
      const hit = this.hit(out, selfId);
      if (!hit) break;
      out.y = hit.y + hit.h + PACK_GAP;
    }
    return out;
  }

  /** Place a block clear of everything and reserve its space. */
  place(obj: Partial<CanvasObjectData>): { x: number; y: number } {
    const rect = rectOf(obj);
    if (isBackdrop(obj)) return { x: rect.x, y: rect.y };
    const free = this.resolveDown(rect, obj.id);
    if (obj.id) this.setRect(obj.id, free);
    else this.rects.set(`__anon_${this.rects.size}`, free);
    return { x: free.x, y: free.y };
  }
}

/* ---------------------------- settle pass ---------------------------- */

export interface Move { id: string; x: number; y: number; }

/**
 * Final guarantee: given the real, just-rendered heights of everything on the
 * board, push apart anything that still genuinely overlaps and return the moves.
 *
 * Only ids in `movable` may be relocated — the user's untouched work stays
 * pinned exactly where it is, and the blocks the agent just placed absorb all
 * the correction. Processed top-to-bottom in column order so a settled block
 * never gets pushed onto one that was already settled.
 */
export function settle(
  objects: CanvasObjectData[],
  movable: Set<string>,
): Move[] {
  const solid = objects.filter((o) => !isBackdrop(o));

  // Anything we're not allowed to move is a fixed obstacle from the start.
  const occ = new Occupancy();
  const anchors = solid.filter((o) => !movable.has(o.id));
  for (const o of anchors) occ.set(o);

  // Settle movable blocks in reading order (left-to-right column, then top-to
  // bottom) so pushes cascade downward predictably instead of fighting.
  const pending = solid
    .filter((o) => movable.has(o.id))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));

  const moves: Move[] = [];
  for (const obj of pending) {
    const before = rectOf(obj);
    const after = occ.resolveDown(before, obj.id);
    occ.setRect(obj.id, after);
    if (after.y !== before.y || after.x !== before.x) {
      moves.push({ id: obj.id, x: after.x, y: after.y });
    }
  }
  return moves;
}

/**
 * Grow a frame so it fully contains its children with even padding. The model
 * routinely sizes frames from nominal heights, so a frame that "wraps" a long
 * text block ends up cutting through it — this re-fits the backdrop to what is
 * actually inside it.
 */
export function fitFrame(
  frame: CanvasObjectData,
  children: CanvasObjectData[],
  padding = 40,
): { x: number; y: number; width: number; height: number } | null {
  if (!children.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of children) {
    const r = rectOf(c);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  // Leave extra headroom at the top for the frame's own title bar.
  const top = minY - padding - 28;
  return {
    x: minX - padding,
    y: top,
    width: Math.round(maxX - minX + padding * 2),
    height: Math.round(maxY - top + padding),
  };
}
