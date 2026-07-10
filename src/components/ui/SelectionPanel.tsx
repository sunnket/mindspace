'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * Contextual properties panel — the floating card that appears on the left the
 * moment you select any object (or pick the arrow tool). It reshapes itself to
 * what you're working on: text gets headings / fonts / alignment, shapes get
 * stroke & fill & edges, arrows get heads & bend, and everything selectable gets
 * opacity, layers & actions. Compact on the outside, complete on the inside.
 */

const spring = { type: 'spring' as const, stiffness: 360, damping: 32 };

/* ---- option palettes ---- */
const TEXT_COLORS = ['#2D2A26', '#FFFFFF', '#D64545', '#E67E22', '#2F9E6E', '#3E63DD', '#8B5FBF', '#E93D82'];
const FILL_COLORS = ['transparent', '#FBE9DE', '#FDE7E7', '#E7F6EC', '#E5EDFB', '#F1E9FA', '#FCE8F1', '#F3EEE7'];
const STROKE_COLORS = ['#2D2A26', '#D64545', '#2F9E6E', '#3E63DD', '#E67E22', '#8B5FBF'];
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
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase font-extrabold tracking-[0.13em] text-[var(--text-tertiary)]">{label}</span>
      {children}
    </div>
  );
}

function Icon({ children, size = 15 }: { children: React.ReactNode; size?: number }) {
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
      className={`h-9 ${wide ? 'flex-1 px-2' : 'w-9'} rounded-xl flex items-center justify-center text-[12px] font-bold transition-all duration-150 cursor-pointer active:scale-95 ${
        active
          ? 'bg-[var(--accent)] text-white shadow-[0_5px_14px_-5px_rgba(201,123,75,0.75),inset_0_1px_0_rgba(255,255,255,0.35)]'
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
      className="w-7 h-7 rounded-full shrink-0 transition-transform duration-150 hover:scale-110 active:scale-95 cursor-pointer"
      style={{
        background: transparent ? 'repeating-conic-gradient(#c4b8ab 0% 25%, #fff 0% 50%) 50% / 9px 9px' : color,
        boxShadow: active
          ? '0 0 0 2px var(--accent), 0 0 0 4px var(--accent-subtle)'
          : 'inset 0 0 0 1px rgba(45,42,38,0.14), 0 1px 2px rgba(90,62,40,0.10)',
      }}
    />
  );
}

function Divider() {
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

  const obj = useMemo(() => objects.find((o) => o.id === selectedId) || null, [objects, selectedId]);

  const [fontQuery, setFontQuery] = useState('');
  const [linked, setLinked] = useState(false);

  // Show for a selected object, OR for the arrow tool before anything is drawn
  // (so its options are available up front, not only after finishing the arrow).
  const arrowDefault = !obj && mode === 'arrow';
  const t = obj ? obj.type : arrowDefault ? 'arrow' : null;

  // Unified style source + writer: a real object, or the arrow tool defaults.
  const S: Record<string, unknown> = obj ? (obj.style || {}) : (arrowStyle as unknown as Record<string, unknown>);
  const patch = (kv: Record<string, unknown>) => {
    if (obj) {
      const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      updateObject(obj.id, { style: { ...(cur?.style || obj.style), ...kv } });
    } else {
      setArrowStyle(kv);
    }
  };

  const filteredFonts = useMemo(() => {
    const q = fontQuery.trim().toLowerCase();
    if (q) return FONTS.filter((f) => f.label.toLowerCase().includes(q));
    return FONTS.slice(0, 4); // roomy default — search reveals the rest
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

  const activeHeading = HEADINGS.find((h) => h.size === (S.fontSize as number) && h.weight === (S.fontWeight as number))?.id;

  return (
    <AnimatePresence>
      <motion.div
        key="selection-panel"
        initial={{ opacity: 0, x: -14, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: -14, scale: 0.97 }}
        transition={spring}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="fixed left-4 top-1/2 -translate-y-1/2 z-[140] w-[224px] max-h-[88vh] overflow-y-auto custom-scrollbar clay-card rounded-[22px] p-4 flex flex-col gap-4 pointer-events-auto"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        {arrowDefault && (
          <div className="flex items-center gap-2 -mb-1">
            <span className="w-6 h-6 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Icon size={14}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></Icon>
            </span>
            <span className="text-[12px] font-bold text-[var(--text-primary)]">Arrow style</span>
          </div>
        )}

        {/* HEADINGS (text) */}
        {isHeadingCapable && (
          <Section label="Heading">
            <div className="flex gap-1.5">
              {HEADINGS.map((h) => (
                <OptBtn key={h.id} wide active={activeHeading === h.id} title={h.label}
                  onClick={() => patch({ fontSize: h.size, fontWeight: h.weight, headingLevel: h.id })}>
                  {h.label}
                </OptBtn>
              ))}
            </div>
          </Section>
        )}

        {/* STROKE / text color */}
        <Section label={isTextLike ? 'Text color' : 'Stroke'}>
          <div className="flex flex-wrap gap-2">
            {(isTextLike ? TEXT_COLORS : t === 'arrow' ? ARROW_COLORS : STROKE_COLORS).map((c) => {
              const current = isTextLike ? S.textColor : t === 'arrow' ? S.color : S.borderColor;
              const active = current === c || (!current && isTextLike && c === '#2D2A26') || (!current && t === 'arrow' && c === '#2D2A26');
              return (
                <Swatch key={c} color={c} active={!!active}
                  onClick={() => patch(isTextLike ? { textColor: c } : t === 'arrow' ? { color: c } : { borderColor: c })} />
              );
            })}
          </div>
        </Section>

        {/* BACKGROUND / fill */}
        {(isTextLike || t === 'shape') && (
          <Section label={t === 'shape' ? 'Fill' : 'Background'}>
            <div className="flex flex-wrap gap-2">
              {FILL_COLORS.map((c) => {
                const current = t === 'shape' ? S.color : S.bgColor;
                const active = current === c || (!current && c === 'transparent');
                return (
                  <Swatch key={c} color={c} active={active}
                    onClick={() => patch(t === 'shape' ? { color: c } : { bgColor: c })} />
                );
              })}
            </div>
          </Section>
        )}

        {/* FONT — roomy: 4 shown, search reveals the rest */}
        {isTextLike && (
          <Section label="Font">
            <input
              value={fontQuery}
              onChange={(e) => setFontQuery(e.target.value)}
              placeholder="Search all fonts…"
              className="w-full bg-[var(--well)] rounded-xl px-3 py-2 text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--text-muted)] shadow-[inset_0_1px_2px_rgba(90,62,40,0.06)]"
            />
            <div className="flex flex-col gap-1.5 max-h-[188px] overflow-y-auto custom-scrollbar -mx-0.5 px-0.5">
              {filteredFonts.map((f) => {
                const active = S.fontFamily === f.value;
                return (
                  <button key={f.value} onClick={() => patch({ fontFamily: f.value })}
                    style={{ fontFamily: f.value }}
                    className={`text-left px-3 py-2.5 rounded-xl text-[14px] leading-none truncate transition-colors cursor-pointer ${
                      active ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_-6px_rgba(201,123,75,0.7)]' : 'bg-[var(--well)] text-[var(--text-primary)] hover:brightness-[0.97]'
                    }`}>
                    {f.label}
                  </button>
                );
              })}
              {filteredFonts.length === 0 && <span className="text-[11px] text-[var(--text-muted)] px-2 py-2">No fonts match “{fontQuery}”.</span>}
            </div>
          </Section>
        )}

        {/* FONT SIZE (numbers) */}
        {isTextLike && (
          <Section label="Size">
            <div className="flex items-center gap-1.5">
              <button onClick={() => patch({ fontSize: Math.max(6, ((S.fontSize as number) || 15) - 1) })}
                className="w-8 h-8 rounded-xl bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform">
                <Icon size={14}><line x1="5" y1="12" x2="19" y2="12" /></Icon>
              </button>
              <input
                type="number" min={6} max={200}
                value={Math.round((S.fontSize as number) || 15)}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) patch({ fontSize: Math.max(6, Math.min(200, v)) }); }}
                className="flex-1 min-w-0 text-center bg-[var(--well)] rounded-xl px-1 py-2 text-[13px] font-bold tabular-nums outline-none focus:ring-2 focus:ring-[var(--accent)]/30 shadow-[inset_0_1px_2px_rgba(90,62,40,0.06)]"
              />
              <button onClick={() => patch({ fontSize: Math.min(200, ((S.fontSize as number) || 15) + 1) })}
                className="w-8 h-8 rounded-xl bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform">
                <Icon size={14}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {SIZE_PRESETS.map((s) => (
                <OptBtn key={s} active={Math.round((S.fontSize as number) || 15) === s} onClick={() => patch({ fontSize: s })} wide>
                  <span className="text-[11px] tabular-nums">{s}</span>
                </OptBtn>
              ))}
            </div>
          </Section>
        )}

        {/* TEXT ALIGN */}
        {isTextLike && (
          <Section label="Align">
            <div className="flex gap-1.5">
              {([
                ['left', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="18" y2="18" /></>],
                ['center', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></>],
                ['right', <><line x1="4" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="6" y1="18" x2="20" y2="18" /></>],
              ] as const).map(([a, ic]) => (
                <OptBtn key={a} wide active={align === a} title={a} onClick={() => patch({ textAlign: a })}>
                  <Icon>{ic}</Icon>
                </OptBtn>
              ))}
            </div>
          </Section>
        )}

        {/* STROKE WIDTH (shape / arrow) */}
        {(t === 'shape' || t === 'arrow') && (
          <Section label="Stroke width">
            <div className="flex gap-1.5">
              {([['thin', 1.4], ['medium', 2.8], ['bold', 4.4]] as const).map(([w, px]) => {
                const active = t === 'arrow'
                  ? ((S.thickness as number) || 3) === (w === 'thin' ? 2 : w === 'medium' ? 3 : 6)
                  : ((S.strokeWidth as string) || 'medium') === w;
                return (
                  <OptBtn key={w} wide active={active} title={w}
                    onClick={() => patch(t === 'arrow' ? { thickness: w === 'thin' ? 2 : w === 'medium' ? 3 : 6 } : { strokeWidth: w })}>
                    <span className="rounded-full bg-current" style={{ width: 20, height: px }} />
                  </OptBtn>
                );
              })}
            </div>
          </Section>
        )}

        {/* STROKE STYLE (shape / arrow) */}
        {(t === 'shape' || t === 'arrow') && (
          <Section label="Stroke style">
            <div className="flex gap-1.5">
              {([['solid', 'M3 12h18'], ['dashed', 'M3 12h4M10 12h4M17 12h4'], ['dotted', 'M4 12h.5M9 12h.5M14 12h.5M19 12h.5']] as const).map(([s, d]) => {
                const key = t === 'arrow' ? 'dashStyle' : 'strokeStyle';
                const cur = (S[key] as string) || 'solid';
                return (
                  <OptBtn key={s} wide active={cur === s} title={s} onClick={() => patch({ [key]: s })}>
                    <Icon><path d={d} /></Icon>
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
              <div className="flex gap-1.5">
                {([
                  ['architect', <path d="M4 12h16" />],
                  ['artist', <path d="M4 13c4-3 5 3 8 0s4-4 8-1" />],
                  ['cartoonist', <path d="M4 14c3-5 4 4 7-1s3 5 5-1 3 3 4-1" />],
                ] as const).map(([sl, ic]) => (
                  <OptBtn key={sl} wide active={((S.sloppiness as string) || 'architect') === sl} title={sl}
                    onClick={() => patch({ sloppiness: sl })}>
                    <Icon>{ic}</Icon>
                  </OptBtn>
                ))}
              </div>
            </Section>
            <Section label="Edges">
              <div className="flex gap-1.5">
                <OptBtn wide active={(S.edges || 'round') === 'round'} title="Round" onClick={() => patch({ edges: 'round' })}>
                  <Icon><path d="M5 19V9a4 4 0 0 1 4-4h10" /></Icon>
                </OptBtn>
                <OptBtn wide active={S.edges === 'sharp'} title="Sharp" onClick={() => patch({ edges: 'sharp' })}>
                  <Icon><path d="M5 5h14v14" /></Icon>
                </OptBtn>
              </div>
            </Section>
          </>
        )}

        {/* ARROW head + bend */}
        {t === 'arrow' && (
          <>
            <Section label="Arrow head">
              <div className="flex gap-1.5">
                {([
                  ['line', <line x1="4" y1="12" x2="20" y2="12" />],
                  ['arrow', <><line x1="4" y1="12" x2="18" y2="12" /><polyline points="13 7 19 12 13 17" /></>],
                  ['dot', <><line x1="4" y1="12" x2="15" y2="12" /><circle cx="18" cy="12" r="3" fill="currentColor" /></>],
                  ['diamond', <><line x1="4" y1="12" x2="14" y2="12" /><polygon points="18 8 22 12 18 16 14 12" fill="currentColor" /></>],
                ] as const).map(([p, ic]) => (
                  <OptBtn key={p} wide active={((S.pointerType as string) || 'line') === p} title={p}
                    onClick={() => patch({ pointerType: p })}>
                    <Icon>{ic}</Icon>
                  </OptBtn>
                ))}
              </div>
            </Section>
            {obj && (
              <Section label="Curve">
                <div className="flex gap-1.5">
                  <OptBtn wide active={S.bendX === undefined} title="Straight"
                    onClick={() => patch({ bendX: undefined, bendY: undefined })}>
                    <Icon><line x1="4" y1="12" x2="20" y2="12" /></Icon>
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
                    <Icon><path d="M4 16c6-12 10-12 16 0" /></Icon>
                  </OptBtn>
                </div>
              </Section>
            )}
          </>
        )}

        {/* FRAME color */}
        {t === 'frame' && (
          <Section label="Frame color">
            <div className="flex flex-wrap gap-2">
              {['#C97B4B', '#45B761', '#4A90D9', '#9B59B6', '#E93D82', '#2D2A26'].map((c) => (
                <Swatch key={c} color={c} active={(S.frameColor as string) === c} onClick={() => patch({ frameColor: c })} />
              ))}
            </div>
          </Section>
        )}

        {/* Object-only sections */}
        {obj && (
          <>
            <Divider />
            <Section label="Opacity">
              <div className="flex items-center gap-2.5">
                <input
                  type="range" min={0} max={100} value={Math.round(opacity)}
                  onChange={(e) => patch({ opacity: parseInt(e.target.value) / 100 })}
                  className="flex-1 accent-[var(--accent)] cursor-pointer"
                />
                <span className="text-[12px] font-bold tabular-nums text-[var(--text-secondary)] w-8 text-right">{Math.round(opacity)}</span>
              </div>
            </Section>

            <Section label="Layers">
              <div className="flex gap-1.5">
                {([
                  ['To back', <><polyline points="7 13 12 18 17 13" /><line x1="12" y1="3" x2="12" y2="18" /><line x1="4" y1="21" x2="20" y2="21" /></>, () => sendToBack(obj.id)],
                  ['Backward', <polyline points="7 10 12 15 17 10" />, () => sendBackward(obj.id)],
                  ['Forward', <polyline points="7 14 12 9 17 14" />, () => bringForward(obj.id)],
                  ['To front', <><polyline points="7 11 12 6 17 11" /><line x1="12" y1="6" x2="12" y2="21" /><line x1="4" y1="3" x2="20" y2="3" /></>, () => bringToFront(obj.id)],
                ] as const).map(([label, ic, fn]) => (
                  <OptBtn key={label} wide title={label} onClick={fn}>
                    <Icon>{ic}</Icon>
                  </OptBtn>
                ))}
              </div>
            </Section>

            <Section label="Actions">
              <div className="flex gap-1.5">
                <OptBtn wide title="Duplicate" onClick={() => duplicateObject(obj.id)}>
                  <Icon><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
                </OptBtn>
                <button
                  onClick={del} title="Delete"
                  className="h-9 flex-1 px-2 rounded-xl flex items-center justify-center bg-[var(--well)] text-[var(--text-secondary)] hover:text-white hover:bg-red-500 transition-colors cursor-pointer active:scale-95">
                  <Icon><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>
                </button>
                <OptBtn wide title={linked ? 'Link copied!' : 'Copy link'} onClick={copyLink} active={linked}>
                  {linked
                    ? <Icon><polyline points="20 6 9 17 4 12" /></Icon>
                    : <Icon><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Icon>}
                </OptBtn>
              </div>
            </Section>
          </>
        )}

        {arrowDefault && (
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)] -mt-1">
            Click once to start the arrow, move, then click again to place it — it&apos;ll use this style.
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
