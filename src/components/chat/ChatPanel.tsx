'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import AuthModal from '@/components/ui/AuthModal';

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function ChatPanel({ mode, onClose }: { mode: 'overlay' | 'embedded'; onClose?: () => void }) {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <SignInGate mode={mode} onClose={onClose} />;
  }
  return <SignedInChat mode={mode} onClose={onClose} userId={user.id} />;
}

function SignInGate({ mode, onClose }: { mode: 'overlay' | 'embedded'; onClose?: () => void }) {
  const [authOpen, setAuthOpen] = useState(false);
  const body = (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--well)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)]" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p className="text-[13px] font-bold text-[var(--text-primary)]">Sign in to chat</p>
      <p className="text-[11px] text-[var(--text-tertiary)] max-w-[220px] leading-relaxed">
        Chat is only available to signed-in users, and messages are saved to your account.
      </p>
      <button
        onClick={() => setAuthOpen(true)}
        className="mt-1 h-8 px-4 rounded-full text-[12px] font-bold text-white bg-[var(--accent)] hover:brightness-105 cursor-pointer"
      >
        Sign in
      </button>
    </div>
  );

  return (
    <ChatShell mode={mode} title="Chat" onClose={onClose}>
      {body}
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} initialMode="signin" />
    </ChatShell>
  );
}

function SignedInChat({ mode, onClose, userId }: { mode: 'overlay' | 'embedded'; onClose?: () => void; userId: string }) {
  const rooms = useChatStore((s) => s.rooms);
  const roomsLoading = useChatStore((s) => s.roomsLoading);
  const activeRoomId = useChatStore((s) => s.activeRoomId);
  const messagesByRoom = useChatStore((s) => s.messagesByRoom);
  const searchResults = useChatStore((s) => s.searchResults);
  const searchLoading = useChatStore((s) => s.searchLoading);
  const loadRooms = useChatStore((s) => s.loadRooms);
  const searchUsers = useChatStore((s) => s.searchUsers);
  const startDm = useChatStore((s) => s.startDm);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRooms(userId);
  }, [userId, loadRooms]);

  useEffect(() => {
    searchUsers(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);
  const messages = activeRoomId ? messagesByRoom[activeRoomId] || [] : [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const send = () => {
    if (!activeRoomId || !draft.trim()) return;
    sendMessage(activeRoomId, userId, draft);
    setDraft('');
  };

  const showThread = mode === 'embedded' || !!activeRoomId;
  const showList = mode === 'embedded' || !activeRoomId;

  return (
    <ChatShell mode={mode} title={activeRoom ? activeRoom.otherUsername : 'Chat'} onClose={onClose} onBack={mode === 'overlay' && activeRoomId ? () => setActiveRoom(null) : undefined}>
      <div className={`flex-1 min-h-0 flex ${mode === 'embedded' ? 'flex-row' : 'flex-col'}`}>
        {showList && (
          <div className={`flex flex-col min-h-0 ${mode === 'embedded' ? 'w-64 shrink-0 border-r border-[var(--border)]' : 'flex-1'}`}>
            <div className="p-3 shrink-0">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search username or email…"
                className="w-full clay-inset rounded-full px-3.5 py-2 text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
              />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
              {query.trim() && (
                <div className="mb-2">
                  <p className="px-2 py-1 text-[9px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)]">
                    {searchLoading ? 'Searching…' : 'People'}
                  </p>
                  {searchResults.length === 0 && !searchLoading && (
                    <p className="px-2 py-2 text-[11px] text-[var(--text-tertiary)]">No matches.</p>
                  )}
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={async () => {
                        setQuery('');
                        await startDm(userId, r.id, r.username);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-xl text-left hover:bg-[var(--well)] transition-colors cursor-pointer"
                    >
                      <Avatar name={r.username} />
                      <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{r.username}</span>
                    </button>
                  ))}
                </div>
              )}

              {!query.trim() && (
                <>
                  {roomsLoading && <p className="px-2 py-2 text-[11px] text-[var(--text-tertiary)]">Loading…</p>}
                  {!roomsLoading && rooms.length === 0 && (
                    <p className="px-2 py-6 text-[11px] text-[var(--text-tertiary)] text-center leading-relaxed">
                      No conversations yet. Search a username above to start one.
                    </p>
                  )}
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setActiveRoom(r.id)}
                      className={`w-full flex items-center gap-2 px-2 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                        activeRoomId === r.id ? 'bg-[var(--well)]' : 'hover:bg-[var(--well)]'
                      }`}
                    >
                      <Avatar name={r.otherUsername} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{r.otherUsername}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">{r.lastMessagePreview || 'Say hi 👋'}</p>
                      </div>
                      {r.lastMessageAt && (
                        <span className="text-[9px] text-[var(--text-muted)] shrink-0">{timeAgo(r.lastMessageAt)}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {showThread && (
          <div className="flex-1 min-h-0 flex flex-col">
            {!activeRoomId ? (
              <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--text-tertiary)]">
                Select a conversation
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-3 py-3 flex flex-col gap-2">
                  {messages.map((m) => {
                    const mine = m.senderId === userId;
                    return (
                      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-[12px] leading-snug break-words ${
                            mine ? 'bg-[var(--accent)] text-white' : 'clay-inset text-[var(--text-primary)]'
                          }`}
                        >
                          {m.body}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 p-3 pt-2 border-t border-[var(--border)] shrink-0">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Message…"
                    className="flex-1 min-w-0 clay-inset rounded-full px-4 py-2 text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim()}
                    className="w-9 h-9 shrink-0 rounded-full bg-[var(--accent)] text-white flex items-center justify-center hover:brightness-105 disabled:opacity-40 cursor-pointer"
                    aria-label="Send"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </ChatShell>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white select-none" style={{ background: '#C97B4B' }}>
      {initials}
    </div>
  );
}

function ChatShell({
  mode, title, onClose, onBack, children,
}: {
  mode: 'overlay' | 'embedded';
  title: string;
  onClose?: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  if (mode === 'embedded') {
    return (
      <div className="flex-1 min-h-0 flex flex-col clay-card rounded-[24px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h2 className="text-[13px] font-extrabold text-[var(--text-primary)]">{title}</h2>
        </div>
        {children}
      </div>
    );
  }
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed right-5 top-44 z-[126] clay-card w-80 h-[70vh] max-h-[560px] rounded-[24px] flex flex-col overflow-hidden pointer-events-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {onBack && (
              <button onClick={onBack} aria-label="Back" className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            <h2 className="text-[13px] font-extrabold text-[var(--text-primary)] truncate">{title}</h2>
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
