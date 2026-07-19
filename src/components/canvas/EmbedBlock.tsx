'use client';

import React, { useState } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { resolveEmbed, embedCardSize, EMBED_PROVIDERS } from '@/lib/embeds';

/**
 * A live embed — paste a link, get the real thing on the canvas (YouTube player,
 * Figma file, Spotify, CodePen, Google Doc…). No API key, no OAuth: the URL is
 * transformed to an iframe src entirely client-side (see lib/embeds). The block
 * stores the raw URL in `content` and re-resolves at render, so improving the
 * registry upgrades every existing embed for free.
 */
export default function EmbedBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const url = (obj.content || '').trim();
  const [draft, setDraft] = useState('');

  const submit = (value: string) => {
    const v = (value || '').trim();
    if (!v) return;
    const resolved = resolveEmbed(v);
    if (!resolved) return;
    const size = embedCardSize(resolved.aspect);
    // Keep the user's width if they've already sized the block; only grow height
    // to the provider's aspect on first resolve.
    const width = obj.style?.isResized ? obj.width : size.width;
    const height = obj.style?.isResized ? obj.height : (resolved.aspect ? Math.round(width / resolved.aspect) + 44 : size.height);
    updateObject(obj.id, { content: v, width, height });
  };

  const clear = () => updateObject(obj.id, { content: '' });

  /* --- Awaiting a URL --- */
  if (!url) {
    return (
      <div
        className="w-full h-full rounded-2xl flex flex-col justify-center gap-3 pointer-events-auto bg-[var(--bg-card)] border border-[var(--border-strong)] backdrop-blur-2xl shadow-[var(--shadow-md)]"
        style={{ padding: 16, fontFamily: "'Outfit', sans-serif" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-[11px] font-bold tracking-wider uppercase">Embed a link</span>
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(draft); } }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text) { e.preventDefault(); setDraft(text); submit(text); }
          }}
          placeholder="Paste a YouTube, Figma, Spotify, CodePen… link"
          className="w-full rounded-xl bg-white/70 dark:bg-white/5 border border-[var(--border)] outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-light)] transition-colors"
          style={{ padding: '8px 12px' }}
        />
        <div className="flex flex-wrap gap-1.5">
          {EMBED_PROVIDERS.slice(0, 8).map((p) => (
            <span key={p.id} className="text-[9px] font-semibold text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-full select-none" style={{ padding: '2px 7px' }}>
              {p.label}
            </span>
          ))}
        </div>
        <button
          onClick={() => submit(draft)}
          disabled={!draft.trim()}
          className="self-start rounded-full bg-[var(--accent)] text-white text-[10px] font-bold tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          style={{ padding: '6px 14px' }}
        >
          Embed
        </button>
      </div>
    );
  }

  const resolved = resolveEmbed(url);

  if (!resolved) {
    return (
      <div className="w-full h-full rounded-2xl flex flex-col justify-center items-center gap-2 bg-[var(--bg-card)] border border-red-500/40 shadow-[var(--shadow-md)]" style={{ padding: 16 }}>
        <span className="text-xs text-[var(--text-secondary)]">That doesn&rsquo;t look like a valid URL.</span>
        <button onClick={clear} onMouseDown={(e) => e.stopPropagation()} className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] cursor-pointer">Try again</button>
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl flex flex-col overflow-hidden pointer-events-auto bg-[var(--bg-card)] border border-[var(--border-strong)] shadow-[var(--shadow-md)]">
      {/* Header — also the drag grip is the block border/selection; this bar just
          labels the provider and gives Open/Change actions. */}
      <div className="flex items-center justify-between gap-2 select-none shrink-0" style={{ padding: '5px 10px' }}>
        <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--accent)] truncate">{resolved.label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            Open ↗
          </a>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={clear}
            className="text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            Change
          </button>
        </div>
      </div>
      <div className="flex-1 w-full bg-black/5 relative">
        <iframe
          src={resolved.embedUrl}
          title={resolved.label}
          className="w-full h-full border-none"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
