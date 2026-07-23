/**
 * Brainstorm kit — the corkboard-style tools that live behind the Brainstorm
 * toolbar button: push-pins you hang on the board, paper clips you fasten to
 * notes, and the string/thread you run between pins like a case-study wall.
 *
 * Everything here is data only, so the toolbar panel and the canvas renderers
 * agree on the same palettes and defaults. Pins are ordinary CanvasObjectData
 * (`type: 'pin'`); clips live on a target object's `style.clip`; threads are
 * ordinary connections carrying `style.thread`.
 */

export type BrainstormTool = 'pin' | 'clip' | 'thread';

export interface PinPalette {
  name: string;
  /** The glossy plastic head colour. */
  head: string;
  /** A darker rim/shadow for the head, so it reads as a 3-D dome. */
  shade: string;
}

/** Classic push-pin colours — the plastic-dome kind on any real cork board. */
export const PIN_COLORS: PinPalette[] = [
  { name: 'Crimson', head: '#E5484D', shade: '#B0272C' },
  { name: 'Amber', head: '#E8A23D', shade: '#B4741A' },
  { name: 'Lime', head: '#5EB65E', shade: '#3B8A3B' },
  { name: 'Teal', head: '#2EB6B0', shade: '#1B807C' },
  { name: 'Sky', head: '#4A90D9', shade: '#2E68A8' },
  { name: 'Violet', head: '#9B6DD6', shade: '#6E44A8' },
  { name: 'Rose', head: '#E96BA8', shade: '#B93F7C' },
  { name: 'Ink', head: '#3A3632', shade: '#211E1B' },
];

/** String/twine colours for threads run between pins. */
export const THREAD_COLORS: { name: string; hex: string }[] = [
  { name: 'Red string', hex: '#D64541' },
  { name: 'Twine', hex: '#B08252' },
  { name: 'Charcoal', hex: '#3A3632' },
  { name: 'Sage', hex: '#5E8C6A' },
  { name: 'Slate', hex: '#5A7A9A' },
  { name: 'Plum', hex: '#8A5A8F' },
];

/** Paper-clip finishes. */
export const CLIP_COLORS: { name: string; hex: string }[] = [
  { name: 'Steel', hex: '#8C93A0' },
  { name: 'Gold', hex: '#D9A94B' },
  { name: 'Rose', hex: '#E36B8E' },
  { name: 'Teal', hex: '#3FA6A0' },
  { name: 'Ink', hex: '#4A453F' },
];

export const DEFAULT_PIN_COLOR = PIN_COLORS[0].head;
export const DEFAULT_THREAD_COLOR = THREAD_COLORS[0].hex;
export const DEFAULT_CLIP_COLOR = CLIP_COLORS[0].hex;

/** Rendered footprint of a pin object on the board (world units). */
export const PIN_SIZE = 40;

/** Find the darker rim for a given head colour (falls back to a computed shade). */
export function pinShade(head: string): string {
  const found = PIN_COLORS.find((p) => p.head.toLowerCase() === (head || '').toLowerCase());
  if (found) return found.shade;
  // Unknown/custom colour → darken it a touch for the dome rim.
  const clean = (head || '#E5484D').replace('#', '');
  if (clean.length !== 6) return '#B0272C';
  const r = Math.round(parseInt(clean.slice(0, 2), 16) * 0.68);
  const g = Math.round(parseInt(clean.slice(2, 4), 16) * 0.68);
  const b = Math.round(parseInt(clean.slice(4, 6), 16) * 0.68);
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The clip payload stored on an object's style. */
export interface ClipData {
  color: string;
}
