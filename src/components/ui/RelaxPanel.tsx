'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { RELAX_EFFECTS, RELAX_EFFECT_LIST } from '@/lib/relaxEffects';
import RelaxIcon from './RelaxIcons';

/**
 * The Stress Reliefer picker, as a dropdown off the ▾ board menu.
 *
 * It used to be a toolbar tool, which put a whole mood on the same shelf as
 * the pen and the shape stamp. It isn't something you draw with — it's a state
 * the board is in, like its background, so it lives with the board's own menu.
 *
 * Picking an effect ARMS it: the canvas enters relax mode, and every click
 * spills that effect. "Off" is a first-class tile rather than a hidden gesture,
 * because the way out of a mood has to be as obvious as the way in.
 */
export default function RelaxPanel({ onClose }: { onClose: () => void }) {
  const relaxEffect = useCanvasStore((s) => s.relaxEffect);
  const setRelaxEffect = useCanvasStore((s) => s.setRelaxEffect);
  const setMode = useCanvasStore((s) => s.setMode);
  const mode = useCanvasStore((s) => s.mode);

  const active = relaxEffect ? RELAX_EFFECTS[relaxEffect] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      /* Inline padding — Tailwind's p-* is neutralised by the global reset, and
         at zero the rounded corner clips the heading's first letter. */
      style={{ padding: 16, width: 288 }}
      className="clay-card rounded-[24px] flex flex-col gap-3 max-w-[92vw]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-[11px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-secondary)]">
          Stress Reliefer
        </h3>
        {/* Keyed off the stored effect, NOT off being in relax mode. The effect
            outlives the mode — pick up the pen and it's still remembered, still
            drawn as the lit tile — so tying the way out to the mode left a tile
            looking chosen with no way to unchoose it. */}
        {!!relaxEffect && (
          <button
            onClick={() => { setRelaxEffect(null); if (mode === 'relax') setMode('select'); }}
            className="text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            Turn off
          </button>
        )}
      </div>

      {/* Three across, not four. At four the cells were narrow enough that
          "Gate of Stillness" and "Breathing Sphere" both ellipsised — and a
          picker whose labels you can't read is a grid of riddles. */}
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {RELAX_EFFECT_LIST.map((fx) => {
          const on = relaxEffect === fx.id;
          return (
            <button
              key={fx.id}
              title={fx.blurb}
              onClick={() => {
                setRelaxEffect(fx.id);
                setMode('relax');
                // Get out of the way — the canvas is the point.
                onClose();
              }}
              style={{ padding: '8px 2px' }}
              className={`flex flex-col items-center gap-1 rounded-xl transition-all cursor-pointer active:scale-95 ${
                on
                  ? 'clay-inset text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--well)] hover:text-[var(--text-primary)]'
              }`}
            >
              <RelaxIcon id={fx.id} />
              <span className="text-[9px] font-bold leading-tight text-center">{fx.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
        {active
          ? active.blurb
          : 'Pick an effect, then click anywhere on the board to let it go.'}
      </p>
    </motion.div>
  );
}
