'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { FRAME_KINDS, frameKindMeta } from '@/lib/frames';
import RailShell from './RailShell';
import { Icon, Group, Swatch, Hint } from './RailKit';

/**
 * The frame tool — what kind of frame the next click drops, and what colour.
 *
 * A frame's KIND is the consequential choice (a delete frame eats what you
 * drop in it; a scene frame becomes a slide), so it leads, with its own
 * sentence of explanation underneath. Colour follows, and only for grouping
 * frames: every other kind is locked to its identity colour, because that
 * colour is the warning.
 */

const FRAME_COLORS = [
  { name: 'Terracotta', hex: '#C97B4B' },
  { name: 'Sage', hex: '#45B761' },
  { name: 'Sky', hex: '#4A90D9' },
  { name: 'Amethyst', hex: '#9B59B6' },
  { name: 'Rose', hex: '#E93D82' },
  { name: 'Charcoal', hex: '#2D2A26' },
];

export default function FrameRail() {
  const setMode = useCanvasStore((s) => s.setMode);
  const frameDraftKind = useCanvasStore((s) => s.frameDraftKind);
  const setFrameDraftKind = useCanvasStore((s) => s.setFrameDraftKind);
  const frameDraftColor = useCanvasStore((s) => s.frameDraftColor);
  const setFrameDraftColor = useCanvasStore((s) => s.setFrameDraftColor);

  const meta = frameKindMeta(frameDraftKind);

  return (
    <RailShell
      railKey={`frame:${frameDraftKind}`}
      icon={<Icon size={14}><path d="M4 8h16" /><path d="M4 16h16" /><path d="M8 4v16" /><path d="M16 4v16" /></Icon>}
      title="Frame"
      subtitle={`${meta.label} — click to place`}
      onClose={() => setMode('select')}
      closeTitle="Back to the select tool"
    >
      <Group id="frame-kind" label="Kind">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {FRAME_KINDS.map((k) => {
            const active = frameDraftKind === k.id;
            return (
              <button
                key={k.id}
                onClick={() => setFrameDraftKind(k.id)}
                title={k.blurb}
                aria-pressed={active}
                className="rounded-[10px] text-[11px] font-extrabold transition-all duration-150 cursor-pointer active:scale-[0.97] flex items-center gap-2"
                style={{
                  padding: '8px 10px',
                  background: active ? k.color : 'var(--well)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: active ? 'rgba(255,255,255,0.85)' : k.color }}
                />
                {k.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">{meta.blurb}</p>
      </Group>

      {frameDraftKind === 'normal' && (
        <Group id="frame-colour" label="Colour">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 26px)', justifyContent: 'start' }}>
            {FRAME_COLORS.map((c) => (
              <Swatch
                key={c.hex}
                color={c.hex}
                title={c.name}
                active={frameDraftColor === c.hex}
                onClick={() => setFrameDraftColor(c.hex)}
              />
            ))}
          </div>
        </Group>
      )}

      <Hint>Click the board to place it, then click its title tab to name it.</Hint>
    </RailShell>
  );
}
