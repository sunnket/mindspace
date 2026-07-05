'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export default function TodoBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [title, setTitle] = useState((obj.style?.todoTitle as string) || 'todos');

  useEffect(() => {
    try {
      const parsed = JSON.parse(obj.content || '[]');
      if (Array.isArray(parsed)) {
        setItems(parsed);
      } else {
        setItems([]);
      }
    } catch (e) {
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

  const addItem = () => {
    const newItem = { id: uuidv4(), text: '', done: false };
    save([...items, newItem]);
  };

  const toggleItem = (id: string) => {
    const newItems = items.map(item => 
      item.id === id ? { ...item, done: !item.done } : item
    );
    save(newItems);
  };

  const updateItemText = (id: string, text: string) => {
    const newItems = items.map(item => 
      item.id === id ? { ...item, text } : item
    );
    save(newItems);
  };

  const removeItem = (id: string) => {
    const newItems = items.filter(item => item.id !== id);
    save(newItems);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-xl overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-white/10">
        <div className="flex items-center gap-3">
          <span className="text-[var(--accent)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
          </span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              save(items, e.target.value);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="bg-transparent border-none outline-none font-semibold text-[var(--text-primary)] text-sm placeholder:opacity-50"
            placeholder="List Title"
          />
        </div>
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
        {items.map((item) => (
          <TodoRow 
            key={item.id} 
            item={item} 
            onToggle={() => toggleItem(item.id)}
            onUpdate={(text) => updateItemText(item.id, text)}
            onRemove={() => removeItem(item.id)}
          />
        ))}
        {items.length === 0 && (
          <div className="text-center py-4 text-[var(--text-muted)] text-sm italic opacity-60">
            No tasks yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] bg-white/5">
        <button
          onClick={(e) => { e.stopPropagation(); addItem(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center gap-2 text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors text-xs font-bold uppercase tracking-wider"
        >
          <span className="text-lg">+</span>
          Add Item
        </button>
      </div>
    </div>
  );
}

function TodoRow({ item, onToggle, onUpdate, onRemove }: { 
  item: TodoItem; 
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onRemove: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-start gap-4 group">
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`mt-1 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
          item.done 
            ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-[0_0_10px_rgba(var(--accent-rgb),0.4)]' 
            : 'border-[var(--text-muted)] hover:border-[var(--accent)]'
        }`}
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
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onUpdate(e.currentTarget.innerText)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
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
        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity p-1 text-[var(--text-muted)] hover:text-red-500"
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
