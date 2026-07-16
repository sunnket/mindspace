'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useCollabStore } from '@/store/collabStore';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas } from '@/lib/utils';

const EMOJIS = ['👍', '❤️', '🎉', '🔥', '😮', '😂'];

/**
 * Pulse — the live social layer. Floating emoji bursts, a broadcast laser
 * pointer (hold L), and presenter "follow me". All of it rides the collab
 * awareness channel and is purely ephemeral — never touches the doc or undo.
 */
export default function PulseLayer() {
  const status = useCollabStore((s) => s.status);
  const me = useCollabStore((s) => s.me);
  const peers = useCollabStore((s) => s.peers);
  const reactions = useCollabStore((s) => s.reactions);
  const lasers = useCollabStore((s) => s.lasers);
  const presenter = useCollabStore((s) => s.presenter);
  const following = useCollabStore((s) => s.following);
  const setFollowing = useCollabStore((s) => s.setFollowing);
  const camera = useCanvasStore((s) => s.camera);
  const reduce = useReducedMotion();

  const lastMouse = useRef({ x: 0, y: 0 });
  const [laserOn, setLaserOn] = useState(false);
  const connected = status === 'connected';

  const worldToScreen = (x: number, y: number) => ({
    x: x * camera.zoom + camera.x,
    y: y * camera.zoom + camera.y,
  });

  // Track my pointer for reaction/laser origin.
  useEffect(() => {
    const onMove = (e: MouseEvent) => { lastMouse.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const emit = (emoji: string) => {
    const collab = useCollabStore.getState();
    if (!collab._pulse || !collab.me) return;
    const world = screenToCanvas(lastMouse.current.x, lastMouse.current.y, useCanvasStore.getState().camera);
    collab._addReaction({ id: `${collab.me.id}-${Date.now()}-${Math.random()}`, emoji, x: world.x, y: world.y });
    collab._pulse.reaction(emoji, world.x, world.y);
  };

  // Keys: 1-6 fling a reaction, hold L for laser.
  useEffect(() => {
    if (!connected) return;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement;
      return el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) { emit(EMOJIS[n - 1]); return; }
      if ((e.key === 'l' || e.key === 'L') && !e.repeat) setLaserOn(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'l' || e.key === 'L') {
        setLaserOn(false);
        useCollabStore.getState()._pulse?.laser(0, 0, false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // While laser held, broadcast my cursor in world coords.
  useEffect(() => {
    if (!laserOn) return;
    const send = (e: MouseEvent) => {
      const world = screenToCanvas(e.clientX, e.clientY, useCanvasStore.getState().camera);
      useCollabStore.getState()._pulse?.laser(world.x, world.y, true);
    };
    // fire once immediately at current position
    const world = screenToCanvas(lastMouse.current.x, lastMouse.current.y, useCanvasStore.getState().camera);
    useCollabStore.getState()._pulse?.laser(world.x, world.y, true);
    window.addEventListener('mousemove', send);
    return () => window.removeEventListener('mousemove', send);
  }, [laserOn]);

  // If I'm the presenter, broadcast my viewport as it changes.
  const amPresenting = presenter?.id === me?.id;
  useEffect(() => {
    if (!amPresenting) return;
    useCollabStore.getState()._pulse?.presenter(camera);
  }, [amPresenting, camera]);

  // If following the presenter, track their viewport.
  useEffect(() => {
    if (following && presenter && presenter.id !== me?.id) {
      useCanvasStore.getState().setCamera(presenter.camera);
    }
  }, [following, presenter, me?.id]);

  if (!connected) return null;

  const myLaserScreen = laserOn ? lastMouse.current : null;

  return (
    <>
      {/* Floating reactions */}
      <div className="fixed inset-0 z-[135] pointer-events-none">
        <AnimatePresence>
          {reactions.map((r) => {
            const p = worldToScreen(r.x, r.y);
            return (
              <FloatingReaction key={r.id} id={r.id} emoji={r.emoji} x={p.x} y={p.y} reduce={!!reduce} />
            );
          })}
        </AnimatePresence>
      </div>

      {/* Peer lasers */}
      <div className="fixed inset-0 z-[136] pointer-events-none">
        {Object.entries(lasers).map(([id, pos]) => {
          const peer = peers[id];
          if (!peer) return null;
          const p = worldToScreen(pos.x, pos.y);
          return <LaserDot key={id} x={p.x} y={p.y} color={peer.color} />;
        })}
        {/* my own laser (local echo) */}
        {myLaserScreen && me && <LaserDot x={myLaserScreen.x} y={myLaserScreen.y} color={me.color} />}
      </div>

      {/* Reaction tray */}
      <div className="fixed top-[68px] left-1/2 -translate-x-1/2 z-[120] pointer-events-auto">
        <div className="glass-bar rounded-full px-2 py-1.5 flex items-center gap-1">
          {EMOJIS.map((em, i) => (
            <button
              key={em}
              onClick={() => emit(em)}
              title={`React (${i + 1})`}
              className="w-8 h-8 rounded-full flex items-center justify-center text-base hover:bg-white/60 active:scale-90 transition-all cursor-pointer"
            >
              {em}
            </button>
          ))}
          <div className="w-px h-5 bg-[var(--border)] mx-1" />
          <button
            onMouseDown={() => setLaserOn(true)}
            onMouseUp={() => { setLaserOn(false); useCollabStore.getState()._pulse?.laser(0, 0, false); }}
            onMouseLeave={() => { if (laserOn) { setLaserOn(false); useCollabStore.getState()._pulse?.laser(0, 0, false); } }}
            title="Hold to laser-point (or hold L)"
            className={`px-2.5 h-8 rounded-full flex items-center gap-1.5 text-[10px] font-bold transition-all cursor-pointer ${laserOn ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-white/60'}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Laser
          </button>
        </div>
      </div>

      {/* Follow banner — while someone else is presenting, either "break free"
          (when following) or hop back on their view (when you've broken free).
          Without the re-follow path, breaking free once left present mode
          permanently un-rejoinable until the presenter restarted. */}
      <AnimatePresence>
        {presenter && presenter.id !== me?.id && (
          <motion.button
            key={following ? 'following' : 'rejoin'}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            onClick={() => setFollowing(!following)}
            className="fixed top-4 right-6 z-[140] glass-bar rounded-full pl-3 pr-4 py-2 flex items-center gap-2 pointer-events-auto cursor-pointer group"
          >
            <span className="relative flex w-2 h-2">
              {following && (
                <span className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping" style={{ background: peers[presenter.id]?.color }} />
              )}
              <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: peers[presenter.id]?.color || 'var(--accent)' }} />
            </span>
            {following ? (
              <>
                <span className="text-[11px] font-bold text-[var(--text-primary)]">Following {presenter.name}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] group-hover:text-[var(--accent)]">— break free</span>
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold text-[var(--text-primary)]">{presenter.name} is presenting</span>
                <span className="text-[10px] text-[var(--accent)]">— follow</span>
              </>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

function FloatingReaction({ id, emoji, x, y, reduce }: { id: string; emoji: string; x: number; y: number; reduce: boolean }) {
  const removeReaction = useCollabStore((s) => s._removeReaction);
  useEffect(() => {
    const t = setTimeout(() => removeReaction(id), 1300);
    return () => clearTimeout(t);
  }, [id, removeReaction]);
  return (
    <motion.div
      className="absolute text-2xl select-none"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.4, x: '-50%', y: '-50%' }}
      animate={reduce ? { opacity: 1, scale: 1, x: '-50%', y: '-50%' } : { opacity: [0, 1, 1, 0], scale: [0.4, 1.25, 1, 0.9], y: ['-50%', '-160%', '-260%', '-340%'], x: '-50%' }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.3 : 1.3, ease: 'easeOut' }}
    >
      {emoji}
    </motion.div>
  );
}

function LaserDot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <div className="w-14 h-14 rounded-full blur-xl -translate-x-1/2 -translate-y-1/2 absolute left-1/2 top-1/2" style={{ background: color, opacity: 0.35 }} />
      <div className="w-3 h-3 rounded-full relative" style={{ background: color, boxShadow: `0 0 12px 3px ${color}` }} />
    </div>
  );
}
