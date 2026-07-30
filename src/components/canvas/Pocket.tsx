'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { screenToCanvas } from '@/lib/utils';

/**
 * The Pocket — a tray you carry blocks in, across boards.
 *
 * It replaces two things that used to sit in the top-left corner:
 *
 *  · the "minimize" shelf, which kept its chips inside the canvas's own object
 *    list. Every canvas load replaces that list wholesale, so the moment you
 *    opened another board the shelf was empty — you could put something down
 *    and never find it again.
 *  · "Warp to canvas", a second hot zone that popped a modal asking which board
 *    to teleport to. Picking a destination from a list, sight unseen, is a
 *    worse way to move something than carrying it there and dropping it where
 *    you want it.
 *
 * So: one gesture in (drag a block to the rail), one gesture out (drag a chip
 * onto any canvas). Pocketed blocks live under POCKET_PARENT — no board owns
 * them — which is why the tray looks the same everywhere and the drop decides
 * where the block lands.
 */

const spring = { type: 'spring' as const, stiffness: 330, damping: 30 };

/** A block's identity at a glance: its colour, a name, and what kind it is. */
function chipVisual(obj: CanvasObjectData) {
  const style = obj.style || {};
  const color =
    (style.color as string) ||
    (style.bgColor as string) ||
    (style.borderColor as string) ||
    (style.frameColor as string) ||
    'var(--accent)';

  let label = (obj.content || '').split('\n')[0].replace(/^[#>\-*\s]+/, '').trim();
  if (!label) {
    label =
      style.isRepo ? ((style.repoName as string) || 'code repo') :
      style.isTodo ? ((style.todoTitle as string) || 'checklist') :
      style.isTable ? ((style.tableTitle as string) || 'table') :
      style.isChart ? 'chart' :
      style.isMap ? 'map' :
      style.isVoiceNote ? 'voice note' :
      style.isTimeline ? 'timeline' :
      style.isBinder ? 'binder' :
      obj.type === 'shape' ? ((style.shapeType as string) || 'shape') :
      obj.type === 'frame' ? 'frame' :
      obj.type === 'workflow-node' ? 'node' :
      obj.type === 'image' ? 'image' :
      obj.type;
  }

  const kind =
    style.isRepo ? 'repo' :
    style.isTodo ? 'checklist' :
    style.isTable ? 'table' :
    style.isChart ? 'chart' :
    style.isCode ? 'code' :
    style.isMap ? 'map' :
    style.isVoiceNote ? 'voice' :
    style.isTimeline ? 'timeline' :
    style.isBinder ? 'binder' :
    style.isQuote ? 'quote' :
    style.isCallout ? 'callout' :
    obj.type;

  return { color, label: label.slice(0, 30), kind };
}

/** One small outline glyph per block kind — no emoji anywhere. */
function KindGlyph({ kind, size = 13 }: { kind: string; size?: number }) {
  const p = (children: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
  switch (kind) {
    case 'repo': return p(<><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /><path d="M8 13h8" /></>);
    case 'checklist': return p(<><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></>);
    case 'table': return p(<><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="4" x2="9" y2="20" /></>);
    case 'chart': return p(<><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></>);
    case 'code': return p(<><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></>);
    case 'map': return p(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></>);
    case 'voice': return p(<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></>);
    case 'timeline': return p(<><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /></>);
    case 'binder': return p(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>);
    case 'quote': return p(<><path d="M7 11H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v7a4 4 0 0 1-4 4" /><path d="M20 11h-3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v7a4 4 0 0 1-4 4" /></>);
    case 'callout': return p(<><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8.01" /></>);
    case 'image': return p(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>);
    case 'mirror': return p(<><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>);
    case 'sticky': return p(<><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l6-6V5a2 2 0 0 0-2-2h-3Z" /><path d="M14 21v-6h6" /></>);
    case 'heading': return p(<><path d="M6 4v16M18 4v16M6 12h12" /></>);
    case 'frame': return p(<><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /></>);
    case 'shape': return p(<><rect x="4" y="4" width="16" height="16" rx="3" /></>);
    default: return p(<><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6" /></>);
  }
}

/** The rail's own glyph: a pocket with something tucked in it. */
function PocketGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16a1 1 0 0 1 1 1v5a9 9 0 0 1-18 0V6a1 1 0 0 1 1-1Z" />
      <path d="M8 5v5a4 4 0 0 0 8 0V5" opacity="0.55" />
    </svg>
  );
}

export default function Pocket() {
  const pocket = useCanvasStore((s) => s.pocket);
  const restoreFromPocket = useCanvasStore((s) => s.restoreFromPocket);
  const discardFromPocket = useCanvasStore((s) => s.discardFromPocket);

  const [open, setOpen] = useState(false);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState({ label: '', color: '#C97B4B' });

  /* While a canvas block is being dragged, the rail opens itself and lights up.
     CanvasObject's drag handler owns the hit-testing (it already tracks the
     cursor for every other drop target), and talks to us through these events
     rather than a store write — a drag must not re-render the canvas. */
  const [dragActive, setDragActive] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => {
      const d = (e as CustomEvent<{ active: boolean; over: boolean }>).detail;
      setDragActive(!!d?.active);
      setDragOver(!!d?.over);
    };
    window.addEventListener('pocket-drag-state', onState as EventListener);
    return () => window.removeEventListener('pocket-drag-state', onState as EventListener);
  }, []);

  // Nothing in it and nothing being dragged: stay completely out of the way.
  const idle = pocket.length === 0 && !dragActive;
  const expanded = (open || dragActive) && !idle;

  /** Pull a chip out of the tray and drop it on the board under the cursor. */
  const startDrag = (e: React.MouseEvent, obj: CanvasObjectData) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const { color, label } = chipVisual(obj);
    setGhost({ color, label });

    const onMove = (ev: MouseEvent) => {
      // Button released off-screen: abandon, leaving the chip safely in the tray.
      if (ev.buttons === 0) {
        cleanup();
        return;
      }
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
      const g = ghostRef.current;
      if (g && moved) {
        g.style.display = 'flex';
        g.style.left = `${ev.clientX}px`;
        g.style.top = `${ev.clientY}px`;
      }
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (ghostRef.current) ghostRef.current.style.display = 'none';
    };
    const onUp = (ev: MouseEvent) => {
      cleanup();
      const camera = useCanvasStore.getState().camera;
      // A drag drops it where you let go; a plain click sends it to the middle
      // of the view, which is the only spot you can be sure you're looking at.
      const target = moved
        ? screenToCanvas(ev.clientX, ev.clientY, camera)
        : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2, camera);
      restoreFromPocket(obj.id, target.x, target.y);
      if (moved) setOpen(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <>
      {/* Ghost that follows the cursor while a chip is being carried out */}
      <div
        ref={ghostRef}
        className="fixed pointer-events-none z-[9999] hidden items-center gap-2 rounded-xl text-[11px] font-bold text-white shadow-2xl -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
        style={{ background: ghost.color, padding: '9px 13px' }}
      >
        {ghost.label}
      </div>

      <div
        className="pocket-rail fixed left-4 top-1/2 -translate-y-1/2 z-[130] flex items-center gap-2.5 pointer-events-auto"
        onMouseLeave={() => { if (!dragActive) setOpen(false); }}
      >
        {/* ---- The rail tab. Also the drop target. ---- */}
        <motion.button
          id="pocket-hotzone"
          onClick={() => setOpen((o) => !o)}
          onMouseEnter={() => { if (pocket.length > 0) setOpen(true); }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          animate={{
            opacity: idle ? 0 : 1,
            scale: dragOver ? 1.08 : 1,
            width: dragActive ? 74 : 46,
          }}
          transition={spring}
          title={pocket.length ? `Pocket — ${pocket.length} carried` : 'Pocket — drag a block here to carry it to another canvas'}
          aria-label="Pocket"
          className="clay-card rounded-[20px] flex flex-col items-center justify-center gap-1 cursor-pointer relative shrink-0"
          style={{
            height: dragActive ? 100 : 46,
            pointerEvents: idle ? 'none' : 'auto',
            borderColor: dragOver ? 'var(--accent)' : undefined,
            background: dragOver ? 'rgba(var(--accent-rgb),0.14)' : undefined,
            color: dragOver ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          <PocketGlyph size={dragActive ? 24 : 19} />

          {/* While dragging, the tab says what dropping here will do. */}
          <AnimatePresence>
            {dragActive && (
              <motion.span
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                className="text-[8.5px] font-extrabold uppercase tracking-[0.1em] text-center leading-tight"
                style={{ color: 'var(--accent)', paddingLeft: 4, paddingRight: 4 }}
              >
                Drop to<br />pocket
              </motion.span>
            )}
          </AnimatePresence>

          {pocket.length > 0 && !dragActive && (
            <span
              className="absolute -top-1 -right-1 min-w-[17px] h-[17px] rounded-full bg-[var(--accent)] text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums shadow-sm"
              style={{ padding: '0 4px' }}
            >
              {pocket.length}
            </span>
          )}
        </motion.button>

        {/* ---- The tray ---- */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="pocket-tray"
              initial={{ opacity: 0, x: -12, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -12, scale: 0.97 }}
              transition={spring}
              style={{ padding: 12 }}
              className="clay-card w-[254px] max-h-[64vh] rounded-[24px] flex flex-col gap-2.5 overflow-hidden"
            >
              <div className="flex items-center justify-between shrink-0" style={{ paddingLeft: 2 }}>
                <h3 className="text-[10.5px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-secondary)]">
                  Pocket
                </h3>
                <span className="text-[9.5px] font-bold text-[var(--text-tertiary)] tabular-nums">
                  {pocket.length} carried
                </span>
              </div>

              {pocket.length === 0 ? (
                <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed text-center" style={{ padding: '14px 8px' }}>
                  Drag any block onto the tab to carry it. It stays here while you
                  move between canvases — drop it wherever you need it.
                </p>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto min-h-0 custom-scrollbar" style={{ paddingRight: 2 }}>
                  {pocket.map((obj) => {
                    const { color, label, kind } = chipVisual(obj);
                    return (
                      <motion.div
                        key={obj.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={spring}
                        onMouseDown={(e) => startDrag(e, obj)}
                        title={`${label} — drag onto the canvas to place it, or click to drop it in the middle`}
                        className="group clay-inset rounded-2xl flex items-center gap-2.5 cursor-grab active:cursor-grabbing"
                        style={{ padding: '8px 9px' }}
                      >
                        {/* Colour swatch + kind glyph, so a chip reads as the
                            block it actually is rather than a coloured dot. */}
                        <span
                          className="shrink-0 rounded-xl flex items-center justify-center"
                          style={{ width: 30, height: 30, background: `${typeof color === 'string' && color.startsWith('#') ? color + '2E' : 'var(--accent-subtle)'}`, color }}
                        >
                          <KindGlyph kind={kind} size={14} />
                        </span>

                        <span className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
                          <span className="text-[11.5px] font-bold text-[var(--text-primary)] truncate leading-tight">
                            {label}
                          </span>
                          <span className="text-[8.5px] font-extrabold uppercase tracking-[0.12em] text-[var(--text-tertiary)] leading-tight">
                            {kind}
                          </span>
                        </span>

                        {/* Throw it away. Quiet until you're over the chip. */}
                        <button
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                          onClick={(e) => { e.stopPropagation(); discardFromPocket(obj.id); }}
                          title="Discard this — it isn't going onto any canvas"
                          aria-label="Discard"
                          className="shrink-0 w-5 h-5 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {pocket.length > 0 && (
                <p className="text-[9px] text-center text-[var(--text-muted)] leading-snug shrink-0 select-none">
                  Drag out to place · click to drop in the middle
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
