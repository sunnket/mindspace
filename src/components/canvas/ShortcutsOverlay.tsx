'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select / move'],
      ['T', 'Text'],
      ['Hold D', 'Draw'],
      ['S', 'Shape'],
      ['A', 'Arrow'],
      ['Hold Space', 'Pan'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Scroll', 'Pan around'],
      ['⌘ / Ctrl + Scroll', 'Zoom'],
      ['⌘ / Ctrl + F', 'Spatial search'],
      ['⌘ / Ctrl + K', 'Command palette'],
      ['Double-click', 'Enter a heading'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['⌘ / Ctrl + Z', 'Undo'],
      ['⌘ / Ctrl + Shift + Z', 'Redo'],
      ['Delete', 'Remove selected'],
      ['Esc', 'Deselect / go back'],
      ['?', 'Toggle this help'],
    ],
  },
];

export default function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(45,42,38,0.35)] backdrop-blur-md" onClick={onClose} />

          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="clay-card relative w-full max-w-2xl rounded-[28px] p-8 z-10"
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <h2 className="text-xl italic text-[var(--text-primary)] mb-1" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Keyboard shortcuts
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)] mb-6">Move faster on the canvas.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-[10px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-tertiary)] mb-3">
                    {group.title}
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    {group.items.map(([key, label]) => (
                      <li key={label} className="flex items-center justify-between gap-3">
                        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
                        <kbd className="shrink-0 px-2 py-1 rounded-lg clay-inset text-[10px] font-mono font-bold text-[var(--text-primary)] whitespace-nowrap">
                          {key}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
