import { v4 as uuidv4 } from 'uuid';
import { useCollabStore } from '@/store/collabStore';
import { useCanvasStore, setCollabEmitter, setCollabAuthor } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { WireMessage, CanvasOp, Transport } from './types';
import { randomPeerColor } from './palette';

const CURSOR_THROTTLE_MS = 45;
const UPDATE_FLUSH_MS = 55;
const HEARTBEAT_MS = 3000;
const PRUNE_MS = 4000;
const SUPABASE_SUBSCRIBE_TIMEOUT_MS = 6000;
const SUPABASE_HEALTH_TIMEOUT_MS = 2500;

let transport: Transport | null = null;
let myId = '';
let heartbeat: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let cursorThrottleTs = 0;
let pendingUpdates: Map<string, Partial<CanvasObjectData>> = new Map();
let updateFlushTimer: ReturnType<typeof setTimeout> | null = null;

/* ---------------- transports ---------------- */

function createLocalTransport(code: string, onMsg: (m: WireMessage) => void): Transport {
  const bc = new BroadcastChannel(`mindspace-collab-${code}`);
  bc.onmessage = (e) => onMsg(e.data as WireMessage);
  return {
    kind: 'local',
    send: (m) => {
      try {
        bc.postMessage(m);
      } catch {
        /* payload too large or channel closed — ignore */
      }
    },
    close: () => {
      try {
        bc.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function supabaseReachable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.includes('placeholder')) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUPABASE_HEALTH_TIMEOUT_MS);
    // Any HTTP response (even 401 without an apikey) proves the project is
    // alive; only network errors / timeouts mean unreachable.
    await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function createSupabaseTransport(
  code: string,
  onMsg: (m: WireMessage) => void
): Promise<Transport | null> {
  const { supabase } = await import('@/lib/supabaseClient');
  return new Promise((resolve) => {
    let settled = false;
    const channel = supabase.channel(`collab-${code}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'msg' }, (payload: { payload: WireMessage }) => {
      onMsg(payload.payload);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        /* noop */
      }
      resolve(null);
    }, SUPABASE_SUBSCRIBE_TIMEOUT_MS);

    channel.subscribe((status: string) => {
      if (settled) return;
      if (status === 'SUBSCRIBED') {
        settled = true;
        clearTimeout(timer);
        resolve({
          kind: 'supabase',
          send: (m) => {
            channel.send({ type: 'broadcast', event: 'msg', payload: m });
          },
          close: () => {
            try {
              supabase.removeChannel(channel);
            } catch {
              /* noop */
            }
          },
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settled = true;
        clearTimeout(timer);
        try {
          supabase.removeChannel(channel);
        } catch {
          /* noop */
        }
        resolve(null);
      }
    });
  });
}

/* ---------------- outgoing (canvas -> peers) ---------------- */

function scheduleUpdateFlush() {
  if (updateFlushTimer) return;
  updateFlushTimer = setTimeout(() => {
    updateFlushTimer = null;
    if (!transport || pendingUpdates.size === 0) return;
    const ops: CanvasOp[] = [];
    pendingUpdates.forEach((updates, id) => ops.push({ kind: 'update', id, updates }));
    pendingUpdates.clear();
    transport.send({ t: 'op-batch', from: myId, ops });
  }, UPDATE_FLUSH_MS);
}

function outgoingOp(op: CanvasOp) {
  if (!transport) return;
  if (op.kind === 'update') {
    // Coalesce rapid drag/resize updates per object id.
    pendingUpdates.set(op.id, { ...(pendingUpdates.get(op.id) || {}), ...op.updates });
    scheduleUpdateFlush();
  } else {
    transport.send({ t: 'op', from: myId, op });
  }
}

export function sendCursor(x: number, y: number) {
  if (!transport) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - cursorThrottleTs < CURSOR_THROTTLE_MS) return;
  cursorThrottleTs = now;
  transport.send({ t: 'cursor', id: myId, x, y });
}

/* ---------------- Pulse (ephemeral awareness) ---------------- */

let laserThrottleTs = 0;
let presenterThrottleTs = 0;

const pulseSenders = {
  reaction: (emoji: string, x: number, y: number) => {
    transport?.send({ t: 'reaction', from: myId, emoji, x, y });
  },
  laser: (x: number, y: number, active: boolean) => {
    if (!transport) return;
    if (active) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - laserThrottleTs < 40) return;
      laserThrottleTs = now;
    }
    transport.send({ t: 'laser', from: myId, x, y, active });
  },
  presenter: (camera: { x: number; y: number; zoom: number } | null) => {
    if (!transport) return;
    if (camera) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - presenterThrottleTs < 60) return;
      presenterThrottleTs = now;
    }
    const me = useCollabStore.getState().me;
    transport.send({ t: 'presenter', from: myId, name: me?.name || 'Presenter', camera });
  },
};

function sendSnapshot(toPeerId: string) {
  if (!transport) return;
  const state = useCanvasStore.getState();
  try {
    transport.send({
      t: 'snapshot',
      to: toPeerId,
      objects: state.objects,
      strokes: state.strokes,
      connections: state.connections,
    });
  } catch {
    /* snapshot too large for transport — peer will still receive live ops */
  }
}

/* ---------------- incoming (peers -> canvas) ---------------- */

function handleMessage(msg: WireMessage) {
  const collab = useCollabStore.getState();
  switch (msg.t) {
    case 'join':
      collab._addPeer(msg.peer);
      transport?.send({ t: 'welcome', peer: collab.me!, to: msg.peer.id });
      if (collab.isHost) sendSnapshot(msg.peer.id);
      break;
    case 'welcome':
      if (msg.to === collab.me?.id) collab._addPeer(msg.peer);
      break;
    case 'ping':
      collab._touchPeer(msg.id);
      break;
    case 'leave':
      collab._removePeer(msg.id);
      break;
    case 'cursor':
      collab._setCursor(msg.id, msg.x, msg.y);
      break;
    case 'op':
      useCanvasStore.getState().applyRemoteOp(msg.op);
      break;
    case 'op-batch':
      for (const op of msg.ops) useCanvasStore.getState().applyRemoteOp(op);
      break;
    case 'snapshot':
      if (msg.to === collab.me?.id) {
        useCanvasStore.getState().applyRemoteSnapshot(msg.objects, msg.strokes, msg.connections);
      }
      break;
    case 'reaction':
      collab._addReaction({ id: `${msg.from}-${Date.now()}-${Math.random()}`, emoji: msg.emoji, x: msg.x, y: msg.y });
      break;
    case 'laser':
      if (msg.active) collab._setLaser(msg.from, msg.x, msg.y);
      else collab._clearLaser(msg.from);
      break;
    case 'presenter':
      if (msg.camera) collab._setPresenter({ id: msg.from, name: msg.name, camera: msg.camera });
      else collab._setPresenter(null);
      break;
  }
}

/* ---------------- lifecycle ---------------- */

function beforeUnload() {
  try {
    transport?.send({ t: 'leave', id: myId });
  } catch {
    /* noop */
  }
}

export async function startSession(opts: { code: string; isHost: boolean; name: string }) {
  // Never stack two sessions.
  if (transport) leaveSession();

  const collab = useCollabStore.getState();
  const me = { id: uuidv4(), name: opts.name.trim() || 'Guest', color: randomPeerColor() };
  myId = me.id;
  collab._init({ code: opts.code, isHost: opts.isHost, me });

  let t: Transport | null = null;
  if (await supabaseReachable()) {
    t = await createSupabaseTransport(opts.code, handleMessage).catch(() => null);
  }
  if (!t) t = createLocalTransport(opts.code, handleMessage);
  transport = t;

  collab._setTransportKind(t.kind);
  collab._setStatus('connected');
  collab._setCursorSender(sendCursor);
  collab._setPulse(pulseSenders);

  // Wire the canvas store so local edits broadcast and objects get author-stamped.
  setCollabEmitter(outgoingOp);
  setCollabAuthor({ id: me.id, color: me.color });

  t.send({ t: 'join', peer: me });
  heartbeat = setInterval(() => transport?.send({ t: 'ping', id: myId }), HEARTBEAT_MS);
  pruneTimer = setInterval(() => useCollabStore.getState()._prunePeers(), PRUNE_MS);
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', beforeUnload);
}

export function leaveSession() {
  try {
    transport?.send({ t: 'leave', id: myId });
  } catch {
    /* noop */
  }
  transport?.close();
  transport = null;

  if (heartbeat) clearInterval(heartbeat);
  if (pruneTimer) clearInterval(pruneTimer);
  if (updateFlushTimer) clearTimeout(updateFlushTimer);
  heartbeat = null;
  pruneTimer = null;
  updateFlushTimer = null;
  pendingUpdates.clear();
  cursorThrottleTs = 0;

  setCollabEmitter(null);
  setCollabAuthor(null);
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload);

  // A guest leaving a live session: put them back exactly where they were
  // before they joined. Clear objects/strokes/connections immediately so no
  // stale host content flashes; InfiniteCanvas's load effect repopulates the
  // guest's real canvas from IndexedDB right after urlCanvasId flips back.
  const { guestOriginView } = useCollabStore.getState();
  if (guestOriginView) {
    useCanvasStore.setState({
      canvasStack: guestOriginView.canvasStack,
      urlCanvasId: guestOriginView.urlCanvasId,
      objects: [],
      strokes: [],
      connections: [],
    });
  }

  useCollabStore.getState()._reset();
}
