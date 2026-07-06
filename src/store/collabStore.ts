import { create } from 'zustand';
import { PeerIdentity, TransportKind } from '@/lib/collab/types';

export type CollabStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface StoredPeer extends PeerIdentity {
  lastSeen: number;
}

type Cam = { x: number; y: number; zoom: number };
export interface PresenterState { id: string; name: string; camera: Cam }
export interface PulseSenders {
  reaction: (emoji: string, x: number, y: number) => void;
  laser: (x: number, y: number, active: boolean) => void;
  presenter: (camera: Cam | null) => void;
}

interface CollabState {
  status: CollabStatus;
  transportKind: TransportKind | null;
  code: string | null;
  isHost: boolean;
  error: string | null;
  me: PeerIdentity | null;
  peers: Record<string, StoredPeer>;
  cursors: Record<string, { x: number; y: number }>;
  modalOpen: boolean;

  // Pulse — ephemeral awareness
  reactions: { id: string; emoji: string; x: number; y: number }[];
  lasers: Record<string, { x: number; y: number }>;
  presenter: PresenterState | null;
  following: boolean;

  /** Set by the collab service so the canvas can push cursor positions without a dynamic import per move. */
  _cursorSender: ((x: number, y: number) => void) | null;
  _pulse: PulseSenders | null;

  // public
  openModal: () => void;
  closeModal: () => void;
  host: (name: string) => Promise<void>;
  join: (code: string, name: string) => Promise<void>;
  leave: () => void;
  setFollowing: (v: boolean) => void;

  // internal — driven by the service
  _init: (p: { code: string; isHost: boolean; me: PeerIdentity }) => void;
  _setStatus: (status: CollabStatus, error?: string | null) => void;
  _setTransportKind: (kind: TransportKind | null) => void;
  _setCursorSender: (fn: ((x: number, y: number) => void) | null) => void;
  _setPulse: (p: PulseSenders | null) => void;
  _addPeer: (peer: PeerIdentity) => void;
  _touchPeer: (id: string) => void;
  _removePeer: (id: string) => void;
  _setCursor: (id: string, x: number, y: number) => void;
  _prunePeers: () => void;
  _addReaction: (r: { id: string; emoji: string; x: number; y: number }) => void;
  _removeReaction: (id: string) => void;
  _setLaser: (id: string, x: number, y: number) => void;
  _clearLaser: (id: string) => void;
  _setPresenter: (p: PresenterState | null) => void;
  _reset: () => void;
}

const PEER_TIMEOUT_MS = 10_000;

export const useCollabStore = create<CollabState>((set, get) => ({
  status: 'idle',
  transportKind: null,
  code: null,
  isHost: false,
  error: null,
  me: null,
  peers: {},
  cursors: {},
  modalOpen: false,
  reactions: [],
  lasers: {},
  presenter: null,
  following: false,
  _cursorSender: null,
  _pulse: null,

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  setFollowing: (following) => set({ following }),

  host: async (name) => {
    const { startSession } = await import('@/lib/collab/service');
    const { generateSessionCode } = await import('@/lib/collab/palette');
    await startSession({ code: generateSessionCode(), isHost: true, name });
  },

  join: async (code, name) => {
    const { startSession } = await import('@/lib/collab/service');
    await startSession({ code: code.trim().toUpperCase(), isHost: false, name });
  },

  leave: () => {
    import('@/lib/collab/service').then(({ leaveSession }) => leaveSession());
  },

  _init: ({ code, isHost, me }) =>
    set({ code, isHost, me, peers: {}, cursors: {}, error: null, status: 'connecting' }),

  _setStatus: (status, error = null) => set({ status, error }),
  _setTransportKind: (transportKind) => set({ transportKind }),
  _setCursorSender: (fn) => set({ _cursorSender: fn }),
  _setPulse: (p) => set({ _pulse: p }),

  _addReaction: (r) => set((state) => ({ reactions: [...state.reactions, r] })),
  _removeReaction: (id) => set((state) => ({ reactions: state.reactions.filter((r) => r.id !== id) })),
  _setLaser: (id, x, y) =>
    set((state) => (id === state.me?.id ? {} : { lasers: { ...state.lasers, [id]: { x, y } } })),
  _clearLaser: (id) =>
    set((state) => {
      if (!state.lasers[id]) return {};
      const lasers = { ...state.lasers };
      delete lasers[id];
      return { lasers };
    }),
  _setPresenter: (presenter) =>
    set((state) => ({
      presenter,
      // auto-follow a newly started presenter (unless it's me)
      following: presenter && presenter.id !== state.me?.id ? true : false,
    })),

  _addPeer: (peer) =>
    set((state) => {
      if (peer.id === state.me?.id) return {};
      return { peers: { ...state.peers, [peer.id]: { ...peer, lastSeen: Date.now() } } };
    }),

  _touchPeer: (id) =>
    set((state) => {
      const p = state.peers[id];
      if (!p) return {};
      return { peers: { ...state.peers, [id]: { ...p, lastSeen: Date.now() } } };
    }),

  _removePeer: (id) =>
    set((state) => {
      if (!state.peers[id]) return {};
      const peers = { ...state.peers };
      const cursors = { ...state.cursors };
      const lasers = { ...state.lasers };
      delete peers[id];
      delete cursors[id];
      delete lasers[id];
      const presenter = state.presenter?.id === id ? null : state.presenter;
      return { peers, cursors, lasers, presenter, following: presenter ? state.following : false };
    }),

  _setCursor: (id, x, y) =>
    set((state) => {
      if (!state.peers[id]) return {};
      return { cursors: { ...state.cursors, [id]: { x, y } } };
    }),

  _prunePeers: () =>
    set((state) => {
      const now = Date.now();
      let changed = false;
      const peers = { ...state.peers };
      const cursors = { ...state.cursors };
      for (const id of Object.keys(peers)) {
        if (now - peers[id].lastSeen > PEER_TIMEOUT_MS) {
          delete peers[id];
          delete cursors[id];
          changed = true;
        }
      }
      return changed ? { peers, cursors } : {};
    }),

  _reset: () =>
    set({
      status: 'idle',
      transportKind: null,
      code: null,
      isHost: false,
      error: null,
      me: null,
      peers: {},
      cursors: {},
      reactions: [],
      lasers: {},
      presenter: null,
      following: false,
      _cursorSender: null,
      _pulse: null,
    }),
}));

/** True only when connected AND at least one other person is present. */
export function useCollabActive(): boolean {
  return useCollabStore(
    (s) => s.status === 'connected' && Object.keys(s.peers).length > 0
  );
}
