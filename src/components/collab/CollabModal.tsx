'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollabStore } from '@/store/collabStore';

const spring = { type: 'spring' as const, stiffness: 300, damping: 28 };

export default function CollabModal() {
  const open = useCollabStore((s) => s.modalOpen);
  const closeModal = useCollabStore((s) => s.closeModal);
  const status = useCollabStore((s) => s.status);
  const code = useCollabStore((s) => s.code);
  const transportKind = useCollabStore((s) => s.transportKind);
  const host = useCollabStore((s) => s.host);
  const join = useCollabStore((s) => s.join);

  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Prefill name from the landing page's stored username.
  useEffect(() => {
    if (open && !name) {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('username') : null;
      if (stored) setName(stored);
    }
  }, [open, name]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeModal]);

  const connected = status === 'connected';

  const doHost = async () => {
    setBusy(true);
    try {
      await host(name.trim() || 'Host');
    } finally {
      setBusy(false);
    }
  };

  const doJoin = async () => {
    const c = joinCode.trim().toUpperCase();
    if (c.length < 4) {
      setJoinError('Enter the code your host shared with you.');
      return;
    }
    setJoinError(null);
    setBusy(true);
    try {
      await join(c, name.trim() || 'Guest');
    } finally {
      setBusy(false);
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
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* scrim */}
          <div
            className="absolute inset-0 bg-[rgba(45,42,38,0.35)] backdrop-blur-md"
            onClick={closeModal}
          />

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={spring}
            role="dialog"
            aria-modal="true"
            aria-label="Live collaboration"
            className="clay-card relative w-full max-w-md rounded-[30px] z-10 overflow-hidden"
            /* Same warm-accent world as the sign-in / profile cards, scoped so
               the modal reads as part of that family instead of inheriting the
               canvas's (often dark) accent. */
            style={{
              color: 'var(--text-primary)',
              padding: '34px 32px 28px',
              ['--accent' as string]: '#D89A6E',
              ['--accent-rgb' as string]: '216, 154, 110',
              ['--accent-light' as string]: '#E9BE9B',
              ['--accent-subtle' as string]: 'rgba(216, 154, 110, 0.12)',
            }}
          >
            {/* soft accent bloom in the corner, like the sign-in card */}
            <div className="absolute -top-24 -right-20 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.14), transparent 65%)' }} />

            {/* close */}
            <button
              onClick={closeModal}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              style={{ background: 'var(--well)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Brand + header — centered, matching the sign-in card */}
            <div className="relative flex flex-col items-center text-center gap-3.5 mb-6">
              <div className="w-14 h-14 rounded-2xl clay-inset flex items-center justify-center text-[var(--accent)]" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-light tracking-tight leading-none text-[var(--text-tertiary)]" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  canvabrains
                </span>
                <h2 className="text-[26px] font-normal tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {connected ? 'You’re live' : 'Collaborate live'}
                </h2>
                <p className="text-[12px] text-[var(--text-tertiary)] font-normal leading-relaxed" style={{ maxWidth: 300 }}>
                  {connected ? 'Share the code and start building together.' : 'Edit this canvas together, in real time.'}
                </p>
              </div>
            </div>

            {connected ? (
              /* ------- Connected: show the code to share ------- */
              <div className="relative flex flex-col items-center text-center">
                <p className="text-[10px] uppercase font-extrabold tracking-[0.14em] text-[var(--text-muted)]">
                  Share this code
                </p>
                <button
                  onClick={copyCode}
                  className="mt-3 group flex items-center gap-3 clay-inset px-6 py-4 rounded-2xl cursor-pointer"
                  title="Copy code"
                >
                  <span className="text-3xl font-mono font-extrabold tracking-[0.3em] text-[var(--text-primary)] pl-2">
                    {code}
                  </span>
                  <span className="text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors">
                    {copied ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    )}
                  </span>
                </button>
                <p className="text-xs text-[var(--text-secondary)] mt-4 max-w-[19rem] leading-relaxed">
                  {transportKind === 'supabase' ? (
                    <>Anyone who enters this code joins your canvas from anywhere.</>
                  ) : (
                    <>
                      The realtime server is unreachable, so this session is live across your own
                      tabs &amp; windows on this device. Open this site in another tab and join with the
                      code to see it in action.
                    </>
                  )}
                </p>
                <button
                  onClick={closeModal}
                  className="mt-6 w-full py-3 rounded-full bg-[var(--accent)] text-white text-sm font-bold cursor-pointer shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 transition-all"
                >
                  Start collaborating
                </button>
              </div>
            ) : (
              /* ------- Not connected: host / join ------- */
              <div className="relative">
                <div className="clay-inset flex p-1 rounded-full" role="tablist" aria-label="Collaboration mode">
                  {(['host', 'join'] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={`relative flex-1 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                        tab === t ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      {tab === t && (
                        <motion.span layoutId="collab-tab-thumb" transition={spring} className="absolute inset-0 bg-white dark:bg-white/15 rounded-full shadow-[0_2px_6px_rgba(90,62,40,0.15),inset_0_1px_0_rgba(255,255,255,1)] dark:shadow-none" />
                      )}
                      <span className="relative">{t === 'host' ? 'Start a session' : 'Join with code'}</span>
                    </button>
                  ))}
                </div>

                {/* name field (shared) */}
                <div className="mt-5 flex flex-col gap-1.5">
                  <label htmlFor="collab-name" className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)] px-1">
                    Your name
                  </label>
                  <input
                    id="collab-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sanket"
                    maxLength={24}
                    className="w-full clay-inset rounded-2xl px-4 py-3 text-sm outline-none transition-shadow font-normal text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent)]/40"
                  />
                </div>

                {tab === 'host' ? (
                  <div className="mt-4">
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
                      You&apos;ll get a code to share. Everyone who joins sees your cursor and edits
                      instantly — and their work is tagged with their own colour.
                    </p>
                    <button
                      onClick={doHost}
                      disabled={busy}
                      className="w-full py-3 rounded-full bg-[var(--accent)] text-white text-sm font-bold cursor-pointer shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 transition-all disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2"
                    >
                      {busy ? 'Creating…' : 'Create session'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4">
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
                      You&apos;ll jump into their shared canvas — your own canvas stays untouched.
                      Select something and use &quot;Add to my canvas&quot; to bring it back with you.
                    </p>
                    <label htmlFor="collab-code" className="block text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--text-muted)] mb-1.5 px-1">
                      Invite code
                    </label>
                    <input
                      id="collab-code"
                      type="text"
                      value={joinCode}
                      onChange={(e) => {
                        setJoinCode(e.target.value.toUpperCase());
                        setJoinError(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && doJoin()}
                      placeholder="ABC123"
                      maxLength={8}
                      className="w-full clay-inset rounded-2xl px-4 py-3 text-lg font-mono font-bold tracking-[0.25em] text-center text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition-shadow uppercase placeholder:text-[var(--text-muted)]"
                    />
                    {joinError && <p className="text-[11px] text-red-500 mt-2 font-medium">{joinError}</p>}
                    <button
                      onClick={doJoin}
                      disabled={busy}
                      className="mt-4 w-full py-3 rounded-full bg-[var(--accent)] text-white text-sm font-bold cursor-pointer shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {busy ? 'Connecting…' : 'Join session'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
