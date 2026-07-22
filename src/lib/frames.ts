import type { CanvasObjectData, DrawingStroke, ConnectionData } from './db';

/**
 * Frames — a rectangle drawn around a region of the board.
 *
 * A frame used to do exactly one thing: group blocks so dragging it carried
 * them along. It now has a KIND, and the kind decides what the region is FOR:
 *
 *   normal  — grouping backdrop (the original behaviour)
 *   delete  — a bulk eraser: everything whose centre falls inside goes at once
 *   scene   — a slide: the framed rect becomes a stop in the cinematic tour,
 *             titled with the frame's own name
 *   agent   — a question box: the AI reads everything inside (text, files,
 *             code, tasks, AND the images) and answers / edits / reorganises
 *
 * The kind lives in `style.frameKind` so every existing frame keeps working —
 * an absent value reads as 'normal'.
 */

export type FrameKind = 'normal' | 'delete' | 'scene' | 'agent';

export interface FrameKindMeta {
  id: FrameKind;
  label: string;
  /** One line, shown under the picker — says what the region DOES. */
  blurb: string;
  /** Identity colour. Non-normal kinds ignore the user's frameColor so a
   *  delete frame can never be mistaken for an ordinary one. */
  color: string;
}

export const FRAME_KINDS: FrameKindMeta[] = [
  { id: 'normal', label: 'Group',  blurb: 'Groups what it wraps — drag the frame to move it all.', color: '#C97B4B' },
  { id: 'delete', label: 'Delete', blurb: 'Resize over anything you want gone, then clear it in one go.', color: '#D64545' },
  { id: 'scene',  label: 'Scene',  blurb: 'Turns this region into a slide, titled with the frame name.', color: '#3E63DD' },
  { id: 'agent',  label: 'Ask AI', blurb: 'The AI reads everything inside — text, files, images — and answers.', color: '#8B5FBF' },
];

export const DEFAULT_FRAME_COLOR = '#C97B4B';

export function frameKindMeta(kind: FrameKind): FrameKindMeta {
  return FRAME_KINDS.find((k) => k.id === kind) || FRAME_KINDS[0];
}

/** A frame's kind, tolerant of frames created before kinds existed. */
export function getFrameKind(obj: { style?: Record<string, unknown> } | null | undefined): FrameKind {
  const k = obj?.style?.frameKind;
  return k === 'delete' || k === 'scene' || k === 'agent' ? k : 'normal';
}

/**
 * The colour a frame actually paints with. A grouping frame is whatever the
 * user picked; every other kind is locked to its identity colour, because the
 * colour IS the warning / the affordance.
 */
export function frameColorOf(obj: { style?: Record<string, unknown> } | null | undefined): string {
  const kind = getFrameKind(obj);
  if (kind !== 'normal') return frameKindMeta(kind).color;
  return (obj?.style?.frameColor as string) || DEFAULT_FRAME_COLOR;
}

/** The name shown on the frame's tab, falling back to the kind's own noun. */
export function frameTitle(obj: { content?: string; style?: Record<string, unknown> }): string {
  const t = (obj.content || '').trim();
  if (t) return t;
  const kind = getFrameKind(obj);
  return kind === 'normal' ? 'Frame' : frameKindMeta(kind).label;
}

/* ------------------------------------------------------------------ *
 *  Geometry
 * ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function frameRect(f: Pick<CanvasObjectData, 'x' | 'y' | 'width' | 'height'>): Rect {
  return { x: f.x, y: f.y, width: f.width, height: f.height };
}

/** Centre-in-rect containment — the same rule the canvas already uses to decide
 *  which frame a dropped block belongs to, so capture always matches grouping. */
export function centreInRect(cx: number, cy: number, r: Rect): boolean {
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
}

export function objectCentre(o: Pick<CanvasObjectData, 'x' | 'y' | 'width' | 'height'>): { cx: number; cy: number } {
  return { cx: o.x + o.width / 2, cy: o.y + o.height / 2 };
}

/**
 * Everything the frame captures: same canvas level, centre inside the rect,
 * never the frame itself. Sorted reading-order (top→bottom, left→right) so the
 * AI and the delete preview both see the region the way a human reads it.
 */
export function objectsInFrame(
  objects: CanvasObjectData[],
  frame: CanvasObjectData,
): CanvasObjectData[] {
  const r = frameRect(frame);
  return objects
    .filter((o) => {
      if (o.id === frame.id) return false;
      if (o.parentId !== frame.parentId) return false;
      const { cx, cy } = objectCentre(o);
      return centreInRect(cx, cy, r);
    })
    .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
}

export function strokeBounds(s: DrawingStroke): Rect | null {
  if (!s.points || s.points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    const [px, py] = p;
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Ink captured by the frame — a stroke belongs to the region its centre sits in. */
export function strokesInFrame(strokes: DrawingStroke[], frame: CanvasObjectData): DrawingStroke[] {
  const r = frameRect(frame);
  return strokes.filter((s) => {
    if (s.parentId !== frame.parentId) return false;
    const b = strokeBounds(s);
    if (!b) return false;
    return centreInRect(b.x + b.width / 2, b.y + b.height / 2, r);
  });
}

/** Connections whose BOTH ends are captured — the region's internal wiring. */
export function connectionsInFrame(
  connections: ConnectionData[],
  contained: CanvasObjectData[],
): ConnectionData[] {
  const ids = new Set(contained.map((o) => o.id));
  return connections.filter((c) => ids.has(c.fromId) && ids.has(c.toId));
}

/* ------------------------------------------------------------------ *
 *  Camera
 * ------------------------------------------------------------------ */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

/**
 * The camera that frames `rect` in a viewport, with breathing room.
 *
 * Derived live rather than stored, so a scene built on a laptop still frames
 * the same REGION on an external monitor instead of the same stale camera.
 * Inverse of the canvas transform: screen = world * zoom + camera.
 */
export function cameraForRect(
  rect: Rect,
  viewportW: number,
  viewportH: number,
  padding = 0.12,
): { x: number; y: number; zoom: number } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const pad = 1 + Math.max(0, padding) * 2;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewportW / (w * pad), viewportH / (h * pad))));
  const cx = rect.x + w / 2;
  const cy = rect.y + h / 2;
  return { x: viewportW / 2 - cx * zoom, y: viewportH / 2 - cy * zoom, zoom };
}

/** Where a world-space rect lands on screen under a camera. */
export function rectToScreen(
  rect: Rect,
  camera: { x: number; y: number; zoom: number },
): Rect {
  return {
    x: rect.x * camera.zoom + camera.x,
    y: rect.y * camera.zoom + camera.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}
