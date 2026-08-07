'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { useDragReorder, moveItem } from '@/hooks/useDragReorder';

// NOTE: Tailwind p-*/m-* utilities are dead in this app (unlayered global
// reset) — every padding here is inline on purpose.

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export default function TodoBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [title, setTitle] = useState((obj.style?.todoTitle as string) || 'todos');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(obj.content || '[]');
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }, [obj.content]);

  const save = useCallback((newItems: TodoItem[], newTitle?: string) => {
    // Crossing into "everything done" is a goal completed — announce it so the
    // Canvas Resident can celebrate. Only on the crossing, never on re-saves.
    const wasAllDone = items.length >= 2 && items.every((i) => i.done);
    const isAllDone = newItems.length >= 2 && newItems.every((i) => i.done);
    if (isAllDone && !wasAllDone) {
      window.dispatchEvent(new CustomEvent('mindspace:goal-complete'));
    }
    setItems(newItems);
    updateObject(obj.id, {
      content: JSON.stringify(newItems),
      style: { ...obj.style, todoTitle: newTitle || title }
    });
  }, [obj.id, obj.style, title, updateObject, items]);

  /** Put the caret at the end of an item's editable text. */
  const focusItem = (id: string) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-todo-id="${id}"]`);
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  };

  const addItem = () => {
    const newItem = { id: uuidv4(), text: '', done: false };
    save([...items, newItem]);
    focusItem(newItem.id);
  };

  /** Enter inside an item: commit its text and open a fresh row right below —
   *  capture-list flow, no reaching for the + button between thoughts. */
  const commitAndAddAfter = (id: string, text: string) => {
    const idx = items.findIndex((i) => i.id === id);
    const newItem = { id: uuidv4(), text: '', done: false };
    const newItems = items.map((i) => (i.id === id ? { ...i, text } : i));
    newItems.splice(idx + 1, 0, newItem);
    save(newItems);
    focusItem(newItem.id);
  };

  /** Backspace on an already-empty item removes it, like every notes app. */
  const removeAndFocusPrev = (id: string) => {
    const idx = items.findIndex((i) => i.id === id);
    const prev = items[idx - 1];
    save(items.filter((i) => i.id !== id));
    if (prev) focusItem(prev.id);
  };

  const toggleItem = (id: string) =>
    save(items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  const updateItemText = (id: string, text: string) =>
    save(items.map((item) => (item.id === id ? { ...item, text } : item)));
  const removeItem = (id: string) => save(items.filter((item) => item.id !== id));
  const clearCompleted = () => save(items.filter((item) => !item.done));

  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length > 0 ? (doneCount / items.length) * 100 : 0;
  const allDone = items.length > 0 && doneCount === items.length;

  /* Drag a row by its grip to reorder. A checklist is a plan, and a plan has an
     order — before this the only way to move a task up was to retype it.

     Routed through `save`, deliberately: writing to the store from inside a
     `setItems(cur => …)` updater looked tempting (it reads the freshest list)
     but React runs updaters DURING render, so the store write became a
     setState-in-render and React warned about updating ConnectionsLayer while
     rendering TodoBlock. `save` already closes over the current `items` and is
     the one place that persists this block. */
  const { dragIndex, dropIndex, startDrag } = useDragReorder(
    listRef,
    useCallback((from: number, to: number) => {
      save(moveItem(items, from, to));
    }, [items, save]),
  );

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-xl overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="border-b border-[var(--border)] bg-white/10" style={{ padding: '12px 16px 10px' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="shrink-0" style={{ color: allDone ? '#2F9E6E' : 'var(--accent)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <polyline points="8 12 11 15 16 9" />
              </svg>
            </span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                save(items, e.target.value);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="bg-transparent border-none outline-none font-semibold text-[var(--text-primary)] text-sm placeholder:opacity-50 min-w-0 flex-1"
              placeholder="List Title"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            />
          </div>
          <span
            className="shrink-0 text-[10px] font-extrabold tabular-nums rounded-full"
            style={{
              padding: '2px 8px',
              background: allDone ? 'rgba(47,158,110,0.14)' : 'var(--accent-subtle, rgba(201,123,75,0.12))',
              color: allDone ? '#2F9E6E' : 'var(--accent)',
            }}
          >
            {doneCount}/{items.length}
          </span>
        </div>
        {/* progress */}
        <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ marginTop: 9, background: 'var(--track, rgba(90,62,40,0.08))' }}>
          <div
            className="h-full rounded-full transition-all duration-400"
            style={{ width: `${pct}%`, background: allDone ? '#2F9E6E' : 'var(--accent)' }}
          />
        </div>
      </div>

      {/* List Area */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3"
        style={{ padding: '14px 16px', overscrollBehavior: 'contain' }}
      >
        {items.map((item, i) => (
          <TodoRow
            key={item.id}
            item={item}
            index={i}
            dragging={dragIndex === i}
            /* The gap the row would drop into. Drawn on the row currently at
               that index, above or below depending on travel direction. */
            dropBefore={dragIndex !== null && dropIndex === i && dragIndex > i}
            dropAfter={dragIndex !== null && dropIndex === i && dragIndex < i}
            onGrab={(e) => startDrag(e, i)}
            onToggle={() => toggleItem(item.id)}
            onUpdate={(text) => updateItemText(item.id, text)}
            onRemove={() => removeItem(item.id)}
            onEnter={(text) => commitAndAddAfter(item.id, text)}
            onBackspaceEmpty={() => removeAndFocusPrev(item.id)}
          />
        ))}
        {items.length === 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); addItem(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-center text-[var(--text-muted)] text-[12px] italic opacity-70 hover:opacity-100 transition-opacity cursor-text"
            style={{ padding: '14px 0' }}
          >
            Nothing yet — click to add your first task
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--border)] bg-white/5" style={{ padding: '9px 16px' }}>
        <button
          onClick={(e) => { e.stopPropagation(); addItem(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors text-xs font-bold uppercase tracking-wider cursor-pointer"
        >
          <span className="text-base leading-none">+</span>
          Add Item
        </button>
        {doneCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); clearCompleted(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Remove all completed tasks"
            className="text-[10px] font-bold text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer"
          >
            clear done
          </button>
        )}
      </div>
    </div>
  );
}

function TodoRow({
  item, index, dragging, dropBefore, dropAfter, onGrab,
  onToggle, onUpdate, onRemove, onEnter, onBackspaceEmpty,
}: {
  item: TodoItem;
  index: number;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onGrab: (e: React.PointerEvent) => void;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onEnter: (currentText: string) => void;
  onBackspaceEmpty: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);

  /** The line showing where the carried row will land. */
  const dropLine = (
    <span
      aria-hidden="true"
      className="absolute left-0 right-0 rounded-full"
      style={{ height: 2, background: 'var(--accent)', boxShadow: '0 0 6px rgba(var(--accent-rgb),0.7)' }}
    />
  );

  return (
    <div
      data-reorder-index={index}
      className="relative flex items-start gap-2 group"
      style={{
        // The carried row dims and lifts so it reads as picked up.
        opacity: dragging ? 0.4 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      {dropBefore && <span style={{ position: 'absolute', top: -7, left: 0, right: 0 }}>{dropLine}</span>}
      {dropAfter && <span style={{ position: 'absolute', bottom: -7, left: 0, right: 0 }}>{dropLine}</span>}

      {/* Grip. Quiet until you're over the row, and it's the ONLY thing that
          starts a reorder — dragging the text would fight editing it. */}
      <button
        onPointerDown={onGrab}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        aria-label="Reorder this task"
        className="shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        style={{ width: 12, height: 20, marginTop: 3, touchAction: 'none' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
        className={`hit-reach mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all cursor-pointer ${
          item.done
            ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-[0_0_10px_rgba(var(--accent-rgb),0.4)]'
            : 'border-[var(--text-muted)] hover:border-[var(--accent)]'
        }`}
        style={{ marginTop: 2 }}
      >
        {item.done && (
          <motion.svg
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </motion.svg>
        )}
      </button>

      <div className="relative flex-1 min-w-0">
        {/* The strike is drawn over THIS wrapper, not over the row.

            It used to hang off the row itself, which is `flex-1` — so the
            pencil line was as wide as the card no matter how short the
            task was, and a two-word item got a stroke that carried on for
            another 200px into empty space. An inline-block shrinks to the
            words, which is what a person crossing something out would
            actually cover. */}
        <div className="relative inline-block align-top max-w-full">
        <div
          ref={textRef}
          data-todo-id={item.id}
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onUpdate(e.currentTarget.innerText)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter(e.currentTarget.innerText);
            } else if (e.key === 'Backspace' && e.currentTarget.innerText.trim() === '') {
              e.preventDefault();
              onBackspaceEmpty();
            }
          }}
          className={`outline-none text-sm leading-relaxed transition-all break-words ${
            /* Done is not gone. `--text-muted` at 60% opacity put finished
               tasks somewhere around 1.9:1 on this card — legible as a
               smudge, not as words, so you could see that something had
               been done but not read back what. Secondary clears 4.5:1 on
               both papers; the strike is what says "finished", so the ink
               doesn't have to fade to make the point. */
            item.done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
          }`}
          style={{
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {item.text}
        </div>

        {/* Pencil Strike Overlay */}
        <AnimatePresence>
          {item.done && (
            <div className="absolute top-1/2 left-0 w-full pointer-events-none">
              <PencilStrike />
            </div>
          )}
        </AnimatePresence>
        </div>
        {!item.text && <div className="absolute top-0 left-0 text-[var(--text-muted)] text-sm italic pointer-events-none opacity-40">What needs to be done?</div>}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Remove task"
        className="hit-reach opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
        style={{ padding: 4 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}

function PencilStrike() {
  // Create a slightly wavy path that looks hand-drawn
  const path = "M 0 0 C 20 -2, 40 2, 60 0 C 80 -2, 100 2, 120 0";

  return (
    <svg
      /* `overflow-visible` plus a second path running to x=150 in a
         0–120 viewBox meant the stroke escaped the box entirely and kept
         going. A pen does overshoot the last letter — by a few pixels,
         not by a quarter of the line. */
      className="absolute top-[-2px] left-[-3px] w-[calc(100%+6px)] h-[6px]"
      preserveAspectRatio="none"
      viewBox="0 0 120 4"
    >
      <motion.path
        d={path}
        fill="none"
        stroke="#C97B4B"
        strokeWidth="1.5"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.6 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
      />
      {/* Second rough stroke */}
      <motion.path
        d="M 0 1 C 20 3, 40 -1, 60 2 C 80 0, 100 3, 120 1"
        fill="none"
        stroke="#C97B4B"
        strokeWidth="1.2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.4 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeInOut" }}
      />
    </svg>
  );
}
