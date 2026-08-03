import { useCanvasStore } from '@/store/canvasStore';
import { fileBlobCache, getFileForBlock } from '@/lib/fileIngest';
import type { CanvasObjectData } from '@/lib/db';

/**
 * Video clipping.
 *
 * THE CENTRAL DECISION: a clip is a RANGE, not a re-encode.
 *
 * Creating a clip stores two numbers — an in-point and an out-point — against
 * the source video, and the clip block plays only that span. Nothing is
 * transcoded, nothing is copied, and the original is never modified. This is
 * the same model Photos uses for trimming, and it is right for three separate
 * reasons:
 *
 *  · It is INSTANT. Re-encoding in a browser means either ffmpeg.wasm (a ~25MB
 *    download that also requires COOP/COEP headers the rest of this app would
 *    have to be rebuilt around) or capturing playback through MediaRecorder,
 *    which runs in REAL TIME — a 40-second clip would take 40 seconds to make.
 *    Neither is a thing to put behind a button labelled "Clip".
 *  · It is LOSSLESS and REVERSIBLE. The clip's range can be re-dragged forever,
 *    widened past where it started, or thrown away, and the source is untouched.
 *  · It is FREE. Videos routinely exceed the 25MB embed ceiling in fileIngest,
 *    so duplicating bytes per clip would be ruinous — a highlights reel of six
 *    clips would carry six copies of the film.
 *
 * WHERE THE BYTES COME FROM. `fileBlobCache` maps a block id to a `File`, and a
 * Map holds a REFERENCE — so registering a clip's id against the source's
 * existing File costs nothing and, importantly, keeps those bytes alive even if
 * the source block is later deleted. Across a reload the clip falls back to
 * resolving through its `clipSourceId`, which works whenever the source's bytes
 * were small enough to be embedded. When neither path yields bytes the clip
 * says so plainly, exactly as a file block does.
 */

/** Marker + payload written onto a clip block's `style`. */
export interface ClipStyle {
  isVideoClip: true;
  /** Block id of the video this range belongs to. */
  clipSourceId: string;
  clipStart: number;
  clipEnd: number;
  /** Denormalised so the clip can label itself without reading the source. */
  clipSourceName: string;
  /** Poster frame (data URL) captured at the in-point. */
  clipPoster?: string;
}

export function isVideoClip(obj: CanvasObjectData): boolean {
  return Boolean(obj.style?.isVideoClip);
}

/** Extensions/mimes the block treats as video. Mirrors FileBlock's viewer test. */
export function isVideoFile(ext: string, mime: string): boolean {
  return ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'].includes(ext.toLowerCase())
    || mime.startsWith('video/');
}

/**
 * Timecode. Below an hour it is m:ss, above it h:mm:ss — never a leading "0:"
 * for content that doesn't need one.
 *
 * `precise` adds tenths, and is used ONLY where a tenth is actionable: the trim
 * handles and the selected duration. On a resting player it would be visual
 * noise that changes ten times a second.
 */
export function formatTimecode(seconds: number, precise = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = precise ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A duration phrased for a label rather than a readout ("12.4s", "1m 04s"). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * The best available bytes for a video block, following a clip to its source.
 *
 * A clip registers itself in the blob cache at creation time, so this normally
 * hits on the first line. The `clipSourceId` hop is the after-a-reload path,
 * where the session cache is empty and the bytes have to be rebuilt from the
 * source's embedded data URL.
 */
export function resolveVideoFile(obj: CanvasObjectData): File | null {
  const own = getFileForBlock(obj.id);
  if (own) return own;

  const sourceId = obj.style?.clipSourceId as string | undefined;
  if (!sourceId) return null;

  const source = useCanvasStore.getState().objects.find((o) => o.id === sourceId);
  if (!source) return null;

  const file = getFileForBlock(source.id);
  // Adopt it, so every later resolution on this clip is a Map hit.
  if (file) fileBlobCache.set(obj.id, file);
  return file;
}

/** The playable window for a block: a clip's range, or the whole video. */
export function clipRange(obj: CanvasObjectData, duration: number): { start: number; end: number } {
  if (!isVideoClip(obj)) return { start: 0, end: duration };
  const start = Math.max(0, Number(obj.style?.clipStart) || 0);
  const rawEnd = Number(obj.style?.clipEnd);
  // `|| duration` would turn a legitimate 0 into the full duration, but an end
  // of 0 is already nonsense — so the guard is on finiteness, not truthiness.
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : duration;
  return { start, end: Math.min(end, duration || end) };
}

/**
 * Draw the frame a <video> is currently showing to a PNG data URL.
 *
 * Returns '' rather than throwing when the draw is refused. That happens for a
 * cross-origin source (a tainted canvas) and for a video that has not decoded a
 * frame yet — neither is exceptional enough to interrupt the caller, and every
 * call site treats '' as "no poster available".
 */
export function grabFrameDataUrl(
  video: HTMLVideoElement,
  maxWidth = 640,
  /* PNG for a frame the user asked to KEEP — it becomes a real image block and
     should be lossless. JPEG for posters and filmstrip thumbnails, which are
     persisted on the object: a 320px PNG poster is several hundred KB of base64
     in the store and in IndexedDB, and the same frame as a quality-0.72 JPEG is
     around twenty. Multiplied by every video on a board, that is the difference
     between a poster being free and a poster being a liability. */
  mime: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.72,
): string {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return '';
    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return mime === 'image/jpeg' ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
  } catch {
    return '';
  }
}

/**
 * Get a real duration out of a video element, including the files that lie.
 *
 * A container written by a STREAMING encoder has no duration in its header,
 * because at the moment the header was written nobody knew how long the
 * recording would end up being. MediaRecorder does this, which means it applies
 * to a large share of the video people actually drop on a board: screen
 * recordings, webcam captures, clips exported from chat apps. The browser
 * reports `Infinity` for those.
 *
 * The fix is the long-standing one — seek far past the end. The element clamps
 * to the true final frame, discovers the real length on the way, and emits
 * `durationchange`. Then it is put back where it was, so this is invisible.
 *
 * Without it a trimmer opens on a zero-length timeline: no scrubbing, no
 * handles, and a "Create clip · 0s" button that cannot do anything.
 */
export function forceDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }
  return new Promise((resolve) => {
    let settled = false;
    const restore = video.currentTime;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('durationchange', onChange);
      // Put the playhead back before anyone notices it went to the end.
      try { video.currentTime = restore; } catch { /* not seekable yet */ }
      resolve(value);
    };
    const onChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) finish(video.duration);
    };
    const timer = setTimeout(() => finish(Number.isFinite(video.duration) ? video.duration : 0), 3000);
    video.addEventListener('durationchange', onChange);
    // Large enough to be past any real recording, small enough not to trip the
    // overflow guards some engines apply to absurd seek targets.
    try { video.currentTime = 1e7; } catch { finish(0); }
  });
}

export interface FilmstripHandle {
  /** Resolves with the frames captured so far if cancelled mid-flight. */
  promise: Promise<string[]>;
  cancel: () => void;
}

/**
 * Build a filmstrip: `count` evenly-spaced thumbnails across [start, end].
 *
 * Frames are captured SEQUENTIALLY through one hidden <video>, because seeking
 * is a single-threaded operation on a media element — firing every seek at once
 * makes the element service only the last one and silently drop the rest.
 * Each frame is reported through `onFrame` as it lands, so the strip fills in
 * left to right instead of appearing all at once after a long wait.
 *
 * Every seek is raced against a timeout. Some containers (notably .mov and
 * .mkv, which browsers half-support) accept a seek and then never fire
 * `seeked`; without the race a single undecodable frame would hang the strip
 * forever and the UI would sit on a spinner with no way out.
 */
export function buildFilmstrip(
  file: File,
  count: number,
  start: number,
  end: number,
  onFrame?: (index: number, dataUrl: string) => void,
): FilmstripHandle {
  let cancelled = false;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  // Needed for the element to decode without being in the document on iOS.
  video.playsInline = true;
  video.src = url;

  const cleanup = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  const once = (target: HTMLVideoElement, event: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        target.removeEventListener(event, onOk);
        target.removeEventListener('error', onErr);
        clearTimeout(timer);
        resolve(ok);
      };
      const onOk = () => finish(true);
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(false), ms);
      target.addEventListener(event, onOk, { once: true });
      target.addEventListener('error', onErr, { once: true });
    });

  const promise = (async (): Promise<string[]> => {
    const frames: string[] = [];
    try {
      const ready = await once(video, 'loadeddata', 8000);
      if (!ready || cancelled) return frames;

      const span = Math.max(0, end - start);
      for (let i = 0; i < count; i++) {
        if (cancelled) break;
        // Sample at the CENTRE of each slot, not its leading edge. Sampling at
        // the edge puts the first thumbnail at t=0, which on a video that fades
        // in from black is a strip that opens with a black rectangle.
        const t = start + (span * (i + 0.5)) / count;
        video.currentTime = Math.min(t, Math.max(0, (video.duration || end) - 0.05));
        const seeked = await once(video, 'seeked', 4000);
        if (cancelled) break;
        if (!seeked) continue;
        const dataUrl = grabFrameDataUrl(video, 200);
        if (!dataUrl) continue;
        frames[i] = dataUrl;
        onFrame?.(i, dataUrl);
      }
      return frames;
    } finally {
      cleanup();
    }
  })();

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
}

/**
 * Read a video's duration (and pixel size) without mounting a player.
 * Used by the compact card, which wants to say "2:14" before anyone presses
 * anything.
 */
export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  /** A JPEG poster taken a little way in — see below for why not at t=0. */
  poster: string;
}

export function probeVideo(file: File): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (value: VideoProbe | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 10_000);

    video.addEventListener('loadeddata', () => {
      // A stream with an unknown length reports Infinity; callers want a number
      // they can divide by, so that becomes 0 ("unknown") here.
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const base = { duration, width: video.videoWidth, height: video.videoHeight };

      /* Poster at ~1s, not frame zero. An enormous number of videos open on
         black — a fade-in, a slate, a title card — so the literal first frame
         is the single least representative image in the file, and a board full
         of black rectangles is exactly what this poster exists to prevent. */
      const at = duration > 1.2 ? Math.min(1, duration * 0.1) : 0;
      if (at <= 0) { finish({ ...base, poster: grabFrameDataUrl(video, 480, 'image/jpeg') }); return; }

      const onSeeked = () => finish({ ...base, poster: grabFrameDataUrl(video, 480, 'image/jpeg') });
      video.addEventListener('seeked', onSeeked, { once: true });
      // If the seek never lands, settle for whatever frame is on screen rather
      // than returning nothing at all.
      setTimeout(() => finish({ ...base, poster: grabFrameDataUrl(video, 480, 'image/jpeg') }), 3500);
      video.currentTime = at;
    }, { once: true });

    video.addEventListener('error', () => finish(null), { once: true });
    video.src = url;
  });
}

/** Default footprint of a clip block, sized from the source's aspect ratio. */
export function clipBoxFor(aspect: number): { width: number; height: number } {
  const width = 340;
  const ratio = aspect > 0.2 && aspect < 5 ? aspect : 16 / 9;
  // + the chrome strip under the picture (label row).
  return { width, height: Math.round(width / ratio) + 46 };
}

export interface CreateClipArgs {
  source: CanvasObjectData;
  start: number;
  end: number;
  /** Poster captured at the in-point, so the new block has a face immediately. */
  poster?: string;
  aspect: number;
  /** How many clips already exist for this source — drives the stacking offset. */
  siblingIndex?: number;
}

/**
 * Spawn a clip block on the canvas.
 *
 * Placed to the RIGHT of its source and stepped down per sibling, so cutting
 * three clips out of one video lays them out as a readable column instead of a
 * single pile — the board should show the shape of what you did.
 */
export function createClipObject({ source, start, end, poster, aspect, siblingIndex = 0 }: CreateClipArgs): CanvasObjectData {
  const store = useCanvasStore.getState();
  const { width, height } = clipBoxFor(aspect);
  const sourceName = (source.style?.fileName as string) || 'video';

  const clipStyle: ClipStyle & Record<string, unknown> = {
    isVideoClip: true,
    clipSourceId: (source.style?.clipSourceId as string) || source.id,
    clipStart: start,
    clipEnd: end,
    clipSourceName: sourceName,
    clipPoster: poster,
    // Carried over so the clip renders through FileBlock's video path and can
    // name its own format without reaching back to the source.
    isFile: true,
    fileName: sourceName,
    fileType: (source.style?.fileType as string) || 'video/mp4',
    fileExt: (source.style?.fileExt as string) || 'mp4',
    fileStatus: 'ready',
  };

  const created = store.addObject({
    type: 'card',
    x: source.x + source.width + 56,
    y: source.y + siblingIndex * (height + 18),
    width,
    height,
    content: '',
    style: clipStyle,
  });

  /* Adopt the source's bytes under the CLIP's id. The Map stores a reference,
     so this duplicates nothing — and it means the clip keeps playing even if
     the source block is deleted a moment later, which is the obvious thing to
     do once you have pulled the two seconds you wanted out of a 900MB file. */
  const file = resolveVideoFile(source);
  if (file) fileBlobCache.set(created.id, file);

  return created;
}

/**
 * Bring a block into view by moving the camera AS LITTLE AS POSSIBLE.
 *
 * The obvious move is to centre on the target, and it is the wrong one here: a
 * clip is created next to the video it came from, so centring on the clip
 * shoves the source off the other edge and the user loses the thing they were
 * just working in. Nudging by the smallest delta that clears the margin keeps
 * both on screen whenever both can fit, and degrades to what is effectively a
 * fly-to when the target is genuinely far away.
 *
 * Returns false when nothing needed to move — a camera that jumps when the
 * answer was already visible is just noise.
 *
 * (Deliberately NOT the store's `pendingFocusId` handoff. That path nulls its
 * own trigger inside the same effect that schedules the fly, so the re-render
 * tears down the timeout before it fires.)
 */
export function panIntoView(objId: string, margin = 48): boolean {
  const store = useCanvasStore.getState();
  const target = store.objects.find((o) => o.id === objId);
  if (!target || typeof window === 'undefined') return false;

  /* "Visible" is not the same as "inside the window".
     The board is framed by fixed chrome that floats OVER it — the properties
     rail owns the right-hand column whenever anything is selected, and the
     toolbar sits along the bottom. Panning against `innerWidth` obediently
     parked a freshly-cut clip underneath the rail, which is the one place it
     could not be looked at. The rail is measured from the DOM when it is
     already up, and falls back to its known geometry (right: 48 + width: 300,
     see globals.css) for the case this runs in the same tick as the selection
     that summons it. */
  const rail = document.querySelector('.props-rail');
  const railLeft = rail ? rail.getBoundingClientRect().left : 0;
  const rightEdge = railLeft > 0
    ? railLeft
    : (store.selectedId ? window.innerWidth - 348 : window.innerWidth);
  const bottomEdge = window.innerHeight - 96; // toolbar lane

  const { x: cx, y: cy, zoom } = store.camera;
  const left = target.x * zoom + cx;
  const top = target.y * zoom + cy;
  const right = left + target.width * zoom;
  const bottom = top + target.height * zoom;

  let dx = 0;
  let dy = 0;
  if (right > rightEdge - margin) dx = rightEdge - margin - right;
  if (left + dx < margin) dx = margin - left;
  if (bottom > bottomEdge - margin) dy = bottomEdge - margin - bottom;
  if (top + dy < margin) dy = margin - top;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return false;
  store.animateCamera({ x: cx + dx, y: cy + dy, zoom }, 620);
  return true;
}

/** How many clips on the board already point at this source. */
export function countClipsOf(sourceId: string): number {
  return useCanvasStore.getState().objects.filter(
    (o) => o.style?.isVideoClip && o.style?.clipSourceId === sourceId,
  ).length;
}
