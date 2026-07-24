import { CanvasObjectData, DrawingStroke, ConnectionData } from '@/lib/db';

/** A person in a live session. */
export interface PeerIdentity {
  id: string;
  name: string;
  color: string;
}

/** A single canvas mutation that can be replayed on a remote peer. */
export type CanvasOp =
  | { kind: 'add'; object: CanvasObjectData }
  | { kind: 'update'; id: string; updates: Partial<CanvasObjectData> }
  | { kind: 'remove'; id: string }
  | { kind: 'stroke-add'; stroke: DrawingStroke }
  | { kind: 'stroke-remove'; id: string }
  | { kind: 'connection-add'; connection: ConnectionData }
  | { kind: 'connection-remove'; id: string };

/** Everything that travels over the transport (Supabase broadcast or BroadcastChannel). */
export type WireMessage =
  | { t: 'join'; peer: PeerIdentity }
  | { t: 'welcome'; peer: PeerIdentity; to: string }
  | { t: 'ping'; id: string }
  | { t: 'leave'; id: string }
  | { t: 'cursor'; id: string; x: number; y: number }
  | { t: 'op'; from: string; op: CanvasOp }
  | { t: 'op-batch'; from: string; ops: CanvasOp[] }
  | {
      t: 'snapshot';
      to: string;
      objects: CanvasObjectData[];
      strokes: DrawingStroke[];
      connections: ConnectionData[];
    }
  // Pulse — ephemeral awareness (never persisted or added to undo history)
  | { t: 'reaction'; from: string; emoji: string; x: number; y: number }
  | { t: 'laser'; from: string; x: number; y: number; active: boolean }
  | { t: 'presenter'; from: string; name: string; camera: { x: number; y: number; zoom: number } | null }
  // Live camera-mirror video: a downscaled JPEG frame for a mirror object,
  // keyed by that object's id. Ephemeral — never persisted or undoable.
  | { t: 'mirror-frame'; from: string; id: string; frame: string }
  // ---- Voice call (WebRTC mesh signalling over this same transport) ----
  // A newcomer announces they've joined the call; existing members answer
  // with `audio-here` so the newcomer learns who's already talking.
  | { t: 'audio-join'; from: string }
  | { t: 'audio-here'; from: string; to: string }
  | { t: 'audio-leave'; from: string }
  // Per-pair SDP / ICE. `to` scopes them so mesh peers ignore others' traffic.
  | { t: 'rtc-offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: 'rtc-answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: 'rtc-ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  // Everyone broadcasts their own mute state so the roster stays in sync.
  | { t: 'audio-state'; from: string; muted: boolean }
  // Host-only moderation. `force-mute` asks a peer to mute themselves; `kick`
  // ejects a peer from the whole session. Both carry the host id in `from`.
  | { t: 'force-mute'; from: string; to: string }
  | { t: 'kick'; from: string; to: string };

export type TransportKind = 'supabase' | 'local';

export interface Transport {
  kind: TransportKind;
  send: (msg: WireMessage) => void;
  close: () => void;
}
