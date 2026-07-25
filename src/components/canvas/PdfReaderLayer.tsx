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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getStroke } from 'perfect-freehand';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import { useCanvasStore } from '@/store/canvasStore';
import { getFileForBlock } from '@/lib/fileIngest';
import { PdfSession, type TextSpan } from '@/lib/pdf/pdfReader';
import { playWhoosh, playSnap, startRain, stopRain, startAmbience, stopAmbience, playPageTurn, playSpineCreak, playPaperSettle } from '@/lib/relaxAudio';
import { ROOMS, ROOM_GROUPS, RoomScene, RoomPreview, getRoom, isRoom, type Atmos, type RoomGroup } from './pdfRooms';

/* ------------------------------- model ---------------------------------- */
type Layout = 'scroll' | 'book' | 'typeset';
type Tool = 'none' | 'highlight' | 'draw' | 'sticky' | 'eraser';

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

interface ReaderState {
  page: number; layout: Layout; atmos: Atmos; aged: boolean; strip: boolean; sound: boolean;
  zen: boolean; ruler: boolean; typo: Typo;
  bookmarks: number[]; highlights: Highlight[]; drawings: Stroke[]; stickies: Sticky[];
}
const DEFAULTS: ReaderState = {
  page: 1, layout: 'scroll', atmos: 'library', aged: false, strip: true, sound: false,
  zen: false, ruler: false, typo: TYPO,
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
  const [roomTab, setRoomTab] = useState<RoomGroup | 'All'>('All');
  const [card, setCard] = useState<{ label: string; blurb: string } | null>(null);
  const [toast, setToast] = useState('');
  const [flip, setFlip] = useState<null | { dir: 'next' | 'prev'; half: 'l' | 'r'; front: number; back: number }>(null);
  const [chrome, setChrome] = useState(true);          // is the furniture showing?
  const [speech, setSpeech] = useState<Speech>(SPEECH);
  const voices = useVoices();
  const [define, setDefine] = useState(false);
  const [lookup, setLookup] = useState<null | { word: string; x: number; y: number; loading: boolean; phonetic?: string; defs?: { pos: string; text: string }[]; error?: string }>(null);
  const [rulerY, setRulerY] = useState(0.5);
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
  useEffect(() => { const t = setTimeout(() => persist(st), 450); return () => clearTimeout(t); }, [st, persist]);
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
        try { if (s.sound) playPageTurn(0.6); else playWhoosh(); } catch { /* ignore */ }
        window.setTimeout(() => setFlip(null), 920);
        return { ...s, page: target };
      }
      const target = dir === 'next' ? s.page + 1 : s.page - 1;
      if (target < 1 || target > numPages) return s;
      try { if (s.sound) playPageTurn(0.3); else playWhoosh(); } catch { /* ignore */ }
      return { ...s, page: target };
    });
  }, [numPages]);

  /* -- the book opening --------------------------------------------------- */
  useEffect(() => {
    if (!session || !sound) return;
    try { playSpineCreak(); } catch { /* ignore */ }
  }, [session, sound]);

  /* Leaving zen always brings the furniture straight back. */
  const setZen = useCallback((on: boolean) => { setChrome(!on); set({ zen: on }); }, [set]);

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
      else if (e.key === 'f' || e.key === 'F') set({ layout: st.layout === 'typeset' ? 'scroll' : 'typeset' });
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
  const aspect = usePageAspect(session, st.page);

  /* -- this page as prose ------------------------------------------------- *
   * Both the typeset view and read-aloud want the same thing: the page as
   * paragraphs, then sentences. Do it once. */
  const [prose, setProse] = useState<{ page: number; paras: string[][] } | null>(null);
  const needProse = st.layout === 'typeset' || speech.on;
  useEffect(() => {
    if (!session || !needProse) return undefined;
    let alive = true;
    session.pageText(st.page)
      .then((t) => { if (alive) setProse({ page: st.page, paras: toParagraphs(t.lines).map(toSentences) }); })
      .catch(() => { if (alive) setProse({ page: st.page, paras: [] }); });
    return () => { alive = false; };
  }, [session, st.page, needProse]);
  const proseReady = prose?.page === st.page;
  const sentences = useMemo(() => (proseReady ? prose!.paras.flat() : []), [prose, proseReady]);

  /* -- read aloud ---------------------------------------------------------- */
  const onPageEnd = useCallback(() => turn('next'), [turn]);
  useReadAloud({ speech, setSpeech, sentences, ready: proseReady, voices, hasNextPage: st.page < numPages, onPageEnd });

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
    if (s.sound) { try { playPaperSettle(); } catch { /* ignore */ } }
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
    const availH = Math.max(300, win.h - (st.strip ? 220 : 116));
    const availW = Math.max(320, win.w - 80);
    if (st.layout === 'book') return { pageW: Math.max(200, Math.min((availH - 40) / aspect, (availW - 96) / 2)) };
    return { pageW: Math.max(280, Math.min(availH / aspect, availW * 0.94)) };
  }, [win, aspect, st.layout, st.strip]);

  const bookmarked = st.bookmarks.includes(st.page);
  const room = getRoom(st.atmos);
  const stripShown = st.strip && !st.zen && st.layout !== 'typeset';
  const paper = paperOf(st.typo.paper);

  /* Walking into a room announces itself, then gets out of the way. */
  const enterRoom = useCallback((r: typeof room) => {
    set({ atmos: r.key });
    setCard({ label: r.label, blurb: r.blurb });
    window.setTimeout(() => setCard((c) => (c && c.label === r.label ? null : c)), 2600);
  }, [set]);

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
    <div className="pdfr-root" data-atmos={st.atmos} data-aged={st.aged ? '1' : '0'} data-tool={tool}
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
        style={{ position: 'absolute', inset: 0, top: 14, bottom: stripShown ? 190 : 82, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '10px 22px', zIndex: 5 }}
        onClick={onStageClick}
        onMouseMove={st.ruler ? (e) => setRulerY(e.clientY / Math.max(1, window.innerHeight)) : undefined}>
        {loadErr ? (
          <div className="pdfr-loading"><div style={{ fontSize: 15, fontWeight: 600 }}>{loadErr}</div><button className="pdfr-btn active" onClick={doClose}>Close</button></div>
        ) : !session ? (
          <div className="pdfr-loading"><div className="pdfr-spin" /><div>Opening your PDF…</div></div>
        ) : st.layout === 'typeset' ? (
          <Typeset paras={prose?.page === st.page ? prose.paras : null} typo={st.typo} width={win.w} speaking={speech.on ? speech.idx : -1} />
        ) : st.layout === 'book' ? (
          <BookView {...pageProps} page={st.page} numPages={numPages} pageW={sizing.pageW} flip={flip} onTurn={turn}
            bookmarks={st.bookmarks} onScrub={go} onUnmark={toggleBookmark} />
        ) : (
          <div style={{ position: 'relative' }}><Page {...pageProps} page={st.page} width={sizing.pageW} interactive bookmarked={bookmarked} onUnmark={toggleBookmark} /></div>
        )}
      </div>

      {/* the line you are on — everything else dims away */}
      {st.ruler && (
        <div className="pdfr-ruler" aria-hidden style={{ ['--y' as string]: `${(rulerY * 100).toFixed(2)}%` }}>
          <div className="above" /><div className="band" /><div className="below" />
        </div>
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
        <button className="pdfr-btn" title="Previous" disabled={st.page <= 1} onClick={() => turn('prev')}><Ico d={I.prev} s={16} /></button>
        <div className="pdfr-count">{st.page} <span>/ {numPages || '—'}</span></div>
        <button className="pdfr-btn" title="Next" disabled={st.page >= numPages} onClick={() => turn('next')}><Ico d={I.next} s={16} /></button>
        <div className="pdfr-sep" />
        <div className="pdfr-seg">
          <button className={`pdfr-btn ${st.layout === 'scroll' ? 'active' : ''}`} title="Page view — the PDF as printed" onClick={once(() => set({ layout: 'scroll' }))}><Ico d={I.scroll} s={15} /></button>
          <button className={`pdfr-btn ${st.layout === 'book' ? 'active' : ''}`} title="Book view" onClick={once(() => set({ layout: 'book' }))}><Ico d={I.book} s={15} /></button>
          <button className={`pdfr-btn ${st.layout === 'typeset' ? 'active' : ''}`} title="Typeset — reflow it in your own font (F)" onClick={once(() => set({ layout: 'typeset' }))}><Ico d={I.typeset} s={15} /></button>
        </div>
        <button className={`pdfr-btn ${typeOpen ? 'active' : ''}`} title="Typography" onClick={once(() => { setTypeOpen(!typeOpen); setRoomOpen(false); })}><Ico d={I.type} s={15} /></button>
        <button className={`pdfr-btn ${roomOpen ? 'active' : ''}`} title="Reading room" onClick={once(() => { setRoomOpen(!roomOpen); setTypeOpen(false); })}><Ico d={I.room} s={15} /> {room.label}</button>
        {room.sound && (
          <button className={`pdfr-btn ${st.sound ? 'active' : ''}`} title={st.sound ? 'Mute the room' : 'Let the room be heard'} onClick={once(() => set({ sound: !st.sound }))}>
            <Ico d={st.sound ? I.sound : I.mute} s={15} />
          </button>
        )}
        <div className="pdfr-sep" />
        <button className={`pdfr-btn ${speech.on ? 'active' : ''}`} title={speech.on ? 'Stop reading aloud' : 'Read this page aloud'}
          onClick={once(() => setSpeech((sp) => ({ ...sp, on: !sp.on, paused: false, idx: sp.on ? 0 : sp.idx })))}><Ico d={I.speak} s={15} /></button>
        <button className={`pdfr-btn ${define ? 'active' : ''}`} title="Tap any word for its meaning" onClick={once(() => { setDefine(!define); setLookup(null); })}><Ico d={I.define} s={15} /></button>
        <button className={`pdfr-btn ${st.ruler ? 'active' : ''}`} title="Focus the line you're on" onClick={once(() => set({ ruler: !st.ruler }))}><Ico d={I.ruler} s={15} /></button>
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
          layout={st.layout} onTypeset={() => set({ layout: 'typeset' })} />
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

          <div className="foot">
            <button className={`pdfr-btn ${st.sound ? 'active' : ''}`} onClick={once(() => set({ sound: !st.sound }))} title={room.sound ? '' : 'This room is a quiet one'}>
              <Ico d={st.sound ? I.sound : I.mute} s={14} /> Ambient sound {st.sound ? 'on' : 'off'}
            </button>
            <button className={`pdfr-btn ${st.aged ? 'active' : ''}`} onClick={once(() => set({ aged: !st.aged }))}>
              <Ico d={I.aged} s={14} /> Aged paper
            </button>
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
function Typeset({ paras, typo, width, speaking }: { paras: string[][] | null; typo: Typo; width: number; speaking: number }) {
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
    <div className="pdfr-typeset" ref={ref} style={{
      fontFamily: 'var(--bookfont)', fontSize: typo.size, lineHeight: typo.leading,
      maxWidth: `min(${typo.measure}ch, ${Math.max(320, width - 120)}px)`,
      textAlign: typo.justify ? 'justify' : 'left',
      hyphens: typo.justify ? 'auto' : undefined,
    }}>
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

/* ----------------------------- typography ------------------------------- */
function TypePanel({ typo, onChange, onClose, layout, onTypeset }: {
  typo: Typo; onChange: (t: Partial<Typo>) => void; onClose: () => void;
  layout: Layout; onTypeset: () => void;
}) {
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

/* --------------------------------- book --------------------------------- */
function BookView(props: PageSharedProps & {
  page: number; numPages: number; pageW: number; bookmarks: number[];
  flip: null | { dir: 'next' | 'prev'; half: 'l' | 'r'; front: number; back: number };
  onTurn: (d: 'next' | 'prev') => void; onScrub: (n: number) => void; onUnmark: (n: number) => void;
}) {
  const { page, numPages, pageW, flip, onTurn, bookmarks, onScrub, onUnmark, ...shared } = props;
  const left = page;
  const right = page + 1 <= numPages ? page + 1 : null;
  const frac = numPages > 1 ? page / numPages : 0.5;
  // The block of paper on each side is how far through you are — the oldest
  // progress bar there is, and the one you can feel in your hand.
  const leftStack = Math.max(3, Math.round(26 * frac));
  const rightStack = Math.max(3, Math.round(26 * (1 - frac)));

  /* The ribbon: hangs from the top of the block, and can be dragged sideways to
     scrub through the book — a page number rides along with it. */
  const [drag, setDrag] = useState<null | { at: number; page: number }>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const ribbonDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ at: e.clientX, page });
  };
  const ribbonMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const span = bookRef.current?.offsetWidth || 800;
    const delta = Math.round(((e.clientX - drag.at) / span) * numPages * 1.6);
    setDrag({ ...drag, page: Math.min(numPages, Math.max(1, drag.page + (delta - (drag.page - page)))) });
  };
  const ribbonUp = () => { if (drag && drag.page !== page) onScrub(drag.page); setDrag(null); };

  const Turn = flip && (
    <div className={`pdfr-turn ${flip.dir}`} style={{ width: pageW }}>
      <div className="face front"><Page {...shared} page={flip.front} width={pageW} /><div className="sheen" /></div>
      <div className="face back"><Page {...shared} page={flip.back} width={pageW} /><div className="sheen" /></div>
    </div>
  );

  return (
    <div className="pdfr-book" ref={bookRef}>
      <div className={`pdfr-ribbon ${drag ? 'dragging' : ''}`}
        style={{ right: 13 + rightStack, height: pageW * (drag ? 1.05 : 0.92) }}
        title="Drag to scrub through the book"
        onPointerDown={ribbonDown} onPointerMove={ribbonMove} onPointerUp={ribbonUp} onPointerCancel={ribbonUp}>
        {drag && <span className="tip">{drag.page}</span>}
      </div>
      <div className="leaves">
        <div className="pdfr-stack left" style={{ width: leftStack }} />
        <div className="pdfr-leaf l" style={{ width: pageW }}>
          <Page {...shared} page={left} width={pageW} interactive bookmarked={bookmarks.includes(left)} onUnmark={onUnmark} />
          {flip?.half === 'l' && Turn}
        </div>
        <div className="pdfr-spine" />
        <div className="pdfr-leaf r" style={{ width: pageW }}>
          {right ? <Page {...shared} page={right} width={pageW} interactive bookmarked={bookmarks.includes(right)} onUnmark={onUnmark} />
            : <div style={{ width: pageW, aspectRatio: '1 / 1.414', background: 'rgba(255,255,255,0.03)' }} />}
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

function Page(props: PageSharedProps & { page: number; width: number; interactive?: boolean; bookmarked?: boolean; onUnmark?: (n: number) => void }) {
  const { session, page, width, tool, hlColor, penColor, penSize, stickyColor, highlights, drawings, stickies,
    addHighlight, delHighlight, addStroke, delStroke, addSticky, editSticky, delSticky, interactive, bookmarked, onUnmark } = props;

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
