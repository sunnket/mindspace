'use client';

/**
 * Immersive PDF Reader — a full-screen "reading room" for dropped PDFs (v3).
 *
 * Opened from a PDF file block (FileBlock). Portaled to <body>, mounted only
 * while open (usePdfReaderStore). No top chrome — the page owns the whole frame;
 * one floating dock at the bottom holds every control.
 *
 *   • Scroll layout (one big page + a sliding thumbnail filmstrip) and a real
 *     hardcover Book layout (leather boards, thickening page-edge stacks, sunken
 *     gutter, ribbon marker) with a 3D page-CURL turn (front/back faces + sheen).
 *   • Aged paper — a real sepia FILTER on the page content + foxing + edge-brown.
 *   • 22 layered, realistic Rooms (base + key light + haze + vignette + particles)
 *     grouped Ambience / Nature / Cosmos / Mood.
 *   • Annotate — highlighter, freehand ink (perfect-freehand), resizable sticky
 *     notes, an eraser, and select-to-clip onto the board.
 *
 * All of it persists on style.pdfReader (isDirty → IndexedDB + Supabase for
 * signed-in users) and is flushed synchronously on close.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getStroke } from 'perfect-freehand';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import { useCanvasStore } from '@/store/canvasStore';
import { getFileForBlock } from '@/lib/fileIngest';
import { PdfSession, type TextSpan } from '@/lib/pdf/pdfReader';
import { playWhoosh, playSnap, startRain, stopRain } from '@/lib/relaxAudio';

/* ------------------------------- model ---------------------------------- */
type Atmos =
  | 'clean' | 'focus' | 'candle' | 'fireplace' | 'library' | 'cafe' | 'parchment'
  | 'rain' | 'snow' | 'forest' | 'autumn' | 'sakura' | 'meadow' | 'ocean'
  | 'night' | 'moonlit' | 'aurora' | 'cosmos'
  | 'sunset' | 'dusk' | 'romance' | 'lavender';
type Layout = 'scroll' | 'book';
type Tool = 'none' | 'highlight' | 'draw' | 'sticky' | 'eraser';

interface Highlight { id: string; page: number; x: number; y: number; w: number; h: number; color: string }
interface Stroke { id: string; page: number; pts: number[][]; color: string; size: number }
interface Sticky { id: string; page: number; x: number; y: number; w: number; h: number; text: string; color: string; rot: number }

interface ReaderState {
  page: number; layout: Layout; atmos: Atmos; aged: boolean; strip: boolean;
  bookmarks: number[]; highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[];
}
const DEFAULTS: ReaderState = {
  page: 1, layout: 'scroll', atmos: 'library', aged: false, strip: true,
  bookmarks: [], highlights: [], drawings: [], stickies: [],
};
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? v as T[] : []; }
function initState(raw: unknown): ReaderState {
  const r = (raw && typeof raw === 'object') ? raw as Partial<ReaderState> : {};
  const atmos = ROOMS.some((x) => x.key === r.atmos) ? r.atmos! : DEFAULTS.atmos;
  return {
    ...DEFAULTS, ...r, atmos,
    page: Math.max(1, r.page || 1),
    bookmarks: arr(r.bookmarks), highlights: arr(r.highlights),
    drawings: arr(r.drawings), stickies: arr<Sticky>(r.stickies).map((s) => ({ ...s, w: s.w || 150, h: s.h || 104 })),
  };
}

const ROOMS: { key: Atmos; label: string; group: string; grad: string }[] = [
  { key: 'clean',     label: 'Clean',       group: 'Ambience', grad: 'linear-gradient(160deg,#3c3c42,#16161a)' },
  { key: 'focus',     label: 'Focus',       group: 'Ambience', grad: 'radial-gradient(circle at 50% 26%,#1a1512,#050403)' },
  { key: 'candle',    label: 'Candlelight', group: 'Ambience', grad: 'linear-gradient(160deg,#3a2410,#0a0503)' },
  { key: 'fireplace', label: 'Fireplace',   group: 'Ambience', grad: 'radial-gradient(circle at 50% 92%,#5a2408,#150703)' },
  { key: 'library',   label: 'Library',     group: 'Ambience', grad: 'linear-gradient(160deg,#4a3320,#160d06)' },
  { key: 'cafe',      label: 'Café',        group: 'Ambience', grad: 'linear-gradient(160deg,#3a2a1c,#130c07)' },
  { key: 'parchment', label: 'Parchment',   group: 'Ambience', grad: 'linear-gradient(160deg,#5a4526,#231a0e)' },
  { key: 'rain',      label: 'Rainy',       group: 'Nature',   grad: 'linear-gradient(160deg,#1c2732,#070d14)' },
  { key: 'snow',      label: 'Snowfall',    group: 'Nature',   grad: 'linear-gradient(160deg,#33465a,#0d151f)' },
  { key: 'forest',    label: 'Forest',      group: 'Nature',   grad: 'linear-gradient(160deg,#1f3a24,#08130b)' },
  { key: 'autumn',    label: 'Autumn',      group: 'Nature',   grad: 'linear-gradient(160deg,#4a2f16,#150c05)' },
  { key: 'sakura',    label: 'Sakura',      group: 'Nature',   grad: 'linear-gradient(160deg,#4a2d3a,#170d12)' },
  { key: 'meadow',    label: 'Meadow',      group: 'Nature',   grad: 'linear-gradient(180deg,#2a4a55,#12261a)' },
  { key: 'ocean',     label: 'Ocean',       group: 'Nature',   grad: 'linear-gradient(160deg,#123a3d,#041314)' },
  { key: 'night',     label: 'Starlit',     group: 'Cosmos',   grad: 'radial-gradient(circle at 70% 20%,#2a2d55,#05050f)' },
  { key: 'moonlit',   label: 'Moonlit',     group: 'Cosmos',   grad: 'radial-gradient(circle at 78% 16%,#2a3150,#06070f)' },
  { key: 'aurora',    label: 'Aurora',      group: 'Cosmos',   grad: 'linear-gradient(180deg,#0a2a24,#03080d)' },
  { key: 'cosmos',    label: 'Cosmos',      group: 'Cosmos',   grad: 'radial-gradient(circle at 40% 40%,#2a1a55,#040211)' },
  { key: 'sunset',    label: 'Golden Hour', group: 'Mood',     grad: 'linear-gradient(160deg,#6a3320,#241030)' },
  { key: 'dusk',      label: 'Dusk',        group: 'Mood',     grad: 'linear-gradient(160deg,#3a2450,#160b18)' },
  { key: 'romance',   label: 'Romance',     group: 'Mood',     grad: 'linear-gradient(160deg,#4d1c31,#160810)' },
  { key: 'lavender',  label: 'Lavender',    group: 'Mood',     grad: 'linear-gradient(160deg,#352a55,#120d20)' },
];
const ROOM_GROUPS = ['Ambience', 'Nature', 'Cosmos', 'Mood'];

type PKind = 'dust' | 'ember' | 'rain' | 'snow' | 'leaf' | 'petal' | 'bokeh' | 'stars' | 'gold' | 'pollen';
const ROOM_FX: Record<Atmos, { k: PKind; extras?: string[]; leaf?: string; petal?: [string, string, string] }> = {
  clean: { k: 'dust' }, focus: { k: 'dust' }, candle: { k: 'ember' }, fireplace: { k: 'ember' },
  library: { k: 'dust' }, cafe: { k: 'bokeh' }, parchment: { k: 'dust' },
  rain: { k: 'rain', extras: ['lightning'] }, snow: { k: 'snow' },
  forest: { k: 'leaf', extras: ['rays'], leaf: '#6fae4a' }, autumn: { k: 'leaf', leaf: '#d8792a' },
  sakura: { k: 'petal', petal: ['#fff0f5', '#ffd1e3', '#ffb0cf'] }, meadow: { k: 'pollen', extras: ['rays'] },
  ocean: { k: 'bokeh' }, night: { k: 'stars', extras: ['shoot'] }, moonlit: { k: 'stars', extras: ['moon'] },
  aurora: { k: 'stars', extras: ['aurora'] }, cosmos: { k: 'stars', extras: ['nebula'] },
  sunset: { k: 'gold' }, dusk: { k: 'gold' }, romance: { k: 'petal', extras: ['hearts'], petal: ['#ffd0df', '#ff9ec0', '#f06ea0'] },
  lavender: { k: 'bokeh' },
};

const HL_COLORS = ['rgba(255,224,77,0.55)', 'rgba(150,231,150,0.5)', 'rgba(127,199,255,0.5)', 'rgba(255,158,199,0.5)', 'rgba(255,184,119,0.5)'];
const PEN_COLORS = ['#e0483a', '#2f6fed', '#12a150', '#f5a623', '#8b5cf6', '#1a1a1a'];
const STICKY_COLORS = ['#ffe98a', '#ffc9de', '#bfe6ff', '#c9f4c9', '#f3d7a4'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2, 9);

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
  const [roomOpen, setRoomOpen] = useState(false);
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

  /* -- persist (debounced) + flush on close ----------------------------- */
  const persist = useCallback((state: ReaderState) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
    if (cur) updateObject(objId, { style: { ...cur.style, pdfReader: state } });
  }, [objId, updateObject]);
  useEffect(() => { const t = setTimeout(() => persist(st), 450); return () => clearTimeout(t); }, [st, persist]);
  const doClose = useCallback(() => { persist(st); closeReader(); }, [persist, st, closeReader]);

  /* -- rain ambience ----------------------------------------------------- */
  useEffect(() => { if (st.atmos === 'rain') { startRain(); return () => stopRain(); } return undefined; }, [st.atmos]);

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
        try { playWhoosh(); } catch { /* ignore */ }
        window.setTimeout(() => setFlip(null), 920);
        return { ...s, page: target };
      }
      const target = dir === 'next' ? s.page + 1 : s.page - 1;
      if (target < 1 || target > numPages) return s;
      try { playWhoosh(); } catch { /* ignore */ }
      return { ...s, page: target };
    });
  }, [numPages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (roomOpen) setRoomOpen(false); else doClose(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn('next'); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn('prev'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, doClose, roomOpen]);

  const [win, setWin] = useState({ w: 1200, h: 800 });
  useEffect(() => { const on = () => setWin({ w: window.innerWidth, h: window.innerHeight }); on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const aspect = usePageAspect(session, st.page);

  /* -- annotation mutations ---------------------------------------------- */
  const addHighlight = useCallback((page: number, h: Omit<Highlight, 'id' | 'page'>) => setSt((s) => ({ ...s, highlights: [...s.highlights, { id: uid(), page, ...h }] })), []);
  const delHighlight = useCallback((id: string) => setSt((s) => ({ ...s, highlights: s.highlights.filter((h) => h.id !== id) })), []);
  const addStroke = useCallback((page: number, pts: number[][], color: string, size: number) => setSt((s) => ({ ...s, drawings: [...s.drawings, { id: uid(), page, pts, color, size }] })), []);
  const delStroke = useCallback((id: string) => setSt((s) => ({ ...s, drawings: s.drawings.filter((d) => d.id !== id) })), []);
  const addSticky = useCallback((page: number, x: number, y: number, color: string) => setSt((s) => ({ ...s, stickies: [...s.stickies, { id: uid(), page, x, y, w: 150, h: 104, text: '', color, rot: rand(-4, 4) }] })), []);
  const editSticky = useCallback((id: string, patch: Partial<Sticky>) => setSt((s) => ({ ...s, stickies: s.stickies.map((n) => n.id === id ? { ...n, ...patch } : n) })), []);
  const delSticky = useCallback((id: string) => setSt((s) => ({ ...s, stickies: s.stickies.filter((n) => n.id !== id) })), []);
  const toggleBookmark = useCallback((page: number) => setSt((s) => ({ ...s, bookmarks: s.bookmarks.includes(page) ? s.bookmarks.filter((b) => b !== page) : [...s.bookmarks, page].sort((a, b) => a - b) })), []);

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
    const availH = Math.max(300, win.h - (st.strip ? 220 : 116));
    const availW = Math.max(320, win.w - 80);
    if (st.layout === 'book') return { pageW: Math.max(200, Math.min((availH - 40) / aspect, (availW - 96) / 2)) };
    return { pageW: Math.max(280, Math.min(availH / aspect, availW * 0.94)) };
  }, [win, aspect, st.layout, st.strip]);

  const bookmarked = st.bookmarks.includes(st.page);
  const roomLabel = ROOMS.find((r) => r.key === st.atmos)?.label || 'Room';

  const pageProps = {
    session, tool, hlColor, penColor, penSize, stickyColor,
    highlights: st.highlights, drawings: st.drawings, stickies: st.stickies,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky,
  };

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
    <div className="pdfr-root" data-atmos={st.atmos} data-aged={st.aged ? '1' : '0'} data-tool={tool} onMouseUp={onStageMouseUp}>
      <div className="pdfr-bg"><div className="base" /><div className="key" /><div className="haze" /><div className="vig" /></div>
      <Particles atmos={st.atmos} />

      <div className="pdfr-close" title="Close (Esc)" onClick={doClose}><Ico d={I.close} s={17} /></div>

      {/* stage */}
      <div className="pdfr-stage" style={{ position: 'absolute', inset: 0, top: 14, bottom: st.strip ? 190 : 82, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '10px 22px', zIndex: 5 }} onClick={() => roomOpen && setRoomOpen(false)}>
        {loadErr ? (
          <div className="pdfr-loading"><div style={{ fontSize: 15, fontWeight: 600 }}>{loadErr}</div><button className="pdfr-btn active" onClick={doClose}>Close</button></div>
        ) : !session ? (
          <div className="pdfr-loading"><div className="pdfr-spin" /><div>Opening your PDF…</div></div>
        ) : st.layout === 'book' ? (
          <BookView {...pageProps} page={st.page} numPages={numPages} pageW={sizing.pageW} flip={flip} onTurn={turn} bookmarked={bookmarked} />
        ) : (
          <div style={{ position: 'relative' }}><Page {...pageProps} page={st.page} width={sizing.pageW} interactive /></div>
        )}
      </div>

      {/* contextual tool options */}
      {toolRow && <div className="pdfr-toolbar" style={{ bottom: st.strip ? 188 : 80 }}>{toolRow}</div>}

      {/* the one dock */}
      <div className="pdfr-dock">
        <button className="pdfr-btn" title="Previous" disabled={st.page <= 1} onClick={() => turn('prev')}><Ico d={I.prev} s={16} /></button>
        <div className="pdfr-count">{st.page} <span>/ {numPages || '—'}</span></div>
        <button className="pdfr-btn" title="Next" disabled={st.page >= numPages} onClick={() => turn('next')}><Ico d={I.next} s={16} /></button>
        <div className="pdfr-sep" />
        <div className="pdfr-seg">
          <button className={`pdfr-btn ${st.layout === 'scroll' ? 'active' : ''}`} title="Page view" onClick={() => set({ layout: 'scroll' })}><Ico d={I.scroll} s={15} /></button>
          <button className={`pdfr-btn ${st.layout === 'book' ? 'active' : ''}`} title="Book view" onClick={() => set({ layout: 'book' })}><Ico d={I.book} s={15} /></button>
        </div>
        <button className={`pdfr-btn ${st.aged ? 'active' : ''}`} title="Age the paper" onClick={() => set({ aged: !st.aged })}><Ico d={I.aged} s={15} /></button>
        <div style={{ position: 'relative' }}>
          <button className={`pdfr-btn ${roomOpen ? 'active' : ''}`} title="Reading room" onClick={() => setRoomOpen(!roomOpen)}><Ico d={I.room} s={15} /> {roomLabel}</button>
          {roomOpen && (
            <div className="pdfr-pop" style={{ bottom: 'calc(100% + 12px)', left: '50%', transform: 'translateX(-50%)' }} onClick={(e) => e.stopPropagation()}>
              {ROOM_GROUPS.map((g) => (
                <div key={g} style={{ marginBottom: 12 }}>
                  <h4 style={{ marginBottom: 8 }}>{g}</h4>
                  <div className="pdfr-rooms">
                    {ROOMS.filter((r) => r.group === g).map((r) => (
                      <div key={r.key} className={`pdfr-room ${st.atmos === r.key ? 'active' : ''}`} onClick={() => set({ atmos: r.key })} title={r.label}>
                        <div className="fill" style={{ background: r.grad }} />
                        <div className="tick">✓</div>
                        <div className="lbl">{r.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${bookmarked ? 'active' : ''}`} title="Bookmark this page" onClick={() => toggleBookmark(st.page)}><Ico d={I.bookmark} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'highlight' ? 'active' : ''}`} title="Highlighter" onClick={() => setTool(tool === 'highlight' ? 'none' : 'highlight')}><Ico d={I.hl} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'draw' ? 'active' : ''}`} title="Draw / ink" onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}><Ico d={I.draw} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'sticky' ? 'active' : ''}`} title="Sticky note" onClick={() => setTool(tool === 'sticky' ? 'none' : 'sticky')}><Ico d={I.sticky} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'eraser' ? 'active' : ''}`} title="Eraser" onClick={() => setTool(tool === 'eraser' ? 'none' : 'eraser')}><Ico d={I.eraser} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${clip ? 'active' : ''}`} title="Clip: select text to send it to the board" onClick={() => setClip(!clip)}><Ico d={I.clip} s={15} /></button>
        <button className={`pdfr-btn ${st.strip ? 'active' : ''}`} title="Thumbnails" onClick={() => set({ strip: !st.strip })}><Ico d={I.strip} s={15} /></button>
      </div>

      {st.strip && session && <Filmstrip session={session} page={st.page} bookmarks={st.bookmarks} onJump={go} />}

      {toast && <div style={{ position: 'absolute', bottom: st.strip ? 236 : 128, left: '50%', transform: 'translateX(-50%)', zIndex: 40, padding: '8px 16px', borderRadius: 999, background: 'rgba(20,17,14,0.92)', border: '1px solid rgba(255,255,255,0.14)', fontSize: 12, fontWeight: 600 }}>{toast}</div>}
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

/* ------------------------------ particles ------------------------------- */
function Particles({ atmos }: { atmos: Atmos }) {
  const fx = ROOM_FX[atmos];
  const items = useMemo(() => {
    const k = fx.k;
    const n = k === 'rain' ? 64 : k === 'stars' ? (atmos === 'cosmos' ? 92 : atmos === 'moonlit' ? 32 : 60)
      : k === 'snow' ? 46 : k === 'petal' ? 22 : k === 'leaf' ? 22 : k === 'bokeh' ? 14
      : k === 'ember' ? (atmos === 'fireplace' ? 42 : 24) : k === 'pollen' ? 30 : 26;
    return Array.from({ length: n }, () => {
      if (k === 'rain') return { left: `${rand(-4, 100)}%`, animationDuration: `${rand(0.5, 1.05)}s`, animationDelay: `${-rand(0, 1.2)}s` };
      if (k === 'stars') return { left: `${rand(2, 98)}%`, top: `${rand(3, 84)}%`, animationDuration: `${rand(2.2, 5)}s`, animationDelay: `${-rand(0, 4)}s` };
      if (k === 'snow') return { left: `${rand(0, 100)}%`, animationDuration: `${rand(5, 11)}s`, animationDelay: `${-rand(0, 8)}s`, transform: `scale(${rand(0.5, 1.2)})` };
      if (k === 'petal' || k === 'leaf') return { left: `${rand(-4, 100)}%`, animationDuration: `${rand(7, 13)}s`, animationDelay: `${-rand(0, 10)}s`, transform: `scale(${rand(0.7, 1.25)})` };
      if (k === 'bokeh') { const s = rand(60, 200); return { left: `${rand(4, 92)}%`, top: `${rand(8, 88)}%`, width: `${s}px`, height: `${s}px`, animationDuration: `${rand(8, 16)}s`, animationDelay: `${-rand(0, 8)}s` }; }
      if (k === 'ember') return { left: `${rand(6, 94)}%`, animationDuration: `${rand(3.4, 6.5)}s`, animationDelay: `${-rand(0, 5)}s` };
      return { left: `${rand(2, 96)}%`, top: `${rand(6, 92)}%`, animationDuration: `${rand(6, 13)}s`, animationDelay: `${-rand(0, 8)}s` };
    });
  }, [fx.k, atmos]);

  const extras = fx.extras || [];
  const hearts = useMemo(() => atmos === 'romance' ? Array.from({ length: 6 }, () => ({ left: `${rand(6, 90)}%`, animationDuration: `${rand(7, 12)}s`, animationDelay: `${-rand(0, 9)}s`, fontSize: `${rand(14, 26)}px` })) : [], [atmos]);

  const vars: React.CSSProperties = {};
  if (fx.leaf) (vars as Record<string, string>)['--leafc'] = fx.leaf;
  if (fx.petal) { const [a, b, c] = fx.petal; (vars as Record<string, string>)['--petal1'] = a; (vars as Record<string, string>)['--petal2'] = b; (vars as Record<string, string>)['--petal3'] = c; }

  return (
    <>
      <div className={`pdfr-particles pdfr-${fx.k}`} aria-hidden style={vars}>
        {items.map((s, i) => <span key={i} className="p" style={s as React.CSSProperties} />)}
      </div>
      {extras.includes('lightning') && <div className="pdfr-lightning" aria-hidden />}
      {extras.includes('shoot') && <div className="pdfr-shoot" aria-hidden />}
      {extras.includes('rays') && <div className="pdfr-rays" aria-hidden />}
      {extras.includes('moon') && <div className="pdfr-moon" aria-hidden />}
      {extras.includes('nebula') && <div className="pdfr-nebula" aria-hidden />}
      {extras.includes('aurora') && <div className="pdfr-auroralayer" aria-hidden />}
      {extras.includes('hearts') && <div className="pdfr-heart" aria-hidden>{hearts.map((h, i) => <span key={i} style={h as React.CSSProperties}>♥</span>)}</div>}
    </>
  );
}

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
  highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[];
  addHighlight: (page: number, h: Omit<Highlight, 'id' | 'page'>) => void;
  delHighlight: (id: string) => void;
  addStroke: (page: number, pts: number[][], color: string, size: number) => void;
  delStroke: (id: string) => void;
  addSticky: (page: number, x: number, y: number, color: string) => void;
  editSticky: (id: string, patch: Partial<Sticky>) => void;
  delSticky: (id: string) => void;
}

function Page(props: PageSharedProps & { page: number; width: number; interactive?: boolean }) {
  const { session, page, width, tool, hlColor, penColor, penSize, stickyColor, highlights, drawings, stickies,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky, interactive } = props;

  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.414);
  const [px, setPx] = useState({ w: width, h: width * 1.414 });
  const [spans, setSpans] = useState<TextSpan[]>([]);
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

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    session.renderPage(page, width, dpr).then(({ canvas, height }) => {
      if (cancelled || !holder.current) return;
      holder.current.replaceChildren(canvas);
      setAspect(height / width);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [session, page, width]);

  useEffect(() => {
    if (!session || !interactive) return;
    let alive = true;
    session.textLayer(page, width).then((tl) => { if (alive) setSpans(tl.spans); }).catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [session, page, width, interactive]);

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
    <div className="pdfr-page" ref={box} style={{ width, aspectRatio: `1 / ${aspect}` }}>
      <div className="pdfr-canvas" ref={holder} />
      <div className="pdfr-aged" />

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

      {interactive && spans.length > 0 && (
        <div className="pdfr-textlayer" style={{ pointerEvents: textActive ? 'auto' : 'none' }}>
          {spans.map((s, i) => <span key={i} style={{ left: s.x, top: s.y, fontSize: s.h, height: s.h }}>{s.text}</span>)}
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
