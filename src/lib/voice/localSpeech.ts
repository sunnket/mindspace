'use client';

import { useVoiceStore } from '@/store/voiceStore';

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
 * 3 seconds and it invents endings for the halves. So a simple energy gate watches
 * for you to start talking, keeps a moment of audio from *before* that (or the
 * first syllable is always missing), and only closes the clip when you actually
 * stop. Long pause = finished sentence = one clean transcription.
 */

const SAMPLE_RATE = 16_000;

/** Speech starts above this RMS and doesn't end until it drops below the lower
 *  one — one threshold alone chatters on and off through every breath. */
const RMS_START = 0.014;
const RMS_END = 0.007;

const SILENCE_END_MS = 750;      // quiet for this long = the sentence is over
const PREROLL_MS = 400;          // audio kept from before speech was detected
const MIN_UTTERANCE_MS = 320;    // shorter than this is a cough, not a word
const MAX_UTTERANCE_MS = 18_000; // cut a monologue up rather than lag forever
const INTERIM_EVERY_MS = 1_600;  // show a running guess while you're still talking

type Job = { id: number; audio: Float32Array; final: boolean };

let worker: Worker | null = null;
let killTimer: ReturnType<typeof setTimeout> | null = null;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let running = false;
let modelReady = false;

/* Audio state */
let speech: Float32Array[] = [];   // the utterance being collected
let speechLen = 0;
let preroll: Float32Array[] = [];  // rolling buffer of what came just before it
let prerollLen = 0;
let speaking = false;
let silenceMs = 0;
let lastInterimAt = 0;

/* Worker state — one job in flight, at most one interim waiting behind it. */
let busy = false;
let queue: Job[] = [];
let jobId = 0;

const prerollCap = () => (PREROLL_MS / 1000) * SAMPLE_RATE;

export const isLocalSpeechRunning = () => running;

/**
 * Whisper is trained on captioned video and, given silence or room tone, will
 * confidently produce the caption that most often accompanies it. Everyone who
 * ships this model filters the same handful of ghosts.
 */
const HALLUCINATIONS = new Set([
  'thank you', 'thanks for watching', 'thank you for watching', 'you', 'bye',
  'subscribe', 'please subscribe', 'okay', 'so', 'mbc 뉴스 이덕영입니다',
  'thanks for watching!', 'transcription by castingwords', '.', '. .',
]);

function isGhost(text: string): boolean {
  const bare = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return bare.length === 0 || HALLUCINATIONS.has(bare);
}

/** Whisper wants a 2-letter language code, and it wants the language, not the
 *  locale: `en-IN` is English to it. */
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

function pump() {
  if (busy || !worker || !modelReady) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  // Transferred, not copied — the buffer is dead to us after this, which is why
  // every job gets its own slice.
  worker.postMessage({ type: 'transcribe', id: job.id, audio: job.audio, language: language(), final: job.final },
    [job.audio.buffer]);
}

function submit(audio: Float32Array, final: boolean) {
  // A finished sentence must never be dropped; a running guess is disposable, so
  // a newer one always replaces an older one still sitting in the queue.
  if (!final) queue = queue.filter((j) => j.final);
  queue.push({ id: ++jobId, audio, final });
  pump();
}

function onWorkerMessage(event: MessageEvent) {
  const msg = event.data;
  const voice = useVoiceStore.getState();

  if (msg.type === 'progress') {
    voice.setNotice(`Setting up on-device voice typing… ${msg.percent}%`);
    return;
  }

  if (msg.type === 'ready') {
    modelReady = true;
    voice.setNotice(null);
    voice.setLive(true);
    console.info(`[voice] on-device speech ready: ${msg.engine}`);
    pump();
    return;
  }

  if (msg.type === 'result') {
    busy = false;
    const text: string = msg.text || '';
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[voice] transcribed in ${msg.ms}ms (${msg.engine})`);
    }

    if (msg.final) {
      voice.setInterimTranscript('');
      if (!isGhost(text)) voice.appendTranscript(text);
    } else if (!isGhost(text)) {
      voice.setInterimTranscript(text);
    }

    pump();
    return;
  }

  if (msg.type === 'error') {
    busy = false;
    // A single utterance failing is not worth killing the session over; failing
    // to load at all is.
    if (!modelReady) {
      voice.setError(msg.message || 'On-device voice typing could not start.');
      stopLocalSpeech();
    }
    pump();
  }
}

/* -------------------------------------------------------------------- audio */

function endUtterance() {
  const ms = (speechLen / SAMPLE_RATE) * 1000;
  const audio = ms >= MIN_UTTERANCE_MS ? flatten(speech, speechLen) : null;

  speech = [];
  speechLen = 0;
  speaking = false;
  silenceMs = 0;
  useVoiceStore.getState().setHearing(false);

  if (audio) submit(audio, true);
  else useVoiceStore.getState().setInterimTranscript('');
}

function onAudio(block: Float32Array) {
  if (!running) return;

  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / block.length);
  const ms = (block.length / SAMPLE_RATE) * 1000;
  const now = performance.now();

  if (!speaking) {
    // Hold the last fraction of a second of room tone. When speech does start,
    // this is what carries the attack of the first word into the clip.
    preroll.push(block);
    prerollLen += block.length;
    while (prerollLen > prerollCap() && preroll.length > 1) {
      prerollLen -= preroll[0].length;
      preroll.shift();
    }

    if (rms > RMS_START) {
      speaking = true;
      silenceMs = 0;
      speech = [...preroll, block];
      speechLen = prerollLen + block.length;
      preroll = [];
      prerollLen = 0;
      lastInterimAt = now;
      useVoiceStore.getState().setHearing(true);
      useVoiceStore.getState().setIsPaused(false);
    }
    return;
  }

  speech.push(block);
  speechLen += block.length;

  if (rms < RMS_END) {
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

  if ((speechLen / SAMPLE_RATE) * 1000 >= MAX_UTTERANCE_MS) {
    endUtterance();
    return;
  }

  // A running guess, so words appear while you're still speaking instead of only
  // when you stop. Skipped while the model is chewing on something else — the
  // finished sentence is what matters and it must not queue behind guesses.
  if (modelReady && !busy && now - lastInterimAt > INTERIM_EVERY_MS && speechLen > SAMPLE_RATE * 0.8) {
    lastInterimAt = now;
    submit(flatten(speech, speechLen), false);
  }
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

  const rate = audioCtx.sampleRate;
  const source = audioCtx.createMediaStreamSource(stream);

  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  try {
    await audioCtx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const tap = new AudioWorkletNode(audioCtx, 'pcm-tap');
  tap.port.onmessage = (e) => onAudio(toSampleRate(e.data as Float32Array, rate));

  // A worklet only runs while it's connected to the destination — but connecting
  // the microphone to the speakers is a feedback howl, so it goes through a gain
  // of zero. The graph pulls; nothing comes out.
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(tap);
  tap.connect(mute);
  mute.connect(audioCtx.destination);
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * Start dictating on-device. Assumes the caller has already opened a session and
 * picked the block the words go into — this only produces text.
 */
export async function startLocalSpeech(): Promise<void> {
  if (running) return;
  const voice = useVoiceStore.getState();

  // A worker from the last session may still be alive with the model loaded.
  // Reuse it — reloading Whisper for every press would put a several-second
  // stall in front of a button people hit constantly.
  if (killTimer !== null) {
    clearTimeout(killTimer);
    killTimer = null;
  }

  running = true;
  speech = [];
  speechLen = 0;
  preroll = [];
  prerollLen = 0;
  speaking = false;
  silenceMs = 0;
  queue = [];
  busy = false;

  voice.setEngine('local');
  voice.setIsListening(true);
  voice.setLive(modelReady);
  if (!modelReady) voice.setNotice('Setting up on-device voice typing…');

  try {
    // The mic first: a permission prompt the user never sees the reason for is
    // worse than a slow start, and the model download is the long pole anyway.
    await openMic();
  } catch (err) {
    running = false;
    const name = (err as DOMException)?.name;
    voice.setNotice(null);
    voice.setError(
      name === 'NotAllowedError'
        ? 'Microphone blocked. Allow mic access for this site, then hit voice typing again.'
        : 'No microphone found. Check that one is plugged in and not in use by another app.'
    );
    voice.setIsListening(false);
    return;
  }

  if (!worker) {
    worker = new Worker('/whisper-worker.js', { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => {
      if (modelReady) return;
      voice.setError('On-device voice typing failed to load. Check your connection and try again.');
      stopLocalSpeech();
    };
  }
  if (!modelReady) worker.postMessage({ type: 'load' });
}

export function stopLocalSpeech(): void {
  if (!running) return;
  running = false;

  // Whatever was mid-sentence when they hit stop is still worth having, so long
  // as the model is up to transcribe it.
  if (modelReady && speaking && (speechLen / SAMPLE_RATE) * 1000 >= MIN_UTTERANCE_MS) {
    submit(flatten(speech, speechLen), true);
  }

  speech = [];
  speechLen = 0;
  preroll = [];
  prerollLen = 0;
  speaking = false;

  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;

  const store = useVoiceStore.getState();
  store.setHearing(false);
  store.setLive(false);
  store.setNotice(null);
  store.setIsListening(false);

  /* The worker outlives the microphone. That last sentence is still being
     transcribed — it lands a second or two after the button was pressed, and
     VoiceOrb keeps typing into the block for as long as the session's target is
     set, so it still arrives. Killing the worker here would throw it away. */
  const dying = worker;
  if (!dying) {
    modelReady = false;
    return;
  }
  if (killTimer !== null) clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    killTimer = null;
    if (running || worker !== dying) return; // a new session took it over
    dying.terminate();
    worker = null;
    modelReady = false;
    busy = false;
    queue = [];
  }, 90_000); // long enough that the next press finds the model still warm
}
