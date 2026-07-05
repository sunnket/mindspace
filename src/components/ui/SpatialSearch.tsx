'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

export default function SpatialSearch() {
  const searchOpen = useCanvasStore((s) => s.searchOpen);
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen);
  const searchQuery = useCanvasStore((s) => s.searchQuery);
  const setSearchQuery = useCanvasStore((s) => s.setSearchQuery);
  const objects = useCanvasStore((s) => s.objects);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const camera = useCanvasStore((s) => s.camera);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<typeof objects>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [searchOpen, setSearchQuery]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matched = objects.filter(
      (obj) =>
        obj.content?.toLowerCase().includes(q) ||
        obj.type.toLowerCase().includes(q)
    );
    setResults(matched);
    setSelectedIndex(0);
  }, [searchQuery, objects]);

  const flyToObject = useCallback(
    (obj: (typeof objects)[0]) => {
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const targetZoom = 1;

      const targetX = viewportW / 2 - (obj.x + obj.width / 2) * targetZoom;
      const targetY = viewportH / 2 - (obj.y + obj.height / 2) * targetZoom;

      // Animate camera
      const startX = camera.x;
      const startY = camera.y;
      const startZoom = camera.zoom;
      const duration = 600;
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - t, 4); // ease out quart

        setCamera({
          x: startX + (targetX - startX) * ease,
          y: startY + (targetY - startY) * ease,
          zoom: startZoom + (targetZoom - startZoom) * ease,
        });

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          setSelectedId(obj.id);
          // Add pulse effect
          const el = document.querySelector(`[data-object-id="${obj.id}"]`);
          if (el) {
            el.classList.add('result-pulse');
            setTimeout(() => el.classList.remove('result-pulse'), 4500);
          }
        }
      };

      requestAnimationFrame(animate);
      setSearchOpen(false);
    },
    [camera, setCamera, setSelectedId, setSearchOpen]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        flyToObject(results[selectedIndex]);
      }
    },
    [results, selectedIndex, flyToObject, setSearchOpen]
  );

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          className="search-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => setSearchOpen(false)}
        >
          <motion.div
            initial={{ y: -20, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="glass-panel overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="text-[var(--text-muted)] text-lg">⌕</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search your mind space..."
                  className="flex-1 bg-transparent outline-none text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] font-light"
                />
                <kbd className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-muted)] font-mono">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              {results.length > 0 && (
                <div className="border-t border-[var(--border)] max-h-60 overflow-y-auto">
                  {results.map((result, i) => (
                    <motion.button
                      key={result.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => flyToObject(result)}
                      className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors ${
                        i === selectedIndex
                          ? 'bg-[var(--accent-subtle)]'
                          : 'hover:bg-[var(--bg-secondary)]'
                      }`}
                    >
                      <span className="text-xs text-[var(--text-muted)] w-8 text-center">
                        {result.type === 'heading'
                          ? 'H'
                          : result.type === 'text'
                          ? 'T'
                          : result.type === 'sticky'
                          ? '◻'
                          : result.type === 'card'
                          ? '▭'
                          : '◎'}
                      </span>
                      <span className="text-sm text-[var(--text-primary)] truncate flex-1">
                        {result.content || `Untitled ${result.type}`}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">↵ fly to</span>
                    </motion.button>
                  ))}
                </div>
              )}

              {searchQuery && results.length === 0 && (
                <div className="border-t border-[var(--border)] px-5 py-6 text-center text-sm text-[var(--text-muted)]">
                  No thoughts found for "{searchQuery}"
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
