'use client';

import React, { useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

/**
 * A Binder is a canvas-inside-a-canvas. Filing an item into it (drop it on top —
 * handled in CanvasObject) re-homes that object onto a nested board keyed by the
 * binder's own id, exactly like a heading's sub-space. Opening the binder just
 * navigates into that board, so its contents live as real, arrangeable canvas
 * objects — not a flat list of cards. The whole binder can be teleported to
 * another canvas (its children travel with it, since they're keyed by its id) or
 * handed to a chat.
 */
export default function BinderBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);

  const [title, setTitle] = useState(obj.content || 'New Binder');

  const open = () => pushCanvas(obj.id);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    updateObject(obj.id, { content: val });
  };

  // Hand the whole binder off via the Warp portal (children ride along because
  // they're parented to this binder's id, not to the board it sits on).
  const sendToCanvas = () => {
    window.dispatchEvent(new CustomEvent('open-warp', { detail: { objectId: obj.id } }));
  };

  const sendToChat = () => {
    const label = `📁 ${(title || 'Binder').slice(0, 56)}`;
    window.dispatchEvent(
      new CustomEvent('open-chat-send', {
        detail: {
          snapshot: { type: obj.type, content: obj.content, width: obj.width, height: obj.height, style: obj.style },
          label,
        },
      })
    );
  };

  const stopDrag = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="w-full h-full flex rounded-2xl overflow-hidden border border-[rgba(var(--accent-rgb),0.4)] shadow-xl select-none relative bg-[var(--bg-card)] backdrop-blur-md"
      onDoubleClick={(e) => { e.stopPropagation(); open(); }}
      title="Double-click to open this binder as a canvas"
    >
      {/* Binder spine with rings */}
      <div className="w-4 shrink-0 flex flex-col justify-around bg-[rgba(var(--accent-rgb),0.85)] border-r border-black/10" style={{ padding: '16px 0' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-2 h-2 rounded-full bg-white/80 shadow-[0_1px_1px_rgba(0,0,0,0.25)] mx-auto" />
        ))}
      </div>

      {/* Body — a faint dotted grid hints at the canvas that lives inside */}
      <div
        className="flex-1 min-w-0 flex flex-col relative"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(var(--accent-rgb),0.10) 0.5px, transparent 0.5px)',
          backgroundSize: '14px 14px',
          padding: 14,
        }}
      >
        <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
          <span className="text-sm leading-none">📁</span>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onMouseDown={stopDrag}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="bg-transparent border-none outline-none font-extrabold text-[13px] text-[var(--text-primary)] w-full placeholder:opacity-40"
            placeholder="Binder name…"
          />
        </div>

        <p className="text-[10px] leading-snug text-[var(--text-secondary)] italic">
          Drag items onto this card to file them. Double-click to open it as a canvas.
        </p>

        {/* Actions */}
        <div className="mt-auto flex items-center gap-1.5" style={{ paddingTop: 8 }}>
          <button
            type="button"
            onClick={(e) => { stopDrag(e); open(); }}
            onMouseDown={stopDrag}
            className="flex-1 h-7 rounded-lg bg-[rgba(var(--accent-rgb),0.16)] border border-[rgba(var(--accent-rgb),0.35)] text-[var(--accent)] hover:bg-[rgba(var(--accent-rgb),0.26)] transition-colors text-[10px] font-bold cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1"
          >
            Open binder
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          </button>

          <button
            type="button"
            onClick={(e) => { stopDrag(e); sendToCanvas(); }}
            onMouseDown={stopDrag}
            title="Send this binder to another canvas (Warp)"
            className="w-7 h-7 rounded-lg border border-[var(--border-strong)] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex items-center justify-center cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18M12 3a9 9 0 0 1 0 18M3 12h18" /></svg>
          </button>

          <button
            type="button"
            onClick={(e) => { stopDrag(e); sendToChat(); }}
            onMouseDown={stopDrag}
            title="Send this binder to a chat"
            className="w-7 h-7 rounded-lg border border-[var(--border-strong)] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex items-center justify-center cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
