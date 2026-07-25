import { useCollabStore } from '@/store/collabStore';
import type { WireMessage } from './types';

/**
 * Voice call for a live session — a WebRTC audio mesh.
 *
 * Every participant holds one RTCPeerConnection per other participant and
 * exchanges microphone tracks directly; SDP/ICE signalling rides the SAME
 * transport the canvas already uses (Supabase broadcast, or a BroadcastChannel
 * across this device's tabs). No media server is involved — audio is P2P.
 *
 * Glare is avoided with a deterministic rule: for any pair, the peer with the
 * lexicographically SMALLER id creates the offer; the other one answers. So
 * exactly one side initiates each connection.
 *
 * Moderation is host-only and advisory-by-design over an untrusted mesh: the
 * host asks a peer to mute (force-mute) or to leave (kick); the client honours
 * it. Good enough for a friendly workspace; it is not a hard security boundary.
 */

/**
 * STUN discovers your public address; TURN relays audio when a direct P2P path
 * can't be punched through (symmetric NAT, strict corporate/mobile networks) —
 * which is most real two-people-on-different-wifi calls. STUN alone is why the
 * old call so often connected to silence: the peers found each other's private
 * addresses and never actually reached each other.
 *
 * The openrelay project provides free public TURN; it's the fallback so a call
 * connects out of the box. For your own reliability, drop credentials in
 * NEXT_PUBLIC_TURN_URL / _USER / _CRED and they're prepended.
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.unshift({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USER || '',
      credential: process.env.NEXT_PUBLIC_TURN_CRED || '',
    });
  }

  // Free public relay — keeps calls working across networks without any setup.
  servers.push(
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  );
  return servers;
}

const ICE_SERVERS: RTCIceServer[] = buildIceServers();

interface PeerConn {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser?: AnalyserNode;
  /** Buffered ICE that arrived before the remote description was set. */
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
}

let send: ((m: WireMessage) => void) | null = null;
let myId = '';
let inCall = false;
let localStream: MediaStream | null = null;
const conns = new Map<string, PeerConn>();

// Speaking detection — one shared AudioContext + analyser per stream, polled
// on a single rAF loop. Ephemeral UI only.
let audioCtx: AudioContext | null = null;
let selfAnalyser: AnalyserNode | null = null;
let vadRAF: number | null = null;
const SPEAK_THRESHOLD = 0.045;

/* ----------------------------- wiring ----------------------------- */

export function setAudioTransport(fn: ((m: WireMessage) => void) | null, id: string) {
  send = fn;
  myId = id;
}

/** True for the pair member who should create the offer. */
function iInitiate(peerId: string): boolean {
  return myId < peerId;
}

function store() {
  return useCollabStore.getState();
}

/* --------------------------- lifecycle ---------------------------- */

/**
 * Open the mic and join the mesh.
 *
 * `muted` exists because there is no longer a "call" to place: joining a
 * session puts you in the room straight away, mic OFF, and the only control is
 * the mute toggle. Everyone is always connected, so unmuting is the whole
 * gesture — you speak and you're heard, with nobody needing to dial anybody.
 * The track is created disabled, so a muted join never captures a single
 * sample; the browser's own recording indicator is the honest signal.
 */
export async function joinAudioCall(opts?: { muted?: boolean }): Promise<void> {
  if (inCall) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    store()._setAudioError('This browser can’t access the microphone.');
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch {
    store()._setAudioError('Microphone blocked — allow it to talk here.');
    return;
  }
  const muted = opts?.muted !== false;
  localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });

  inCall = true;
  store()._setAudioActive(true);
  store()._setMicMuted(muted);
  store()._setAudioError(null);

  installGestureUnblock();
  startVAD();
  attachSelfVAD();

  // Announce and let existing members reach back with `audio-here`.
  send?.({ t: 'audio-join', from: myId });
  send?.({ t: 'audio-state', from: myId, muted });
}

/** Am I already in the mesh? Lets the UI avoid a redundant join. */
export function isInCall(): boolean {
  return inCall;
}

/**
 * Browsers block audio from starting without a user gesture. Joining the
 * session is a gesture, but a peer's <audio> is created LATER (when their track
 * arrives), by which point the gesture is spent and `.play()` silently rejects
 * — a call that "connected" but was mute. This retries every remote element on
 * the next real gesture, and resumes the analyser AudioContext (also born
 * suspended), so voice comes alive the instant anyone clicks anything.
 */
let gestureUnblockInstalled = false;
function unblockPlayback() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  conns.forEach((entry) => {
    if (entry.audioEl.paused) entry.audioEl.play().catch(() => {});
  });
}
function installGestureUnblock() {
  if (gestureUnblockInstalled || typeof window === 'undefined') return;
  gestureUnblockInstalled = true;
  const handler = () => unblockPlayback();
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('keydown', handler, true);
  window.addEventListener('touchstart', handler, true);
}

export function leaveAudioCall(): void {
  if (!inCall) return;
  send?.({ t: 'audio-leave', from: myId });
  teardown();
}

/** Full local teardown — also used when the whole session ends. */
export function teardown(): void {
  inCall = false;
  for (const id of Array.from(conns.keys())) closeConn(id);
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (vadRAF !== null) { cancelAnimationFrame(vadRAF); vadRAF = null; }
  selfAnalyser = null;
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  const s = store();
  s._setAudioActive(false);
  s._setMicMuted(true);
  s._resetCallParticipants();
  s._setSelfSpeaking(false);
}

export function toggleMic(): void {
  if (!inCall || !localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const muted = !track.enabled;
  store()._setMicMuted(muted);
  send?.({ t: 'audio-state', from: myId, muted });
}

/** Host asks a peer to mute themselves. */
export function adminMute(peerId: string): void {
  if (!store().isHost) return;
  send?.({ t: 'force-mute', from: myId, to: peerId });
}

/** Host ejects a peer from the session. */
export function adminKick(peerId: string): void {
  if (!store().isHost) return;
  send?.({ t: 'kick', from: myId, to: peerId });
}

/** A session peer disappeared (left / pruned) — drop their call connection. */
export function onPeerGone(peerId: string): void {
  closeConn(peerId);
  store()._removeCallParticipant(peerId);
}

/* --------------------------- signalling --------------------------- */

export function handleAudioMessage(msg: WireMessage): void {
  switch (msg.t) {
    case 'audio-join':
      if (msg.from === myId) return;
      if (inCall) {
        // Tell the newcomer we're here — including whether our mic is open, so
        // their roster is right from the first frame instead of showing
        // everyone live until the first toggle contradicts it.
        send?.({ t: 'audio-here', from: myId, to: msg.from });
        send?.({ t: 'audio-state', from: myId, muted: store().micMuted });
        ensureConn(msg.from, true);
      }
      break;
    case 'audio-here':
      if (msg.to !== myId || !inCall) return;
      ensureConn(msg.from, true);
      break;
    case 'audio-leave':
      onPeerGone(msg.from);
      break;
    case 'rtc-offer':
      if (msg.to === myId && inCall) void onOffer(msg.from, msg.sdp);
      break;
    case 'rtc-answer':
      if (msg.to === myId && inCall) void onAnswer(msg.from, msg.sdp);
      break;
    case 'rtc-ice':
      if (msg.to === myId && inCall) void onIce(msg.from, msg.candidate);
      break;
    case 'audio-state':
      if (msg.from !== myId) store()._setCallParticipant(msg.from, { muted: msg.muted });
      break;
    case 'force-mute':
      // Honour a mute request aimed at me: only if not already muted.
      if (msg.to === myId && inCall && !store().micMuted) toggleMic();
      break;
    case 'kick':
      if (msg.to === myId) {
        // Leave the whole session — the host removed me.
        teardown();
        store().leave();
      } else {
        // Everyone else drops the kicked peer from their roster/mesh.
        onPeerGone(msg.to);
      }
      break;
  }
}

/* ------------------------ peer connections ------------------------ */

function ensureConn(peerId: string, connectNow: boolean): PeerConn {
  let entry = conns.get(peerId);
  if (entry) return entry;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  (audioEl as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
  audioEl.style.display = 'none';
  document.body.appendChild(audioEl);

  entry = { pc, audioEl, pendingIce: [], remoteSet: false };
  conns.set(peerId, entry);
  /* Seed the roster entry only if their real state hasn't already landed —
     `audio-state` and the connection setup race, and the message is the
     truth. Muted is the right guess: everyone joins with the mic closed. */
  if (!store().callParticipants[peerId]) {
    store()._setCallParticipant(peerId, { muted: true, speaking: false });
  }

  // Publish my mic to this peer.
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream!));

  pc.onicecandidate = (e) => {
    if (e.candidate) send?.({ t: 'rtc-ice', from: myId, to: peerId, candidate: e.candidate.toJSON() });
  };
  pc.ontrack = (e) => {
    const [stream] = e.streams;
    if (stream) {
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {
        // Autoplay refused — the gesture unblock (installed on join) retries it
        // on the next click/keypress, so a call is never permanently silent.
      });
      attachRemoteVAD(peerId, stream);
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      // A transient failure shouldn't wipe the roster; only drop on real close.
      if (pc.connectionState === 'closed') onPeerGone(peerId);
    }
  };

  if (connectNow && iInitiate(peerId)) void makeOffer(peerId, entry);
  return entry;
}

async function makeOffer(peerId: string, entry: PeerConn): Promise<void> {
  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    send?.({ t: 'rtc-offer', from: myId, to: peerId, sdp: offer });
  } catch {
    /* renegotiation will retry via ICE restart if needed */
  }
}

async function onOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
  const entry = ensureConn(peerId, false);
  try {
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    entry.remoteSet = true;
    await flushIce(entry);
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    send?.({ t: 'rtc-answer', from: myId, to: peerId, sdp: answer });
  } catch {
    /* ignore malformed offer */
  }
}

async function onAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
  const entry = conns.get(peerId);
  if (!entry) return;
  try {
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    entry.remoteSet = true;
    await flushIce(entry);
  } catch {
    /* ignore */
  }
}

async function onIce(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
  const entry = conns.get(peerId);
  if (!entry) return;
  if (!entry.remoteSet) { entry.pendingIce.push(candidate); return; }
  try {
    await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch {
    /* candidate arrived out of order; harmless */
  }
}

async function flushIce(entry: PeerConn): Promise<void> {
  const queued = entry.pendingIce.splice(0);
  for (const c of queued) {
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
  }
}

function closeConn(peerId: string): void {
  const entry = conns.get(peerId);
  if (!entry) return;
  try { entry.pc.ontrack = null; entry.pc.onicecandidate = null; entry.pc.close(); } catch { /* noop */ }
  try { entry.audioEl.srcObject = null; entry.audioEl.remove(); } catch { /* noop */ }
  conns.delete(peerId);
}

/* --------------------- speaking detection (VAD) ------------------- */

function ensureCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
    // Often born 'suspended' under autoplay policy; a gesture resumes it.
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

function makeAnalyser(stream: MediaStream): AnalyserNode | undefined {
  const ctx = ensureCtx();
  if (!ctx) return undefined;
  try {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    return analyser;
  } catch {
    return undefined;
  }
}

function attachSelfVAD() {
  if (!localStream) return;
  selfAnalyser = makeAnalyser(localStream) ?? null;
}

function attachRemoteVAD(peerId: string, stream: MediaStream) {
  const entry = conns.get(peerId);
  if (entry) entry.analyser = makeAnalyser(stream);
}

function rms(analyser: AnalyserNode, buf: Uint8Array): number {
  // Cast sidesteps the DOM lib's stricter Uint8Array<ArrayBuffer> generic.
  analyser.getByteTimeDomainData(buf as Parameters<AnalyserNode['getByteTimeDomainData']>[0]);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function startVAD() {
  if (vadRAF !== null) return;
  const buf = new Uint8Array(256);
  let last = 0;
  const tick = () => {
    vadRAF = requestAnimationFrame(tick);
    const now = performance.now();
    if (now - last < 120) return; // ~8 fps is plenty for a talk indicator
    last = now;
    const s = store();
    // Self (only counts when unmuted)
    if (selfAnalyser) {
      const speaking = !s.micMuted && rms(selfAnalyser, buf) > SPEAK_THRESHOLD;
      if (speaking !== s.selfSpeaking) s._setSelfSpeaking(speaking);
    }
    // Remotes
    conns.forEach((entry, peerId) => {
      if (!entry.analyser) return;
      const speaking = rms(entry.analyser, buf) > SPEAK_THRESHOLD;
      const cur = s.callParticipants[peerId];
      if (cur && cur.speaking !== speaking) s._setCallParticipant(peerId, { speaking });
    });
  };
  vadRAF = requestAnimationFrame(tick);
}
