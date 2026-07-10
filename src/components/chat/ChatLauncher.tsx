'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useChatStore, useChatUnreadTotal } from '@/store/chatStore';
import ChatPanel from './ChatPanel';

export default function ChatLauncher() {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const closePanel = useChatStore((s) => s.closePanel);
  const unread = useChatUnreadTotal();

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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
