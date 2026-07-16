'use client';

import React from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { formatBytes, getFileForBlock, extractTextForBlock } from '@/lib/fileIngest';
import { playSnap } from '@/lib/relaxAudio';

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
  if (TEXT_EXTS.has(e) || mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) return 'text';
  if (OFFICE_EXTS.has(e) || /word|excel|powerpoint|opendocument|officedocument/i.test(mime)) return 'office';
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

const OPEN_SIZE: Record<ViewerKind, { w: number; h: number }> = {
  pdf: { w: 560, h: 720 },
  office: { w: 520, h: 660 },
  image: { w: 520, h: 560 },
  video: { w: 580, h: 380 },
  audio: { w: 380, h: 210 },
  text: { w: 560, h: 640 },
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
  const [mediaUrl, setMediaUrl] = React.useState('');
  const [decoded, setDecoded] = React.useState<string | null>(null);

  const patch = React.useCallback((kv: Record<string, unknown>) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { style: { ...(cur?.style || obj.style), ...kv } });
  }, [obj.id, obj.style, updateObject]);

  // Build a blob URL for native previews (pdf / image / video / audio) while the
  // reader is open. Blob URLs are efficient and work everywhere, unlike giant
  // data: URLs. Revoked on close.
  const needsMedia = readerOpen && (viewer === 'pdf' || viewer === 'image' || viewer === 'video' || viewer === 'audio');
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

  const openReader = () => {
    const size = OPEN_SIZE[viewer];
    updateObject(obj.id, {
      width: size.w,
      height: size.h,
      style: { ...obj.style, readerOpen: true, prevWidth: obj.width, prevHeight: obj.height },
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

  const askAgent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body = text || (await extractTextForBlock(obj.id));
      if (!body) return; // error surfaced on the block
      window.dispatchEvent(new CustomEvent('run-agent', {
        detail: {
          prompt: `Read the attached file "${name}" in full and build a clear, well-structured briefing on the canvas about it — a heading with the file name, a concise summary, the key points, any links or figures, and (if it's code) what it does. Ground everything strictly in the file's real content.`,
          apiKeyIndex: 0,
          x: obj.x + obj.width + 90,
          y: obj.y,
          filesContext: `FILE: ${name}\n${body}`,
        },
      }));
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
          <button onClick={askAgent} onMouseDown={stop} disabled={busy} title="Read with AI" className="flex items-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] transition-colors cursor-pointer disabled:opacity-50" style={{ padding: '5px 9px', background: 'var(--accent-subtle)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}>
            {busy ? <span className="rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" style={{ width: 11, height: 11 }} /> : <SparkleIcon size={11} />} AI
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
              ? <iframe src={mediaUrl} className="w-full h-full border-0 bg-white" title={name} />
              : <NoBytes onDownload={download} hasContent={false} />
          )}

          {viewer === 'image' && (
            mediaUrl
              ? <div className="w-full h-full flex items-center justify-center" style={{ padding: 12, background: 'rgba(0,0,0,0.04)' }}><img src={mediaUrl} alt={name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" /></div>
              : <NoBytes onDownload={download} hasContent={false} />
          )}

          {viewer === 'video' && (
            mediaUrl
              ? <div className="w-full h-full flex items-center justify-center bg-black"><video src={mediaUrl} controls className="max-w-full max-h-full" /></div>
              : <NoBytes onDownload={download} hasContent={false} />
          )}

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
      </div>
    );
  }

  // ===========================================================================
  // COMPACT CARD
  // ===========================================================================
  const canPreview = viewer !== 'none';
  return (
    <div className={shell} style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="flex items-center gap-3 shrink-0" style={{ padding: '13px 14px 10px' }}>
        {Chip}
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

      <div className="flex items-center gap-2 shrink-0" style={{ padding: '2px 14px 13px', marginTop: 'auto' }}>
        <button
          onClick={(e) => { stop(e); openReader(); }}
          onMouseDown={stop}
          className="flex items-center gap-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-sm"
          style={{ padding: '7px 13px', background: canPreview ? 'var(--accent-subtle)' : 'var(--well)', border: canPreview ? '1px solid rgba(var(--accent-rgb),0.3)' : '1px solid var(--border)', color: canPreview ? 'var(--accent)' : 'var(--text-secondary)' }}
          title={canPreview ? 'Open an embedded preview' : 'Open details'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          Open
        </button>

        <button
          onClick={(e) => { stop(e); askAgent(); }}
          onMouseDown={stop}
          disabled={busy}
          title="Let the agent read this file and brief you"
          className="flex items-center gap-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-sm disabled:cursor-wait"
          style={{ padding: '7px 13px', background: 'var(--accent)', color: '#fff', border: '1px solid rgba(var(--accent-rgb),0.5)', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? <span className="rounded-full border-2 border-white border-t-transparent animate-spin" style={{ width: 11, height: 11 }} /> : <SparkleIcon size={12} />}
          {busy ? 'Reading' : 'Ask AI'}
        </button>

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
