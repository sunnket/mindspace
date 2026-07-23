'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import {
  BrainstormTool,
  PIN_COLORS,
  THREAD_COLORS,
  CLIP_COLORS,
} from '@/lib/brainstorm';

/** The push-pin glyph — shared by the toolbar button and the Pin tool tab. */
export function PinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* a pin pushed into a board, seen at a slight angle */}
      <path d="M9 4.5 15.5 11" />
      <path d="M8.2 10.6a4 4 0 0 0 5.2 5.2l4.2-1.6a1 1 0 0 0 .35-1.63l-6.5-6.5a1 1 0 0 0-1.63.35Z" />
      <path d="M10.5 13.5 5 19" />
    </svg>
  );
}

function ClipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8.5 12 17.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9 18.4" />
    </svg>
  );
}

function ThreadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M6.7 7.2C11 9 8 13 13 15c2.4 1 3.6 1.5 4.4 1.9" />
    </svg>
  );
}

const TABS: { id: BrainstormTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pin', label: 'Pin', icon: <PinIcon size={15} /> },
  { id: 'clip', label: 'Clip', icon: <ClipIcon size={15} /> },
  { id: 'thread', label: 'Thread', icon: <ThreadIcon size={15} /> },
];

const HINTS: Record<BrainstormTool, string> = {
  pin: 'Click the board to pin an idea. Select a pin to name it.',
  clip: 'Click any note or card to clip it. Click again to unclip.',
  thread: 'Tap a pin, then another, to run a string between them.',
};

export default function BrainstormPanel() {
  const tool = useCanvasStore((s) => s.brainstormTool);
  const setTool = useCanvasStore((s) => s.setBrainstormTool);
  const pinColor = useCanvasStore((s) => s.pinColor);
  const setPinColor = useCanvasStore((s) => s.setPinColor);
  const clipColor = useCanvasStore((s) => s.clipColor);
  const setClipColor = useCanvasStore((s) => s.setClipColor);
  const threadColor = useCanvasStore((s) => s.threadColor);
  const setThreadColor = useCanvasStore((s) => s.setThreadColor);

  return (
    <div className="glass-panel flex flex-col gap-3" style={{ padding: 14, width: 268 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-[0.16em] select-none">
          Brainstorm Board
        </span>
      </div>

      {/* Tool switcher */}
      <div className="flex bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border)] gap-1" style={{ padding: 3 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{ padding: '7px 6px' }}
            className={`flex-1 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              tool === t.id
                ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Contextual palette */}
      {tool === 'pin' && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider px-0.5">Pin colour</span>
          <div className="grid grid-cols-8 gap-1.5 justify-items-center">
            {PIN_COLORS.map((p) => {
              const active = pinColor.toLowerCase() === p.head.toLowerCase();
              return (
                <button
                  key={p.head}
                  onClick={() => setPinColor(p.head)}
                  title={p.name}
                  className="rounded-full transition-transform hover:scale-115 cursor-pointer"
                  style={{
                    width: 22,
                    height: 22,
                    background: `radial-gradient(circle at 35% 30%, #ffffffaa, transparent 45%), ${p.head}`,
                    boxShadow: active
                      ? `0 0 0 2px var(--bg-secondary), 0 0 0 3.5px var(--accent)`
                      : `inset 0 0 0 1px ${p.shade}`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {tool === 'clip' && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider px-0.5">Clip finish</span>
          <div className="flex gap-2">
            {CLIP_COLORS.map((c) => {
              const active = clipColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  onClick={() => setClipColor(c.hex)}
                  title={c.name}
                  className="rounded-full transition-transform hover:scale-115 cursor-pointer"
                  style={{
                    width: 24,
                    height: 24,
                    background: c.hex,
                    boxShadow: active
                      ? `0 0 0 2px var(--bg-secondary), 0 0 0 3.5px var(--accent)`
                      : `inset 0 0 0 1px rgba(0,0,0,0.2)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {tool === 'thread' && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider px-0.5">Thread colour</span>
          <div className="flex gap-2 flex-wrap">
            {THREAD_COLORS.map((c) => {
              const active = threadColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  onClick={() => setThreadColor(c.hex)}
                  title={c.name}
                  className="rounded-full transition-transform hover:scale-115 cursor-pointer"
                  style={{
                    width: 24,
                    height: 24,
                    background: c.hex,
                    boxShadow: active
                      ? `0 0 0 2px var(--bg-secondary), 0 0 0 3.5px var(--accent)`
                      : `inset 0 0 0 1px rgba(0,0,0,0.2)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Hint */}
      <div className="flex items-start gap-2 border-t border-[var(--border)] pt-2.5">
        <span className="text-[13px] leading-none mt-0.5" aria-hidden>💡</span>
        <p className="text-[11px] leading-snug text-[var(--text-muted)] font-medium">{HINTS[tool]}</p>
      </div>
    </div>
  );
}
