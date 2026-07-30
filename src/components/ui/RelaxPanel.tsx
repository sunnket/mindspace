'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { RELAX_EFFECTS, RELAX_EFFECT_LIST } from '@/lib/relaxEffects';
import RelaxIcon from './RelaxIcons';

/**
 * The Stress Reliefer picker, lifted out of the toolbar and hung off the ▾
 * board menu instead — it isn't something you draw with, it's a state the
 * board is in, like its background.
 *
 * Deliberately the SAME panel it always was: same glass surface, same 3×5 grid,
 * same blurb line. Only the anchor moved.
 *
 * Picking an effect arms it — the canvas enters relax mode and every click
 * spills that effect. "Turn off" keys off the stored effect rather than the
 * mode, because the effect outlives the mode: pick up the pen and it's still
 * remembered and still drawn as the lit tile.
 */
export default function RelaxPanel({ onClose }: { onClose: () => void }) {
  const relaxEffect = useCanvasStore((s) => s.relaxEffect);
  const setRelaxEffect = useCanvasStore((s) => s.setRelaxEffect);
  const setMode = useCanvasStore((s) => s.setMode);
  const mode = useCanvasStore((s) => s.mode);

  const activeRelax = relaxEffect ? RELAX_EFFECTS[relaxEffect] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ padding: 16 }}
      /* `tool-panel`, not the `glass-panel` this had in the toolbar. Glass is a
         translucent blur, which read fine floating over empty canvas at the
         bottom of the screen but turns unreadable up here, where the dropdown
         lands on top of actual cards. Same opaque surface as the Background
         dropdown beside it; the contents are untouched. */
      className="tool-panel flex flex-col gap-3 min-w-[240px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">
          Stress Reliefer
        </span>
        {!!relaxEffect && (
          <button
            onClick={() => { setRelaxEffect(null); if (mode === 'relax') setMode('select'); }}
            className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            Turn off
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {RELAX_EFFECT_LIST.map((fx) => {
          const active = relaxEffect === fx.id;
          return (
            <button
              key={fx.id}
              title={fx.label}
              onClick={() => {
                setRelaxEffect(fx.id);
                setMode('relax');
                // Get out of the way immediately — the canvas is the point.
                onClose();
              }}
              style={{ padding: '10px 8px' }}
              className={`flex flex-col items-center gap-1 rounded-lg border transition-all cursor-pointer ${
                active
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-light)] shadow-sm'
                  : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <RelaxIcon id={fx.id} />
              <span className="text-[9px] font-semibold leading-tight text-center">{fx.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
        {activeRelax
          ? activeRelax.blurb
          : 'Pick an effect, then click anywhere on the canvas to let it go.'}
      </p>
    </motion.div>
  );
}
