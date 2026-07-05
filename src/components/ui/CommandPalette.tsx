'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const commandPaletteOpen = useCanvasStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useCanvasStore((s) => s.setCommandPaletteOpen);
  const setMode = useCanvasStore((s) => s.setMode);
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen);
  const addObject = useCanvasStore((s) => s.addObject);
  const camera = useCanvasStore((s) => s.camera);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const centerX = (window.innerWidth / 2 - camera.x) / camera.zoom;
  const centerY = (window.innerHeight / 2 - camera.y) / camera.zoom;

  const commands: Command[] = [
    { id: 'select', label: 'Switch to Select Mode', shortcut: 'V', action: () => setMode('select'), category: 'Mode' },
    { id: 'draw', label: 'Switch to Draw Mode', shortcut: 'D', action: () => setMode('draw'), category: 'Mode' },
    { id: 'text', label: 'Switch to Text Mode', shortcut: 'T', action: () => setMode('text'), category: 'Mode' },
    { id: 'pan', label: 'Switch to Pan Mode', shortcut: 'Space', action: () => setMode('pan'), category: 'Mode' },
    { id: 'search', label: 'Open Spatial Search', shortcut: '⌘F', action: () => setSearchOpen(true), category: 'Navigation' },
    { id: 'add-heading', label: 'Add Heading', action: () => addObject({ type: 'heading', x: centerX, y: centerY, width: 400, height: 60, content: 'New Heading' }), category: 'Create' },
    { id: 'add-text', label: 'Add Text Block', action: () => addObject({ type: 'text', x: centerX, y: centerY, width: 900, height: 100, content: '' }), category: 'Create' },
    { id: 'add-sticky', label: 'Add Sticky Note', action: () => addObject({ type: 'sticky', x: centerX, y: centerY, width: 200, height: 160, content: '', style: { color: 'var(--sticky-yellow)' } }), category: 'Create' },
    { id: 'add-card', label: 'Add Card', action: () => addObject({ type: 'card', x: centerX, y: centerY, width: 300, height: 200, content: '' }), category: 'Create' },
    { id: 'reset-zoom', label: 'Reset Zoom to 100%', action: () => useCanvasStore.getState().setCamera({ ...camera, zoom: 1 }), category: 'View' },
    { id: 'zoom-in', label: 'Zoom In', shortcut: '⌘+', action: () => useCanvasStore.getState().setCamera({ ...camera, zoom: Math.min(camera.zoom * 1.25, 5) }), category: 'View' },
    { id: 'zoom-out', label: 'Zoom Out', shortcut: '⌘-', action: () => useCanvasStore.getState().setCamera({ ...camera, zoom: Math.max(camera.zoom * 0.8, 0.1) }), category: 'View' },
  ];

  const filtered = query
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [commandPaletteOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        setCommandPaletteOpen(false);
      }
    },
    [filtered, selectedIndex, setCommandPaletteOpen]
  );

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setCommandPaletteOpen(false)}
        >
          <motion.div
            className="w-full max-w-md"
            initial={{ y: -15, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -15, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass-panel overflow-hidden shadow-xl">
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
                <span className="text-[var(--text-muted)]">⌘</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a command..."
                  className="flex-1 bg-transparent outline-none text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] font-light"
                />
              </div>

              <div className="max-h-[300px] overflow-y-auto py-1">
                {filtered.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    onClick={() => {
                      cmd.action();
                      setCommandPaletteOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                      i === selectedIndex
                        ? 'bg-[var(--accent-subtle)]'
                        : 'hover:bg-[var(--bg-secondary)]'
                    }`}
                  >
                    <span className="text-[10px] text-[var(--text-muted)] font-mono w-14">
                      {cmd.category}
                    </span>
                    <span className="flex-1 text-[var(--text-primary)] font-light">
                      {cmd.label}
                    </span>
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
