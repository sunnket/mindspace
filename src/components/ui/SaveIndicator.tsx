'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

export default function SaveIndicator() {
  const isDirty = useCanvasStore((s) => s.isDirty);
  const lastSaved = useCanvasStore((s) => s.lastSaved);

  const timeSince = lastSaved ? Math.floor((Date.now() - lastSaved) / 1000) : 0;
  const label =
    lastSaved === 0
      ? ''
      : timeSince < 5
      ? 'Saved'
      : timeSince < 60
      ? `${timeSince}s ago`
      : `${Math.floor(timeSince / 60)}m ago`;

  return (
    <motion.div
      className="fixed bottom-4 right-12 z-50 pointer-events-none flex items-center gap-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1 }}
    >
      <div className={`save-pulse ${isDirty ? 'bg-[var(--accent)]' : 'bg-[var(--accent-light)]'}`} />
      {label && (
        <span className="text-[10px] text-[var(--text-muted)] font-light">{label}</span>
      )}
    </motion.div>
  );
}
