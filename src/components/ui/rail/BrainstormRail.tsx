'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { PIN_COLORS, THREAD_COLORS, CLIP_COLORS, type BrainstormTool } from '@/lib/brainstorm';
import RailShell from './RailShell';
import { Icon, Group, OptBtn, Hint } from './RailKit';

/**
 * The corkboard: pins, clips and string.
 *
 * Same three tools as the old flyout, but the palette that belongs to the
 * chosen tool is simply below it rather than swapped in place — in a column
 * there's room to show the pin heads at a size where the difference between
 * crimson and rose is visible.
 */

const CorkboardIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size} strokeWidth={1.9}>
    <circle cx="5" cy="6" r="2.2" fill="currentColor" />
    <circle cx="19" cy="17" r="2.2" fill="currentColor" />
    <path d="M5 6c5.5 1.5 2.5 10.5 14 11" strokeWidth="2" />
    <path d="M18 4.5v4.5a1.8 1.8 0 0 1-3.6 0v-3" opacity="0.65" />
  </Icon>
);

const PinIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size} strokeWidth={1.9}>
    <path d="M9 4.5 15.5 11" />
    <path d="M8.2 10.6a4 4 0 0 0 5.2 5.2l4.2-1.6a1 1 0 0 0 .35-1.63l-6.5-6.5a1 1 0 0 0-1.63.35Z" />
    <path d="M10.5 13.5 5 19" />
  </Icon>
);

const ClipIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size} strokeWidth={1.9}>
    <path d="M21 8.5 12 17.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9 18.4" />
  </Icon>
);

const ThreadIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size} strokeWidth={1.9}>
    <circle cx="5" cy="6" r="2" />
    <circle cx="19" cy="18" r="2" />
    <path d="M6.7 7.2C11 9 8 13 13 15c2.4 1 3.6 1.5 4.4 1.9" />
  </Icon>
);

const TOOLS: { id: BrainstormTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pin', label: 'Pin', icon: <PinIcon size={14} /> },
  { id: 'clip', label: 'Clip', icon: <ClipIcon size={14} /> },
  { id: 'thread', label: 'Thread', icon: <ThreadIcon size={14} /> },
];

const HINTS: Record<BrainstormTool, string> = {
  pin: 'Click the board to pin an idea. Select a pin to name it.',
  clip: 'Click any note or card to clip it. Click again to unclip.',
  thread: 'Tap a pin, then another, to run a string between them.',
};

export default function BrainstormRail() {
  const setMode = useCanvasStore((s) => s.setMode);
  const tool = useCanvasStore((s) => s.brainstormTool);
  const setTool = useCanvasStore((s) => s.setBrainstormTool);
  const pinColor = useCanvasStore((s) => s.pinColor);
  const setPinColor = useCanvasStore((s) => s.setPinColor);
  const clipColor = useCanvasStore((s) => s.clipColor);
  const setClipColor = useCanvasStore((s) => s.setClipColor);
  const threadColor = useCanvasStore((s) => s.threadColor);
  const setThreadColor = useCanvasStore((s) => s.setThreadColor);

  return (
    <RailShell
      railKey={`brainstorm:${tool}`}
      icon={<CorkboardIcon size={14} />}
      title="Corkboard"
      subtitle={tool === 'pin' ? 'Pinning' : tool === 'clip' ? 'Clipping' : 'Threading'}
      onClose={() => setMode('select')}
      closeTitle="Back to the select tool"
    >
      <Group id="bs-tool" label="Tool">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {TOOLS.map((t) => (
            <OptBtn key={t.id} height={34} active={tool === t.id} title={t.label} onClick={() => setTool(t.id)}>
              <span className="flex flex-col items-center gap-0.5">
                {t.icon}
                <span className="text-[8.5px] uppercase tracking-wider">{t.label}</span>
              </span>
            </OptBtn>
          ))}
        </div>
      </Group>

      {tool === 'pin' && (
        <Group id="bs-pin" label="Pin head">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            {PIN_COLORS.map((p) => {
              const active = pinColor.toLowerCase() === p.head.toLowerCase();
              return (
                <button
                  key={p.head}
                  onClick={() => setPinColor(p.head)}
                  title={p.name}
                  className="rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer w-full"
                  style={{
                    aspectRatio: '1 / 1',
                    background: `radial-gradient(circle at 35% 30%, #ffffffaa, transparent 45%), ${p.head}`,
                    boxShadow: active
                      ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                      : `inset 0 0 0 1px ${p.shade}`,
                  }}
                />
              );
            })}
          </div>
        </Group>
      )}

      {tool === 'clip' && (
        <Group id="bs-clip" label="Clip finish">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            {CLIP_COLORS.map((c) => {
              const active = clipColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  onClick={() => setClipColor(c.hex)}
                  title={c.name}
                  className="rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer w-full"
                  style={{
                    aspectRatio: '1 / 1',
                    background: c.hex,
                    boxShadow: active
                      ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
        </Group>
      )}

      {tool === 'thread' && (
        <Group id="bs-thread" label="Thread colour">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            {THREAD_COLORS.map((c) => {
              const active = threadColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  onClick={() => setThreadColor(c.hex)}
                  title={c.name}
                  className="rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer w-full"
                  style={{
                    aspectRatio: '1 / 1',
                    background: c.hex,
                    boxShadow: active
                      ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
        </Group>
      )}

      <Hint>{HINTS[tool]}</Hint>
    </RailShell>
  );
}
