'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { Scene } from '@/lib/db';
import { cameraForRect, rectToScreen } from '@/lib/frames';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Where a scene's camera should actually land.
 *
 * A scene born from a scene-FRAME stores its rectangle, so the camera is
 * re-derived for the CURRENT viewport — the slide frames the same region on a
 * laptop and on a 34" monitor instead of replaying a camera captured somewhere
 * else. Plain "capture view" scenes keep their stored camera exactly as before.
 */
function targetCamera(scene: Scene): { x: number; y: number; zoom: number } {
  if (!scene.rect) return scene.camera;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  return cameraForRect(scene.rect, vw, vh);
}

/**
 * Cinematic tour playback. Flies the camera scene→scene with eased motion and
 * a subtle "dolly" (zoom-out dip mid-flight) on long jumps so big leaps feel
 * filmic instead of teleporting. Space toggles play, arrows step, Esc exits.
 */
/**
 * Blacks out everything outside a world-space rectangle, so a frame scene
 * presents ONLY what was framed.
 *
 * Four opaque panels rather than a box-shadow: the cut-out edge stays exact at
 * any zoom, and the panels sit ABOVE the app chrome, so nothing from the canvas
 * or the UI can bleed in around the slide. It re-projects on every camera change
 * so it stays glued to the region while the player flies. No ring, no border —
 * the slide should look like a slide, not like a framed region of a canvas.
 */
function RegionMask({
  rect, title, index, total,
}: {
  rect: { x: number; y: number; width: number; height: number };
  title: string;
  index: number;
  total: number;
}) {
  const camera = useCanvasStore((s) => s.camera);
  const r = rectToScreen(rect, camera);
  const shade = '#0B0A09';
  const panel = (style: React.CSSProperties, key: string) => (
    <div key={key} className="absolute" style={{ background: shade, ...style }} />
  );

  // The frame's name is the slide's heading, and it belongs in the black band
  // ABOVE the slide. Positioning it off the same projection as the mask is what
  // guarantees it can never land on top of the content it's titling.
  const bandH = Math.max(0, r.y);
  const showTitle = bandH > 46;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45 }}
      className="fixed inset-0 z-[242] pointer-events-none overflow-hidden"
    >
      {panel({ left: 0, top: 0, width: '100%', height: bandH }, 'top')}
      {panel({ left: 0, top: r.y + r.height, width: '100%', bottom: 0 }, 'bottom')}
      {panel({ left: 0, top: r.y, width: Math.max(0, r.x), height: r.height }, 'left')}
      {panel({ left: r.x + r.width, top: r.y, right: 0, height: r.height }, 'right')}

      {showTitle && (
        <div
          className="absolute flex flex-col items-center justify-center text-center"
          style={{ left: 0, top: 0, width: '100%', height: bandH, padding: '0 24px' }}
        >
          <span className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-white/45">
            {index + 1} / {total}
          </span>
          <h2
            className="text-white font-bold leading-tight truncate w-full"
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: Math.max(16, Math.min(30, bandH * 0.34)),
              marginTop: 4,
            }}
          >
            {title}
          </h2>
        </div>
      )}
    </motion.div>
  );
}

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

  const [laserActive, setLaserActive] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);

  useEffect(() => {
    if (!laserActive) {
      setHasMoved(false);
      return;
    }
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setHasMoved(true);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [laserActive]);

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
        await flyTo(targetCamera(ordered[i]), ordered[i].durationMs || 1400);
        if (!playingRef.current) break;
        if (i < total - 1) {
          // Linger longer on stops with notes so the caption can be read — but
          // capped so it never feels frozen.
          const notes = ordered[i]?.notes;
          const holdMs = notes ? Math.min(4800, 1200 + notes.length * 38) : 800;
          await new Promise<void>((r) => {
            holdTimer.current = setTimeout(r, holdMs);
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
      flyTo(targetCamera(ordered[clamped]), 900);
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
      else if (e.key.toLowerCase() === 'l') { e.preventDefault(); setLaserActive(prev => !prev); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, exit, stepTo, togglePlay]);

  const current = ordered[index];

  return (
    <>
      {/* A scene FRAME presents ONLY its own region: everything outside the
          rectangle is blacked out — canvas and app chrome alike — and the frame
          name is the slide's heading. The mask tracks the camera, so it stays
          locked to the region for the whole flight. */}
      {current?.rect && (
        <RegionMask rect={current.rect} title={current.name} index={index} total={total} />
      )}

      {/* Soft cinematic vignette — for camera scenes only. A frame scene is
          already hard-edged by its mask, and layering a vignette under it just
          muddied the slide. */}
      {!current?.rect && (
        <div className="fixed inset-0 z-[240] pointer-events-none" style={{ boxShadow: 'inset 0 0 220px 40px rgba(45,42,38,0.28)' }} />
      )}

      {/* Hide native cursor when laser is active */}
      {laserActive && (
        <style dangerouslySetInnerHTML={{ __html: `
          .tour-mode, .tour-mode *, html, body, #root, #__next {
            cursor: none !important;
          }
        `}} />
      )}

      {/* Glowing red laser pointer dot */}
      {laserActive && hasMoved && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            transform: `translate3d(${mousePos.x}px, ${mousePos.y}px, 0) translate(-50%, -50%)`,
            width: 14,
            height: 14,
            background: '#ff0000',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 999999,
            boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.85), 0 0 10px 4px #ff0000, 0 0 22px 8px rgba(255, 0, 0, 0.65)',
            willChange: 'transform',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 4,
              height: 4,
              background: '#ffffff',
              borderRadius: '50%',
            }}
          />
        </div>
      )}

      {/* Scene caption */}
      {current?.notes && (
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[250] max-w-[min(720px,86vw)] px-6 py-3 rounded-2xl text-center pointer-events-none"
          style={{ background: 'rgba(12,11,10,0.72)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <p className="text-[15px] leading-relaxed text-white/95" style={{ fontFamily: "'Outfit', sans-serif" }}>
            {current.notes}
          </p>
        </motion.div>
      )}

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
          className="w-11 h-11 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(var(--accent-rgb),0.6)] hover:brightness-105 transition-all cursor-pointer">
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
                style={{ background: i === index ? 'var(--accent)' : i < index ? 'rgba(var(--accent-rgb),0.35)' : 'rgba(90,62,40,0.15)' }}
              />
            ))}
          </div>
        </div>

        <span className="text-[10px] font-bold text-[var(--text-tertiary)] tabular-nums shrink-0">{index + 1}/{total}</span>

        <button
          onClick={() => setLaserActive(prev => !prev)}
          aria-label="Toggle laser pointer"
          title="Laser Pointer (L)"
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            laserActive 
              ? 'bg-red-500 text-white shadow-[0_4px_12px_rgba(239,68,68,0.5)]' 
              : 'text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </button>

        <button onClick={exit} aria-label="Exit tour"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </motion.div>
    </>
  );
}
