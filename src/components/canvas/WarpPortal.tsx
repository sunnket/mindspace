'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { getAllCanvasStates, getAllObjects, CanvasObjectData } from '@/lib/db';

interface WarpTarget {
  id: string; // 'root' or a canvas/heading id
  title: string;
  kind: 'board' | 'subspace';
  count: number | null;
}

type Phase = 'pick' | 'warping' | 'done';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function chipVisual(obj: CanvasObjectData) {
  const color =
    (obj.style?.color as string) ||
    (obj.style?.borderColor as string) ||
    (obj.style?.frameColor as string) ||
    'var(--accent)';
  let label = (obj.content || '').split('\n')[0].trim();
  if (!label) {
    label = obj.style?.isLinkPreview ? 'link' : obj.style?.isVoiceNote ? 'voice note' : obj.type;
  }
  return { color, label: label.slice(0, 26) };
}

// A single swirling portal card.
function PortalCard({ target, index, onPick }: { target: WarpTarget; index: number; onPick: () => void }) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 340, damping: 26 }}
      whileHover={{ scale: 1.035, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onPick}
      className="relative w-[168px] h-[132px] rounded-2xl overflow-hidden text-left p-3.5 flex flex-col justify-end cursor-pointer group border border-white/10 shadow-lg"
      style={{ background: 'rgba(20,17,15,0.55)', backdropFilter: 'blur(10px)' }}
    >
      {/* Swirling portal ring */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          className="w-24 h-24 rounded-full opacity-70 group-hover:opacity-100 transition-opacity"
          style={{
            background:
              'conic-gradient(from 0deg, rgba(201,123,75,0.05), rgba(232,169,123,0.55), rgba(74,144,217,0.5), rgba(201,123,75,0.05))',
            filter: 'blur(6px)',
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 7, ease: 'linear' }}
        />
        <div className="absolute w-11 h-11 rounded-full bg-black/50 border border-white/15 backdrop-blur-sm" />
      </div>

      <div className="relative z-10">
        <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-[var(--accent-light)] mb-0.5">
          {target.kind === 'board' ? 'Canvas' : 'Sub-space'}
        </div>
        <div className="text-[13px] font-bold text-white leading-tight line-clamp-2">{target.title}</div>
        <div className="text-[10px] text-white/50 mt-0.5 font-mono">
          {target.count === null ? '…' : `${target.count} item${target.count === 1 ? '' : 's'}`}
        </div>
      </div>
    </motion.button>
  );
}

export default function WarpPortal() {
  const [objectId, setObjectId] = useState<string | null>(null);
  const [targets, setTargets] = useState<WarpTarget[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [chosen, setChosen] = useState<WarpTarget | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [chip, setChip] = useState<{ color: string; label: string } | null>(null);

  const teleportObject = useCanvasStore((s) => s.teleportObject);

  const close = useCallback(() => {
    setObjectId(null);
    setChosen(null);
    setPhase('pick');
    setChip(null);
    setOrigin(null);
  }, []);

  // Load targets when a warp is requested.
  useEffect(() => {
    const onOpen = async (e: Event) => {
      const id = (e as CustomEvent<{ objectId: string }>).detail?.objectId;
      if (!id) return;
      const store = useCanvasStore.getState();
      const obj = store.objects.find((o) => o.id === id);
      if (!obj) return;

      // Screen-space origin of the object (for the fly-into-portal animation).
      const cam = store.camera;
      setOrigin({
        x: (obj.x + obj.width / 2) * cam.zoom + cam.x,
        y: (obj.y + obj.height / 2) * cam.zoom + cam.y,
      });
      setChip(chipVisual(obj));
      setPhase('pick');
      setChosen(null);
      setObjectId(id);

      const stack = store.canvasStack;
      const currentParent = stack.length > 0 ? stack[stack.length - 1] : store.urlCanvasId;

      const byId = new Map<string, WarpTarget>();
      try {
        const states = await getAllCanvasStates();
        states.forEach((s) => {
          if (s.id === currentParent) return;
          byId.set(s.id, {
            id: s.id,
            title: s.title?.trim() || (s.id === 'root' ? 'Root canvas' : 'Untitled canvas'),
            kind: 'board',
            count: null,
          });
        });
      } catch { /* ignore */ }

      // Root is always a valid destination when we're not already on it.
      if (currentParent !== 'root' && !byId.has('root')) {
        byId.set('root', { id: 'root', title: 'Root canvas', kind: 'board', count: null });
      }

      // Headings on the current canvas are sub-space portals.
      store.objects
        .filter((o) => o.type === 'heading' && o.id !== id)
        .forEach((h) => {
          if (byId.has(h.id)) return;
          byId.set(h.id, {
            id: h.id,
            title: (h.content || 'Untitled space').split('\n')[0].slice(0, 40) || 'Untitled space',
            kind: 'subspace',
            count: null,
          });
        });

      const list = Array.from(byId.values());
      setTargets(list);

      // Fill in item counts asynchronously.
      list.forEach(async (t) => {
        try {
          const objs = await getAllObjects(t.id === 'root' ? undefined : t.id);
          setTargets((prev) => prev.map((p) => (p.id === t.id ? { ...p, count: objs.length } : p)));
        } catch { /* ignore */ }
      });
    };

    window.addEventListener('open-warp', onOpen as EventListener);
    return () => window.removeEventListener('open-warp', onOpen as EventListener);
  }, []);

  // Escape cancels while picking.
  useEffect(() => {
    if (!objectId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'pick') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [objectId, phase, close]);

  const pick = useCallback((target: WarpTarget) => {
    if (!objectId) return;
    setChosen(target);
    setPhase('warping');

    const reduce = prefersReducedMotion();
    const warpDelay = reduce ? 160 : 640;

    window.setTimeout(() => {
      teleportObject(objectId, target.id);
      setPhase('done');
      window.setTimeout(close, reduce ? 500 : 1000);
    }, warpDelay);
  }, [objectId, teleportObject, close]);

  const center = typeof window !== 'undefined'
    ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    : { x: 0, y: 0 };

  return (
    <AnimatePresence>
      {objectId && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Scrim */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(12,10,9,0.55)', backdropFilter: 'blur(6px)' }}
            onClick={() => phase === 'pick' && close()}
          />

          {/* PICK PHASE */}
          {phase === 'pick' && (
            <motion.div
              className="relative z-10 w-[min(92vw,640px)] max-h-[80vh] rounded-3xl p-6 flex flex-col"
              style={{ background: 'rgba(23,20,18,0.92)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.7)' }}
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.92, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            >
              <div className="flex items-center gap-3 mb-1">
                {chip && <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: chip.color }} />}
                <h2 className="text-lg font-bold text-white tracking-tight">Warp {chip ? `"${chip.label}"` : 'this'} to…</h2>
              </div>
              <p className="text-xs text-white/45 mb-4">Pick a portal. The item leaves this canvas and lands there.</p>

              {targets.length === 0 ? (
                <div className="py-10 text-center text-white/50 text-sm">
                  No other canvases yet.<br />
                  <span className="text-white/35 text-xs">Double-click a heading to make a sub-space, then warp things into it.</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 overflow-y-auto pr-1" style={{ gridAutoRows: 'min-content' }}>
                  {targets.map((t, i) => (
                    <PortalCard key={t.id} target={t} index={i} onPick={() => pick(t)} />
                  ))}
                </div>
              )}

              <button
                onClick={close}
                className="mt-5 self-center px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </motion.div>
          )}

          {/* WARPING / DONE PHASE — the cinematic vortex */}
          {(phase === 'warping' || phase === 'done') && (
            <>
              {/* Vortex at screen center */}
              <motion.div
                className="absolute z-10 rounded-full pointer-events-none"
                style={{
                  left: center.x, top: center.y,
                  width: 280, height: 280, x: '-50%', y: '-50%',
                  background: 'conic-gradient(from 0deg, rgba(201,123,75,0.0), rgba(232,169,123,0.8), rgba(74,144,217,0.7), rgba(201,123,75,0.0))',
                  filter: 'blur(4px)',
                }}
                initial={{ scale: 0.2, opacity: 0, rotate: 0 }}
                animate={{ scale: phase === 'done' ? 0.1 : 1, opacity: phase === 'done' ? 0 : 1, rotate: 540 }}
                transition={{ duration: prefersReducedMotion() ? 0.15 : 0.8, ease: 'easeInOut' }}
              />
              <motion.div
                className="absolute z-10 rounded-full bg-black/70 border border-white/20 pointer-events-none"
                style={{ left: center.x, top: center.y, width: 120, height: 120, x: '-50%', y: '-50%' }}
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: 1, opacity: phase === 'done' ? 0 : 1 }}
                transition={{ duration: 0.5 }}
              />

              {/* The item flying into the portal */}
              {chip && origin && phase === 'warping' && !prefersReducedMotion() && (
                <motion.div
                  className="absolute z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white shadow-2xl whitespace-nowrap pointer-events-none"
                  style={{ background: chip.color, x: '-50%', y: '-50%' }}
                  initial={{ left: origin.x, top: origin.y, scale: 1, opacity: 1, rotate: 0 }}
                  animate={{ left: center.x, top: center.y, scale: 0.1, opacity: 0, rotate: 220 }}
                  transition={{ duration: 0.64, ease: [0.5, 0, 0.75, 0] }}
                >
                  {chip.label}
                </motion.div>
              )}

              {/* Confirmation */}
              {phase === 'done' && chosen && (
                <motion.div
                  className="absolute z-20 flex flex-col items-center gap-2"
                  style={{ left: center.x, top: center.y, x: '-50%', y: '-50%' }}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center text-white shadow-xl">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <div className="text-sm font-bold text-white">Warped to {chosen.title}</div>
                </motion.div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
