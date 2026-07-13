'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas } from '@/lib/utils';
import { ingestFile } from '@/lib/fileIngest';
import AuthModal from '@/components/ui/AuthModal';
import { ChatAttachment, ChatMessage, MAX_ATTACHMENT_BYTES, getAttachmentUrl } from '@/lib/chat/service';

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const sendAttachment = useChatStore((s) => s.sendAttachment);
  const sendCanvasObjectAttachment = useChatStore((s) => s.sendCanvasObjectAttachment);
  const pendingCanvasDrop = useChatStore((s) => s.pendingCanvasDrop);
  const setPendingCanvasDrop = useChatStore((s) => s.setPendingCanvasDrop);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [draft, setDraft] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const completePendingDrop = async (roomId: string) => {
    if (!pendingCanvasDrop) return;
    const drop = pendingCanvasDrop;
    setPendingCanvasDrop(null);
    try {
      await sendCanvasObjectAttachment(roomId, userId, drop.snapshot, drop.label);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not send — try again.');
      setTimeout(() => setAttachError(null), 4000);
    }
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again later
    if (!file || !activeRoomId) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`"${file.name}" is too large — max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB.`);
      setTimeout(() => setAttachError(null), 4000);
      return;
    }
    try {
      await sendAttachment(activeRoomId, userId, file);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Upload failed — try again.');
      setTimeout(() => setAttachError(null), 4000);
    }
  };

  const showThread = mode === 'embedded' || !!activeRoomId;
  const showList = mode === 'embedded' || !activeRoomId;

  return (
    <ChatShell mode={mode} title={activeRoom ? activeRoom.otherUsername : 'Chat'} onClose={onClose} onBack={mode === 'overlay' && activeRoomId ? () => setActiveRoom(null) : undefined}>
      <div className={`flex-1 min-h-0 flex ${mode === 'embedded' ? 'flex-row' : 'flex-col'}`}>
        {showList && (
          <div className={`flex flex-col min-h-0 ${mode === 'embedded' ? 'w-64 shrink-0 border-r border-[var(--border)]' : 'flex-1'}`}>
            {pendingCanvasDrop && (
              <div className="mx-3 mt-3 p-2.5 rounded-xl clay-inset flex items-center gap-2 shrink-0">
                <span className="text-[16px] shrink-0">📦</span>
                <p className="text-[10px] font-semibold text-[var(--text-secondary)] leading-snug flex-1 min-w-0">
                  Sending <span className="text-[var(--text-primary)]">&quot;{pendingCanvasDrop.label}&quot;</span> — pick who to send it to.
                </p>
                <button
                  onClick={() => setPendingCanvasDrop(null)}
                  aria-label="Cancel"
                  className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            )}
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
                        const roomId = await startDm(userId, r.id, r.username);
                        await completePendingDrop(roomId);
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
                      onClick={async () => {
                        await setActiveRoom(r.id);
                        await completePendingDrop(r.id);
                      }}
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
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} mine={m.senderId === userId} mode={mode} />
                  ))}
                </div>
                {attachError && (
                  <p className="px-3 pb-1 text-[10px] font-semibold text-red-500 shrink-0">{attachError}</p>
                )}
                <div className="flex items-center gap-1.5 p-3 pt-2 border-t border-[var(--border)] shrink-0">
                  <input ref={fileInputRef} type="file" onChange={onFileChosen} className="hidden" />
                  <button
                    onClick={pickFile}
                    title="Attach a file, image or video"
                    className="w-9 h-9 shrink-0 rounded-full text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--well)] flex items-center justify-center cursor-pointer transition-colors"
                    aria-label="Attach file"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
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

function MessageBubble({ message, mine, mode }: { message: ChatMessage; mine: boolean; mode: 'overlay' | 'embedded' }) {
  const attachments = message.attachments || [];
  return (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      {attachments.map((att, i) => (
        <AttachmentBubble key={i} attachment={att} mine={mine} mode={mode} />
      ))}
      {message.body && (
        <div
          className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-[12px] leading-snug break-words ${
            mine ? 'bg-[var(--accent)] text-white' : 'clay-inset text-[var(--text-primary)]'
          }`}
        >
          {message.body}
        </div>
      )}
    </div>
  );
}

/** Downloads a private attachment and drops it onto the currently-open canvas.
 *
 * `at` is where the user let go, in SCREEN coordinates; without one it lands in
 * the middle of the view (the click-to-add path). Only meaningful in overlay
 * mode, where a canvas is actually behind the panel. */
async function addAttachmentToCanvas(
  attachment: ChatAttachment,
  url: string | null,
  at?: { x: number; y: number },
) {
  const camera = useCanvasStore.getState().camera;
  const center = screenToCanvas(
    at?.x ?? window.innerWidth / 2,
    at?.y ?? window.innerHeight / 2,
    camera,
  );
  if (attachment.kind === 'canvas-object' && attachment.snapshot) {
    useCanvasStore.getState().addObject({
      ...attachment.snapshot,
      x: center.x - attachment.snapshot.width / 2,
      y: center.y - attachment.snapshot.height / 2,
    });
    return;
  }
  if (!url) return;
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const file = new File([blob], attachment.name, { type: attachment.mime });
    ingestFile(file, center.x - 150, center.y - 100);
  } catch (err) {
    console.error('[chat] add attachment to canvas failed:', err);
  }
}

/**
 * Drag an attachment out of the chat and drop it exactly where you want it.
 *
 * Clicking still works and still lands it in the middle of the view — that path
 * is unchanged. This adds the one everybody reaches for first: pick the thing
 * up, carry it out over the board, let go. A ghost follows the cursor so you can
 * see where it's going to land, and letting go back inside the panel cancels.
 *
 * Pointer events, not HTML5 drag-and-drop: the canvas's own onDrop is built for
 * files and URLs coming in from outside the app, and teaching it a second,
 * in-app protocol would mean two ways to describe the same drop.
 */
function useDragToCanvas(label: string, onDrop: (at: { x: number; y: number }) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    movedRef.current = false;

    let ghost: HTMLDivElement | null = null;

    const move = (ev: PointerEvent) => {
      if (!movedRef.current) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        movedRef.current = true;
        setDragging(true);

        ghost = document.createElement('div');
        ghost.textContent = label;
        ghost.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;padding:7px 13px;border-radius:999px;' +
          'font:600 11px/1 Outfit,sans-serif;color:#fff;background:var(--accent);' +
          'box-shadow:0 12px 28px -10px rgba(0,0,0,0.55);transform:translate(-50%,-50%) scale(0.9);' +
          'opacity:0;transition:opacity 120ms ease, transform 120ms ease;white-space:nowrap;max-width:220px;' +
          'overflow:hidden;text-overflow:ellipsis;';
        document.body.appendChild(ghost);
        requestAnimationFrame(() => {
          if (!ghost) return;
          ghost.style.opacity = '1';
          ghost.style.transform = 'translate(-50%,-50%) scale(1)';
        });
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost?.remove();
      ghost = null;
      setDragging(false);

      if (!movedRef.current) return; // a plain click — onClick still handles it

      // Let go back over the chat and nothing happens: that's the cancel gesture.
      const panel = document.getElementById('chat-panel-container');
      const r = panel?.getBoundingClientRect();
      const overPanel =
        !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (overPanel) return;

      onDrop({ x: ev.clientX, y: ev.clientY });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Swallow the click that a browser fires after a drag's pointerup. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (movedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
    }
  };

  return { onPointerDown, onClickCapture, dragging };
}

function AddToCanvasButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title="Add to canvas"
      aria-label="Add to canvas"
      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 hover:bg-black/70 text-white flex items-center justify-center cursor-pointer transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    </button>
  );
}

function AttachmentBubble({ attachment, mine, mode }: { attachment: ChatAttachment; mine: boolean; mode: 'overlay' | 'embedded' }) {
  const isCanvasObject = attachment.kind === 'canvas-object';
  const uploading = attachment.path === '' && !isCanvasObject;
  const [url, setUrl] = useState<string | null>(null);
  const canAddToCanvas = mode === 'overlay';

  useEffect(() => {
    if (uploading || isCanvasObject) return;
    let cancelled = false;
    getAttachmentUrl(attachment.path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [attachment.path, uploading, isCanvasObject]);

  // Tap → centre of the view. Drag → wherever you let go.
  const drag = useDragToCanvas(
    attachment.name,
    (at) => addAttachmentToCanvas(attachment, url, at),
    canAddToCanvas && !uploading,
  );
  const dragProps = canAddToCanvas
    ? { onPointerDown: drag.onPointerDown, onClickCapture: drag.onClickCapture }
    : {};
  const dragClass = drag.dragging ? 'opacity-40' : '';
  const hint = canAddToCanvas ? 'Tap or drag onto the canvas' : 'Open a canvas to add this';

  if (uploading) {
    return (
      <div className={`w-40 h-28 rounded-2xl flex items-center justify-center text-[10px] font-semibold ${mine ? 'bg-[var(--accent)]/60 text-white' : 'clay-inset text-[var(--text-tertiary)]'}`}>
        Uploading…
      </div>
    );
  }

  if (isCanvasObject) {
    const body = (
      <>
        <span className="text-[18px] shrink-0">📦</span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold truncate">{attachment.name}</p>
          <p className={`text-[9px] ${mine ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>{hint}</p>
        </div>
      </>
    );
    const className = `flex items-center gap-2 px-3 py-2 rounded-2xl max-w-[220px] transition-opacity ${mine ? 'bg-[var(--accent)] text-white' : 'clay-inset text-[var(--text-primary)]'} ${canAddToCanvas ? 'cursor-grab active:cursor-grabbing hover:brightness-95' : ''} ${dragClass}`;
    return canAddToCanvas ? (
      <button {...dragProps} onClick={() => addAttachmentToCanvas(attachment, null)} className={className}>{body}</button>
    ) : (
      <div className={className}>{body}</div>
    );
  }

  if (attachment.kind === 'image') {
    return url ? (
      <div
        {...dragProps}
        // A drag ends in a click, which the capture handler above swallows — so
        // this only opens the picture when you actually clicked it.
        onClick={() => window.open(url, '_blank', 'noopener')}
        className={`relative block max-w-[220px] rounded-2xl overflow-hidden transition-opacity ${canAddToCanvas ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${dragClass}`}
        title={hint}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={attachment.name} className="w-full h-auto object-cover" draggable={false} />
        {canAddToCanvas && <AddToCanvasButton onClick={() => addAttachmentToCanvas(attachment, url)} />}
      </div>
    ) : (
      <div className="w-40 h-28 rounded-2xl clay-inset animate-pulse" />
    );
  }

  if (attachment.kind === 'video') {
    return url ? (
      <div className={`relative max-w-[240px] transition-opacity ${dragClass}`}>
        <video src={url} controls className="w-full rounded-2xl" />
        {canAddToCanvas && (
          // The player owns its own clicks, so the drag handle is the badge.
          <span {...dragProps} className="absolute inset-x-0 top-0 h-8 cursor-grab active:cursor-grabbing" title={hint} />
        )}
        {canAddToCanvas && <AddToCanvasButton onClick={() => addAttachmentToCanvas(attachment, url)} />}
      </div>
    ) : (
      <div className="w-40 h-28 rounded-2xl clay-inset animate-pulse" />
    );
  }

  return (
    <div className={`relative max-w-[220px] transition-opacity ${dragClass}`}>
      <div
        {...dragProps}
        title={hint}
        className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${mine ? 'bg-[var(--accent)] text-white' : 'clay-inset text-[var(--text-primary)]'} ${canAddToCanvas ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold truncate">{attachment.name}</p>
          <p className={`text-[9px] ${mine ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>{formatBytes(attachment.size)}</p>
        </div>
      </div>
      {canAddToCanvas && (
        <button
          onClick={() => addAttachmentToCanvas(attachment, url)}
          title="Add to canvas"
          aria-label="Add to canvas"
          className={`absolute top-1/2 -translate-y-1/2 right-2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-colors ${mine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-black/10 hover:bg-black/20 text-[var(--text-primary)]'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      )}
    </div>
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
        id="chat-panel-container"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed right-5 top-44 z-[150] clay-card w-80 h-[70vh] max-h-[560px] rounded-[24px] flex flex-col overflow-hidden pointer-events-auto"
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
