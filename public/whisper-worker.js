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
 *   { type: 'load' }
 *   { type: 'transcribe', id, audio: Float32Array @16kHz, language, final }
 * and gets back:
 *   { type: 'progress', percent }   model still downloading
 *   { type: 'ready' }
 *   { type: 'result', id, text, final }
 *   { type: 'error', message }
 */

/* Pinned. Whichever host answers first wins — one blocked CDN shouldn't take
   dictation down with it. */
const VERSION = '3.7.6';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION}`,
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION}/+esm`,
  `https://unpkg.com/@huggingface/transformers@${VERSION}`,
];

/* Whisper, smallest useful size. `base` on a GPU is comfortably faster than
   real time; on the WASM backend — single-threaded, because threads would need
   COOP/COEP headers that would break the app's embedded browser — `tiny` is the
   one that keeps up. Both are multilingual: `.en` variants would have made this
   an English-only feature, and the people who hit the Google outage most are the
   ones not dictating in English. */
const MODEL_GPU = 'onnx-community/whisper-base';
const MODEL_CPU = 'onnx-community/whisper-tiny';

let transcriber = null;
let ready = null;
/** Which model/backend actually came up, for the ready message. */
let engine = '';

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

async function importLib() {
  let last;
  for (const url of SOURCES) {
    try {
      return await import(url);
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`Could not load the speech model library (${last?.message || 'network error'}).`);
}

async function load() {
  const { pipeline, env } = await importLib();

  // Weights come from the Hub and are cached by the browser afterwards, so the
  // download in this worker happens exactly once per machine.
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (!webgpu && env.backends?.onnx?.wasm) {
    // No SharedArrayBuffer without cross-origin isolation, and ORT will hang
    // trying to spawn threads it can't have. Say single-threaded up front.
    env.backends.onnx.wasm.numThreads = 1;
  }

  const attempts = webgpu
    ? [
        { model: MODEL_GPU, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
        { model: MODEL_CPU, device: 'wasm', dtype: 'q8' },
      ]
    : [
        { model: MODEL_CPU, device: 'wasm', dtype: 'q8' },
        { model: MODEL_CPU, device: 'wasm', dtype: 'fp32' },
      ];

  let last;
  for (const attempt of attempts) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', attempt.model, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: reportProgress,
      });
      engine = `${attempt.model} on ${attempt.device}`;
      return;
    } catch (err) {
      last = err;
      files.clear();
    }
  }
  throw new Error(`Could not start on-device speech (${last?.message || 'unknown error'}).`);
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'load') {
    try {
      ready = ready || load();
      await ready;
      self.postMessage({ type: 'ready', engine });
    } catch (err) {
      ready = null;
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      ready = ready || load();
      await ready;

      const started = performance.now();

      // Whisper is multilingual but guesses badly on a two-second clip, so it is
      // told what it's listening to. If the model doesn't know that language,
      // fall back to letting it decide rather than failing the utterance.
      let out;
      try {
        out = await transcriber(msg.audio, { language: msg.language, task: 'transcribe' });
      } catch {
        out = await transcriber(msg.audio, { task: 'transcribe' });
      }

      const text = (Array.isArray(out) ? out[0]?.text : out?.text) || '';
      self.postMessage({
        type: 'result',
        id: msg.id,
        text: text.trim(),
        final: msg.final,
        ms: Math.round(performance.now() - started),
        engine,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err), id: msg.id });
    }
  }
};
