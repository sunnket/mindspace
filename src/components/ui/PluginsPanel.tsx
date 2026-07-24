'use client';

import React, { useEffect, useReducer, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { newEmbedCard, EMBED_PROVIDERS } from '@/lib/embeds';
import { PLUGIN_CONFIGS, PluginConfig, getPluginCred } from '@/lib/plugins';
import ConnectModal from './ConnectModal';

/**
 * The Plugins panel. Everything here actually works, with no hosted OAuth:
 *   • Embeds & GitHub — live, zero setup.
 *   • GitHub token & Webhook — "bring your own key": paste a token / webhook URL
 *     in the Connect modal and it's used directly (see lib/plugins).
 */
export default function PluginsPanel({ onClose }: { onClose: () => void }) {
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const camera = useCanvasStore((s) => s.camera);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const objects = useCanvasStore((s) => s.objects);

  const [connect, setConnect] = useState<PluginConfig | null>(null);
  const [send, setSend] = useState<{ state: 'idle' | 'sending' | 'ok' | 'err'; msg: string }>({ state: 'idle', msg: '' });

  // Re-render when a credential changes (connect/disconnect in the modal).
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const h = () => force();
    window.addEventListener('plugin-cred-changed', h);
    return () => window.removeEventListener('plugin-cred-changed', h);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !connect) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, connect]);

  const spawn = () => ({
    x: (-camera.x + window.innerWidth / 2) / camera.zoom,
    y: (-camera.y + window.innerHeight / 2) / camera.zoom - 120,
  });

  const addEmbed = () => { const { x, y } = spawn(); const b = addObject(newEmbedCard(x, y)); setSelectedId(b.id); onClose(); };
  const addGitHub = () => { const { x, y } = spawn(); const b = addObject({ type: 'card', x, y, width: 340, height: 200, content: '', style: { isGithub: true } }); setSelectedId(b.id); onClose(); };

  const githubConf = PLUGIN_CONFIGS.find((c) => c.id === 'github')!;
  const webhookConf = PLUGIN_CONFIGS.find((c) => c.id === 'webhook')!;
  const webhookUrl = getPluginCred('webhook');
  const githubToken = getPluginCred('github');

  const selected = objects.find((o) => o.id === selectedId);
  const selectedText = (selected?.content || '').trim();

  const sendToWebhook = async (text: string) => {
    if (!webhookUrl) return;
    setSend({ state: 'sending', msg: '' });
    try {
      const res = await fetch('/api/plugin-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, text }),
      });
      if (res.ok) setSend({ state: 'ok', msg: 'Sent ✓' });
      else {
        const d = await res.json().catch(() => ({}));
        setSend({ state: 'err', msg: d.error || 'Failed' });
      }
    } catch {
      setSend({ state: 'err', msg: 'Network error' });
    }
    setTimeout(() => setSend({ state: 'idle', msg: '' }), 3500);
  };

  const Section = ({ label }: { label: string }) => (
    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] select-none" style={{ margin: '12px 0 6px' }}>{label}</div>
  );
  const plug = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );

  return (
    <>
      <div
        className="glass-panel"
        style={{ width: 322, maxHeight: '64vh', overflowY: 'auto', padding: 14 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 select-none text-[var(--accent)]" style={{ marginBottom: 3 }}>
          {plug}
          <span className="text-sm font-bold text-[var(--text-primary)]">Plugins</span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">Connect the canvas to the tools you already use.</p>

        <Section label="Live · no setup" />
        <button onClick={addEmbed} className="w-full text-left rounded-xl flex items-start gap-3 transition-colors hover:bg-[var(--bg-secondary)] cursor-pointer" style={{ padding: '9px 10px' }}>
          <span className="shrink-0 text-[var(--accent)]" style={{ marginTop: 1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[var(--text-primary)]">Embed a link</span>
            <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">{EMBED_PROVIDERS.slice(0, 6).map((p) => p.label).join(' · ')} & more</span>
          </span>
        </button>
        <button onClick={addGitHub} className="w-full text-left rounded-xl flex items-start gap-3 transition-colors hover:bg-[var(--bg-secondary)] cursor-pointer" style={{ padding: '9px 10px' }}>
          <span className="shrink-0 text-[var(--text-primary)]" style={{ marginTop: 1 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[var(--text-primary)]">GitHub</span>
            <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">Repo, issue, PR, gist or user → live card</span>
          </span>
        </button>

        <Section label="Connect · your key" />

        {/* GitHub token */}
        <div className="w-full rounded-xl flex items-center justify-between gap-2" style={{ padding: '8px 10px' }}>
          <span className="min-w-0">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{githubConf.title}</span>
            <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">{githubConf.blurb}</span>
          </span>
          <button onClick={() => setConnect(githubConf)} className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full cursor-pointer transition-colors ${githubToken ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'bg-[var(--accent)] text-white hover:opacity-90'}`} style={{ padding: '4px 11px' }}>
            {githubToken ? 'Connected' : 'Connect'}
          </button>
        </div>

        {/* Webhook */}
        <div className="w-full rounded-xl" style={{ padding: '8px 10px' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{webhookConf.title}</span>
              <span className="block text-[10px] text-[var(--text-secondary)] leading-snug">{webhookConf.blurb}</span>
            </span>
            <button onClick={() => setConnect(webhookConf)} className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full cursor-pointer transition-colors ${webhookUrl ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'bg-[var(--accent)] text-white hover:opacity-90'}`} style={{ padding: '4px 11px' }}>
              {webhookUrl ? 'Connected' : 'Connect'}
            </button>
          </div>
          {webhookUrl && (
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
              <button onClick={() => sendToWebhook('🧠 Hello from canvabrains — your webhook is connected!')} disabled={send.state === 'sending'} className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-50" style={{ padding: '4px 10px' }}>Send test</button>
              {selectedText && (
                <button onClick={() => sendToWebhook(selectedText.slice(0, 1500))} disabled={send.state === 'sending'} className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-50" style={{ padding: '4px 10px' }}>Send selected note</button>
              )}
              {send.state !== 'idle' && (
                <span className={`text-[10px] font-semibold ${send.state === 'err' ? 'text-red-500' : send.state === 'ok' ? 'text-green-600' : 'text-[var(--text-tertiary)]'}`}>
                  {send.state === 'sending' ? 'Sending…' : send.msg}
                </span>
              )}
            </div>
          )}
        </div>

        <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed" style={{ marginTop: 12 }}>
          Notion, Linear & Google need a registered OAuth app — ask me to wire one up and I&rsquo;ll add it here.
        </p>
      </div>

      {connect && <ConnectModal config={connect} onClose={() => setConnect(null)} />}
    </>
  );
}
