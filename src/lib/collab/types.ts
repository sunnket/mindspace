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
  | { t: 'presenter'; from: string; name: string; camera: { x: number; y: number; zoom: number } | null };

export type TransportKind = 'supabase' | 'local';

export interface Transport {
  kind: TransportKind;
  send: (msg: WireMessage) => void;
  close: () => void;
}
