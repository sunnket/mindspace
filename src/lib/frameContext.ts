import type { CanvasObjectData, ConnectionData, DrawingStroke } from './db';
import { parseRepoPayload } from './repoIngest';
import { objectsInFrame, strokesInFrame, connectionsInFrame, frameRect, frameTitle } from './frames';

/**
 * Everything inside an agent frame, turned into something a language model can
 * actually reason about.
 *
 * The canvas chat's snapshot is deliberately thin — 160 characters per block,
 * enough to say "there's a note over there". An agent frame is the opposite
 * contract: the user drew a box and expects the AI to know EVERY word, number,
 * task, file and picture inside it. So this reads each block by its real type
 * and unpacks the payload the block actually stores (todo items and repo trees
 * live in `content` as JSON; file text, chart series, poll options and link
 * metadata live in `style`), and images are sent to the vision model so the
 * agent sees them rather than reading "[image]".
 */

/** Text budget for the whole region — comfortably inside the model's window. */
const REGION_TEXT_CAP = 90_000;
/** Per-block cap, so one enormous file can't crowd out the other 20 blocks. */
const PER_BLOCK_CAP = 12_000;
/** Vision is slow and rate-limited; look at the most prominent images only. */
const MAX_VISION_IMAGES = 6;

function clip(s: string, n: number): string {
  const t = (s || '').trim();
  return t.length > n ? `${t.slice(0, n)}\n…[truncated]` : t;
}

function fmtJson(v: unknown, n = 1200): string {
  try {
    return clip(JSON.stringify(v), n);
  } catch {
    return '';
  }
}

/** A human/model-readable rendering of one block: what it is and what it says. */
export function describeObject(o: CanvasObjectData, index: number): string {
  const s = (o.style || {}) as Record<string, unknown>;
  const head = `[${index}] id=${o.id} type=${o.type} at(${Math.round(o.x)},${Math.round(o.y)}) size(${Math.round(o.width)}x${Math.round(o.height)})`;
  const body: string[] = [];

  const raw = (o.content || '').trim();

  if (s.isRepo) {
    const repo = parseRepoPayload(o.content || '');
    if (repo) {
      body.push(`CODE REPOSITORY "${repo.name}" — ${repo.meta?.fileCount ?? repo.files.length} files`);
      body.push('File tree:');
      body.push(repo.files.slice(0, 200).map((f) => `  ${f.path}${f.binary ? ' (binary)' : ''}`).join('\n'));
      const withText = repo.files.filter((f) => f.text && !f.binary).slice(0, 12);
      for (const f of withText) {
        body.push(`--- ${f.path} ---\n${clip(f.text || '', 2500)}`);
      }
    } else {
      body.push('CODE REPOSITORY (still loading)');
    }
  } else if (s.isFile) {
    const status = (s.fileTextStatus as string) || '';
    body.push(`FILE "${(s.fileName as string) || 'file'}"${s.fileType ? ` (${s.fileType})` : ''}`);
    const text = (s.fileText as string) || '';
    if (text) body.push(`Contents:\n${clip(text, PER_BLOCK_CAP)}`);
    else body.push(status === 'reading' ? 'Contents: still being extracted.' : 'Contents: not extracted.');
  } else if (s.isTodo) {
    body.push(`TASK LIST "${(s.todoTitle as string) || 'todos'}"`);
    try {
      const items = JSON.parse(raw || '[]');
      if (Array.isArray(items)) {
        body.push(items.map((it: { text?: string; done?: boolean }) => `  [${it?.done ? 'x' : ' '}] ${it?.text ?? ''}`).join('\n'));
      }
    } catch { /* not parseable — fall through to raw */ }
  } else if (s.isTimeline) {
    body.push(`TIMELINE "${(s.timelineTitle as string) || 'timeline'}"`);
    body.push(fmtJson(s.timelineItems, 3000));
  } else if (s.isChart) {
    body.push(`CHART "${(s.chartTitle as string) || ''}" (${(s.chartType as string) || 'chart'})`);
    body.push(`Data: ${fmtJson(s.chartData, 2500)}`);
  } else if (s.isPoll) {
    body.push(`POLL "${(s.pollQuestion as string) || ''}"`);
    body.push(`Options: ${fmtJson(s.pollOptions, 1200)}`);
  } else if (s.isDecision) {
    body.push(`DECISION "${(s.decisionTitle as string) || ''}"`);
    body.push(`Options: ${fmtJson(s.decisionOptions, 800)}`);
    if (s.decisionResult) body.push(`Result: ${String(s.decisionResult)}`);
  } else if (s.isCountdown) {
    body.push(`COUNTDOWN "${(s.countdownTitle as string) || ''}" → ${String(s.countdownDate || '')}`);
  } else if (s.isProgress) {
    body.push(`PROGRESS "${(s.progressLabel as string) || ''}" = ${String(s.progressValue ?? '')}%`);
  } else if (s.isLiveMetric) {
    body.push(`METRIC "${(s.metricTitle as string) || ''}" = ${String(s.metricValue ?? '')} (${String(s.metricTrend ?? '')})`);
  } else if (s.isVoiceNote) {
    body.push('VOICE NOTE');
    body.push(`Transcript: ${clip((s.transcript as string) || raw, PER_BLOCK_CAP)}`);
  } else if (s.isLinkPreview || s.linkUrl) {
    body.push(`LINK ${(s.linkUrl as string) || raw}`);
    if (s.linkTitle) body.push(`Title: ${String(s.linkTitle)}`);
    if (s.linkDescription) body.push(`Description: ${String(s.linkDescription)}`);
  } else if (s.isGithub) {
    body.push(`GITHUB BLOCK: ${clip(raw, 2000)}`);
  } else if (s.isCode) {
    body.push(`CODE BLOCK${s.codeLang ? ` (${String(s.codeLang)})` : ''}:\n${clip(raw, PER_BLOCK_CAP)}`);
  } else if (s.isMermaid) {
    body.push(`DIAGRAM (mermaid):\n${clip(raw, 3000)}`);
  } else if (s.isQuote) {
    body.push(`QUOTE: ${clip(raw, 2000)}`);
  } else if (s.isCallout) {
    body.push(`CALLOUT (${(s.calloutKind as string) || 'note'}): ${clip(raw, 4000)}`);
  } else if (s.isWeather) {
    body.push(`WEATHER WIDGET: ${clip(raw, 400)}`);
  } else if (s.isMap) {
    body.push(`MAP: ${clip(raw, 400)}`);
  } else if (s.isEmbed) {
    body.push(`EMBED: ${clip(raw, 600)}`);
  } else if (o.type === 'image' || o.type === 'mirror') {
    // The real content is a URL/data-URI — useless as text. The vision pass
    // below fills in what it actually depicts, keyed by this same id.
    body.push(o.type === 'mirror' ? 'CAMERA MIRROR (live webcam block)' : 'IMAGE');
    if (s.imageQuery) body.push(`Searched for: "${String(s.imageQuery)}"`);
  } else if (o.type === 'drawing') {
    body.push('FREEHAND DRAWING');
  } else if (o.type === 'frame') {
    body.push(`NESTED FRAME "${frameTitle(o)}"`);
  } else {
    body.push(clip(raw, PER_BLOCK_CAP) || '(empty)');
  }

  return `${head}\n${body.filter(Boolean).join('\n')}`;
}

export interface FrameRegion {
  frame: CanvasObjectData;
  objects: CanvasObjectData[];
  strokes: DrawingStroke[];
  connections: ConnectionData[];
}

/** Slice the board down to one frame's region. */
export function collectRegion(
  frame: CanvasObjectData,
  objects: CanvasObjectData[],
  strokes: DrawingStroke[],
  connections: ConnectionData[],
): FrameRegion {
  const contained = objectsInFrame(objects, frame);
  return {
    frame,
    objects: contained,
    strokes: strokesInFrame(strokes, frame),
    connections: connectionsInFrame(connections, contained),
  };
}

/**
 * The region as text. `visionById` carries descriptions produced by the vision
 * pass so each image is described inline, exactly where it sits in the region.
 */
export function buildRegionDigest(
  region: FrameRegion,
  visionById: Record<string, string> = {},
): string {
  const r = frameRect(region.frame);
  const lines: string[] = [];

  lines.push(`FRAME "${frameTitle(region.frame)}" covers the rectangle x:${Math.round(r.x)} y:${Math.round(r.y)} w:${Math.round(r.width)} h:${Math.round(r.height)}.`);
  lines.push(`It contains ${region.objects.length} block(s), ${region.strokes.length} ink stroke(s) and ${region.connections.length} connection(s).`);
  lines.push('');

  if (region.objects.length === 0) {
    lines.push('The frame is empty — there is nothing inside it.');
  } else {
    lines.push('=== BLOCKS INSIDE THE FRAME (reading order) ===');
    region.objects.forEach((o, i) => {
      lines.push(describeObject(o, i + 1));
      const vision = visionById[o.id];
      if (vision) lines.push(`What this image actually shows: ${vision}`);
      lines.push('');
    });
  }

  if (region.connections.length > 0) {
    lines.push('=== CONNECTIONS BETWEEN THESE BLOCKS ===');
    const label = (id: string) => {
      const o = region.objects.find((x) => x.id === id);
      return o ? `${o.type}"${(o.content || '').replace(/\s+/g, ' ').slice(0, 40)}"` : id;
    };
    region.connections.forEach((c) => lines.push(`  ${label(c.fromId)} → ${label(c.toId)}`));
  }

  return clip(lines.join('\n'), REGION_TEXT_CAP);
}

/* ------------------------------------------------------------------ *
 *  Vision — so the agent SEES the pictures in the region, not "[image]"
 * ------------------------------------------------------------------ */

/** Shrink a data URL so it fits the vision endpoint's inline-image ceiling. */
function downscale(dataUrl: string, max = 768, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          // Tainted canvas (a cross-origin image without CORS headers) — hand
          // the original over and let the server fetch it instead.
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** Image-bearing blocks in the region, biggest first (the ones that matter). */
export function imagesInRegion(region: FrameRegion): CanvasObjectData[] {
  return region.objects
    .filter((o) => {
      if (o.type !== 'image') return false;
      const src = (o.content || '').trim();
      return src.startsWith('data:image') || /^https?:\/\//i.test(src);
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_VISION_IMAGES);
}

/**
 * Describe every image in the region. Runs them in parallel and never throws —
 * a blind spot degrades the answer, it must not fail the question.
 */
export async function describeRegionImages(
  region: FrameRegion,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  const targets = imagesInRegion(region);
  if (targets.length === 0) return {};

  const out: Record<string, string> = {};
  let done = 0;

  await Promise.all(
    targets.map(async (o) => {
      try {
        const src = (o.content || '').trim();
        // Data URLs are downscaled in the browser; remote URLs are handed to the
        // server, which fetches and encodes them (a canvas would taint on CORS).
        const payload = src.startsWith('data:image') ? await downscale(src) : src;
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: payload,
            prompt:
              'Describe this image thoroughly and concretely: the main subject, the setting, notable details, colors, and mood. Transcribe ALL text visible in it verbatim, including labels, numbers, and handwriting. If it is a chart, diagram, screenshot, or document, explain exactly what it conveys and read out its values. No hedging.',
          }),
          signal,
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.description) out[o.id] = String(json.description).trim();
        }
      } catch {
        /* best effort — this image simply stays undescribed */
      } finally {
        done += 1;
        onProgress?.(done, targets.length);
      }
    }),
  );

  return out;
}
