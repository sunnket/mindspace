import type { CanvasObjectData } from './db';

/**
 * Stacks — piles of notes you make by dropping one onto another.
 *
 * The model is deliberately thin. A pile is not an object; it's an agreement
 * between cards that share a `stackId`, and it exists only while at least two
 * of them still agree. Nothing owns it, so nothing has to clean it up: delete
 * members, sweep them with a delete frame, undo half of it, and whatever's
 * left either still reads as a pile or quietly stops being one. There is no
 * container to leave dangling.
 *
 * The other decision worth knowing: **a pile's layout is never written down.**
 * Members share one x/y — the pile's spot on the board — and the fan of a
 * collapsed pile, or the bloom of a spread one, is a render-time transform on
 * top of it. Nothing is mutated to spread a pile and nothing has to be put
 * back to gather it, so spreading a pile can't corrupt anything, can't be
 * half-undone, and animates for free because only a transform changed.
 */

/** How many card edges stay visible before a pile stops looking any deeper. */
const MAX_VISIBLE_DEPTH = 6;
/** Gap between cards once a pile blooms open. */
const SPREAD_GAP = 28;
/** Spread cards float over the rest of the board while they're open. */
export const SPREAD_Z_BASE = 5000;

/**
 * What can be piled. Notes and plain cards — the things you'd have written on
 * paper. A card carrying an `is*` feature flag is a poll, a countdown, a chart:
 * it holds its data in `style` and draws its own chrome, and burying one at the
 * bottom of a pile would just hide a working widget.
 */
export function isStackable(o: CanvasObjectData): boolean {
  if (o.style?.isMinimized) return false;
  if (o.type === 'sticky') return true;
  if (o.type === 'card') {
    return !Object.entries(o.style || {}).some(([k, v]) => /^is[A-Z]/.test(k) && Boolean(v));
  }
  return false;
}

export function stackIdOf(o: CanvasObjectData): string | undefined {
  const id = o.style?.stackId;
  return typeof id === 'string' && id ? id : undefined;
}

function stackOrderOf(o: CanvasObjectData): number {
  const n = o.style?.stackOrder;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Deterministic per-card jitter, so a pile looks tossed but never twitches. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A signed value in [-range, range] derived from an id. */
function jitter(id: string, salt: number, range: number): number {
  const h = hash(id + ':' + salt);
  return ((h % 2001) / 1000 - 1) * range;
}

export interface StackSlot {
  stackId: string;
  /** 0 is the bottom of the pile. */
  index: number;
  count: number;
  /** Render-time offset from the pile's shared x/y, in world px. */
  dx: number;
  dy: number;
  /** Extra rotation, on top of the object's own. */
  rotate: number;
  /** Render order — within the pile when closed, above the board when open. */
  z: number;
  isTop: boolean;
  spread: boolean;
}

/**
 * Every card that is currently part of a real pile, with the transform that
 * places it. `spreadId` is the one pile the user has open, if any.
 *
 * Memoized on the objects array itself. Zustand hands out a fresh array on
 * every change, so the cache invalidates exactly when it should — and the
 * work happens once per update instead of once per card, which is the
 * difference between O(n) and O(n²) on a board with hundreds of notes.
 */
let cacheObjects: CanvasObjectData[] | null = null;
let cacheSpread: string | null = null;
let cacheSlots: Map<string, StackSlot> = new Map();

export function stackSlots(
  objects: CanvasObjectData[],
  spreadId: string | null
): Map<string, StackSlot> {
  if (cacheObjects === objects && cacheSpread === spreadId) return cacheSlots;

  const groups = new Map<string, CanvasObjectData[]>();
  for (const o of objects) {
    const sid = stackIdOf(o);
    if (!sid || !isStackable(o)) continue;
    const g = groups.get(sid);
    if (g) g.push(o);
    else groups.set(sid, [o]);
  }

  const slots = new Map<string, StackSlot>();
  for (const [stackId, raw] of groups) {
    // A pile of one is just a card. Deriving this rather than storing it is
    // what lets members be deleted from anywhere without leaving a husk.
    if (raw.length < 2) continue;

    const members = [...raw].sort((a, b) => stackOrderOf(a) - stackOrderOf(b) || a.id.localeCompare(b.id));
    const count = members.length;
    const spread = spreadId === stackId;

    /* A closed pile keeps whatever depth its topmost card had on the board and
       orders its own members above that. Ordering members from zero instead
       would drop every pile behind everything else on the canvas. */
    let baseZ = 1;
    let cellW = 0;
    let cellH = 0;
    for (const m of members) {
      baseZ = Math.max(baseZ, m.zIndex ?? 1);
      if (spread) {
        cellW = Math.max(cellW, m.width);
        cellH = Math.max(cellH, m.height);
      }
    }
    if (spread) {
      cellW += SPREAD_GAP;
      cellH += SPREAD_GAP;
    }
    const cols = spread ? Math.ceil(Math.sqrt(count)) : 1;
    const rows = spread ? Math.ceil(count / cols) : 1;

    members.forEach((m, index) => {
      let dx: number;
      let dy: number;
      let rotate: number;

      if (spread) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        // Bloom outward from the pile's spot rather than growing off to one
        // side, so opening a pile doesn't march it across the board.
        dx = col * cellW - ((cols - 1) * cellW) / 2;
        dy = row * cellH - ((rows - 1) * cellH) / 2;
        rotate = jitter(m.id, 3, 1.2);
      } else {
        // Only the top few edges of a pile are ever visible; past that,
        // more cards should read as a thicker pile, not a longer staircase.
        const depth = Math.min(index, MAX_VISIBLE_DEPTH);
        dx = depth * 1.1 + jitter(m.id, 1, 1.6);
        dy = -depth * 2.2 + jitter(m.id, 2, 1.6);
        rotate = jitter(m.id, 3, 1.7);
      }

      slots.set(m.id, {
        stackId,
        index,
        count,
        dx,
        dy,
        rotate,
        z: spread ? SPREAD_Z_BASE + index : baseZ + index,
        isTop: index === count - 1,
        spread,
      });
    });
  }

  cacheObjects = objects;
  cacheSpread = spreadId;
  cacheSlots = slots;
  return slots;
}

/** The cards in a pile, bottom first. */
export function membersOf(objects: CanvasObjectData[], stackId: string): CanvasObjectData[] {
  return objects
    .filter((o) => stackIdOf(o) === stackId && isStackable(o))
    .sort((a, b) => stackOrderOf(a) - stackOrderOf(b) || a.id.localeCompare(b.id));
}

/**
 * The card a drop would land on: the topmost stackable block whose box
 * contains `point`, ignoring the one being dragged and anything already in
 * the same pile. Checked against the drag's CENTRE, which is how people aim.
 *
 * `slots` is not optional in spirit. Cards in an open pile all STORE the
 * pile's one position while being DRAWN spread out around it, so hit-testing
 * stored boxes would aim at a stack of cards sitting invisibly at the centre
 * of the bloom — you'd drop a card into what looks like clear space between
 * two others and watch it pile onto something that isn't there. Passing the
 * slots tests the boxes the user can actually see.
 */
export function stackTargetAt(
  objects: CanvasObjectData[],
  dragged: CanvasObjectData,
  point: { x: number; y: number },
  slots?: Map<string, StackSlot>
): CanvasObjectData | null {
  const draggedStack = stackIdOf(dragged);
  let best: CanvasObjectData | null = null;
  for (const o of objects) {
    if (o.id === dragged.id) continue;
    if (!isStackable(o)) continue;
    if (draggedStack && stackIdOf(o) === draggedStack) continue;
    const slot = slots?.get(o.id);
    const ox = o.x + (slot?.dx ?? 0);
    const oy = o.y + (slot?.dy ?? 0);
    if (point.x < ox || point.x > ox + o.width) continue;
    if (point.y < oy || point.y > oy + o.height) continue;
    if (!best || (o.zIndex ?? 0) >= (best.zIndex ?? 0)) best = o;
  }
  return best;
}
