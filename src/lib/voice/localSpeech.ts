'use client';

import { useVoiceStore } from '@/store/voiceStore';
import { commitSpoken, closeDictation } from './dictation';

/**
 * Voice typing that doesn't depend on Google.
 *
 * The browser's SpeechRecognition is a thin client for Google's cloud service.
 * Where that service is unreachable it fails with `network` on every attempt and
 * cannot be made to work — see whisper-worker.js. This is the engine we fall back
 * to: the microphone is captured here, chopped into utterances, and transcribed by
 * Whisper running inside the page.
 *
 * The unit of work is an UTTERANCE, not a fixed time slice. Whisper is a
 * sequence-to-sequence model over a whole clip — hand it audio cut mid-word every
 * 3 seconds and it invents endings for the halves. So a voice gate watches for you
 * to start talking, keeps a moment of audio from *before* that (or the first
 * syllable is always missing), and only closes the clip when you actually stop.
 * Long pause = finished sentence = one clean transcription.
 *
 * THREE THINGS THIS GETS RIGHT THAT THE FIRST VERSION DIDN'T:
 *
 * 1. The gate is measured against YOUR room, not a constant. A fixed threshold
 *    means a fan, a laptop on a desk, or a slightly hot mic opens an utterance
 *    every second — and Whisper, handed a second of room tone, writes `[Music]`
 *    or `(knocking)`. Most of the junk on screen was never a transcription
 *    problem; it was a gate that kept sending silence to a model that always
 *    answers.
 * 2. No running guesses. Interim passes doubled the work on a single-threaded
 *    model — every partial clip delayed the real sentence behind it, and partial
 *    clips are exactly where Whisper hallucinates. The finished phrase is the
 *    only thing transcribed, and it lands the moment you stop speaking.
 * 3. The mic opens before the model is ready and the audio is KEPT. You press,
 *    you talk. If the model is still coming down it transcribes what you already
 *    said as soon as it lands, in order. Nothing is dropped waiting for a
 *    download.
 */

const SAMPLE_RATE = 16_000;

/* The gate. Absolute floors so a dead-silent room can't drive the thresholds to
   zero; everything above that is measured from the ambient level. */
const MIN_START = 0.014;
const MIN_END = 0.007;
const START_OVER_NOISE = 3.2;
const END_OVER_NOISE = 1.8;

const SILENCE_END_MS = 700;      // quiet for this long = the sentence is over
const PREROLL_MS = 400;          // audio kept from before speech was detected
const MIN_UTTERANCE_MS = 400;    // shorter than this is a cough, not a word
const MIN_VOICED_MS = 240;       // …and it has to be loud for some of that
const MAX_UTTERANCE_MS = 18_000; // cut a monologue up rather than lag forever
const IDLE_STOP_MS = 150_000;    // a mic left open in an abandoned tab
const MAX_QUEUED = 12;           // audio held while the model is still loading

/** A stream that delivers nothing but digital zero is a muted or dead device,
 *  and the browser reports that as a perfectly healthy microphone. */
const DEAD_MIC_NOTICE = "No sound from the microphone — check it isn't muted.";

/** How long the loaded model survives with no dictation. Reloading it costs
 *  seconds of staring at a button, so this is generous — but a tab left open
 *  overnight shouldn't hold a few hundred MB of weights forever. */
const MODEL_IDLE_MS = 20 * 60 * 1000;

type Job = { id: number; audio: Float32Array };

let worker: Worker | null = null;
let killTimer: ReturnType<typeof setTimeout> | null = null;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let teardownGraph: (() => void) | null = null;
let running = false;
let modelReady = false;
let modelLoading = false;
let loadFailed = false;

/* Audio state */
let speech: Float32Array[] = [];   // the utterance being collected
let speechLen = 0;
let voicedMs = 0;                  // time above the start threshold within it
let peak = 0;
let preroll: Float32Array[] = [];  // rolling buffer of what came just before it
let prerollLen = 0;
let speaking = false;
let silenceMs = 0;
let quietMs = 0;
let noiseFloor = MIN_END;
let heardAnything = false;

/** Smoothed input level, 0–1, read by the HUD every frame. Kept out of the store
 *  on purpose: 8 store writes a second would re-render the canvas for a
 *  decoration. */
let level = 0;

/* Worker state — one job in flight, the rest waiting in order. */
let busy = false;
let queue: Job[] = [];
let jobId = 0;

const prerollCap = () => (PREROLL_MS / 1000) * SAMPLE_RATE;
const startThreshold = () => Math.max(MIN_START, noiseFloor * START_OVER_NOISE);
const endThreshold = () => Math.max(MIN_END, noiseFloor * END_OVER_NOISE);

export const isLocalSpeechRunning = () => running;
export const isLocalSpeechReady = () => modelReady;
/** 0–1, already smoothed for animation. */
export const getInputLevel = () => level;

/** Whichever CDN answered last time. Trying a dead one first costs a timeout on
 *  every single load, and it's usually the same one that's blocked. */
const SOURCE_KEY = 'mindspace.voiceLibSource';

function preferredSource(): string | null {
  try {
    return localStorage.getItem(SOURCE_KEY);
  } catch {
    return null;
  }
}

function rememberSource(url: string) {
  try {
    localStorage.setItem(SOURCE_KEY, url);
  } catch {
    /* private mode — we'll re-discover it */
  }
}

function language(): string {
  if (typeof navigator === 'undefined') return 'en';
  return (navigator.language || 'en').split('-')[0].toLowerCase();
}

function flatten(chunks: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Linear resample. Only runs if the browser wouldn't give us a 16kHz context. */
function toSampleRate(input: Float32Array, from: number): Float32Array {
  if (from === SAMPLE_RATE) return input;
  const ratio = from / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, input.length - 1);
    const frac = pos - low;
    out[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return out;
}

/* ------------------------------------------------------------------- worker */

function syncPending() {
  useVoiceStore.getState().setPending(queue.length + (busy ? 1 : 0));
}

function pump() {
  if (busy || !worker || !modelReady) return;
  const job = queue.shift();
  if (!job) {
    syncPending();
    // The session is over and the last sentence has landed — let go of the
    // block so the next press can pick a fresh target.
    if (!running) closeDictation();
    return;
  }
  busy = true;
  syncPending();
  // Transferred, not copied — the buffer is dead to us after this, which is why
  // every job gets its own slice.
  worker.postMessage({ type: 'transcribe', id: job.id, audio: job.audio, language: language() },
    [job.audio.buffer]);
}

function submit(audio: Float32Array) {
  queue.push({ id: ++jobId, audio });
  // Only reachable while the model is still downloading. Losing the oldest
  // audio is bad; growing without limit until the tab dies is worse.
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
  syncPending();
  pump();
}

function onWorkerMessage(event: MessageEvent) {
  const msg = event.data;
  const voice = useVoiceStore.getState();

  if (msg.type === 'progress') {
    voice.setProgress(msg.percent);
    if (running) voice.setNotice(`Setting up voice typing — ${msg.percent}%. Keep talking, I'm recording.`);
    return;
  }

  if (msg.type === 'warming') {
    voice.setProgress(100);
    if (running) voice.setNotice("Almost ready — keep talking, I'm recording.");
    return;
  }

  if (msg.type === 'ready') {
    modelReady = true;
    modelLoading = false;
    loadFailed = false;
    if (msg.source) rememberSource(msg.source);
    voice.setProgress(null);
    if (running) {
      voice.setNotice(null);
      voice.setLive(true);
    }
    console.info(`[voice] on-device speech ready: ${msg.engine}`);
    pump();
    return;
  }

  if (msg.type === 'result') {
    busy = false;
    const text: string = msg.text || '';
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[voice] "${text}" in ${msg.ms}ms (${msg.engine})`);
    }
    // Straight into the block at the caret. Everything Whisper writes that isn't
    // speech dies inside commitSpoken.
    commitSpoken(text);
    pump();
    return;
  }

  if (msg.type === 'error') {
    busy = false;
    // A single utterance failing is not worth killing the session over; failing
    // to load at all is.
    if (!modelReady) {
      modelLoading = false;
      loadFailed = true;
      voice.setProgress(null);
      if (running) {
        voice.setError(msg.message || 'On-device voice typing could not start.');
        stopLocalSpeech();
      }
    }
    pump();
  }
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker('/whisper-worker.js', { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = onWorkerMessage;
  worker.onerror = () => {
    if (modelReady) return; // a runtime blip in an already-working model
    modelLoading = false;
    loadFailed = true;
    if (running) {
      useVoiceStore.getState().setError('On-device voice typing failed to load. Check your connection and try again.');
      stopLocalSpeech();
    }
  };
  return worker;
}

function requestModel() {
  if (modelReady || modelLoading) return;
  const w = ensureWorker();
  if (!w) return;
  modelLoading = true;
  loadFailed = false;
  w.postMessage({ type: 'load', source: preferredSource() });
}

/**
 * Get the model on this machine BEFORE the button is pressed.
 *
 * The whole "it takes forever" complaint is a cold start: a model download, a
 * WASM runtime boot and a first inference that JITs the graph, all of it stacked
 * in front of the first sentence someone speaks. None of that has to happen
 * while they wait. Called on hover of the voice button and once the canvas has
 * gone idle, so by the time anyone presses it, the answer is instant.
 *
 * Safe to call as often as you like — it is a no-op once loaded, in flight, or
 * already known to have failed.
 */
export function warmUpLocalSpeech(): void {
  if (typeof window === 'undefined') return;
  if (modelReady || modelLoading || loadFailed) return;
  if (killTimer !== null) {
    clearTimeout(killTimer);
    killTimer = null;
  }
  requestModel();
}

/* -------------------------------------------------------------------- audio */

function endUtterance() {
  const ms = (speechLen / SAMPLE_RATE) * 1000;
  // Long enough, loud enough, for long enough. Anything that fails this is a
  // door, a keyboard, or a breath — and handing it to Whisper is how `(knocking)`
  // ends up in someone's notes.
  const real = ms >= MIN_UTTERANCE_MS && voicedMs >= MIN_VOICED_MS && peak >= startThreshold() * 1.25;
  const audio = real ? flatten(speech, speechLen) : null;

  speech = [];
  speechLen = 0;
  voicedMs = 0;
  peak = 0;
  speaking = false;
  silenceMs = 0;
  useVoiceStore.getState().setHearing(false);

  if (audio) submit(audio);
}

function onAudio(block: Float32Array) {
  if (!running) return;

  let sum = 0;
  let blockPeak = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i] * block[i];
    sum += v;
    if (v > blockPeak) blockPeak = v;
  }
  const rms = Math.sqrt(sum / block.length);
  const ms = (block.length / SAMPLE_RATE) * 1000;

  if (rms > 0.0002 && !heardAnything) {
    heardAnything = true;
    // The mic woke up late — take the warning back down rather than leave it
    // sitting over a working session.
    if (useVoiceStore.getState().notice === DEAD_MIC_NOTICE) useVoiceStore.getState().setNotice(null);
  }
  // Fast attack, slow release — the orb should jump on a word and settle after
  // it, not flicker with every zero crossing.
  const target = Math.min(1, rms / 0.22);
  level = target > level ? target : level * 0.82 + target * 0.18;

  if (!speaking) {
    // The room's own level, learned continuously. Only sampled while nothing is
    // being said, so a long sentence can't drag the threshold up behind it.
    if (rms < startThreshold()) {
      noiseFloor = Math.min(0.05, Math.max(0.001, noiseFloor * 0.97 + rms * 0.03));
    }

    // Hold the last fraction of a second of room tone. When speech does start,
    // this is what carries the attack of the first word into the clip.
    preroll.push(block);
    prerollLen += block.length;
    while (prerollLen > prerollCap() && preroll.length > 1) {
      prerollLen -= preroll[0].length;
      preroll.shift();
    }

    if (rms > startThreshold()) {
      speaking = true;
      silenceMs = 0;
      quietMs = 0;
      voicedMs = ms;
      peak = rms;
      speech = [...preroll, block];
      speechLen = prerollLen + block.length;
      preroll = [];
      prerollLen = 0;
      useVoiceStore.getState().setHearing(true);
      useVoiceStore.getState().setIsPaused(false);
    } else {
      quietMs += ms;
      if (quietMs >= IDLE_STOP_MS) {
        useVoiceStore.getState().setNotice('Voice typing turned itself off after a long silence.');
        stopLocalSpeech();
      }
    }
    return;
  }

  speech.push(block);
  speechLen += block.length;
  if (rms > peak) peak = rms;
  if (rms > startThreshold()) voicedMs += ms;

  if (rms < endThreshold()) {
    silenceMs += ms;
    if (silenceMs >= SILENCE_END_MS) {
      endUtterance();
      useVoiceStore.getState().setIsPaused(true);
      return;
    }
  } else {
    silenceMs = 0;
    useVoiceStore.getState().setHearing(true);
  }

  if ((speechLen / SAMPLE_RATE) * 1000 >= MAX_UTTERANCE_MS) endUtterance();
}

/** Taps the mic graph and ships raw PCM to the main thread in ~128ms blocks. */
const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.at = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.at++] = ch[i];
        if (this.at === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.at = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

/**
 * A worklet is the right way to do this and is not always available: no secure
 * context, a CSP that refuses the blob it's compiled from, an older embedded
 * browser. ScriptProcessorNode is deprecated, universally supported, and the
 * difference between "dictation doesn't work here" and a little main-thread
 * work — so it stays as the fallback.
 */
async function buildGraph(source: MediaStreamAudioSourceNode, ctx: AudioContext, rate: number) {
  const handle = (data: Float32Array) => onAudio(toSampleRate(data, rate));

  // A tap only runs while it's connected to the destination — but connecting the
  // microphone to the speakers is a feedback howl, so it goes through a gain of
  // zero. The graph pulls; nothing comes out.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);

  if (ctx.audioWorklet) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const tap = new AudioWorkletNode(ctx, 'pcm-tap');
      tap.port.onmessage = (e) => handle(e.data as Float32Array);
      source.connect(tap);
      tap.connect(mute);
      return () => {
        tap.port.onmessage = null;
        try { source.disconnect(tap); tap.disconnect(); mute.disconnect(); } catch { /* closing anyway */ }
      };
    } catch {
      /* fall through to the processor node */
    }
  }

  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(mute);
  return () => {
    node.onaudioprocess = null;
    try { source.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* closing anyway */ }
  };
}

async function openMic() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  // Ask for 16kHz directly — Whisper's rate — and let the browser do the
  // resampling in native code. It usually obliges; toSampleRate covers it if not.
  try {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    audioCtx = new AudioContext();
  }
  await audioCtx.resume();

  const source = audioCtx.createMediaStreamSource(stream);
  teardownGraph = await buildGraph(source, audioCtx, audioCtx.sampleRate);
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * Start dictating on-device. Assumes the caller has already opened a session and
 * picked where the words go — this only produces text.
 */
export async function startLocalSpeech(): Promise<void> {
  if (running) return;
  const voice = useVoiceStore.getState();

  // A worker from the last session is still alive with the model loaded. Reuse
  // it — reloading Whisper for every press would put a several-second stall in
  // front of a button people hit constantly.
  if (killTimer !== null) {
    clearTimeout(killTimer);
    killTimer = null;
  }

  running = true;
  speech = [];
  speechLen = 0;
  voicedMs = 0;
  peak = 0;
  preroll = [];
  prerollLen = 0;
  speaking = false;
  silenceMs = 0;
  quietMs = 0;
  level = 0;
  noiseFloor = MIN_END;
  heardAnything = false;
  loadFailed = false;

  voice.setEngine('local');
  voice.setIsListening(true);
  voice.setLive(false);

  // The model first, in the background — the mic prompt and the download should
  // overlap, not queue.
  requestModel();

  try {
    await openMic();
  } catch (err) {
    running = false;
    const name = (err as DOMException)?.name;
    voice.setNotice(null);
    voice.setError(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone blocked. Allow mic access for this site, then hit voice typing again.'
        : name === 'NotReadableError'
          ? 'The microphone is busy in another app. Close it and try again.'
          : 'No microphone found. Check that one is plugged in and not in use by another app.'
    );
    voice.setIsListening(false);
    closeDictation();
    return;
  }

  /* Stopped while the permission prompt was still up, or during the two frames
     it takes to build the audio graph. Without this the stream that arrives
     afterwards has nobody to close it: the recording indicator stays lit in the
     tab, and the microphone stays open until the page is closed. */
  if (!running) {
    teardownGraph?.();
    teardownGraph = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    return;
  }

  // Live means THE MIC IS OPEN — start talking. Whether the model has finished
  // downloading is a detail; the audio is kept and transcribed in order the
  // moment it lands.
  voice.setLive(true);
  if (!modelReady) {
    const pct = useVoiceStore.getState().progress;
    voice.setNotice(
      pct === null
        ? "Setting up voice typing — go ahead and talk, I'm recording."
        : `Setting up voice typing — ${pct}%. Keep talking, I'm recording.`
    );
  }

  // A stream that never delivers a single non-zero sample is a muted or dead
  // device, and the browser reports nothing at all when that happens.
  setTimeout(() => {
    if (running && !heardAnything) useVoiceStore.getState().setNotice(DEAD_MIC_NOTICE);
  }, 4000);
}

export function stopLocalSpeech(): void {
  if (!running) return;
  running = false;

  // Whatever was mid-sentence when they hit stop is still worth having.
  if (speaking && (speechLen / SAMPLE_RATE) * 1000 >= MIN_UTTERANCE_MS && voicedMs >= MIN_VOICED_MS) {
    submit(flatten(speech, speechLen));
  }

  speech = [];
  speechLen = 0;
  voicedMs = 0;
  peak = 0;
  preroll = [];
  prerollLen = 0;
  speaking = false;
  level = 0;

  teardownGraph?.();
  teardownGraph = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;

  const store = useVoiceStore.getState();
  store.setHearing(false);
  store.setLive(false);
  store.setIsListening(false);
  if (queue.length === 0 && !busy) {
    store.setNotice(null);
    closeDictation();
  }

  /* The worker outlives the microphone. That last sentence is still being
     transcribed — it lands a second or two after the button was pressed and is
     typed into the target then, which is why closeDictation waits for the queue
     to drain rather than firing here. */
  if (!worker) return;
  const dying = worker;
  if (killTimer !== null) clearTimeout(killTimer);
  const reap = () => {
    killTimer = null;
    if (running || worker !== dying) return;
    // Still finishing the last sentence — come back when it's done rather than
    // leaving the model resident for the life of the tab.
    if (busy || queue.length) {
      killTimer = setTimeout(reap, 60_000);
      return;
    }
    dying.terminate();
    worker = null;
    modelReady = false;
    modelLoading = false;
    busy = false;
    queue = [];
  };
  killTimer = setTimeout(reap, MODEL_IDLE_MS);
}
