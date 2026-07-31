/**
 * On-device speech recognition. The reason voice typing has a second engine at all.
 *
 * Chrome's Web Speech API is not on-device: it streams your microphone to Google's
 * servers and streams words back. When that backend is unreachable — a Chromium
 * build with no Google API key (every embedded/IDE preview browser, Brave, most
 * forks), a network that blocks it, or a region where it isn't served — it throws
 * `network` on every single start, forever, no matter how good your connection is.
 * There is nothing to retry. So we run Whisper here instead, in the browser, and
 * dictation keeps working with Google out of the picture entirely.
 *
 * This is a plain file in /public, not a bundled module, on purpose: it imports
 * transformers.js straight from a CDN, so nothing about it can break the build.
 *
 * Protocol — main thread sends:
 *   { type: 'load', source? }   source = the CDN that worked last time
 *   { type: 'transcribe', id, audio: Float32Array @16kHz, language }
 * and gets back:
 *   { type: 'progress', percent }   model still downloading
 *   { type: 'warming' }             downloaded, running the first pass
 *   { type: 'ready', engine, source }
 *   { type: 'result', id, text, ms, engine }
 *   { type: 'error', message, id? }
 */

/* Pinned. Whichever host answers first wins — one blocked CDN shouldn't take
   dictation down with it. */
const VERSION = '3.7.6';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION}`,
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION}/+esm`,
  `https://unpkg.com/@huggingface/transformers@${VERSION}`,
];

/* ONE MODEL, ONE DOWNLOAD.
 *
 * This used to branch on WebGPU and pull `whisper-base` with an fp32 encoder and
 * a q4 decoder. Those two files are 78.6 MB and 117.9 MB — measured, not
 * guessed. Two hundred megabytes, before anyone had said a word, on the machines
 * MOST likely to have it (any recent Chrome on a GPU). That is the entire
 * "why does voice typing take forever to start".
 *
 * whisper-tiny quantized is 41.6 MB all in, it is multilingual (`.en` variants
 * would have made dictation English-only, and the people whose browsers can't
 * reach Google's service are disproportionately the ones not dictating in
 * English), and the SAME files run on both backends — so the fallback below
 * costs a session rebuild, never a second download.
 */
const MODEL = 'onnx-community/whisper-tiny';

let transcriber = null;
let ready = null;
/** Which model/backend actually came up, for the ready message. */
let engine = '';
/** The CDN that answered, handed back so the next load starts with it. */
let source = '';

/** Total bytes are only known file-by-file, so track them as they show up. */
const files = new Map();
function reportProgress(item) {
  if (!item || item.status !== 'progress' || !item.file || !item.total) return;
  files.set(item.file, { loaded: item.loaded || 0, total: item.total });
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  if (total > 0) {
    self.postMessage({ type: 'progress', percent: Math.min(99, Math.round((loaded / total) * 100)) });
  }
}

async function importLib(preferred) {
  // The remembered host first: retrying a CDN that's blocked on this network
  // costs a full timeout before the fallback even starts, and it's the same one
  // every time.
  const urls = preferred ? [preferred, ...SOURCES.filter((u) => u !== preferred)] : SOURCES;
  let last;
  for (const url of urls) {
    try {
      const lib = await import(url);
      source = url;
      return lib;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`Could not load the speech model library (${last?.message || 'network error'}).`);
}

async function load(preferred) {
  const { pipeline, env } = await importLib(preferred);

  // Weights come from the Hub and are cached by the browser afterwards, so the
  // download in this worker happens exactly once per machine.
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (env.backends?.onnx?.wasm) {
    // No SharedArrayBuffer without cross-origin isolation, and ORT will hang
    // trying to spawn threads it can't have. Say single-threaded up front.
    if (!webgpu) env.backends.onnx.wasm.numThreads = 1;
    // We are already off the main thread; ORT's own proxy worker is a second
    // hop for every tensor and a second copy of the runtime to download.
    env.backends.onnx.wasm.proxy = false;
  }

  /* WASM first even where there's a GPU: it is the path that always works, and
     its weights are the small ones. WebGPU is tried after it as a session
     rebuild over files already on disk — pure upside, no extra bytes. fp16 on
     the GPU is a last resort and the only attempt that costs another download,
     so it only ever runs if the cheap two both failed. */
  const attempts = [
    { device: 'wasm', dtype: 'q8' },
    ...(webgpu ? [{ device: 'webgpu', dtype: 'q8' }, { device: 'webgpu', dtype: 'fp16' }] : []),
  ];

  let last;
  for (const attempt of attempts) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: reportProgress,
      });
      engine = `${MODEL} on ${attempt.device} (${attempt.dtype})`;
      return;
    } catch (err) {
      last = err;
      files.clear();
    }
  }
  throw new Error(`Could not start on-device speech (${last?.message || 'unknown error'}).`);
}

/**
 * Decoding options that stop Whisper talking to itself.
 *
 * `no_repeat_ngram_size` is the one that matters: the model's failure mode on a
 * clip that runs out of speech is to emit the same phrase until it hits the token
 * limit — "Hey, hey, hey, hey." — and a decoder that can't repeat a 4-gram
 * simply cannot do it. `max_new_tokens` bounds the damage of anything that gets
 * past it, since 18 seconds of speech is never 200 tokens.
 */
function decodeOptions(language) {
  return {
    language,
    task: 'transcribe',
    return_timestamps: false,
    no_repeat_ngram_size: 4,
    max_new_tokens: 180,
  };
}

/**
 * The first inference is several times slower than every one after it — the WASM
 * runtime compiles, the graph gets allocated, buffers get sized. Paying that on
 * the user's first sentence is exactly what "the model takes forever" feels like,
 * so it's paid here, on silence, before `ready` is ever sent. The main thread
 * preloads on idle, which puts this in dead time nobody is waiting through.
 */
async function warmUp() {
  try {
    self.postMessage({ type: 'warming' });
    const quiet = new Float32Array(16_000);
    // Not pure zeros: a dead-flat signal is a shape the encoder can shortcut.
    for (let i = 0; i < quiet.length; i++) quiet[i] = (Math.random() - 0.5) * 1e-4;
    await transcriber(quiet, { task: 'transcribe', return_timestamps: false, max_new_tokens: 8 });
  } catch {
    /* the real utterances will tell us soon enough if something's wrong */
  }
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'load') {
    try {
      ready = ready || load(msg.source || null);
      await ready;
      await warmUp();
      self.postMessage({ type: 'ready', engine, source });
    } catch (err) {
      ready = null;
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      ready = ready || load(msg.source || null);
      await ready;

      const started = performance.now();

      // Whisper is multilingual but guesses badly on a two-second clip, so it is
      // told what it's listening to. If the model doesn't know that language —
      // or rejects a decode option — fall back rather than lose the utterance.
      let out;
      try {
        out = await transcriber(msg.audio, decodeOptions(msg.language));
      } catch {
        try {
          out = await transcriber(msg.audio, decodeOptions(undefined));
        } catch {
          out = await transcriber(msg.audio, { task: 'transcribe' });
        }
      }

      const text = (Array.isArray(out) ? out[0]?.text : out?.text) || '';
      self.postMessage({
        type: 'result',
        id: msg.id,
        text: text.trim(),
        ms: Math.round(performance.now() - started),
        engine,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err), id: msg.id });
    }
  }
};
