'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PluginConfig, getPluginCred, setPluginCred, clearPluginCred } from '@/lib/plugins';

/**
 * The "connect" mini-page. Rather than a hosted OAuth popup (which needs a
 * registered app + server secret we can't ship), this is the honest, working
 * version: paste your own token / webhook URL, it's stored in your browser and
 * used directly. Portalled to <body> so it escapes the toolbar's transform.
 */
export default function ConnectModal({ config, onClose }: { config: PluginConfig; onClose: () => void }) {
  const [value, setValue] = useState('');
  const existing = getPluginCred(config.id);

  useEffect(() => {
    setValue(getPluginCred(config.id));
  }, [config.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const valid = config.kind === 'url' ? /^https:\/\/\S+$/i.test(value.trim()) : value.trim().length > 0;

  const save = () => {
    setPluginCred(config.id, value.trim());
    onClose();
  };
  const disconnect = () => {
    clearPluginCred(config.id);
    setValue('');
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={onClose}
      >
        <motion.div
          className="glass-panel"
          style={{ width: 400, maxWidth: '92vw', padding: 22 }}
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <h3 className="text-base font-bold text-[var(--text-primary)]">Connect {config.title}</h3>
            {existing && (
              <span className="text-[9px] font-bold uppercase tracking-wide rounded-full text-white select-none" style={{ background: '#22C55E', padding: '2px 8px' }}>
                Connected
              </span>
            )}
          </div>

          <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed" style={{ marginBottom: 14 }}>
            {config.help}
            {config.helpUrl && (
              <>
                {' '}
                <a href={config.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] font-semibold underline">
                  Get one ↗
                </a>
              </>
            )}
          </p>

          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] select-none">
            {config.fieldLabel}
          </label>
          <input
            autoFocus
            type={config.kind === 'token' ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid) save(); }}
            placeholder={config.placeholder}
            className="w-full rounded-xl bg-white/70 dark:bg-white/5 border border-[var(--border)] outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-light)] transition-colors"
            style={{ padding: '9px 12px', marginTop: 5 }}
          />

          <p className="text-[10px] text-[var(--text-tertiary)]" style={{ marginTop: 8 }}>
            🔒 Stored only in this browser — it never touches our servers.
          </p>

          <div className="flex items-center justify-end gap-2" style={{ marginTop: 16 }}>
            {existing && (
              <button
                onClick={disconnect}
                className="text-[11px] font-bold uppercase tracking-wider text-red-500 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                style={{ padding: '7px 12px' }}
              >
                Disconnect
              </button>
            )}
            <button
              onClick={onClose}
              className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-colors cursor-pointer"
              style={{ padding: '7px 12px' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!valid}
              className="text-[11px] font-bold uppercase tracking-wider text-white bg-[var(--accent)] rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ padding: '7px 14px' }}
            >
              {existing ? 'Update' : 'Connect'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
