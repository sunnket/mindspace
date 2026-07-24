import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  CanvasObjectSnapshot,
  ChatAttachment,
  ChatMessage,
  attachmentPreviewText,
  fetchMessages,
  fetchProfilesByIds,
  fetchRooms,
  openOrCreateDm,
  searchUsers as searchUsersService,
  sendMessage as sendMessageService,
  subscribeToRoom,
  unsubscribeFromRoom,
  uploadAttachment,
} from '@/lib/chat/service';

function attachmentKindOf(mime: string): 'image' | 'video' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export interface ChatRoomSummary {
  id: string;
  otherUserId: string;
  /** The other person's display name (their saved profile name, else handle). */
  otherUsername: string;
  /** Their profile photo, or null → the initials-gradient avatar. */
  otherAvatar: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
}

interface ChatState {
  rooms: ChatRoomSummary[];
  roomsLoading: boolean;
  activeRoomId: string | null;
  messagesByRoom: Record<string, ChatMessage[]>;
  messagesLoading: Record<string, boolean>;
  unreadByRoom: Record<string, number>;
  searchQuery: string;
  searchResults: { id: string; username: string; displayName: string; avatarUrl: string | null }[];
  searchLoading: boolean;
  panelOpen: boolean;
  /** Set while a canvas object dragged into the "send to chat" hotzone is
   * waiting for the user to pick who it goes to. Cleared once a room is
   * chosen (the send happens as part of that pick) or the banner is dismissed. */
  pendingCanvasDrop: { snapshot: CanvasObjectSnapshot; label: string } | null;

  loadRooms: (myUserId: string) => Promise<void>;
  searchUsers: (query: string) => Promise<void>;
  startDm: (myUserId: string, otherUserId: string, otherUsername: string, otherAvatar?: string | null) => Promise<string>;
  setActiveRoom: (roomId: string | null) => Promise<void>;
  sendMessage: (roomId: string, senderId: string, body: string) => Promise<void>;
  sendAttachment: (roomId: string, senderId: string, file: File, caption?: string) => Promise<void>;
  sendCanvasObjectAttachment: (roomId: string, senderId: string, snapshot: CanvasObjectSnapshot, label: string) => Promise<void>;
  setPendingCanvasDrop: (drop: { snapshot: CanvasObjectSnapshot; label: string } | null) => void;
  markRoomRead: (roomId: string) => void;
  openPanel: () => void;
  closePanel: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  roomsLoading: false,
  activeRoomId: null,
  messagesByRoom: {},
  messagesLoading: {},
  unreadByRoom: {},
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  panelOpen: false,
  pendingCanvasDrop: null,

  loadRooms: async (myUserId) => {
    set({ roomsLoading: true });
    try {
      const roomRows = await fetchRooms(myUserId);
      const otherIds = roomRows.map((r) => (r.user_a === myUserId ? r.user_b : r.user_a));
      const identities = await fetchProfilesByIds(otherIds);
      const rooms: ChatRoomSummary[] = roomRows.map((r) => {
        const otherUserId = r.user_a === myUserId ? r.user_b : r.user_a;
        const who = identities[otherUserId];
        return {
          id: r.id,
          otherUserId,
          otherUsername: who?.name || 'Unknown',
          otherAvatar: who?.avatarUrl || null,
          lastMessageAt: r.last_message_at,
          lastMessagePreview: r.last_message_preview,
        };
      });
      set({ rooms, roomsLoading: false });
    } catch (err) {
      console.error('[chat] loadRooms failed:', err);
      set({ roomsLoading: false });
    }
  },

  searchUsers: async (query) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      set({ searchResults: [], searchLoading: false });
      return;
    }
    set({ searchLoading: true });
    const results = await searchUsersService(query);
    // Ignore stale responses from an earlier, slower keystroke.
    if (get().searchQuery !== query) return;
    set({ searchResults: results, searchLoading: false });
  },

  startDm: async (myUserId, otherUserId, otherUsername, otherAvatar = null) => {
    const roomId = await openOrCreateDm(myUserId, otherUserId);
    set((state) => ({
      rooms: state.rooms.some((r) => r.id === roomId)
        ? state.rooms
        : [
            { id: roomId, otherUserId, otherUsername, otherAvatar, lastMessageAt: null, lastMessagePreview: null },
            ...state.rooms,
          ],
      searchQuery: '',
      searchResults: [],
    }));
    await get().setActiveRoom(roomId);
    return roomId;
  },

  setActiveRoom: async (roomId) => {
    unsubscribeFromRoom();
    set({ activeRoomId: roomId });
    if (!roomId) return;

    get().markRoomRead(roomId);

    if (!get().messagesByRoom[roomId]) {
      set((state) => ({ messagesLoading: { ...state.messagesLoading, [roomId]: true } }));
      const messages = await fetchMessages(roomId);
      set((state) => ({
        messagesByRoom: { ...state.messagesByRoom, [roomId]: messages },
        messagesLoading: { ...state.messagesLoading, [roomId]: false },
      }));
    }

    subscribeToRoom(roomId, (msg) => {
      set((state) => {
        const existing = state.messagesByRoom[roomId] || [];
        if (existing.some((m) => m.id === msg.id)) return {};
        const isActive = state.activeRoomId === roomId;
        return {
          messagesByRoom: { ...state.messagesByRoom, [roomId]: [...existing, msg] },
          unreadByRoom: isActive
            ? state.unreadByRoom
            : { ...state.unreadByRoom, [roomId]: (state.unreadByRoom[roomId] || 0) + 1 },
          rooms: state.rooms.map((r) =>
            r.id === roomId ? { ...r, lastMessageAt: msg.createdAt, lastMessagePreview: msg.body.slice(0, 140) } : r
          ),
        };
      });
    });
  },

  sendMessage: async (roomId, senderId, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Optimistic append with a client-generated id; the real-time echo of our
    // own insert is de-duped against this by id in setActiveRoom's callback.
    const optimistic: ChatMessage = { id: `pending-${Date.now()}`, roomId, senderId, body: trimmed, createdAt: Date.now() };
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [...(state.messagesByRoom[roomId] || []), optimistic] },
    }));
    try {
      const saved = await sendMessageService(roomId, senderId, trimmed);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).map((m) => (m.id === optimistic.id ? saved : m)),
        },
        rooms: state.rooms.map((r) =>
          r.id === roomId ? { ...r, lastMessageAt: saved.createdAt, lastMessagePreview: saved.body.slice(0, 140) } : r
        ),
      }));
    } catch (err) {
      console.error('[chat] sendMessage failed:', err);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).filter((m) => m.id !== optimistic.id),
        },
      }));
    }
  },

  sendAttachment: async (roomId, senderId, file, caption = '') => {
    const id = uuidv4();
    const trimmedCaption = caption.trim();
    // path:'' is the "still uploading" signal the UI checks for — a real
    // attachment always has a non-empty storage path.
    const optimistic: ChatMessage = {
      id, roomId, senderId, body: trimmedCaption, createdAt: Date.now(),
      attachments: [{ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, path: '', kind: attachmentKindOf(file.type || '') }],
    };
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [...(state.messagesByRoom[roomId] || []), optimistic] },
    }));
    try {
      const attachment = await uploadAttachment(roomId, id, file);
      const saved = await sendMessageService(roomId, senderId, trimmedCaption, [attachment], id);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).map((m) => (m.id === id ? saved : m)),
        },
        rooms: state.rooms.map((r) =>
          r.id === roomId
            ? { ...r, lastMessageAt: saved.createdAt, lastMessagePreview: (saved.body || attachmentPreviewText(saved.attachments || [])).slice(0, 140) }
            : r
        ),
      }));
    } catch (err) {
      console.error('[chat] sendAttachment failed:', err);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).filter((m) => m.id !== id),
        },
      }));
      throw err;
    }
  },

  sendCanvasObjectAttachment: async (roomId, senderId, snapshot, label) => {
    const id = uuidv4();
    const attachment: ChatAttachment = {
      name: label, mime: 'application/x-mindspace-object', size: 0, path: '', kind: 'canvas-object', snapshot,
    };
    const optimistic: ChatMessage = { id, roomId, senderId, body: '', createdAt: Date.now(), attachments: [attachment] };
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [...(state.messagesByRoom[roomId] || []), optimistic] },
    }));
    try {
      const saved = await sendMessageService(roomId, senderId, '', [attachment], id);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).map((m) => (m.id === id ? saved : m)),
        },
        rooms: state.rooms.map((r) =>
          r.id === roomId ? { ...r, lastMessageAt: saved.createdAt, lastMessagePreview: attachmentPreviewText([attachment]) } : r
        ),
      }));
    } catch (err) {
      console.error('[chat] sendCanvasObjectAttachment failed:', err);
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).filter((m) => m.id !== id),
        },
      }));
      throw err;
    }
  },

  setPendingCanvasDrop: (pendingCanvasDrop) => set({ pendingCanvasDrop }),

  markRoomRead: (roomId) =>
    set((state) => {
      if (!state.unreadByRoom[roomId]) return {};
      const unreadByRoom = { ...state.unreadByRoom };
      delete unreadByRoom[roomId];
      return { unreadByRoom };
    }),

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),

  reset: () => {
    unsubscribeFromRoom();
    set({
      rooms: [],
      roomsLoading: false,
      activeRoomId: null,
      messagesByRoom: {},
      messagesLoading: {},
      unreadByRoom: {},
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      panelOpen: false,
      pendingCanvasDrop: null,
    });
  },
}));

export function useChatUnreadTotal(): number {
  return useChatStore((s) => Object.values(s.unreadByRoom).reduce((a, b) => a + b, 0));
}
