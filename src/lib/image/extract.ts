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

export interface GrabbedText {
  text: string;
  empty: boolean;
  /** Ready to spread onto a text block's `style`. */
  style: TextStyle;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  textColor?: string;
}

/* The board's own faces, mapped from the five categories a vision model can
   actually judge reliably. Asking it to name a typeface produces confident
   nonsense ("Helvetica Neue Condensed"); asking whether the lettering is
   serif, sans, monospace, handwritten or a display face is a question about
   shape that it answers well — and those five map cleanly onto faces this app
   already loads. */
const FONT_BY_KIND: Record<string, string> = {
  serif: "'Lora', serif",
  sans: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
  handwriting: "'Caveat', cursive",
  display: "'Bebas Neue', sans-serif",
};

const STYLED_OCR_PROMPT = [
  'Transcribe every piece of text visible in this image, exactly as written, preserving reading order and line breaks.',
  'Then describe how it is SET.',
  'Reply with ONLY a JSON object, no prose and no code fence:',
  '{"text":"<the transcription, \\n for line breaks>",',
  '"font":"serif|sans|mono|handwriting|display",',
  '"weight":"light|regular|medium|bold|black",',
  '"align":"left|center|right",',
  '"scale":"caption|body|subhead|title|display"}',
  'Judge "font" by letter shapes only. Judge "scale" by how large the lettering is relative to the image.',
  'If there is no readable text, reply exactly: {"text":""}',
].join(' ');

const WEIGHT_BY_NAME: Record<string, number> = {
  light: 300, regular: 400, medium: 500, bold: 700, black: 900,
};
const SIZE_BY_SCALE: Record<string, number> = {
  caption: 13, body: 16, subhead: 22, title: 32, display: 46,
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```[a-z]*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

interface TextTraits {
  /** The ink colour, or undefined when nothing looked like lettering. */
  color?: string;
  /** Cap height of a line of text as a FRACTION of the image width, so it can
   *  be turned into a font size for a block of any width. */
  sizeRatio?: number;
}

/**
 * The colour and size of the lettering — measured off the pixels, not asked for.
 *
 * A vision model will happily report "dark blue" for text that is #12233a, and
 * a hex it invents is worse than none at all. It is also unreliable about size:
 * asked to bucket the same 44px heading it answered "title" once and "body" the
 * next time. The pixels know both exactly.
 *
 * FINDING THE INK IS THE INTERESTING PART. The obvious rule — "the most common
 * colour that isn't the background" — is wrong on any picture with a big block
 * of colour in it: on a chart with a green rectangle and a navy caption, the
 * rectangle wins by area and the caption is never even considered. Measured on
 * exactly that image, the first version of this returned the rectangle's green.
 *
 * What actually distinguishes lettering is that it is THIN. Almost every pixel
 * of a glyph is next to a pixel of background, while almost none of a filled
 * rectangle's are. So each candidate colour is scored on the share of its
 * pixels that touch the background — its perimeter-to-area ratio — and the
 * thinnest sufficiently-common colour is the ink. That is a property of strokes
 * rather than of hue, so it holds for any colour of text on any colour of page.
 */
async function measureTextTraits(src: string): Promise<TextTraits> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      if (!src.startsWith('data:')) el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load failed'));
      el.src = src;
    });

    const iw = img.naturalWidth || img.width;
    const w = Math.min(360, iw);
    const scale = w / iw;
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return {};
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const key = (i: number) => ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const counts = new Map<number, { n: number; r: number; g: number; b: number; edge: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const k = key(i);
      const cur = counts.get(k) || { n: 0, r: 0, g: 0, b: 0, edge: 0 };
      cur.n++; cur.r += data[i]; cur.g += data[i + 1]; cur.b += data[i + 2];
      counts.set(k, cur);
    }
    if (counts.size < 2) return {};

    let bgKey = -1;
    let bgN = -1;
    for (const [k, v] of counts) if (v.n > bgN) { bgN = v.n; bgKey = k; }

    /* Second pass: each colour's perimeter-to-area ratio.
       The test is "does this pixel touch a DIFFERENT colour", not "does it
       touch the background". Glyph edges are anti-aliased, so the pixels
       bordering a letter are blends that belong to neither the ink bucket nor
       the paper bucket — asking for the background specifically meant almost no
       core text pixel counted as an edge, text scored ~0 for thinness, and a
       fat colour block won every time. Measured on a chart with a green
       rectangle and a navy caption, that returned the rectangle's green as the
       "ink" and its 160px height as the type size. */
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        const k = key(i);
        if (k === bgKey) continue;
        const touches =
          (x > 0 && key(i - 4) !== k) ||
          (x < w - 1 && key(i + 4) !== k) ||
          (y > 0 && key(i - w * 4) !== k) ||
          (y < h - 1 && key(i + w * 4) !== k);
        if (touches) counts.get(k)!.edge++;
      }
    }

    const totalPixels = w * h;
    let best: { k: number; r: number; g: number; b: number; thin: number } | null = null;
    for (const [k, v] of counts) {
      if (k === bgKey) continue;
      // Present enough to be deliberate, not so dominant it is clearly a field
      // of colour rather than writing.
      if (v.n / totalPixels < 0.0015 || v.n / totalPixels > 0.34) continue;
      const thin = v.edge / v.n;
      if (!best || thin > best.thin) best = { k, r: v.r / v.n, g: v.g / v.n, b: v.b / v.n, thin };
    }
    /* A glyph is nearly all edge; a filled shape is nearly all interior. Half
       is a wide gulf between the two — a 100px square scores 0.04, and even
       chunky display type scores well above 0.5. */
    if (!best || best.thin < 0.5) return {};

    const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    const color = `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;

    /* Size: find the rows that contain ink, group them into the bands that are
       lines of text, and take the MEDIAN band height. The median rather than
       the mean because a stray descender or a rule across the page would drag
       an average around, and text is the thing there is most of. */
    const rowHasInk: boolean[] = new Array(h).fill(false);
    for (let y = 0; y < h; y++) {
      let hits = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] >= 128 && key(i) === best.k) hits++;
      }
      rowHasInk[y] = hits > 0;
    }
    const bands: number[] = [];
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (rowHasInk[y]) run++;
      else { if (run > 1) bands.push(run); run = 0; }
    }
    if (run > 1) bands.push(run);
    if (!bands.length) return { color };

    bands.sort((a, b) => a - b);
    const median = bands[Math.floor(bands.length / 2)];
    // Back to the ORIGINAL image's scale, then expressed against its width so
    // the caller can size text for a block of any width.
    return { color, sizeRatio: (median / scale) / iw };
  } catch {
    return {};
  }
}

/**
 * @param blockWidth on-canvas width the text will be laid into. The measured
 *   cap height is a fraction of the picture's width, so multiplying by the new
 *   block's width reproduces the SAME visual relationship — text that filled a
 *   third of the picture fills a third of the block.
 */
export async function grabText(src: string, blockWidth = 380): Promise<GrabbedText> {
  const small = await downscaleForVision(src);
  const [raw, traits] = await Promise.all([
    askVision(small, STYLED_OCR_PROMPT),
    /* Measured on the ORIGINAL, never on the copy made for the model. That copy
       is JPEG at quality 0.85, and JPEG puts noise into flat areas — so at the
       4-bit bucketing used here, a solid rectangle stops being one colour and
       every one of its pixels borders a slightly different neighbour. The
       perimeter-to-area test that identifies lettering then scores a filled
       block as high as a glyph, and the block wins on size. Compression
       artefacts are invisible to the eye and enormous to this measurement. */
    measureTextTraits(src),
  ]);

  const inkColor = traits.color;
  // Measured size wins; the model's coarse bucket is only the fallback.
  const measuredSize = traits.sizeRatio
    ? Math.round(Math.max(11, Math.min(120, traits.sizeRatio * blockWidth)))
    : undefined;

  const fallbackStyle: TextStyle = {
    fontFamily: FONT_BY_KIND.sans,
    fontSize: measuredSize ?? 16,
    fontWeight: 400,
    textAlign: 'left',
    textColor: inkColor,
  };

  const parsed = parseJsonObject(raw);

  /* No JSON came back. Rather than failing, treat the whole reply as the
     transcription — the model still read the image, it just answered in the
     shape it felt like. Losing the formatting is a far better outcome than
     losing the words. */
  if (!parsed) {
    let text = raw.replace(/^\s*(here (is|are)|the (image|text)|transcription)[^\n:]{0,60}:\s*\n/i, '');
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    if (/^NO_TEXT_FOUND/i.test(text)) return { text: '', empty: true, style: fallbackStyle };
    return { text, empty: text.length === 0, style: fallbackStyle };
  }

  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) return { text: '', empty: true, style: fallbackStyle };

  const kind = String(parsed.font || 'sans').toLowerCase();
  const weightName = String(parsed.weight || 'regular').toLowerCase();
  const align = String(parsed.align || 'left').toLowerCase();
  const scale = String(parsed.scale || 'body').toLowerCase();

  return {
    text,
    empty: false,
    style: {
      fontFamily: FONT_BY_KIND[kind] || FONT_BY_KIND.sans,
      fontSize: measuredSize ?? SIZE_BY_SCALE[scale] ?? 16,
      fontWeight: WEIGHT_BY_NAME[weightName] ?? 400,
      textAlign: align === 'center' || align === 'right' ? align : 'left',
      textColor: inkColor,
    },
  };
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
