'use client';

/**
 * Immersive PDF Reader — a full-screen "reading room" for dropped PDFs (v2).
 *
 * Opened from a PDF file block (FileBlock). Portaled to <body>, above all canvas
 * chrome, mounted only while open (usePdfReaderStore). Real pages are rendered
 * client-side with pdf.js (lib/pdf/pdfReader); everything else is the experience:
 *
 *   • Scroll layout (one big page + a sliding thumbnail filmstrip) and a real
 *     hardcover Book layout — leather boards, thickening page-edge stacks, a
 *     sunken gutter, a ribbon marker, and a 3D page-curl turn (front/back faces
 *     + a curved sheen that sweeps as the page bows).
 *   • Original (true pdf.js raster + selectable text) and Typeset (text reflowed
 *     in a reading font of your choice, at your size / line-height).
 *   • Aged paper — a real sepia FILTER on the page content + foxing + edge-brown.
 *   • Rooms — a dozen layered, realistic atmospheres (Focus, Candlelight, Rainy,
 *     Starlit, Library, Forest, Autumn, Snowfall, Ocean, Golden Hour, Romance…).
 *   • Annotate — highlighter, freehand ink (perfect-freehand), sticky notes,
 *     drop-pins, an eraser, select-to-clip, and Ask-AI.
 *
 * All of it (page, mode, room, aged, bookmarks, highlights, ink, stickies, pins)
 * is saved on the object's style.pdfReader — persisted (isDirty → IndexedDB +
 * Supabase for signed-in users) and flushed synchronously on close.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getStroke } from 'perfect-freehand';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import { useCanvasStore } from '@/store/canvasStore';
import { getFileForBlock, extractTextForBlock } from '@/lib/fileIngest';
import { PdfSession, type TextSpan } from '@/lib/pdf/pdfReader';
import { playWhoosh, playSnap, startRain, stopRain } from '@/lib/relaxAudio';

/* ------------------------------- model ---------------------------------- */

type Atmos = 'clean' | 'focus' | 'candle' | 'library' | 'rain' | 'night'
  | 'forest' | 'autumn' | 'snow' | 'ocean' | 'sunset' | 'romance';
type Layout = 'scroll' | 'book';
type RenderMode = 'original' | 'typeset';
type FontKey = 'serif' | 'sans' | 'story' | 'type' | 'antique' | 'legible';
type Tool = 'none' | 'highlight' | 'draw' | 'sticky' | 'pin' | 'eraser';

interface Highlight { id: string; page: number; x: number; y: number; w: number; h: number; color: string }
interface Stroke { id: string; page: number; pts: number[][]; color: string; size: number }
interface Sticky { id: string; page: number; x: number; y: number; text: string; color: string; rot: number }
interface Pin { id: string; page: number; x: number; y: number; note: string }

interface ReaderState {
  page: number; layout: Layout; render: RenderMode; atmos: Atmos; aged: boolean;
  zoom: number; font: FontKey; fontSize: number; lineHeight: number; strip: boolean;
  bookmarks: number[]; highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[]; pins: Pin[];
}

const DEFAULTS: ReaderState = {
  page: 1, layout: 'scroll', render: 'original', atmos: 'library', aged: false,
  zoom: 1, font: 'serif', fontSize: 18, lineHeight: 1.7, strip: true,
  bookmarks: [], highlights: [], drawings: [], stickies: [], pins: [],
};

function initState(raw: unknown): ReaderState {
  const r = (raw && typeof raw === 'object') ? raw as Partial<ReaderState> : {};
  const atmos = ROOMS.some((x) => x.key === r.atmos) ? r.atmos! : DEFAULTS.atmos;
  return {
    ...DEFAULTS, ...r, atmos,
    page: Math.max(1, r.page || 1),
    bookmarks: arr(r.bookmarks), highlights: arr(r.highlights),
    drawings: arr(r.drawings), stickies: arr(r.stickies), pins: arr(r.pins),
  };
}
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? v as T[] : []; }

const FONTS: Record<FontKey, { label: string; css: string }> = {
  serif:   { label: 'Serif',      css: "'Lora', Georgia, 'Times New Roman', serif" },
  sans:    { label: 'Sans',       css: "'Outfit', system-ui, sans-serif" },
  story:   { label: 'Storybook',  css: "'Shantell Sans', 'Comic Sans MS', cursive" },
  type:    { label: 'Typewriter', css: "'Special Elite', 'Courier New', monospace" },
  antique: { label: 'Antique',    css: "'Cinzel', 'Playfair Display', serif" },
  legible: { label: 'Legible',    css: "'Comfortaa', 'Trebuchet MS', sans-serif" },
};

const ROOMS: { key: Atmos; label: string; group: string; grad: string }[] = [
  { key: 'clean',   label: 'Clean',       group: 'Ambience', grad: 'linear-gradient(160deg,#3c3c42,#16161a)' },
  { key: 'focus',   label: 'Focus',       group: 'Ambience', grad: 'radial-gradient(circle at 50% 30%,#1a1512,#050403)' },
  { key: 'candle',  label: 'Candlelight', group: 'Ambience', grad: 'linear-gradient(160deg,#3a2410,#0a0503)' },
  { key: 'library', label: 'Library',     group: 'Ambience', grad: 'linear-gradient(160deg,#4a3320,#160d06)' },
  { key: 'rain',    label: 'Rainy',       group: 'Ambience', grad: 'linear-gradient(160deg,#1c2732,#070d14)' },
  { key: 'night',   label: 'Starlit',     group: 'Ambience', grad: 'radial-gradient(circle at 70% 20%,#2a2d55,#05050f)' },
  { key: 'forest',  label: 'Forest',      group: 'Nature',   grad: 'linear-gradient(160deg,#1f3a24,#08130b)' },
  { key: 'autumn',  label: 'Autumn',      group: 'Nature',   grad: 'linear-gradient(160deg,#4a2f16,#150c05)' },
  { key: 'snow',    label: 'Snowfall',    group: 'Nature',   grad: 'linear-gradient(160deg,#33465a,#0d151f)' },
  { key: 'ocean',   label: 'Ocean',       group: 'Nature',   grad: 'linear-gradient(160deg,#123a3d,#041314)' },
  { key: 'sunset',  label: 'Golden Hour', group: 'Mood',     grad: 'linear-gradient(160deg,#6a3320,#241030)' },
  { key: 'romance', label: 'Romance',     group: 'Mood',     grad: 'linear-gradient(160deg,#4d1c31,#160810)' },
];
const ROOM_GROUPS = ['Ambience', 'Nature', 'Mood'];

const HL_COLORS = ['rgba(255,224,77,0.55)', 'rgba(150,231,150,0.5)', 'rgba(127,199,255,0.5)', 'rgba(255,158,199,0.5)', 'rgba(255,184,119,0.5)'];
const PEN_COLORS = ['#e0483a', '#2f6fed', '#12a150', '#f5a623', '#8b5cf6', '#1a1a1a'];
const STICKY_COLORS = ['#ffe98a', '#ffc9de', '#bfe6ff', '#c9f4c9', '#f3d7a4'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2, 9);

/* perfect-freehand → svg path (matches DrawingLayer). */
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

/* ------------------------------- icons ---------------------------------- */
const I = {
  close: 'M18 6 6 18M6 6l12 12',
  next: 'm9 18 6-6-6-6', prev: 'm15 18-6-6 6-6',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  scroll: 'M4 5h16v5H4zM4 13h16v6H4z',
  bookmark: 'm19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  pin: 'M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z',
  hl: 'm9 11-6 6v3h3l6-6M9 11l4-4 3 3-4 4M9 11l4 4M13 7l3-3a2 2 0 0 1 3 3l-3 3',
  draw: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  sticky: 'M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2zM15 21v-6h6',
  eraser: 'm16 3 5 5L11 18H6l-3-3a2 2 0 0 1 0-3zM9 21h12',
  clip: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  ai: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z',
  strip: 'M3 5h4v14H3zM10 5h4v14h-4zM17 5h4v14h-4z',
};
function Ico({ d, s = 16 }: { d: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
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
  const name = String(objSnap?.style?.fileName || 'Document');

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
  const [pop, setPop] = useState<'' | 'room' | 'type'>('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [flip, setFlip] = useState<null | { dir: 'next' | 'prev'; half: 'l' | 'r'; front: number; back: number }>(null);

  const numPages = session?.numPages ?? 0;

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

  /* -- persist (debounced, non-clobbering) ------------------------------ */
  const persist = useCallback((state: ReaderState) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
    if (cur) updateObject(objId, { style: { ...cur.style, pdfReader: state } });
  }, [objId, updateObject]);

  useEffect(() => {
    const t = setTimeout(() => persist(st), 450);
    return () => clearTimeout(t);
  }, [st, persist]);

  /* Flush synchronously on close so a signed-in reader never loses a mark. */
  const doClose = useCallback(() => { persist(st); closeReader(); }, [persist, st, closeReader]);

  /* -- rain ambience tied to the room ----------------------------------- */
  useEffect(() => {
    if (st.atmos === 'rain') { startRain(); return () => stopRain(); }
    return undefined;
  }, [st.atmos]);

  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(''), 1700); }, []);

  /* -- navigation -------------------------------------------------------- */
  const go = useCallback((n: number) => { if (numPages) set({ page: Math.min(Math.max(1, n), numPages) }); }, [numPages, set]);

  const turn = useCallback((dir: 'next' | 'prev') => {
    setSt((s) => {
      if (!numPages) return s;
      if (s.layout === 'book') {
        const target = dir === 'next' ? s.page + 2 : s.page - 2;
        if (target < 1 || target > numPages) return s;
        if (dir === 'next') setFlip({ dir, half: 'r', front: Math.min(s.page + 1, numPages), back: target });
        else setFlip({ dir, half: 'l', front: s.page, back: Math.max(target + 1, 1) });
        try { playWhoosh(); } catch { /* audio best-effort */ }
        window.setTimeout(() => setFlip(null), 920);
        return { ...s, page: target };
      }
      const target = dir === 'next' ? s.page + 1 : s.page - 1;
      if (target < 1 || target > numPages) return s;
      try { playWhoosh(); } catch { /* ignore */ }
      return { ...s, page: target };
    });
  }, [numPages]);

  /* -- keyboard ---------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (pop) setPop(''); else doClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn('next'); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn('prev'); }
      else if (e.key === '+' || e.key === '=') set({ zoom: Math.min(2.2, st.zoom + 0.1) });
      else if (e.key === '-') set({ zoom: Math.max(0.55, st.zoom - 0.1) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, doClose, set, st.zoom, pop]);

  /* -- window size ------------------------------------------------------- */
  const [win, setWin] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    on(); window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const aspect = usePageAspect(session, st.page);

  /* -- annotation mutations ---------------------------------------------- */
  const addHighlight = useCallback((page: number, h: Omit<Highlight, 'id' | 'page'>) => setSt((s) => ({ ...s, highlights: [...s.highlights, { id: uid(), page, ...h }] })), []);
  const delHighlight = useCallback((id: string) => setSt((s) => ({ ...s, highlights: s.highlights.filter((h) => h.id !== id) })), []);
  const addStroke = useCallback((page: number, pts: number[][], color: string, size: number) => setSt((s) => ({ ...s, drawings: [...s.drawings, { id: uid(), page, pts, color, size }] })), []);
  const delStroke = useCallback((id: string) => setSt((s) => ({ ...s, drawings: s.drawings.filter((d) => d.id !== id) })), []);
  const addSticky = useCallback((page: number, x: number, y: number, color: string) => { const id = uid(); setSt((s) => ({ ...s, stickies: [...s.stickies, { id, page, x, y, text: '', color, rot: rand(-4, 4) }] })); return id; }, []);
  const editSticky = useCallback((id: string, patch: Partial<Sticky>) => setSt((s) => ({ ...s, stickies: s.stickies.map((n) => n.id === id ? { ...n, ...patch } : n) })), []);
  const delSticky = useCallback((id: string) => setSt((s) => ({ ...s, stickies: s.stickies.filter((n) => n.id !== id) })), []);
  const addPin = useCallback((page: number, x: number, y: number) => { const id = uid(); setSt((s) => ({ ...s, pins: [...s.pins, { id, page, x, y, note: '' }] })); return id; }, []);
  const editPin = useCallback((id: string, note: string) => setSt((s) => ({ ...s, pins: s.pins.map((p) => p.id === id ? { ...p, note } : p) })), []);
  const delPin = useCallback((id: string) => setSt((s) => ({ ...s, pins: s.pins.filter((p) => p.id !== id) })), []);
  const toggleBookmark = useCallback((page: number) => setSt((s) => ({ ...s, bookmarks: s.bookmarks.includes(page) ? s.bookmarks.filter((b) => b !== page) : [...s.bookmarks, page].sort((a, b) => a - b) })), []);

  /* -- clip a selection onto the board ---------------------------------- */
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

  /* -- Ask AI ------------------------------------------------------------ */
  const askAI = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
      let text = String(cur?.style?.fileText || '');
      if (!text) text = await extractTextForBlock(objId);
      if (!text) { flash('Could not read the text of this PDF.'); return; }
      window.dispatchEvent(new CustomEvent('run-agent', {
        detail: {
          prompt: `Read the attached PDF "${name}" in full and build a clear, well-structured briefing on the canvas — a heading with the title, a tight summary, the key points, and any notable figures or links. Ground everything strictly in the document.`,
          apiKeyIndex: 0, x: (cur?.x || 0) + (cur?.width || 300) + 90, y: cur?.y || 0,
          filesContext: `FILE: ${name}\n${text}`,
        },
      }));
      flash('Briefing the AI…');
      doClose();
    } finally { setBusy(false); }
  }, [busy, objId, name, flash, doClose]);

  /* -- page sizing ------------------------------------------------------- */
  const sizing = useMemo(() => {
    const chromeV = 96 + (st.strip ? 118 : 0);
    const availH = Math.max(320, win.h - chromeV);
    const availW = Math.max(320, win.w - 120);
    if (st.layout === 'book') return { pageW: Math.max(220, Math.min(availH / aspect, (availW - 80) / 2) * st.zoom) };
    if (st.render === 'typeset') return { pageW: Math.min(Math.max(520, availW - 40), 780) };
    return { pageW: Math.max(280, Math.min((availH / aspect) * st.zoom, availW)) };
  }, [win, aspect, st.layout, st.zoom, st.strip, st.render]);

  const bookmarked = st.bookmarks.includes(st.page);
  const progress = numPages ? (st.page / numPages) * 100 : 0;

  const pageProps = {
    session, tool, hlColor, penColor, penSize, stickyColor,
    highlights: st.highlights, drawings: st.drawings, stickies: st.stickies, pins: st.pins,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky, addPin, editPin, delPin,
    render: st.render, font: FONTS[st.font].css, fontSize: st.fontSize, lineHeight: st.lineHeight,
  };

  const toolRow = tool === 'highlight'
    ? <SwatchRow colors={HL_COLORS} value={hlColor} onPick={setHlColor} />
    : tool === 'draw'
      ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SwatchRow colors={PEN_COLORS} value={penColor} onPick={setPenColor} />
          <input className="pdfr-range" style={{ width: 90 }} type="range" min={2} max={14} step={1} value={penSize} onChange={(e) => setPenSize(parseInt(e.target.value))} />
        </div>
      : tool === 'sticky'
        ? <SwatchRow colors={STICKY_COLORS} value={stickyColor} onPick={setStickyColor} />
        : tool === 'eraser'
          ? <span style={{ fontSize: 11, opacity: 0.7, padding: '0 6px' }}>Tap a highlight, ink stroke, note or pin to remove it.</span>
          : null;

  return (
    <div className="pdfr-root" data-atmos={st.atmos} data-aged={st.aged ? '1' : '0'} data-tool={tool} onMouseUp={onStageMouseUp}>
      <div className="pdfr-bg">
        <div className="base" /><div className="key" /><div className="haze" /><div className="vig" />
      </div>
      <Particles atmos={st.atmos} />
      <div className="pdfr-progress" style={{ width: `${progress}%` }} />

      {/* top-left: title + close */}
      <div style={{ position: 'absolute', top: 16, left: 18, zIndex: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="pdfr-btn" title="Close reader (Esc)" onClick={doClose} style={{ background: 'rgba(20,17,14,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}><Ico d={I.close} s={16} /></button>
        <div style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13, opacity: 0.9 }} title={name}>{name}</div>
      </div>

      {/* top-center: modes */}
      <div className="pdfr-bar top">
        <button className={`pdfr-btn ${st.layout === 'scroll' ? 'active' : ''}`} title="Page view" onClick={() => set({ layout: 'scroll' })}><Ico d={I.scroll} s={15} /></button>
        <button className={`pdfr-btn ${st.layout === 'book' ? 'active' : ''}`} title="Book view — turn the pages" onClick={() => set({ layout: 'book' })}><Ico d={I.book} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${st.render === 'original' ? 'active' : ''}`} title="The true PDF" onClick={() => set({ render: 'original' })}>Original</button>
        <button className={`pdfr-btn ${st.render === 'typeset' ? 'active' : ''}`} title="Reflow the text in a reading font" onClick={() => set({ render: 'typeset' })}>Typeset</button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${st.aged ? 'active' : ''}`} title="Age the paper" onClick={() => set({ aged: !st.aged })}>Aged</button>
        <div style={{ position: 'relative' }}>
          <button className={`pdfr-btn ${pop === 'room' ? 'active' : ''}`} title="Reading room" onClick={() => setPop(pop === 'room' ? '' : 'room')}>❖ Room</button>
          {pop === 'room' && (
            <div className="pdfr-pop" style={{ top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)' }}>
              {ROOM_GROUPS.map((g) => (
                <div key={g} style={{ marginBottom: 12 }}>
                  <h4 style={{ marginBottom: 8 }}>{g}</h4>
                  <div className="pdfr-grid">
                    {ROOMS.filter((r) => r.group === g).map((r) => (
                      <div key={r.key} className={`pdfr-chip ${st.atmos === r.key ? 'active' : ''}`} onClick={() => set({ atmos: r.key })}>
                        <span className="sw" style={{ background: r.grad }} />{r.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className={`pdfr-btn ${pop === 'type' ? 'active' : ''}`} title="Type & size" onClick={() => setPop(pop === 'type' ? '' : 'type')}>Aa</button>
          {pop === 'type' && (
            <div className="pdfr-pop" style={{ top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)' }}>
              {st.render === 'typeset' ? (
                <>
                  <h4 style={{ marginBottom: 8 }}>Reading font</h4>
                  <div className="pdfr-grid" style={{ marginBottom: 12 }}>
                    {(Object.keys(FONTS) as FontKey[]).map((k) => (
                      <div key={k} className={`pdfr-chip ${st.font === k ? 'active' : ''}`} style={{ fontFamily: FONTS[k].css }} onClick={() => set({ font: k })}>{FONTS[k].label}</div>
                    ))}
                  </div>
                  <Slider label={`Text size · ${st.fontSize}px`} min={13} max={30} step={1} value={st.fontSize} onChange={(v) => set({ fontSize: v })} />
                  <div style={{ height: 10 }} />
                  <Slider label={`Line height · ${st.lineHeight.toFixed(2)}`} min={1.2} max={2.4} step={0.05} value={st.lineHeight} onChange={(v) => set({ lineHeight: v })} />
                </>
              ) : (
                <>
                  <h4 style={{ marginBottom: 8 }}>Page size</h4>
                  <Slider label={`Zoom · ${Math.round(st.zoom * 100)}%`} min={0.55} max={2.2} step={0.05} value={st.zoom} onChange={(v) => set({ zoom: v })} />
                  <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, opacity: 0.55 }}>Switch to <b>Typeset</b> to change the actual font & spacing of the text.</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* stage */}
      <div className="pdfr-stage" style={{ position: 'absolute', inset: 0, top: 68, bottom: st.strip ? 176 : 66, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '8px 24px 24px', zIndex: 5 }} onClick={() => pop && setPop('')}>
        {loadErr ? (
          <div className="pdfr-loading" style={{ marginTop: '18vh' }}><div style={{ fontSize: 15, fontWeight: 600 }}>{loadErr}</div><button className="pdfr-btn active" onClick={doClose}>Close</button></div>
        ) : !session ? (
          <div className="pdfr-loading" style={{ marginTop: '20vh' }}><div className="pdfr-spin" /><div>Opening your PDF…</div></div>
        ) : st.layout === 'book' ? (
          <BookView {...pageProps} page={st.page} numPages={numPages} pageW={sizing.pageW} flip={flip} onTurn={turn} bookmarked={bookmarked} />
        ) : (
          <div style={{ position: 'relative' }}><Page {...pageProps} page={st.page} width={sizing.pageW} interactive /></div>
        )}
      </div>

      {/* contextual tool options */}
      {toolRow && (
        <div className="pdfr-bar" style={{ bottom: st.strip ? 200 : 62 }}>{toolRow}</div>
      )}

      {/* bottom-center: nav + tools */}
      <div className="pdfr-bar bottom">
        <button className="pdfr-btn" title="Previous" disabled={st.page <= 1} onClick={() => turn('prev')}><Ico d={I.prev} s={16} /></button>
        <div style={{ fontSize: 12, fontWeight: 700, minWidth: 74, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{st.page} <span style={{ opacity: 0.45 }}>/ {numPages || '—'}</span></div>
        <button className="pdfr-btn" title="Next" disabled={st.page >= numPages} onClick={() => turn('next')}><Ico d={I.next} s={16} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${bookmarked ? 'active' : ''}`} title="Bookmark this page" onClick={() => toggleBookmark(st.page)}><Ico d={I.bookmark} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'highlight' ? 'active' : ''}`} title="Highlighter" onClick={() => setTool(tool === 'highlight' ? 'none' : 'highlight')}><Ico d={I.hl} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'draw' ? 'active' : ''}`} title="Draw / ink" onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}><Ico d={I.draw} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'sticky' ? 'active' : ''}`} title="Sticky note" onClick={() => setTool(tool === 'sticky' ? 'none' : 'sticky')}><Ico d={I.sticky} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'pin' ? 'active' : ''}`} title="Drop a pin" onClick={() => setTool(tool === 'pin' ? 'none' : 'pin')}><Ico d={I.pin} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'eraser' ? 'active' : ''}`} title="Eraser — remove marks" onClick={() => setTool(tool === 'eraser' ? 'none' : 'eraser')}><Ico d={I.eraser} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${clip ? 'active' : ''}`} title="Clip: select text to send it to the board" onClick={() => setClip(!clip)}><Ico d={I.clip} s={15} /></button>
        <button className="pdfr-btn" title="Ask AI about this document" disabled={busy} onClick={askAI}>{busy ? <span className="pdfr-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Ico d={I.ai} s={15} />} AI</button>
        <button className={`pdfr-btn ${st.strip ? 'active' : ''}`} title="Thumbnails" onClick={() => set({ strip: !st.strip })}><Ico d={I.strip} s={15} /></button>
      </div>

      {st.strip && session && <Filmstrip session={session} page={st.page} bookmarks={st.bookmarks} onJump={go} />}

      {toast && <div style={{ position: 'absolute', bottom: st.strip ? 240 : 108, left: '50%', transform: 'translateX(-50%)', zIndex: 40, padding: '8px 16px', borderRadius: 999, background: 'rgba(20,17,14,0.92)', border: '1px solid rgba(255,255,255,0.14)', fontSize: 12, fontWeight: 600 }}>{toast}</div>}
    </div>
  );
}

/* --------------------------- small controls ----------------------------- */
function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (<div><div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginBottom: 6 }}>{label}</div><input className="pdfr-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} /></div>);
}
function SwatchRow({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{colors.map((c) => (<button key={c} className={`pdfr-swatch ${value === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onPick(c)} title="Colour" />))}</div>);
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

/* ------------------------------ particles ------------------------------- */
function Particles({ atmos }: { atmos: Atmos }) {
  const kind = PARTICLE[atmos];
  const items = useMemo(() => {
    if (!kind) return [];
    const n = kind === 'rain' ? 64 : kind === 'stars' ? 60 : kind === 'snow' ? 46 : kind === 'petal' ? 20 : kind === 'leaf' ? 22 : kind === 'bokeh' ? 14 : kind === 'ember' ? 24 : 26;
    return Array.from({ length: n }, () => {
      if (kind === 'rain') return { left: `${rand(-4, 100)}%`, animationDuration: `${rand(0.5, 1.05)}s`, animationDelay: `${-rand(0, 1.2)}s` };
      if (kind === 'stars') return { left: `${rand(2, 98)}%`, top: `${rand(3, 82)}%`, animationDuration: `${rand(2.2, 5)}s`, animationDelay: `${-rand(0, 4)}s` };
      if (kind === 'snow') return { left: `${rand(0, 100)}%`, animationDuration: `${rand(5, 11)}s`, animationDelay: `${-rand(0, 8)}s`, transform: `scale(${rand(0.5, 1.2)})` };
      if (kind === 'petal' || kind === 'leaf') return { left: `${rand(-4, 100)}%`, animationDuration: `${rand(7, 13)}s`, animationDelay: `${-rand(0, 10)}s`, transform: `scale(${rand(0.7, 1.25)})` };
      if (kind === 'bokeh') { const s = rand(60, 200); return { left: `${rand(4, 92)}%`, top: `${rand(8, 88)}%`, width: `${s}px`, height: `${s}px`, animationDuration: `${rand(8, 16)}s`, animationDelay: `${-rand(0, 8)}s` }; }
      if (kind === 'ember') return { left: `${rand(6, 94)}%`, animationDuration: `${rand(3.4, 6.5)}s`, animationDelay: `${-rand(0, 5)}s` };
      return { left: `${rand(2, 96)}%`, top: `${rand(6, 92)}%`, animationDuration: `${rand(6, 13)}s`, animationDelay: `${-rand(0, 8)}s` }; // dust / gold
    });
  }, [kind]);

  const cls = kind ? `pdfr-${kind}` : 'pdfr-dust';
  const leafVar = atmos === 'forest' ? '#6fae4a' : atmos === 'autumn' ? '#d8792a' : undefined;
  const hearts = useMemo(() => atmos === 'romance' ? Array.from({ length: 6 }, () => ({ left: `${rand(6, 90)}%`, animationDuration: `${rand(7, 12)}s`, animationDelay: `${-rand(0, 9)}s`, fontSize: `${rand(14, 26)}px` })) : [], [atmos]);

  return (
    <>
      {kind && <div className={`pdfr-particles ${cls}`} aria-hidden style={leafVar ? ({ ['--leafc' as string]: leafVar } as React.CSSProperties) : undefined}>
        {items.map((s, i) => <span key={i} className="p" style={s as React.CSSProperties} />)}
      </div>}
      {atmos === 'rain' && <div className="pdfr-lightning" aria-hidden />}
      {atmos === 'night' && <div className="pdfr-shoot" aria-hidden />}
      {atmos === 'forest' && <div className="pdfr-rays" aria-hidden />}
      {atmos === 'romance' && <div className="pdfr-heart" aria-hidden>{hearts.map((h, i) => <span key={i} style={h as React.CSSProperties}>♥</span>)}</div>}
    </>
  );
}
const PARTICLE: Record<Atmos, string | null> = {
  clean: 'dust', focus: 'dust', candle: 'ember', library: 'dust', rain: 'rain', night: 'stars',
  forest: 'leaf', autumn: 'leaf', snow: 'snow', ocean: 'bokeh', sunset: 'gold', romance: 'petal',
};

/* --------------------------------- book --------------------------------- */
function BookView(props: PageSharedProps & { page: number; numPages: number; pageW: number; bookmarked: boolean; flip: null | { dir: 'next' | 'prev'; half: 'l' | 'r'; front: number; back: number }; onTurn: (d: 'next' | 'prev') => void }) {
  const { page, numPages, pageW, flip, onTurn, bookmarked, ...shared } = props;
  const left = page;
  const right = page + 1 <= numPages ? page + 1 : null;
  const frac = numPages > 1 ? page / numPages : 0.5;
  const leftStack = Math.max(2, Math.round(16 * frac));
  const rightStack = Math.max(2, Math.round(16 * (1 - frac)));

  const Turn = flip && (
    <div className={`pdfr-turn ${flip.dir}`} style={{ width: pageW }}>
      <div className="face front"><Page {...shared} page={flip.front} width={pageW} /><div className="sheen" /></div>
      <div className="face back"><Page {...shared} page={flip.back} width={pageW} /><div className="sheen" /></div>
    </div>
  );

  return (
    <div className="pdfr-book">
      {bookmarked && <div className="pdfr-ribbon" style={{ right: 22 + rightStack + pageW * 0.14, height: pageW * 0.9 }} />}
      <div className="leaves">
        <div className="pdfr-stack left" style={{ width: leftStack }} />
        <div className="pdfr-leaf l" style={{ width: pageW }}>
          <Page {...shared} page={left} width={pageW} interactive />
          {flip?.half === 'l' && Turn}
        </div>
        <div className="pdfr-spine" />
        <div className="pdfr-leaf r" style={{ width: pageW }}>
          {right ? <Page {...shared} page={right} width={pageW} interactive /> : <div style={{ width: pageW, aspectRatio: '1 / 1.414', background: 'rgba(255,255,255,0.03)' }} />}
          {flip?.half === 'r' && Turn}
        </div>
        <div className="pdfr-stack right" style={{ width: rightStack }} />
      </div>
      <div className="pdfr-corner left" onClick={() => onTurn('prev')}><div className="fold" /></div>
      <div className="pdfr-corner right" onClick={() => onTurn('next')}><div className="fold" /></div>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */
interface PageSharedProps {
  session: PdfSession | null;
  tool: Tool; hlColor: string; penColor: string; penSize: number; stickyColor: string;
  highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[]; pins: Pin[];
  addHighlight: (page: number, h: Omit<Highlight, 'id' | 'page'>) => void;
  delHighlight: (id: string) => void;
  addStroke: (page: number, pts: number[][], color: string, size: number) => void;
  delStroke: (id: string) => void;
  addSticky: (page: number, x: number, y: number, color: string) => string;
  editSticky: (id: string, patch: Partial<Sticky>) => void;
  delSticky: (id: string) => void;
  addPin: (page: number, x: number, y: number) => string;
  editPin: (id: string, note: string) => void;
  delPin: (id: string) => void;
  render: RenderMode; font: string; fontSize: number; lineHeight: number;
}

function Page(props: PageSharedProps & { page: number; width: number; interactive?: boolean }) {
  const { session, page, width, tool, hlColor, penColor, penSize, stickyColor, highlights, drawings, stickies, pins,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky, addPin, editPin, delPin,
    render, font, fontSize, lineHeight, interactive } = props;

  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.414);
  const [px, setPx] = useState({ w: width, h: width * 1.414 });
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [reflow, setReflow] = useState<string[] | null>(null);
  const [hlDrag, setHlDrag] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [live, setLive] = useState<number[][] | null>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const dragSticky = useRef<null | { id: string; dx: number; dy: number }>(null);

  const pageHls = highlights.filter((h) => h.page === page);
  const pageInk = drawings.filter((d) => d.page === page);
  const pageStickies = stickies.filter((n) => n.page === page);
  const pagePins = pins.filter((p) => p.page === page);

  /* measure the page box in px (for ink + hit-testing), lint-safe via observer */
  useEffect(() => {
    const node = box.current; if (!node) return;
    const ro = new ResizeObserver((entries) => { const r = entries[0].contentRect; setPx({ w: r.width, h: r.height }); });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  /* render the canvas (Original) — cap DPR at 2 */
  useEffect(() => {
    if (!session || render !== 'original') return;
    let cancelled = false;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    session.renderPage(page, width, dpr).then(({ canvas, height }) => {
      if (cancelled || !holder.current) return;
      holder.current.replaceChildren(canvas);
      setAspect(height / width);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [session, page, width, render]);

  /* text layer (Original, interactive) */
  useEffect(() => {
    if (!session || render !== 'original' || !interactive) return;
    let alive = true;
    session.textLayer(page, width).then((tl) => { if (alive) setSpans(tl.spans); }).catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [session, page, width, render, interactive]);

  /* reflow text (Typeset) */
  useEffect(() => {
    if (!session || render !== 'typeset') return;
    let alive = true;
    session.pageText(page).then((t) => { if (alive) setReflow(t.lines); }).catch(() => { if (alive) setReflow([]); });
    return () => { alive = false; };
  }, [session, page, render]);

  const norm = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };

  /* create-tool gesture overlay */
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = norm(e);
    if (tool === 'highlight') setHlDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    else if (tool === 'draw') setLive([[p.x, p.y]]);
    else if (tool === 'pin') { setOpenPin(addPin(page, p.x, p.y)); }
    else if (tool === 'sticky') { const id = addSticky(page, p.x, p.y, stickyColor); setOpenPin(`s:${id}`); }
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

  /* sticky drag */
  const stickyDown = (e: React.PointerEvent, n: Sticky) => {
    if (tool === 'eraser') { delSticky(n.id); return; }
    e.stopPropagation();
    const p = norm(e);
    dragSticky.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const stickyMove = (e: React.PointerEvent) => { if (!dragSticky.current) return; const p = norm(e); editSticky(dragSticky.current.id, { x: p.x - dragSticky.current.dx, y: p.y - dragSticky.current.dy }); };
  const stickyUp = () => { dragSticky.current = null; };

  const isTypeset = render === 'typeset';
  const creating = interactive && (tool === 'highlight' || tool === 'draw' || tool === 'pin' || tool === 'sticky');
  const textActive = interactive && tool === 'none';

  return (
    <div className="pdfr-page" ref={box} style={{ width, aspectRatio: isTypeset ? undefined : `1 / ${aspect}` }}>
      {isTypeset ? (
        <div className="pdfr-typeset" style={{ fontFamily: font, fontSize, lineHeight, minHeight: width * 1.3 }}>
          {reflow === null ? <div style={{ opacity: 0.4 }}>Setting the type…</div>
            : reflow.length === 0 ? <div style={{ opacity: 0.5, fontStyle: 'italic' }}>This page has no extractable text (it may be a scan). Switch to Original to see it.</div>
              : paragraphs(reflow).map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <div className="pdfr-canvas" ref={holder} />
      )}

      <div className="pdfr-aged" />

      {/* highlights */}
      {pageHls.map((h) => (
        <div key={h.id} className="pdfr-hl" title={tool === 'eraser' ? 'Tap to remove' : ''}
          onClick={() => tool === 'eraser' && delHighlight(h.id)}
          style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, background: h.color, pointerEvents: tool === 'eraser' ? 'auto' : 'none' }} />
      ))}
      {hlDrag && <div className="pdfr-hl" style={{ left: `${Math.min(hlDrag.x0, hlDrag.x1) * 100}%`, top: `${Math.min(hlDrag.y0, hlDrag.y1) * 100}%`, width: `${Math.abs(hlDrag.x1 - hlDrag.x0) * 100}%`, height: `${Math.abs(hlDrag.y1 - hlDrag.y0) * 100}%`, background: hlColor, pointerEvents: 'none' }} />}

      {/* ink */}
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

      {/* selectable text layer (clip) */}
      {!isTypeset && interactive && spans.length > 0 && (
        <div className="pdfr-textlayer" style={{ pointerEvents: textActive ? 'auto' : 'none' }}>
          {spans.map((s, i) => <span key={i} style={{ left: s.x, top: s.y, fontSize: s.h, height: s.h }}>{s.text}</span>)}
        </div>
      )}

      {/* pins */}
      {pagePins.map((p) => (
        <React.Fragment key={p.id}>
          <svg className="pdfr-pin" viewBox="0 0 24 24" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            onClick={(e) => { e.stopPropagation(); if (tool === 'eraser') { delPin(p.id); return; } setOpenPin(openPin === p.id ? null : p.id); }}>
            <path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z" fill="#e0483a" stroke="#fff" strokeWidth="1.4" /><circle cx="12" cy="7" r="1.9" fill="#fff" />
          </svg>
          {openPin === p.id && (
            <div className="pdfr-pin-note" style={{ left: `${p.x * 100}%`, top: `calc(${p.y * 100}% - 28px)` }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              <textarea autoFocus value={p.note} onChange={(e) => editPin(p.id, e.target.value)} placeholder="Note…" style={{ width: '100%', minHeight: 46, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', resize: 'none', fontFamily: 'inherit', fontSize: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => { delPin(p.id); setOpenPin(null); }} style={{ background: 'none', border: 'none', color: '#ff9a8a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                <button onClick={() => setOpenPin(null)} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Done</button>
              </div>
            </div>
          )}
        </React.Fragment>
      ))}

      {/* sticky notes */}
      {pageStickies.map((n) => (
        <div key={n.id} className="pdfr-sticky" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%`, ['--sticky' as string]: n.color, ['--rot' as string]: `${n.rot}deg` } as React.CSSProperties}
          onPointerDown={(e) => stickyDown(e, n)} onPointerMove={stickyMove} onPointerUp={stickyUp} onClick={(e) => e.stopPropagation()}>
          <span className="del" onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); delSticky(n.id); }}>✕</span>
          <textarea value={n.text} placeholder="Write…" onPointerDown={(e) => e.stopPropagation()} onChange={(e) => editSticky(n.id, { text: e.target.value })} />
        </div>
      ))}

      {/* create-gesture overlay (below stickies/pins so those stay interactive) */}
      {creating && <div style={{ position: 'absolute', inset: 0, zIndex: 8, touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />}
    </div>
  );
}

function paragraphs(lines: string[]): string[] {
  const out: string[] = []; let buf = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (buf) { out.push(buf); buf = ''; } continue; }
    buf = buf ? `${buf} ${line}` : line;
    if (/[.!?:"”’)]$/.test(line)) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out.length ? out : lines;
}

/* ------------------------------ filmstrip ------------------------------- */
function Filmstrip({ session, page, bookmarks, onJump }: { session: PdfSession; page: number; bookmarks: number[]; onJump: (n: number) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }, [page]);
  return (
    <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 62, width: 'min(78vw, 1100px)', zIndex: 18 }}>
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
