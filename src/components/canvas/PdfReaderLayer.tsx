'use client';

/**
 * Immersive PDF Reader — a full-screen "reading room" for dropped PDFs.
 *
 * Opened from a PDF file block (see FileBlock). Portaled to <body>, above all
 * canvas chrome, and mounted only while a PDF is open (usePdfReaderStore). The
 * real pages are rendered client-side with pdf.js (lib/pdf/pdfReader); on top of
 * that we build the actual experience:
 *
 *   • two layouts — Scroll (one big page + a sliding thumbnail filmstrip) and
 *     Book (a two-page spread you turn with a subtle corner fold + 3D flip);
 *   • two render modes — Original (true PDF) and Typeset (the page's text
 *     reflowed in a reading font you choose, at your size / line-height);
 *   • aged-paper toggle (sepia warmth + fibre grain + deckle edge), independent
 *     of the room so any atmosphere can hold a fresh or a yellowed book;
 *   • atmospheres — Clean / Focus / Candlelight / Haunted / Rainy / Starlit /
 *     Library — each its own light, particles and (for rain) ambient sound;
 *   • tools — highlighter (paint bands), bookmarks (dog-ears), drop-pins with
 *     notes, select-to-clip onto the board, and Ask-AI about the document.
 *
 * Everything the reader remembers (last page, mode, atmosphere, bookmarks,
 * highlights, pins) is persisted on the canvas object's `style.pdfReader`, so it
 * survives reload and rides the normal sync path to collaborators.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import { useCanvasStore } from '@/store/canvasStore';
import { getFileForBlock, extractTextForBlock } from '@/lib/fileIngest';
import { PdfSession, type TextSpan } from '@/lib/pdf/pdfReader';
import { playWhoosh, playSnap, startRain, stopRain } from '@/lib/relaxAudio';

/* ------------------------------- model ---------------------------------- */

type Atmos = 'clean' | 'focus' | 'candle' | 'haunted' | 'rain' | 'night' | 'library';
type Layout = 'scroll' | 'book';
type RenderMode = 'original' | 'typeset';
type FontKey = 'serif' | 'sans' | 'story' | 'type' | 'antique' | 'legible';
type Tool = 'none' | 'highlight' | 'pin';

interface Highlight { id: string; page: number; x: number; y: number; w: number; h: number; color: string }
interface Pin { id: string; page: number; x: number; y: number; note: string }

interface ReaderState {
  page: number;
  layout: Layout;
  render: RenderMode;
  atmos: Atmos;
  aged: boolean;
  zoom: number;
  font: FontKey;
  fontSize: number;
  lineHeight: number;
  strip: boolean;
  bookmarks: number[];
  highlights: Highlight[];
  pins: Pin[];
}

const DEFAULTS: ReaderState = {
  page: 1, layout: 'scroll', render: 'original', atmos: 'clean', aged: false,
  zoom: 1, font: 'serif', fontSize: 18, lineHeight: 1.7, strip: true,
  bookmarks: [], highlights: [], pins: [],
};

function initState(raw: unknown): ReaderState {
  const r = (raw && typeof raw === 'object') ? raw as Partial<ReaderState> : {};
  return {
    ...DEFAULTS, ...r,
    page: Math.max(1, r.page || 1),
    bookmarks: Array.isArray(r.bookmarks) ? r.bookmarks : [],
    highlights: Array.isArray(r.highlights) ? r.highlights : [],
    pins: Array.isArray(r.pins) ? r.pins : [],
  };
}

const FONTS: Record<FontKey, { label: string; css: string }> = {
  serif:   { label: 'Serif',      css: "'Lora', Georgia, 'Times New Roman', serif" },
  sans:    { label: 'Sans',       css: "'Outfit', system-ui, sans-serif" },
  story:   { label: 'Storybook',  css: "'Shantell Sans', 'Comic Sans MS', cursive" },
  type:    { label: 'Typewriter', css: "'Special Elite', 'Courier New', monospace" },
  antique: { label: 'Antique',    css: "'Cinzel', 'Playfair Display', serif" },
  legible: { label: 'Legible',    css: "'Comfortaa', 'Trebuchet MS', sans-serif" },
};

const ATMOS: { key: Atmos; label: string; swatch: string; icon: string }[] = [
  { key: 'clean',   label: 'Clean',       swatch: '#3a3a40', icon: '◻' },
  { key: 'focus',   label: 'Focus',       swatch: '#0a0807', icon: '◉' },
  { key: 'candle',  label: 'Candlelight', swatch: '#5a3410', icon: '🕯' },
  { key: 'haunted', label: 'Haunted',     swatch: '#0d1512', icon: '👻' },
  { key: 'rain',    label: 'Rainy',       swatch: '#14202e', icon: '🌧' },
  { key: 'night',   label: 'Starlit',     swatch: '#12142a', icon: '✦' },
  { key: 'library', label: 'Library',     swatch: '#3a2616', icon: '📖' },
];

const HL_COLORS = [
  'rgba(255,224,77,0.55)', 'rgba(150,231,150,0.5)', 'rgba(127,199,255,0.5)',
  'rgba(255,158,199,0.5)', 'rgba(255,184,119,0.5)',
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2, 9);

/* ------------------------------- icons ---------------------------------- */
const I = {
  close: 'M18 6 6 18M6 6l12 12',
  next: 'm9 18 6-6-6-6', prev: 'm15 18-6-6 6-6',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  scroll: 'M4 4h16v4H4zM4 12h16v8H4z',
  bookmark: 'm19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  pin: 'M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z',
  hl: 'm9 11-6 6v3h3l6-6M9 11l4-4 3 3-4 4M9 11l4 4M13 7l3-3a2 2 0 0 1 3 3l-3 3',
  clip: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  ai: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z',
  strip: 'M3 5h4v14H3zM10 5h4v14h-4zM17 5h4v14h-4z',
  minus: 'M5 12h14', plus: 'M12 5v14M5 12h14',
  type: 'M4 7V5h16v2M9 5v14M15 5v14',
};
function Ico({ d, s = 16 }: { d: string; s?: number }) {
  // A single <path> renders every M/m subpath in the string — no splitting.
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

  // A stable snapshot of the block at open time — used for its name and the
  // initial reader state. Live position (for clip/AI placement) is read fresh
  // from the store in the handlers below, so a moved block still spawns nearby.
  const [objSnap] = useState(() => useCanvasStore.getState().objects.find((o) => o.id === objId));
  const name = String(objSnap?.style?.fileName || 'Document');

  const [st, setSt] = useState<ReaderState>(() => initState(objSnap?.style?.pdfReader));
  const set = useCallback((p: Partial<ReaderState>) => setSt((s) => ({ ...s, ...p })), []);

  const [session, setSession] = useState<PdfSession | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [tool, setTool] = useState<Tool>('none');
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [clip, setClip] = useState(false);
  const [pop, setPop] = useState<'' | 'room' | 'type'>('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [flip, setFlip] = useState<null | { dir: 'next' | 'prev'; page: number }>(null);

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
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
      if (!cur) return;
      updateObject(objId, { style: { ...cur.style, pdfReader: st } });
    }, 450);
    return () => clearTimeout(t);
  }, [st, objId, updateObject]);

  /* -- rain ambience tied to the room ----------------------------------- */
  useEffect(() => {
    if (st.atmos === 'rain') { startRain(); return () => stopRain(); }
    return undefined;
  }, [st.atmos]);

  /* -- transient toast --------------------------------------------------- */
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(''), 1600); }, []);

  /* -- navigation -------------------------------------------------------- */
  const go = useCallback((n: number) => {
    if (!numPages) return;
    set({ page: Math.min(Math.max(1, n), numPages) });
  }, [numPages, set]);

  const turn = useCallback((dir: 'next' | 'prev') => {
    setSt((s) => {
      if (!numPages) return s;
      if (s.layout === 'book') {
        const step = 2;
        const target = dir === 'next' ? s.page + step : s.page - step;
        if (target < 1 || target > numPages) return s;
        const flipPage = dir === 'next' ? Math.min(s.page + 1, numPages) : s.page;
        setFlip({ dir, page: flipPage });
        try { playWhoosh(); } catch { /* audio best-effort */ }
        window.setTimeout(() => setFlip(null), 640);
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
      if (e.key === 'Escape') { setPop(''); closeReader(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn('next'); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn('prev'); }
      else if (e.key === '+' || e.key === '=') set({ zoom: Math.min(2.2, st.zoom + 0.1) });
      else if (e.key === '-') set({ zoom: Math.max(0.55, st.zoom - 0.1) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, closeReader, set, st.zoom]);

  /* -- window size (drives page sizing) --------------------------------- */
  const [win, setWin] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    on(); window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /* -- current page aspect (h/w) ---------------------------------------- */
  const aspect = usePageAspect(session, st.page);

  /* -- highlight / pin / bookmark mutations ------------------------------ */
  const addHighlight = useCallback((page: number, h: Omit<Highlight, 'id' | 'page'>) =>
    setSt((s) => ({ ...s, highlights: [...s.highlights, { id: uid(), page, ...h }] })), []);
  const delHighlight = useCallback((id: string) =>
    setSt((s) => ({ ...s, highlights: s.highlights.filter((h) => h.id !== id) })), []);
  const addPin = useCallback((page: number, x: number, y: number) => {
    const id = uid();
    setSt((s) => ({ ...s, pins: [...s.pins, { id, page, x, y, note: '' }] }));
    return id;
  }, []);
  const editPin = useCallback((id: string, note: string) =>
    setSt((s) => ({ ...s, pins: s.pins.map((p) => p.id === id ? { ...p, note } : p) })), []);
  const delPin = useCallback((id: string) =>
    setSt((s) => ({ ...s, pins: s.pins.filter((p) => p.id !== id) })), []);
  const toggleBookmark = useCallback((page: number) => setSt((s) => ({
    ...s, bookmarks: s.bookmarks.includes(page) ? s.bookmarks.filter((b) => b !== page) : [...s.bookmarks, page].sort((a, b) => a - b),
  })), []);

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

  /* -- Ask AI about the document ---------------------------------------- */
  const askAI = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cur = useCanvasStore.getState().objects.find((o) => o.id === objId);
      let text = String(cur?.style?.fileText || '');
      if (!text) text = await extractTextForBlock(objId);
      if (!text) { flash('Could not read the text of this PDF.'); return; }
      const o = cur;
      window.dispatchEvent(new CustomEvent('run-agent', {
        detail: {
          prompt: `Read the attached PDF "${name}" in full and build a clear, well-structured briefing on the canvas — a heading with the title, a tight summary, the key points, and any notable figures or links. Ground everything strictly in the document.`,
          apiKeyIndex: 0,
          x: (o?.x || 0) + (o?.width || 300) + 90,
          y: o?.y || 0,
          filesContext: `FILE: ${name}\n${text}`,
        },
      }));
      flash('Briefing the AI…');
      closeReader();
    } finally { setBusy(false); }
  }, [busy, objId, name, flash, closeReader]);

  /* -- page sizing ------------------------------------------------------- */
  const sizing = useMemo(() => {
    const chromeV = 96 + (st.strip ? 118 : 0); // bars + filmstrip
    const availH = Math.max(320, win.h - chromeV);
    const availW = Math.max(320, win.w - 120);
    if (st.layout === 'book') {
      const leaf = Math.min(availH / aspect, (availW - 56) / 2) * st.zoom;
      return { pageW: Math.max(220, leaf) };
    }
    if (st.render === 'typeset') {
      return { pageW: Math.min(Math.max(520, availW - 40), 780) };
    }
    const w = Math.min((availH / aspect) * st.zoom, availW);
    return { pageW: Math.max(280, w) };
  }, [win, aspect, st.layout, st.zoom, st.strip, st.render]);

  const bookmarked = st.bookmarks.includes(st.page);
  const progress = numPages ? (st.page / numPages) * 100 : 0;

  const pageProps = {
    session, aged: st.aged, tool, hlColor, clip,
    highlights: st.highlights, pins: st.pins,
    addHighlight, delHighlight, addPin, editPin, delPin,
    render: st.render, font: FONTS[st.font].css, fontSize: st.fontSize, lineHeight: st.lineHeight,
  };

  return (
    <div
      className="pdfr-root"
      data-atmos={st.atmos}
      data-aged={st.aged ? '1' : '0'}
      data-tool={tool}
      onMouseUp={onStageMouseUp}
    >
      <div className="pdfr-bg" />
      <div className="pdfr-lamp" />
      <Particles atmos={st.atmos} />
      <div className="pdfr-progress" style={{ width: `${progress}%` }} />

      {/* ---- top-left: title + close ---- */}
      <div style={{ position: 'absolute', top: 16, left: 18, zIndex: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="pdfr-btn" title="Close reader (Esc)" onClick={closeReader} style={{ background: 'rgba(20,17,14,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Ico d={I.close} s={16} />
        </button>
        <div style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13, opacity: 0.9 }} title={name}>{name}</div>
      </div>

      {/* ---- top-center: modes ---- */}
      <div className="pdfr-bar top">
        <button className={`pdfr-btn ${st.layout === 'scroll' ? 'active' : ''}`} title="Page view" onClick={() => set({ layout: 'scroll' })}><Ico d={I.scroll} s={15} /></button>
        <button className={`pdfr-btn ${st.layout === 'book' ? 'active' : ''}`} title="Book view — turn the pages" onClick={() => set({ layout: 'book' })}><Ico d={I.book} s={15} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${st.render === 'original' ? 'active' : ''}`} title="The true PDF" onClick={() => set({ render: 'original' })}>Original</button>
        <button className={`pdfr-btn ${st.render === 'typeset' ? 'active' : ''}`} title="Reflow the text in a reading font of your choice" onClick={() => set({ render: 'typeset' })}>Typeset</button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${st.aged ? 'active' : ''}`} title="Age the paper" onClick={() => set({ aged: !st.aged })}>Aged</button>
        <div style={{ position: 'relative' }}>
          <button className={`pdfr-btn ${pop === 'room' ? 'active' : ''}`} title="Reading room" onClick={() => setPop(pop === 'room' ? '' : 'room')}>
            {ATMOS.find((a) => a.key === st.atmos)?.icon} Room
          </button>
          {pop === 'room' && (
            <div className="pdfr-pop" style={{ top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)' }}>
              <h4 style={{ marginBottom: 10 }}>Reading room</h4>
              <div className="pdfr-grid">
                {ATMOS.map((a) => (
                  <div key={a.key} className={`pdfr-chip ${st.atmos === a.key ? 'active' : ''}`} onClick={() => set({ atmos: a.key })}>
                    <span className="dot" style={{ background: a.swatch }} />{a.label}
                  </div>
                ))}
              </div>
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
                  <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, opacity: 0.55 }}>Switch to <b>Typeset</b> to change the actual font, size and spacing of the text.</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- stage ---- */}
      <div
        className="pdfr-stage"
        style={{ position: 'absolute', inset: 0, top: 68, bottom: st.strip ? 176 : 66, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '8px 24px 24px', zIndex: 5 }}
        onClick={() => pop && setPop('')}
      >
        {loadErr ? (
          <div className="pdfr-loading" style={{ marginTop: '18vh' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{loadErr}</div>
            <button className="pdfr-btn active" onClick={closeReader}>Close</button>
          </div>
        ) : !session ? (
          <div className="pdfr-loading" style={{ marginTop: '20vh' }}><div className="pdfr-spin" /><div>Opening your PDF…</div></div>
        ) : st.layout === 'book' ? (
          <BookSpread {...pageProps} page={st.page} numPages={numPages} pageW={sizing.pageW} flip={flip} onTurn={turn} />
        ) : (
          <div style={{ position: 'relative' }}>
            <Page {...pageProps} page={st.page} width={sizing.pageW} interactive />
          </div>
        )}
      </div>

      {/* ---- bottom-center: page nav + tools ---- */}
      <div className="pdfr-bar bottom">
        <button className="pdfr-btn" title="Previous" disabled={st.page <= 1} onClick={() => turn('prev')}><Ico d={I.prev} s={16} /></button>
        <div style={{ fontSize: 12, fontWeight: 700, minWidth: 74, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{st.page} <span style={{ opacity: 0.45 }}>/ {numPages || '—'}</span></div>
        <button className="pdfr-btn" title="Next" disabled={st.page >= numPages} onClick={() => turn('next')}><Ico d={I.next} s={16} /></button>
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${bookmarked ? 'active' : ''}`} title="Bookmark this page" onClick={() => toggleBookmark(st.page)}><Ico d={I.bookmark} s={15} /></button>
        <button className={`pdfr-btn ${tool === 'highlight' ? 'active' : ''}`} title="Highlighter — drag across the page" onClick={() => setTool(tool === 'highlight' ? 'none' : 'highlight')}><Ico d={I.hl} s={15} /></button>
        {tool === 'highlight' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {HL_COLORS.map((c) => (
              <button key={c} onClick={() => setHlColor(c)} title="Highlighter colour"
                style={{ width: 18, height: 18, borderRadius: 5, background: c, border: hlColor === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
        )}
        <button className={`pdfr-btn ${tool === 'pin' ? 'active' : ''}`} title="Drop a pin note" onClick={() => setTool(tool === 'pin' ? 'none' : 'pin')}><Ico d={I.pin} s={15} /></button>
        <button className={`pdfr-btn ${clip ? 'active' : ''}`} title="Clip: select text to send it to the board" onClick={() => setClip(!clip)}><Ico d={I.clip} s={15} /></button>
        <div className="pdfr-sep" />
        <button className="pdfr-btn" title="Ask AI about this document" disabled={busy} onClick={askAI}>
          {busy ? <span className="pdfr-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Ico d={I.ai} s={15} />} AI
        </button>
        <button className={`pdfr-btn ${st.strip ? 'active' : ''}`} title="Thumbnails" onClick={() => set({ strip: !st.strip })}><Ico d={I.strip} s={15} /></button>
      </div>

      {/* ---- filmstrip ---- */}
      {st.strip && session && (
        <Filmstrip session={session} page={st.page} bookmarks={st.bookmarks} onJump={go} />
      )}

      {/* ---- toast ---- */}
      {toast && (
        <div style={{ position: 'absolute', bottom: st.strip ? 190 : 78, left: '50%', transform: 'translateX(-50%)', zIndex: 40, padding: '8px 16px', borderRadius: 999, background: 'rgba(20,17,14,0.92)', border: '1px solid rgba(255,255,255,0.14)', fontSize: 12, fontWeight: 600 }}>{toast}</div>
      )}
    </div>
  );
}

/* --------------------------- small controls ----------------------------- */
function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <input className="pdfr-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
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
  const items = useMemo(() => {
    if (atmos === 'rain') return Array.from({ length: 64 }, () => ({ left: `${rand(-4, 100)}%`, animationDuration: `${rand(0.5, 1.05)}s`, animationDelay: `${-rand(0, 1.2)}s` }));
    if (atmos === 'night') return Array.from({ length: 54 }, () => ({ left: `${rand(2, 98)}%`, top: `${rand(4, 84)}%`, animationDuration: `${rand(2.2, 5)}s`, animationDelay: `${-rand(0, 4)}s` }));
    if (atmos === 'candle' || atmos === 'haunted' || atmos === 'library') return Array.from({ length: 26 }, () => ({ left: `${rand(2, 96)}%`, top: `${rand(6, 92)}%`, animationDuration: `${rand(6, 13)}s`, animationDelay: `${-rand(0, 8)}s` }));
    return [];
  }, [atmos]);

  const cls = atmos === 'rain' ? 'pdfr-rain' : atmos === 'night' ? 'pdfr-stars' : 'pdfr-dust';
  return (
    <>
      <div className={`pdfr-particles ${cls}`} aria-hidden>
        {items.map((s, i) => <span key={i} className="p" style={s as React.CSSProperties} />)}
      </div>
      {atmos === 'rain' && <div className="pdfr-lightning" aria-hidden />}
      {atmos === 'haunted' && <div className="pdfr-fog" aria-hidden />}
    </>
  );
}

/* --------------------------------- book --------------------------------- */
function BookSpread(props: PageSharedProps & { page: number; numPages: number; pageW: number; flip: null | { dir: 'next' | 'prev'; page: number }; onTurn: (d: 'next' | 'prev') => void }) {
  const { page, numPages, pageW, flip, onTurn, ...shared } = props;
  const left = page;
  const right = page + 1 <= numPages ? page + 1 : null;
  return (
    <div className="pdfr-book">
      <div className="pdfr-corner left" onClick={() => onTurn('prev')}><div className="fold" /></div>
      <div className="pdfr-leaf">
        <Page {...shared} page={left} width={pageW} interactive />
        {flip?.dir === 'prev' && (
          <div className="pdfr-flip turn-prev" style={{ width: pageW }}><Page {...shared} page={flip.page} width={pageW} /></div>
        )}
      </div>
      <div className="spine" />
      <div className="pdfr-leaf" style={{ width: pageW }}>
        {right ? <Page {...shared} page={right} width={pageW} interactive /> : <div style={{ width: pageW }} />}
        {flip?.dir === 'next' && (
          <div className="pdfr-flip turn-next" style={{ width: pageW }}><Page {...shared} page={flip.page} width={pageW} /></div>
        )}
      </div>
      <div className="pdfr-corner right" onClick={() => onTurn('next')}><div className="fold" /></div>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */
interface PageSharedProps {
  session: PdfSession | null;
  aged: boolean;
  tool: Tool;
  hlColor: string;
  clip: boolean;
  highlights: Highlight[];
  pins: Pin[];
  addHighlight: (page: number, h: Omit<Highlight, 'id' | 'page'>) => void;
  delHighlight: (id: string) => void;
  addPin: (page: number, x: number, y: number) => string;
  editPin: (id: string, note: string) => void;
  delPin: (id: string) => void;
  render: RenderMode;
  font: string;
  fontSize: number;
  lineHeight: number;
}

function Page(props: PageSharedProps & { page: number; width: number; interactive?: boolean }) {
  const { session, page, width, aged, tool, hlColor, highlights, pins, addHighlight, delHighlight, addPin, editPin, delPin, render, font, fontSize, lineHeight, interactive } = props;
  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.414);
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [reflow, setReflow] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);

  const pageHls = highlights.filter((h) => h.page === page);
  const pagePins = pins.filter((p) => p.page === page);

  /* render the canvas (Original mode) — cap DPR at 2 so big pages stay fast */
  useEffect(() => {
    if (!session || render !== 'original') return;
    let cancelled = false;
    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    session.renderPage(page, width, dpr)
      .then(({ canvas, height }) => {
        if (cancelled || !holder.current) return;
        holder.current.replaceChildren(canvas);
        setAspect(height / width);
      }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [session, page, width, render]);

  /* text layer (Original mode, interactive). Stale spans are harmless — they're
     only rendered when `!isTypeset && interactive`, so no synchronous reset. */
  useEffect(() => {
    if (!session || render !== 'original' || !interactive) return;
    let alive = true;
    session.textLayer(page, width).then((tl) => { if (alive) setSpans(tl.spans); }).catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [session, page, width, render, interactive]);

  /* reflow text (Typeset mode). Keeping the previous page's text until the new
     one resolves avoids a flash; it's only shown while in Typeset. */
  useEffect(() => {
    if (!session || render !== 'typeset') return;
    let alive = true;
    session.pageText(page).then((t) => { if (alive) setReflow(t.lines); }).catch(() => { if (alive) setReflow([]); });
    return () => { alive = false; };
  }, [session, page, render]);

  const toNorm = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === 'highlight') { const p = toNorm(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); (e.target as Element).setPointerCapture?.(e.pointerId); }
    else if (tool === 'pin') { const p = toNorm(e); const id = addPin(page, p.x, p.y); setOpenPin(id); }
  };
  const onMove = (e: React.PointerEvent) => { if (tool === 'highlight' && drag) { const p = toNorm(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const onUp = () => {
    if (tool === 'highlight' && drag) {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      if (w > 0.01 && h > 0.004) addHighlight(page, { x, y, w: w || 0.02, h: Math.max(h, 0.012), color: hlColor });
      setDrag(null);
    }
  };

  const toolActive = interactive && tool !== 'none';
  const isTypeset = render === 'typeset';

  return (
    <div className="pdfr-page" ref={box} style={{ width, aspectRatio: isTypeset ? undefined : `1 / ${aspect}` }}>
      {isTypeset ? (
        <div className="pdfr-typeset" style={{ fontFamily: font, fontSize, lineHeight, minHeight: width * 1.3 }}>
          {reflow === null ? <div style={{ opacity: 0.4 }}>Setting the type…</div>
            : reflow.length === 0 ? <div style={{ opacity: 0.5, fontStyle: 'italic' }}>This page has no extractable text (it may be a scan). Switch to Original to see it.</div>
              : paragraphs(reflow).map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <div ref={holder} style={{ width: '100%' }} />
      )}

      {aged && <div className="pdfr-aged" />}

      {/* selectable text layer for clip */}
      {!isTypeset && interactive && spans.length > 0 && (
        <div className="pdfr-textlayer" style={{ pointerEvents: toolActive ? 'none' : 'auto' }}>
          {spans.map((s, i) => (
            <span key={i} style={{ left: s.x, top: s.y, fontSize: s.h, height: s.h }}>{s.text}</span>
          ))}
        </div>
      )}

      {/* existing highlights */}
      {pageHls.map((h) => (
        <div key={h.id} className="pdfr-hl" title={tool === 'highlight' ? 'Click to remove' : ''}
          onClick={() => tool === 'highlight' && delHighlight(h.id)}
          style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, background: h.color, pointerEvents: tool === 'highlight' ? 'auto' : 'none' }} />
      ))}

      {/* live highlight preview */}
      {drag && (
        <div className="pdfr-hl" style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%`, background: hlColor, pointerEvents: 'none' }} />
      )}

      {/* pins */}
      {pagePins.map((p) => (
        <React.Fragment key={p.id}>
          <svg className="pdfr-pin" viewBox="0 0 24 24" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onClick={(e) => { e.stopPropagation(); setOpenPin(openPin === p.id ? null : p.id); }}>
            <path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z" fill="#e0483a" stroke="#fff" strokeWidth="1.4" />
            <circle cx="12" cy="7" r="1.9" fill="#fff" />
          </svg>
          {openPin === p.id && (
            <div className="pdfr-pin-note" style={{ left: `${p.x * 100}%`, top: `calc(${p.y * 100}% - 26px)` }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              <textarea autoFocus value={p.note} onChange={(e) => editPin(p.id, e.target.value)} placeholder="Note…"
                style={{ width: '100%', minHeight: 46, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', resize: 'none', fontFamily: 'inherit', fontSize: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => { delPin(p.id); setOpenPin(null); }} style={{ background: 'none', border: 'none', color: '#ff9a8a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                <button onClick={() => setOpenPin(null)} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Done</button>
              </div>
            </div>
          )}
        </React.Fragment>
      ))}

      {/* interaction capture for paint tools */}
      {toolActive && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 6, touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
      )}
    </div>
  );
}

/** Join reflowed lines into paragraphs — a blank line or a line that doesn't end
 *  mid-sentence starts a new paragraph. Keeps the typeset view readable. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let buf = '';
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

  // keep the current page's thumbnail scrolled into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [page]);

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
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
      }, { root: root.current, rootMargin: '300px' });
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
        className={`pdfr-thumb ${active ? 'active' : ''}`} onClick={onClick} style={{ aspectRatio: src ? undefined : '0.72', background: src ? undefined : 'rgba(255,255,255,0.06)' }}>
        {src ? <img src={src} alt={`Page ${n}`} loading="lazy" /> : <div style={{ height: 84 }} />}
        {bookmarked && <div className="dogear" />}
        <div className="n">{n}</div>
      </div>
    );
  }
);
