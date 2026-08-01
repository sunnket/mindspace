'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from './RailKit';

/**
 * The rail itself: one docked column on the right that every context borrows.
 *
 * Whatever is showing — a selected block's properties, the brush, the shape
 * catalogue, the frame tool, the corkboard, workflows — wears this shell, so
 * the header, the scrolling, the entrance and the geometry are decided once
 * and are identical everywhere. Contexts only supply an identity and a list of
 * groups.
 *
 * Geometry lives in globals.css under `.props-rail` because it's a negotiation
 * with the minimap; see the note there.
 */

export interface RailAction {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

const spring = { type: 'spring' as const, stiffness: 400, damping: 34 };

export default function RailShell({
  icon, title, subtitle, actions, onClose, closeTitle, children, railKey,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: RailAction[];
  onClose?: () => void;
  closeTitle?: string;
  children: React.ReactNode;
  /** Changes when the rail switches to a different subject — resets scroll. */
  railKey: string;
}) {
  /* The scroll shadows. A rail taller than the viewport has to SAY so — a hard
     cut reads as the end of the panel, a faded one reads as more. Done with a
     mask on the scroller rather than two gradient overlays, so it costs nothing
     to keep correct in both themes. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shade, setShade] = useState({ top: false, bottom: false });

  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = {
      top: el.scrollTop > 3,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 3,
    };
    setShade((p) => (p.top === next.top && p.bottom === next.bottom ? p : next));
  };

  // After every render: groups open and close, and the subject changes what is
  // in the column at all. Converges in one pass — `measure` only sets state
  // when a value actually flipped.
  useLayoutEffect(measure);

  // And when the content resizes WITHOUT a render — a group's height animation,
  // a list growing as you type.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // `measure` is deliberately out of the deps: it's re-created every render
    // and only reads live DOM, so re-attaching the observer for it would churn
    // for nothing. Re-attach when the rail's subject changes wholesale.
  }, [railKey]);

  /* A new subject is a new panel, so it opens at the top. Without this you
     select a card after scrolling a text block's options and land halfway down
     someone else's controls, with the header above claiming to describe them. */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [railKey]);

  const maskStops = [
    shade.top ? 'rgba(0,0,0,0) 0px, #000 18px' : '#000 0px',
    shade.bottom ? '#000 calc(100% - 20px), rgba(0,0,0,0) 100%' : '#000 100%',
  ].join(', ');
  const mask = `linear-gradient(to bottom, ${maskStops})`;

  const iconBtn = 'w-[26px] h-[26px] rounded-[8px] flex items-center justify-center transition-colors cursor-pointer active:scale-95 shrink-0';

  return (
    <motion.aside
      key="properties-rail"
      initial={{ opacity: 0, x: 22, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 22, scale: 0.97 }}
      transition={spring}
      onMouseDown={(e) => {
        e.stopPropagation();
        // Keep the caret in the text block being edited: pressing a format
        // button (size preset, +/-, heading, colour) must NOT blur the
        // contentEditable, otherwise an empty new block exits edit mode before
        // you can pick a size. Real inputs still need focus, so exempt them.
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') e.preventDefault();
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="props-rail clay-card pointer-events-auto flow-hideable flex flex-col overflow-hidden"
      style={{ borderRadius: 20, fontFamily: "'Outfit', sans-serif" }}
    >
      {/* ---- Header: what this is, and the things you do to it ---- */}
      <div
        className="shrink-0 flex items-center gap-2.5"
        style={{ padding: '11px 11px 10px 13px', borderBottom: '1px solid var(--border)' }}
      >
        <span
          className="shrink-0 flex items-center justify-center"
          style={{ width: 27, height: 27, borderRadius: 9, background: 'var(--accent-subtle)', color: 'var(--accent)' }}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1 flex flex-col gap-[2px]">
          <span className="text-[12.5px] font-extrabold leading-none truncate text-[var(--text-primary)]">{title}</span>
          {subtitle && (
            <span className="text-[9.5px] font-semibold leading-none truncate text-[var(--text-tertiary)] tabular-nums">{subtitle}</span>
          )}
        </div>

        {(actions || []).map((a) => (
          <button
            key={a.id}
            onClick={a.onClick}
            title={a.title}
            aria-label={a.title}
            className={`${iconBtn} bg-[var(--well)] ${
              a.danger
                ? 'text-[var(--text-secondary)] hover:text-white hover:bg-red-500'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {a.icon}
          </button>
        ))}

        {onClose && (
          <button
            onClick={onClose}
            title={closeTitle || 'Close'}
            aria-label="Close"
            className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--well)]`}
          >
            <Icon size={13}><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></Icon>
          </button>
        )}
      </div>

      {/* ---- The controls. One scroller; the groups do the rest. ---- */}
      <div
        ref={scrollRef}
        onScroll={measure}
        className="props-rail-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ padding: '2px 14px 14px', maskImage: mask, WebkitMaskImage: mask }}
      >
        <div className="flex flex-col">{children}</div>
      </div>
    </motion.aside>
  );
}
