import type { Region } from './pixels';

/**
 * What the vision model can pull out of a picture.
 *
 * Both calls below go through the existing `/api/vision` route (NIM
 * llama-3.2-90b-vision, with smaller models as failover), so this adds no new
 * server surface — it is entirely a matter of asking the right question and
 * being sceptical about the answer.
 *
 * BE SCEPTICAL ABOUT THE ANSWER is the operative half. A vision-language model
 * transcribes text well and names objects well; its bounding boxes are
 * approximate, and it will occasionally return prose where JSON was asked for,
 * or a box with coordinates outside 0…1, or the same object four times. Every
 * one of those is handled here as an expected outcome rather than an error,
 * and the UI presents regions as SUGGESTIONS you adjust before pulling — never
 * as a cut that has already been made.
 */

/** The image is downscaled before it goes up: the route caps the inline
 *  payload, and a vision model gains nothing from a 12-megapixel original. */
const VISION_MAX_EDGE = 1024;

export async function downscaleForVision(src: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    if (!src.startsWith('data:')) el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('The image could not be loaded.'));
    el.src = src;
  });

  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, VISION_MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  // A white bed under the image: a transparent PNG sent as JPEG turns its
  // transparent areas black, and a model reading black-on-black finds nothing.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function askVision(image: string, prompt: string): Promise<string> {
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, prompt }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.description) {
    throw new Error(json?.error || 'The vision model did not respond.');
  }
  return String(json.description).trim();
}

/* ========================================================================== */
/*  Text                                                                       */
/* ========================================================================== */

const OCR_PROMPT = [
  'Transcribe every piece of text visible in this image, exactly as written.',
  'Preserve the reading order, the line breaks, and the original wording and spelling.',
  'Do not translate, summarise, correct, or explain anything.',
  'Do not add any commentary, heading, or preamble.',
  'If the image contains no readable text at all, reply with exactly: NO_TEXT_FOUND',
].join(' ');

export interface GrabbedText {
  text: string;
  empty: boolean;
}

export async function grabText(src: string): Promise<GrabbedText> {
  const small = await downscaleForVision(src);
  const raw = await askVision(small, OCR_PROMPT);

  if (/^NO_TEXT_FOUND/i.test(raw) || !raw) return { text: '', empty: true };

  /* Models like to introduce themselves. Strip a leading "Here is the text…" /
     "The image contains…" line, but only when a colon ends it and more content
     follows — otherwise a genuine first line that happens to contain a colon
     ("Subject: Q3 revenue") would be thrown away. */
  let text = raw.replace(/^\s*(here (is|are)|the (image|text)|transcription)[^\n:]{0,60}:\s*\n/i, '');
  // Some models fence the transcription. Unwrap it rather than showing ```.
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  return { text, empty: text.length === 0 };
}

/* ========================================================================== */
/*  Objects                                                                    */
/* ========================================================================== */

const OBJECTS_PROMPT = [
  'List the distinct visual objects in this image that could be cut out on their own.',
  'Reply with ONLY a JSON array, no prose and no code fence.',
  'Each element must be {"label":"<short noun>","box":[x,y,w,h]}.',
  'x and y are the top-left corner, w and h the size, ALL as fractions of the image between 0 and 1.',
  'Give at most 8 objects, largest and most prominent first.',
  'Do not include the background itself as an object.',
  'Example: [{"label":"coffee cup","box":[0.12,0.30,0.25,0.40]}]',
].join(' ');

export interface DetectedObject {
  label: string;
  region: Region;
}

/** Pull the first JSON array out of a reply that may be wrapped in prose. */
function parseJsonArray(raw: string): unknown[] {
  const fenced = raw.replace(/```[a-z]*/gi, '').trim();
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function detectObjects(src: string): Promise<DetectedObject[]> {
  const small = await downscaleForVision(src);
  const raw = await askVision(small, OBJECTS_PROMPT);

  const out: DetectedObject[] = [];
  for (const entry of parseJsonArray(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { label?: unknown; box?: unknown };
    const box = e.box;
    if (!Array.isArray(box) || box.length < 4) continue;

    const nums = box.slice(0, 4).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;

    // Some replies give 0–100 rather than 0–1 despite being told twice. If any
    // value is over 1 the whole box is on the other scale — rescale it rather
    // than discarding a perfectly good detection.
    const scale = nums.some((n) => n > 1.5) ? 0.01 : 1;
    let [x, y, w, h] = nums.map((n) => n * scale);

    // Clamp into frame. A box that starts in-frame and overruns the edge is
    // normal and worth keeping, trimmed.
    x = Math.max(0, Math.min(0.98, x));
    y = Math.max(0, Math.min(0.98, y));
    w = Math.max(0.02, Math.min(1 - x, w));
    h = Math.max(0.02, Math.min(1 - y, h));

    // A "region" covering essentially the whole picture is the model describing
    // the image, not finding a thing inside it.
    if (w * h > 0.92) continue;

    const label = typeof e.label === 'string' && e.label.trim()
      ? e.label.trim().slice(0, 40)
      : 'object';

    // Near-duplicate boxes: the same object named twice.
    if (out.some((o) => Math.abs(o.region.x - x) < 0.05 && Math.abs(o.region.y - y) < 0.05
      && Math.abs(o.region.w - w) < 0.05 && Math.abs(o.region.h - h) < 0.05)) continue;

    out.push({ label, region: { x, y, w, h } });
    if (out.length >= 8) break;
  }
  return out;
}
