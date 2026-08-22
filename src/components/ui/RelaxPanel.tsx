'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { RELAX_EFFECTS, RELAX_EFFECT_LIST, RELAX_GROUPS } from '@/lib/relaxEffects';
import RelaxIcon from './RelaxIcons';

/**
 * The Stress Reliefer picker, hung off the ▾ board menu — it isn't something
 * you draw with, it's a state the board is in, like its background.
 *
 * Rebuilt at twenty-seven effects. The old 3-column grid of 9px labels worked
 * at seventeen and became a wall at twenty-seven: you stop reading a wall after
 * the first row, and half the catalogue was never found. Three changes fix it,
 * and they are all the same idea — *you are picking a mood, not a filename*:
 *
 *   • Shelves. Water, Garden, Sky, Firelight, Play, Stillness. You know which
 *     shelf you want before you know which effect, so the shelf is the first
 *     thing you read.
 *   • One blurb line, driven by HOVER rather than only by selection. Sweeping
 *     the grid now reads you the whole catalogue a sentence at a time, which is
 *     the only way anyone was ever going to discover Ink in Water.
 *   • The tile lights from its own shelf's colour, so the grid has a rhythm
 *     down the panel instead of twenty-seven identical chips.
 */

/** A tint per shelf, so the panel reads as six places rather than one list. */
const SHELF_TINT: Record<string, string> = {
  Immersion: '212, 70%, 64%',
  Water: '182, 76%, 52%',
  Garden: '120, 52%, 48%',
  Sky: '265, 78%, 66%',
  Firelight: '28, 92%, 58%',
  Play: '330, 82%, 62%',
  Stillness: '42, 34%, 58%',
};

export default function RelaxPanel({ onClose }: { onClose: () => void }) {
  const relaxEffect = useCanvasStore((s) => s.relaxEffect);
  const setRelaxEffect = useCanvasStore((s) => s.setRelaxEffect);
  const setMode = useCanvasStore((s) => s.setMode);
  const mode = useCanvasStore((s) => s.mode);

  /* What the blurb line is currently describing. Hover wins over selection, so
     the line follows the cursor and falls back to what is actually armed. */
  const [peek, setPeek] = useState<string | null>(null);
  const shown = peek ?? relaxEffect;
  const shownFx = shown ? RELAX_EFFECTS[shown as keyof typeof RELAX_EFFECTS] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ padding: 16 }}
      /* `tool-panel`, not `glass-panel`: glass read fine floating over empty
         canvas at the bottom of the screen but turns unreadable up here, where
         the dropdown lands on top of actual cards. */
      className="tool-panel flex flex-col gap-2 w-[302px]"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setPeek(null)}
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

      <div
        className="flex flex-col gap-2 overflow-y-auto pr-0.5"
        style={{ maxHeight: 'min(64vh, 520px)', scrollbarWidth: 'thin' }}
      >
        {RELAX_GROUPS.map((group) => {
          const items = RELAX_EFFECT_LIST.filter((fx) => fx.group === group);
          if (!items.length) return null;
          const tint = SHELF_TINT[group] ?? '42, 34%, 58%';
          return (
            <div key={group} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5" style={{ paddingLeft: 2 }}>
                <span
                  style={{ width: 5, height: 5, borderRadius: 999, background: `hsl(${tint})`, flex: '0 0 auto' }}
                />
                <span className="text-[8.5px] uppercase font-bold tracking-[0.14em] text-[var(--text-muted)]">
                  {group}
                </span>
                <span className="text-[8.5px] font-semibold text-[var(--text-muted)] opacity-50">
                  {items.length}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {items.map((fx) => {
                  const active = relaxEffect === fx.id;
                  return (
                    <button
                      key={fx.id}
                      title={fx.label}
                      onMouseEnter={() => setPeek(fx.id)}
                      onFocus={() => setPeek(fx.id)}
                      onClick={() => {
                        setRelaxEffect(fx.id);
                        setMode('relax');
                        // Get out of the way immediately — the canvas is the point.
                        onClose();
                      }}
                      style={{
                        padding: '9px 3px 7px',
                        /* A fixed height, because 'Blooming Garden' wraps to two
                           lines and 'Aurora' does not — left to itself the grid
                           gets a different row height every second row. */
                        minHeight: 58,
                        justifyContent: 'center',
                        ...(active
                          ? {
                              background: `hsla(${tint}, 0.16)`,
                              borderColor: `hsla(${tint}, 0.55)`,
                              color: `hsl(${tint})`,
                            }
                          : null),
                      }}
                      className={`flex flex-col items-center gap-1 rounded-lg border transition-all cursor-pointer ${
                        active
                          ? 'shadow-sm'
                          : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <RelaxIcon id={fx.id} size={17} />
                      <span className="text-[8px] font-semibold leading-[1.15] text-center">
                        {fx.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* One line, always the same height, so the panel never jumps as the
          cursor moves across the grid. */}
      <p
        className="text-[10px] text-[var(--text-muted)] leading-relaxed"
        style={{ minHeight: 42, paddingTop: 6, borderTop: '1px solid var(--border)' }}
      >
        {shownFx ? (
          <>
            <span className="font-bold text-[var(--text-secondary)]">{shownFx.label}. </span>
            {shownFx.blurb}
          </>
        ) : (
          'Pick an effect, then click anywhere on the canvas to let it go.'
        )}
      </p>
    </motion.div>
  );
}
