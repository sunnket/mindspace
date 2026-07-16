import { create } from 'zustand';
import { PeerIdentity, TransportKind } from '@/lib/collab/types';
import { useCanvasStore } from './canvasStore';
import { COLLAB_SESSION_ID_PREFIX } from '@/lib/db';

export type CollabStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Canvas id + nested-canvas stack a guest was viewing right before they
 * joined someone else's session — captured so `leaveSession` can put them
 * back exactly where they were, untouched. Always null for the host. */
export interface GuestOriginView {
  urlCanvasId: string;
  canvasStack: string[];
}

interface StoredPeer extends PeerIdentity {
  lastSeen: number;
}

type Cam = { x: number; y: number; zoom: number };
export interface PresenterState { id: string; name: string; camera: Cam }
export interface PulseSenders {
  reaction: (emoji: string, x: number, y: number) => void;
  laser: (x: number, y: number, active: boolean) => void;
  presenter: (camera: Cam | null) => void;
  /** Broadcast one downscaled JPEG frame for a live camera-mirror object. */
  mirrorFrame: (objectId: string, frame: string) => void;
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

  /** Set only for a guest, right before `join()` connects — never touched by the host. */
  guestOriginView: GuestOriginView | null;
  /** `__collab_<CODE>` while a guest's live session is active; null otherwise (host included). */
  sessionCanvasId: string | null;

  // Pulse — ephemeral awareness
  reactions: { id: string; emoji: string; x: number; y: number }[];
  lasers: Record<string, { x: number; y: number }>;
  presenter: PresenterState | null;
  following: boolean;
  /** Latest received video frame per live camera-mirror object id (data URL). */
  mirrorFrames: Record<string, string>;

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
  /** Clones the currently-selected object straight into the guest's real
   * (pre-join) canvas — bypasses the live session view and the collab
   * channel entirely so nothing leaks into the host's canvas. No-ops for
   * the host or when nothing is selected. */
  addSelectionToOriginCanvas: () => Promise<void>;

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
  _setMirrorFrame: (objectId: string, frame: string) => void;
  _clearMirrorFrame: (objectId: string) => void;
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
  guestOriginView: null,
  sessionCanvasId: null,
  reactions: [],
  lasers: {},
  presenter: null,
  following: false,
  mirrorFrames: {},
  _cursorSender: null,
  _pulse: null,

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  setFollowing: (following) => set({ following }),

  host: async (name) => {
    // A host is always just sharing their own real canvas — never enters a
    // synthetic session view.
    set({ guestOriginView: null, sessionCanvasId: null });
    const { startSession } = await import('@/lib/collab/service');
    const { generateSessionCode } = await import('@/lib/collab/palette');
    await startSession({ code: generateSessionCode(), isHost: true, name });
  },

  join: async (code, name) => {
    const trimmedCode = code.trim().toUpperCase();

    // Capture exactly what the guest was looking at BEFORE anything about
    // the join happens, and swap them into a synthetic session view that
    // never touches their real canvas — this must be synchronous so the
    // canvas swaps instantly, not after the network round-trip.
    const canvas = useCanvasStore.getState();
    const guestOriginView: GuestOriginView = {
      urlCanvasId: canvas.urlCanvasId,
      canvasStack: [...canvas.canvasStack],
    };
    set({ guestOriginView, sessionCanvasId: `${COLLAB_SESSION_ID_PREFIX}${trimmedCode}` });
    // canvasStack outranks urlCanvasId everywhere "current canvas" is
    // resolved — clear it or it would mask the synthetic session id.
    useCanvasStore.setState({ canvasStack: [] });

    const { startSession } = await import('@/lib/collab/service');
    await startSession({ code: trimmedCode, isHost: false, name });
  },

  addSelectionToOriginCanvas: async () => {
    const { guestOriginView } = get();
    if (!guestOriginView) return;

    const canvas = useCanvasStore.getState();
    const src = canvas.objects.find((o) => o.id === canvas.selectedId);
    if (!src) return;

    const targetParentId = guestOriginView.canvasStack.length > 0
      ? guestOriginView.canvasStack[guestOriginView.canvasStack.length - 1]
      : (guestOriginView.urlCanvasId === 'root' ? undefined : guestOriginView.urlCanvasId);

    const { v4: uuidv4 } = await import('uuid');
    const clone = {
      ...src,
      id: uuidv4(),
      parentId: targetParentId,
      x: src.x + 24,
      y: src.y + 24,
      style: src.style ? { ...src.style } : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Straight to IndexedDB — deliberately bypasses addObject/the live
    // `objects` array (which is currently bound to the synthetic session
    // view, so it would render inside the shared session) and the collab
    // emitter (which would broadcast the clone to the host, who'd re-parent
    // it into their OWN live canvas via applyRemoteOp — the opposite of
    // "guest-private").
    const { saveObject, getCanvasState } = await import('@/lib/db');
    await saveObject(clone);

    const { useAuthStore } = await import('@/store/authStore');
    const user = useAuthStore.getState().user;
    if (user) {
      const canvasId = targetParentId || 'root';
      const existing = await getCanvasState(canvasId);
      const state = existing || { id: canvasId, camera: { x: 0, y: 0, zoom: 1 }, lastModified: Date.now() };
      const { syncCanvasToCloud } = await import('@/lib/syncService');
      syncCanvasToCloud(canvasId, user.id, state, [clone], [], []).catch((e) =>
        console.error('[collab] clone sync failed:', e)
      );
    }
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
    set((state) => {
      // Auto-follow only when a NEW presenter starts — not on every camera
      // frame from the same presenter. Otherwise the ~60ms presenter updates
      // would keep flipping `following` back to true, and a viewer who clicked
      // "break free" could never actually break free while the presenter moved.
      const startedNew =
        !!presenter && presenter.id !== state.presenter?.id && presenter.id !== state.me?.id;
      return {
        presenter,
        following: !presenter
          ? false
          : presenter.id === state.me?.id
            ? false
            : startedNew
              ? true
              : state.following,
      };
    }),

  _setMirrorFrame: (objectId, frame) =>
    set((state) => ({ mirrorFrames: { ...state.mirrorFrames, [objectId]: frame } })),
  _clearMirrorFrame: (objectId) =>
    set((state) => {
      if (!(objectId in state.mirrorFrames)) return {};
      const mirrorFrames = { ...state.mirrorFrames };
      delete mirrorFrames[objectId];
      return { mirrorFrames };
    }),

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
      guestOriginView: null,
      sessionCanvasId: null,
      reactions: [],
      lasers: {},
      presenter: null,
      following: false,
      mirrorFrames: {},
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
