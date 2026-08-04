'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * The rail's vocabulary.
 *
 * Every panel docked on the right — selection properties, the brush, the shape
 * catalogue, frames, the corkboard, workflows — is built from these six pieces
 * and nothing else. That's the point: before this, each tool's flyout invented
 * its own buttons, its own label size, its own idea of a swatch, so moving
 * between the pen and a selected block felt like moving between two apps.
 *
 * A note on spacing: every padding and margin here is an inline style or a
 * `gap-*`. The app's global reset (`* { margin: 0; padding: 0 }`) is unlayered,
 * so Tailwind's `p-*` / `m-*` utilities lose to it and silently do nothing.
 */

/* ---------------------------------------------------------------- icons -- */

export function Icon({ children, size = 14, strokeWidth = 2 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ChevronDown = <polyline points="6 9 12 15 18 9" />;
export const ChevronRight = <polyline points="9 18 15 12 9 6" />;

/* -------------------------------------------------- persisted group state -- */

/* Versioned. The rail used to open with Motion, Geometry, Arrange and Actions
   all shut, so half of what a block can do was behind a chevron nobody had a
   reason to press. They open by default now — but a remembered `false` from the
   old default would have quietly overridden that for every existing user, so
   the key moves and everyone starts from the new defaults once. */
const GROUPS_KEY = 'mindspace:inspector-groups:v2';

export function readGroups(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function writeGroup(id: string, open: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...readGroups(), [id]: open }));
  } catch {
    /* quota — the rail just won't remember this one */
  }
}

/**
 * A collapsible, labelled group of controls.
 *
 * The label's rule runs to the chevron so a section can be found by its heading
 * while scrolling — in a column of small controls, a bare word on its own line
 * disappears. What you collapse is remembered across selections and reloads.
 */
export function Group({
  id, label, defaultOpen = true, accessory, children,
}: {
  id: string;
  label: string;
  defaultOpen?: boolean;
  accessory?: React.ReactNode;
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
      <div className="w-full flex items-center gap-2 group/sec" style={{ padding: '9px 2px 7px' }}>
        <button onClick={toggle} aria-expanded={open} className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
          <span className="text-[9px] uppercase font-extrabold tracking-[0.15em] text-[var(--text-tertiary)] group-hover/sec:text-[var(--text-secondary)] transition-colors whitespace-nowrap">
            {label}
          </span>
          <span className="flex-1 h-px bg-[var(--border)]" />
        </button>
        {accessory}
        <button onClick={toggle} aria-hidden tabIndex={-1} className="flex items-center justify-center cursor-pointer text-[var(--text-muted)] group-hover/sec:text-[var(--text-secondary)] transition-colors">
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }} className="flex">
            <Icon size={11}>{ChevronDown}</Icon>
          </motion.span>
        </button>
      </div>

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

/** A caption + its control, for the sub-controls inside a group. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase font-extrabold tracking-[0.12em] text-[var(--text-muted)]">{label}</span>
        {hint && <span className="text-[9px] font-semibold text-[var(--text-muted)] tabular-nums" style={{ marginLeft: 'auto' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** A squared tool button (icon or short label) with a clear pressed state. */
export function OptBtn({
  active, onClick, title, children, height = 30, disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  height?: number;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={`w-full rounded-[9px] flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all duration-150 cursor-pointer active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed ${
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

/** A full-width action row: icon, label, optional trailing chevron. */
export function RowBtn({
  active, onClick, title, icon, children, trailing,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`w-full rounded-[10px] flex items-center gap-2 text-[11px] font-bold transition-colors cursor-pointer active:scale-[0.99] ${
        active ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
      style={{ padding: '8px 10px' }}
    >
      {icon}
      <span className="truncate">{children}</span>
      {trailing && <span className="flex items-center" style={{ marginLeft: 'auto' }}>{trailing}</span>}
    </button>
  );
}

/** A labelled slider with a live read-out. 0..1 in, 0..100 shown. */
export function Slider({
  label, value, onChange, min = 0, max = 1, step = 0.01, format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase font-extrabold tracking-[0.12em] text-[var(--text-muted)]">{label}</span>
        <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]" style={{ marginLeft: 'auto' }}>
          {format ? format(value) : `${Math.round(value * 100)}`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--accent)] cursor-pointer"
        style={{ height: 4 }}
      />
    </div>
  );
}

/** An on/off switch with its label. */
export function Toggle({
  label, hint, checked, onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center gap-2.5 rounded-[10px] bg-[var(--well)] cursor-pointer transition-colors hover:brightness-[0.97]"
      style={{ padding: '7px 10px' }}
    >
      <span className="flex flex-col items-start gap-[1px] min-w-0 flex-1">
        <span className="text-[11px] font-bold text-[var(--text-secondary)]">{label}</span>
        {hint && <span className="text-[9px] font-semibold text-[var(--text-muted)] truncate">{hint}</span>}
      </span>
      <span
        className="shrink-0 rounded-full transition-colors relative"
        style={{ width: 28, height: 16, background: checked ? 'var(--accent)' : 'var(--track)' }}
      >
        <motion.span
          className="absolute rounded-full bg-white"
          style={{ width: 12, height: 12, top: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
          animate={{ left: checked ? 14 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  );
}

/**
 * One choice out of a few, all of them visible.
 *
 * A dropdown hides the alternatives behind a click; for three or four options
 * that fit on a line, showing them IS the label — you can see what "above the
 * line" is an alternative to without opening anything.
 */
export function Segmented<T extends string>({
  value, onChange, options, height = 30,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode; title?: string }[];
  height?: number;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <OptBtn key={o.value} height={height} active={value === o.value} title={o.title || o.label} onClick={() => onChange(o.value)}>
          {o.icon}
          <span className="truncate text-[10.5px]">{o.label}</span>
        </OptBtn>
      ))}
    </div>
  );
}

/** A native select, dressed as a rail control. */
export function Select<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-[9px] bg-[var(--well)] text-[11px] font-bold text-[var(--text-secondary)] outline-none cursor-pointer focus:ring-2 focus:ring-[var(--accent)]/30"
      style={{ padding: '7px 8px', border: 'none', appearance: 'none' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/** A round colour swatch with a selected ring; transparent shows a checker. */
export function Swatch({ color, active, onClick, title }: { color: string; active: boolean; onClick: () => void; title?: string }) {
  const transparent = color === 'transparent';
  return (
    <button
      onClick={onClick}
      title={title || (transparent ? 'Transparent' : color)}
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

/* ------------------------------------------------------------- colours -- */

export const SWATCH_GRID: string[][] = [
  ['#FFFFFF', '#F1EDE7', '#D6D0C7', '#A9A199', '#78706A', '#4A443F', '#2D2A26', '#000000'],
  ['#FDECEC', '#F9C9C9', '#F09393', '#E45C5C', '#D64545', '#B32E2E', '#8A2020', '#5C1414'],
  ['#FDF0E4', '#F8D9B6', '#F0B87A', '#E89B4A', '#C97B4B', '#A65F30', '#7E4620', '#552E14'],
  ['#FFF9E0', '#FBEFB0', '#F5DE6B', '#E6C433', '#C9A81F', '#A08616', '#75620F', '#4C3F09'],
  ['#E9F7EF', '#C0E9D2', '#87D4AC', '#4CBA84', '#2F9E6E', '#237C56', '#19593D', '#0F3A28'],
  ['#E7F0FB', '#C3DBF6', '#8FBCEE', '#5A93E0', '#3E63DD', '#2E4CB0', '#213781', '#152354'],
  ['#F1EAFB', '#DBC8F4', '#BE9DEA', '#9E70DC', '#8B5FBF', '#6C4699', '#4E3170', '#331F4A'],
  ['#FCE8F1', '#F7C4DC', '#EF93BF', '#E4629F', '#E93D82', '#BC2A66', '#8C1C4A', '#5C0F2F'],
];

/** The one-tap favourites: a readable spread of the grid above. */
export const QUICK_COLORS = ['#FFFFFF', '#2D2A26', '#D64545', '#E67E22', '#E6C433', '#2F9E6E', '#3E63DD', '#8B5FBF'];

const RECENTS_KEY = 'mindspace:recent-colors';
const RECENTS_MAX = 12;

export function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((c) => typeof c === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(color: string): string[] {
  if (typeof window === 'undefined' || !color || color === 'transparent') return [];
  const next = [color, ...loadRecents().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, RECENTS_MAX);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota — the picker just won't remember this one */
  }
  return next;
}

/** Chrome/Edge ship a real screen colour picker; Safari/Firefox don't yet. */
type EyeDropperCtor = new () => { open: (opts?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> };
function getEyeDropper(): EyeDropperCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_RE.test(v)) return null;
  const body = v.replace('#', '');
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  return `#${full.toUpperCase()}`;
}

/**
 * The deep colour control: the 64-swatch grid, your recents, a hex field, the
 * OS colour dialog, and — where the browser supports it — a real eyedropper
 * that samples any pixel on the screen.
 *
 * All four ways of choosing feed the same `onChange`, and every committed
 * colour lands in recents, so the palette you actually use accumulates instead
 * of being re-hunted every time.
 */
export function ColorField({
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
     without an effect that syncs one piece of state into another.

     Only ever a real hex: some blocks are born with an `rgba(…)` fill from a
     theme, and echoing that into a six-digit field printed
     "#RGBA(255, 252, 248, 0.75" — unreadable and uneditable. */
  const [draft, setDraft] = useState<string | null>(null);
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
  /* Wide of square on purpose: eight columns across a 272px rail is a 31px
     cell, and sixty-four of those is 270px spent on one control. At 22px the
     same grid costs 200px and still reads as a palette — each row is one hue
     family, light to dark. */
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

export interface ColorTarget {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (c: string) => void;
  transparent?: boolean;
}

/**
 * Every colour a thing owns, one row each.
 *
 * Text has a colour AND a background; a shape has a fill AND a stroke. In the
 * old bottom strip these were tabs, because a horizontal bar could only show
 * one picker. A column can show the whole list — each property gets a row with
 * its chip, its hex read-out and eight one-tap favourites, and the deep picker
 * unfolds under whichever row you open. You can see what every colour IS, and
 * change it to a common one, without opening anything.
 */
export function ColorRows({ targets, defaultOpenId = '' }: { targets: ColorTarget[]; defaultOpenId?: string }) {
  /* Closed by default, and that's the point of the favourites strip below: the
     eight colours anyone actually reaches for are already on screen, so the
     64-swatch grid — 230px of panel — only unfolds when you want a colour that
     isn't one of them. Opening it by default pushed every group after Colour
     below the fold in every context. */
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const open = openId === undefined ? defaultOpenId : openId;

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
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
              <motion.span animate={{ rotate: isOpen ? 0 : -90 }} transition={{ duration: 0.18 }} className="flex text-[var(--text-muted)]">
                <Icon size={10}>{ChevronDown}</Icon>
              </motion.span>
            </button>

            {/* One-tap favourites, always visible. The whole point of the rail
                is that the common case costs nothing: eight colours here mean
                you only open the grid when you want an uncommon one. */}
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
              {QUICK_COLORS.map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  active={(tg.value || '').toLowerCase() === c.toLowerCase()}
                  onClick={() => { tg.onChange(c); pushRecent(c); }}
                />
              ))}
            </div>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ paddingTop: 2, paddingBottom: 4 }}>
                    <ColorField value={tg.value} allowTransparent={tg.transparent} onChange={tg.onChange} />
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

/** A search box sized for the rail. */
export function SearchBox({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none flex">
        <Icon size={12}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full bg-[var(--well)] rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--text-muted)]"
        style={{ padding: '7px 24px 7px 26px', boxShadow: 'inset 0 1px 2px rgba(90,62,40,0.06)' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Icon size={11}><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></Icon>
        </button>
      )}
    </div>
  );
}

/** A one-line explanation at the top of a tool's panel. */
export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]" style={{ paddingTop: 10 }}>
      {children}
    </p>
  );
}

/** Scrollable pill tabs, for domains and categories. */
export function PillTabs<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className={`rounded-full text-[10px] font-bold transition-all duration-150 cursor-pointer whitespace-nowrap ${
              on ? 'text-white' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            style={{ padding: '4px 10px', background: on ? 'var(--accent)' : undefined }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Memoised list filter helper shared by the font and shape pickers. */
export function useFiltered<T>(items: T[], query: string, key: (t: T) => string, cap?: number): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = q ? items.filter((i) => key(i).toLowerCase().includes(q)) : items;
    return cap && !q ? out.slice(0, cap) : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, cap]);
}
