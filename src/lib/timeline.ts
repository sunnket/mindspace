import type { CanvasObjectData } from '@/lib/db';

/**
 * Timeline block — a Notion-style timeline / gantt view. Each item is a bar
 * spanning a date range; the block renders a day ruler, a "today" marker, and
 * one row per item. Everything lives in style so the block survives a blank
 * `content` (see isAutoCleanable in canvasStore).
 */

export interface TimelineItem {
  id: string;
  label: string;
  /** Inclusive ISO date, YYYY-MM-DD. */
  start: string;
  /** Inclusive ISO date, YYYY-MM-DD. Same as start = a one-day item. */
  end: string;
  color?: string;
  done?: boolean;
}

/** The bar colors a timeline cycles through, in order. */
export const TIMELINE_COLORS = [
  '#C97B4B', // terracotta
  '#4A90D9', // sky
  '#2F9E6E', // sage
  '#9B59B6', // amethyst
  '#D64545', // red
  '#C9904B', // amber
];

export const TIMELINE_SIZE = { width: 620, height: 340 };

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in LOCAL time — `toISOString` would shift the day across a TZ. */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a LOCAL midnight (not UTC), so day math never drifts. */
export function parseISODate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s || '').trim());
  if (!m) return startOfDay(new Date());
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Whole days from a to b (both snapped to local midnight). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** Read the items off an object, tolerating a missing / malformed style. */
export function readTimelineItems(obj: CanvasObjectData): TimelineItem[] {
  const raw = obj.style?.timelineItems;
  if (!Array.isArray(raw)) return [];
  return (raw as TimelineItem[]).filter((i) => i && typeof i.label === 'string');
}

/**
 * The window the ruler spans: the full extent of every item, padded a little,
 * and always wide enough to be legible. Guaranteed to contain today when the
 * items sit near it, so the "today" line is usually on screen.
 */
export function timelineRange(items: TimelineItem[]): { start: Date; days: number } {
  const today = startOfDay(new Date());
  if (items.length === 0) return { start: addDays(today, -3), days: 21 };

  let min = parseISODate(items[0].start);
  let max = parseISODate(items[0].end);
  for (const it of items) {
    const s = parseISODate(it.start);
    const e = parseISODate(it.end);
    if (s < min) min = s;
    if (e > max) max = e;
  }

  const start = addDays(min, -2);
  const end = addDays(max, 2);
  const days = Math.max(10, daysBetween(start, end) + 1);
  return { start, days };
}

/** A fresh timeline seeded with a plausible plan, starting today. */
export function newTimeline(x: number, y: number): Partial<CanvasObjectData> {
  const today = new Date();
  const d = (n: number) => toISODate(addDays(today, n));

  const items: TimelineItem[] = [
    { id: crypto.randomUUID(), label: 'Research & scope', start: d(0), end: d(3), color: TIMELINE_COLORS[0] },
    { id: crypto.randomUUID(), label: 'Design pass', start: d(2), end: d(6), color: TIMELINE_COLORS[1] },
    { id: crypto.randomUUID(), label: 'Build', start: d(5), end: d(12), color: TIMELINE_COLORS[2] },
    { id: crypto.randomUUID(), label: 'Test & polish', start: d(11), end: d(15), color: TIMELINE_COLORS[3] },
    { id: crypto.randomUUID(), label: 'Launch', start: d(16), end: d(16), color: TIMELINE_COLORS[4] },
  ];

  return {
    type: 'card',
    x,
    y,
    width: TIMELINE_SIZE.width,
    height: TIMELINE_SIZE.height,
    content: '',
    style: { isTimeline: true, timelineTitle: 'Timeline', timelineItems: items },
  };
}
