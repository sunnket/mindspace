'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import TextAnimPanel, { LetterSparkIcon } from '../TextAnimPanel';
import { getAnimPreset } from '@/lib/textAnim';
import type { TextAnimConfig } from '@/lib/textAnim';
import { getFrameKind, frameKindMeta, frameTitle } from '@/lib/frames';
import RailShell, { type RailAction } from './RailShell';
import ShapePicker from './ShapePicker';
import {
  Icon, Group, Field, OptBtn, RowBtn, Swatch, Slider, ColorRows, SearchBox,
  Hint, type ColorTarget,
} from './RailKit';

/**
 * Properties for whatever is selected — and for the text and arrow tools
 * before anything has been drawn with them.
 *
 * ORDER IS THE FEATURE HERE. Every type puts the controls that DEFINE it
 * first and colour after: an arrow opens on its head and its stroke, a shape
 * on which shape it is, text on its size. Colour is the thing you scroll for,
 * because it's the thing you change second. The previous build had it backwards
 * — every selection opened on a palette, and the width of the line you'd just
 * drawn was below the fold.
 */

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

/** A small labelled number box, four to a row. */
function NumBox({
  label, value, onChange, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex items-center gap-1 rounded-[9px] bg-[var(--well)] cursor-text" style={{ padding: '5px 6px', boxShadow: 'inset 0 1px 2px rgba(90,62,40,0.06)' }}>
      <span className="text-[9px] font-extrabold uppercase text-[var(--text-muted)] shrink-0">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full min-w-0 bg-transparent text-right text-[11px] font-bold tabular-nums text-[var(--text-primary)] outline-none"
      />
      {suffix && <span className="text-[9px] font-bold text-[var(--text-muted)] shrink-0">{suffix}</span>}
    </label>
  );
}

export default function SelectionRail() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const objects = useCanvasStore((s) => s.objects);
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
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

  if (!t) return null;

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
  const meta = TYPE_META[t] || TYPE_META.text;
  const title = t === 'frame' && obj ? `${frameKindMeta(frameKind).label} frame` : meta.label;
  const subtitle = obj
    ? `${Math.round(obj.width)} × ${Math.round(obj.height)}`
    : textDefault ? 'Defaults for the next block'
    : 'Defaults for the next arrow';

  const actions: RailAction[] = obj ? [
    {
      id: 'dup', title: 'Duplicate', onClick: () => duplicateObject(obj.id),
      icon: <Icon size={12}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>,
    },
    {
      id: 'del', title: 'Delete', danger: true, onClick: del,
      icon: <Icon size={12}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>,
    },
  ] : [];

  /* --- the colour targets this type owns --- */
  const colorTargets: ColorTarget[] = [];
  if (isTextLike) {
    colorTargets.push({ id: 'text', label: 'Text', value: S.textColor as string, onChange: (c) => patch({ textColor: c }) });
    colorTargets.push({ id: 'bg', label: 'Background', value: S.bgColor as string, transparent: true, onChange: (c) => patch({ bgColor: c }) });
  }
  if (t === 'shape') {
    colorTargets.push({ id: 'fill', label: 'Fill', value: S.color as string, transparent: true, onChange: (c) => patch({ color: c }) });
    colorTargets.push({ id: 'stroke', label: 'Stroke', value: S.strokeColor as string, onChange: (c) => patch({ strokeColor: c }) });
  }
  if (t === 'arrow') {
    colorTargets.push({ id: 'arrow', label: 'Arrow', value: S.color as string, onChange: (c) => patch({ color: c }) });
  }
  if (t === 'frame' && frameKind === 'normal') {
    colorTargets.push({ id: 'frame', label: 'Frame', value: S.frameColor as string, onChange: (c) => patch({ frameColor: c }) });
  }

  const strokeGroup = (
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
  );

  const colourGroup = colorTargets.length > 0 && (
    <Group id="colour" label="Colour">
      {/* Grouping frames get the six identity colours as one-tap chips too — a
          frame's colour is a label, not a shade you hunt for. Delete / Scene /
          Ask-AI frames are locked to theirs: that colour IS the warning. */}
      {t === 'frame' && frameKind === 'normal' && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 26px)', justifyContent: 'start' }}>
          {FRAME_SWATCHES.map((c) => (
            <Swatch key={c} color={c} active={(S.frameColor as string) === c} onClick={() => patch({ frameColor: c })} />
          ))}
        </div>
      )}
      <ColorRows targets={colorTargets} />
    </Group>
  );

  return (
    <RailShell
      railKey={`sel:${obj?.id || t}`}
      icon={<Icon size={14}>{meta.icon}</Icon>}
      title={title}
      subtitle={subtitle}
      actions={actions}
      closeTitle={obj ? 'Deselect' : 'Back to the select tool'}
      onClose={() => { if (obj) { setEditingId(null); setSelectedId(null); } else setMode('select'); }}
    >
      {/* Why the rail is open with nothing selected. */}
      {(textDefault || arrowDefault) && (
        <Hint>
          {textDefault
            ? 'Set the style here, then click the canvas — the new block is born with it.'
            : 'Click once to start the arrow, move, then click again to place it. It’ll use this style.'}
        </Hint>
      )}

      {(t === 'image' || t === 'mirror') && (
        <Hint>Tap the block on the canvas to cycle its shape, or open it full-view.</Hint>
      )}

      {/* ============ WHAT THIS THING IS ============ */}

      {/* ARROW — the head and the bend, first. This is what you came for after
          drawing one; the colour of it is a second thought. */}
      {t === 'arrow' && (
        <Group id="arrow-ends" label="Ends & curve">
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

      {/* SHAPE — which glyph it is. Swapping one placed shape for another used
          to mean deleting it and going back to the tool. */}
      {t === 'shape' && obj && (
        <Group id="shape-type" label="Shape">
          <ShapePicker
            value={S.shapeType as string}
            onPick={(id) => patch({ shapeType: id })}
          />
        </Group>
      )}

      {/* TEXT — the scale, then the face. */}
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

      {isTextLike && (
        <Group id="type" label="Typeface">
          {/* A live specimen. Setting up a style used to require typing
              something first — an empty block shows only its placeholder, and
              with the text tool up there is no block at all, so every choice
              here was made blind. This is the face, the size, the weight, the
              colour and the alignment you have actually selected. */}
          <div
            className="rounded-[10px] overflow-hidden"
            style={{
              background: (S.bgColor as string) && S.bgColor !== 'transparent' ? (S.bgColor as string) : 'var(--well)',
              padding: '10px 12px',
            }}
          >
            <div
              className="truncate"
              style={{
                fontFamily: (S.fontFamily as string) || "'Inter', sans-serif",
                fontWeight: (S.fontWeight as number) || 400,
                // Clamped: an H1 at 40px would blow the rail apart, but the
                // relative jump between the presets still reads.
                fontSize: Math.max(11, Math.min(26, ((S.fontSize as number) || 15) * 0.62)),
                color: (S.textColor as string) || 'var(--text-primary)',
                textAlign: (align as 'left' | 'center' | 'right'),
                lineHeight: 1.35,
              }}
            >
              {obj?.content?.trim()?.slice(0, 28) || 'The quick brown fox'}
            </div>
          </div>

          <SearchBox value={fontQuery} onChange={setFontQuery} placeholder="Search fonts…" />
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

      {/* Stroke sits above colour for both of the things drawn with a line. */}
      {(t === 'shape' || t === 'arrow') && strokeGroup}

      {/* ============ THEN HOW IT LOOKS ============ */}
      {colourGroup}

      {/* SKETCH — hand-drawn character, below the colour it's applied to. */}
      {t === 'shape' && (
        <Group id="sketch" label="Sketch" defaultOpen={false}>
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

      {/* MOTION — the effect gallery, and what's currently on. */}
      {obj && isTextLike && (
        <Group id="motion" label="Motion" defaultOpen={false}>
          <RowBtn
            active={animOpen || !!activeAnim}
            onClick={() => setAnimOpen((v) => !v)}
            title="Text animation"
            icon={<LetterSparkIcon size={14} />}
            trailing={<Icon size={11}><polyline points="9 18 15 12 9 6" /></Icon>}
          >
            {activeAnim ? activeAnim.name : 'Animate this text'}
          </RowBtn>
        </Group>
      )}

      {/* ============ AND WHERE IT SITS ============ */}

      {/* GEOMETRY — exact position and size. Dragging is for roughing out;
          two blocks that must line up need numbers. */}
      {obj && t !== 'arrow' && (
        <Group id="geometry" label="Geometry" defaultOpen={false}>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <NumBox label="X" value={obj.x} onChange={(v) => updateObject(obj.id, { x: v })} />
            <NumBox label="Y" value={obj.y} onChange={(v) => updateObject(obj.id, { y: v })} />
            {/* `isResized` is what tells a text block to stop auto-growing —
                without it the height you type is overwritten on the next
                keystroke. */}
            <NumBox label="W" value={obj.width} onChange={(v) => updateObject(obj.id, { width: Math.max(8, v), style: { ...(obj.style || {}), isResized: true } })} />
            <NumBox label="H" value={obj.height} onChange={(v) => updateObject(obj.id, { height: Math.max(8, v), style: { ...(obj.style || {}), isResized: true } })} />
          </div>
          <Slider
            label="Rotation"
            value={obj.rotation || 0}
            min={-180} max={180} step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => updateObject(obj.id, { rotation: v })}
          />
          {!!obj.rotation && (
            <OptBtn height={26} onClick={() => updateObject(obj.id, { rotation: 0 })} title="Reset rotation">
              <span className="text-[10px]">Straighten</span>
            </OptBtn>
          )}
        </Group>
      )}

      {obj && (
        <Group id="arrange" label="Arrange" defaultOpen={false}>
          <Slider label="Opacity" value={opacity} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`}
            onChange={(v) => patch({ opacity: v / 100 })} />
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

      {obj && (
        <Group id="actions" label="Actions" defaultOpen={false}>
          {t === 'frame' && (
            <RowBtn
              onClick={() => setEditingId(obj.id)}
              title="Rename frame (F2)"
              icon={<Icon size={12}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>}
            >
              {frameTitle(obj) || 'Rename frame'}
            </RowBtn>
          )}
          <RowBtn
            active={linked}
            onClick={copyLink}
            title="Copy a link that jumps straight to this block"
            icon={linked
              ? <Icon size={12}><polyline points="20 6 9 17 4 12" /></Icon>
              : <Icon size={12}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Icon>}
          >
            {linked ? 'Link copied' : 'Copy link to this block'}
          </RowBtn>
        </Group>
      )}

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
    </RailShell>
  );
}
