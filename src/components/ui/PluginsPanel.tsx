'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { newEmbedCard, EMBED_PROVIDERS } from '@/lib/embeds';

/**
 * The 🔌 Plugins panel. Two kinds of connectors:
 *   • LIVE — work right now, no setup: universal link embeds (YouTube, Figma,
 *     Spotify, CodePen, Google Docs…) and GitHub via its public API.
 *   • CONNECT — first-party OAuth integrations that genuinely need your own app
 *     credentials/API key; shown honestly as "soon" rather than faked.
 */
export default function PluginsPanel({ onClose }: { onClose: () => void }) {
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const camera = useCanvasStore((s) => s.camera);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const spawn = () => ({
    x: (-camera.x + window.innerWidth / 2) / camera.zoom,
    y: (-camera.y + window.innerHeight / 2) / camera.zoom - 120,
  });

  const addEmbed = () => {
    const { x, y } = spawn();
    const b = addObject(newEmbedCard(x, y));
    setSelectedId(b.id);
    onClose();
  };

  const addGitHub = () => {
    const { x, y } = spawn();
    const b = addObject({ type: 'card', x, y, width: 340, height: 200, content: '', style: { isGithub: true } });
    setSelectedId(b.id);
    onClose();
  };

  const soon: { name: string; note: string }[] = [
    { name: 'Notion', note: 'pages & databases' },
    { name: 'Linear', note: 'issues → cards' },
    { name: 'Slack', note: 'post to a channel' },
    { name: 'Discord', note: 'webhook posts' },
    { name: 'Google Drive', note: 'files & docs' },
    { name: 'Google Calendar', note: 'events' },
    { name: 'Incoming Webhook', note: 'POST → new block' },
  ];

  const Section = ({ label }: { label: string }) => (
    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] select-none" style={{ margin: '10px 0 6px' }}>
      {label}
    </div>
  );

  return (
    <motion.div
      className="glass-panel"
      style={{ width: 320, maxHeight: '62vh', overflowY: 'auto', padding: 14 }}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 select-none" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>🔌</span>
        <span className="text-sm font-bold text-[var(--text-primary)]">Plugins</span>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed" style={{ marginBottom: 2 }}>
        Connect the canvas to the tools you already use.
      </p>

      <Section label="Live · no setup" />

      {/* Universal embeds */}
      <button
        onClick={addEmbed}
        className="w-full text-left rounded-xl flex items-start gap-3 transition-colors hover:bg-[var(--bg-secondary)] cursor-pointer"
        style={{ padding: '9px 10px' }}
      >
        <span className="shrink-0 text-[var(--accent)]" style={{ marginTop: 1 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-[var(--text-primary)]">Embed a link</span>
          <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">
            {EMBED_PROVIDERS.slice(0, 6).map((p) => p.label).join(' · ')} & more
          </span>
        </span>
      </button>

      {/* GitHub */}
      <button
        onClick={addGitHub}
        className="w-full text-left rounded-xl flex items-start gap-3 transition-colors hover:bg-[var(--bg-secondary)] cursor-pointer"
        style={{ padding: '9px 10px' }}
      >
        <span className="shrink-0 text-[var(--text-primary)]" style={{ marginTop: 1 }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-[var(--text-primary)]">GitHub</span>
          <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">Repo, issue, PR, gist or user → live card</span>
        </span>
      </button>

      <Section label="Connect · needs your API key" />
      <div className="flex flex-col gap-0.5">
        {soon.map((s) => (
          <div
            key={s.name}
            title={`${s.name} needs its own OAuth app / API key — coming soon`}
            className="w-full flex items-center justify-between rounded-lg select-none"
            style={{ padding: '7px 10px', opacity: 0.6 }}
          >
            <span className="min-w-0">
              <span className="text-[12px] font-medium text-[var(--text-primary)]">{s.name}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]" style={{ marginLeft: 6 }}>{s.note}</span>
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wide rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] shrink-0" style={{ padding: '2px 7px' }}>
              Soon
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
