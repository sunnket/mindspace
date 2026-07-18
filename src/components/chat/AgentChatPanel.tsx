'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentChatStore } from '@/store/agentChatStore';
import { useCanvasStore } from '@/store/canvasStore';
import RichText from '@/components/canvas/RichText';
import type { AgentChatMessage } from '@/lib/agentChat/service';
import type { CanvasObjectSnapshot } from '@/lib/chat/service';

/* A stable empty array — returning a fresh `[]` from a zustand selector makes
   useSyncExternalStore think the store changed every render (infinite loop /
   "Maximum update depth exceeded"). Select the raw value, default OUTSIDE. */
const EMPTY_MESSAGES: AgentChatMessage[] = [];

/* Inline padding/margins throughout: the app's unlayered global reset kills
   Tailwind's spacing utilities, so those p- and m- classes do nothing here. */

const Spark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

function currentCanvasId(): string {
  const s = useCanvasStore.getState();
  const stack = s.canvasStack;
  return stack.length > 0 ? stack[stack.length - 1] : (s.urlCanvasId || 'root');
}

const EXAMPLES = [
  'Research the pros & cons of RSC and write it up here',
  'Build me a 2-week launch plan as a timeline',
  'Explain how JWT auth works, with a diagram',
  'Turn my sticky notes into a tidy mind map',
];

export default function AgentChatPanel() {
  const panelOpen = useAgentChatStore((s) => s.panelOpen);
  const maximized = useAgentChatStore((s) => s.maximized);
  const width = useAgentChatStore((s) => s.width);
  const streaming = useAgentChatStore((s) => s.streaming);
  const pending = useAgentChatStore((s) => s.pending);
  const canvasId = useAgentChatStore((s) => s.canvasId);
  const messages = useAgentChatStore((s) => s.messagesByCanvas[s.canvasId]) ?? EMPTY_MESSAGES;
  const loading = useAgentChatStore((s) => s.loadingByCanvas[s.canvasId]);

  const open = useAgentChatStore((s) => s.open);
  const close = useAgentChatStore((s) => s.close);
  const toggle = useAgentChatStore((s) => s.toggle);
  const setMaximized = useAgentChatStore((s) => s.setMaximized);
  const setWidth = useAgentChatStore((s) => s.setWidth);
  const syncCanvas = useAgentChatStore((s) => s.syncCanvas);
  const addFiles = useAgentChatStore((s) => s.addFiles);
  const addBlockContext = useAgentChatStore((s) => s.addBlockContext);
  const removePending = useAgentChatStore((s) => s.removePending);
  const send = useAgentChatStore((s) => s.send);
  const stop = useAgentChatStore((s) => s.stop);
  const clear = useAgentChatStore((s) => s.clear);

  // Follow the active canvas / binder sub-space so each board has its own thread.
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const canvasStackLen = useCanvasStore((s) => s.canvasStack.length);
  useEffect(() => {
    if (panelOpen) void syncCanvas(currentCanvasId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, urlCanvasId, canvasStackLen]);

  const [draft, setDraft] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Keep the native (preventDefault) canvas wheel-zoom from firing while the
  // pointer is over the panel — stop the event before it reaches the canvas.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { passive: true });
    return () => el.removeEventListener('wheel', stopWheel);
  }, [panelOpen]);

  // Autoscroll to the newest message / streaming tokens.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, panelOpen]);

  // A canvas block dragged onto the panel (dispatched by CanvasObject).
  useEffect(() => {
    const onAddBlock = (e: Event) => {
      const d = (e as CustomEvent<{ snapshot: CanvasObjectSnapshot; label: string }>).detail;
      if (!d) return;
      const snap = d.snapshot;
      let text = snap.content || '';
      const s = snap.style || {};
      if (s.isRepo) text = `[code repo: ${(s.repoName as string) || 'repo'}]`;
      else if (!text && s.isTodo) text = `[todo widget: ${(s.todoTitle as string) || 'tasks'}]`;
      addBlockContext(d.label || snap.type, text);
    };
    window.addEventListener('agent-chat-add-block', onAddBlock as EventListener);
    return () => window.removeEventListener('agent-chat-add-block', onAddBlock as EventListener);
  }, [addBlockContext]);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  };

  const submit = () => {
    if (streaming) return;
    const t = draft.trim();
    if (!t && pending.length === 0) return;
    void send(t);
    setDraft('');
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto'; });
  };

  const onFileInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length) void addFiles(files);
    };
    input.click();
  };

  const addToCanvas = useCallback((content: string) => {
    const store = useCanvasStore.getState();
    const cam = store.camera;
    const x = (-cam.x + window.innerWidth / 2) / cam.zoom - 210;
    const y = (-cam.y + window.innerHeight / 2) / cam.zoom - 80;
    store.addObject({ type: 'text', x, y, width: 420, height: 160, content });
  }, []);

  // Width resize by dragging the panel's left edge.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const onMove = (me: MouseEvent) => setWidth(window.innerWidth - me.clientX - 16);
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  const stopMouse = (e: React.MouseEvent) => e.stopPropagation();
  const panelWidth = maximized ? Math.min(880, window.innerWidth - 40) : width;

  return (
    <>
      {/* Corner launcher (top-right — where the DM chat used to live). Hidden
          while the panel is open, which has its own close button. */}
      {!panelOpen && (
        <div className="fixed right-5 top-28 z-[125] pointer-events-auto">
          <motion.button
            onClick={toggle}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="AI Agent chat"
            className="clay-card w-11 h-11 rounded-2xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer relative"
          >
            <Spark size={19} />
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--accent)] border-2 border-[var(--bg-primary)]" />
          </motion.button>
        </div>
      )}

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            id="agent-chat-panel"
            ref={rootRef}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            onMouseDown={stopMouse}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDragOver(false);
              const files = e.dataTransfer?.files;
              if (files && files.length) void addFiles(files);
            }}
            className="fixed z-[160] flex flex-col pointer-events-auto clay-card"
            style={{
              top: 76, right: 16, bottom: 16, width: panelWidth,
              borderRadius: 20,
              overflow: 'hidden',
            }}
          >
            {/* Left-edge resize handle */}
            <div
              onMouseDown={startResize}
              title="Drag to resize"
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', zIndex: 5 }}
            />

            {/* Header */}
            <div className="flex items-center gap-2 shrink-0" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 30, height: 30, background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                <Spark size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-[var(--text-primary)] leading-tight">AI Agent</div>
                <div className="text-[10.5px] text-[var(--text-tertiary)] leading-tight">Chats + builds on this canvas · remembers here</div>
              </div>
              <button onClick={() => clear()} title="Clear this conversation" className="flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" style={{ width: 30, height: 30, background: 'var(--well)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
              </button>
              <button onClick={() => setMaximized(!maximized)} title={maximized ? 'Restore width' : 'Widen'} className="flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" style={{ width: 30, height: 30, background: 'var(--well)' }}>
                {maximized
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 3 3 3 3 9" /><polyline points="15 21 21 21 21 15" /><line x1="3" y1="3" x2="10" y2="10" /><line x1="21" y1="21" x2="14" y2="14" /></svg>}
              </button>
              <button onClick={close} title="Close" className="flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" style={{ width: 30, height: 30, background: 'var(--well)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" style={{ padding: '16px 14px' }}>
              {loading ? (
                <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-[12px]">Loading conversation…</div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-4" style={{ padding: 12 }}>
                  <span className="flex items-center justify-center rounded-2xl" style={{ width: 52, height: 52, background: 'var(--accent-subtle)', color: 'var(--accent)' }}><Spark size={24} /></span>
                  <div>
                    <div className="text-[15px] font-bold text-[var(--text-primary)]">Ask me anything</div>
                    <div className="text-[12px] text-[var(--text-tertiary)]" style={{ marginTop: 4, maxWidth: 280, lineHeight: 1.5 }}>
                      I can research, explain, write code, and build it straight onto your canvas. Drop files in to have me read them.
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 w-full" style={{ maxWidth: 320 }}>
                    {EXAMPLES.map((ex) => (
                      <button key={ex} onClick={() => { setDraft(ex); taRef.current?.focus(); }} className="text-left rounded-xl text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" style={{ padding: '9px 12px', background: 'var(--well)', border: '1px solid var(--border)' }}>
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 6, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                          {m.attachments.map((a, i) => (
                            <span key={i} className="flex items-center gap-1 rounded-lg text-[10.5px] font-semibold text-[var(--text-secondary)]" style={{ padding: '3px 8px', background: 'var(--well)', border: '1px solid var(--border)' }}>
                              {a.kind === 'block' ? '▦' : a.kind === 'image' ? '🖼' : '📎'} {a.name.slice(0, 28)}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.role === 'user' ? (
                        <div className="rounded-2xl text-[13px] whitespace-pre-wrap break-words" style={{ padding: '10px 13px', maxWidth: '86%', background: 'var(--accent)', color: '#fff', borderBottomRightRadius: 6 }}>
                          {m.content}
                        </div>
                      ) : (
                        <div className="rounded-2xl text-[13px] w-full agent-msg" style={{ padding: '11px 14px', background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderBottomLeftRadius: 6 }}>
                          {m.content
                            ? <div className="agent-md" style={{ fontSize: 13, lineHeight: 1.6 }}><RichText content={m.content} /></div>
                            : <span className="inline-flex gap-1 items-center text-[var(--text-tertiary)]"><Dot /><Dot d={0.15} /><Dot d={0.3} /></span>}
                          {m.built && (
                            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold" style={{ marginTop: 8, color: 'var(--accent)' }}>
                              <Spark size={12} /> Building this on your canvas…
                            </div>
                          )}
                          {!m.streaming && m.content && (
                            <div className="flex items-center gap-2 opacity-0 agent-msg-actions transition-opacity" style={{ marginTop: 8 }}>
                              <button onClick={() => addToCanvas(m.content)} title="Add this to the canvas" className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--accent)] cursor-pointer">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add to canvas
                              </button>
                              <button onClick={() => navigator.clipboard?.writeText(m.content)} title="Copy" className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg> Copy
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending attachments */}
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5 shrink-0" style={{ padding: '8px 12px 0' }}>
                {pending.map((p) => (
                  <span key={p.id} className="flex items-center gap-1.5 rounded-lg text-[11px] font-semibold text-[var(--text-secondary)]" style={{ padding: '4px 6px 4px 9px', background: 'var(--well)', border: '1px solid var(--border)' }}>
                    {p.kind === 'block' ? '▦' : p.kind === 'image' ? '🖼' : '📎'} {p.name.slice(0, 24)}
                    <button onClick={() => removePending(p.id)} className="flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer" style={{ width: 16, height: 16 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="shrink-0" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
              <div className="flex items-end gap-2 rounded-2xl" style={{ padding: 6, background: 'var(--well)', border: `1px solid ${dragOver ? 'var(--accent)' : 'var(--border)'}` }}>
                <button onClick={onFileInput} title="Attach a file" className="flex items-center justify-center rounded-xl text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer shrink-0" style={{ width: 34, height: 34 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                </button>
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); autoGrow(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                  placeholder="Ask, or tell me to build something…"
                  rows={1}
                  className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                  style={{ padding: '8px 2px', maxHeight: 160, lineHeight: 1.5 }}
                />
                {streaming ? (
                  <button onClick={stop} title="Stop" className="flex items-center justify-center rounded-xl text-white shrink-0 cursor-pointer" style={{ width: 34, height: 34, background: 'var(--accent)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
                  </button>
                ) : (
                  <button onClick={submit} disabled={!draft.trim() && pending.length === 0} title="Send" className="flex items-center justify-center rounded-xl text-white shrink-0 cursor-pointer disabled:opacity-40 active:scale-95 transition-transform" style={{ width: 34, height: 34, background: 'var(--accent)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="text-center text-[10px] text-[var(--text-tertiary)]" style={{ marginTop: 6 }}>
                Enter to send · Shift+Enter for a new line · drop files to attach
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return (
    <motion.span
      style={{ width: 5, height: 5, borderRadius: 99, background: 'currentColor', display: 'inline-block' }}
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 1, repeat: Infinity, delay: d }}
    />
  );
}
