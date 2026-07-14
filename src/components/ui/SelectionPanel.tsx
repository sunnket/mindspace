'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

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
const FILL_COLORS = ['transparent', '#FBE9DE', '#FDE7E7', '#E7F6EC', '#E5EDFB', '#F1E9FA', '#FCE8F1', '#F3EEE7'];
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
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-[140] pointer-events-auto"
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
                {t === 'shape' ? 'Shape' : t === 'arrow' ? 'Arrow' : t === 'frame' ? 'Frame' : 'Text'}
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
              {([
                ['line', <line x1="4" y1="12" x2="20" y2="12" />],
                ['arrow', <><line x1="4" y1="12" x2="18" y2="12" /><polyline points="13 7 19 12 13 17" /></>],
                ['dot', <><line x1="4" y1="12" x2="15" y2="12" /><circle cx="18" cy="12" r="3" fill="currentColor" /></>],
                ['diamond', <><line x1="4" y1="12" x2="14" y2="12" /><polygon points="18 8 22 12 18 16 14 12" fill="currentColor" /></>],
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

          {/* Frame color */}
          {t === 'frame' && (
            <>
              {['#C97B4B', '#45B761', '#4A90D9', '#9B59B6', '#E93D82', '#2D2A26'].map((c) => (
                <Swatch key={c} color={c} active={(S.frameColor as string) === c} onClick={() => patch({ frameColor: c })} />
              ))}
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
              className="clay-card rounded-2xl mt-2 p-3 max-w-[480px] w-[92vw] mx-auto max-h-[45vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex flex-col gap-3">

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

                {/* BACKGROUND / fill (text / shape) */}
                {(isTextLike || t === 'shape') && (
                  <Section label={t === 'shape' ? 'Fill' : 'Background'}>
                    <div className="flex flex-wrap gap-1.5">
                      {FILL_COLORS.map((c) => {
                        const current = t === 'shape' ? S.color : S.bgColor;
                        const isActive = current === c || (!current && c === 'transparent');
                        return (
                          <Swatch key={c} color={c} active={isActive}
                            onClick={() => patch(t === 'shape' ? { color: c } : { bgColor: c })} />
                        );
                      })}
                    </div>
                  </Section>
                )}

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

                {/* More color swatches */}
                {isTextLike && TEXT_COLORS.length > 6 && (
                  <Section label="All colors">
                    <div className="flex flex-wrap gap-1.5">
                      {TEXT_COLORS.map((c) => {
                        const isActive = (S.textColor as string) === c || (!S.textColor && c === '#2D2A26');
                        return <Swatch key={c} color={c} active={isActive} onClick={() => patch({ textColor: c })} />;
                      })}
                    </div>
                  </Section>
                )}

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

                    {/* Fill for shape */}
                    <Section label="Fill">
                      <div className="flex flex-wrap gap-1.5">
                        {FILL_COLORS.map((c) => {
                          const isActive = (S.color as string) === c || (!S.color && c === 'transparent');
                          return <Swatch key={c} color={c} active={isActive} onClick={() => patch({ color: c })} />;
                        })}
                      </div>
                    </Section>
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
                {/* Object-only: opacity */}
                {obj && (
                  <>
                    <HDivider />
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
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
