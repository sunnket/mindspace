'use client';

import React, { useEffect, useState } from 'react';
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
  const leave = useCollabStore((s) => s.leave);
  const isHost = useCollabStore((s) => s.isHost);
  const guestOriginView = useCollabStore((s) => s.guestOriginView);
  const addSelectionToOriginCanvas = useCollabStore((s) => s.addSelectionToOriginCanvas);
  const selectedId = useCanvasStore((s) => s.selectedId);

  // Voice call
  const audioActive = useCollabStore((s) => s.audioActive);
  const micMuted = useCollabStore((s) => s.micMuted);
  const audioError = useCollabStore((s) => s.audioError);
  const selfSpeaking = useCollabStore((s) => s.selfSpeaking);
  const callParticipants = useCollabStore((s) => s.callParticipants);
  const joinAudio = useCollabStore((s) => s.joinAudio);
  const leaveAudio = useCollabStore((s) => s.leaveAudio);
  const toggleMic = useCollabStore((s) => s.toggleMic);
  const mutePeer = useCollabStore((s) => s.mutePeer);
  const kickPeer = useCollabStore((s) => s.kickPeer);

  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [joining, setJoining] = useState(false);

  const peerList = Object.values(peers);
  const active = status === 'connected' || status === 'connecting';
  const amPresenting = !!me && presenter?.id === me.id;
  const inCallCount = Object.keys(callParticipants).length + (audioActive ? 1 : 0);

  useEffect(() => {
    if (!audioError) return;
    const t = setTimeout(() => useCollabStore.getState()._setAudioError(null), 4000);
    return () => clearTimeout(t);
  }, [audioError]);

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

  const handleJoinAudio = async () => {
    setJoining(true);
    try { await joinAudio(); } finally { setJoining(false); }
  };

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1600); },
      () => {}
    );
  };

  if (!active) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] pointer-events-none flex flex-col items-center gap-2">
      <AnimatePresence mode="wait">
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
              {copied ? <polyline points="20 6 9 17 4 12" /> : (<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>)}
            </svg>
          </button>

          {/* presence avatars (me + peers) — ring pulses while speaking */}
          <button
            onClick={() => setRosterOpen((v) => !v)}
            title="Participants"
            className="flex items-center -space-x-2 cursor-pointer"
          >
            {me && <Avatar name={me.name} color={me.color} you speaking={audioActive && selfSpeaking} muted={audioActive && micMuted} />}
            {peerList.map((p) => (
              <Avatar key={p.id} name={p.name} color={p.color} speaking={callParticipants[p.id]?.speaking} muted={callParticipants[p.id]?.muted} inCall={p.id in callParticipants} />
            ))}
          </button>

          <span className="text-[10px] font-bold text-[var(--text-tertiary)] tabular-nums shrink-0">
            {peerList.length > 0 ? `${peerList.length + 1} here` : 'waiting…'}
          </span>

          {/* --- voice call --- */}
          {!audioActive ? (
            <button
              onClick={handleJoinAudio}
              disabled={joining}
              title="Join the voice call"
              className="h-7 px-3 rounded-full flex items-center gap-1.5 text-[10px] font-bold shrink-0 transition-all cursor-pointer text-[var(--text-secondary)] hover:bg-white/60 disabled:opacity-60"
            >
              <PhoneIcon />
              {joining ? 'Joining…' : 'Call'}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              {/* mic mute toggle */}
              <button
                onClick={toggleMic}
                title={micMuted ? 'Unmute' : 'Mute'}
                aria-pressed={micMuted}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  micMuted ? 'bg-red-500 text-white' : selfSpeaking ? 'bg-[#30A46C] text-white' : 'clay-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {micMuted ? <MicOffIcon /> : <MicIcon />}
              </button>
              {/* in-call count → roster */}
              <button
                onClick={() => setRosterOpen((v) => !v)}
                title="In call"
                className="h-7 px-2.5 rounded-full flex items-center gap-1 text-[10px] font-bold text-[#217A54] bg-[#30A46C]/12 hover:bg-[#30A46C]/20 transition-colors cursor-pointer"
              >
                <PhoneIcon size={11} />
                {inCallCount}
              </button>
              {/* leave call (stays in the session) */}
              <button
                onClick={leaveAudio}
                title="Leave the call"
                className="w-7 h-7 rounded-full flex items-center justify-center bg-red-500 text-white hover:brightness-105 transition cursor-pointer"
              >
                <PhoneOffIcon />
              </button>
            </div>
          )}

          <span className="w-px h-5 bg-[var(--border)] shrink-0" />

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
                !selectedId ? 'text-[var(--text-muted)] cursor-not-allowed' : 'text-[var(--text-secondary)] hover:bg-white/60 cursor-pointer'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {added ? <polyline points="20 6 9 17 4 12" /> : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
              </svg>
              {added ? 'Added' : 'Add to my canvas'}
            </button>
          )}

          {/* leave session */}
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
      </AnimatePresence>

      {/* mic/permission error */}
      <AnimatePresence>
        {audioError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="pointer-events-auto glass-bar rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-red-500"
          >
            {audioError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* participants roster */}
      <AnimatePresence>
        {rosterOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={spring}
            className="pointer-events-auto clay-card rounded-[20px] w-[280px] overflow-hidden shadow-xl"
            style={{ padding: 8, background: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center justify-between" style={{ padding: '4px 8px 8px' }}>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-tertiary)]">
                Participants · {peerList.length + 1}
              </span>
              {isHost && <span className="text-[9px] font-bold text-[var(--accent)] uppercase tracking-wide">You’re the host</span>}
            </div>

            <div className="flex flex-col gap-0.5 max-h-[280px] overflow-y-auto">
              <RosterRow
                name={me?.name || 'You'}
                color={me?.color || '#888'}
                you
                inCall={audioActive}
                muted={micMuted}
                speaking={audioActive && selfSpeaking}
              />
              {peerList.map((p) => {
                const cp = callParticipants[p.id];
                return (
                  <RosterRow
                    key={p.id}
                    name={p.name}
                    color={p.color}
                    inCall={p.id in callParticipants}
                    muted={cp?.muted}
                    speaking={cp?.speaking}
                    canModerate={isHost}
                    onMute={() => mutePeer(p.id)}
                    onKick={() => kickPeer(p.id)}
                  />
                );
              })}
            </div>

            {!audioActive && (
              <button
                onClick={handleJoinAudio}
                disabled={joining}
                className="w-full mt-2 py-2 rounded-full bg-[#30A46C] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:brightness-105 transition disabled:opacity-60"
              >
                <PhoneIcon size={12} /> {joining ? 'Joining…' : 'Join voice call'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RosterRow({
  name, color, you = false, inCall = false, muted = false, speaking = false, canModerate = false, onMute, onKick,
}: {
  name: string; color: string; you?: boolean; inCall?: boolean; muted?: boolean; speaking?: boolean;
  canModerate?: boolean; onMute?: () => void; onKick?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2.5 rounded-xl hover:bg-white/50 dark:hover:bg-white/5 transition-colors" style={{ padding: '7px 8px' }}>
      <Avatar name={name} color={color} speaking={speaking} muted={muted} inCall={inCall} you={you} size={30} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate leading-tight">
          {name}{you && <span className="text-[var(--text-tertiary)] font-normal"> (you)</span>}
        </p>
        <p className="text-[9px] font-bold uppercase tracking-wide leading-tight" style={{ color: inCall ? (speaking ? '#30A46C' : 'var(--text-tertiary)') : 'var(--text-muted)' }}>
          {inCall ? (muted ? 'Muted' : speaking ? 'Speaking' : 'In call') : 'Not in call'}
        </p>
      </div>
      {inCall && (muted ? <MicOffIcon size={13} className="text-red-500 shrink-0" /> : <MicIcon size={13} className="text-[var(--text-tertiary)] shrink-0" />)}
      {canModerate && !you && (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {inCall && !muted && (
            <button onClick={onMute} title="Mute this person" className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-white hover:bg-[var(--accent)] transition cursor-pointer">
              <MicOffIcon size={12} />
            </button>
          )}
          <button onClick={onKick} title="Remove from session" className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-white hover:bg-red-500 transition cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, color, you = false, speaking = false, muted = false, inCall = false, size = 28 }: {
  name: string; color: string; you?: boolean; speaking?: boolean; muted?: boolean; inCall?: boolean; size?: number;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        title={you ? `${name} (you)` : name}
        className="w-full h-full rounded-full flex items-center justify-center text-[9px] font-extrabold text-white select-none transition-shadow"
        style={{
          background: color,
          boxShadow: speaking
            ? '0 0 0 2px #fff, 0 0 0 4px #30A46C'
            : '0 0 0 2px #fff',
        }}
      >
        {initialsOf(name)}
      </div>
      {inCall && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ring-2 ring-white"
          style={{ background: muted ? '#EF4444' : '#30A46C' }}
        >
          {muted
            ? <MicOffIcon size={7} className="text-white" />
            : <MicIcon size={7} className="text-white" />}
        </span>
      )}
    </div>
  );
}

/* ------------------------------- icons ------------------------------- */

function MicIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
function MicOffIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="2" y1="2" x2="22" y2="22" /><path d="M9 9v1a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" /><path d="M17 10v1a5 5 0 0 1-.54 2.27M19 10v1a7 7 0 0 1-.11 1.23" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
function PhoneIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.94.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.87.35 1.81.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function PhoneOffIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
