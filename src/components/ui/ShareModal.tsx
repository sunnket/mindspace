'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { createOrUpdateShare, getMyShare, revokeShare, shareUrl } from '@/lib/share';
import { exportBoardPNG, exportBoardPDF } from '@/lib/exportBoard';

/**
 * Share & export a board. Two independent things:
 *   • A view-only link (needs sign-in; a public snapshot others can open).
 *   • PNG / PDF export (fully client-side, works signed-in or not).
 */
export default function ShareModal({ onClose }: { onClose: () => void }) {
  const title = useCanvasStore((s) => s.workspaceTitle);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState<'' | 'png' | 'pdf'>('');

  useEffect(() => {
    getMyShare().then(setToken).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = token ? shareUrl(token) : '';

  const createOrUpdate = async () => {
    setBusy(true); setErr('');
    const res = await createOrUpdateShare();
    setBusy(false);
    if ('error' in res) { setErr(res.error); return; }
    setToken(res.token);
  };

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  const revoke = async () => {
    if (!token) return;
    setBusy(true);
    await revokeShare(token);
    setToken(null); setBusy(false);
  };

  const doExport = async (fmt: 'png' | 'pdf') => {
    setExporting(fmt); setErr('');
    try {
      if (fmt === 'png') await exportBoardPNG(title);
      else await exportBoardPDF(title);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    }
    setExporting('');
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onMouseDown={onClose}
      >
        <motion.div
          className="glass-panel"
          style={{ width: 440, maxWidth: '92vw', padding: 22 }}
          initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h3 className="text-base font-bold text-[var(--text-primary)]" style={{ marginBottom: 4 }}>Share &amp; export</h3>
          <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed" style={{ marginBottom: 16 }}>
            A view-only link shares a snapshot of this board. Export saves it as an image or PDF.
          </p>

          {/* Share link */}
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] select-none" style={{ marginBottom: 6 }}>View-only link</div>
          {token ? (
            <>
              <div className="flex items-center gap-2 rounded-xl bg-white/70 dark:bg-white/5 border border-[var(--border)]" style={{ padding: '8px 10px' }}>
                <input readOnly value={url} className="flex-1 min-w-0 bg-transparent outline-none text-xs text-[var(--text-primary)]" onFocus={(e) => e.target.select()} />
                <button onClick={copy} className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer" style={{ padding: '4px 11px' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </div>
              <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer">Open ↗</a>
                <button onClick={createOrUpdate} disabled={busy} className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-50">{busy ? 'Updating…' : 'Update snapshot'}</button>
                <button onClick={revoke} disabled={busy} className="text-[11px] font-bold uppercase tracking-wide text-red-500 hover:text-red-600 cursor-pointer disabled:opacity-50" style={{ marginLeft: 'auto' }}>Revoke</button>
              </div>
            </>
          ) : (
            <button onClick={createOrUpdate} disabled={busy} className="w-full rounded-xl bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wide hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50" style={{ padding: '10px' }}>
              {busy ? 'Creating…' : 'Create view-only link'}
            </button>
          )}

          {/* Export */}
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] select-none" style={{ margin: '18px 0 6px' }}>Export</div>
          <div className="flex items-center gap-2">
            <button onClick={() => doExport('png')} disabled={!!exporting} className="flex-1 rounded-xl bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent-light)] text-xs font-bold uppercase tracking-wide cursor-pointer disabled:opacity-50 transition-colors" style={{ padding: '10px' }}>{exporting === 'png' ? 'Rendering…' : 'PNG image'}</button>
            <button onClick={() => doExport('pdf')} disabled={!!exporting} className="flex-1 rounded-xl bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent-light)] text-xs font-bold uppercase tracking-wide cursor-pointer disabled:opacity-50 transition-colors" style={{ padding: '10px' }}>{exporting === 'pdf' ? 'Rendering…' : 'PDF'}</button>
          </div>

          {err && <p className="text-[11px] text-red-500" style={{ marginTop: 12 }}>{err}</p>}

          <div className="flex justify-end" style={{ marginTop: 16 }}>
            <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer" style={{ padding: '7px 12px' }}>Done</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
