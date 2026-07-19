'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { motion, AnimatePresence } from 'framer-motion';
import type { CanvasObjectData } from '@/lib/db';

/**
 * The @-mention picker. Typing "@" in a text block opens this list of other
 * blocks/headings on the canvas; choosing one drops an inline chip that jumps
 * the camera there when clicked. Keyboard-driven via the at-menu-* window
 * events dispatched from CanvasObject's keydown handler, mirroring the slash
 * menu exactly so both feel identical.
 */

// A short, human label for a block, used both in the list and in the chip.
function labelForObject(o: CanvasObjectData): string {
  const firstLine = (o.content || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) || '';
  // Strip leading markdown markers so "## Roadmap" reads as "Roadmap".
  const cleaned = firstLine
    .replace(/^#{1,3}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]?\]\s+/, '')
    .replace(/^(?:▸|▾|>>|>)\s+/, '')
    .replace(/[*_`~=]/g, '')
    .trim();
  if (cleaned) return cleaned;
  // Named-but-empty functional blocks fall back to a friendly kind name.
  const s = o.style || {};
  if (s.isCallout) return `${String(s.calloutKind || 'note')} callout`;
  if (s.isTodo) return String(s.todoTitle || 'To-do list');
  if (s.isCountdown) return String(s.countdownTitle || 'Countdown');
  if (s.isPoll) return String(s.pollQuestion || 'Poll');
  if (s.isChart) return String(s.chartTitle || 'Chart');
  if (s.isTimeline) return 'Timeline';
  if (s.isRepo) return 'Code repo';
  if (s.isMermaid) return 'Diagram';
  if (s.isBinder) return 'Binder';
  return '';
}

// A tiny type tag shown on the right of each row.
function kindTag(o: CanvasObjectData): string {
  if (o.type === 'heading') return 'Heading';
  if (o.type === 'sticky') return 'Sticky';
  if (o.type === 'frame') return 'Frame';
  const s = o.style || {};
  if (s.isCallout) return 'Callout';
  if (s.isQuote) return 'Quote';
  if (s.isTodo) return 'To-do';
  if (s.isBinder) return 'Binder';
  if (s.isChart) return 'Chart';
  if (s.isCountdown) return 'Countdown';
  if (s.isRepo) return 'Repo';
  if (o.type === 'card') return 'Card';
  if (o.type === 'text') return 'Text';
  return o.type;
}

interface Candidate {
  id: string;
  label: string;
  tag: string;
  isHeading: boolean;
}

export default function AtMentionMenu() {
  const atMenu = useCanvasStore((s) => s.atMenu);
  const setAtMenu = useCanvasStore((s) => s.setAtMenu);
  const objects = useCanvasStore((s) => s.objects);

  const [activeIndex, setActiveIndex] = useState(0);
  const query = atMenu?.query || '';

  // Build the candidate list: any labelable block except the one being typed in.
  const candidates = useMemo<Candidate[]>(() => {
    if (!atMenu) return [];
    const list: Candidate[] = [];
    for (const o of objects) {
      if (o.id === atMenu.objectId) continue;
      if (o.type === 'arrow' || o.type === 'drawing') continue;
      const label = labelForObject(o);
      if (!label) continue;
      list.push({ id: o.id, label, tag: kindTag(o), isHeading: o.type === 'heading' });
    }
    // Headings first (they're the natural anchors), then the rest.
    list.sort((a, b) => (a.isHeading === b.isHeading ? 0 : a.isHeading ? -1 : 1));
    return list;
  }, [objects, atMenu]);

  const filtered = useMemo(() => {
    if (!query) return candidates.slice(0, 40);
    const lower = query.toLowerCase();
    return candidates.filter((c) => c.label.toLowerCase().includes(lower)).slice(0, 40);
  }, [candidates, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  const select = React.useCallback((c: Candidate | undefined) => {
    if (!c || !atMenu) return;
    window.dispatchEvent(new CustomEvent('insert-mention', {
      detail: { objectId: atMenu.objectId, targetId: c.id, label: c.label },
    }));
    setAtMenu(null);
  }, [atMenu, setAtMenu]);

  // Keyboard events dispatched from CanvasObject while this menu is open.
  useEffect(() => {
    if (!atMenu) return;
    const down = () => setActiveIndex((p) => (filtered.length ? (p + 1) % filtered.length : 0));
    const up = () => setActiveIndex((p) => (filtered.length ? (p - 1 + filtered.length) % filtered.length : 0));
    const sel = () => select(filtered[activeIndex]);
    window.addEventListener('at-menu-down', down);
    window.addEventListener('at-menu-up', up);
    window.addEventListener('at-menu-select', sel);
    return () => {
      window.removeEventListener('at-menu-down', down);
      window.removeEventListener('at-menu-up', up);
      window.removeEventListener('at-menu-select', sel);
    };
  }, [atMenu, filtered, activeIndex, select]);

  if (!atMenu) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.96 }}
        transition={{ duration: 0.12 }}
        className="fixed z-[9999] bg-[#18181b]/95 border border-white/10 rounded-xl shadow-2xl p-1.5 min-w-[240px] max-w-[320px] pointer-events-auto"
        style={{ left: `${atMenu.x}px`, top: `${atMenu.y}px`, backdropFilter: 'blur(12px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] text-white/40 px-2 py-1 font-bold uppercase tracking-wider border-b border-white/5 mb-1 select-none">
          Link to a block
        </div>

        {filtered.length === 0 ? (
          <div className="text-xs text-white/40 italic px-3 py-2 select-none">
            {candidates.length === 0 ? 'Nothing on the canvas to link yet' : `No block matches “${query}”`}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto">
            {filtered.map((c, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={c.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => select(c)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 transition-all select-none cursor-pointer ${
                    isActive ? 'bg-white/10 text-white border border-white/5' : 'text-white/70 hover:text-white border border-transparent'
                  }`}
                >
                  <span className="text-[13px] leading-none text-[var(--accent,#C97B4B)] select-none">@</span>
                  <span className="text-xs font-medium leading-tight truncate flex-1 min-w-0">{c.label}</span>
                  <span className="text-[9px] text-white/35 uppercase tracking-wide shrink-0">{c.tag}</span>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
