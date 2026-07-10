'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CommentThread } from '@/lib/db';
import { screenToCanvas } from '@/lib/utils';

function authorName(): string {
  if (typeof window === 'undefined') return 'You';
  return localStorage.getItem('username') || 'You';
}

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Margins — threaded comments pinned anywhere in space. Pins hold a constant
 * screen size at any zoom; unresolved pins are always visible. Threads persist
 * with the canvas and a sidebar lists them with filters.
 */
export default function MarginsLayer() {
  const threads = useCanvasStore((s) => s.threads);
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const activeThreadId = useCanvasStore((s) => s.activeThreadId);
  const setActiveThreadId = useCanvasStore((s) => s.setActiveThreadId);
  const commentMode = useCanvasStore((s) => s.commentMode);
  const setCommentMode = useCanvasStore((s) => s.setCommentMode);
  const showSidebar = useCanvasStore((s) => s.threadsSidebarOpen);
  const addThread = useCanvasStore((s) => s.addThread);
  const addReply = useCanvasStore((s) => s.addReply);
  const resolveThread = useCanvasStore((s) => s.resolveThread);
  const deleteThread = useCanvasStore((s) => s.deleteThread);
  const animateCamera = useCanvasStore((s) => s.animateCamera);

  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'open'>('open');

  const anchorWorld = (t: CommentThread): { x: number; y: number } | null => {
    if (t.anchor.type === 'point') return { x: t.anchor.x, y: t.anchor.y };
    const objectId = t.anchor.objectId;
    const obj = objects.find((o) => o.id === objectId);
    if (!obj) return null;
    return { x: obj.x + obj.width, y: obj.y };
  };
  const toScreen = (w: { x: number; y: number }) => ({ x: w.x * camera.zoom + camera.x, y: w.y * camera.zoom + camera.y });

  const numbered = useMemo(() => [...threads].sort((a, b) => a.createdAt - b.createdAt), [threads]);

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  const placeDraft = (e: React.MouseEvent) => {
    const world = screenToCanvas(e.clientX, e.clientY, camera);
    setDraft(world);
    setDraftText('');
    setCommentMode(false);
    setActiveThreadId(null);
  };

  const submitDraft = () => {
    if (!draft || !draftText.trim()) { setDraft(null); return; }
    addThread({ type: 'point', x: draft.x, y: draft.y }, { author: authorName(), text: draftText.trim() });
    setDraft(null);
    setDraftText('');
  };

  const flyTo = (t: CommentThread) => {
    const w = anchorWorld(t);
    if (!w) return;
    animateCamera({ x: window.innerWidth / 2 - w.x, y: window.innerHeight / 2 - w.y, zoom: 1 }, 600);
    setActiveThreadId(t.id);
  };

  // Escape cancels comment placement / closes the open thread.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (draft) { setDraft(null); return; }
      if (commentMode) { setCommentMode(false); return; }
      if (activeThreadId) setActiveThreadId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, commentMode, activeThreadId, setCommentMode, setActiveThreadId]);

  return (
    <>
      {/* Comment-placement overlay */}
      {commentMode && (
        <div
          className="fixed inset-0 z-[145] pointer-events-auto"
          style={{ cursor: 'crosshair' }}
          onClick={placeDraft}
        >
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-bar rounded-full px-4 py-2 text-[11px] font-bold text-[var(--text-secondary)] pointer-events-none">
            Click anywhere to drop a thread · Esc to cancel
          </div>
        </div>
      )}

      {/* Pins */}
      <div className="fixed inset-0 z-[128] pointer-events-none">
        {numbered.map((t, i) => {
          const w = anchorWorld(t);
          if (!w) return null;
          if (t.resolved && activeThreadId !== t.id) return null; // resolved hidden unless open
          const p = toScreen(w);
          const color = t.resolved ? '#2F9E6E' : '#C97B4B';
          return (
            <button
              key={t.id}
              onClick={() => setActiveThreadId(activeThreadId === t.id ? null : t.id)}
              className="absolute pointer-events-auto -translate-y-full rounded-t-full rounded-br-full flex items-center justify-center text-[11px] font-extrabold text-white shadow-md transition-transform hover:scale-110 cursor-pointer"
              style={{ left: p.x, top: p.y, width: 26, height: 26, background: color, boxShadow: '0 3px 8px rgba(90,62,40,0.3)' }}
              title={`${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Draft popover */}
      {draft && (
        <ThreadPopover screen={toScreen(draft)} onClose={() => setDraft(null)}>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)]">New thread</span>
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDraft(); } if (e.key === 'Escape') setDraft(null); }}
              placeholder="Leave a note…"
              rows={3}
              className="w-full resize-none clay-inset rounded-xl px-4 py-2.5 text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-full text-[11px] font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer">Cancel</button>
              <button onClick={submitDraft} className="px-3.5 py-1.5 rounded-full text-[11px] font-bold text-white bg-[var(--accent)] hover:brightness-105 cursor-pointer">Post</button>
            </div>
          </div>
        </ThreadPopover>
      )}

      {/* Active thread popover */}
      {activeThread && (() => {
        const w = anchorWorld(activeThread);
        if (!w) return null;
        return (
          <ThreadPopover screen={toScreen(w)} onClose={() => setActiveThreadId(null)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-extrabold tracking-wider text-[var(--text-tertiary)]">
                Thread · {activeThread.replies.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => resolveThread(activeThread.id, !activeThread.resolved)}
                  title={activeThread.resolved ? 'Reopen' : 'Resolve'}
                  className={`w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-colors ${activeThread.resolved ? 'text-[#2F9E6E]' : 'text-[var(--text-tertiary)] hover:text-[#2F9E6E]'}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                </button>
                <button onClick={() => deleteThread(activeThread.id)} title="Delete thread" className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto pr-1">
              {activeThread.replies.map((r) => (
                <div key={r.id} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-bold text-[var(--text-primary)]">{r.author}</span>
                    <span className="text-[9px] text-[var(--text-muted)]">{timeAgo(r.ts)}</span>
                  </div>
                  <p className="text-[12px] text-[var(--text-secondary)] leading-snug whitespace-pre-wrap break-words">{r.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-[var(--border)]">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && replyText.trim()) { addReply(activeThread.id, { author: authorName(), text: replyText.trim() }); setReplyText(''); } }}
                placeholder="Reply…"
                className="flex-1 min-w-0 clay-inset rounded-full px-4 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
              />
              <button
                onClick={() => { if (replyText.trim()) { addReply(activeThread.id, { author: authorName(), text: replyText.trim() }); setReplyText(''); } }}
                className="w-8 h-8 shrink-0 rounded-full bg-[var(--accent)] text-white flex items-center justify-center hover:brightness-105 cursor-pointer"
                aria-label="Send reply"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </ThreadPopover>
        );
      })()}

      {/* Sidebar */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed right-20 top-28 z-[124] clay-card w-72 max-h-[70vh] rounded-[24px] p-4 flex flex-col gap-3 pointer-events-auto"
          >
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-[11px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-secondary)]">Threads</h3>
              <div className="clay-inset flex p-0.5 rounded-full text-[10px] font-bold">
                {(['open', 'all'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full cursor-pointer transition-colors ${filter === f ? 'bg-white dark:bg-white/15 text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'}`}>{f === 'open' ? 'Open' : 'All'}</button>
                ))}
              </div>
            </div>
            {numbered.filter((t) => filter === 'all' || !t.resolved).length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-6 leading-relaxed">No {filter === 'open' ? 'open ' : ''}threads yet. Hit the thread tool in the toolbar and click anywhere on the board.</p>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto min-h-0 pr-1">
                {numbered.map((t, i) => {
                  if (filter === 'open' && t.resolved) return null;
                  const first = t.replies[0];
                  return (
                    <button key={t.id} onClick={() => flyTo(t)} className="clay-inset rounded-xl p-2.5 text-left flex gap-2 hover:ring-1 hover:ring-[var(--accent)]/30 transition-all cursor-pointer">
                      <span className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white" style={{ background: t.resolved ? '#2F9E6E' : '#C97B4B' }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{first?.text || 'Empty'}</p>
                        <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5">{first?.author} · {t.replies.length} · {t.resolved ? 'resolved' : 'open'}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ThreadPopover({ screen, children, onClose }: { screen: { x: number; y: number }; children: React.ReactNode; onClose: () => void }) {
  // Keep the popover on-screen next to its pin.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const left = Math.min(Math.max(screen.x + 14, 12), vw - 284);
  const top = Math.min(Math.max(screen.y - 10, 12), (typeof window !== 'undefined' ? window.innerHeight : 900) - 260);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      className="fixed z-[146] clay-card w-[272px] rounded-[20px] p-3.5 pointer-events-auto"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors cursor-pointer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
      {children}
    </motion.div>
  );
}
