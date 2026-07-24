'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import TextAnimPanel, { LetterSparkIcon } from './TextAnimPanel';
import type { TextAnimConfig } from '@/lib/textAnim';
import { getFrameKind, frameKindMeta, frameTitle } from '@/lib/frames';

/**
 * Contextual properties panel — a compact horizontal strip that appears just
 * above the floating toolbar. Collapsed: a single row of quick-access controls.
 * Expanded: a wider card with full options (font search, size stepper, layers,
 * opacity, actions). Works for text objects, shapes, arrows, frames — and also
 * shows text defaults when in text mode before anything is created.
 */

const spring = { type: 'spring' as const, stiffness: 360, damping: 32 };

/* ---- option palettes ---- */
const TEXT_COLORS = ['#FFFFFF', '#2D2A26', '#D64545', '#E67E22', '#2F9E6E', '#3E63DD', '#8B5FBF', '#E93D82'];

/**
 * The full picker: eight hue families × eight steps, light to dark.
 *
 * The quick strip in the collapsed bar is still eight one-tap favourites — this
 * is what "more options" is for. Laid out as a grid rather than a wrapped row
 * so a colour is found by aiming (this hue, that darkness) instead of scanning.
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
const STROKE_COLORS = ['#FFFFFF', '#2D2A26', '#D64545', '#2F9E6E', '#3E63DD', '#E67E22', '#8B5FBF'];
const ARROW_COLORS = ['#2D2A26', '#D64545', '#E67E22', '#2F9E6E', '#3E63DD', '#8B5FBF'];

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

const HEADINGS: { id: string; label: string; size: number; weight: number }[] = [
  { id: 'h1', label: 'H1', size: 40, weight: 700 },
  { id: 'h2', label: 'H2', size: 30, weight: 700 },
  { id: 'h3', label: 'H3', size: 24, weight: 600 },
  { id: 'h4', label: 'H4', size: 19, weight: 600 },
  { id: 'body', label: 'Body', size: 15, weight: 400 },
];

const SIZE_PRESETS = [12, 14, 16, 20, 24, 32, 48, 64];

/* ---- building blocks ---- */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] uppercase font-extrabold tracking-[0.13em] text-[var(--text-tertiary)]">{label}</span>
      {children}
    </div>
  );
}

function Icon({ children, size = 14 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A squared tool button (icon or short label) with a clear active state. */
function OptBtn({ active, onClick, title, children, wide = false }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-7 ${wide ? 'flex-1 px-1.5' : 'w-7'} rounded-lg flex items-center justify-center text-[11px] font-bold transition-all duration-150 cursor-pointer active:scale-95 ${
        active
          ? 'clay-inset text-[var(--accent)] shadow-none'
          : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:brightness-[0.97] shadow-[inset_0_1px_2px_rgba(90,62,40,0.06)]'
      }`}
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
      className="w-5.5 h-5.5 rounded-full shrink-0 transition-transform duration-150 hover:scale-110 active:scale-95 cursor-pointer"
      style={{
        background: transparent ? 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 9px 9px' : color,
        boxShadow: active
          ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
          : 'inset 0 0 0 1px rgba(45,42,38,0.14), 0 1px 2px rgba(90,62,40,0.10)',
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
  // Lazy initialiser, not an effect: the canvas is client-only, so localStorage
  // is readable on the first render and there's no hydration pass to mismatch.
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const [picking, setPicking] = useState(false);
  const [hexError, setHexError] = useState(false);

  /* The hex box shows the live colour until you start typing in it, then shows
     your draft until you commit or abandon it. Held as "draft or null" and
     resolved during render, so selecting a different block shows ITS colour
     without an effect that syncs one piece of state into another. */
  const [draft, setDraft] = useState<string | null>(null);
  const hex = draft ?? (value && value !== 'transparent' ? value.toUpperCase() : '');

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
  const swatch = (c: string, key: string) => (
    <button
      key={key}
      onClick={() => commit(c)}
      title={c}
      aria-label={c}
      className="w-full rounded-[5px] transition-transform duration-100 hover:scale-[1.18] active:scale-95 cursor-pointer"
      style={{
        aspectRatio: '1 / 1',
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
        {SWATCH_GRID.flatMap((row, ri) => row.map((c, ci) => swatch(c, `${ri}-${ci}`)))}
      </div>

      {recents.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[8.5px] uppercase font-extrabold tracking-[0.13em] text-[var(--text-tertiary)]">Recent</span>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}>
            {recents.map((c, i) => swatch(c, `r-${i}`))}
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
              padding: '5px 6px 5px 16px',
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
 * Every colour this object owns, behind one picker.
 *
 * Text has a colour AND a background, a shape has a fill AND a stroke. Giving
 * each its own permanent swatch row meant none of them could afford the full
 * grid, so all of them got eight fixed chips and no way to reach anything else.
 * Tabs mean one field, full width, with the whole palette + hex + eyedropper —
 * and it costs one click to switch which property you're aiming at.
 */
function ColorTabs({
  t, S, patch, isTextLike,
}: {
  t: string;
  S: Record<string, unknown>;
  patch: (kv: Record<string, unknown>) => void;
  isTextLike: boolean;
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
    if (t === 'frame') {
      list.push({ id: 'frame', label: 'Frame', value: S.frameColor as string, key: 'frameColor' });
    }
    return list;
  }, [t, isTextLike, S]);

  const [active, setActive] = useState(0);
  // The tab list changes with the selection; an index left over from a shape
  // would point past the end of a text block's shorter list.
  const idx = Math.min(active, Math.max(0, targets.length - 1));
  const target = targets[idx];
  if (!target) return null;

  return (
    <Section label="Colour">
      {targets.length > 1 && (
        <div className="flex items-center gap-1" style={{ marginBottom: 2 }}>
          {targets.map((tg, i) => (
            <button
              key={tg.id}
              onClick={() => setActive(i)}
              aria-pressed={i === idx}
              className={`flex items-center gap-1.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                i === idx ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              style={{ padding: '4px 9px' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: tg.value && tg.value !== 'transparent'
                    ? tg.value
                    : 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 5px 5px',
                  boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.35)',
                }}
              />
              {tg.label}
            </button>
          ))}
        </div>
      )}
      <ColorField
        key={target.id}
        value={target.value}
        allowTransparent={target.transparent}
        onChange={(c) => patch({ [target.key]: c })}
      />
    </Section>
  );
}

function VDivider() {
  return <div className="w-px h-5 bg-[var(--border)] mx-1 shrink-0" />;
}

function HDivider() {
  return <div className="w-full h-px bg-[var(--border)]" />;
}

export default function SelectionPanel() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const objects = useCanvasStore((s) => s.objects);
  const mode = useCanvasStore((s) => s.mode);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const removeObject = useCanvasStore((s) => s.removeObject);
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
  const [expanded, setExpanded] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);

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

  if (!t || isTouring) return null;

  const isTextLike = t === 'text' || t === 'heading' || t === 'card' || t === 'sticky';
  const isHeadingCapable = t === 'text' || t === 'heading';
  const opacity = ((S.opacity as number | undefined) ?? 1) * 100;
  const align = (S.textAlign as string) || 'left';

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

  return (
    <AnimatePresence>
      <motion.div
        key="selection-panel"
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
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
        className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-[140] pointer-events-auto flow-hideable"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        {/* --- Compact collapsed strip --- */}
        <div className="clay-card rounded-2xl px-3 py-2 flex items-center gap-1.5 max-w-[92vw] overflow-x-auto custom-scrollbar">
          {/* Panel label */}
          {textDefault && (
            <>
              <span className="text-[9px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)] whitespace-nowrap mr-1">Text</span>
              <VDivider />
            </>
          )}
          {arrowDefault && (
            <>
              <span className="text-[9px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)] whitespace-nowrap mr-1">Arrow</span>
              <VDivider />
            </>
          )}
          {obj && (
            <>
              <span className="text-[9px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)] whitespace-nowrap mr-1">
                {t === 'shape' ? 'Shape'
                  : t === 'arrow' ? 'Arrow'
                  : t === 'frame' ? `${frameKindMeta(getFrameKind(obj)).label} frame`
                  : 'Text'}
              </span>
              <VDivider />
            </>
          )}

          {/* Quick heading presets (text-like) */}
          {isHeadingCapable && (
            <>
              {HEADINGS.map((h) => (
                <OptBtn key={h.id} active={activeHeading === h.id} title={h.label}
                  onClick={() => patch({ fontSize: h.size, fontWeight: h.weight, headingLevel: h.id })}>
                  <span className="text-[10px]">{h.label}</span>
                </OptBtn>
              ))}
              <VDivider />
            </>
          )}

          {/* Quick color swatches (text color / stroke / arrow color) */}
          {(isTextLike ? TEXT_COLORS : t === 'arrow' ? ARROW_COLORS : t === 'shape' ? STROKE_COLORS : []).slice(0, 6).map((c) => {
            const current = isTextLike ? S.textColor : t === 'arrow' ? S.color : S.borderColor;
            const isActive = current === c || (!current && isTextLike && c === '#2D2A26') || (!current && t === 'arrow' && c === '#2D2A26');
            return (
              <Swatch key={c} color={c} active={!!isActive}
                onClick={() => patch(isTextLike ? { textColor: c } : t === 'arrow' ? { color: c } : { borderColor: c })} />
            );
          })}

          {(isTextLike || t === 'arrow' || t === 'shape') && <VDivider />}

          {/* Quick align (text-like) */}
          {isTextLike && (
            <>
              {([
                ['left', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="18" y2="18" /></>],
                ['center', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></>],
                ['right', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="6" y1="18" x2="20" y2="18" /></>],
              ] as const).map(([a, ic]) => (
                <OptBtn key={a} active={align === a} title={a} onClick={() => patch({ textAlign: a })}>
                  <Icon size={12}>{ic}</Icon>
                </OptBtn>
              ))}
              <VDivider />
            </>
          )}

          {/* Arrow head quick access */}
          {t === 'arrow' && (
            <>
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
                  <Icon size={12}>{ic}</Icon>
                </OptBtn>
              ))}
              <VDivider />
            </>
          )}

          {/* Stroke width (shape / arrow) */}
          {(t === 'shape' || t === 'arrow') && (
            <>
              {([['thin', 1.2], ['medium', 2.4], ['bold', 4]] as const).map(([w, px]) => {
                const isActive = t === 'arrow'
                  ? ((S.thickness as number) || 3) === (w === 'thin' ? 2 : w === 'medium' ? 3 : 6)
                  : ((S.strokeWidth as string) || 'medium') === w;
                return (
                  <OptBtn key={w} active={isActive} title={w}
                    onClick={() => patch(t === 'arrow' ? { thickness: w === 'thin' ? 2 : w === 'medium' ? 3 : 6 } : { strokeWidth: w })}>
                    <span className="rounded-full bg-current" style={{ width: 16, height: px }} />
                  </OptBtn>
                );
              })}
              <VDivider />
            </>
          )}

          {/* Frame colour — grouping frames only. Delete / Scene / Ask-AI
              frames are locked to their identity colour (that colour is the
              warning), and their controls live in the frame's own HUD. */}
          {t === 'frame' && getFrameKind(obj) === 'normal' && (
            <>
              {['#C97B4B', '#45B761', '#4A90D9', '#9B59B6', '#E93D82', '#2D2A26'].map((c) => (
                <Swatch key={c} color={c} active={(S.frameColor as string) === c} onClick={() => patch({ frameColor: c })} />
              ))}
              <VDivider />
            </>
          )}

          {/* Rename — the frame's title tab is the primary affordance, but a
              frame buried under its own contents is easier to rename from here. */}
          {t === 'frame' && obj && (
            <>
              <button
                onClick={() => setEditingId(obj.id)}
                title="Rename frame (F2)"
                className="h-7 rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer active:scale-95 shrink-0"
                style={{ padding: '0 8px' }}
              >
                <Icon size={12}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
                <span className="text-[10px] max-w-[110px] truncate">{frameTitle(obj)}</span>
              </button>
              <VDivider />
            </>
          )}

          {/* Text animation — opens the effect gallery for this block */}
          {obj && isTextLike && (
            <>
              <button
                onClick={() => setAnimOpen((v) => !v)}
                title="Text animation"
                aria-pressed={animOpen || !!(S.textAnim as TextAnimConfig | undefined)?.preset}
                className={`h-7 rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold transition-all duration-150 cursor-pointer active:scale-95 shrink-0 ${
                  animOpen || (S.textAnim as TextAnimConfig | undefined)?.preset
                    ? 'clay-inset text-[var(--accent)]'
                    : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                style={{ padding: '0 8px' }}
              >
                <LetterSparkIcon size={13} />
                <span className="text-[10px]">Animate</span>
              </button>
              <VDivider />
            </>
          )}

          {/* Object-only quick actions */}
          {obj && (
            <>
              <OptBtn title="Duplicate" onClick={() => duplicateObject(obj.id)}>
                <Icon size={12}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
              </OptBtn>
              <button
                onClick={del} title="Delete"
                className="h-7 w-7 rounded-lg flex items-center justify-center bg-[var(--well)] text-[var(--text-secondary)] hover:text-white hover:bg-red-500 transition-colors cursor-pointer active:scale-95">
                <Icon size={12}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>
              </button>
              <VDivider />
            </>
          )}

          {/* Expand / collapse toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse panel' : 'More options'}
            className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 shrink-0 ${
              expanded
                ? 'clay-inset text-[var(--accent)]'
                : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center"
            >
              <Icon size={12}><polyline points="6 9 12 15 18 9" /></Icon>
            </motion.span>
          </button>
        </div>

        {/* --- Expanded detail panel --- */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              /* Inline padding, and this is the bug behind the clipped labels:
                 Tailwind's `p-3` is dead here (the app's unlayered global
                 `* { padding: 0 }` reset wins), so the content sat flush against
                 the card's 16px rounded corner and the corner ate the first
                 letter of the top-left heading — "BACKGROUND" rendered as
                 "ACKGROUND". Same reason `mt-2` never applied. Both are inline
                 now. Wider too (640 vs 480), with the sections in two columns so
                 the extra width buys layout instead of just stretching rows. */
              style={{ padding: 16, marginTop: 8 }}
              className="clay-card rounded-2xl max-w-[640px] w-[94vw] mx-auto max-h-[52vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex flex-col gap-3.5">

                {/* Text/heading defaults hint */}
                {textDefault && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                    Set your text style, then click on the canvas to create a block with these defaults.
                  </p>
                )}
                {arrowDefault && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                    Click once to start the arrow, move, then click again to place it — it&apos;ll use this style.
                  </p>
                )}

                {/* COLOUR — one tabbed field instead of three separate swatch
                    rows, so text/background/stroke all get the full grid, the
                    hex box and the eyedropper rather than eight fixed chips. */}
                <ColorTabs t={t} S={S} patch={patch} isTextLike={isTextLike} />

                <HDivider />

                {/* FONT — search reveals more */}
                {isTextLike && (
                  <>
                    <Section label="Font">
                      <input
                        value={fontQuery}
                        onChange={(e) => setFontQuery(e.target.value)}
                        placeholder="Search fonts…"
                        className="w-full bg-[var(--well)] rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--text-muted)] shadow-[inset_0_1px_2px_rgba(90,62,40,0.06)]"
                      />
                      <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                        {filteredFonts.map((f) => {
                          const isActive = S.fontFamily === f.value;
                          return (
                            <button key={f.value} onClick={() => patch({ fontFamily: f.value })}
                              style={{ fontFamily: f.value }}
                              className={`px-2.5 py-1.5 rounded-lg text-[12px] leading-none truncate transition-colors cursor-pointer ${
                                isActive ? 'clay-inset text-[var(--accent)] font-bold' : 'bg-[var(--well)] text-[var(--text-primary)] hover:brightness-[0.97]'
                              }`}>
                              {f.label}
                            </button>
                          );
                        })}
                        {filteredFonts.length === 0 && <span className="text-[10px] text-[var(--text-muted)] px-2 py-1">No fonts match &ldquo;{fontQuery}&rdquo;.</span>}
                      </div>
                    </Section>

                    <HDivider />

                    {/* FONT SIZE */}
                    <Section label="Size">
                      <div className="flex items-center gap-1">
                        <button onClick={() => patch({ fontSize: Math.max(6, ((S.fontSize as number) || 15) - 1) })}
                          className="w-6 h-6 rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform">
                          <Icon size={12}><line x1="5" y1="12" x2="19" y2="12" /></Icon>
                        </button>
                        <input
                          type="number" min={6} max={200}
                          value={Math.round((S.fontSize as number) || 15)}
                          onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) patch({ fontSize: Math.max(6, Math.min(200, v)) }); }}
                          className="w-10 text-center bg-[var(--well)] rounded-lg px-1 py-1 text-[11px] font-bold tabular-nums outline-none focus:ring-2 focus:ring-[var(--accent)]/30 shadow-[inset_0_1px_2px_rgba(90,62,40,0.06)]"
                        />
                        <button onClick={() => patch({ fontSize: Math.min(200, ((S.fontSize as number) || 15) + 1) })}
                          className="w-6 h-6 rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform">
                          <Icon size={12}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
                        </button>
                        <div className="flex gap-1 ml-1">
                          {SIZE_PRESETS.map((s) => (
                            <OptBtn key={s} active={Math.round((S.fontSize as number) || 15) === s} onClick={() => patch({ fontSize: s })}>
                              <span className="text-[9px] tabular-nums">{s}</span>
                            </OptBtn>
                          ))}
                        </div>
                      </div>
                    </Section>
                  </>
                )}

                {/* "All colors" used to sit here — an eight-chip row that only
                    ever set the TEXT colour. The tabbed picker above covers it
                    with the full grid, hex and eyedropper. */}

                {/* STROKE STYLE (shape / arrow) */}
                {(t === 'shape' || t === 'arrow') && (
                  <Section label="Stroke style">
                    <div className="flex gap-1">
                      {([['solid', 'M3 12h18'], ['dashed', 'M3 12h4M10 12h4M17 12h4'], ['dotted', 'M4 12h.5M9 12h.5M14 12h.5M19 12h.5']] as const).map(([s, d]) => {
                        const key = t === 'arrow' ? 'dashStyle' : 'strokeStyle';
                        const cur = (S[key] as string) || 'solid';
                        return (
                          <OptBtn key={s} wide active={cur === s} title={s} onClick={() => patch({ [key]: s })}>
                            <Icon size={12}><path d={d} /></Icon>
                          </OptBtn>
                        );
                      })}
                    </div>
                  </Section>
                )}

                {/* SLOPPINESS + EDGES (shape) */}
                {t === 'shape' && (
                  <>
                    <Section label="Sloppiness">
                      <div className="flex gap-1">
                        {([
                          ['architect', <path key="a" d="M4 12h16" />],
                          ['artist', <path key="b" d="M4 13c4-3 5 3 8 0s4-4 8-1" />],
                          ['cartoonist', <path key="c" d="M4 14c3-5 4 4 7-1s3 5 5-1 3 3 4-1" />],
                        ] as const).map(([sl, ic]) => (
                          <OptBtn key={sl} wide active={((S.sloppiness as string) || 'architect') === sl} title={sl}
                            onClick={() => patch({ sloppiness: sl })}>
                            <Icon size={12}>{ic}</Icon>
                          </OptBtn>
                        ))}
                      </div>
                    </Section>
                    <Section label="Edges">
                      <div className="flex gap-1">
                        <OptBtn wide active={(S.edges || 'round') === 'round'} title="Round" onClick={() => patch({ edges: 'round' })}>
                          <Icon size={12}><path d="M5 19V9a4 4 0 0 1 4-4h10" /></Icon>
                        </OptBtn>
                        <OptBtn wide active={S.edges === 'sharp'} title="Sharp" onClick={() => patch({ edges: 'sharp' })}>
                          <Icon size={12}><path d="M5 5h14v14" /></Icon>
                        </OptBtn>
                      </div>
                    </Section>

                    {/* Shape fill lives in the Colour tabs above now, alongside
                        its stroke — they're chosen together, so they belong
                        together rather than at opposite ends of the panel. */}
                  </>
                )}

                {/* Arrow curve */}
                {t === 'arrow' && obj && (
                  <Section label="Curve">
                    <div className="flex gap-1">
                      <OptBtn wide active={S.bendX === undefined} title="Straight"
                        onClick={() => patch({ bendX: undefined, bendY: undefined })}>
                        <Icon size={12}><line x1="4" y1="12" x2="20" y2="12" /></Icon>
                      </OptBtn>
                      <OptBtn wide active={S.bendX !== undefined} title="Curved — then drag the middle handle"
                        onClick={() => {
                          const sx = (S.startX as number) || 0, sy = (S.startY as number) || 0;
                          const ex = (S.endX as number) || 0, ey = (S.endY as number) || 0;
                          const mx = (sx + ex) / 2, my = (sy + ey) / 2;
                          const nx = -(ey - sy), ny = ex - sx;
                          const len = Math.hypot(nx, ny) || 1;
                          patch({ bendX: mx + (nx / len) * 60, bendY: my + (ny / len) * 60 });
                        }}>
                        <Icon size={12}><path d="M4 16c6-12 10-12 16 0" /></Icon>
                      </OptBtn>
                    </div>
                  </Section>
                )}
                {/* Object-only: opacity, stacking order, deep link.
                    Layer ordering and copy-link were already wired up in the
                    store and the component — they just had no control anywhere
                    in the UI, so the code sat dead. They're the two things you
                    reach for from a properties panel and couldn't. */}
                {obj && (
                  <>
                    <HDivider />
                    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                      <Section label="Opacity">
                        <div className="flex items-center gap-2">
                          <input
                            type="range" min={0} max={100} value={Math.round(opacity)}
                            onChange={(e) => patch({ opacity: parseInt(e.target.value) / 100 })}
                            className="flex-1 accent-[var(--accent)] cursor-pointer h-1"
                          />
                          <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)] w-6 text-right">{Math.round(opacity)}</span>
                        </div>
                      </Section>

                      <Section label="Layer">
                        <div className="flex gap-1">
                          <OptBtn wide title="Bring to front" onClick={() => bringToFront(obj.id)}>
                            <Icon size={12}><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M9 21h10a2 2 0 0 0 2-2V9" /></Icon>
                          </OptBtn>
                          <OptBtn wide title="Bring forward" onClick={() => bringForward(obj.id)}>
                            <Icon size={12}><polyline points="18 15 12 9 6 15" /></Icon>
                          </OptBtn>
                          <OptBtn wide title="Send backward" onClick={() => sendBackward(obj.id)}>
                            <Icon size={12}><polyline points="6 9 12 15 18 9" /></Icon>
                          </OptBtn>
                          <OptBtn wide title="Send to back" onClick={() => sendToBack(obj.id)}>
                            <Icon size={12}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 3H5a2 2 0 0 0-2 2v10" /></Icon>
                          </OptBtn>
                        </div>
                      </Section>
                    </div>

                    <Section label="Link">
                      <button
                        onClick={copyLink}
                        title="Copy a link that jumps straight to this block"
                        className={`w-full rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-bold transition-colors cursor-pointer active:scale-[0.99] ${
                          linked ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        style={{ padding: '7px 10px' }}
                      >
                        {linked ? (
                          <><Icon size={12}><polyline points="20 6 9 17 4 12" /></Icon>Copied</>
                        ) : (
                          <><Icon size={12}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Icon>Copy link to this block</>
                        )}
                      </button>
                    </Section>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text animation gallery popover */}
        <AnimatePresence>
          {obj && isTextLike && animOpen && (
            <TextAnimPanel
              value={S.textAnim as TextAnimConfig | undefined}
              onChange={(cfg) => patch({ textAnim: cfg })}
              onClose={() => setAnimOpen(false)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
