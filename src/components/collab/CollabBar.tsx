'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollabStore } from '@/store/collabStore';
import { useCanvasStore } from '@/store/canvasStore';
import { initialsOf } from '@/lib/collab/palette';

const spring = { type: 'spring' as const, stiffness: 300, damping: 26 };

export default function CollabBar() {
  const status = useCollabStore((s) => s.status);
  const code = useCollabStore((s) => s.code);
  const me = useCollabStore((s) => s.me);
  const peers = useCollabStore((s) => s.peers);
  const presenter = useCollabStore((s) => s.presenter);
  const transportKind = useCollabStore((s) => s.transportKind);
  const openModal = useCollabStore((s) => s.openModal);
  const leave = useCollabStore((s) => s.leave);
  const isHost = useCollabStore((s) => s.isHost);
  const guestOriginView = useCollabStore((s) => s.guestOriginView);
  const addSelectionToOriginCanvas = useCollabStore((s) => s.addSelectionToOriginCanvas);
  const selectedId = useCanvasStore((s) => s.selectedId);

  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState(false);

  const peerList = Object.values(peers);
  // Once join() is called the canvas swaps to the (initially blank) session
  // view synchronously, before status even reaches 'connecting' — the Leave
  // button needs to be reachable through that whole window, not just once
  // fully connected.
  const active = status === 'connected' || status === 'connecting';
  const amPresenting = !!me && presenter?.id === me.id;

  const addToMyCanvas = async () => {
    if (!selectedId) return;
    await addSelectionToOriginCanvas();
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  const togglePresent = () => {
    const collab = useCollabStore.getState();
    if (!collab.me || !collab._pulse) return;
    if (amPresenting) {
      collab._setPresenter(null);
      collab._pulse.presenter(null);
    } else {
      const cam = useCanvasStore.getState().camera;
      collab._setPresenter({ id: collab.me.id, name: collab.me.name, camera: cam });
      collab._pulse.presenter(cam);
    }
  };

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] pointer-events-none">
      <AnimatePresence mode="wait">
        {!active ? (
          <motion.button
            key="share"
            layout
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={spring}
            onClick={openModal}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            className="glass-bar pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold text-[var(--text-primary)] cursor-pointer hover:text-[var(--accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Collaborate
          </motion.button>
        ) : (
          <motion.div
            key="session"
            layout
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={spring}
            className="glass-bar pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 rounded-full"
          >
            {/* live dot + transport hint */}
            <span className="flex items-center gap-2 shrink-0" title={transportKind === 'supabase' ? 'Live across the internet' : 'Live across your tabs & windows on this device'}>
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-[#30A46C] opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-[#30A46C]" />
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-secondary)]">
                {transportKind === 'supabase' ? 'Live' : 'Local'}
              </span>
            </span>

            {/* code chip */}
            <button
              onClick={copyCode}
              title="Copy invite code"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full clay-inset text-[11px] font-mono font-bold tracking-widest text-[var(--text-primary)] cursor-pointer hover:text-[var(--accent)] transition-colors"
            >
              {code}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {copied ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </svg>
            </button>

            {/* presence avatars (me + peers) */}
            <div className="flex items-center -space-x-2">
              {me && <Avatar name={me.name} color={me.color} you />}
              {peerList.map((p) => (
                <Avatar key={p.id} name={p.name} color={p.color} />
              ))}
            </div>

            <span className="text-[10px] font-bold text-[var(--text-tertiary)] tabular-nums shrink-0">
              {peerList.length > 0 ? `${peerList.length + 1} here` : 'waiting…'}
            </span>

            {/* present / follow-me */}
            <button
              onClick={togglePresent}
              title={amPresenting ? 'Stop presenting' : 'Present — everyone follows your view'}
              className={`h-7 px-3 rounded-full flex items-center gap-1.5 text-[10px] font-bold shrink-0 transition-all cursor-pointer ${
                amPresenting ? 'bg-[var(--accent)] text-white shadow-[0_4px_10px_-4px_rgba(var(--accent-rgb),0.6)]' : 'text-[var(--text-secondary)] hover:bg-white/60'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 4h20v12H2z" /><path d="M8 20h8M12 16v4" />
              </svg>
              {amPresenting ? 'Presenting' : 'Present'}
            </button>

            {/* add selected object to my own canvas — guest only */}
            {!isHost && guestOriginView && (
              <button
                onClick={addToMyCanvas}
                disabled={!selectedId}
                title={selectedId ? 'Add the selected object to your own canvas' : 'Select an object first'}
                className={`h-7 px-3 rounded-full flex items-center gap-1.5 text-[10px] font-bold shrink-0 transition-all ${
                  !selectedId
                    ? 'text-[var(--text-muted)] cursor-not-allowed'
                    : 'text-[var(--text-secondary)] hover:bg-white/60 cursor-pointer'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {added ? <polyline points="20 6 9 17 4 12" /> : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
                </svg>
                {added ? 'Added' : 'Add to my canvas'}
              </button>
            )}

            {/* leave */}
            <button
              onClick={leave}
              title="Leave session"
              aria-label="Leave session"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Avatar({ name, color, you = false }: { name: string; color: string; you?: boolean }) {
  return (
    <div
      title={you ? `${name} (you)` : name}
      className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white ring-2 ring-white select-none"
      style={{ background: color }}
    >
      {initialsOf(name)}
    </div>
  );
}
