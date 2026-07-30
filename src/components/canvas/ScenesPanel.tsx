'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { CanvasObjectData, Scene } from '@/lib/db';
import TourPlayer from './TourPlayer';

const spring = { type: 'spring' as const, stiffness: 320, damping: 28 };

/** Tiny live render of the region a scene frames — always fresh, no rasterizing. */
function ScenePreview({ scene, objects, w = 148, h = 92 }: { scene: Scene; objects: CanvasObjectData[]; w?: number; h?: number }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const cam = scene.camera;
  // A frame scene previews its RECTANGLE — that's the region it will present,
  // regardless of what camera happened to be stored with it.
  const worldLeft = scene.rect ? scene.rect.x : -cam.x / cam.zoom;
  const worldTop = scene.rect ? scene.rect.y : -cam.y / cam.zoom;
  const worldW = scene.rect ? scene.rect.width : vw / cam.zoom;
  const worldH = scene.rect ? scene.rect.height : vh / cam.zoom;
  const sx = w / worldW;
  const sy = h / worldH;

  const visible = objects.filter(
    (o) => !o.style?.isMinimized && o.x + o.width >= worldLeft && o.x <= worldLeft + worldW && o.y + o.height >= worldTop && o.y <= worldTop + worldH
  );

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rounded-lg" style={{ background: '#F5EFE7' }}>
      {visible.slice(0, 60).map((o) => {
        const x = (o.x - worldLeft) * sx;
        const y = (o.y - worldTop) * sy;
        const ow = Math.max(2, o.width * sx);
        const oh = Math.max(2, o.height * sy);
        const fill =
          o.type === 'heading' ? 'var(--accent)' :
          o.type === 'sticky' ? ((o.style?.color as string) || '#F5C563') :
          o.type === 'shape' ? ((o.style?.color as string) || 'rgba(var(--accent-rgb),0.4)') :
          o.type === 'frame' ? 'transparent' :
          '#FFFFFF';
        return (
          <rect key={o.id} x={x} y={y} width={ow} height={oh} rx={o.type === 'frame' ? 6 : 2}
            fill={fill}
            stroke={o.type === 'frame' ? ((o.style?.frameColor as string) || 'var(--accent)') : 'rgba(45,42,38,0.10)'}
            strokeDasharray={o.type === 'frame' ? '3 2' : undefined}
            strokeWidth="0.7" opacity={o.type === 'frame' ? 0.7 : 0.9} />
        );
      })}
    </svg>
  );
}

export default function ScenesPanel() {
  // Only subscribe to `scenes` at the top level — NOT `objects` — so this
  // never re-renders during a canvas drag. The heavy list (which needs live
  // objects for previews) lives in <SceneList>, mounted only when open.
  const scenes = useCanvasStore((s) => s.scenes);
  const [open, setOpen] = useState(false);
  const [tourFrom, setTourFrom] = useState<number | null>(null);

  const ordered = [...scenes].sort((a, b) => a.order - b.order);

  // A scene frame's HUD can start the tour without the panel being open.
  useEffect(() => {
    const play = () => { setOpen(false); setTourFrom(0); };
    window.addEventListener('play-scene-tour', play);
    return () => window.removeEventListener('play-scene-tour', play);
  }, []);

  return (
    <>
      {/* Top-right corner — the slot the account avatar used to occupy. Scenes
          is a "present this board" action, which belongs with the board-level
          controls at the top of the screen rather than floating over the middle
          of the left edge, where it also collided with the Pocket rail. */}
      <div className="scenes-launcher fixed top-12 right-10 z-[130] flex flex-row-reverse items-start gap-3 pointer-events-auto">
        {/* Launcher. The old icon was a sprocketed film strip — busy at 19px and
            it read as "video file". A slide with a play head on it says
            "present these views", which is what this actually does. */}
        <motion.button
          onClick={() => setOpen((o) => !o)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          title="Scenes — present this board as a guided tour"
          aria-label="Scenes"
          aria-expanded={open}
          className="clay-card w-11 h-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer relative shrink-0"
          style={{ color: open ? 'var(--accent)' : 'var(--text-secondary)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* the deck behind, so it reads as several slides */}
            <path d="M6.5 18.5H5A1.5 1.5 0 0 1 3.5 17V7" opacity="0.45" strokeWidth="1.6" />
            {/* the slide itself */}
            <rect x="6.5" y="4" width="14" height="12.5" rx="2" strokeWidth="1.7" />
            {/* the play head, solid so it holds at small sizes */}
            <path d="M11.8 8.2v4.1l3.6-2.05z" fill="currentColor" stroke="none" />
            {/* the stand — a presentation, not a photo */}
            <path d="M13.5 16.5v3.2" strokeWidth="1.7" />
            <path d="M10.6 20.4h5.8" strokeWidth="1.7" />
          </svg>
          {scenes.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">
              {scenes.length}
            </span>
          )}
        </motion.button>

        {/* Panel — mounted only when open, so `objects` isn't subscribed at rest */}
        <AnimatePresence>
          {open && <SceneList onPlay={() => { setOpen(false); setTourFrom(0); }} />}
        </AnimatePresence>
      </div>

      {tourFrom !== null && ordered.length > 0 && (
        <TourPlayer scenes={ordered} startIndex={tourFrom} onExit={() => setTourFrom(null)} />
      )}
    </>
  );
}

/** The heavy panel body — only mounted while the panel is open. */
function SceneList({ onPlay }: { onPlay: () => void }) {
  const scenes = useCanvasStore((s) => s.scenes);
  const objects = useCanvasStore((s) => s.objects);
  const addScene = useCanvasStore((s) => s.addScene);
  const removeScene = useCanvasStore((s) => s.removeScene);
  const renameScene = useCanvasStore((s) => s.renameScene);
  const moveScene = useCanvasStore((s) => s.moveScene);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const syncSceneFrames = useCanvasStore((s) => s.syncSceneFrames);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const activeParent = resolveParentId(canvasStack, urlCanvasId);
  const sceneFrameCount = objects.filter(
    (o) => o.type === 'frame' && o.parentId === activeParent && o.style?.frameKind === 'scene',
  ).length;

  return (
    <motion.div
      /* Slides in from the right now that the launcher lives in that corner —
         the panel opens toward the middle of the screen, not off the edge. */
      initial={{ opacity: 0, x: 12, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.97 }}
      transition={spring}
      // Inline padding: Tailwind p-* is dead here (global `* { padding:0 }`
      // reset wins), and with zero padding the rounded corner clips the "S".
      style={{ padding: 16 }}
      className="clay-card w-72 max-h-[70vh] rounded-[24px] flex flex-col gap-3 overflow-hidden"
    >
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-[11px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-secondary)]">Scenes</h3>
        <button
          onClick={() => addScene()}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold cursor-pointer hover:brightness-105 transition-all shadow-[0_6px_14px_-6px_rgba(var(--accent-rgb),0.6)]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Capture view
        </button>
      </div>

      {/* Pull every scene frame on this board into the tour, in reading order. */}
      {sceneFrameCount > 0 && (
        <button
          onClick={() => syncSceneFrames()}
          title="Create or refresh a slide for each scene frame"
          className="shrink-0 w-full rounded-full text-[10px] font-bold bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          style={{ padding: '6px 10px' }}
        >
          Sync {sceneFrameCount} scene frame{sceneFrameCount === 1 ? '' : 's'}
        </button>
      )}

      {ordered.length === 0 ? (
        <div className="text-center py-8 px-2">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Frame a part of your board, then <strong className="text-[var(--text-primary)]">Capture view</strong> to save it as a scene. Play them back as a smooth guided tour.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 overflow-y-auto min-h-0 pr-1">
          {ordered.map((scene, i) => (
            <div key={scene.id} className="clay-inset rounded-2xl p-2 flex flex-col gap-1.5 group">
              <div className="relative rounded-lg overflow-hidden cursor-pointer" onClick={() => animateCamera(scene.camera, 800)} title="Fly here">
                <ScenePreview scene={scene} objects={objects} />
                <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">{i + 1}</span>
                {scene.rect && (
                  <span
                    className="absolute top-1 right-1 rounded-full text-white text-[8px] font-extrabold uppercase tracking-wider shadow-sm"
                    style={{ background: '#3E63DD', padding: '2px 5px' }}
                    title="Presents only this framed region"
                  >
                    Frame
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {renamingId === scene.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => { renameScene(scene.id, draft.trim() || scene.name); setRenamingId(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="flex-1 min-w-0 bg-transparent border-b border-[var(--accent)] outline-none text-[11px] font-bold"
                  />
                ) : (
                  <button
                    onClick={() => { setRenamingId(scene.id); setDraft(scene.name); }}
                    className="flex-1 min-w-0 text-left text-[11px] font-bold text-[var(--text-primary)] truncate hover:text-[var(--accent)] transition-colors cursor-text"
                    title="Rename"
                  >
                    {scene.name}
                  </button>
                )}
                <button onClick={() => moveScene(scene.id, -1)} disabled={i === 0} aria-label="Move up"
                  className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <button onClick={() => moveScene(scene.id, 1)} disabled={i === ordered.length - 1} aria-label="Move down"
                  className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <button onClick={() => removeScene(scene.id)} aria-label="Delete scene"
                  className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {ordered.length > 0 && (
        <button
          onClick={onPlay}
          className="shrink-0 w-full py-2.5 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer hover:brightness-105 transition-all shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          Play tour
        </button>
      )}
    </motion.div>
  );
}
