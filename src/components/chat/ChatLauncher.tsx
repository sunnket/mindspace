'use client';

import React, { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { CanvasObjectSnapshot } from '@/lib/chat/service';
import ChatPanel from './ChatPanel';

export default function ChatLauncher() {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const closePanel = useChatStore((s) => s.closePanel);

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

  // Headless: the DM chat is launched from the toolbar's Messages button now.
  // This component only mounts the panel and handles blocks dragged into it.
  return <>{panelOpen && <ChatPanel mode="overlay" onClose={closePanel} />}</>;
}
