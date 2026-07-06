'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { Scene } from '@/lib/db';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Cinematic tour playback. Flies the camera scene→scene with eased motion and
 * a subtle "dolly" (zoom-out dip mid-flight) on long jumps so big leaps feel
 * filmic instead of teleporting. Space toggles play, arrows step, Esc exits.
 */
export default function TourPlayer({
  scenes,
  startIndex,
  onExit,
}: {
  scenes: Scene[];
  startIndex: number;
  onExit: () => void;
}) {
  const setTouring = useCanvasStore((s) => s.setTouring);
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  const tokenRef = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ordered = scenes;
  const total = ordered.length;

  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const flyTo = useCallback(
    (to: { x: number; y: number; zoom: number }, dur: number) =>
      new Promise<void>((resolve) => {
        const token = ++tokenRef.current;
        const from = { ...useCanvasStore.getState().camera };
        if (reduceMotion) {
          useCanvasStore.getState().setCamera(to);
          resolve();
          return;
        }
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const dolly = dist > 700 ? Math.min(0.45, dist / 6000) : 0;
        const start = performance.now();
        const step = (now: number) => {
          if (token !== tokenRef.current) return resolve(); // superseded / cancelled
          const t = Math.min((now - start) / dur, 1);
          const e = easeInOut(t);
          let zoom = from.zoom + (to.zoom - from.zoom) * e;
          zoom *= 1 - dolly * Math.sin(Math.PI * t);
          useCanvasStore.getState().setCamera({
            x: from.x + (to.x - from.x) * e,
            y: from.y + (to.y - from.y) * e,
            zoom,
          });
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [reduceMotion]
  );

  const cancelMotion = useCallback(() => {
    tokenRef.current++;
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const runFrom = useCallback(
    async (from: number) => {
      playingRef.current = true;
      setPlaying(true);
      for (let i = from; i < total; i++) {
        if (!playingRef.current) break;
        setIndex(i);
        await flyTo(ordered[i].camera, ordered[i].durationMs || 1400);
        if (!playingRef.current) break;
        if (i < total - 1) {
          await new Promise<void>((r) => {
            holdTimer.current = setTimeout(r, 800);
          });
        }
      }
      playingRef.current = false;
      setPlaying(false);
    },
    [flyTo, ordered, total]
  );

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    cancelMotion();
  }, [cancelMotion]);

  const stepTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(total - 1, i));
      pause();
      setIndex(clamped);
      flyTo(ordered[clamped].camera, 900);
    },
    [flyTo, ordered, total, pause]
  );

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause();
    else runFrom(index >= total - 1 ? 0 : index);
  }, [index, total, pause, runFrom]);

  const exit = useCallback(() => {
    pause();
    onExit();
  }, [pause, onExit]);

  // Enter tour mode: hide chrome, start playback.
  useEffect(() => {
    setTouring(true);
    document.documentElement.classList.add('tour-mode');
    runFrom(startIndex);
    return () => {
      tokenRef.current++;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setTouring(false);
      document.documentElement.classList.remove('tour-mode');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); exit(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepTo(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepTo(index - 1); }
      else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, exit, stepTo, togglePlay]);

  const current = ordered[index];

  return (
    <>
      {/* soft cinematic vignette */}
      <div className="fixed inset-0 z-[240] pointer-events-none" style={{ boxShadow: 'inset 0 0 220px 40px rgba(45,42,38,0.28)' }} />

      {/* control bar */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[250] glass-bar rounded-full px-3 py-2 flex items-center gap-3 pointer-events-auto"
      >
        <button onClick={() => stepTo(index - 1)} disabled={index <= 0} aria-label="Previous scene"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5l-10 7 10 7z" /></svg>
        </button>

        <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
          className="w-11 h-11 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(201,123,75,0.6)] hover:brightness-105 transition-all cursor-pointer">
          {playing ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          )}
        </button>

        <button onClick={() => stepTo(index + 1)} disabled={index >= total - 1} aria-label="Next scene"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5l10 7-10 7z" /></svg>
        </button>

        <div className="flex flex-col items-start px-2 min-w-[120px] max-w-[200px]">
          <span className="text-[11px] font-bold text-[var(--text-primary)] truncate w-full" style={{ fontFamily: "'Outfit', sans-serif" }}>
            {current?.name}
          </span>
          <div className="flex items-center gap-1 mt-1 w-full">
            {ordered.map((s, i) => (
              <button
                key={s.id}
                onClick={() => stepTo(i)}
                aria-label={`Go to ${s.name}`}
                className="h-1 rounded-full flex-1 transition-colors cursor-pointer"
                style={{ background: i === index ? 'var(--accent)' : i < index ? 'rgba(201,123,75,0.35)' : 'rgba(90,62,40,0.15)' }}
              />
            ))}
          </div>
        </div>

        <span className="text-[10px] font-bold text-[var(--text-tertiary)] tabular-nums shrink-0">{index + 1}/{total}</span>

        <button onClick={exit} aria-label="Exit tour"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </motion.div>
    </>
  );
}
