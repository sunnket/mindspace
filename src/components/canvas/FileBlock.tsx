'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { formatBytes } from '@/lib/fileIngest';

const SparkleIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

// A tinted document glyph + short badge label per family, so a glance tells you
// what kind of file it is.
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

// One-line description of the file's shape (pages / slides / sheets / words).
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
  const [showText, setShowText] = useState(false);

  const name = (style.fileName as string) || 'file';
  const ext = (style.fileExt as string) || '';
  const status = (style.fileStatus as string) || 'ready';
  const text = (style.fileText as string) || '';
  const links = (style.fileLinks as string[]) || [];
  const error = (style.fileError as string) || '';
  const truncated = Boolean(style.fileTruncated);
  const { label, color } = fileVisual(ext, String((style.fileMeta as Record<string, unknown>)?.kind || ''));

  const hasText = status === 'ready' && text.trim().length > 0;

  const askAgent = () => {
    // Hand the full extracted text to the canvas agent as file context and let it
    // read the whole thing, then build a briefing beside this block.
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

  return (
    <div
      className="w-full h-full rounded-2xl bg-[rgba(255,252,248,0.5)] dark:bg-black/20 backdrop-blur-2xl border border-white/25 dark:border-white/5 shadow-lg flex flex-col overflow-hidden group"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Header: glyph + name + meta */}
      <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-2.5">
        <div
          className="relative w-11 h-12 rounded-lg shrink-0 flex items-end justify-center pb-1 shadow-sm"
          style={{ background: `${color}1A`, border: `1px solid ${color}40` }}
        >
          {/* dog-eared corner */}
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

      {/* Body: status-dependent */}
      <div className="flex-1 min-h-0 px-3.5 flex flex-col">
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
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setShowText((v) => !v); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="self-start text-[10px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer mb-1"
            >
              {showText ? '▾ Hide extracted text' : '▸ Peek at extracted text'}
              {truncated && !showText ? ' (truncated)' : ''}
            </button>
            <AnimatePresence>
              {showText && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="min-h-0 overflow-y-auto text-[10.5px] leading-relaxed text-[var(--text-secondary)] bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-2 mb-1 select-text whitespace-pre-wrap"
                  style={{ maxHeight: 220 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {text.slice(0, 8000)}{text.length > 8000 ? '…' : ''}
                </motion.div>
              )}
            </AnimatePresence>
            {links.length > 0 && !showText && (
              <div className="text-[10px] text-[var(--text-tertiary)] mb-1 truncate">
                🔗 {links.length} link{links.length === 1 ? '' : 's'} found
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-3.5 pb-3 pt-1.5 pointer-events-auto">
        <button
          onClick={(e) => { e.stopPropagation(); askAgent(); }}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!hasText}
          title={hasText ? 'Let the agent read this file and brief you' : 'No readable text found'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-[10px] font-bold tracking-wider uppercase transition-all shadow-md active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] hover:scale-[1.03]"
        >
          <SparkleIcon size={12} />
          Ask AI
        </button>
        {obj.content?.startsWith('data:') && (
          <button
            onClick={(e) => { e.stopPropagation(); download(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Download file"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] text-[10px] font-bold tracking-wider uppercase transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Save
          </button>
        )}
      </div>
    </div>
  );
}
