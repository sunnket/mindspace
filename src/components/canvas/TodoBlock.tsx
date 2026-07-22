'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

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
    setItems(newItems);
    updateObject(obj.id, {
      content: JSON.stringify(newItems),
      style: { ...obj.style, todoTitle: newTitle || title }
    });
  }, [obj.id, obj.style, title, updateObject]);

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
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3" style={{ padding: '14px 16px' }}>
        {items.map((item) => (
          <TodoRow
            key={item.id}
            item={item}
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

function TodoRow({ item, onToggle, onUpdate, onRemove, onEnter, onBackspaceEmpty }: {
  item: TodoItem;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onEnter: (currentText: string) => void;
  onBackspaceEmpty: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-start gap-3 group">
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all cursor-pointer ${
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
            item.done ? 'text-[var(--text-muted)] opacity-60' : 'text-[var(--text-primary)]'
          }`}
          style={{
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {item.text}
        </div>
        {!item.text && <div className="absolute top-0 left-0 text-[var(--text-muted)] text-sm italic pointer-events-none opacity-40">What needs to be done?</div>}

        {/* Pencil Strike Overlay */}
        <AnimatePresence>
          {item.done && (
            <div className="absolute top-1/2 left-0 w-full pointer-events-none overflow-visible">
              <PencilStrike />
            </div>
          )}
        </AnimatePresence>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Remove task"
        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
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
      className="absolute top-[-2px] left-[-2%] w-[104%] h-[6px] overflow-visible"
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
        d="M 0 1 C 25 3, 50 -1, 75 2 C 100 0, 125 3, 150 1"
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
