'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useChatStore, useChatUnreadTotal } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { CanvasObjectSnapshot } from '@/lib/chat/service';
import ChatPanel from './ChatPanel';

export default function ChatLauncher() {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const closePanel = useChatStore((s) => s.closePanel);
  const unread = useChatUnreadTotal();

  // A canvas object dropped on the "send to chat" hotzone (CanvasObject.tsx)
  // lands here: if a conversation is already open, send it straight there;
  // otherwise open the panel and let ChatPanel's pending-drop banner ask who.
  useEffect(() => {
    const onOpenChatSend = (e: Event) => {
      const detail = (e as CustomEvent<{ snapshot: CanvasObjectSnapshot; label: string }>).detail;
      if (!detail) return;
      const chat = useChatStore.getState();
      const user = useAuthStore.getState().user;
      if (user && chat.panelOpen && chat.activeRoomId) {
        chat.sendCanvasObjectAttachment(chat.activeRoomId, user.id, detail.snapshot, detail.label)
          .catch((err) => console.error('[chat] send canvas object failed:', err));
        return;
      }
      chat.setPendingCanvasDrop(detail);
      chat.openPanel();
    };
    window.addEventListener('open-chat-send', onOpenChatSend as EventListener);
    return () => window.removeEventListener('open-chat-send', onOpenChatSend as EventListener);
  }, []);

  return (
    <>
      <div className="fixed right-5 top-28 z-[125] pointer-events-auto">
        <motion.button
          onClick={() => (panelOpen ? closePanel() : openPanel())}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Chat"
          className={`clay-card w-11 h-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer relative ${panelOpen ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'}`}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <defs>
              <mask id="chat-double-bubble-mask">
                <rect x="0" y="0" width="24" height="24" fill="white" />
                <path 
                  d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" 
                  transform="translate(1.5, 5) scale(0.68)" 
                  fill="black" 
                  stroke="black" 
                  strokeWidth="3.5" 
                />
              </mask>
            </defs>
            <path 
              d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" 
              transform="translate(22.5, 1.5) scale(-0.68, 0.68)" 
              mask="url(#chat-double-bubble-mask)" 
            />
            <path 
              d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" 
              transform="translate(1.5, 5) scale(0.68)" 
            />
          </svg>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">{unread}</span>
          )}
        </motion.button>
      </div>
      {panelOpen && <ChatPanel mode="overlay" onClose={closePanel} />}
    </>
  );
}
