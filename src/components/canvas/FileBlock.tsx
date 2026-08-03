'use client';

import React from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { formatBytes, getFileForBlock, extractTextForBlock } from '@/lib/fileIngest';
import { playSnap } from '@/lib/relaxAudio';
import { usePdfReaderStore } from '@/store/pdfReaderStore';
import VideoBlock from './VideoBlock';
import { isVideoClip, probeVideo, formatTimecode } from '@/lib/video/clips';

/* Padding/margins are inline throughout this file: the app's global reset
   (`* { padding:0; margin:0 }`) is unlayered and overrides Tailwind's spacing
   utilities, so the padding/margin utilities silently do nothing here. */

const SparkleIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'r',
  'lua', 'pl', 'dart', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'json',
  'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'toml', 'ini',
]);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'rst', 'tex', 'srt', 'vtt', 'env',
  ...CODE_EXTS,
]);
const OFFICE_EXTS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'ods', 'odp', 'rtf', 'key', 'pages', 'numbers']);

type ViewerKind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'office' | 'none';

function viewerKindOf(ext: string, mime: string): ViewerKind {
  const e = ext.toLowerCase();
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng'].includes(e) || mime.startsWith('image/')) return 'image';
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'].includes(e) || mime.startsWith('video/')) return 'video';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(e) || mime.startsWith('audio/')) return 'audio';
  // Office MUST be checked before text: OOXML mimes contain the substring "xml"
  // (application/vnd.openxmlformats-officedocument…), so the text branch below
  // would otherwise grab a .docx and render its raw zip bytes as gibberish.
  if (OFFICE_EXTS.has(e) || /msword|wordprocessingml|spreadsheetml|presentationml|ms-excel|ms-powerpoint|opendocument|officedocument/i.test(mime)) return 'office';
  if (TEXT_EXTS.has(e) || mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+xml') || mime.includes('javascript')) return 'text';
  return 'none';
}

function fileVisual(ext: string, kind: string): { label: string; color: string } {
  const e = ext.toLowerCase();
  if (e === 'pdf' || /pdf/i.test(kind)) return { label: 'PDF', color: '#D64545' };
  if (['doc', 'docx', 'rtf', 'odt', 'pages'].includes(e) || /word/i.test(kind)) return { label: 'DOC', color: '#3E63DD' };
  if (['ppt', 'pptx', 'key', 'odp'].includes(e) || /power/i.test(kind)) return { label: 'PPT', color: '#E8833A' };
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'].includes(e) || /sheet|spreadsheet/i.test(kind)) return { label: 'XLS', color: '#2F9E6E' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e) || /archive/i.test(kind)) return { label: 'ZIP', color: '#8B7355' };
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'].includes(e)) return { label: 'VID', color: '#B5539C' };
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(e)) return { label: 'AUD', color: '#8B6FD6' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(e)) return { label: 'IMG', color: '#4AA9C9' };
  if (CODE_EXTS.has(e)) return { label: 'CODE', color: '#6E56CF' };
  if (['md', 'markdown', 'txt', 'rst', 'tex'].includes(e)) return { label: 'TXT', color: '#5A6270' };
  return { label: (e || 'FILE').slice(0, 4).toUpperCase(), color: '#C97B4B' };
}

function metaLine(style: Record<string, unknown>): string {
  const meta = (style.fileMeta as Record<string, unknown>) || {};
  const bits: string[] = [];
  if (typeof meta.pages === 'number') bits.push(`${meta.pages} page${meta.pages === 1 ? '' : 's'}`);
  if (typeof meta.slides === 'number') bits.push(`${meta.slides} slide${meta.slides === 1 ? '' : 's'}`);
  if (typeof meta.sheets === 'number') bits.push(`${meta.sheets} sheet${meta.sheets === 1 ? '' : 's'}`);
  if (typeof meta.words === 'number' && meta.words > 0) bits.push(`${meta.words.toLocaleString()} words`);
  const size = style.fileSize as number;
  if (size) bits.push(formatBytes(size));
  return bits.join(' · ');
}

/** Height of a video card's chrome below the poster: the filename/meta row plus
 *  the Play / Clip / download row. Added to the poster's own height so the card
 *  fits its picture AND its controls. */
const CARD_CHROME_H = 92;

const OPEN_SIZE: Record<ViewerKind, { w: number; h: number }> = {
  pdf: { w: 720, h: 900 },
  office: { w: 560, h: 700 },
  image: { w: 520, h: 560 },
  video: { w: 620, h: 400 },
  audio: { w: 380, h: 210 },
  text: { w: 580, h: 680 },
  none: { w: 360, h: 280 },
};

export default function FileBlock({ obj }: { obj: CanvasObjectData }) {
  const style = obj.style || {};
  const updateObject = useCanvasStore((s) => s.updateObject);
  const addObject = useCanvasStore((s) => s.addObject);

  const name = (style.fileName as string) || 'file';
  const ext = (style.fileExt as string) || '';
  const mime = (style.fileType as string) || '';
  const text = (style.fileText as string) || '';
  const links = (style.fileLinks as string[]) || [];
  const textStatus = (style.fileTextStatus as string) || 'idle';
  const fileError = (style.fileError as string) || '';
  const truncated = Boolean(style.fileTruncated);
  const kindMeta = String((style.fileMeta as Record<string, unknown>)?.kind || '');
  const { label, color } = fileVisual(ext, kindMeta);
  const viewer = viewerKindOf(ext, mime);

  const readerOpen = Boolean(style.readerOpen);
  const clipMode = Boolean(style.clipMode);
  const readerFontSize = (style.readerFontSize as number) || 13;

  const [busy, setBusy] = React.useState(false); // Ask AI extraction in flight
  const [asking, setAsking] = React.useState(false); // query composer open
  const [query, setQuery] = React.useState('');
  const [mediaUrl, setMediaUrl] = React.useState('');
  const [decoded, setDecoded] = React.useState<string | null>(null);

  const poster = (style.videoPoster as string) || '';
  const videoDuration = (style.videoDuration as number) || 0;

  const patch = React.useCallback((kv: Record<string, unknown>) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { style: { ...(cur?.style || obj.style), ...kv } });
  }, [obj.id, obj.style, updateObject]);

  // Build a blob URL for native previews (pdf / image / video / audio) while the
  // reader is open. Blob URLs are efficient and work everywhere, unlike giant
  // data: URLs. Revoked on close.
  /* Video is absent from this list on purpose: VideoBlock resolves and revokes
     its own object URL, and minting a second one here would hold a whole extra
     handle on what is routinely the largest file on the board. */
  const needsMedia = readerOpen && (viewer === 'pdf' || viewer === 'image' || viewer === 'audio');
  React.useEffect(() => {
    if (!needsMedia) { setMediaUrl(''); return; }
    const file = getFileForBlock(obj.id);
    if (!file) { setMediaUrl(''); return; }
    const url = URL.createObjectURL(file);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [needsMedia, obj.id, viewer]);

  // Decode text-like files in the browser (no server round-trip needed to VIEW).
  React.useEffect(() => {
    if (!readerOpen || viewer !== 'text') { setDecoded(null); return; }
    let alive = true;
    const file = getFileForBlock(obj.id);
    if (!file) { setDecoded(''); return; }
    file.text().then((t) => { if (alive) setDecoded(t); }).catch(() => { if (alive) setDecoded(''); });
    return () => { alive = false; };
  }, [readerOpen, viewer, obj.id]);

  // Office docs can't render natively — extract their text when opened.
  React.useEffect(() => {
    if (readerOpen && viewer === 'office' && textStatus !== 'ready' && textStatus !== 'reading') {
      void extractTextForBlock(obj.id);
    }
  }, [readerOpen, viewer, textStatus, obj.id]);

  /* A dropped video earns its FACE.
     Every other file type is legible from its name and a coloured chip, but
     "clip_0417.mp4" tells you nothing — and the whole reason a video is on a
     spatial board is so you can see it there. So the moment one lands we read
     its length and lift a representative frame, and the card becomes a poster
     with a runtime on it. Done once and cached on the object, so it survives a
     reload and never re-probes. */
  React.useEffect(() => {
    if (viewer !== 'video' || isVideoClip(obj)) return;
    if (poster || style.videoProbed) return;
    let alive = true;
    const file = getFileForBlock(obj.id);
    if (!file) return;
    probeVideo(file).then((probe) => {
      if (!alive) return;
      // `videoProbed` is set even on failure — an undecodable container would
      // otherwise re-probe on every single render of this block, forever.
      if (!probe) { patch({ videoProbed: true }); return; }

      const aspect = probe.width / (probe.height || 1);
      const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      const w = live?.width || obj.width;

      /* GROW THE CARD TO FIT ITS POSTER.
         A file card is dropped at 288×128, which is the right size for a chip
         and two lines of text. A 16:9 poster at that width is 162px tall on its
         own, so the poster alone overflowed the card and pushed the filename
         and the Play/Clip buttons clean out of the block — the first build of
         this shipped a video card with no controls visible at all. The card is
         a different shape once it has a picture in it, so it takes a different
         size. */
      useCanvasStore.getState().updateObject(obj.id, {
        height: Math.round(w / (aspect > 0.2 && aspect < 5 ? aspect : 16 / 9)) + CARD_CHROME_H,
        style: {
          ...(live?.style || obj.style),
          videoPoster: probe.poster,
          videoDuration: probe.duration,
          videoAspect: aspect,
          videoProbed: true,
        },
      });
    });
    return () => { alive = false; };
  }, [viewer, obj.id, poster, style.videoProbed, patch, obj]);

  /* A clip is not a file card that happens to hold video — it IS the video.
     It renders as its own looping surface with no filename row, no "Open", and
     no AI button, because none of those are things you want from an eleven
     second excerpt sitting next to your notes. */
  if (isVideoClip(obj)) {
    return <VideoBlock obj={obj} open={false} />;
  }

  /**
   * `extra` rides along in the SAME store write as the open.
   *
   * It used to be possible to call `patch({…})` and then `openReader()` back to
   * back and lose the patch entirely: this spread `obj.style` — the prop as it
   * was at the last render — so it wrote back a copy of the style from BEFORE
   * the patch and silently reverted it. Reading the live object here closes
   * that hole for every caller, and `extra` means an intent like "open, and go
   * straight to the trimmer" is one atomic write rather than a race.
   */
  const openReader = (extra?: Record<string, unknown>) => {
    // PDFs get the immersive full-screen reading room (book mode, atmospheres,
    // aged paper, highlighter, …) instead of the plain embedded iframe.
    if (viewer === 'pdf') {
      usePdfReaderStore.getState().openReader(obj.id);
      return;
    }
    const size = OPEN_SIZE[viewer];
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, {
      width: size.w,
      height: size.h,
      style: {
        ...(live?.style || obj.style),
        readerOpen: true,
        prevWidth: obj.width,
        prevHeight: obj.height,
        ...extra,
      },
    });
  };

  const closeReader = () => {
    updateObject(obj.id, {
      width: (style.prevWidth as number) || 288,
      height: (style.prevHeight as number) || 128,
      style: { ...obj.style, readerOpen: false, clipMode: false },
    });
  };

  const download = () => {
    const file = getFileForBlock(obj.id);
    const href = file ? URL.createObjectURL(file) : (obj.content?.startsWith('data:') ? obj.content : '');
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    if (file) setTimeout(() => URL.revokeObjectURL(href), 4000);
  };

  // Run the agent on this file. An empty query = a general briefing; otherwise
  // the agent answers the USER's own question, grounded strictly in the file.
  const runAsk = async (rawQuery: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const body = text || (await extractTextForBlock(obj.id));
      if (!body) return; // error surfaced on the block
      const q = rawQuery.trim();
      const prompt = q
        ? `Answer this question about the attached file "${name}": “${q}”. Use ONLY the file's real content as your source, build a clear, well-structured answer on the canvas, and if the answer isn't in the file, say so plainly rather than guessing.`
        : `Read the attached file "${name}" in full and build a clear, well-structured briefing on the canvas about it — a heading with the file name, a concise summary, the key points, any links or figures, and (if it's code) what it does. Ground everything strictly in the file's real content.`;
      window.dispatchEvent(new CustomEvent('run-agent', {
        detail: {
          prompt,
          apiKeyIndex: 0,
          x: obj.x + obj.width + 90,
          y: obj.y,
          filesContext: `FILE: ${name}\n${body}`,
        },
      }));
      setAsking(false);
      setQuery('');
    } finally {
      setBusy(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Selection → canvas clip (text / office readers).
  const handleMouseUp = () => {
    if (!clipMode) return;
    const selection = window.getSelection()?.toString().trim();
    if (!selection) return;
    try { playSnap(); } catch { /* ignore */ }
    addObject({ type: 'text', x: obj.x + obj.width + 40, y: obj.y + 40, width: 320, height: 160, content: selection });
    window.getSelection()?.removeAllRanges();
  };

  const readerText = viewer === 'office' ? text : (decoded ?? '');
  const isCsv = viewer === 'text' && (ext === 'csv' || ext === 'tsv');
  const isCode = viewer === 'text' && CODE_EXTS.has(ext) && !isCsv;

  // The query composer: the user types their OWN question about the file.
  const composer = (
    <div className="flex items-center gap-1.5 w-full" onMouseDown={stop}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); runAsk(query); }
          else if (e.key === 'Escape') { e.preventDefault(); setAsking(false); setQuery(''); }
        }}
        placeholder="Ask anything about this file…"
        className="flex-1 min-w-0 rounded-full bg-[var(--well)] text-[12.5px] text-[var(--text-primary)] outline-none border border-[var(--border)] focus:border-[var(--accent)] placeholder:text-[var(--text-tertiary)]"
        style={{ padding: '8px 13px', fontFamily: "'Outfit', sans-serif" }}
      />
      <button
        onClick={() => runAsk(query)}
        disabled={busy}
        title={query.trim() ? 'Ask' : 'Brief me on this file'}
        className="shrink-0 flex items-center justify-center rounded-full text-white shadow-sm cursor-pointer disabled:opacity-60 active:scale-95 transition-transform"
        style={{ width: 32, height: 32, background: 'var(--accent)' }}
      >
        {busy
          ? <span className="rounded-full border-2 border-white border-t-transparent animate-spin" style={{ width: 12, height: 12 }} />
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>}
      </button>
      <button
        onClick={() => { setAsking(false); setQuery(''); }}
        title="Cancel"
        className="shrink-0 flex items-center justify-center rounded-full bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        style={{ width: 30, height: 30 }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );

  // ---- shared shells --------------------------------------------------------
  const shell = 'w-full h-full rounded-2xl bg-[rgba(255,252,248,0.72)] dark:bg-[rgba(30,28,26,0.72)] backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-lg flex flex-col overflow-hidden group select-none pointer-events-auto';

  const Chip = (
    <div
      className="relative shrink-0 flex items-end justify-center rounded-lg shadow-sm"
      style={{ width: 40, height: 46, paddingBottom: 4, background: `${color}1A`, border: `1px solid ${color}40` }}
    >
      <div className="absolute top-0 right-0" style={{ width: 12, height: 12, background: `${color}33`, clipPath: 'polygon(0 0, 100% 100%, 100% 0)' }} />
      <span className="font-black tracking-wider" style={{ fontSize: 8, color }}>{label}</span>
    </div>
  );

  // ===========================================================================
  // READER / VIEWER
  // ===========================================================================
  if (readerOpen) {
    return (
      <div className={shell} style={{ fontFamily: "'Outfit', sans-serif" }}>
        {/* Toolbar — the filename area doubles as a drag handle (only the
            interactive controls stop the canvas drag). */}
        <div
          className="flex items-center gap-2 shrink-0 border-b border-[var(--border)]"
          style={{ padding: '8px 10px' }}
        >
          <span className="shrink-0 flex items-center justify-center rounded-md font-black tracking-wider" style={{ width: 26, height: 26, fontSize: 7.5, color, background: `${color}1A`, border: `1px solid ${color}33` }}>{label}</span>
          <span className="flex-1 min-w-0 truncate text-[12.5px] font-bold text-[var(--text-primary)]" title={name}>{name}</span>

          {viewer === 'text' && !isCsv && (
            <div className="flex items-center gap-0.5 rounded-lg bg-[var(--well)]" style={{ padding: 2 }} onMouseDown={stop}>
              <button onClick={() => patch({ readerFontSize: Math.max(10, readerFontSize - 1) })} className="flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/5 cursor-pointer" style={{ width: 22, height: 20, fontSize: 11, fontWeight: 700 }}>A−</button>
              <button onClick={() => patch({ readerFontSize: Math.min(22, readerFontSize + 1) })} className="flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/5 cursor-pointer" style={{ width: 22, height: 20, fontSize: 12, fontWeight: 700 }}>A+</button>
            </div>
          )}

          {(viewer === 'text' || viewer === 'office') && (
            <button
              onClick={() => patch({ clipMode: !clipMode })}
              onMouseDown={stop}
              title="Clip mode: highlight text in the reader to spawn it as a block on the canvas."
              className={`flex items-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${clipMode ? 'text-emerald-600' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              style={{ padding: '5px 9px', background: clipMode ? 'rgba(16,185,129,0.14)' : 'var(--well)', border: clipMode ? '1px solid rgba(16,185,129,0.25)' : '1px solid transparent' }}
            >
              ✂ Clip
            </button>
          )}

          <button onClick={download} onMouseDown={stop} title="Download" className="flex items-center justify-center rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer" style={{ width: 28, height: 26 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </button>
          <button onClick={() => setAsking((v) => !v)} onMouseDown={stop} disabled={busy} title="Ask the AI about this file" className={`flex items-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 ${asking ? 'text-white' : 'text-[var(--accent)]'}`} style={{ padding: '5px 9px', background: asking ? 'var(--accent)' : 'var(--accent-subtle)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}>
            {busy ? <span className="rounded-full border-2 border-current border-t-transparent animate-spin" style={{ width: 11, height: 11 }} /> : <SparkleIcon size={11} />} AI
          </button>
          <button onClick={closeReader} onMouseDown={stop} title="Close" className="flex items-center justify-center rounded-lg bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" style={{ width: 28, height: 26 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {clipMode && (viewer === 'text' || viewer === 'office') && (
          <div className="shrink-0 text-emerald-600/90 text-[10px] font-medium border-b border-emerald-500/12" style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.06)' }} onMouseDown={stop}>
            ✨ Highlight any text to spawn it as a block on your board.
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 relative" onMouseDown={stop}>
          {viewer === 'pdf' && (
            mediaUrl
              /* #view=FitH → fit each page to the card WIDTH (one readable page
                 per row, not the tiny 2-up spread the viewer defaults to);
                 navpanes=0 hides the thumbnail rail for more reading room. */
              ? <iframe src={`${mediaUrl}#view=FitH&navpanes=0`} className="w-full h-full border-0 bg-white" title={name} />
              : <NoBytes onDownload={download} hasContent={false} />
          )}

          {viewer === 'image' && (
            mediaUrl
              ? <div className="w-full h-full flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.04)' }}><img src={mediaUrl} alt={name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" /></div>
              : <NoBytes onDownload={download} hasContent={false} />
          )}

          {/* The player owns this whole area — its own transport, trimmer and
              frame grab. `embedded` stops it drawing a second card surface
              inside the one the reader has already drawn. */}
          {viewer === 'video' && <VideoBlock obj={obj} open embedded />}

          {viewer === 'audio' && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4" style={{ padding: 20 }}>
              <div className="flex items-center justify-center rounded-2xl shadow-sm" style={{ width: 72, height: 72, background: `${color}18`, border: `1px solid ${color}33` }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              </div>
              {mediaUrl ? <audio src={mediaUrl} controls className="w-full" style={{ maxWidth: 320 }} /> : <NoBytes onDownload={download} hasContent={false} inline />}
            </div>
          )}

          {(viewer === 'text' || viewer === 'office') && (
            <div className="absolute inset-0 flex flex-col" style={{ padding: '10px 12px 12px' }}>
              {viewer === 'office' && textStatus === 'reading' && (
                <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" style={{ padding: '6px 2px' }}>
                  <span className="rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" style={{ width: 14, height: 14 }} /> Rendering document text…
                </div>
              )}
              {viewer === 'office' && textStatus === 'error' && (
                <div className="text-[12px] text-red-500/80 leading-relaxed" style={{ padding: '6px 2px' }}>{fileError || 'This document could not be read.'}</div>
              )}
              {(viewer === 'text' || (viewer === 'office' && textStatus === 'ready')) && (
                <div
                  className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border)] custom-scrollbar select-text"
                  style={{ background: 'rgba(0,0,0,0.035)', padding: isCsv ? 0 : '14px 16px' }}
                  onMouseUp={handleMouseUp}
                >
                  {isCsv ? (
                    <CsvTable raw={readerText} />
                  ) : isCode ? (
                    <pre className="whitespace-pre text-[var(--text-primary)] leading-relaxed" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: `${readerFontSize}px` }}>{readerText}</pre>
                  ) : (
                    <div className="flex flex-col gap-3" style={{ fontSize: `${readerFontSize}px` }}>
                      {readerText.split('\n\n').filter((p) => p.trim()).map((p, i) => (
                        <p key={i} className="leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">{p}</p>
                      ))}
                      {!readerText.trim() && decoded !== null && <p className="text-[var(--text-tertiary)] italic">This file is empty.</p>}
                      {truncated && <p className="text-[10px] italic text-[var(--text-muted)]">(Preview truncated.)</p>}
                    </div>
                  )}
                </div>
              )}

              {links.length > 0 && (
                <div className="shrink-0 flex flex-col gap-1" style={{ marginTop: 8 }} onMouseDown={stop}>
                  <span className="text-[9px] uppercase font-extrabold tracking-widest text-[var(--text-tertiary)]">Links (drag onto board)</span>
                  <div className="flex gap-1.5 overflow-x-auto custom-scrollbar" style={{ paddingBottom: 2 }}>
                    {links.map((link, i) => (
                      <a key={i} href={link} target="_blank" rel="noopener noreferrer" draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', link); e.dataTransfer.setData('text/uri-list', link); }}
                        className="rounded-full bg-[var(--well)] hover:bg-[var(--accent)]/10 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border)] whitespace-nowrap cursor-grab active:cursor-grabbing transition-colors"
                        style={{ padding: '4px 10px' }}>
                        🔗 {link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 26)}{link.length > 26 ? '…' : ''}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {viewer === 'none' && <NoBytes onDownload={download} hasContent={Boolean(obj.content?.startsWith('data:') || getFileForBlock(obj.id))} label={label} color={color} />}
        </div>

        {/* Query composer, pinned to the bottom of the viewer */}
        {asking && (
          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-glass)]" style={{ padding: '9px 10px' }}>
            {composer}
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // COMPACT CARD
  // ===========================================================================
  const canPreview = viewer !== 'none';

  /* THE POSTER.
     A video card leads with a frame from the video instead of a coloured chip
     and a filename. On a spatial board the point of putting a video down is
     that you can SEE which one it is from across the canvas — "clip_0417.mp4"
     at 40% zoom is indistinguishable from every other clip_04xx.mp4, and a
     still from it is instantly recognisable. The play affordance and the
     runtime sit on the image the way they do on every video thumbnail
     anybody has ever used. */
  const videoPoster = viewer === 'video' && poster ? (
    <button
      onClick={(e) => { stop(e); openReader(); }}
      onMouseDown={stop}
      aria-label={`Play ${name}`}
      className="relative w-full shrink-0 overflow-hidden cursor-pointer group/poster"
      style={{ aspectRatio: String((style.videoAspect as number) || 16 / 9), background: '#000' }}
    >
      <img src={poster} alt="" draggable={false} className="w-full h-full object-cover" />
      <span
        className="absolute inset-0 flex items-center justify-center transition-colors"
        style={{ background: 'rgba(0,0,0,0.14)' }}
      >
        <span
          className="flex items-center justify-center rounded-full shadow-lg transition-transform group-hover/poster:scale-110"
          style={{ width: 40, height: 40, background: 'rgba(255,253,250,0.93)', color: '#1A1613', paddingLeft: 3 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
        </span>
      </span>
      {videoDuration > 0 && (
        <span
          className="absolute text-[10px] font-bold tabular-nums text-white rounded"
          style={{ right: 7, bottom: 7, padding: '2px 6px', background: 'rgba(0,0,0,0.72)', letterSpacing: '0.02em' }}
        >
          {formatTimecode(videoDuration)}
        </span>
      )}
    </button>
  ) : null;

  return (
    <div className={shell} style={{ fontFamily: "'Outfit', sans-serif" }}>
      {videoPoster}
      <div className="flex items-center gap-3 shrink-0" style={{ padding: videoPoster ? '9px 12px 8px' : '13px 14px 10px' }}>
        {!videoPoster && Chip}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-[var(--text-primary)] truncate select-text" title={name}>{name}</div>
          <div className="text-[10.5px] text-[var(--text-tertiary)] truncate" style={{ marginTop: 2 }}>
            {textStatus === 'reading' ? 'Reading…' : (metaLine(style) || `${(ext || 'file').toUpperCase()} file`)}
          </div>
        </div>
      </div>

      {textStatus === 'error' && (
        <div className="text-[11px] text-red-500/80 leading-relaxed shrink-0" style={{ padding: '0 14px 6px' }}>{fileError}</div>
      )}

      {asking ? (
        <div className="flex items-center shrink-0" style={{ padding: '2px 12px 12px', marginTop: 'auto' }}>
          {composer}
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0" style={{ padding: '2px 14px 13px', marginTop: 'auto' }}>
          <button
            onClick={(e) => { stop(e); openReader(); }}
            onMouseDown={stop}
            className="flex items-center gap-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-sm"
            style={{ padding: '7px 13px', background: canPreview ? 'var(--accent-subtle)' : 'var(--well)', border: canPreview ? '1px solid rgba(var(--accent-rgb),0.3)' : '1px solid var(--border)', color: canPreview ? 'var(--accent)' : 'var(--text-secondary)' }}
            title={viewer === 'pdf' ? 'Open the immersive reader' : canPreview ? 'Open an embedded preview' : 'Open details'}
          >
            {viewer === 'pdf'
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
              : viewer === 'video'
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>}
            {viewer === 'pdf' ? 'Read' : viewer === 'video' ? 'Play' : 'Open'}
          </button>

          {/* Clip is offered on the CARD, not just inside the player. Taking a
              excerpt is the main reason a video is on this board, and burying
              it one click deep inside a player the user has to open first makes
              the primary action the secondary one. This lands straight in the
              trimmer via `autoTrim`. */}
          {viewer === 'video' && (
            <button
              onClick={(e) => { stop(e); openReader({ autoTrim: true }); }}
              onMouseDown={stop}
              title="Choose a stretch of this video and put it on the board as its own block"
              className="flex items-center gap-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-sm"
              style={{ padding: '7px 13px', background: 'var(--accent)', color: '#fff', border: '1px solid rgba(var(--accent-rgb),0.5)' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
              Clip
            </button>
          )}

          {viewer !== 'video' && <button
            onClick={(e) => { stop(e); setAsking(true); }}
            onMouseDown={stop}
            disabled={busy}
            title="Ask the AI a question about this file"
            className="flex items-center gap-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-sm disabled:cursor-wait"
            style={{ padding: '7px 13px', background: 'var(--accent)', color: '#fff', border: '1px solid rgba(var(--accent-rgb),0.5)', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? <span className="rounded-full border-2 border-white border-t-transparent animate-spin" style={{ width: 11, height: 11 }} /> : <SparkleIcon size={12} />}
            {busy ? 'Reading' : 'Ask AI'}
          </button>}

          <button
            onClick={(e) => { stop(e); download(); }}
            onMouseDown={stop}
            title="Download file"
            className="flex items-center justify-center rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-all shadow-sm active:scale-95 cursor-pointer"
            style={{ width: 30, height: 30, marginLeft: 'auto' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

/** Placeholder when we have no bytes to preview (large file after reload) or the
 *  type has no native viewer. */
function NoBytes({ onDownload, hasContent, inline, label = 'FILE', color = '#C97B4B' }: { onDownload: () => void; hasContent: boolean; inline?: boolean; label?: string; color?: string }) {
  if (inline) {
    return <div className="text-[11px] text-[var(--text-tertiary)] text-center">Bytes unavailable — re-drop to preview.</div>;
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center" style={{ padding: 20 }}>
      <div className="flex items-center justify-center rounded-2xl" style={{ width: 60, height: 60, background: `${color}15`, border: `1px solid ${color}33` }}>
        <span className="font-black tracking-wider" style={{ fontSize: 13, color }}>{label}</span>
      </div>
      <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed" style={{ maxWidth: 240 }}>
        {hasContent ? 'No inline preview for this file type.' : 'The file bytes are no longer in memory — re-drop the file to preview it.'}
      </div>
      {hasContent && (
        <button onClick={onDownload} className="rounded-full text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] cursor-pointer" style={{ padding: '6px 14px', background: 'var(--accent-subtle)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}>Download</button>
      )}
    </div>
  );
}

/** Lightweight CSV/TSV → table renderer for the text viewer. */
function CsvTable({ raw }: { raw: string }) {
  const rows = React.useMemo(() => {
    const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.length > 0).slice(0, 400);
    const delim = raw.includes('\t') && !raw.slice(0, 500).includes(',') ? '\t' : ',';
    return lines.map((l) => l.split(delim));
  }, [raw]);
  if (rows.length === 0) return <div className="text-[var(--text-tertiary)] italic" style={{ padding: 14 }}>Empty file.</div>;
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto custom-scrollbar" style={{ maxHeight: '100%' }}>
      <table className="border-collapse text-[12px]" style={{ width: '100%' }}>
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} className="text-left font-bold text-[var(--text-primary)] sticky top-0" style={{ padding: '7px 10px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
              {r.map((c, ci) => (
                <td key={ci} className="text-[var(--text-secondary)]" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
