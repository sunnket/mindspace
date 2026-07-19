'use client';

import React, { useState, useEffect } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { resolveEmbed, embedCardSize, EMBED_PROVIDERS } from '@/lib/embeds';
import { linkPreviewStyle } from '@/lib/linkPreview';

/**
 * A live embed — paste a link, get the real thing on the canvas (YouTube player,
 * Figma file, Spotify, CodePen, Google Doc…). No API key, no OAuth: the URL is
 * transformed to an iframe src entirely client-side (see lib/embeds).
 *
 * Known providers allow framing, so they embed straight away. A GENERIC website
 * might send X-Frame-Options/CSP that forbid framing (which just renders a blank
 * or a browser error), so those are pre-checked via /api/browser and, when they
 * refuse, shown a graceful card instead of a dead frame.
 */
export default function EmbedBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const url = (obj.content || '').trim();
  const [draft, setDraft] = useState('');
  const resolved = url ? resolveEmbed(url) : null;
  const isGeneric = resolved?.provider === 'website';

  // For generic sites only: 'checking' | 'ok' | 'blocked'
  const [frame, setFrame] = useState<{ status: 'checking' | 'ok' | 'blocked'; reason: string }>({ status: 'checking', reason: '' });

  useEffect(() => {
    if (!isGeneric || !resolved) { return; }
    let cancelled = false;
    setFrame({ status: 'checking', reason: '' });
    fetch(`/api/browser?action=check&url=${encodeURIComponent(resolved.embedUrl)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d && d.embeddable === false) setFrame({ status: 'blocked', reason: d.reason || 'This site blocks embedding.' });
        else setFrame({ status: 'ok', reason: '' });
      })
      .catch(() => { if (!cancelled) setFrame({ status: 'ok', reason: '' }); });
    return () => { cancelled = true; };
  }, [isGeneric, resolved?.embedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (value: string) => {
    const v = (value || '').trim();
    if (!v) return;
    const r = resolveEmbed(v);
    if (!r) return;
    const size = embedCardSize(r.aspect);
    const width = obj.style?.isResized ? obj.width : size.width;
    const height = obj.style?.isResized ? obj.height : (r.aspect ? Math.round(width / r.aspect) + 44 : size.height);
    updateObject(obj.id, { content: v, width, height });
  };

  const clear = () => updateObject(obj.id, { content: '' });

  const asLinkPreview = () => {
    // Fall back to the rich link-preview card, which handles un-embeddable sites.
    const cur = { ...(obj.style || {}) };
    delete (cur as Record<string, unknown>).isEmbed;
    updateObject(obj.id, { content: '', style: { ...cur, ...linkPreviewStyle(url) } });
  };

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

  if (!resolved) {
    return (
      <div className="w-full h-full rounded-2xl flex flex-col justify-center items-center gap-2 bg-[var(--bg-card)] border border-red-500/40 shadow-[var(--shadow-md)]" style={{ padding: 16 }}>
        <span className="text-xs text-[var(--text-secondary)]">That doesn&rsquo;t look like a valid URL.</span>
        <button onClick={clear} onMouseDown={(e) => e.stopPropagation()} className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] cursor-pointer">Try again</button>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between gap-2 select-none shrink-0" style={{ padding: '5px 10px' }}>
      <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--accent)] truncate">{resolved.label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <a href={url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()} className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer">Open ↗</a>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={clear} className="text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer">Change</button>
      </div>
    </div>
  );

  /* --- Generic site that refuses to be framed --- */
  if (isGeneric && frame.status === 'blocked') {
    return (
      <div className="w-full h-full rounded-2xl flex flex-col overflow-hidden pointer-events-auto bg-[var(--bg-card)] border border-[var(--border-strong)] shadow-[var(--shadow-md)]">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2" style={{ padding: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-xs font-semibold text-[var(--text-primary)]">This site won&rsquo;t load in a frame</span>
          <span className="text-[10px] text-[var(--text-secondary)] leading-snug max-w-[240px]">{frame.reason}</span>
          <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
            <a href={url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()} className="rounded-full bg-[var(--accent)] text-white text-[10px] font-bold tracking-wider uppercase cursor-pointer" style={{ padding: '6px 12px' }}>Open in new tab ↗</a>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={asLinkPreview} className="rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] text-[10px] font-bold tracking-wider uppercase cursor-pointer" style={{ padding: '6px 12px' }}>Add as link card</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl flex flex-col overflow-hidden pointer-events-auto bg-[var(--bg-card)] border border-[var(--border-strong)] shadow-[var(--shadow-md)]">
      {header}
      <div className="flex-1 w-full bg-black/5 relative">
        {isGeneric && frame.status === 'checking' ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-[var(--text-tertiary)] tracking-wide animate-pulse">Checking…</span>
          </div>
        ) : (
          <iframe
            src={resolved.embedUrl}
            title={resolved.label}
            className="w-full h-full border-none"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>
    </div>
  );
}
