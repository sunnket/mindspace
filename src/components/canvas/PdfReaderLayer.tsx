'use client';

/**
 * Immersive PDF Reader — a full-screen "reading room" for dropped PDFs (v4).
 *
 * Opened from a PDF file block (FileBlock). Portaled to <body>, mounted only
 * while open (usePdfReaderStore). No top chrome — the page owns the whole frame;
 * one floating dock at the bottom holds every control.
 *
 *   • Scroll layout (one big page + a sliding thumbnail filmstrip) and a real
 *     hardcover Book layout (leather boards, thickening page-edge stacks, sunken
 *     gutter, ribbon marker) with a 3D page-CURL turn (front/back faces + sheen).
 *   • Aged paper — a real sepia FILTER on the page content + foxing + edge-brown.
 *   • 40 built rooms (components/canvas/pdfRooms.tsx): layered stages with
 *     distance, architecture, a motivated key light and a foreground, chosen
 *     from a drawer that previews the real scene. Optional ambient sound.
 *   • Annotate — highlighter, freehand ink (perfect-freehand), resizable sticky
 *     notes, an eraser, and select-to-clip onto the board.
 *
 * All of it persists on style.pdfReader (isDirty → IndexedDB + Supabase for
 * signed-in users) and is flushed synchronously on close.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
/* The reader's own stylesheets, imported HERE rather than from globals.css.
   Together they're 140KB, and as globals they sat in the render-blocking CSS of
   every route — including a landing page that will never show a PDF. Attached
   to this component, they ship in its chunk, which is itself only fetched when
   a document is actually opened. */
import '@/app/pdf-reader.css';
import '@/app/pdf-rooms.css';
import { getStroke } from 'perfect-freehand';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import { useCanvasStore } from '@/store/canvasStore';
import { getFileForBlock } from '@/lib/fileIngest';
import { PdfSession, type TextSpan } from '@/lib/pdf/pdfReader';
import { playSnap, startRain, stopRain, startAmbience, stopAmbience, playPageTurn, playCoverOpen, playCoverClose, playSpineCreak, playPaperSettle } from '@/lib/relaxAudio';
import { ageMarks, ageFilter, agePresetOf, AGE_PRESETS, type AgeCfg } from '@/lib/pdf/aging';
import { ROOMS, ROOM_GROUPS, RoomScene, RoomPreview, getRoom, isRoom, type Atmos, type RoomGroup } from './pdfRooms';

/* ------------------------------- model ---------------------------------- */
type Layout = 'scroll' | 'book' | 'typeset';
type Tool = 'none' | 'highlight' | 'draw' | 'sticky' | 'eraser';

/* --------------------------- the flipbook -------------------------------- *
 * Three states, and one animation at a time.
 *
 *   'front' — shut, front board facing you. Where a new document starts.
 *   'open'  — a spread. `page` is normalised to the odd (left) page of it.
 *   'back'  — shut from the other end, back board facing you.
 *
 * A leaf carries the page you're leaving on its FRONT and the page you're going
 * to on its BACK, which is what a sheet of paper actually is. `leftShown` and
 * `rightShown` are what sits under it during the turn: on the way forward the
 * right-hand page revealed behind the rising sheet is already the next one, and
 * the left stays put until the sheet covers it.
 */
type BookPhase = 'front' | 'open' | 'back';
interface Leaf {
  dir: 'next' | 'prev';
  front: number; back: number;
  leftShown: number; rightShown: number;
  target: number;
}
/** Covers still swing on their own CSS clock; only the leaf is hand-driven. */
type BookAnim =
  | { kind: 'cover'; dir: 'open' | 'close' }
  | { kind: 'back'; dir: 'open' | 'close' };

/* --------------------------- turning a leaf ------------------------------ *
 * A turn is a POSITION, not a canned animation.
 *
 * It used to be three CSS keyframe sets — "Fast", "Curl" and "Glide", 200/280/
 * 320ms — which is three answers to a question nobody asked, and none of them
 * could do the one thing every real flipbook does: let you take hold of the
 * corner and pull. A keyframe runs start to finish on its own; it cannot follow
 * your thumb, cannot be let go of half way, cannot be turned back.
 *
 * So the sheet's whole appearance is a pure function of one number, `t`, from 0
 * (flat, unturned) to 1 (landed on the other side). Clicking runs `t` from 0 to
 * 1 on a spring; dragging sets it from the pointer. Both paths are the same
 * paint code, which is why a dragged turn and a clicked one look identical.
 *
 * `t` is pushed to the DOM as a CSS custom property on every frame rather than
 * through React state — a spread holds two rasterised PDF canvases and a
 * transformed sheet, and re-rendering that tree sixty times a second is exactly
 * how a page turn ends up feeling expensive.
 */
interface Turning { leaf: Leaf; t: number; dragging: boolean }

/* A full click-driven turn, tip to tail.
 *
 * 420ms was measured against a page you were WAITING for. Reading is a rhythm —
 * you turn, and you are already looking at the next line — and at that length
 * the book was politely finishing its animation while your eye had moved on.
 * A real sheet flicked with a thumb crosses in about a quarter of a second.
 * The `hurry` variant is what a held arrow key or a burst of clicks gets: once
 * you are travelling, each turn only has to read as a turn, not perform one. */
const LEAF_MS = 265;
const LEAF_MS_HURRY = 190;
/** Covers are heavier than paper, but 450ms was a doorway you had to wait in. */
const COVER_MS = 280;
/** Past this much of a drag, letting go finishes the turn instead of undoing it. */
const DRAG_COMMIT = 0.38;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Unit cubic-bezier, solved the way the CSS engine solves it. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number) => 3 * b - 6 * a;
  const C = (a: number) => 3 * a;
  const curve = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = curve(t, x1, x2) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return curve(t, y1, y2);
  };
}

/* THE CURVE, and why this one.
 *
 * It used to be `1 - (1-k)^3` — a plain ease-out, which sounds right for paper
 * (flick, then air resistance) and measures terribly. That curve is 95% of the
 * way over at k=0.63: the sheet visibly finished in 290ms and then spent the
 * remaining 170ms of its 460 creeping the last few pixels, with the page only
 * committing at the end of it. Motion you can't see reads as the app thinking,
 * which is exactly the "bit of lag" in a turn that was never actually dropping
 * a frame.
 *
 * This one still leaves at speed — 15% of the way over in the first tenth, so
 * the click is answered immediately — but keeps moving through the middle and
 * lands decisively: 96% at k=0.85, so the dead tail is ~70ms instead of 170.
 */
const easeTurn = cubicBezier(0.15, 0.2, 0.55, 0.95);

/**
 * Every visual quantity of the sheet at progress `t`, in one place.
 *
 * `bow` is the physical heart of it: a sheet of paper held at the spine and
 * lifted does not stay flat, it bows, most at the half-way point and not at all
 * at either end — which is `sin(πt)`. The lift, the lean, the curl of the free
 * edge and the specular sweep are all scaled from it, so they cannot drift out
 * of agreement with each other the way six separate keyframe tracks did.
 */
function leafFrame(t: number) {
  const p = clamp01(t);
  const bow = Math.sin(Math.PI * p);
  // The two cast shadows: one half is being uncovered, the other buried.
  const castClear = Math.pow(1 - p, 1.5);
  const rise = clamp01((p - 0.24) / 0.6);
  const castFall = p > 0.94 ? (1 - p) / 0.06 * 0.9 : Math.pow(rise, 1.9) * 0.9;
  return {
    bow,
    // The front face is what faces you until the sheet passes edge-on at 0.5;
    // after that you are reading the back of it.
    sheenFront: p < 0.5 ? 0.1 + 1.7 * p : 0,
    sheenBack: p < 0.5 ? 0 : 0.9 - 1.55 * (p - 0.5),
    castClear,
    castFall,
  };
}
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;
/** A spread always begins on an odd page — (1,2), (3,4), … as a book is set. */
const oddLeft = (p: number) => Math.max(1, p % 2 === 1 ? p : p - 1);

/** Width reserved for the block of paper on each side, whatever it currently
    holds. Constant on purpose — see the note by `leftStack` in BookView. */
const STACK_SLOT = 26;

interface Highlight { id: string; page: number; x: number; y: number; w: number; h: number; color: string }
interface Stroke { id: string; page: number; pts: number[][]; color: string; size: number }
interface Sticky { id: string; page: number; x: number; y: number; w: number; h: number; text: string; color: string; rot: number }

/** Typeset ("reflow") settings — the reader's own typography, not the PDF's. */
interface Typo {
  font: string;      // BOOK_FONTS id
  size: number;      // px
  leading: number;   // × font size
  measure: number;   // characters per line, the real lever on readability
  justify: boolean;
  bionic: boolean;   // bold the leading syllable of each word
  paper: string;     // PAPERS id
}
const TYPO: Typo = { font: 'literata', size: 20, leading: 1.62, measure: 66, justify: false, bionic: false, paper: 'cream' };

/* ------------------------------------------------------------------
   READING FOCUS — eleven ways to light a page.

   The first version of this was five masks: a black rectangle with a hole
   punched in it, the hole a slightly different shape each time. That is not
   how any of the things it was named after behave. A match does not dim the
   room by 72% inside a tidy ellipse; it throws a small, hot, unsteady light
   that is nearly white at the wick, orange a hand's width out, and gone. A
   torch has a beam you can see. A keyhole is a keyhole shape. And a reading
   ruler is a physical card lying on the paper — it has edges, and edges cast
   shadows.

   Two ideas carry the rebuild, and they are what make these read as light
   rather than as holes:

     · LIGHT IS ADDITIVE. Every lamp here paints a `plus-lighter` layer that
       genuinely brightens the paper inside its pool, on top of the layer that
       darkens everything else. A hole in a dark sheet can only ever reveal;
       real light arrives.
     · LIGHT HAS A COLOUR, AND IT CHANGES AS IT FALLS OFF. Warm sources go
       amber then red at the edge of their reach, cold ones go blue. That
       gradient across a single pool is most of what your eye reads as
       "a flame" versus "a circle".

   Flame modes get a third: they MOVE. A flicker that only changes opacity
   reads as a failing bulb; a real flame wanders a few pixels and changes size
   while it does it.
   ------------------------------------------------------------------ */
type FocusMode =
  | 'ruler' | 'typoscope' | 'tint'
  | 'spotlight' | 'torch' | 'lamp' | 'keyhole'
  | 'matchstick' | 'candle'
  | 'window' | 'moon';

type FocusGroup = 'Guides' | 'Lamps' | 'Flame' | 'Daylight';
const FOCUS_GROUPS: FocusGroup[] = ['Guides', 'Lamps', 'Flame', 'Daylight'];

interface FocusDef {
  id: FocusMode;
  group: FocusGroup;
  label: string;
  blurb: string;
  icon: string;
  /** Reveal follows the cursor's X as well as its Y. */
  tracksX?: boolean;
}

const FOCUS_MODES: FocusDef[] = [
  { id: 'ruler', group: 'Guides', label: 'Line ruler', icon: 'M3 8h18M3 16h18M6 12h12',
    blurb: 'A card with a slot cut in it, laid across the line you are on.' },
  { id: 'typoscope', group: 'Guides', label: 'Typoscope', icon: 'M4 5h16v14H4zM8 9h8v6H8z', tracksX: true,
    blurb: 'The same card, but a window — a few lines at a time instead of one.' },
  { id: 'tint', group: 'Guides', label: 'Colour film', icon: 'M12 3l7 5v8l-7 5-7-5V8z', tracksX: true,
    blurb: 'A coloured sheet over the page. Hides nothing, calms everything.' },

  { id: 'spotlight', group: 'Lamps', label: 'Spotlight', icon: 'M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M19.07 19.07l-2.83-2.83M22 12h-4M19.07 4.93l-2.83 2.83', tracksX: true,
    blurb: 'A theatre lamp overhead. Clean white, hard centre, soft rim.' },
  { id: 'torch', group: 'Lamps', label: 'Torch', icon: 'M12 2v6M8 14a4 4 0 0 0 8 0l-2-8h-4zM10 18h4M11 22h2', tracksX: true,
    blurb: 'A hand torch: you can see the beam, and its hot spot.' },
  { id: 'lamp', group: 'Lamps', label: 'Desk lamp', icon: 'M9 3h6l3 8H6zM12 11v7M8 21h8', tracksX: true,
    blurb: 'Steady, warm, angled in from the left the way a desk lamp is.' },
  { id: 'keyhole', group: 'Lamps', label: 'Keyhole', icon: 'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 10v10h4V10', tracksX: true,
    blurb: 'Read it like you are not supposed to be.' },

  { id: 'matchstick', group: 'Flame', label: 'Matchlight', icon: 'M12 2c-2 3-4 5-4 8a4 4 0 0 0 8 0c0-3-2-5-4-8zM10 20h4v2h-4z', tracksX: true,
    blurb: 'Small, hot and never quite still. Burns for as long as you read.' },
  { id: 'candle', group: 'Flame', label: 'Candle', icon: 'M12 2c-1.6 2.4-3 4-3 6a3 3 0 0 0 6 0c0-2-1.4-3.6-3-6zM9 12h6v9H9z', tracksX: true,
    blurb: 'Wider than a match and far calmer. Leans when it breathes.' },

  { id: 'window', group: 'Daylight', label: 'Window light', icon: 'M4 3h16v18H4zM12 3v18M4 12h16', tracksX: true,
    blurb: 'An afternoon shaft falling across the page, dust and all.' },
  { id: 'moon', group: 'Daylight', label: 'Moonlight', icon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z', tracksX: true,
    blurb: 'Cold, dim and wide. Just enough to make out the words.' },
];

const FOCUS_BY_ID = new Map(FOCUS_MODES.map((f) => [f.id, f]));

/** Colours for the film — the classic overlay tints, not a rainbow picker. */
const FILM_TINTS: { id: string; label: string; rgb: string }[] = [
  { id: 'amber', label: 'Amber', rgb: '214, 158, 74' },
  { id: 'rose', label: 'Rose', rgb: '212, 128, 138' },
  { id: 'mint', label: 'Mint', rgb: '116, 186, 152' },
  { id: 'sky', label: 'Sky', rgb: '116, 162, 210' },
  { id: 'violet', label: 'Violet', rgb: '150, 132, 208' },
  { id: 'grey', label: 'Grey', rgb: '150, 148, 146' },
];

interface ReaderState {
  page: number; layout: Layout; atmos: Atmos; aged: boolean; strip: boolean; sound: boolean;
  /** Which paper this book is printed on, and how far gone it is. */
  age: AgeCfg;
  zen: boolean; ruler: boolean; focusMode: FocusMode; focusDarkness: number; typo: Typo;
  /** How far the light reaches, as a multiplier on each mode's natural size. */
  focusSize: number;
  /** Kill the flicker and the wander. Some people cannot read next to them. */
  focusSteady: boolean;
  /** Which tint the colour film uses. */
  focusTint: string;
  bookmarks: number[]; highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[];
}
const DEFAULTS: ReaderState = {
  page: 1, layout: 'scroll', atmos: 'library', aged: false, strip: true, sound: false,
  age: { preset: 'foxed', amount: 0.75 },
  zen: false, ruler: false, focusMode: 'ruler', focusDarkness: 0.72, typo: TYPO,
  focusSize: 1, focusSteady: false, focusTint: 'amber',
  bookmarks: [], highlights: [], drawings: [], stickies: [],
};
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? v as T[] : []; }
function initState(raw: unknown): ReaderState {
  const r = (raw && typeof raw === 'object') ? raw as Partial<ReaderState> : {};
  return {
    ...DEFAULTS, ...r,
    atmos: isRoom(r.atmos) ? r.atmos : DEFAULTS.atmos,
    sound: r.sound === true,
    zen: false,                                   // never start hidden — you'd think it broke
    // A board saved before a mode existed (or after one was renamed) falls back
    // rather than rendering an overlay with no rules attached to it.
    focusMode: FOCUS_BY_ID.has(r.focusMode as FocusMode) ? r.focusMode as FocusMode : DEFAULTS.focusMode,
    focusDarkness: typeof r.focusDarkness === 'number' ? Math.max(0.4, Math.min(0.95, r.focusDarkness)) : DEFAULTS.focusDarkness,
    focusSize: typeof r.focusSize === 'number' ? Math.max(0.55, Math.min(2, r.focusSize)) : DEFAULTS.focusSize,
    focusSteady: r.focusSteady === true,
    focusTint: FILM_TINTS.some((t) => t.id === r.focusTint) ? r.focusTint as string : DEFAULTS.focusTint,
    /* `aged` used to be a single boolean, and every board saved with it on means
       "give me old paper" — so it becomes the middle preset rather than being
       thrown away. The boolean itself stays as the on/off switch; the preset is
       WHICH old paper. */
    age: {
      preset: AGE_PRESETS.some((a) => a.id === r.age?.preset) ? r.age!.preset : DEFAULTS.age.preset,
      amount: typeof r.age?.amount === 'number' ? Math.max(0.2, Math.min(1, r.age.amount)) : DEFAULTS.age.amount,
    },
    typo: { ...TYPO, ...(r.typo && typeof r.typo === 'object' ? r.typo : {}) },
    page: Math.max(1, r.page || 1),
    bookmarks: arr(r.bookmarks), highlights: arr(r.highlights),
    drawings: arr(r.drawings), stickies: arr<Sticky>(r.stickies).map((s) => ({ ...s, w: s.w || 150, h: s.h || 104 })),
  };
}

/* Fonts you would actually set a book in, plus the two that exist for people
   who find the usual ones hard: Atkinson (legibility) and the typewriter. */
const BOOK_FONTS: { id: string; label: string; css: string; note?: string }[] = [
  { id: 'literata', label: 'Literata', css: "'Literata', Georgia, serif", note: 'Drawn for long reading' },
  { id: 'garamond', label: 'EB Garamond', css: "'EB Garamond', Garamond, serif", note: 'Classical, warm' },
  { id: 'crimson', label: 'Crimson', css: "'Crimson Pro', Georgia, serif", note: 'Light, bookish' },
  { id: 'newsreader', label: 'Newsreader', css: "'Newsreader', Georgia, serif", note: 'Editorial' },
  { id: 'lora', label: 'Lora', css: "'Lora', Georgia, serif" },
  { id: 'merriweather', label: 'Merriweather', css: "'Merriweather', Georgia, serif", note: 'Sturdy on screens' },
  { id: 'playfair', label: 'Playfair', css: "'Playfair Display', Georgia, serif", note: 'High contrast' },
  { id: 'cinzel', label: 'Cinzel', css: "'Cinzel', Georgia, serif", note: 'Inscriptional' },
  { id: 'atkinson', label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif", note: 'Built for low vision' },
  { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'outfit', label: 'Outfit', css: "'Outfit', system-ui, sans-serif" },
  { id: 'elite', label: 'Typewriter', css: "'Special Elite', 'Courier New', monospace", note: 'Manuscript' },
  { id: 'mono', label: 'Mono', css: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'shantell', label: 'Shantell', css: "'Shantell Sans', cursive", note: 'Handwritten' },
];
const fontCss = (id: string) => (BOOK_FONTS.find((f) => f.id === id) || BOOK_FONTS[0]).css;

/** Paper to print it on. `night` is the one that matters at 1am. */
const PAPERS: { id: string; label: string; bg: string; ink: string; sel: string }[] = [
  { id: 'cream', label: 'Cream', bg: '#f5eddc', ink: '#2b2318', sel: 'rgba(200,150,60,0.28)' },
  { id: 'white', label: 'Paper', bg: '#fcfbf7', ink: '#1c1b19', sel: 'rgba(120,170,255,0.3)' },
  { id: 'sepia', label: 'Sepia', bg: '#eadfc2', ink: '#3d2f18', sel: 'rgba(180,120,40,0.3)' },
  { id: 'night', label: 'Night', bg: '#15171b', ink: '#c6cbd3', sel: 'rgba(120,170,255,0.28)' },
];
const paperOf = (id: string) => PAPERS.find((p) => p.id === id) || PAPERS[0];

const HL_COLORS = ['rgba(255,224,77,0.55)', 'rgba(150,231,150,0.5)', 'rgba(127,199,255,0.5)', 'rgba(255,158,199,0.5)', 'rgba(255,184,119,0.5)'];
const PEN_COLORS = ['#e0483a', '#2f6fed', '#12a150', '#f5a623', '#8b5cf6', '#1a1a1a'];
const STICKY_COLORS = ['#ffe98a', '#ffc9de', '#bfe6ff', '#c9f4c9', '#f3d7a4'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2, 9);
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function strokeToPath(pts: number[][]): string {
  if (!pts.length) return '';
  const d = pts.reduce((acc: (string | number)[], [x0, y0], i, a) => {
    const [x1, y1] = a[(i + 1) % a.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ['M', ...pts[0], 'Q']);
  d.push('Z');
  return d.join(' ');
}
function inkPath(pts: number[][], size: number): string {
  return strokeToPath(getStroke(pts, { size, thinning: 0.5, smoothing: 0.55, streamline: 0.5, easing: (t) => t }));
}

/* ---------------------------- reflowing text ---------------------------- */
/**
 * PDF lines → paragraphs. A PDF has no idea what a paragraph is; it has lines
 * at coordinates. Three signals recover them well enough to read: a blank line,
 * a line that ends noticeably short of the measure (the last line of a
 * paragraph), and a line that starts with an indent. Words broken across a line
 * with a hyphen get sewn back together, which is the difference between prose
 * and "some- thing like this".
 */
function toParagraphs(lines: string[]): string[] {
  const widths = lines.filter((l) => l.trim()).map((l) => l.length).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length * 0.75)] : 70;
  const out: string[] = [];
  let buf = '';
  const flush = () => { const t = buf.trim(); if (t) out.push(t); buf = ''; };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    if (/^\s{2,}|^\t/.test(raw) && buf) flush();          // indent starts a new one
    if (buf.endsWith('-')) buf = buf.slice(0, -1) + line.trimStart();
    else buf = buf ? `${buf} ${line.trim()}` : line.trim();
    const t = line.trim();
    // a short line that ends a sentence closes the paragraph…
    if (t.length < typical * 0.78 && /[.!?"'’”)\]]$/.test(t)) flush();
    // …and a very short line with no terminator at all is a heading, which
    // must not get swallowed by the prose that follows it
    else if (t.length < typical * 0.45 && !/[,;:]$/.test(t)) flush();
  }
  flush();
  return out;
}

/** Split into sentences, keeping their punctuation — the unit read-aloud speaks. */
function toSentences(p: string): string[] {
  const parts = p.match(/[^.!?…]+[.!?…]+["'’”)\]]*\s*|[^.!?…]+$/g);
  return (parts || [p]).map((x) => x.trim()).filter(Boolean);
}

/** Bold the leading part of each word. The eye fills in the rest — that's the idea. */
function bionic(text: string, key: string): React.ReactNode {
  return text.split(/(\s+)/).map((w, i) => {
    if (!w.trim()) return w;
    const n = Math.max(1, Math.ceil(w.replace(/[^\p{L}]/gu, '').length * 0.42));
    let cut = 0, seen = 0;
    for (; cut < w.length && seen < n; cut++) if (/\p{L}/u.test(w[cut])) seen++;
    return <span key={`${key}-${i}`}><b>{w.slice(0, cut)}</b>{w.slice(cut)}</span>;
  });
}

/* ------------------------------ read aloud ------------------------------- */
/**
 * Speech is a state machine with three hostile edge cases, all of which the
 * first version got wrong:
 *
 *   1. `cancel()` fires `end` on the utterance it just killed. If `end` blindly
 *      advances the cursor, then changing the speed — which must cancel and
 *      re-speak — skips a sentence, and doing it twice quickly runs off the end
 *      of the page and stops everything. Every utterance is therefore tagged,
 *      and only the utterance we still consider current is allowed to advance.
 *   2. The text arrives asynchronously. Starting playback before the page's
 *      prose has loaded used to look like "no sentences left", so it stopped
 *      itself instantly — which is why it only ever spoke once.
 *   3. Chrome silently stops speaking after ~15 seconds unless something pokes
 *      `resume()`. The keepalive below is not optional.
 */
interface Speech {
  on: boolean; paused: boolean; idx: number;
  rate: number; pitch: number; volume: number; voice: string; auto: boolean;
}
const SPEECH: Speech = { on: false, paused: false, idx: 0, rate: 1, pitch: 1, volume: 1, voice: '', auto: true };

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return undefined;
    const read = () => setVoices(synth.getVoices().filter((v) => v.lang.startsWith('en') || v.default));
    read();
    synth.addEventListener('voiceschanged', read);
    return () => synth.removeEventListener('voiceschanged', read);
  }, []);
  return voices;
}

function useReadAloud(opts: {
  speech: Speech;
  setSpeech: React.Dispatch<React.SetStateAction<Speech>>;
  sentences: string[];
  ready: boolean;                 // the prose for THIS page has arrived
  voices: SpeechSynthesisVoice[];
  hasNextPage: boolean;
  onPageEnd: () => void;
}) {
  const { speech, setSpeech, sentences, ready, voices, hasNextPage, onPageEnd } = opts;
  const currentRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return undefined;
    if (!speech.on || speech.paused) { synth.cancel(); currentRef.current = null; return undefined; }
    if (!ready) return undefined;                       // (2) wait for the words

    const text = sentences[speech.idx];
    if (text === undefined) {
      const id = window.setTimeout(() => {
        if (speech.auto && hasNextPage) { onPageEnd(); setSpeech((s) => ({ ...s, idx: 0 })); }
        else setSpeech((s) => ({ ...s, on: false, idx: 0 }));
      }, 200);
      return () => window.clearTimeout(id);
    }

    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = speech.rate; u.pitch = speech.pitch; u.volume = speech.volume;
    const v = voices.find((x) => x.voiceURI === speech.voice);
    if (v) u.voice = v;
    u.onend = () => { if (currentRef.current === u) setSpeech((s) => ({ ...s, idx: s.idx + 1 })); };  // (1)
    u.onerror = () => { if (currentRef.current === u) setSpeech((s) => ({ ...s, on: false })); };
    currentRef.current = u;
    synth.speak(u);

    const keepalive = window.setInterval(() => { if (synth.speaking && !synth.paused) synth.resume(); }, 9000);  // (3)
    return () => { window.clearInterval(keepalive); currentRef.current = null; synth.cancel(); };
  }, [speech.on, speech.paused, speech.idx, speech.rate, speech.pitch, speech.volume, speech.voice, speech.auto,
    sentences, ready, voices, hasNextPage, onPageEnd, setSpeech]);

  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);
}

/** The word under the pointer — works over reflowed text and the PDF text layer alike. */
function wordAtPoint(x: number, y: number): string {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null; let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return '';
  const text = node.textContent || '';
  const isWord = (c: string) => /[\p{L}\p{M}'’-]/u.test(c);
  let a = Math.min(offset, text.length - 1); let b = a;
  if (!isWord(text[a] || '')) return '';
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return text.slice(a, b).replace(/^[-'’]+|[-'’]+$/g, '');
}

/* ------------------------------- icons ---------------------------------- */
const I = {
  close: 'M18 6 6 18M6 6l12 12', next: 'm9 18 6-6-6-6', prev: 'm15 18-6-6 6-6',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  scroll: 'M5 4h14v6H5zM5 14h14v6H5z',
  bookmark: 'm19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  hl: 'm9 11-6 6v3h3l6-6M9 11l4-4 3 3-4 4M9 11l4 4M13 7l3-3a2 2 0 0 1 3 3l-3 3',
  draw: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  sticky: 'M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2zM15 21v-6h6',
  eraser: 'm16 3 5 5L11 18H6l-3-3a2 2 0 0 1 0-3zM9 21h12',
  clip: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  strip: 'M3 5h4v14H3zM10 5h4v14h-4zM17 5h4v14h-4z',
  aged: 'M4 19.5V6a2 2 0 0 1 2-2h11l3 3v12.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 8h6M8 12h8M8 16h5',
  room: 'M12 3 2 12h3v8h6v-5h2v5h6v-8h3z',
  sound: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  mute: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  typeset: 'M4 6h16M4 10h16M4 14h11M4 18h8',
  zen: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3',
  speak: 'M11 5 6 9H2v6h4l5 4zM16 8a4 4 0 0 1 0 8',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  play: 'M6 4l14 8-14 8z',
  define: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM10 7h6M10 11h4',
  ruler: 'M3 8h18M3 16h18M6 12h12',
  focusMenu: 'M12 3v1m0 16v1m-9-9H2m20 0h-1m-2.64-6.36-.7.7M6.34 17.66l-.7.7m12.72 0-.7-.7M6.34 6.34l-.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
};
function Ico({ d, s = 16 }: { d: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}


/**
 * One click, one call.
 *
 * The reader is portalled into <body>, and React keeps event listeners on both
 * the application's root container and on each portal container. A click on a
 * control inside the portal therefore arrives at the handler TWICE — same
 * native event, same timestamp, two dispatches. Anything shaped like
 * `onClick={() => setThing(!thing)}` toggles on and straight back off, which is
 * exactly why "hide the toolbar" appeared to do nothing at all.
 *
 * Deduping on the native event's timestamp fixes every toggle at once: two
 * dispatches of one event share a timestamp, two real clicks never do.
 */
function useOnce() {
  const last = useRef(-1);
  return useCallback((fn: () => void) => (e: { timeStamp: number }) => {
    if (e.timeStamp === last.current) return;
    last.current = e.timeStamp;
    fn();
  }, []);
}

/* ============================== gate ==================================== */
export default function PdfReaderLayer() {
  const objId = usePdfReaderStore((s) => s.objId);
  if (!objId || typeof document === 'undefined') return null;
  return createPortal(<Reader key={objId} objId={objId} />, document.body);
}

/* ============================== reader ================================== */
function Reader({ objId }: { objId: string }) {
  const closeReader = usePdfReaderStore((s) => s.closeReader);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const addObject = useCanvasStore((s) => s.addObject);

  const [objSnap] = useState(() => useCanvasStore.getState().objects.find((o) => o.id === objId));
  const [st, setSt] = useState<ReaderState>(() => initState(objSnap?.style?.pdfReader));
  const set = useCallback((p: Partial<ReaderState>) => setSt((s) => ({ ...s, ...p })), []);

  const [session, setSession] = useState<PdfSession | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [tool, setTool] = useState<Tool>('none');
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(4);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]);
  const [clip, setClip] = useState(false);
  const [annot, setAnnot] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  /* Whether Typography was opened from the PAPER button — it opens on the paper
     section rather than at the top when it was. */
  const [typeJump, setTypeJump] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [roomTab, setRoomTab] = useState<RoomGroup | 'All'>('All');
  const [card, setCard] = useState<{ label: string; blurb: string } | null>(null);
  const [toast, setToast] = useState('');
  const [anim, setAnim] = useState<BookAnim | null>(null);
  const [phase, setPhase] = useState<BookPhase>(() => (st.page <= 1 ? 'front' : 'open'));
  const animTimer = useRef<number | null>(null);
  /* The leaf in flight. React only hears about it twice — when it starts and
     when it lands — because everything in between is written straight to the
     DOM as a custom property (see `paintLeaf`). */
  const [turning, setTurning] = useState<Turning | null>(null);
  const turnRaf = useRef<number | null>(null);
  const bookElRef = useRef<HTMLDivElement | null>(null);
  const tRef = useRef(0);
  const [chrome, setChrome] = useState(true);          // is the furniture showing?
  const [speech, setSpeech] = useState<Speech>(SPEECH);
  const voices = useVoices();
  const [define, setDefine] = useState(false);
  const [lookup, setLookup] = useState<null | { word: string; x: number; y: number; loading: boolean; phonetic?: string; defs?: { pos: string; text: string }[]; error?: string }>(null);
  const [focusY, setFocusY] = useState(0.5);
  const [focusX, setFocusX] = useState(0.5);
  const toggleBookmarkRef = useRef<null | (() => void)>(null);
  const once = useOnce();

  const numPages = session?.numPages ?? 0;
  const sound = st.sound;

  /* -- open the document ------------------------------------------------- */
  useEffect(() => {
    let alive = true; let sess: PdfSession | null = null;
    (async () => {
      const file = getFileForBlock(objId);
      if (!file) { setLoadErr('The file is no longer in memory — re-drop the PDF onto the board.'); return; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        sess = await PdfSession.open(bytes);
        if (!alive) { sess.destroy(); return; }
        setSession(sess);
        setSt((s) => ({ ...s, page: Math.min(Math.max(1, s.page), sess!.numPages) }));
      } catch { if (alive) setLoadErr('This PDF could not be opened — it may be encrypted or damaged.'); }
    })();
    return () => { alive = false; sess?.destroy(); };
  }, [objId]);

  /* -- persist (debounced) + flush on close ----------------------------- */
  const persist = useCallback((state: ReaderState) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
    if (cur) updateObject(objId, { style: { ...cur.style, pdfReader: state } });
  }, [objId, updateObject]);
  /* Writing the reader's state back onto the board re-renders the whole canvas
     and touches IndexedDB. At 450ms that landed squarely between two turns of a
     book someone was reading at a normal pace — which is why the SECOND click of
     a pair could feel slower than the first. A page number can wait until you
     have actually stopped; nothing here is precious enough to fight a turn for.
     (Close still flushes immediately — see doClose.) */
  useEffect(() => { const t = setTimeout(() => persist(st), 1100); return () => clearTimeout(t); }, [st, persist]);
  const doClose = useCallback(() => { persist(st); closeReader(); }, [persist, st, closeReader]);

  /* -- ambience ----------------------------------------------------------- *
   * Off unless asked for: a reader that starts making noise on its own is a
   * reader you close. When it is on, the bed follows the room. */
  useEffect(() => {
    if (!st.sound) return undefined;
    const bed = getRoom(st.atmos).sound;
    if (!bed) return undefined;
    if (bed === 'rain') { startRain(); return () => stopRain(); }
    startAmbience(bed);
    return () => stopAmbience(bed);
  }, [st.atmos, st.sound]);

  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(''), 1700); }, []);

  /* The turn handler reads state through a ref: it is called from a keypress, a
     click, a corner and a swipe, and a stale `page` in any of those closures
     turns the wrong sheet. */
  const stRef = useRef(st);
  useEffect(() => { stRef.current = st; }, [st]);
  const animRef = useRef(false);
  /** The current page width, so a turn can warm the exact raster it will show. */
  const pageWRef = useRef(0);

  /**
   * Arm a leaf: make sure every page it will show exists as a bitmap, then start
   * the animation and the sound together. This is the fix for pages appearing
   * white mid-flight — a turn no longer races the rasteriser.
   */
  const warmLeaf = useCallback((leaf: Leaf): Promise<void> => {
    const w = pageWRef.current;
    if (!session || w <= 0) return Promise.resolve();
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    return session.warm([leaf.front, leaf.back, leaf.leftShown, leaf.rightShown], w, dpr);
  }, [session]);

  /**
   * Are the pages this turn will REVEAL already bitmaps? (No work, no await.)
   *
   * Only two of a leaf's four pages are new: the sheet's back face, and whichever
   * half it uncovers. Its front face and the half it leaves alone are the spread
   * you are already looking at, so they are warm by definition — asking about
   * them too only makes a warm turn look cold and wait for nothing.
   */
  const leafIsWarm = useCallback((leaf: Leaf) => {
    const w = pageWRef.current;
    if (!session || w <= 0) return false;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    const fresh = leaf.dir === 'next' ? [leaf.back, leaf.rightShown] : [leaf.back, leaf.leftShown];
    return fresh.every((n) => n < 1 || n > session.numPages || session.isRendered(n, w, dpr));
  }, [session]);

  /**
   * Write the sheet's position for this frame.
   *
   * Custom properties on the book element, not React state: the spread holds two
   * rasterised PDF canvases, and asking React to reconcile that tree on every
   * animation frame is exactly what makes a page turn feel expensive. The CSS in
   * pdf-reader.css reads these and does the rest.
   */
  const paintLeaf = useCallback((t: number, dir: 'next' | 'prev' = 'next') => {
    tRef.current = t;
    const el = bookElRef.current;
    if (!el) return;
    const f = leafFrame(t);
    el.style.setProperty('--t', String(t));
    el.style.setProperty('--bow', f.bow.toFixed(4));
    /* THE TILT. A book on a desk does not hold still while you turn a page —
       your hand is on the sheet, and the whole block rocks toward the side the
       page is coming from and settles back as it lands. Signed by direction and
       scaled by `bow`, so it peaks edge-on and is exactly zero at both ends: a
       turn can be interrupted, reversed or dragged and the book is always level
       wherever it stops. */
    el.style.setProperty('--tilt', (f.bow * (dir === 'next' ? 1 : -1)).toFixed(4));
    el.style.setProperty('--rock', f.bow.toFixed(4));
    el.style.setProperty('--sheen-front', f.sheenFront.toFixed(3));
    el.style.setProperty('--sheen-back', f.sheenBack.toFixed(3));
    el.style.setProperty('--cast-clear', f.castClear.toFixed(3));
    el.style.setProperty('--cast-fall', f.castFall.toFixed(3));
  }, []);

  /**
   * Rewinding the sheet to flat is a note-to-self, not a paint.
   *
   * THIS IS THE FLASH AT THE END OF A TURN. Landing used to write `--t: 0`
   * straight to the DOM in the same breath as `setTurning(null)` — but a direct
   * style write lands NOW and a React state change lands whenever React gets
   * round to it, which under concurrent rendering is a separate task, sometimes
   * after the browser has painted. For that one frame the sheet was still in the
   * DOM and had just been told it was flat, so it snapped back across the spine
   * showing its FRONT face — the page you had just turned away from — over a
   * spread that hadn't committed yet. A perfect flash of the previous page.
   *
   * So nothing outside the animation loop touches the DOM. `rewindLeaf` moves
   * only the number, and the layout effect below writes it in the same commit
   * that mounts or unmounts the sheet — after React's DOM mutations, before the
   * browser paints, so there is no frame in between for anything to show
   * through. Until then the landed sheet stays exactly where it landed, which is
   * already showing precisely what the committed spread is about to.
   */
  const rewindLeaf = useCallback(() => { tRef.current = 0; }, []);
  useIsomorphicLayoutEffect(() => {
    paintLeaf(tRef.current, turning?.leaf.dir || 'next');
  }, [turning, paintLeaf]);

  const stopRaf = useCallback(() => {
    if (turnRaf.current !== null) { cancelAnimationFrame(turnRaf.current); turnRaf.current = null; }
  }, []);

  /** Run `t` from where it is to `to`, then do something. Used by click-turns
      and by the release at the end of a drag, which is why a thrown page and a
      tapped one settle on the same curve.

      The clock starts on the first frame the browser actually hands back, NOT
      when this is called. Mounting a leaf is the most expensive frame of the
      whole turn — two fresh page canvases and their paper overlays — and timing
      from `performance.now()` here charged the animation for that work: the
      first painted frame arrived 30-odd ms in and the sheet was already a
      quarter turned, so every turn began with a jump. Now the expensive frame
      costs the turn nothing but its own duration, and the motion starts at 0. */
  const glideTo = useCallback((to: number, onDone: () => void, dir: 'next' | 'prev' = 'next', ms = LEAF_MS) => {
    stopRaf();
    const from = tRef.current;
    const span = to - from;
    if (Math.abs(span) < 0.001) { onDone(); return; }
    const dur = Math.max(70, ms * Math.abs(span));
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const k = clamp01((now - t0) / dur);
      paintLeaf(from + span * easeTurn(k), dir);
      if (k < 1) { turnRaf.current = requestAnimationFrame(step); }
      else { turnRaf.current = null; onDone(); }
    };
    turnRaf.current = requestAnimationFrame(step);
  }, [paintLeaf, stopRaf]);

  /* A click that arrives mid-turn is a reader going faster, not a mistake. The
     old code dropped it on the floor (`if (animRef.current) return`), which is
     why holding an arrow key felt like the book was ignoring you. One turn is
     remembered and fired the moment the current sheet lands. */
  const queued = useRef<'next' | 'prev' | null>(null);
  const turnRef = useRef<((d: 'next' | 'prev') => void) | null>(null);
  const turningRef = useRef<Turning | null>(null);
  useEffect(() => { turningRef.current = turning; }, [turning]);

  /**
   * The sheet a turn would lift, measured FROM AN EXPLICIT PAGE.
   *
   * Taking the page as an argument rather than reading it back out of state is
   * what makes a burst of clicks work: the queued turn is started from the page
   * the previous sheet just landed on, which React has not necessarily finished
   * committing yet. Reading state there gave the stale page, so the second turn
   * re-cut the leaf it had just finished and the book appeared to stop.
   */
  const leafFrom = useCallback((dir: 'next' | 'prev', from: number): Leaf | null => {
    const left = oddLeft(from);
    if (dir === 'next') {
      const target = left + 2;
      if (target > numPages) return null;
      return {
        dir, front: Math.min(left + 1, numPages), back: target,
        leftShown: left, rightShown: Math.min(target + 1, numPages), target,
      };
    }
    if (left <= 1) return null;
    const target = Math.max(1, left - 2);
    return {
      dir, front: left, back: Math.min(target + 1, numPages),
      leftShown: target, rightShown: Math.min(left + 1, numPages), target,
    };
  }, [numPages]);
  const leafFor = useCallback(
    (dir: 'next' | 'prev') => leafFrom(dir, stRef.current.page),
    [leafFrom],
  );

  const startLeafRef = useRef<((d: 'next' | 'prev', from: number, hurry?: boolean) => boolean) | null>(null);

  /** Land the sheet: commit the spread it was carrying and clear the leaf.
      The sheet is left lying where it landed — see `rewindLeaf`. */
  const settleLeaf = useCallback((leaf: Leaf) => {
    set({ page: leaf.target });
    setTurning(null);
    turningRef.current = null;
    rewindLeaf();
    const q = queued.current;
    queued.current = null;
    /* Straight on from the page we just landed on — no state round-trip. And
       faster: a queued turn only exists because the reader is already ahead of
       the book, so it gets the hurried duration. */
    if (q && !startLeafRef.current?.(q, leaf.target, true)) turnRef.current?.(q);
  }, [set, rewindLeaf]);

  /**
   * Cut a leaf and fly it. Returns false when there is no sheet to lift.
   *
   * The sheet is put on screen at t=0 straight away, and — when the pages it
   * needs are already bitmaps, which the prefetch normally sees to — the glide
   * starts in the same breath. `glideTo` spends its own first frame at t=0, so
   * the leaf is always painted flat once before it moves; there is no need to
   * sit out an extra frame for that, and doing so cost every single turn 16ms of
   * looking like it hadn't heard the click.
   *
   * The one thing worth waiting for is a page that isn't rasterised yet. pdf.js
   * rendering one mid-flight is tens of milliseconds of main thread and the
   * sheet stops dead in the air, which is far more noticeable than starting a
   * beat late. Capped, because a page that will not render must delay a turn,
   * never cancel it.
   */
  const startLeaf = useCallback((dir: 'next' | 'prev', from: number, hurry = false): boolean => {
    const leaf = leafFrom(dir, from);
    if (!leaf) return false;
    const ms = hurry ? LEAF_MS_HURRY : LEAF_MS;
    // The sound is cut to the length of the turn it belongs to. A 600ms swish
    // over a 265ms sheet is the page landing while you can still hear it move.
    try { playPageTurn(0.55, dir, ms / 1000); } catch { /* ignore */ }
    const next = { leaf, t: 0, dragging: false };
    setTurning(next);
    turningRef.current = next;
    /* Note only — the DOM write happens in the same commit that mounts this
       sheet. Doing it here would flatten the sheet that is still on screen. */
    rewindLeaf();

    const launch = () => {
      // Still ours? A drag or another turn may have taken the sheet meanwhile.
      if (turningRef.current?.leaf !== leaf || turningRef.current.dragging) return;
      glideTo(1, () => settleLeaf(leaf), leaf.dir, hurry ? LEAF_MS_HURRY : LEAF_MS);
    };
    if (leafIsWarm(leaf)) launch();
    else void Promise.race([warmLeaf(leaf), new Promise((r) => window.setTimeout(r, 120))]).then(launch);
    return true;
  }, [leafFrom, warmLeaf, leafIsWarm, rewindLeaf, glideTo, settleLeaf]);
  useEffect(() => { startLeafRef.current = startLeaf; }, [startLeaf]);

  /* -- navigation -------------------------------------------------------- */
  const go = useCallback((n: number) => {
    if (!numPages) return;
    setAnim(null);
    setPhase('open');
    set({ page: Math.min(Math.max(1, n), numPages) });
  }, [numPages, set]);

  /* -- turning a page ------------------------------------------------------ *
   * The flipbook's whole feel lives in this function, so it is worth being
   * precise about what was wrong before: it committed the new page number and
   * started the animation in the SAME tick. The spread underneath therefore
   * repainted to the destination immediately — you saw the new pages, and only
   * then a sheet swung across them for no reason. That's the flash.
   *
   * A real turn is: nothing changes yet; a single sheet lifts, carrying the page
   * you were reading on its front and the page you're going to on its back;
   * whatever is revealed behind it becomes visible as it rises; and only when
   * the sheet lands does the book commit to the new spread. Since the landed
   * sheet's back face is showing exactly what the committed spread will show,
   * the swap at the end is invisible.
   *
   * The other half of it is that no page may be blank while it moves, so the
   * four pages a turn needs are rasterised BEFORE the animation is armed (and
   * usually already warm — see the prefetch effect below).
   */
  const turn = useCallback((dir: 'next' | 'prev') => {
    if (!numPages) return;
    const s = stRef.current;                                // freshest state, no stale closure
    if (s.layout !== 'book') {
      const target = dir === 'next' ? s.page + 1 : s.page - 1;
      if (target < 1 || target > numPages) return;
      try { playPageTurn(0.25, dir, 0.26); } catch { /* ignore */ }
      set({ page: target });
      return;
    }
    // A cover swing owns the whole book while it runs; nothing may cut in.
    if (animRef.current) return;

    /* A sheet is already in the air. If the reader is holding it, leave them
       alone. Otherwise remember this press and let the current one land — the
       book keeps up instead of eating the input. */
    const live = turningRef.current;
    if (live) {
      if (!live.dragging) queued.current = dir;
      return;
    }

    const start = (a: BookAnim, ms: number, done: () => void) => {
      animRef.current = true;
      setAnim(a);
      if (animTimer.current) window.clearTimeout(animTimer.current);
      animTimer.current = window.setTimeout(() => {
        animRef.current = false;
        setAnim(null);
        done();
      }, ms);
    };

    // The covers, which are still a plain timed swing — they have no midpoint
    // worth exposing and nothing to drag.
    if (dir === 'next' && phase === 'front') {
      try { playCoverOpen(); } catch { /* ignore */ }
      start({ kind: 'cover', dir: 'open' }, COVER_MS, () => setPhase('open'));
      return;
    }
    if (dir === 'next' && phase === 'back') return;
    if (dir === 'prev' && phase === 'back') {
      try { playCoverOpen(); } catch { /* ignore */ }
      start({ kind: 'back', dir: 'close' }, COVER_MS, () => setPhase('open'));
      return;
    }
    if (dir === 'prev' && phase === 'front') return;

    if (!startLeaf(dir, s.page)) {
      // Out of paper in that direction — close onto the board instead.
      try { playCoverClose(); } catch { /* ignore */ }
      if (dir === 'next') start({ kind: 'back', dir: 'open' }, COVER_MS, () => setPhase('back'));
      else start({ kind: 'cover', dir: 'close' }, COVER_MS, () => setPhase('front'));
    }
  }, [numPages, phase, set, startLeaf]);

  useEffect(() => { turnRef.current = turn; }, [turn]);

  /* -- taking hold of a corner --------------------------------------------- *
   * The thing every real flipbook does and this one could not: pull the page.
   *
   * A drag sets `t` straight from the pointer, so the sheet tracks your hand
   * exactly — including backwards, if you change your mind. Letting go past
   * DRAG_COMMIT finishes the turn on the same curve a click uses; short of it,
   * the page falls back and nothing happened.
   */
  const dragRef = useRef<null | { leaf: Leaf; x0: number; span: number }>(null);

  const beginDrag = useCallback((dir: 'next' | 'prev', e: React.PointerEvent) => {
    if (!numPages || stRef.current.layout !== 'book') return;
    /* A press while a sheet is already in the air is someone reading faster.
       Hand it to `turn`, which queues it — bailing out here is what made the
       book ignore every click but the first of a burst. */
    if (animRef.current || turningRef.current) { turnRef.current?.(dir); return; }
    const leaf = phase === 'open' ? leafFor(dir) : null;
    if (!leaf) {
      /* Nothing to peel — the cover, or the far end of the book. Those are
         board swings, not sheets, so hand it to the ordinary turn. */
      turnRef.current?.(dir);
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    void warmLeaf(leaf);
    // Pulling across roughly one page width is a whole turn.
    const span = Math.max(120, pageWRef.current || 300);
    dragRef.current = { leaf, x0: e.clientX, span };
    const next = { leaf, t: 0, dragging: true };
    setTurning(next);
    turningRef.current = next;
    rewindLeaf();
  }, [numPages, phase, leafFor, warmLeaf, rewindLeaf]);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const travelled = d.leaf.dir === 'next' ? d.x0 - e.clientX : e.clientX - d.x0;
    paintLeaf(clamp01(travelled / d.span), d.leaf.dir);
  }, [paintLeaf]);

  /* Letting go. A corner that was pressed but never pulled (t is still ~0) is
     just a click, and turns the page in full — so tapping and dragging are the
     same one mechanism rather than two that can disagree. Past DRAG_COMMIT the
     turn completes; short of it the sheet falls back and nothing happened. */
  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const t = tRef.current;
    const tapped = t < 0.02;
    const live = turningRef.current;
    if (live) { const nxt = { ...live, dragging: false }; turningRef.current = nxt; setTurning(nxt); }
    if (tapped || t >= DRAG_COMMIT) {
      try { playPageTurn(tapped ? 0.55 : 0.4 + t * 0.4, d.leaf.dir, (LEAF_MS * (1 - t)) / 1000); } catch { /* ignore */ }
      glideTo(1, () => settleLeaf(d.leaf), d.leaf.dir);
    } else {
      glideTo(0, () => { setTurning(null); turningRef.current = null; rewindLeaf(); }, d.leaf.dir);
    }
  }, [glideTo, settleLeaf, rewindLeaf]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  useEffect(() => () => { if (animTimer.current) window.clearTimeout(animTimer.current); }, []);

  /* -- opening the covers -------------------------------------------------- */
  useEffect(() => {
    if (!session || !sound) return;
    try { playSpineCreak(); } catch { /* ignore */ }
  }, [session, sound]);

  /**
   * Switching view.
   *
   * The flipbook starts CLOSED on a document you haven't read yet — cover first,
   * which is the point of a book. Come back to page 40 and it opens straight to
   * page 40 rather than making you turn the cover again. Deciding that here,
   * where the layout actually changes, rather than in an effect watching for it,
   * keeps it out of a cascading render.
   */
  const setLayout = useCallback((l: Layout) => {
    // Plain values only in here, no refs: this is handed to `once()` during
    // render, and reading a ref from something called at render time is exactly
    // the pattern React 19's lint (rightly) refuses.
    if (l === 'book') {
      setAnim(null);
      setPhase(st.page <= 1 ? 'front' : 'open');
    }
    set({ layout: l });
  }, [set, st.page]);

  /* Leaving zen always brings the furniture straight back. */
  const setZen = useCallback((on: boolean) => {
    setChrome(!on);
    set({ zen: on });
    try {
      if (on) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          void document.documentElement.requestFullscreen().catch(() => { /* ignore */ });
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          void document.exitFullscreen().catch(() => { /* ignore */ });
        }
      }
    } catch {
      /* ignore browser restriction */
    }
  }, [set]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && stRef.current.zen) {
        setChrome(true);
        set({ zen: false });
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT';
      if (typing) return;
      if (e.key === 'Escape') {
        if (lookup) setLookup(null);
        else if (roomOpen || typeOpen) { setRoomOpen(false); setTypeOpen(false); }
        else if (st.zen) setZen(false);
        else doClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); turn('next'); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn('prev'); }
      else if (e.key === 'h' || e.key === 'H') setZen(!st.zen);
      else if (e.key === 'f' || e.key === 'F') setLayout(st.layout === 'typeset' ? 'scroll' : 'typeset');
      else if (e.key === 'b' || e.key === 'B') toggleBookmarkRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, doClose, roomOpen, typeOpen, lookup, st.zen, st.layout, set, setZen]);

  /* -- a toolbar that gets out of the way ---------------------------------- *
   * Hidden means hidden. The dock comes back when the pointer enters the band
   * of screen it lives in — the bottom ~120px — and goes away again when the
   * pointer leaves. Nothing else reveals it, which is the whole point: the old
   * version woke on any movement at all, so it never actually hid. */
  useEffect(() => {
    if (!st.zen) return undefined;
    const onMove = (e: PointerEvent) => setChrome(e.clientY > window.innerHeight - 132);
    const onLeave = () => setChrome(false);
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    return () => { window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); };
  }, [st.zen]);

  const [win, setWin] = useState({ w: 1200, h: 800 });
  useEffect(() => { const on = () => setWin({ w: window.innerWidth, h: window.innerHeight }); on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const pageAspect = usePageAspect(session, st.page);
  const bookAspect = useBookAspect(session);
  /* Scroll and typeset fit the page you're on; the flipbook fits the BOOK, and
     never moves once it has. See useBookAspect. */
  const aspect = st.layout === 'book' ? bookAspect : pageAspect;

  /* -- what's in front of you, as prose ------------------------------------ *
   * Both the typeset view and read-aloud want the same thing: what you can
   * currently see, as paragraphs and then sentences. Do it once.
   *
   * IN THE FLIPBOOK THAT IS A SPREAD, NOT A PAGE. `st.page` is normalised to the
   * odd left-hand page (oddLeft), so reading `st.page` alone read the left page,
   * announced itself finished, and turned the sheet — which advances by TWO —
   * so every right-hand page in the book went unread. A spread is one thing you
   * look at; it is one thing to read out, left page then right. */
  const readPages = useMemo(() => {
    if (!numPages) return [] as number[];
    if (st.layout !== 'book') return [st.page];
    const l = oddLeft(st.page);
    return l + 1 <= numPages ? [l, l + 1] : [l];
  }, [st.layout, st.page, numPages]);
  const readKey = readPages.join(',');

  const [prose, setProse] = useState<{ key: string; paras: string[][] } | null>(null);
  const needProse = st.layout === 'typeset' || speech.on;
  useEffect(() => {
    if (!session || !needProse || !readPages.length) return undefined;
    let alive = true;
    Promise.all(readPages.map((n) => session.pageText(n).catch(() => ({ lines: [] as string[], text: '' }))))
      .then((all) => {
        if (!alive) return;
        // Paragraphs are found per page — a page boundary ends one, and running
        // two pages' lines together would glue the last line of the left page to
        // the first of the right.
        setProse({ key: readKey, paras: all.flatMap((t) => toParagraphs(t.lines)).map(toSentences) });
      })
      .catch(() => { if (alive) setProse({ key: readKey, paras: [] }); });
    return () => { alive = false; };
  }, [session, needProse, readPages, readKey]);
  const proseReady = prose?.key === readKey;
  const sentences = useMemo(() => (proseReady ? prose!.paras.flat() : []), [prose, proseReady]);

  /* -- read aloud ---------------------------------------------------------- */
  const onPageEnd = useCallback(() => turn('next'), [turn]);
  /* "Is there more after this?" — after a SPREAD in the flipbook, after a page
     anywhere else. Asking `st.page < numPages` on the last spread said yes, then
     the turn found no sheet to lift and closed the back board instead, leaving
     the voice waiting on a page that was never going to change. */
  const hasNextPage = st.layout === 'book' ? oddLeft(st.page) + 2 <= numPages : st.page < numPages;
  useReadAloud({ speech, setSpeech, sentences, ready: proseReady, voices, hasNextPage, onPageEnd });

  /* -- look a word up ------------------------------------------------------ */
  const lookUp = useCallback(async (word: string, x: number, y: number) => {
    setLookup({ word, x, y, loading: true });
    try {
      const res = await fetch(`/api/dictionary?word=${encodeURIComponent(word)}`);
      const data = await res.json();
      if (!res.ok) { setLookup({ word, x, y, loading: false, error: data?.error || 'No definition found' }); return; }
      const defs = (data.meanings || []).slice(0, 3).flatMap((m: { partOfSpeech: string; definitions?: { definition: string }[] }) =>
        (m.definitions || []).slice(0, 2).map((d) => ({ pos: m.partOfSpeech, text: d.definition })));
      setLookup({ word: data.word || word, x, y, loading: false, phonetic: data.phonetic, defs });
    } catch {
      setLookup({ word, x, y, loading: false, error: 'Could not reach the dictionary' });
    }
  }, []);

  const onStageClick = useCallback((e: React.MouseEvent) => {
    if (roomOpen || typeOpen) { setRoomOpen(false); setTypeOpen(false); return; }
    if (!define) return;
    const w = wordAtPoint(e.clientX, e.clientY);
    if (w && w.length > 1) void lookUp(w, e.clientX, e.clientY);
  }, [define, lookUp, roomOpen, typeOpen]);

  /* -- annotation mutations ---------------------------------------------- */
  const addHighlight = useCallback((page: number, h: Omit<Highlight, 'id' | 'page'>) => setSt((s) => ({ ...s, highlights: [...s.highlights, { id: uid(), page, ...h }] })), []);
  const delHighlight = useCallback((id: string) => setSt((s) => ({ ...s, highlights: s.highlights.filter((h) => h.id !== id) })), []);
  const addStroke = useCallback((page: number, pts: number[][], color: string, size: number) => setSt((s) => ({ ...s, drawings: [...s.drawings, { id: uid(), page, pts, color, size }] })), []);
  const delStroke = useCallback((id: string) => setSt((s) => ({ ...s, drawings: s.drawings.filter((d) => d.id !== id) })), []);
  const addSticky = useCallback((page: number, x: number, y: number, color: string) => setSt((s) => ({ ...s, stickies: [...s.stickies, { id: uid(), page, x, y, w: 150, h: 104, text: '', color, rot: rand(-4, 4) }] })), []);
  const editSticky = useCallback((id: string, patch: Partial<Sticky>) => setSt((s) => ({ ...s, stickies: s.stickies.map((n) => n.id === id ? { ...n, ...patch } : n) })), []);
  const delSticky = useCallback((id: string) => setSt((s) => ({ ...s, stickies: s.stickies.filter((n) => n.id !== id) })), []);
  const toggleBookmark = useCallback((page: number) => setSt((s) => {
    const on = s.bookmarks.includes(page);
    /* Paper sounds are gestural feedback, like a click — they answer something
       you just did, so they are not tied to the room's ambient bed the way they
       used to be. (That gate is also why the page turn used to fall back to a
       WIND WHOOSH, of all things, for anyone reading in silence.) */
    try { playPaperSettle(); } catch { /* ignore */ }
    return { ...s, bookmarks: on ? s.bookmarks.filter((b) => b !== page) : [...s.bookmarks, page].sort((a, b) => a - b) };
  }), []);
  useEffect(() => { toggleBookmarkRef.current = () => toggleBookmark(st.page); }, [toggleBookmark, st.page]);

  const onStageMouseUp = useCallback(() => {
    if (!clip) return;
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    const o = useCanvasStore.getState().objects.find((x) => x.id === objId);
    addObject({ type: 'text', x: (o?.x || 0) + (o?.width || 300) + 60, y: (o?.y || 0) + 40, width: 340, height: 170, content: sel });
    try { playSnap(); } catch { /* ignore */ }
    window.getSelection()?.removeAllRanges();
    flash('Clipped to board ✂');
  }, [clip, addObject, flash, objId]);

  /* -- page sizing (fit fully; no zoom) ---------------------------------- */
  const sizing = useMemo(() => {
    const availH = Math.max(300, win.h - (st.zen ? 16 : st.strip ? 220 : 116));
    const availW = Math.max(320, win.w - (st.zen ? 24 : 80));
    if (st.layout === 'book') return { pageW: Math.max(200, Math.min((availH - (st.zen ? 12 : 40)) / aspect, (availW - (st.zen ? 32 : 96)) / 2)) };
    return { pageW: Math.max(280, Math.min(availH / aspect, availW * (st.zen ? 0.98 : 0.94))) };
  }, [win, aspect, st.layout, st.strip, st.zen]);

  useEffect(() => { pageWRef.current = sizing.pageW; }, [sizing]);

  /* Warm the pages either side of the spread while nothing is happening. A turn
     then starts on the frame you clicked, which is the difference between a
     flipbook that feels physical and one that feels like a web page. */
  useEffect(() => {
    if (!session || st.layout !== 'book' || !sizing.pageW) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    const left = oddLeft(st.page);
    const t = window.setTimeout(() => {
      void session.warm([left, left + 1, left + 2, left + 3, left + 4, left + 5, left - 1, left - 2, left - 3], sizing.pageW, dpr);
    }, 40);
    return () => window.clearTimeout(t);
  }, [session, st.page, st.layout, sizing.pageW]);

  const bookmarked = st.bookmarks.includes(st.page);
  const room = getRoom(st.atmos);
  const stripShown = st.strip && !st.zen && st.layout !== 'typeset';
  const isBook = st.layout === 'book';
  /** What's stamped on the cover: the document's own name, tidied up. */
  const docTitle = useMemo(() => {
    const o = useCanvasStore.getState().objects.find((x) => x.id === objId);
    const raw = ((o?.style?.fileName as string) || 'Untitled').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    return raw.length > 64 ? `${raw.slice(0, 63)}…` : raw || 'Untitled';
  }, [objId]);
  const paper = paperOf(st.typo.paper);

  /* Walking into a room announces itself, then gets out of the way. */
  const enterRoom = useCallback((r: typeof room) => {
    set({ atmos: r.key });
    setCard({ label: r.label, blurb: r.blurb });
    window.setTimeout(() => setCard((c) => (c && c.label === r.label ? null : c)), 2600);
  }, [set]);

  /* The paper this book is printed on. `aged` is the switch, `age` is which
     paper — memoised so a page's marks aren't regenerated on every render of
     the reader (they're pure, but the object identity is what `AgedPaper`
     memoises on). */
  const ageCfg = useMemo<AgeCfg>(
    () => (st.aged ? st.age : { preset: 'off', amount: st.age.amount }),
    [st.aged, st.age],
  );

  const pageProps = {
    session, tool, hlColor, penColor, penSize, stickyColor, age: ageCfg,
    highlights: st.highlights, drawings: st.drawings, stickies: st.stickies,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky,
  };

  /* Where the light is allowed to land. Re-measured when the layout, the page,
     the book's phase or the window changes — all four move the paper. */
  const lightZone = useLightZone(st.ruler, [st.layout, st.page, phase, sizing.pageW, st.zen, stripShown]);

  const toolRow = tool === 'highlight'
    ? <SwatchRow colors={HL_COLORS} value={hlColor} onPick={setHlColor} />
    : tool === 'draw'
      ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><SwatchRow colors={PEN_COLORS} value={penColor} onPick={setPenColor} /><input className="pdfr-range" style={{ width: 96 }} type="range" min={2} max={14} step={1} value={penSize} onChange={(e) => setPenSize(parseInt(e.target.value))} /></div>
      : tool === 'sticky'
        ? <SwatchRow colors={STICKY_COLORS} value={stickyColor} onPick={setStickyColor} />
        : tool === 'eraser'
          ? <span style={{ fontSize: 11, opacity: 0.72, padding: '0 6px' }}>Tap a highlight, ink stroke or note to remove it.</span>
          : null;

  return (
    <div className="pdfr-root" data-atmos={st.atmos} data-aged={st.aged ? '1' : '0'} data-tool={tool}
      data-focus={st.ruler ? '1' : '0'}
      data-chrome={chrome ? '1' : '0'} data-zen={st.zen ? '1' : '0'} onMouseUp={onStageMouseUp}
      style={{
        ['--accent' as string]: room.accent, ['--glow' as string]: String(room.glow ?? 0.4), color: room.ink || '#f4ece0',
        ['--paper' as string]: paper.bg, ['--ink' as string]: paper.ink, ['--sel' as string]: paper.sel,
        ['--bookfont' as string]: fontCss(st.typo.font),
      }}>
      <RoomScene atmos={st.atmos} />

      <div className="pdfr-close" title="Close (Esc)" onClick={doClose}><Ico d={I.close} s={17} /></div>

      <div className="pdfr-zenhint">move to the bottom for the toolbar · H to bring it back for good</div>

      {card && (
        <div className="pdfr-roomcaption" key={card.label}>
          <div className="t">{card.label}</div>
          <div className="b">{card.blurb}</div>
        </div>
      )}

      {/* stage */}
      <div className="pdfr-stage" data-define={define ? '1' : '0'}
        style={{ position: 'absolute', inset: 0, top: st.zen ? 0 : 14, bottom: st.zen ? 0 : stripShown ? 190 : 82, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: st.zen ? '4px 8px' : '10px 22px', zIndex: 5 }}
        onClick={onStageClick}
        /* Pointer, not mouse. A touchscreen never sends a mousemove for a
           travelling finger, so on a phone or a tablet every one of these
           lights sat frozen at the middle of the page — the one place you are
           not reading. `pointermove` is the same event for a mouse and adds
           the finger and the pen for nothing. */
        onPointerMove={st.ruler ? (e) => {
          setFocusY(e.clientY / Math.max(1, window.innerHeight));
          setFocusX(e.clientX / Math.max(1, window.innerWidth));
        } : undefined}>
        {loadErr ? (
          <div className="pdfr-loading"><div style={{ fontSize: 15, fontWeight: 600 }}>{loadErr}</div><button className="pdfr-btn active" onClick={doClose}>Close</button></div>
        ) : !session ? (
          <div className="pdfr-loading"><div className="pdfr-spin" /><div>Opening your PDF…</div></div>
        ) : st.layout === 'typeset' ? (
          <Typeset paras={proseReady ? prose!.paras : null} typo={st.typo} width={win.w} speaking={speech.on ? speech.idx : -1} age={ageCfg} />
        ) : st.layout === 'book' ? (
          <BookView {...pageProps} page={st.page} numPages={numPages} pageW={sizing.pageW} aspect={aspect}
            phase={phase} anim={anim} turning={turning} onTurn={turn} title={docTitle}
            bookRef={bookElRef} onCornerDown={beginDrag} onCornerMove={moveDrag} onCornerUp={endDrag}
            bookmarks={st.bookmarks} onScrub={go} onUnmark={toggleBookmark} />
        ) : (
          <div style={{ position: 'relative' }} data-lightzone><Page {...pageProps} page={st.page} width={sizing.pageW} interactive bookmarked={bookmarked} onUnmark={toggleBookmark} /></div>
        )}
      </div>

      {/* Focus overlay — eleven reading lights, see FOCUS_MODES.
          Two pieces: the ROOM goes dark, and the light lands on the PAPER. The
          veil sits under the stage so it darkens the room and the desk without
          touching the page; the overlay sits over the page and is positioned on
          it, so nothing spills onto the furniture. */}
      {st.ruler && lightZone && (
        <div
          className="pdfr-focus-room"
          aria-hidden
          style={{
            ['--zx' as string]: `${lightZone.left}px`,
            ['--zy' as string]: `${lightZone.top}px`,
            ['--zw' as string]: `${lightZone.width}px`,
            ['--zh' as string]: `${lightZone.height}px`,
            ['--focus-dim' as string]: String(st.focusMode === 'tint' ? Math.min(0.45, st.focusDarkness) : st.focusDarkness),
          }}
        />
      )}
      {st.ruler && (
        <FocusOverlay
          mode={st.focusMode} dim={st.focusDarkness} size={st.focusSize}
          steady={st.focusSteady} tint={st.focusTint} x={focusX} y={focusY} zone={lightZone}
          /* In book mode a ruler stays on the page you are reading. The spine
             sits at ~50% of the stage, so a cursor past it clips the card to
             that half instead of laying it across both pages at once. */
          clipLeft={isBook && st.focusMode === 'ruler' && focusX > 0.52}
          clipRight={isBook && st.focusMode === 'ruler' && focusX < 0.48}
        />
      )}

      {lookup && <DefineCard {...lookup} onClose={() => setLookup(null)} />}

      {/* the pens, and whatever the chosen one needs */}
      {annot && (
        <div className="pdfr-toolbar" style={{ bottom: stripShown ? 188 : 80 }}>
          <button className={`pdfr-btn ${tool === 'highlight' ? 'active' : ''}`} title="Highlighter" onClick={once(() => setTool(tool === 'highlight' ? 'none' : 'highlight'))}><Ico d={I.hl} s={15} /></button>
          <button className={`pdfr-btn ${tool === 'draw' ? 'active' : ''}`} title="Draw / ink" onClick={once(() => setTool(tool === 'draw' ? 'none' : 'draw'))}><Ico d={I.draw} s={15} /></button>
          <button className={`pdfr-btn ${tool === 'sticky' ? 'active' : ''}`} title="Sticky note" onClick={once(() => setTool(tool === 'sticky' ? 'none' : 'sticky'))}><Ico d={I.sticky} s={15} /></button>
          <button className={`pdfr-btn ${tool === 'eraser' ? 'active' : ''}`} title="Eraser" onClick={once(() => setTool(tool === 'eraser' ? 'none' : 'eraser'))}><Ico d={I.eraser} s={15} /></button>
          <button className={`pdfr-btn ${clip ? 'active' : ''}`} title="Clip: select text to send it to the board" onClick={once(() => setClip(!clip))}><Ico d={I.clip} s={15} /></button>
          {toolRow && <><div className="pdfr-sep" />{toolRow}</>}
        </div>
      )}

      {/* the one dock */}
      <div className="pdfr-dock">
        <button className="pdfr-btn" title="Previous" disabled={isBook ? phase === 'front' : st.page <= 1} onClick={() => turn('prev')}><Ico d={I.prev} s={16} /></button>
        <div className="pdfr-count">
          {isBook && phase === 'front' ? <span>cover</span>
            : isBook && phase === 'back' ? <span>the end</span>
              : <>{isBook ? oddLeft(st.page) : st.page} <span>/ {numPages || '—'}</span></>}
        </div>
        <button className="pdfr-btn" title="Next" disabled={isBook ? phase === 'back' : st.page >= numPages} onClick={() => turn('next')}><Ico d={I.next} s={16} /></button>
        <div className="pdfr-sep" />
        <div className="pdfr-seg">
          <button className={`pdfr-btn ${st.layout === 'scroll' ? 'active' : ''}`} title="Page view — the PDF as printed" onClick={once(() => setLayout('scroll'))}><Ico d={I.scroll} s={15} /></button>
          <button className={`pdfr-btn ${st.layout === 'book' ? 'active' : ''}`} title="Flipbook — a real book you turn, cover and all" onClick={once(() => setLayout('book'))}><Ico d={I.book} s={15} /></button>
          <button className={`pdfr-btn ${st.layout === 'typeset' ? 'active' : ''}`} title="Typeset — reflow it in your own font (F)" onClick={once(() => setLayout('typeset'))}><Ico d={I.typeset} s={15} /></button>
        </div>
        {/* Aged paper belongs on the toolbar, not buried in the rooms drawer:
            it's a property of the BOOK, and you reach for it while looking at
            the page. */}
        {/* Turning it ON opens the drawer it is configured in — there are five
            papers behind this button now, and a toggle that silently picks one
            of them is a feature nobody finds. Turning it off just turns it
            off. */}
        <button className={`pdfr-btn ${st.aged ? 'active' : ''}`}
          title={st.aged ? `Old paper: ${agePresetOf(st.age.preset).label} — click for crisp` : 'Old paper — foxed, stained, five ages of it'}
          onClick={once(() => {
            const on = !st.aged;
            set({ aged: on });
            if (on) { setTypeJump(true); setTypeOpen(true); setRoomOpen(false); setFocusOpen(false); }
          })}><Ico d={I.aged} s={15} /></button>
        <button className={`pdfr-btn ${typeOpen ? 'active' : ''}`} title="Typography — the font, the size, the paper" onClick={once(() => { setTypeJump(false); setTypeOpen(!typeOpen); setRoomOpen(false); setFocusOpen(false); })}><Ico d={I.type} s={15} /></button>
        <button className={`pdfr-btn ${roomOpen ? 'active' : ''}`} title="Reading room" onClick={once(() => { setRoomOpen(!roomOpen); setTypeOpen(false); setFocusOpen(false); })}><Ico d={I.room} s={15} /> {room.label}</button>
        {room.sound && (
          <button className={`pdfr-btn ${st.sound ? 'active' : ''}`} title={st.sound ? 'Mute the room' : 'Let the room be heard'} onClick={once(() => set({ sound: !st.sound }))}>
            <Ico d={st.sound ? I.sound : I.mute} s={15} />
          </button>
        )}
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${speech.on ? 'active' : ''}`} title={speech.on ? 'Stop reading aloud' : 'Read this page aloud'}
          onClick={once(() => setSpeech((sp) => ({ ...sp, on: !sp.on, paused: false, idx: sp.on ? 0 : sp.idx })))}><Ico d={I.speak} s={15} /></button>
        <button className={`pdfr-btn ${define ? 'active' : ''}`} title="Tap any word for its meaning" onClick={once(() => { setDefine(!define); setLookup(null); })}><Ico d={I.define} s={15} /></button>
        <button className={`pdfr-btn ${st.ruler ? 'active' : ''}`} title="Reading focus — light to read by" onClick={once(() => {
          /* Three states, one button, in the order you want them: off → on with
             the picker open → on with the picker shut → off. Before, closing
             the picker also blew the light out, so you could not have the light
             without the panel sitting over the page you were reading. */
          if (!st.ruler) { set({ ruler: true }); setFocusOpen(true); setRoomOpen(false); setTypeOpen(false); }
          else if (focusOpen) setFocusOpen(false);
          else set({ ruler: false });
        })}><Ico d={I.focusMenu} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${bookmarked ? 'active' : ''}`} title="Bookmark this page (B)" onClick={once(() => toggleBookmark(st.page))}><Ico d={I.bookmark} s={15} /></button>
        <button className={`pdfr-btn ${annot || tool !== 'none' ? 'active' : ''}`} title="Mark up the page" onClick={once(() => { setAnnot(!annot); if (annot) setTool('none'); })}><Ico d={I.draw} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${st.strip ? 'active' : ''}`} title="Thumbnails" onClick={once(() => set({ strip: !st.strip }))}><Ico d={I.strip} s={15} /></button>
        <button className={`pdfr-btn ${st.zen ? 'active' : ''}`} title="Hide the toolbar — it comes back when you reach for it (H)" onClick={once(() => setZen(!st.zen))}><Ico d={I.zen} s={15} /></button>
      </div>

      {speech.on && (
        <SpeakBar speech={speech} setSpeech={setSpeech} voices={voices} bottom={stripShown ? 236 : 128}
          total={sentences.length} text={sentences[speech.idx]} />
      )}

      {typeOpen && (
        <TypePanel typo={st.typo} onChange={(t) => set({ typo: { ...st.typo, ...t } })} onClose={() => setTypeOpen(false)}
          layout={st.layout} onTypeset={() => setLayout('typeset')}
          aged={st.aged} age={st.age} jumpToPaper={typeJump}
          onAgedChange={(v) => set({ aged: v })}
          onAgeChange={(a) => set({ age: { ...st.age, ...a } })} />
      )}

      {focusOpen && st.ruler && (
        <FocusPanel
          mode={st.focusMode}
          darkness={st.focusDarkness}
          size={st.focusSize}
          steady={st.focusSteady}
          tint={st.focusTint}
          onModeChange={(m) => set({ focusMode: m })}
          onDarknessChange={(d) => set({ focusDarkness: d })}
          onSizeChange={(v) => set({ focusSize: v })}
          onSteadyChange={(v) => set({ focusSteady: v })}
          onTintChange={(t) => set({ focusTint: t })}
          onClose={() => setFocusOpen(false)}
        />
      )}

      {roomOpen && (
        <div className="pdfr-drawer" onClick={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
          <div className="head">
            <div>
              <h3>Rooms</h3>
              <p>Somewhere to read this. {ROOMS.length} of them — the light, the weather and the furniture change, the page doesn&apos;t.</p>
            </div>
            <div className="x" title="Close" onClick={() => setRoomOpen(false)}><Ico d={I.close} s={15} /></div>
          </div>

          <div className="pdfr-tabs">
            {(['All', ...ROOM_GROUPS] as const).map((g) => (
              <button key={g} className={`pdfr-tab ${roomTab === g ? 'active' : ''}`} onClick={() => setRoomTab(g)}>{g}</button>
            ))}
          </div>

          <div className="body">
            {ROOM_GROUPS.filter((g) => roomTab === 'All' || roomTab === g).map((g) => (
              <div key={g}>
                <h4>{g}</h4>
                <div className="pdfr-grid">
                  {ROOMS.filter((r) => r.group === g).map((r) => (
                    <div key={r.key} className={`pdfr-roomcard ${st.atmos === r.key ? 'active' : ''}`} title={r.blurb} onClick={() => enterRoom(r)}>
                      <RoomPreview atmos={r.key} />
                      <div className="cap">
                        <span className="dot" />{r.label}
                        {r.sound && <Ico d={I.sound} s={11} />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* "Page Turn Physics — ⚡ Fast / 📖 Curl / 🚀 Glide" used to sit here.
              Three settings for one gesture, where two were near-identical
              rotations and the third ("Glide") slid the page sideways and did
              not look like a book at all. A flipbook should turn correctly, not
              ask which kind of correct you would like. There is one turn now,
              and you can pull it with the corner. */}
          <div className="foot" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`pdfr-btn ${st.sound ? 'active' : ''}`} onClick={once(() => set({ sound: !st.sound }))} title={room.sound ? '' : 'This room is a quiet one'}>
                <Ico d={st.sound ? I.sound : I.mute} s={14} /> Ambient sound {st.sound ? 'on' : 'off'}
              </button>
              <button className={`pdfr-btn ${st.aged ? 'active' : ''}`}
                title="Which paper, and how worn, lives in Typography"
                onClick={once(() => set({ aged: !st.aged }))}>
                <Ico d={I.aged} s={14} /> {st.aged ? agePresetOf(st.age.preset).label : 'Old'} paper
              </button>
            </div>
          </div>
        </div>
      )}

      {stripShown && session && <Filmstrip session={session} page={st.page} bookmarks={st.bookmarks} onJump={go} />}

      {toast && <div style={{ position: 'absolute', bottom: stripShown ? 236 : 128, left: '50%', transform: 'translateX(-50%)', zIndex: 40, padding: '8px 16px', borderRadius: 999, background: 'rgba(20,17,14,0.92)', border: '1px solid rgba(255,255,255,0.14)', fontSize: 12, fontWeight: 600 }}>{toast}</div>}
    </div>
  );
}

/* ------------------------------- typeset -------------------------------- */
/**
 * The page, reflowed and set in the reader's own typography. This is the only
 * view where the *reader* decides the font, the size, the measure and the
 * paper — a PDF's own layout is fixed at whatever the publisher chose, which is
 * usually 11pt on A4 and miserable on a screen.
 *
 * The measure is in characters (`ch`), not pixels, because the thing that makes
 * a line comfortable is how many characters are on it — 60–75 — and that has to
 * hold whatever font and size you pick.
 */
function Typeset({ paras, typo, width, speaking, age }: { paras: string[][] | null; typo: Typo; width: number; speaking: number; age: AgeCfg }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [paras]);
  useEffect(() => {
    if (speaking < 0) return;
    ref.current?.querySelector('.spoken')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [speaking]);

  // Where each paragraph starts in the flat run of sentences — read-aloud
  // highlights by that index, and it has to survive a re-render unchanged.
  const starts = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const p of paras || []) { out.push(at); at += p.length; }
    return out;
  }, [paras]);

  if (!paras) return <div className="pdfr-loading"><div className="pdfr-spin" /><div>Setting the type…</div></div>;
  if (!paras.length) {
    return (
      <div className="pdfr-loading" style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No text on this page</div>
        <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.5 }}>It is probably a scan or an illustration. Page view will show it as printed.</div>
      </div>
    );
  }

  return (
    <div className="pdfr-typeset" ref={ref} data-lightzone style={{
      fontFamily: 'var(--bookfont)', fontSize: typo.size, lineHeight: typo.leading,
      maxWidth: `min(${typo.measure}ch, ${Math.max(320, width - 120)}px)`,
      textAlign: typo.justify ? 'justify' : 'left',
      hyphens: typo.justify ? 'auto' : undefined,
    }}>
      {/* The reflowed column is paper too — it takes the same marks the printed
          page does, on a sheet of its own rather than page 1's. */}
      <AgedPaper page={0} cfg={age} />
      {paras.map((sentences, pi) => (
        <p key={pi}>
          {sentences.map((s, si) => {
            const n = starts[pi] + si;
            return (
              <span key={n} className={n === speaking ? 'spoken' : undefined}>
                {typo.bionic ? bionic(s, `${pi}-${si}`) : s}{' '}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
/* ------------------------------ focus panel ------------------------------ */
/** Floating panel for the reading-focus toolkit: five modes + a darkness dial.
 *  Styled like the speak-bar (same glass, same border, same positioning). */
/**
 * The light itself.
 *
 * One component for the real overlay and for every swatch in the picker, which
 * is the only way a preview can be trusted: the card you click renders exactly
 * the layers that are about to land on your page, at a smaller `--r`. A
 * hand-drawn approximation of a lighting effect is a promise the effect then
 * has to keep.
 *
 * Everything geometric is expressed against `--r`, the light's reach in
 * pixels, so a preview only has to say `--r: 34px` to become a thumbnail.
 */
function FocusOverlay({
  mode, dim, size, steady, tint, x = 0.5, y = 0.52, clipLeft, clipRight, mini, zone,
}: {
  mode: FocusMode; dim: number; size: number; steady: boolean; tint: string;
  x?: number; y?: number; clipLeft?: boolean; clipRight?: boolean; mini?: boolean;
  /** The paper, in reader coordinates. Absent = fill the reader (previews). */
  zone?: Zone | null;
}) {
  const film = FILM_TINTS.find((t) => t.id === tint) || FILM_TINTS[0];
  const base = mini ? 34 : 190;
  const R = base * size;

  /* The pointer arrives as a fraction of the WINDOW, because that is what the
     stage can honestly report. Inside a zone it has to become a fraction of the
     PAGE, or the light sits at the wrong place on it by exactly the distance
     between the two origins. Allowed a little past each edge — light falling
     off the side of a page is a real thing, and clamping it to the paper makes
     the pool stick to the border like a magnet. */
  const lx = zone ? (x * (typeof window !== 'undefined' ? window.innerWidth : 1) - zone.left) / Math.max(1, zone.width) : x;
  const ly = zone ? (y * (typeof window !== 'undefined' ? window.innerHeight : 1) - zone.top) / Math.max(1, zone.height) : y;
  const fx = Math.max(-0.25, Math.min(1.25, lx));
  const fy = Math.max(-0.25, Math.min(1.25, ly));
  /* Every overlay on screen owns its mask ids — the picker renders eleven of
     these at once, and duplicate ids would have them all wear the first one's
     keyhole. */
  const maskId = useId().replace(/[:]/g, '');

  /* The keyhole is the one shape gradients cannot draw, so it is cut with a
     real SVG mask — and an SVG mask needs numbers, not the percentages and
     `calc()` the rest of this file runs on. Measuring the box is the honest
     way to get them; everything else here stays declarative. */
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || mode !== 'keyhole') return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const kh = useMemo(() => {
    const cx = fx * box.w;
    const cy = fy * box.h;
    const head = R * 0.46;
    // A real escutcheon: the bore is round, the ward slot below it tapers out
    // to take the bit of the key. Proportions from an ordinary mortice lock.
    const stemTop = cy + head * 0.55;
    const stemBot = cy + R * 1.05;
    const halfTop = head * 0.30;
    const halfBot = head * 0.86;
    return {
      cx, cy: cy - R * 0.22,
      head,
      pts: [
        `${cx - halfTop},${stemTop - R * 0.22}`,
        `${cx + halfTop},${stemTop - R * 0.22}`,
        `${cx + halfBot},${stemBot}`,
        `${cx - halfBot},${stemBot}`,
      ].join(' '),
    };
  }, [fx, fy, box.w, box.h, R]);

  return (
    <div
      ref={boxRef}
      className={`pdfr-focus pdfr-focus-${mode}${steady ? ' steady' : ''}${mini ? ' mini' : ''}${zone ? ' onpage' : ''}`}
      aria-hidden
      style={{
        ['--fy' as string]: `${(fy * 100).toFixed(2)}%`,
        ['--fx' as string]: `${(fx * 100).toFixed(2)}%`,
        ['--focus-dim' as string]: String(dim),
        ['--r' as string]: `${(base * size).toFixed(1)}px`,
        ['--film' as string]: film.rgb,
        ['--ruler-left' as string]: clipLeft ? '50%' : '0',
        ['--ruler-right' as string]: clipRight ? '50%' : '0',
        /* `inset` FIRST. It is shorthand for all four offsets, so writing it
           after left/top would reset them to auto in the same declaration
           block and drop the overlay wherever its static position happens to
           be — which looked like a light that covered two thirds of the book
           and stopped. */
        ...(zone ? { inset: 'auto', left: zone.left, top: zone.top, width: zone.width, height: zone.height } : null),
      }}
    >
      {/* --- Guides: physical cards and films, no light involved --- */}
      {mode === 'ruler' && <><div className="card above" /><div className="band" /><div className="card below" /></>}
      {mode === 'typoscope' && (
        <><div className="card above" /><div className="card below" /><div className="card left" /><div className="card right" /><div className="win" /></>
      )}
      {mode === 'tint' && <><div className="film" /><div className="sheen" /></>}

      {/* --- Lamps: a shade that darkens, and light that genuinely adds --- */}
      {(mode === 'spotlight' || mode === 'lamp' || mode === 'moon') && (
        <><div className="shade" /><div className="lit" /></>
      )}
      {mode === 'torch' && <><div className="shade" /><div className="beam" /><div className="lit" /></>}

      {/* A keyhole is a keyhole. */}
      {mode === 'keyhole' && box.w > 0 && (
        <svg className="cut" width="100%" height="100%">
          <defs>
            <mask id={`kh-${maskId}`} maskUnits="userSpaceOnUse">
              <rect x="0" y="0" width={box.w} height={box.h} fill="#fff" />
              {/* Blurred, because a door is not a stencil — the edge of what
                  you can see through a keyhole is soft. */}
              <g fill="#000" filter={`url(#khb-${maskId})`}>
                <circle cx={kh.cx} cy={kh.cy} r={kh.head} />
                <polygon points={kh.pts} />
              </g>
            </mask>
            <filter id={`khb-${maskId}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation={mini ? 1.6 : 6} />
            </filter>
          </defs>
          <rect x="0" y="0" width={box.w} height={box.h} fill="#050403"
            fillOpacity={dim} mask={`url(#kh-${maskId})`} />
        </svg>
      )}

      {/* --- Flame: light that moves, because a flame does --- */}
      {(mode === 'matchstick' || mode === 'candle') && (
        <div className="wick">
          <div className="shade" />
          <div className="lit" />
          <div className="flame"><i /><b /></div>
        </div>
      )}

      {/* --- Daylight --- */}
      {mode === 'window' && <><div className="shade" /><div className="shaft" /><div className="sash" /><div className="motes" /></>}
    </div>
  );
}

/* ------------------------------- light zone ------------------------------ */
/**
 * Where the paper actually is, in the reader's own coordinates.
 *
 * THIS IS THE FIX FOR LIGHT FALLING ON THE ROOM. Every reading light used to be
 * a full-screen overlay: the shade covered the whole window and the pool of
 * light went wherever the pointer went, so a window shaft lit the bookshelves,
 * a candle lit the desk, and the page — the one surface the light is FOR — was
 * lit only when your cursor happened to be over it. It read as a filter over a
 * screenshot, which is what it was.
 *
 * A lamp lights a page. So the overlay is now positioned on the page (or the
 * open book, or the reflowed column — whatever is showing), the pointer is
 * converted into that box's own coordinates, and everything outside it is
 * simply dark. Nothing about the individual modes changed; they just got a
 * stage the size of the paper.
 *
 * Measured rather than derived: the stage centres its content, the book shifts
 * sideways as it opens, and the page resizes with the window. Watching the real
 * element is the only version of this that cannot drift.
 */
interface Zone { left: number; top: number; width: number; height: number }

function useLightZone(active: boolean, deps: unknown[]): Zone | null {
  const [measured, setZone] = useState<Zone | null>(null);
  // Read through the flag rather than clearing on the way out: a stale box is
  // harmless while nothing is reading it, and clearing it inside the effect is
  // a cascading render for a value about to be ignored anyway.
  const zone = active ? measured : null;

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = '';

    const read = () => {
      const root = document.querySelector('.pdfr-root');
      const el = document.querySelector('.pdfr-stage [data-lightzone]');
      if (!root || !el) return;
      const r = el.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      const next: Zone = { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
      // Only through React when it actually moved: this runs on a rAF loop while
      // the book is opening, and a setState per frame for an unchanged box is
      // the kind of thing that makes a page turn cost more than it should.
      const key = `${next.left | 0}:${next.top | 0}:${next.width | 0}:${next.height | 0}`;
      if (key !== last) { last = key; setZone(next); }
    };

    /* A rAF loop rather than a ResizeObserver alone, and deliberately: the book
       SLIDES (--shift) and the boards SWING for the whole length of an open, and
       neither of those resizes anything — an observer would report the final box
       and the light would sit in the wrong place for the third of a second the
       reader is actually watching. */
    let idle = 0;
    const tick = () => {
      read();
      idle += 1;
      // Settle down once nothing has moved for a while; wake on any of the
      // events below. A permanent 60fps measure loop for a still page is waste.
      raf = idle < 90 ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { idle = 0; if (!raf) raf = requestAnimationFrame(tick); };

    wake();
    window.addEventListener('resize', wake);
    const stage = document.querySelector('.pdfr-stage');
    stage?.addEventListener('scroll', wake, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', wake);
      stage?.removeEventListener('scroll', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);

  return zone;
}

/* --------------------------- the focus drawer ---------------------------- */
/**
 * Picking a light by looking at it.
 *
 * The old panel was a row of five 28px icon buttons and a Dim slider. Nothing
 * was named on screen, nothing was previewed, and the icons for "spotlight"
 * and "matchlight" are — at that size — the same small blob. You chose by
 * trying all five and remembering which position you liked.
 *
 * This is the Rooms drawer's shape, for the same reason Rooms uses it: when
 * the thing being chosen is *visual*, the list has to be visual too. Every
 * card runs the real overlay over a scrap of type, so you see the actual light
 * — its colour, its falloff, its flicker — before it touches your page.
 */
function FocusPanel({
  mode, darkness, size, steady, tint,
  onModeChange, onDarknessChange, onSizeChange, onSteadyChange, onTintChange, onClose,
}: {
  mode: FocusMode; darkness: number; size: number; steady: boolean; tint: string;
  onModeChange: (m: FocusMode) => void;
  onDarknessChange: (d: number) => void;
  onSizeChange: (s: number) => void;
  onSteadyChange: (v: boolean) => void;
  onTintChange: (t: string) => void;
  onClose: () => void;
}) {
  const def = FOCUS_BY_ID.get(mode);
  /* The film tints itself rather than dimming the page, so a "Dim" slider
     under it would be a control with nothing to do. Each mode shows the
     controls that actually reach it. */
  const isFilm = mode === 'tint';
  const isFlame = mode === 'matchstick' || mode === 'candle';

  return (
    <div className="pdfr-drawer focus" onClick={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="head">
        <div>
          <h3>Reading focus</h3>
          <p>{FOCUS_MODES.length} ways to light a page. The room goes dark, and the light falls on the paper — wherever you point it.</p>
        </div>
        <div className="x" title="Close" onClick={onClose}><Ico d={I.close} s={15} /></div>
      </div>

      <div className="body">
        {FOCUS_GROUPS.map((g) => (
          <div key={g}>
            <h4>{g}</h4>
            <div className="pdfr-grid">
              {FOCUS_MODES.filter((f) => f.group === g).map((f) => (
                <div
                  key={f.id}
                  className={`pdfr-focuscard ${mode === f.id ? 'active' : ''}`}
                  title={f.blurb}
                  onClick={() => onModeChange(f.id)}
                >
                  <div className="prev">
                    {/* A scrap of type for the light to fall on. Bars, not
                        lorem: at 150px wide real words are noise, and what
                        this card is showing is the LIGHT. */}
                    <div className="lines">
                      {[92, 78, 96, 64, 88, 71, 94, 58].map((w, i) => (
                        <span key={i} style={{ width: `${w}%` }} />
                      ))}
                    </div>
                    <FocusOverlay mode={f.id} dim={darkness} size={1} steady={steady} tint={tint} mini />
                  </div>
                  <div className="cap"><Ico d={f.icon} s={12} />{f.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <h4>The light</h4>
        <p className="pdfr-focusnote">{def?.blurb}</p>

        {isFilm ? (
          <div className="pdfr-swatches">
            {FILM_TINTS.map((t) => (
              <button
                key={t.id}
                className={`sw ${tint === t.id ? 'active' : ''}`}
                title={t.label}
                onClick={() => onTintChange(t.id)}
                style={{ background: `rgb(${t.rgb})` }}
              />
            ))}
          </div>
        ) : (
          <label className="pdfr-slide">
            <span>Dim</span>
            <input className="pdfr-range" type="range" min={0.4} max={0.95} step={0.01}
              value={darkness} onChange={(e) => onDarknessChange(parseFloat(e.target.value))} />
            <b>{Math.round(darkness * 100)}%</b>
          </label>
        )}

        <label className="pdfr-slide">
          <span>Reach</span>
          <input className="pdfr-range" type="range" min={0.55} max={2} step={0.05}
            value={size} onChange={(e) => onSizeChange(parseFloat(e.target.value))} />
          <b>{Math.round(size * 100)}%</b>
        </label>

        {isFlame && (
          <button className={`pdfr-toggle ${steady ? 'on' : ''}`} onClick={() => onSteadyChange(!steady)}>
            <span className="knob" />
            <span className="t">
              Hold it steady
              <i>Stops the flicker and the wander — kinder to read beside</i>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- typography ------------------------------- */
function TypePanel({ typo, onChange, onClose, layout, onTypeset, aged, age, onAgedChange, onAgeChange, jumpToPaper }: {
  typo: Typo; onChange: (t: Partial<Typo>) => void; onClose: () => void;
  layout: Layout; onTypeset: () => void;
  aged: boolean; age: AgeCfg;
  onAgedChange: (v: boolean) => void;
  onAgeChange: (a: Partial<AgeCfg>) => void;
  /** Opened from the paper button rather than the type one — start there. */
  jumpToPaper?: boolean;
}) {
  /* A drawer that opens on the wrong section is a drawer you have to search.
     Fourteen typefaces sit above the paper, so arriving from the paper button
     put the thing you pressed for below the fold every time. */
  const paperRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!jumpToPaper) return;
    const t = window.setTimeout(() => paperRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 340);
    return () => window.clearTimeout(t);
  }, [jumpToPaper]);
  return (
    <div className="pdfr-drawer type" onClick={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="head">
        <div>
          <h3>Typography</h3>
          <p>Your font, your size, your paper. Applies to Typeset view — the PDF&apos;s own pages stay exactly as printed.</p>
        </div>
        <div className="x" title="Close" onClick={onClose}><Ico d={I.close} s={15} /></div>
      </div>

      <div className="body">
        {layout !== 'typeset' && (
          <button className="pdfr-cta" onClick={onTypeset}><Ico d={I.typeset} s={14} /> Switch to Typeset view</button>
        )}

        <h4>Typeface</h4>
        <div className="pdfr-fonts">
          {BOOK_FONTS.map((f) => (
            <button key={f.id} className={`pdfr-font ${typo.font === f.id ? 'active' : ''}`} onClick={() => onChange({ font: f.id })}>
              <span className="sample" style={{ fontFamily: f.css }}>Ag</span>
              <span className="meta"><b>{f.label}</b>{f.note && <i>{f.note}</i>}</span>
            </button>
          ))}
        </div>

        <h4>Size</h4>
        <Slider min={14} max={34} step={1} value={typo.size} onChange={(v) => onChange({ size: v })} format={(v) => `${v}px`} />
        <h4>Line height</h4>
        <Slider min={1.2} max={2.2} step={0.02} value={typo.leading} onChange={(v) => onChange({ leading: v })} format={(v) => v.toFixed(2)} />
        <h4>Line width</h4>
        <Slider min={40} max={100} step={1} value={typo.measure} onChange={(v) => onChange({ measure: v })} format={(v) => `${v} chars`} />

        <h4>Paper</h4>
        <div className="pdfr-papers">
          {PAPERS.map((p) => (
            <button key={p.id} className={`pdfr-paper ${typo.paper === p.id ? 'active' : ''}`} onClick={() => onChange({ paper: p.id })}
              style={{ background: p.bg, color: p.ink }}>Aa<i>{p.label}</i></button>
          ))}
        </div>

        {/* ------------------------------ the paper's age ------------------ *
            Five sheets, each previewed with its REAL marks — the same generator
            the page uses, seeded differently per card so you are looking at
            five different sheets rather than five copies of one. What a preset
            actually changes is written under it, because "Weathered" and
            "Antique" mean nothing until you have seen both. */}
        <h4 ref={paperRef}>The paper&apos;s age</h4>
        <button className={`pdfr-toggle ${aged ? 'on' : ''}`} style={{ marginTop: 0 }} onClick={() => onAgedChange(!aged)}>
          <span className="knob" />
          <span className="t">Old paper<i>{aged ? 'Every sheet foxed and marked differently' : 'The pages are printed today'}</i></span>
        </button>

        {aged && (
          <>
            <div className="pdfr-ages">
              {AGE_PRESETS.filter((a) => a.id !== 'off').map((a, i) => (
                <button key={a.id} className={`pdfr-agecard ${age.preset === a.id ? 'active' : ''}`}
                  title={a.blurb} onClick={() => onAgeChange({ preset: a.id })}>
                  <span className="sheet">
                    <AgedPaper page={11 + i * 7} cfg={{ preset: a.id, amount: age.amount }} />
                  </span>
                  <b>{a.label}</b>
                </button>
              ))}
            </div>
            <p className="pdfr-focusnote" style={{ margin: '8px 0 2px' }}>{agePresetOf(age.preset).blurb}</p>
            <label className="pdfr-slide">
              <span>Wear</span>
              <input className="pdfr-range" type="range" min={0.2} max={1} step={0.02}
                value={age.amount} onChange={(e) => onAgeChange({ amount: parseFloat(e.target.value) })} />
              <b>{Math.round(age.amount * 100)}%</b>
            </label>
          </>
        )}

        <h4>Reading aids</h4>
        <label className="pdfr-check"><input type="checkbox" checked={typo.justify} onChange={(e) => onChange({ justify: e.target.checked })} /> Justify both edges</label>
        <label className="pdfr-check"><input type="checkbox" checked={typo.bionic} onChange={(e) => onChange({ bionic: e.target.checked })} />
          <span>Bold word openings <em>— the eye finishes the word, which is faster for some readers and worse for others</em></span></label>
      </div>
    </div>
  );
}

function Slider({ min, max, step, value, onChange, format }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="pdfr-slider">
      <input className="pdfr-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span>{format(value)}</span>
    </div>
  );
}

/* ------------------------------- speak bar ------------------------------- */
/** A transport, not a status line: pause, skip, speed, pitch, voice, and what
 *  it is saying right now (which is the only way to tell it has stalled). */
function SpeakBar({ speech, setSpeech, voices, bottom, total, text }: {
  speech: Speech; setSpeech: React.Dispatch<React.SetStateAction<Speech>>;
  voices: SpeechSynthesisVoice[]; bottom: number; total: number; text?: string;
}) {
  const [more, setMore] = useState(false);
  const set = (p: Partial<Speech>) => setSpeech((s) => ({ ...s, ...p }));
  const step = (d: number) => setSpeech((s) => ({ ...s, idx: Math.max(0, s.idx + d) }));

  return (
    <div className="pdfr-speakbar" style={{ bottom }}>
      <div className="row">
        <span className={`dot ${speech.paused ? 'off' : ''}`} />
        <button className="pdfr-btn" title="Previous sentence" onClick={() => step(-1)}><Ico d={I.prev} s={14} /></button>
        <button className="pdfr-btn" title={speech.paused ? 'Resume' : 'Pause'} onClick={() => set({ paused: !speech.paused })}>
          <Ico d={speech.paused ? I.play : I.pause} s={14} />
        </button>
        <button className="pdfr-btn" title="Next sentence" onClick={() => step(1)}><Ico d={I.next} s={14} /></button>
        <span className="pos">{Math.min(speech.idx + 1, Math.max(total, 1))}/{total || '—'}</span>
        <div className="pdfr-sep" />
        <span className="lbl">Speed</span>
        <input className="pdfr-range" style={{ width: 104 }} type="range" min={0.5} max={2.5} step={0.05}
          value={speech.rate} onChange={(e) => set({ rate: parseFloat(e.target.value) })} />
        <span className="rate">{speech.rate.toFixed(2)}×</span>
        <button className={`pdfr-btn ${more ? 'active' : ''}`} title="More" onClick={() => setMore(!more)}>⋯</button>
        <button className="pdfr-btn" title="Stop" onClick={() => set({ on: false, idx: 0, paused: false })}><Ico d={I.close} s={13} /></button>
      </div>

      {more && (
        <div className="row wrap">
          <span className="lbl">Voice</span>
          <select className="pdfr-select" value={speech.voice} onChange={(e) => set({ voice: e.target.value })}>
            <option value="">System default</option>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
          </select>
          <span className="lbl">Pitch</span>
          <input className="pdfr-range" style={{ width: 76 }} type="range" min={0.5} max={1.6} step={0.05}
            value={speech.pitch} onChange={(e) => set({ pitch: parseFloat(e.target.value) })} />
          <span className="lbl">Volume</span>
          <input className="pdfr-range" style={{ width: 76 }} type="range" min={0} max={1} step={0.05}
            value={speech.volume} onChange={(e) => set({ volume: parseFloat(e.target.value) })} />
          <label className="pdfr-check tight"><input type="checkbox" checked={speech.auto} onChange={(e) => set({ auto: e.target.checked })} /> Keep going onto the next page</label>
        </div>
      )}

      {text && <div className="said">{text}</div>}
      {!voices.length && <div className="said warn">No speech voices are installed in this browser — the page will stay silent.</div>}
    </div>
  );
}

/* ------------------------------- dictionary ------------------------------ */
function DefineCard({ word, x, y, loading, phonetic, defs, error, onClose }: {
  word: string; x: number; y: number; loading: boolean; phonetic?: string;
  defs?: { pos: string; text: string }[]; error?: string; onClose: () => void;
}) {
  const left = Math.min(Math.max(16, x - 150), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 316);
  const below = y < (typeof window !== 'undefined' ? window.innerHeight : 800) / 2;
  return (
    <div className="pdfr-define" style={{ left, top: below ? y + 18 : undefined, bottom: below ? undefined : `calc(100% - ${y - 18}px)` }}
      onClick={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="w">{word} {phonetic && <span>{phonetic}</span>}<i onClick={onClose}>✕</i></div>
      {loading ? <div className="l">Looking it up…</div>
        : error ? <div className="l">{error}</div>
          : <ol>{(defs || []).map((d, i) => <li key={i}><b>{d.pos}</b> {d.text}</li>)}</ol>}
    </div>
  );
}

/* --------------------------- small controls ----------------------------- */
function SwatchRow({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{colors.map((c) => (<button key={c} onClick={() => onPick(c)} title="Colour" style={{ width: 20, height: 20, borderRadius: 6, background: c, border: value === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />))}</div>);
}

function usePageAspect(session: PdfSession | null, page: number): number {
  const [a, setA] = useState(1.414);
  useEffect(() => {
    if (!session) return; let alive = true;
    session.aspect(page).then((v) => { if (alive && v > 0.1) setA(v); }).catch(() => { /* keep default */ });
    return () => { alive = false; };
  }, [session, page]);
  return a;
}

/**
 * The size of a LEAF, which is a property of the book and not of the page you
 * happen to be on.
 *
 * This is the fix for the flipbook "trying to fit itself" after every turn. The
 * book used to be sized from `usePageAspect(session, st.page)` — re-measured per
 * page — so on any document whose pages aren't all identical (a scan, a deck, one
 * landscape page in a report) every turn landed on a new aspect, which changed
 * `pageW`, which resized the whole book AND missed the raster cache on all four
 * visible pages at once, so pdf.js re-rendered them on the main thread. You saw
 * the book settle, then shuffle itself, then the pages repaint.
 *
 * A bound book has one leaf size. Measure a few pages, take the tallest, and
 * never move again: `pageW` is then constant across the entire document, every
 * turn is a cache hit, and an odd-sized page is simply centred on a standard
 * leaf — which is what a page of a different size in a real book looks like.
 */
function useBookAspect(session: PdfSession | null): number {
  const [a, setA] = useState(1.414);
  useEffect(() => {
    if (!session) return undefined;
    let alive = true;
    const probe = [1, 2, 3, Math.ceil(session.numPages / 2), session.numPages]
      .filter((n, i, all) => n >= 1 && n <= session.numPages && all.indexOf(n) === i);
    Promise.all(probe.map((n) => session.aspect(n).catch(() => 0)))
      .then((all) => {
        const good = all.filter((v) => v > 0.1);
        if (alive && good.length) setA(Math.max(...good));
      })
      .catch(() => { /* keep default */ });
    return () => { alive = false; };
  }, [session]);
  return a;
}

/* ------------------------------- flipbook -------------------------------- */
/**
 * The boards. A hardcover with the wordmark stamped into it — the first thing
 * you see, and the reason this reads as a book rather than a viewer with a page
 * animation bolted on. The back board is the same object, reversed and quieter.
 */
function Cover({ side, title, pages, w, aspect }: { side: 'front' | 'back'; title: string; pages: number; w: number; aspect: number }) {
  return (
    <div className={`pdfr-board ${side}`} style={{ width: w, height: w * aspect }}>
      <div className="cloth" />
      <div className="hinge" />
      <div className="rule" />
      {side === 'front' ? (
        <div className="plate">
          <div className="mark">canvabrains</div>
          <div className="hair" />
          <h1>{title}</h1>
          <div className="meta">{pages} {pages === 1 ? 'page' : 'pages'} · flipbook</div>
        </div>
      ) : (
        <div className="plate end">
          <div className="fin">the end</div>
          <div className="hair" />
          <div className="mark small">canvabrains</div>
        </div>
      )}
      <div className="sheenboard" />
    </div>
  );
}

function BookView(props: PageSharedProps & {
  page: number; numPages: number; pageW: number; aspect: number; bookmarks: number[];
  title: string; phase: BookPhase; anim: BookAnim | null; turning: Turning | null;
  bookRef: React.MutableRefObject<HTMLDivElement | null>;
  onCornerDown: (d: 'next' | 'prev', e: React.PointerEvent) => void;
  onCornerMove: (e: React.PointerEvent) => void;
  onCornerUp: () => void;
  onTurn: (d: 'next' | 'prev') => void; onScrub: (n: number) => void; onUnmark: (n: number) => void;
}) {
  const { page, numPages, pageW, aspect, phase, anim, turning, onTurn, bookmarks, onScrub, onUnmark, title,
    bookRef, onCornerDown, onCornerMove, onCornerUp, ...shared } = props;

  const leaf = turning?.leaf ?? null;
  const committed = oddLeft(page);
  /* What each half shows. During a turn this is NOT the committed spread: the
     revealed page has to already be under the rising sheet. */
  const left = leaf ? leaf.leftShown : committed;
  const rightNum = leaf ? leaf.rightShown : committed + 1;
  const right = rightNum <= numPages ? rightNum : null;

  /* The book is only ever still when no sheet is in the air and no board is
     swinging. Everything expensive and non-visual — the selection layer above
     all — waits for this. */
  const quiet = !turning && !anim;

  const frac = numPages > 1 ? committed / numPages : 0.5;
  /* The block of paper on each side is how far through you are — the oldest
     progress bar there is, and the one you can feel in your hand.
     It lives in a slot of CONSTANT width (see .pdfr-stackslot). It used to be a
     flex item sized to `leftStack`, so every turn that changed the block by a
     pixel pushed both page halves — and the spine, and the sheet's hinge —
     sideways underneath you. A book's pages do not move as you read it; the
     block just gets thicker, which is now all that happens. */
  const leftStack = Math.max(3, Math.round(STACK_SLOT * frac));
  const rightStack = Math.max(3, Math.round(STACK_SLOT * (1 - frac)));

  /* The ribbon: hangs from the top of the block, and can be dragged sideways to
     scrub through the book — a page number rides along with it. */
  const [drag, setDrag] = useState<null | { at: number; page: number }>(null);
  const ribbonDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ at: e.clientX, page: committed });
  };
  const ribbonMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const span = bookRef.current?.offsetWidth || 800;
    const delta = Math.round(((e.clientX - drag.at) / span) * numPages * 1.6);
    setDrag({ ...drag, page: Math.min(numPages, Math.max(1, drag.page + (delta - (drag.page - committed)))) });
  };
  const ribbonUp = () => { if (drag && drag.page !== committed) onScrub(drag.page); setDrag(null); };

  const closed = phase !== 'open' && !anim;
  const coverAnim = anim?.kind === 'cover' ? anim.dir : null;
  const backAnim = anim?.kind === 'back' ? anim.dir : null;
  /* Shut, the book is one page wide, so the whole thing slides half a page
     sideways to stay centred while the board swings open. Both motions run on
     the same curve and the same clock, which is why it reads as one gesture.
     The open book is two pages wide and centred, so its right half sits half a
     page RIGHT of centre — bringing that half to the middle means moving the
     book left, hence the negative. */
  const shift = phase === 'front' && !coverAnim ? -pageW / 2
    : phase === 'back' && !backAnim ? pageW / 2
      : coverAnim === 'open' ? 0 : coverAnim === 'close' ? -pageW / 2
        : backAnim === 'open' ? pageW / 2 : backAnim === 'close' ? 0 : 0;

  const showFrontBoard = phase === 'front' || coverAnim !== null;
  const showBackBoard = phase === 'back' || backAnim !== null;

  /* Where the spine is, in the leaves' own coordinates. The turning sheet and
     both boards hinge exactly there — and because the block of paper now lives
     in a fixed-width slot, this is a constant for the whole document rather than
     something that crept sideways by a pixel every time you turned a page. */
  const SPINE = 3;
  const leftHalfX = STACK_SLOT;
  const rightHalfX = STACK_SLOT + pageW + SPINE;
  const hinge = leaf?.dir === 'prev'
    ? { left: leftHalfX, transformOrigin: 'right center' }
    : { left: rightHalfX, transformOrigin: 'left center' };
  const pageH = pageW * aspect;

  return (
    <div className={`pdfr-book ${closed ? 'shut' : ''}`} ref={bookRef} data-lightzone
      data-shut={closed ? phase : undefined}
      style={{ ['--shift' as string]: `${shift}px`, ['--pw' as string]: `${pageW}px` }}>
      {/* the case: boards and cloth. Fades out when the book is shut, because
          then the board in your hand IS the case. */}
      <div className="pdfr-case" />
      {!closed && (
        <div className={`pdfr-ribbon ${drag ? 'dragging' : ''}`}
          style={{ right: 13 + rightStack, height: pageW * (drag ? 1.05 : 0.92) }}
          title="Drag to scrub through the book"
          onPointerDown={ribbonDown} onPointerMove={ribbonMove} onPointerUp={ribbonUp} onPointerCancel={ribbonUp}>
          {drag && <span className="tip">{drag.page}</span>}
        </div>
      )}

      <div className="leaves">
        <div className="pdfr-stackslot left" style={{ width: STACK_SLOT }}>
          <div className="pdfr-stack left" style={{ width: leftStack }} />
        </div>

        <div className="pdfr-leaf l" style={{ width: pageW }}>
          <Page {...shared} page={left} width={pageW} boxAspect={aspect} quiet={quiet} interactive bookmarked={bookmarks.includes(left)} onUnmark={onUnmark} />
          {/* the moving shadow the turning sheet casts into this half */}
          {leaf && <div className={`pdfr-cast l ${leaf.dir}`} />}
        </div>

        <div className="pdfr-spine" />

        <div className="pdfr-leaf r" style={{ width: pageW }}>
          {right ? <Page {...shared} page={right} width={pageW} boxAspect={aspect} quiet={quiet} interactive bookmarked={bookmarks.includes(right)} onUnmark={onUnmark} />
            : <div className="pdfr-blank" style={{ width: pageW, height: pageW * aspect }} />}
          {leaf && <div className={`pdfr-cast r ${leaf.dir}`} />}
        </div>

        <div className="pdfr-stackslot right" style={{ width: STACK_SLOT }}>
          <div className="pdfr-stack right" style={{ width: rightStack }} />
        </div>

        {/* The sheet in flight — one element, two printed faces, hinged on the
            spine. Last in the row so it paints over both halves. Its position
            comes from --t / --bow on the book root, written per frame by
            paintLeaf, so this element never re-renders while it moves. */}
        {leaf && (
          <div
            className={`pdfr-turn ${leaf.dir}${turning?.dragging ? ' held' : ''}`}
            style={{ ...hinge, width: pageW, height: pageH }}
          >
            <div className="face front">
              <Page {...shared} page={leaf.front} width={pageW} boxAspect={aspect} />
              <div className="sheen" /><div className="edge" />
            </div>
            <div className="face back">
              <Page {...shared} page={leaf.back} width={pageW} boxAspect={aspect} />
              <div className="sheen" /><div className="edge" />
            </div>
          </div>
        )}

        {/* the boards. Backface hidden, so each one simply ceases to exist the
            moment it goes past edge-on — which is how a hard cover with nothing
            printed inside it behaves, and it means the page behind is revealed
            at zero width instead of popping. */}
        {showFrontBoard && (
          <div className={`pdfr-coverwrap front ${coverAnim ?? ''}`}
            style={{ left: rightHalfX, transformOrigin: 'left center', width: pageW, height: pageH }}
            onClick={() => { if (!coverAnim) onTurn('next'); }} title="Open the flipbook">
            <Cover side="front" title={title} pages={numPages} w={pageW} aspect={aspect} />
          </div>
        )}
        {showBackBoard && (
          <div className={`pdfr-coverwrap back ${backAnim ?? ''}`}
            style={{ left: leftHalfX, transformOrigin: 'right center', width: pageW, height: pageH }}
            onClick={() => { if (!backAnim) onTurn('prev'); }} title="Back to the last page">
            <Cover side="back" title={title} pages={numPages} w={pageW} aspect={aspect} />
          </div>
        )}
      </div>

      {/* The corners. Click to turn, or take hold and pull — the drag runs the
          very same sheet, so a pulled page and a clicked one are one mechanism.
          Deliberately only in the corners: the page itself is live for
          highlighting and ink, and a drag there must not become a page turn. */}
      {!closed && (
        <>
          <div
            className="pdfr-corner left"
            title="Previous page — or drag it across"
            onPointerDown={(e) => { if (e.button === 0) onCornerDown('prev', e); }}
            onPointerMove={onCornerMove}
            onPointerUp={onCornerUp}
            onPointerCancel={onCornerUp}
          ><div className="fold" /></div>
          <div
            className="pdfr-corner right"
            title="Next page — or drag it across"
            onPointerDown={(e) => { if (e.button === 0) onCornerDown('next', e); }}
            onPointerMove={onCornerMove}
            onPointerUp={onCornerUp}
            onPointerCancel={onCornerUp}
          ><div className="fold" /></div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- aged paper ------------------------------ */
/**
 * The marks on THIS sheet.
 *
 * Everything is generated from the page number (see lib/pdf/aging.ts), so page
 * 7 keeps page 7's freckles for as long as the document exists and no two
 * sheets in the book are alike. That is the whole difference between paper and
 * a texture: a texture is the same on every page, and you notice within two
 * turns.
 *
 * Drawn in a 0–100 viewBox with `preserveAspectRatio="none"`, so one set of
 * numbers fits a portrait page, a landscape one and a thumbnail. `multiply` on
 * the group is what puts the stains INTO the paper rather than on top of it —
 * ink underneath still reads through a tea mark, which is exactly what happens
 * when you spill on a book.
 */
const AgedPaper = React.memo(function AgedPaper({ page, cfg }: { page: number; cfg: AgeCfg }) {
  const preset = agePresetOf(cfg.preset);
  const marks = useMemo(() => ageMarks(page, cfg), [page, cfg]);
  if (preset.id === 'off') return null;

  const amt = Math.max(0.2, Math.min(1, cfg.amount));
  const TONE: Record<string, string> = {
    rust: '#8a4a1c',
    tea: '#7d5520',
    damp: '#6b5a34',
  };

  return (
    <div className="pdfr-aged" style={{ ['--age' as string]: String(amt), ['--edge' as string]: String(preset.edge * amt) }}>
      {/* the overall cast: yellowing, and the darker burn at the edges */}
      <div className="tone" />
      <div className="fibres" />

      <svg className="marks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {/* Foxing. Small, hard-edged, rust — the freckles come first because the
            blots have to be able to sit over them. */}
        {marks.fox.map((b, i) => (
          <path key={`f${i}`} d={b.d} fill={TONE[b.tone]} opacity={b.opacity}
            style={{ filter: `blur(${b.blur.toFixed(2)}px)` }} />
        ))}

        {/* Blots. Soft, wide, and with a darker RIM — the tide line a drying
            liquid leaves is most of what makes a stain read as a stain. */}
        {marks.blots.map((b, i) => (
          <g key={`b${i}`} style={{ filter: `blur(${b.blur.toFixed(2)}px)` }}>
            <path d={b.d} fill={TONE[b.tone]} opacity={b.opacity} />
            <path d={b.d} fill="none" stroke={TONE[b.tone]} strokeWidth={0.9}
              opacity={b.opacity * 1.5} />
          </g>
        ))}

        {marks.ring && (
          <circle cx={marks.ring.cx} cy={marks.ring.cy} r={marks.ring.r}
            fill="none" stroke="#7a5423" strokeWidth={1.1} opacity={marks.ring.opacity}
            style={{ filter: 'blur(0.7px)' }} />
        )}

        {/* A fold catches the light on one side of the crease and shades the
            other, which is why each one is drawn twice, half a unit apart. */}
        {marks.creases.map((c, i) => (
          <g key={`c${i}`}>
            <path d={c.d} fill="none" stroke="#4a3316" strokeWidth={0.55} opacity={c.opacity}
              style={{ filter: 'blur(0.5px)' }} />
            <path d={c.d} fill="none" stroke="#fff8e6" strokeWidth={0.5} opacity={c.opacity * 0.75}
              transform="translate(0.6 0.6)" style={{ filter: 'blur(0.6px)' }} />
          </g>
        ))}

        {marks.deckle && (
          <path d={marks.deckle} fill="none" stroke="#6d4a1e" strokeWidth={1.6}
            opacity={0.28 * amt} style={{ filter: 'blur(0.9px)' }} />
        )}
      </svg>
    </div>
  );
});

/* --------------------------------- page --------------------------------- */
interface PageSharedProps {
  session: PdfSession | null;
  tool: Tool; hlColor: string; penColor: string; penSize: number; stickyColor: string;
  highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[];
  age: AgeCfg;
  addHighlight: (page: number, h: Omit<Highlight, 'id' | 'page'>) => void;
  delHighlight: (id: string) => void;
  addStroke: (page: number, pts: number[][], color: string, size: number) => void;
  delStroke: (id: string) => void;
  addSticky: (page: number, x: number, y: number, color: string) => void;
  editSticky: (id: string, patch: Partial<Sticky>) => void;
  delSticky: (id: string) => void;
}

function Page(props: PageSharedProps & { page: number; width: number; interactive?: boolean; bookmarked?: boolean; onUnmark?: (n: number) => void; boxAspect?: number; quiet?: boolean }) {
  const { session, page, width, tool, hlColor, penColor, penSize, stickyColor, highlights, drawings, stickies, age,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky, interactive, bookmarked, onUnmark,
    boxAspect, quiet = true } = props;

  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  /* Start at the size we already know this page will be, rather than at A4 and
     a correction one frame later — a leaf face mounts mid-turn, and a sheet that
     changes height on its first frame is the flicker you can't quite place. */
  const [aspect, setAspect] = useState(boxAspect ?? 1.414);
  const [px, setPx] = useState({ w: width, h: width * (boxAspect ?? 1.414) });
  const [spans, setSpans] = useState<{ page: number; list: TextSpan[] }>({ page: 0, list: [] });
  const [hlDrag, setHlDrag] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [live, setLive] = useState<number[][] | null>(null);
  const dragSticky = useRef<null | { id: string; dx: number; dy: number }>(null);
  const resizeSticky = useRef<null | { id: string; sx: number; sy: number; w: number; h: number }>(null);

  const pageHls = highlights.filter((h) => h.page === page);
  const pageInk = drawings.filter((d) => d.page === page);
  const pageStickies = stickies.filter((n) => n.page === page);

  useEffect(() => {
    const node = box.current; if (!node) return;
    const ro = new ResizeObserver((entries) => { const r = entries[0].contentRect; setPx({ w: r.width, h: r.height }); });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!session || !holder.current) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);

    const syncRes = session.renderPageSync(page, width, dpr);
    if (syncRes) {
      holder.current.replaceChildren(syncRes.canvas);
      setAspect(syncRes.height / width);
      return;
    }

    let cancelled = false;
    session.renderPage(page, width, dpr).then(({ canvas, height }) => {
      if (cancelled || !holder.current) return;
      holder.current.replaceChildren(canvas);
      setAspect(height / width);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [session, page, width]);

  /* The invisible selection layer, built only once the book has stopped moving.
     It is the single most expensive thing on a page — a dense page is a thousand
     absolutely positioned spans, ~6ms of raw layout before React has reconciled
     any of it — and it was being rebuilt for BOTH halves at the exact moment a
     sheet landed, which is what you felt as the turn hitching at the end. Nobody
     selects text off a page that is in the air; it can wait for the book to be
     still, and for one clear frame after that. */
  useEffect(() => {
    if (!session || !interactive || !quiet) return undefined;
    if (spans.page === page) return undefined;
    let alive = true;
    const id = window.setTimeout(() => {
      session.textLayer(page, width)
        .then((tl) => { if (alive) setSpans({ page, list: tl.spans }); })
        .catch(() => { /* ignore */ });
    }, 90);
    return () => { alive = false; window.clearTimeout(id); };
  }, [session, page, width, interactive, quiet, spans.page]);

  const norm = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = norm(e);
    if (tool === 'highlight') setHlDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    else if (tool === 'draw') setLive([[p.x, p.y]]);
    else if (tool === 'sticky') addSticky(page, p.x, p.y, stickyColor);
  };
  const onMove = (e: React.PointerEvent) => {
    if (tool === 'highlight' && hlDrag) { const p = norm(e); setHlDrag({ ...hlDrag, x1: p.x, y1: p.y }); }
    else if (tool === 'draw' && live) { const p = norm(e); setLive((l) => l ? [...l, [p.x, p.y]] : l); }
  };
  const onUp = () => {
    if (tool === 'highlight' && hlDrag) {
      const x = Math.min(hlDrag.x0, hlDrag.x1), y = Math.min(hlDrag.y0, hlDrag.y1);
      const w = Math.abs(hlDrag.x1 - hlDrag.x0), h = Math.abs(hlDrag.y1 - hlDrag.y0);
      if (w > 0.01 && h > 0.004) addHighlight(page, { x, y, w, h: Math.max(h, 0.012), color: hlColor });
      setHlDrag(null);
    } else if (tool === 'draw' && live) {
      if (live.length > 1) addStroke(page, live, penColor, penSize);
      setLive(null);
    }
  };

  const stickyDown = (e: React.PointerEvent, n: Sticky) => {
    if (tool === 'eraser') { delSticky(n.id); return; }
    e.stopPropagation();
    const p = norm(e);
    dragSticky.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const stickyMove = (e: React.PointerEvent) => { if (!dragSticky.current) return; const p = norm(e); editSticky(dragSticky.current.id, { x: p.x - dragSticky.current.dx, y: p.y - dragSticky.current.dy }); };
  const stickyUp = () => { dragSticky.current = null; };

  const gripDown = (e: React.PointerEvent, n: Sticky) => { e.stopPropagation(); resizeSticky.current = { id: n.id, sx: e.clientX, sy: e.clientY, w: n.w, h: n.h }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); };
  const gripMove = (e: React.PointerEvent) => { const r = resizeSticky.current; if (!r) return; editSticky(r.id, { w: Math.max(100, Math.min(400, r.w + (e.clientX - r.sx))), h: Math.max(72, Math.min(340, r.h + (e.clientY - r.sy))) }); };
  const gripUp = () => { resizeSticky.current = null; };

  const creating = interactive && (tool === 'highlight' || tool === 'draw' || tool === 'sticky');
  const textActive = interactive && tool === 'none';

  return (
    <div className={`pdfr-page${boxAspect ? ' fit' : ''}`} ref={box} style={{ width, aspectRatio: `1 / ${boxAspect ?? aspect}` }}>
      <div className="pdfr-canvas" ref={holder} style={{ filter: ageFilter(age) || undefined }} />
      <AgedPaper page={page} cfg={age} />
      <div className="pdfr-grain" />

      {/* a corner turned down, the way you'd actually mark a page */}
      {bookmarked && (
        <div className="pdfr-dogear" title="Unfold the corner" onClick={(e) => { e.stopPropagation(); onUnmark?.(page); }}>
          <span className="fold" /><span className="under" />
        </div>
      )}

      {pageHls.map((h) => (
        <div key={h.id} className="pdfr-hl" title={tool === 'eraser' ? 'Tap to remove' : ''}
          onClick={() => tool === 'eraser' && delHighlight(h.id)}
          style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, background: h.color, pointerEvents: tool === 'eraser' ? 'auto' : 'none' }} />
      ))}
      {hlDrag && <div className="pdfr-hl" style={{ left: `${Math.min(hlDrag.x0, hlDrag.x1) * 100}%`, top: `${Math.min(hlDrag.y0, hlDrag.y1) * 100}%`, width: `${Math.abs(hlDrag.x1 - hlDrag.x0) * 100}%`, height: `${Math.abs(hlDrag.y1 - hlDrag.y0) * 100}%`, background: hlColor, pointerEvents: 'none' }} />}

      {(pageInk.length > 0 || live) && (
        <svg className="pdfr-ink" viewBox={`0 0 ${px.w} ${px.h}`} width="100%" height="100%" preserveAspectRatio="none">
          {pageInk.map((d) => (
            <path key={d.id} d={inkPath(d.pts.map(([x, y]) => [x * px.w, y * px.h]), d.size)} fill={d.color}
              style={{ cursor: tool === 'eraser' ? 'pointer' : 'default', pointerEvents: tool === 'eraser' ? 'auto' : 'none' }}
              onClick={() => tool === 'eraser' && delStroke(d.id)} />
          ))}
          {live && live.length > 1 && <path d={inkPath(live.map(([x, y]) => [x * px.w, y * px.h]), penSize)} fill={penColor} style={{ pointerEvents: 'none' }} />}
        </svg>
      )}

      {/* Hidden rather than unmounted while the page it belongs to isn't the one
          on screen: throwing a thousand spans away and building a thousand more
          is work, and doing it during a turn is work in the worst possible
          frame. `display:none` is one style recalc. */}
      {interactive && spans.list.length > 0 && (
        <div className="pdfr-textlayer"
          style={{ pointerEvents: textActive ? 'auto' : 'none', display: spans.page === page ? undefined : 'none' }}>
          {spans.list.map((s, i) => <span key={i} style={{ left: s.x, top: s.y, fontSize: s.h, height: s.h }}>{s.text}</span>)}
        </div>
      )}

      {pageStickies.map((n) => (
        <div key={n.id} className="pdfr-sticky" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%`, width: n.w, height: n.h, ['--sticky' as string]: n.color, ['--rot' as string]: `${n.rot}deg` } as React.CSSProperties}
          onPointerDown={(e) => stickyDown(e, n)} onPointerMove={stickyMove} onPointerUp={stickyUp} onClick={(e) => e.stopPropagation()}>
          <span className="del" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); delSticky(n.id); }}>✕</span>
          <textarea value={n.text} placeholder="Write…" onPointerDown={(e) => e.stopPropagation()} onChange={(e) => editSticky(n.id, { text: e.target.value })} />
          <span className="grip" onPointerDown={(e) => gripDown(e, n)} onPointerMove={gripMove} onPointerUp={gripUp} />
        </div>
      ))}

      {creating && <div style={{ position: 'absolute', inset: 0, zIndex: 8, touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />}
    </div>
  );
}

/* ------------------------------ filmstrip ------------------------------- */
function Filmstrip({ session, page, bookmarks, onJump }: { session: PdfSession; page: number; bookmarks: number[]; onJump: (n: number) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }, [page]);
  return (
    <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 78, width: 'min(78vw, 1100px)', zIndex: 18 }}>
      <div className="pdfr-strip" ref={stripRef}>
        {Array.from({ length: session.numPages }, (_, i) => i + 1).map((n) => (
          <LazyThumb key={n} ref={n === page ? activeRef : undefined} session={session} n={n} active={n === page} bookmarked={bookmarks.includes(n)} root={stripRef} onClick={() => onJump(n)} />
        ))}
      </div>
    </div>
  );
}

const LazyThumb = React.forwardRef<HTMLDivElement, { session: PdfSession; n: number; active: boolean; bookmarked: boolean; root: React.RefObject<HTMLDivElement | null>; onClick: () => void }>(
  function LazyThumb({ session, n, active, bookmarked, root, onClick }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const [src, setSrc] = useState('');
    const [seen, setSeen] = useState(false);
    useEffect(() => {
      const node = el.current; if (!node || seen) return;
      const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { root: root.current, rootMargin: '300px' });
      io.observe(node);
      return () => io.disconnect();
    }, [seen, root]);
    useEffect(() => {
      if (!seen) return; let alive = true;
      session.thumbnail(n).then((s) => { if (alive) setSrc(s); }).catch(() => { /* ignore */ });
      return () => { alive = false; };
    }, [seen, session, n]);
    return (
      <div ref={(node) => { el.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
        className={`pdfr-thumb ${active ? 'active' : ''}`} onClick={onClick} style={{ aspectRatio: src ? undefined : '0.72' }}>
        {src ? <img src={src} alt={`Page ${n}`} loading="lazy" /> : <div style={{ height: 84 }} />}
        {bookmarked && <div className="dogear" />}
        <div className="n">{n}</div>
      </div>
    );
  }
);
