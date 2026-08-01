'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import TextAnimPanel, { LetterSparkIcon } from './TextAnimPanel';
import { getAnimPreset } from '@/lib/textAnim';
import type { TextAnimConfig } from '@/lib/textAnim';
import { getFrameKind, frameKindMeta, frameTitle } from '@/lib/frames';

/**
 * The properties rail — everything you can change about the selected thing.
 *
 * This used to be a horizontal strip floating over the bottom of the canvas,
 * directly above the toolbar, with a "more options" card that unfolded on top
 * of it. Two problems with that shape. It sat in the middle of the board, so
 * the strip covered the very row of content you were editing; and a horizontal
 * bar has no room to grow, so all but six controls had to hide behind a chevron
 * — the font list, the size, opacity, layer order and the full colour picker
 * were one click away from being findable at all.
 *
 * It's a docked rail on the right now, in the dead space above the minimap:
 * a vertical column has room to show every control for the current selection at
 * once, grouped and labelled, and it never covers the canvas's centre. Groups
 * collapse (and remember what you collapsed), and the column scrolls when a
 * selection has more options than the viewport is tall — with the edges of the
 * scroll area fading so it's visible that there's more below.
 *
 * It still serves double duty: a selected object, or the text/arrow tool's
 * defaults before anything has been created.
 */

const spring = { type: 'spring' as const, stiffness: 400, damping: 34 };

/* ---- option palettes ---- */
/**
 * The full picker: eight hue families × eight steps, light to dark.
 *
 * Laid out as a grid rather than a wrapped row so a colour is found by aiming
 * (this hue, that darkness) instead of scanning.
 */
const SWATCH_GRID: string[][] = [
  ['#FFFFFF', '#F1EDE7', '#D6D0C7', '#A9A199', '#78706A', '#4A443F', '#2D2A26', '#000000'],
  ['#FDECEC', '#F9C9C9', '#F09393', '#E45C5C', '#D64545', '#B32E2E', '#8A2020', '#5C1414'],
  ['#FDF0E4', '#F8D9B6', '#F0B87A', '#E89B4A', '#C97B4B', '#A65F30', '#7E4620', '#552E14'],
  ['#FFF9E0', '#FBEFB0', '#F5DE6B', '#E6C433', '#C9A81F', '#A08616', '#75620F', '#4C3F09'],
  ['#E9F7EF', '#C0E9D2', '#87D4AC', '#4CBA84', '#2F9E6E', '#237C56', '#19593D', '#0F3A28'],
  ['#E7F0FB', '#C3DBF6', '#8FBCEE', '#5A93E0', '#3E63DD', '#2E4CB0', '#213781', '#152354'],
  ['#F1EAFB', '#DBC8F4', '#BE9DEA', '#9E70DC', '#8B5FBF', '#6C4699', '#4E3170', '#331F4A'],
  ['#FCE8F1', '#F7C4DC', '#EF93BF', '#E4629F', '#E93D82', '#BC2A66', '#8C1C4A', '#5C0F2F'],
];

/* Recently used colours, shared by every field and persisted so a palette
   built up over a session survives a reload. */
const RECENTS_KEY = 'mindspace:recent-colors';
const RECENTS_MAX = 12;

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((c) => typeof c === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(color: string): string[] {
  if (typeof window === 'undefined' || !color || color === 'transparent') return [];
  const next = [color, ...loadRecents().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, RECENTS_MAX);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota — the picker just won't remember this one */
  }
  return next;
}

/* Which groups you left folded up, remembered across selections and reloads.
   A rail you've tuned to your own workflow should stay tuned. */
const GROUPS_KEY = 'mindspace:inspector-groups';

function readGroups(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeGroup(id: string, open: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...readGroups(), [id]: open }));
  } catch {
    /* quota — the rail just won't remember this one */
  }
}

/** Chrome/Edge ship a real screen colour picker; Safari/Firefox don't yet. */
type EyeDropperCtor = new () => { open: (opts?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> };
function getEyeDropper(): EyeDropperCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_RE.test(v)) return null;
  const body = v.replace('#', '');
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  return `#${full.toUpperCase()}`;
}

const FONTS: { label: string; value: string }[] = [
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'Outfit', value: "'Outfit', sans-serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
  { label: 'Caveat', value: "'Caveat', cursive" },
  { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif" },
  { label: 'Lora', value: "'Lora', serif" },
  { label: 'Merriweather', value: "'Merriweather', serif" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Dancing Script', value: "'Dancing Script', cursive" },
  { label: 'Pacifico', value: "'Pacifico', cursive" },
  { label: 'Bebas Neue', value: "'Bebas Neue', sans-serif" },
  { label: 'Anton', value: "'Anton', sans-serif" },
  { label: 'Lobster', value: "'Lobster', cursive" },
  { label: 'Righteous', value: "'Righteous', sans-serif" },
];

/* `preview` scales each button's own label, so the control reads as the type
   scale it sets rather than five identical chips. */
const HEADINGS: { id: string; label: string; size: number; weight: number; preview: number }[] = [
  { id: 'h1', label: 'H1', size: 40, weight: 700, preview: 13 },
  { id: 'h2', label: 'H2', size: 30, weight: 700, preview: 12 },
  { id: 'h3', label: 'H3', size: 24, weight: 600, preview: 11 },
  { id: 'h4', label: 'H4', size: 19, weight: 600, preview: 10 },
  { id: 'body', label: 'Body', size: 15, weight: 400, preview: 9.5 },
];

const SIZE_PRESETS = [12, 14, 16, 20, 24, 32, 48, 64];

const FRAME_SWATCHES = ['#C97B4B', '#45B761', '#4A90D9', '#9B59B6', '#E93D82', '#2D2A26'];

/* ---- building blocks ---- */
function Icon({ children, size = 14 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** What the rail is pointed at, said in one chip and one word. */
const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  text: { label: 'Text', icon: <><path d="M5 7V5h14v2" /><line x1="12" y1="5" x2="12" y2="19" /><line x1="9" y1="19" x2="15" y2="19" /></> },
  heading: { label: 'Heading', icon: <><path d="M6 4v16" /><path d="M18 4v16" /><path d="M6 12h12" /></> },
  card: { label: 'Card', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="7" y1="9" x2="17" y2="9" /><line x1="7" y1="13" x2="14" y2="13" /></> },
  sticky: { label: 'Sticky note', icon: <><path d="M4 4h16v10l-6 6H4z" /><path d="M20 14h-6v6" /></> },
  shape: { label: 'Shape', icon: <><circle cx="8.5" cy="8.5" r="5" /><rect x="10" y="10" width="10" height="10" rx="2" /></> },
  arrow: { label: 'Arrow', icon: <><line x1="4" y1="19" x2="18" y2="5" /><polyline points="11 5 18 5 18 12" /></> },
  frame: { label: 'Frame', icon: <><path d="M4 8h16" /><path d="M4 16h16" /><path d="M8 4v16" /><path d="M16 4v16" /></> },
  image: { label: 'Image', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></> },
  mirror: { label: 'Camera mirror', icon: <><path d="M22 8.5v7l-5-3.5z" /><rect x="2" y="5" width="15" height="14" rx="2.5" /></> },
  drawing: { label: 'Drawing', icon: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></> },
  browser: { label: 'Web block', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><circle cx="6.5" cy="6.5" r=".6" fill="currentColor" /></> },
  pin: { label: 'Pin', icon: <><line x1="12" y1="21" x2="12" y2="13" /><path d="M8.5 3h7l-1.2 7 2.7 3H7l2.7-3z" /></> },
  'workflow-node': { label: 'Workflow node', icon: <><rect x="3" y="8" width="8" height="8" rx="2" /><rect x="13" y="8" width="8" height="8" rx="2" /><line x1="11" y1="12" x2="13" y2="12" /></> },
};

/**
 * A collapsible, labelled group of controls.
 *
 * The label rule runs to the chevron so the eye can find a section by its
 * heading alone while scrolling — in a column of small controls, a bare word
 * on its own line disappears.
 */
function Group({
  id, label, defaultOpen = true, children,
}: {
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // Lazy initialiser, not an effect: the canvas is client-only, so localStorage
  // is readable on the first render and there's no hydration pass to mismatch.
  const [open, setOpen] = useState<boolean>(() => readGroups()[id] ?? defaultOpen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeGroup(id, next);
  };

  return (
    <section className="flex flex-col">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 cursor-pointer group/sec"
        style={{ padding: '9px 2px 7px' }}
      >
        <span className="text-[9px] uppercase font-extrabold tracking-[0.15em] text-[var(--text-tertiary)] group-hover/sec:text-[var(--text-secondary)] transition-colors whitespace-nowrap">
          {label}
        </span>
        <span className="flex-1 h-px bg-[var(--border)]" />
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.18 }}
          className="flex items-center justify-center text-[var(--text-muted)] group-hover/sec:text-[var(--text-secondary)] transition-colors"
        >
          <Icon size={11}><polyline points="6 9 12 15 18 9" /></Icon>
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex flex-col gap-2.5" style={{ paddingBottom: 4 }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** A caption + its control, for the two-or-three sub-controls inside a group. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] uppercase font-extrabold tracking-[0.12em] text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

/** A squared tool button (icon or short label) with a clear active state. */
function OptBtn({
  active, onClick, title, children, height = 30,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`w-full rounded-[9px] flex items-center justify-center text-[11px] font-bold transition-all duration-150 cursor-pointer active:scale-[0.96] ${
        active
          ? 'clay-inset text-[var(--accent)] shadow-none'
          : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:brightness-[0.97]'
      }`}
      style={{ height }}
    >
      {children}
    </button>
  );
}

/** A round color swatch with a selected ring; transparent shows a checker. */
function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  const transparent = color === 'transparent';
  return (
    <button
      onClick={onClick}
      title={transparent ? 'Transparent' : color}
      className="w-full rounded-full shrink-0 transition-transform duration-150 hover:scale-110 active:scale-95 cursor-pointer"
      style={{
        aspectRatio: '1 / 1',
        background: transparent ? 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 9px 9px' : color,
        boxShadow: active
          ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
          : 'inset 0 0 0 1px rgba(128,128,128,0.28), 0 1px 2px rgba(90,62,40,0.10)',
      }}
    />
  );
}

/**
 * A full colour control: the 64-swatch grid, your recents, a hex field, the
 * OS colour dialog, and — where the browser supports it — a real eyedropper
 * that samples any pixel on the screen.
 *
 * All four ways of choosing feed the same `onChange`, and every committed
 * colour lands in recents, so the palette you actually use accumulates instead
 * of being re-hunted every time.
 */
function ColorField({
  value, onChange, allowTransparent = false,
}: {
  value: string | undefined;
  onChange: (c: string) => void;
  allowTransparent?: boolean;
}) {
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const [picking, setPicking] = useState(false);
  const [hexError, setHexError] = useState(false);

  /* The hex box shows the live colour until you start typing in it, then shows
     your draft until you commit or abandon it. Held as "draft or null" and
     resolved during render, so selecting a different block shows ITS colour
     without an effect that syncs one piece of state into another. */
  const [draft, setDraft] = useState<string | null>(null);
  /* Only ever show a real hex in the hex box. Some blocks are born with an
     `rgba(…)` fill from a theme, and echoing that into a six-digit field
     printed "#RGBA(255, 252, 248, 0.75" — a value you can't read and can't
     edit. An empty box with its RRGGBB placeholder says the truth: this colour
     isn't expressible here, type one that is. */
  const hex = draft ?? (value ? (normalizeHex(value) ?? '') : '');

  const commit = (c: string) => {
    onChange(c);
    setRecents(pushRecent(c));
    setDraft(null);
  };

  const commitHex = () => {
    if (draft === null) return;            // untouched — nothing to commit
    const norm = normalizeHex(draft);
    if (!norm) { setHexError(true); return; }
    setHexError(false);
    commit(norm);
  };

  const eyeDrop = async () => {
    const ED = getEyeDropper();
    if (!ED) return;
    try {
      setPicking(true);
      const { sRGBHex } = await new ED().open();
      if (sRGBHex) commit(sRGBHex.toUpperCase());
    } catch {
      /* the user pressed Escape — not an error */
    } finally {
      setPicking(false);
    }
  };

  const hasEyeDropper = !!getEyeDropper();
  /* Slightly wide of square on purpose. Eight columns across a 272px rail is a
     31px cell, and sixty-four of those is 270px of swatch — a third of the rail
     spent on one control, which pushed Motion and Arrange off the bottom for
     everybody. At 22px tall the same grid costs 200px and still reads as a
     palette (each row is one hue family, light to dark). */
  const swatch = (c: string, key: string, height: number) => (
    <button
      key={key}
      onClick={() => commit(c)}
      title={c}
      aria-label={c}
      className="w-full rounded-[5px] transition-transform duration-100 hover:scale-[1.18] active:scale-95 cursor-pointer"
      style={{
        height,
        background: c,
        boxShadow: (value || '').toLowerCase() === c.toLowerCase()
          ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
          : 'inset 0 0 0 1px rgba(128,128,128,0.28)',
      }}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {/* flatMap, not nested map: the rows are a layout convenience, and
          returning arrays-of-arrays leaves React without keys on the outer
          level. The grid does the wrapping. */}
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
        {SWATCH_GRID.flatMap((row, ri) => row.map((c, ci) => swatch(c, `${ri}-${ci}`, 22)))}
      </div>

      {recents.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[8.5px] uppercase font-extrabold tracking-[0.13em] text-[var(--text-muted)]">Recent</span>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}>
            {recents.map((c, i) => swatch(c, `r-${i}`, 18))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {/* Hex. Typed colours are committed on Enter or blur, never per
            keystroke — "#F0" is not a colour anyone meant to apply. */}
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--text-tertiary)] pointer-events-none">#</span>
          <input
            value={hex.replace('#', '')}
            onChange={(e) => { setDraft(e.target.value); setHexError(false); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitHex(); }}
            onBlur={commitHex}
            placeholder="RRGGBB"
            spellCheck={false}
            className="w-full bg-[var(--well)] rounded-lg text-[11px] font-mono uppercase outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--text-muted)] placeholder:normal-case"
            style={{
              padding: '6px 6px 6px 16px',
              boxShadow: hexError ? 'inset 0 0 0 1.5px #D64545' : 'inset 0 1px 2px rgba(90,62,40,0.06)',
            }}
          />
        </div>

        {/* OS colour dialog — the gradient/HSL picker, for free. */}
        <label
          title="Open the full colour picker"
          className="w-7 h-7 shrink-0 rounded-lg cursor-pointer flex items-center justify-center relative overflow-hidden"
          style={{ background: 'conic-gradient(#F00,#FF0,#0F0,#0FF,#00F,#F0F,#F00)' }}
        >
          <input
            type="color"
            value={normalizeHex(value || '') || '#000000'}
            onChange={(e) => commit(e.target.value.toUpperCase())}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Pick a colour"
          />
        </label>

        {hasEyeDropper && (
          <button
            onClick={eyeDrop}
            disabled={picking}
            title="Eyedropper — sample any colour on your screen"
            aria-label="Eyedropper"
            className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center transition-colors cursor-pointer active:scale-95 ${
              picking ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--accent)]'
            }`}
          >
            <Icon size={13}>
              <path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" />
              <path d="m15 6 3.5-3.5a2.12 2.12 0 0 1 3 3L18 9l.5.5a1.4 1.4 0 0 1 0 2l-1 1a1.4 1.4 0 0 1-2 0l-5-5a1.4 1.4 0 0 1 0-2l1-1a1.4 1.4 0 0 1 2 0Z" />
            </Icon>
          </button>
        )}

        {allowTransparent && (
          <button
            onClick={() => onChange('transparent')}
            title="No fill"
            aria-label="No fill"
            className="w-7 h-7 shrink-0 rounded-lg cursor-pointer active:scale-95 transition-transform"
            style={{
              background: 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 8px 8px',
              boxShadow: value === 'transparent' || !value
                ? '0 0 0 2px var(--accent)'
                : 'inset 0 0 0 1px rgba(128,128,128,0.3)',
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Every colour this object owns, one row each.
 *
 * Text has a colour AND a background; a shape has a fill AND a stroke. In the
 * old bottom strip these were tabs, because a horizontal bar could only ever
 * show one picker. A column can show the whole list — so each property gets a
 * row with its own chip and hex read-out, and clicking a row opens the full
 * grid under it. You can see what every colour currently IS without clicking,
 * which is most of what you came here to find out.
 */
function ColorRows({
  t, S, patch, isTextLike, frameColorable,
}: {
  t: string;
  S: Record<string, unknown>;
  patch: (kv: Record<string, unknown>) => void;
  isTextLike: boolean;
  frameColorable: boolean;
}) {
  const targets = useMemo(() => {
    const list: { id: string; label: string; value: string | undefined; key: string; transparent?: boolean }[] = [];
    if (isTextLike) {
      list.push({ id: 'text', label: 'Text', value: S.textColor as string, key: 'textColor' });
      list.push({ id: 'bg', label: 'Background', value: S.bgColor as string, key: 'bgColor', transparent: true });
    }
    if (t === 'shape') {
      list.push({ id: 'fill', label: 'Fill', value: S.color as string, key: 'color', transparent: true });
      list.push({ id: 'stroke', label: 'Stroke', value: S.strokeColor as string, key: 'strokeColor' });
    }
    if (t === 'arrow') {
      list.push({ id: 'arrow', label: 'Arrow', value: S.color as string, key: 'color' });
    }
    if (t === 'frame' && frameColorable) {
      list.push({ id: 'frame', label: 'Frame', value: S.frameColor as string, key: 'frameColor' });
    }
    return list;
  }, [t, isTextLike, frameColorable, S]);

  /* `undefined` means "nobody has chosen yet", which resolves to the first row
     being open — the one you almost always want. An explicit '' is you having
     folded them all away, and that must survive re-renders. */
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const open = openId === undefined ? targets[0]?.id : openId;

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {targets.map((tg) => {
        const isOpen = open === tg.id;
        const transparent = !tg.value || tg.value === 'transparent';
        return (
          <div key={tg.id} className="flex flex-col gap-1.5">
            <button
              onClick={() => setOpenId(isOpen ? '' : tg.id)}
              aria-expanded={isOpen}
              className={`w-full flex items-center gap-2 rounded-[10px] cursor-pointer transition-colors ${
                isOpen ? 'clay-inset' : 'bg-[var(--well)] hover:brightness-[0.97]'
              }`}
              style={{ padding: '6px 8px' }}
            >
              <span
                className="w-4 h-4 rounded-full shrink-0"
                style={{
                  background: transparent
                    ? 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 6px 6px'
                    : tg.value,
                  boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.35)',
                }}
              />
              <span className={`text-[11px] font-bold ${isOpen ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>{tg.label}</span>
              <span className="flex-1" />
              {/* A theme fill can be an `rgba(…)` string that would run the
                  width of the row; it gets one honest word instead. */}
              <span className="text-[9.5px] font-mono font-bold uppercase text-[var(--text-muted)] tracking-tight truncate" style={{ maxWidth: 92 }}>
                {transparent ? 'none' : (normalizeHex(tg.value || '') ?? 'custom')}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ paddingBottom: 4 }}>
                    <ColorField
                      value={tg.value}
                      allowTransparent={tg.transparent}
                      onChange={(c) => patch({ [tg.key]: c })}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function SelectionPanel() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const objects = useCanvasStore((s) => s.objects);
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const removeObject = useCanvasStore((s) => s.removeObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const duplicateObject = useCanvasStore((s) => s.duplicateObject);
  const addToTrash = useCanvasStore((s) => s.addToTrash);
  const connections = useCanvasStore((s) => s.connections);
  const bringToFront = useCanvasStore((s) => s.bringToFront);
  const sendToBack = useCanvasStore((s) => s.sendToBack);
  const bringForward = useCanvasStore((s) => s.bringForward);
  const sendBackward = useCanvasStore((s) => s.sendBackward);
  const arrowStyle = useCanvasStore((s) => s.arrowStyle);
  const setArrowStyle = useCanvasStore((s) => s.setArrowStyle);
  const textStyleDefaults = useCanvasStore((s) => s.textStyle);
  const setTextStyle = useCanvasStore((s) => s.setTextStyle);

  const obj = useMemo(() => objects.find((o) => o.id === selectedId) || null, [objects, selectedId]);

  const [fontQuery, setFontQuery] = useState('');
  const [linked, setLinked] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);

  /* The scroll shadows. A rail that's taller than the viewport has to SAY so —
     a hard-cut edge reads as the end of the panel, a faded one reads as more.
     Done with a mask on the scroller rather than two gradient overlays, so it
     costs nothing to keep correct in both themes. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shade, setShade] = useState({ top: false, bottom: false });

  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = {
      top: el.scrollTop > 3,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 3,
    };
    setShade((p) => (p.top === next.top && p.bottom === next.bottom ? p : next));
  };

  // After every render: groups open and close, and the selection changes what
  // is in the column at all. Converges in one pass — `measure` only sets state
  // when a value actually flipped.
  useLayoutEffect(measure);

  /* A new selection is a new panel, so it opens at the top. Without this you
     select a card after scrolling a text block's options and land halfway down
     someone else's controls, with the header above claiming to describe them. */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selectedId]);

  // And when the content resizes WITHOUT a render — a group's height animation,
  // a font list growing as you type.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // `measure` is deliberately out of the deps: it's re-created every render
    // and only reads live DOM, so re-attaching the observer for it would churn
    // for nothing. Re-attach when the rail's content is swapped wholesale.
  }, [selectedId, mode]);

  // Show for a selected object, OR for the arrow/text tool before anything is drawn
  const arrowDefault = !obj && mode === 'arrow';
  const textDefault = !obj && mode === 'text';
  const t = obj ? obj.type : arrowDefault ? 'arrow' : textDefault ? 'text' : null;

  // Unified style source + writer: a real object, tool defaults for arrow/text.
  const S: Record<string, unknown> = obj
    ? (obj.style || {})
    : arrowDefault
      ? (arrowStyle as unknown as Record<string, unknown>)
      : textDefault
        ? (textStyleDefaults as unknown as Record<string, unknown>)
        : {};

  const patch = (kv: Record<string, unknown>) => {
    if (obj) {
      const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      updateObject(obj.id, { style: { ...(cur?.style || obj.style), ...kv } });
    } else if (arrowDefault) {
      setArrowStyle(kv as Partial<typeof arrowStyle>);
    } else if (textDefault) {
      setTextStyle(kv as Partial<typeof textStyleDefaults>);
    }
  };

  const filteredFonts = useMemo(() => {
    const q = fontQuery.trim().toLowerCase();
    if (q) return FONTS.filter((f) => f.label.toLowerCase().includes(q));
    return FONTS.slice(0, 6);
  }, [fontQuery]);

  const isTextLike = t === 'text' || t === 'heading' || t === 'card' || t === 'sticky';
  const isHeadingCapable = t === 'text' || t === 'heading';
  const frameKind = t === 'frame' ? getFrameKind(obj) : 'normal';
  const opacity = ((S.opacity as number | undefined) ?? 1) * 100;
  const align = (S.textAlign as string) || 'left';
  const activeAnim = getAnimPreset((S.textAnim as TextAnimConfig | undefined)?.preset);

  const del = () => {
    if (!obj) return;
    const relatedConns = connections.filter((c) => c.fromId === obj.id || c.toId === obj.id);
    addToTrash({
      id: obj.id,
      label: (obj.content || obj.type || 'Card').slice(0, 24),
      color: obj.style?.color as string | undefined,
      originX: window.innerWidth / 2, originY: window.innerHeight / 2,
      objectData: obj, connectionsData: relatedConns,
    });
    removeObject(obj.id);
  };

  const copyLink = async () => {
    if (!obj) return;
    try {
      const url = `${window.location.origin}${window.location.pathname}${window.location.search}#o=${obj.id}`;
      await navigator.clipboard.writeText(url);
      setLinked(true);
      setTimeout(() => setLinked(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  const activeHeading = HEADINGS.find((h) => h.size === (S.fontSize as number) && h.weight === (S.fontWeight as number))?.id
    || (textDefault ? (S.headingLevel as string) : undefined);

  /* Header identity. A frame says which KIND of frame it is, because a delete
     frame and a grouping frame do very different things to what you drop in. */
  const meta = (t && TYPE_META[t]) || TYPE_META.text;
  const title = t === 'frame' && obj
    ? `${frameKindMeta(frameKind).label} frame`
    : meta.label;
  const subtitle = obj
    ? `${Math.round(obj.width)} × ${Math.round(obj.height)}`
    : textDefault ? 'Defaults for the next block'
    : 'Defaults for the next arrow';

  const maskStops = [
    shade.top ? 'rgba(0,0,0,0) 0px, #000 18px' : '#000 0px',
    shade.bottom ? '#000 calc(100% - 20px), rgba(0,0,0,0) 100%' : '#000 100%',
  ].join(', ');
  const mask = `linear-gradient(to bottom, ${maskStops})`;

  const iconBtn = 'w-[26px] h-[26px] rounded-[8px] flex items-center justify-center transition-colors cursor-pointer active:scale-95 shrink-0';

  return (
    <AnimatePresence>
      {/* The null check lives HERE, not as an early `return null` above the
          AnimatePresence — a component that unmounts itself never gets to play
          its exit animation, so the rail used to vanish in a frame. */}
      {t && !isTouring && (
        <motion.aside
          key="properties-rail"
          initial={{ opacity: 0, x: 22, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 22, scale: 0.97 }}
          transition={spring}
          onMouseDown={(e) => {
            e.stopPropagation();
            // Keep the caret in the text block being edited: pressing a format
            // button (size preset, +/-, heading, font, colour) must NOT blur the
            // contentEditable, otherwise an empty new block exits edit mode before
            // you can pick a size. Real inputs still need focus, so exempt them.
            const tag = (e.target as HTMLElement).tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') e.preventDefault();
          }}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="props-rail clay-card pointer-events-auto flow-hideable flex flex-col overflow-hidden"
          style={{ borderRadius: 20, fontFamily: "'Outfit', sans-serif" }}
        >
          {/* ---- Header: what's selected, and the two things you do to it ---- */}
          <div
            className="shrink-0 flex items-center gap-2.5"
            style={{ padding: '11px 11px 10px 13px', borderBottom: '1px solid var(--border)' }}
          >
            <span
              className="shrink-0 flex items-center justify-center"
              style={{ width: 27, height: 27, borderRadius: 9, background: 'var(--accent-subtle)', color: 'var(--accent)' }}
            >
              <Icon size={14}>{meta.icon}</Icon>
            </span>

            <div className="min-w-0 flex-1 flex flex-col gap-[2px]">
              <span className="text-[12.5px] font-extrabold leading-none truncate text-[var(--text-primary)]">{title}</span>
              <span className="text-[9.5px] font-semibold leading-none truncate text-[var(--text-tertiary)] tabular-nums">{subtitle}</span>
            </div>

            {obj && (
              <>
                <button
                  onClick={() => duplicateObject(obj.id)}
                  title="Duplicate"
                  aria-label="Duplicate"
                  className={`${iconBtn} bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]`}
                >
                  <Icon size={12}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
                </button>
                <button
                  onClick={del}
                  title="Delete"
                  aria-label="Delete"
                  className={`${iconBtn} bg-[var(--well)] text-[var(--text-secondary)] hover:text-white hover:bg-red-500`}
                >
                  <Icon size={12}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>
                </button>
              </>
            )}

            <button
              onClick={() => { if (obj) { setEditingId(null); setSelectedId(null); } else setMode('select'); }}
              title={obj ? 'Deselect' : 'Back to the select tool'}
              aria-label="Close"
              className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--well)]`}
            >
              <Icon size={13}><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></Icon>
            </button>
          </div>

          {/* ---- The controls. One scroller; the groups do the rest. ---- */}
          <div
            ref={scrollRef}
            onScroll={measure}
            className="props-rail-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
            style={{ padding: '2px 14px 14px', maskImage: mask, WebkitMaskImage: mask }}
          >
            <div className="flex flex-col">
              {/* Why the rail is open with nothing selected. */}
              {(textDefault || arrowDefault) && (
                <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]" style={{ paddingTop: 10 }}>
                  {textDefault
                    ? 'Set the style here, then click the canvas — the new block is born with it.'
                    : 'Click once to start the arrow, move, then click again to place it. It’ll use this style.'}
                </p>
              )}

              {/* A block whose look is its own content — say what DOES change it
                  rather than showing an empty rail. */}
              {(t === 'image' || t === 'mirror') && (
                <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]" style={{ paddingTop: 10 }}>
                  Tap the block on the canvas to cycle its shape, or open it full-view.
                </p>
              )}

              {/* TYPE SCALE — the five presets, each label set at its own weight */}
              {isHeadingCapable && (
                <Group id="scale" label="Type scale">
                  <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                    {HEADINGS.map((h) => (
                      <OptBtn
                        key={h.id}
                        active={activeHeading === h.id}
                        title={`${h.label} — ${h.size}px`}
                        onClick={() => patch({ fontSize: h.size, fontWeight: h.weight, headingLevel: h.id })}
                      >
                        <span style={{ fontSize: h.preview, fontWeight: h.id === 'body' ? 600 : 800, letterSpacing: '-0.01em' }}>{h.label}</span>
                      </OptBtn>
                    ))}
                  </div>
                </Group>
              )}

              {/* TYPEFACE — family, exact size, alignment */}
              {isTextLike && (
                <Group id="type" label="Typeface">
                  <input
                    value={fontQuery}
                    onChange={(e) => setFontQuery(e.target.value)}
                    placeholder="Search fonts…"
                    className="w-full bg-[var(--well)] rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--text-muted)]"
                    style={{ padding: '7px 10px', boxShadow: 'inset 0 1px 2px rgba(90,62,40,0.06)' }}
                  />
                  <div className="flex flex-wrap gap-1 overflow-y-auto props-rail-scroll" style={{ maxHeight: 118 }}>
                    {filteredFonts.map((f) => {
                      const isActive = S.fontFamily === f.value;
                      return (
                        <button
                          key={f.value}
                          onClick={() => patch({ fontFamily: f.value })}
                          style={{ fontFamily: f.value, padding: '6px 10px' }}
                          className={`rounded-lg text-[12px] leading-none truncate transition-colors cursor-pointer ${
                            isActive ? 'clay-inset text-[var(--accent)] font-bold' : 'bg-[var(--well)] text-[var(--text-primary)] hover:brightness-[0.97]'
                          }`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                    {filteredFonts.length === 0 && (
                      <span className="text-[10px] text-[var(--text-muted)]" style={{ padding: '4px 2px' }}>
                        No fonts match &ldquo;{fontQuery}&rdquo;.
                      </span>
                    )}
                  </div>

                  <Field label="Size">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => patch({ fontSize: Math.max(6, ((S.fontSize as number) || 15) - 1) })}
                          aria-label="Smaller"
                          className="w-7 h-7 shrink-0 rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                        >
                          <Icon size={12}><line x1="5" y1="12" x2="19" y2="12" /></Icon>
                        </button>
                        <input
                          type="number" min={6} max={200}
                          value={Math.round((S.fontSize as number) || 15)}
                          onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) patch({ fontSize: Math.max(6, Math.min(200, v)) }); }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-center bg-[var(--well)] rounded-lg text-[11px] font-bold tabular-nums outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                          style={{ padding: '7px 4px', boxShadow: 'inset 0 1px 2px rgba(90,62,40,0.06)' }}
                        />
                        <button
                          onClick={() => patch({ fontSize: Math.min(200, ((S.fontSize as number) || 15) + 1) })}
                          aria-label="Bigger"
                          className="w-7 h-7 shrink-0 rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                        >
                          <Icon size={12}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
                        </button>
                      </div>
                      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                        {SIZE_PRESETS.map((s) => (
                          <OptBtn key={s} height={26} active={Math.round((S.fontSize as number) || 15) === s} onClick={() => patch({ fontSize: s })}>
                            <span className="text-[10px] tabular-nums">{s}</span>
                          </OptBtn>
                        ))}
                      </div>
                    </div>
                  </Field>

                  <Field label="Alignment">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                      {([
                        ['left', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="18" y2="18" /></>],
                        ['center', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></>],
                        ['right', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="6" y1="18" x2="20" y2="18" /></>],
                      ] as const).map(([a, ic]) => (
                        <OptBtn key={a} active={align === a} title={`Align ${a}`} onClick={() => patch({ textAlign: a })}>
                          <Icon size={13}>{ic}</Icon>
                        </OptBtn>
                      ))}
                    </div>
                  </Field>
                </Group>
              )}

              {/* COLOUR — every colour this object owns, one row each */}
              {(isTextLike || t === 'shape' || t === 'arrow' || (t === 'frame' && frameKind === 'normal')) && (
                <Group id="colour" label="Colour">
                  {/* Grouping frames get the six identity colours as one-tap
                      chips too — a frame's colour is a label, not a shade you
                      hunt for. Delete / Scene / Ask-AI frames are locked to
                      theirs: that colour IS the warning. */}
                  {t === 'frame' && (
                    /* Fixed 26px cells rather than six across the full rail —
                       stretched to a third of the column each, one-tap chips
                       read as the main event instead of the shortcut they are. */
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 26px)', justifyContent: 'start' }}>
                      {FRAME_SWATCHES.map((c) => (
                        <Swatch key={c} color={c} active={(S.frameColor as string) === c} onClick={() => patch({ frameColor: c })} />
                      ))}
                    </div>
                  )}
                  <ColorRows t={t} S={S} patch={patch} isTextLike={isTextLike} frameColorable={frameKind === 'normal'} />
                </Group>
              )}

              {/* STROKE — width and dash, for anything drawn with a line */}
              {(t === 'shape' || t === 'arrow') && (
                <Group id="stroke" label="Stroke">
                  <Field label="Width">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                      {([['thin', 1.2], ['medium', 2.4], ['bold', 4]] as const).map(([w, px]) => {
                        const isActive = t === 'arrow'
                          ? ((S.thickness as number) || 3) === (w === 'thin' ? 2 : w === 'medium' ? 3 : 6)
                          : ((S.strokeWidth as string) || 'medium') === w;
                        return (
                          <OptBtn key={w} active={isActive} title={w}
                            onClick={() => patch(t === 'arrow' ? { thickness: w === 'thin' ? 2 : w === 'medium' ? 3 : 6 } : { strokeWidth: w })}>
                            <span className="rounded-full bg-current" style={{ width: 18, height: px }} />
                          </OptBtn>
                        );
                      })}
                    </div>
                  </Field>
                  <Field label="Style">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                      {([['solid', 'M3 12h18'], ['dashed', 'M3 12h4M10 12h4M17 12h4'], ['dotted', 'M4 12h.5M9 12h.5M14 12h.5M19 12h.5']] as const).map(([s, d]) => {
                        const key = t === 'arrow' ? 'dashStyle' : 'strokeStyle';
                        const cur = (S[key] as string) || 'solid';
                        return (
                          <OptBtn key={s} active={cur === s} title={s} onClick={() => patch({ [key]: s })}>
                            <Icon size={13}><path d={d} /></Icon>
                          </OptBtn>
                        );
                      })}
                    </div>
                  </Field>
                </Group>
              )}

              {/* ARROW — what it points with, and whether it bends */}
              {t === 'arrow' && (
                <Group id="arrow" label="Ends & curve">
                  <Field label="Head">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                      {/* Keyed: these are elements sitting in an array literal, so React
                          wants keys on them even though the array is static. */}
                      {([
                        ['line', <line key="l" x1="4" y1="12" x2="20" y2="12" />],
                        ['arrow', <React.Fragment key="a"><line x1="4" y1="12" x2="18" y2="12" /><polyline points="13 7 19 12 13 17" /></React.Fragment>],
                        ['dot', <React.Fragment key="d"><line x1="4" y1="12" x2="15" y2="12" /><circle cx="18" cy="12" r="3" fill="currentColor" /></React.Fragment>],
                        ['diamond', <React.Fragment key="dm"><line x1="4" y1="12" x2="14" y2="12" /><polygon points="18 8 22 12 18 16 14 12" fill="currentColor" /></React.Fragment>],
                      ] as const).map(([p, ic]) => (
                        <OptBtn key={p} active={((S.pointerType as string) || 'line') === p} title={p}
                          onClick={() => patch({ pointerType: p })}>
                          <Icon size={13}>{ic}</Icon>
                        </OptBtn>
                      ))}
                    </div>
                  </Field>

                  {obj && (
                    <Field label="Curve">
                      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                        <OptBtn active={S.bendX === undefined} title="Straight"
                          onClick={() => patch({ bendX: undefined, bendY: undefined })}>
                          <Icon size={13}><line x1="4" y1="12" x2="20" y2="12" /></Icon>
                        </OptBtn>
                        <OptBtn active={S.bendX !== undefined} title="Curved — then drag the middle handle"
                          onClick={() => {
                            const sx = (S.startX as number) || 0, sy = (S.startY as number) || 0;
                            const ex = (S.endX as number) || 0, ey = (S.endY as number) || 0;
                            const mx = (sx + ex) / 2, my = (sy + ey) / 2;
                            const nx = -(ey - sy), ny = ex - sx;
                            const len = Math.hypot(nx, ny) || 1;
                            patch({ bendX: mx + (nx / len) * 60, bendY: my + (ny / len) * 60 });
                          }}>
                          <Icon size={13}><path d="M4 16c6-12 10-12 16 0" /></Icon>
                        </OptBtn>
                      </div>
                    </Field>
                  )}
                </Group>
              )}

              {/* SKETCH — how hand-drawn the shape looks */}
              {t === 'shape' && (
                <Group id="sketch" label="Sketch">
                  <Field label="Sloppiness">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                      {([
                        ['architect', <path key="a" d="M4 12h16" />],
                        ['artist', <path key="b" d="M4 13c4-3 5 3 8 0s4-4 8-1" />],
                        ['cartoonist', <path key="c" d="M4 14c3-5 4 4 7-1s3 5 5-1 3 3 4-1" />],
                      ] as const).map(([sl, ic]) => (
                        <OptBtn key={sl} active={((S.sloppiness as string) || 'architect') === sl} title={sl}
                          onClick={() => patch({ sloppiness: sl })}>
                          <Icon size={13}>{ic}</Icon>
                        </OptBtn>
                      ))}
                    </div>
                  </Field>
                  <Field label="Corners">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      <OptBtn active={(S.edges || 'round') === 'round'} title="Round" onClick={() => patch({ edges: 'round' })}>
                        <Icon size={13}><path d="M5 19V9a4 4 0 0 1 4-4h10" /></Icon>
                      </OptBtn>
                      <OptBtn active={S.edges === 'sharp'} title="Sharp" onClick={() => patch({ edges: 'sharp' })}>
                        <Icon size={13}><path d="M5 5h14v14" /></Icon>
                      </OptBtn>
                    </div>
                  </Field>
                </Group>
              )}

              {/* MOTION — the effect gallery, and what's currently on */}
              {obj && isTextLike && (
                <Group id="motion" label="Motion">
                  <button
                    onClick={() => setAnimOpen((v) => !v)}
                    title="Text animation"
                    aria-pressed={animOpen || !!activeAnim}
                    className={`w-full rounded-[10px] flex items-center gap-2 text-[11px] font-bold transition-all duration-150 cursor-pointer active:scale-[0.99] ${
                      animOpen || activeAnim
                        ? 'clay-inset text-[var(--accent)]'
                        : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    style={{ padding: '8px 10px' }}
                  >
                    <LetterSparkIcon size={14} />
                    <span className="truncate">{activeAnim ? activeAnim.name : 'Animate this text'}</span>
                    <span className="flex-1" />
                    <Icon size={11}><polyline points="9 18 15 12 9 6" /></Icon>
                  </button>
                </Group>
              )}

              {/* ARRANGE — opacity and stacking order */}
              {obj && (
                <Group id="arrange" label="Arrange">
                  <Field label="Opacity">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="range" min={0} max={100} value={Math.round(opacity)}
                        onChange={(e) => patch({ opacity: parseInt(e.target.value) / 100 })}
                        className="flex-1 min-w-0 accent-[var(--accent)] cursor-pointer"
                        style={{ height: 4 }}
                      />
                      <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)] text-right" style={{ width: 26 }}>
                        {Math.round(opacity)}
                      </span>
                    </div>
                  </Field>
                  <Field label="Layer">
                    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                      <OptBtn title="Bring to front" onClick={() => bringToFront(obj.id)}>
                        <Icon size={13}><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M9 21h10a2 2 0 0 0 2-2V9" /></Icon>
                      </OptBtn>
                      <OptBtn title="Bring forward" onClick={() => bringForward(obj.id)}>
                        <Icon size={13}><polyline points="18 15 12 9 6 15" /></Icon>
                      </OptBtn>
                      <OptBtn title="Send backward" onClick={() => sendBackward(obj.id)}>
                        <Icon size={13}><polyline points="6 9 12 15 18 9" /></Icon>
                      </OptBtn>
                      <OptBtn title="Send to back" onClick={() => sendToBack(obj.id)}>
                        <Icon size={13}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 3H5a2 2 0 0 0-2 2v10" /></Icon>
                      </OptBtn>
                    </div>
                  </Field>
                </Group>
              )}

              {/* ACTIONS — rename, deep link */}
              {obj && (
                <Group id="actions" label="Actions" defaultOpen={false}>
                  {t === 'frame' && (
                    <button
                      onClick={() => setEditingId(obj.id)}
                      title="Rename frame (F2)"
                      className="w-full rounded-[10px] flex items-center gap-2 text-[11px] font-bold bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer active:scale-[0.99]"
                      style={{ padding: '8px 10px' }}
                    >
                      <Icon size={12}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
                      <span className="truncate">{frameTitle(obj) || 'Rename frame'}</span>
                    </button>
                  )}
                  <button
                    onClick={copyLink}
                    title="Copy a link that jumps straight to this block"
                    className={`w-full rounded-[10px] flex items-center gap-2 text-[11px] font-bold transition-colors cursor-pointer active:scale-[0.99] ${
                      linked ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    style={{ padding: '8px 10px' }}
                  >
                    {linked ? (
                      <><Icon size={12}><polyline points="20 6 9 17 4 12" /></Icon>Link copied</>
                    ) : (
                      <>
                        <Icon size={12}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Icon>
                        Copy link to this block
                      </>
                    )}
                  </button>
                </Group>
              )}
            </div>
          </div>

          {/* Text animation gallery — opens beside the rail, not over it */}
          <AnimatePresence>
            {obj && isTextLike && animOpen && (
              <TextAnimPanel
                value={S.textAnim as TextAnimConfig | undefined}
                onChange={(cfg) => patch({ textAnim: cfg })}
                onClose={() => setAnimOpen(false)}
              />
            )}
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
