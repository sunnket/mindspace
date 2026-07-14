'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { formatBytes } from '@/lib/fileIngest';
import { playSnap } from '@/lib/relaxAudio';

const SparkleIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

function fileVisual(ext: string, kind: string): { label: string; color: string } {
  const e = ext.toLowerCase();
  if (e === 'pdf' || /pdf/i.test(kind)) return { label: 'PDF', color: '#D64545' };
  if (['doc', 'docx', 'rtf', 'odt'].includes(e) || /word/i.test(kind)) return { label: 'DOC', color: '#3E63DD' };
  if (['ppt', 'pptx', 'key', 'odp'].includes(e) || /power/i.test(kind)) return { label: 'PPT', color: '#E8833A' };
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(e) || /sheet|spreadsheet/i.test(kind)) return { label: 'XLS', color: '#2F9E6E' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e) || /archive/i.test(kind)) return { label: 'ZIP', color: '#8B7355' };
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'sh', 'sql', 'json', 'html', 'css', 'vue', 'svelte'].includes(e)) return { label: 'CODE', color: '#6E56CF' };
  if (['md', 'markdown', 'txt', 'rst', 'tex'].includes(e)) return { label: 'TXT', color: '#5A6270' };
  return { label: (e || 'FILE').slice(0, 4).toUpperCase(), color: '#C97B4B' };
}

function metaLine(style: Record<string, unknown>): string {
  const meta = (style.fileMeta as Record<string, unknown>) || {};
  const bits: string[] = [];
  if (typeof meta.pages === 'number') bits.push(`${meta.pages} page${meta.pages === 1 ? '' : 's'}`);
  if (typeof meta.slides === 'number') bits.push(`${meta.slides} slide${meta.slides === 1 ? '' : 's'}`);
  if (typeof meta.sheets === 'number') bits.push(`${meta.sheets} sheet${meta.sheets === 1 ? '' : 's'}`);
  if (typeof meta.files === 'number') bits.push(`${meta.files} file${meta.files === 1 ? '' : 's'}`);
  if (typeof meta.words === 'number' && meta.words > 0) bits.push(`${meta.words.toLocaleString()} words`);
  const size = style.fileSize as number;
  if (size) bits.push(formatBytes(size));
  return bits.join(' · ');
}

export default function FileBlock({ obj }: { obj: CanvasObjectData }) {
  const style = obj.style || {};
  const updateObject = useCanvasStore((s) => s.updateObject);
  const addObject = useCanvasStore((s) => s.addObject);

  const name = (style.fileName as string) || 'file';
  const ext = (style.fileExt as string) || '';
  const status = (style.fileStatus as string) || 'ready';
  const text = (style.fileText as string) || '';
  const links = (style.fileLinks as string[]) || [];
  const error = (style.fileError as string) || '';
  const truncated = Boolean(style.fileTruncated);
  const { label, color } = fileVisual(ext, String((style.fileMeta as Record<string, unknown>)?.kind || ''));

  // Reader settings stored in object state style
  const readerOpen = Boolean(style.readerOpen);
  const clipMode = Boolean(style.clipMode);
  const nativeView = Boolean(style.nativeView) && ext.toLowerCase() === 'pdf' && !!obj.content?.startsWith('data:');
  const readerFontSize = (style.readerFontSize as number) || 12;

  const hasText = status === 'ready' && text.trim().length > 0;
  const isPdf = ext.toLowerCase() === 'pdf';

  const patchStyle = (kv: Record<string, unknown>) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { style: { ...(cur?.style || obj.style), ...kv } });
  };

  const openReader = () => {
    const curW = obj.width;
    const curH = obj.height;
    updateObject(obj.id, {
      width: 520,
      height: 640,
      style: {
        ...obj.style,
        readerOpen: true,
        prevWidth: curW,
        prevHeight: curH,
      },
    });
  };

  const closeReader = () => {
    const prevW = (style.prevWidth as number) || 300;
    const prevH = (style.prevHeight as number) || 132;
    updateObject(obj.id, {
      width: prevW,
      height: prevH,
      style: {
        ...obj.style,
        readerOpen: false,
        clipMode: false,
        nativeView: false,
      },
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!clipMode) return;
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      try {
        playSnap();
      } catch {
        /* ignore context constraints */
      }
      
      // Spawn new text block on canvas right next to the current card
      addObject({
        type: 'text',
        x: obj.x + obj.width + 40,
        y: obj.y + 40,
        width: 300,
        height: 160,
        content: selection,
      });

      // Clear selection so the user can easily select the next phrase
      window.getSelection()?.removeAllRanges();
    }
  };

  const askAgent = () => {
    window.dispatchEvent(
      new CustomEvent('run-agent', {
        detail: {
          prompt: `Read the attached file "${name}" in full and build a clear, well-structured briefing on the canvas about it — a heading with the file name, a concise summary, the key points, any links or figures, and (if it's code) what it does. Ground everything strictly in the file's real content.`,
          apiKeyIndex: 0,
          x: obj.x + obj.width + 90,
          y: obj.y,
          filesContext: `FILE: ${name}\n${text}`,
        },
      })
    );
  };

  const download = () => {
    if (!obj.content || !obj.content.startsWith('data:')) return;
    const a = document.createElement('a');
    a.href = obj.content;
    a.download = name;
    a.click();
  };

  // Render file paragraphs safely
  const paragraphs = React.useMemo(() => {
    return text.split('\n\n').filter((p) => p.trim().length > 0);
  }, [text]);

  return (
    <div
      className="w-full h-full rounded-2xl bg-[rgba(255,252,248,0.5)] dark:bg-black/20 backdrop-blur-2xl border border-white/25 dark:border-white/5 shadow-lg flex flex-col overflow-hidden group select-none pointer-events-auto"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Header: glyph + name + meta info */}
      <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-2.5 shrink-0 border-b border-transparent dark:border-transparent select-none">
        <div
          className="relative w-11 h-12 rounded-lg shrink-0 flex items-end justify-center pb-1 shadow-sm"
          style={{ background: `${color}1A`, border: `1px solid ${color}40` }}
        >
          <div className="absolute top-0 right-0 w-3 h-3" style={{ background: `${color}33`, clipPath: 'polygon(0 0, 100% 100%, 100% 0)' }} />
          <span className="text-[8px] font-black tracking-wider" style={{ color }}>{label}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-[var(--text-primary)] truncate select-text" title={name}>{name}</div>
          <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">
            {status === 'loading' ? 'Reading file…' : status === 'error' ? 'Could not read file' : metaLine(style) || 'Ready'}
          </div>
        </div>
      </div>

      {/* Reader Layout Mode */}
      {readerOpen && hasText ? (
        <div className="flex-1 min-h-0 flex flex-col px-3.5 pb-3">
          {/* Reader Toolbar */}
          <div className="flex items-center justify-between py-2 border-b border-[var(--border)] mb-2 select-none" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1.5">
              <button
                onClick={closeReader}
                className="px-2.5 py-1 rounded-lg bg-[var(--well)] hover:bg-[var(--accent)]/10 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              >
                Close
              </button>

              {isPdf && obj.content?.startsWith('data:') && (
                <button
                  onClick={() => patchStyle({ nativeView: !nativeView })}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    nativeView ? 'clay-inset text-[var(--accent)]' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  📄 PDF View
                </button>
              )}

              <button
                onClick={() => patchStyle({ clipMode: !clipMode })}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1 ${
                  clipMode ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/20' : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title="When active, highlighting any text instantly extracts it to the canvas."
              >
                <span>✂️</span> Clip Mode
              </button>
            </div>

            {/* Stepper for Reader Font Size */}
            {!nativeView && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => patchStyle({ readerFontSize: Math.max(10, readerFontSize - 1) })}
                  className="w-5.5 h-5.5 rounded bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center text-[10px] font-bold cursor-pointer"
                >
                  A-
                </button>
                <span className="text-[10px] font-mono font-bold text-[var(--text-tertiary)] px-1">{readerFontSize}px</span>
                <button
                  onClick={() => patchStyle({ readerFontSize: Math.min(20, readerFontSize + 1) })}
                  className="w-5.5 h-5.5 rounded bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center text-[10px] font-bold cursor-pointer"
                >
                  A+
                </button>
              </div>
            )}
          </div>

          {/* Reader Instruction Alert for Clip Mode */}
          {clipMode && !nativeView && (
            <div className="px-2.5 py-1.5 bg-emerald-500/8 text-emerald-600/90 text-[10px] font-medium rounded-lg border border-emerald-500/12 mb-2 leading-relaxed select-none">
              ✨ <strong>Surgical clipping active:</strong> Highlight text inside the reader, and it will spawn a text block on your board automatically.
            </div>
          )}

          {/* Reader Content Area */}
          <div className="flex-1 min-h-0 flex flex-col">
            {nativeView ? (
              <iframe
                src={obj.content}
                className="w-full h-full border-0 rounded-xl bg-white shadow-inner select-text"
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 bg-black/5 dark:bg-white/5 rounded-xl border border-[var(--border)] select-text selection:bg-[var(--accent)]/20 custom-scrollbar"
                style={{ fontSize: `${readerFontSize}px` }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={handleMouseUp}
              >
                <div className="space-y-4">
                  {paragraphs.map((p, idx) => (
                    <p key={idx} className="leading-relaxed text-[var(--text-primary)] tracking-wide font-normal">
                      {p}
                    </p>
                  ))}
                  {truncated && (
                    <p className="text-[10px] italic text-[var(--text-muted)] select-none">
                      (Document content truncated for workspace optimization)
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Draggable extracted links */}
            {links.length > 0 && !nativeView && (
              <div className="flex flex-col gap-1.5 mt-2 shrink-0 select-none" onMouseDown={(e) => e.stopPropagation()}>
                <span className="text-[9px] uppercase font-extrabold tracking-widest text-[var(--text-tertiary)] px-0.5">Extracted Links (drag onto board):</span>
                <div className="flex gap-1.5 py-1 overflow-x-auto custom-scrollbar">
                  {links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', link);
                        e.dataTransfer.setData('text/uri-list', link);
                      }}
                      className="px-2.5 py-1 rounded-full bg-[var(--well)] hover:bg-[var(--accent)]/10 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border)] whitespace-nowrap cursor-grab active:cursor-grabbing transition-colors"
                    >
                      🔗 {link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 28)}{link.length > 28 ? '…' : ''}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Compact / Normal view mode */
        <div className="flex-1 min-h-0 px-3.5 flex flex-col select-none">
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] py-1">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              Extracting text, links & structure…
            </div>
          )}

          {status === 'error' && (
            <div className="text-[11px] text-red-500/80 py-1 leading-relaxed">{error || 'This file could not be read.'}</div>
          )}

          {hasText && (
            <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)] line-clamp-3 select-text select-all" onMouseDown={(e) => e.stopPropagation()}>
              {text.slice(0, 240)}...
            </p>
          )}
        </div>
      )}

      {/* Compact view actions footer */}
      {!readerOpen && (
        <div className="flex items-center gap-2 px-3.5 pb-3.5 pt-2 shrink-0 select-none">
          {hasText && (
            <button
              onClick={(e) => { e.stopPropagation(); openReader(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] text-[10px] font-bold tracking-wider uppercase transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              📖 Open Reader
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); askAgent(); }}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!hasText}
            title={hasText ? 'Let the agent read this file and brief you' : 'No readable text found'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all active:scale-95 disabled:cursor-not-allowed cursor-pointer ${
              hasText
                ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] text-white shadow-md hover:scale-[1.03]'
                : 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/15 opacity-60 shadow-none'
            }`}
          >
            <SparkleIcon size={12} />
            Ask AI
          </button>

          {obj.content?.startsWith('data:') && (
            <button
              onClick={(e) => { e.stopPropagation(); download(); }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Download file"
              className="flex items-center justify-center w-7 h-7 rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
