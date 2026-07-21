'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import AnimatedText from '@/components/canvas/AnimatedText';
import {
  ANIM_CATEGORIES,
  presetsByCategory,
  getAnimPreset,
  type AnimCategory,
  type AnimPreset,
  type AnimTrigger,
  type TextAnimConfig,
} from '@/lib/textAnim';

/**
 * The Text Animation gallery. A live-preview tile grid (each tile actually plays
 * the effect so you pick with your eyes, never blind), category tabs, and a small
 * controls row for trigger + speed. Writes the config straight onto the block via
 * `onChange`; `null` clears it. Styling follows the clay design language and uses
 * inline padding/margins (the Tailwind padding/margin utilities are neutralised by
 * the global reset, so they're avoided here).
 */

const TRIGGER_LABEL: Record<AnimTrigger, string> = {
  appear: 'On appear',
  loop: 'Loop',
  click: 'On click',
};

/** A tile playing its effect live. The engine loops by default (see resolveAnim),
 *  so no manual re-trigger is needed — reveals replay, ambients run forever. */
function PreviewTile({
  preset,
  active,
  onPick,
}: {
  preset: AnimPreset;
  active: boolean;
  onPick: () => void;
}) {
  const sample = preset.sample ?? (preset.kind === 'kinetic' && preset.unit === 'word' ? 'Make it move' : 'Canvas');

  return (
    <button
      type="button"
      onClick={onPick}
      title={preset.hint}
      aria-pressed={active}
      className="group relative rounded-xl overflow-hidden text-left transition-all duration-150 cursor-pointer active:scale-[0.98]"
      style={{
        padding: '10px 12px 8px',
        minHeight: 74,
        background: 'var(--well)',
        boxShadow: active
          ? '0 0 0 2px var(--accent), 0 0 0 4px var(--accent-subtle)'
          : 'inset 0 1px 2px rgba(90,62,40,0.07)',
      }}
    >
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ height: 34, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}
      >
        <AnimatedText content={sample} anim={{ preset: preset.id }}>
          {sample}
        </AnimatedText>
      </div>
      <div
        className="truncate"
        style={{ marginTop: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.01em', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
      >
        {preset.name}
      </div>
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg" style={{ padding: 3, background: 'var(--well)', boxShadow: 'inset 0 1px 2px rgba(90,62,40,0.07)' }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className="flex-1 rounded-md text-[11px] font-bold transition-all duration-150 cursor-pointer whitespace-nowrap"
            style={{
              padding: '6px 10px',
              color: on ? 'var(--accent)' : 'var(--text-secondary)',
              background: on ? 'var(--bg-card)' : 'transparent',
              boxShadow: on ? '0 1px 3px rgba(45,42,38,0.12)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TextAnimPanel({
  value,
  onChange,
  onClose,
}: {
  value: TextAnimConfig | undefined;
  onChange: (cfg: TextAnimConfig | null) => void;
  onClose: () => void;
}) {
  const current = getAnimPreset(value?.preset);
  const [cat, setCat] = useState<AnimCategory>(current?.category ?? 'Reveal');
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const pick = (p: AnimPreset) => {
    const allowed = p.triggers ?? ['appear', 'loop', 'click'];
    const keepTrigger = value?.trigger && allowed.includes(value.trigger) ? value.trigger : undefined;
    onChange({ preset: p.id, trigger: keepTrigger, speed: value?.speed ?? 1 });
  };

  const allowedTriggers = (current?.triggers ?? ['appear', 'loop', 'click']) as AnimTrigger[];
  const activeTrigger: AnimTrigger = value?.trigger ?? (current?.loop ? 'loop' : 'appear');
  const speed = value?.speed ?? 1;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="fixed left-1/2 -translate-x-1/2 z-[150] clay-card rounded-2xl pointer-events-auto"
      style={{ bottom: 150, width: 468, maxWidth: '94vw', fontFamily: "'Outfit', sans-serif" }}
    >
      {/* header */}
      <div className="flex items-center justify-between" style={{ padding: '12px 14px 8px' }}>
        <div className="flex items-center gap-2">
          <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: 7, background: 'var(--accent-subtle)', color: 'var(--accent)', alignItems: 'center', justifyContent: 'center' }}>
            <LetterSparkIcon size={13} />
          </span>
          <span className="font-extrabold" style={{ fontSize: 13, color: 'var(--text-primary)' }}>Text Animation</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
            style={{ padding: '5px 10px', color: value?.preset ? 'var(--text-secondary)' : 'var(--text-muted)', background: 'var(--well)' }}
            title="Remove animation"
          >
            None
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg flex items-center justify-center transition-colors cursor-pointer"
            style={{ width: 28, height: 28, color: 'var(--text-secondary)', background: 'var(--well)' }}
            title="Close"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></svg>
          </button>
        </div>
      </div>

      {/* category tabs */}
      <div className="flex gap-1 overflow-x-auto custom-scrollbar" style={{ padding: '0 14px 8px' }}>
        {ANIM_CATEGORIES.map((c) => {
          const on = c === cat;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className="rounded-full text-[11px] font-bold transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0"
              style={{
                padding: '5px 12px',
                color: on ? '#fff' : 'var(--text-secondary)',
                background: on ? 'var(--accent)' : 'var(--well)',
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* tile grid */}
      <div
        className="grid custom-scrollbar"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '2px 14px 12px', maxHeight: '38vh', overflowY: 'auto' }}
      >
        {presetsByCategory(cat).map((p) => (
          <PreviewTile key={p.id} preset={p} active={value?.preset === p.id} onPick={() => pick(p)} />
        ))}
      </div>

      {/* controls */}
      {current && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 13px' }}>
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <span className="uppercase font-extrabold" style={{ fontSize: 9, letterSpacing: '0.13em', color: 'var(--text-tertiary)' }}>Trigger</span>
              <Segmented
                options={allowedTriggers.map((t) => ({ id: t, label: TRIGGER_LABEL[t] }))}
                value={allowedTriggers.includes(activeTrigger) ? activeTrigger : allowedTriggers[0]}
                onChange={(t) => onChange({ preset: current.id, trigger: t, speed })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="uppercase font-extrabold shrink-0" style={{ fontSize: 9, letterSpacing: '0.13em', color: 'var(--text-tertiary)' }}>Speed</span>
              <input
                type="range" min={0.5} max={2.5} step={0.1} value={speed}
                onChange={(e) => onChange({ preset: current.id, trigger: value?.trigger, speed: parseFloat(e.target.value) })}
                className="flex-1 accent-[var(--accent)] cursor-pointer"
                style={{ height: 4 }}
              />
              <span className="tabular-nums font-bold text-right" style={{ fontSize: 11, width: 34, color: 'var(--text-secondary)' }}>{speed.toFixed(1)}×</span>
            </div>
            <p style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>{current.hint}. Plays on the canvas, in present mode, and in shared views.</p>
          </div>
        </div>
      )}
    </motion.div>,
    document.body
  );
}

export function LetterSparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 18 L9 6 L14 18" />
      <line x1="5.7" y1="14" x2="12.3" y2="14" />
      <path d="M18.5 4.5 L19.3 6.7 L21.5 7.5 L19.3 8.3 L18.5 10.5 L17.7 8.3 L15.5 7.5 L17.7 6.7 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
