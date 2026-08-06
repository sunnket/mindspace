/**
 * Rendering a clip out as a real video file.
 *
 * A clip on the board is a RANGE — two numbers against the source, which is why
 * making one is instant and free (see the note at the top of clips.ts). This is
 * the other half: turning that range into bytes you can drop into Slack, attach
 * to an email, or hand to someone who has never heard of this app.
 *
 * HOW, AND WHY NOT THE OTHER WAYS.
 *
 * The fast approach is WebCodecs: demux the container, decode, re-encode the
 * chosen span, mux it back. It runs far quicker than real time — and it needs a
 * demuxer AND a muxer, because `VideoEncoder` hands you naked encoded chunks
 * and nothing in the platform will put them in a container for you. That is
 * mp4box.js plus mp4-muxer, two dependencies and an entire A/V-sync problem
 * (variable frame rates, edit lists, audio priming) whose failure mode is a
 * file that looks fine until someone else opens it. ffmpeg.wasm is the same
 * answer at 25MB, and additionally needs COOP/COEP headers that would change
 * how every other page in this app is served.
 *
 * So: MediaRecorder, capturing playback. The cost is honest and bounded — it
 * renders in REAL TIME, so a twelve-second clip takes twelve seconds — and the
 * UI says so before you start rather than after. In exchange it is about a
 * hundred lines, has no dependencies, and produces a file the browser itself
 * vouches for.
 *
 * THE AUDIO ROUTING IS THE PART THAT ISN'T OBVIOUS. Capturing playback means
 * playing the video, and nobody wants their laptop to blare a clip for twelve
 * seconds because they pressed Save. Muting the element is the wrong lever:
 * `muted` is defined against the element's audio OUTPUT, and whether that also
 * silences `captureStream()` differs by engine — so it either does nothing or
 * it silently ships a file with no sound. Instead the element's audio is routed
 * through a Web Audio graph into a MediaStream destination and deliberately NOT
 * connected to `context.destination`. Playback is therefore silent BY
 * CONSTRUCTION — there is no path to the speakers — while the recorder gets
 * every sample.
 */

export interface ExportProgress {
  /** 0…1 across the clip's own span. */
  ratio: number;
  secondsDone: number;
  secondsTotal: number;
}

export type ExportResult =
  | { ok: true; file: File }
  | { ok: false; error: string }
  | { ok: false; cancelled: true };

export interface ExportHandle {
  promise: Promise<ExportResult>;
  cancel: () => void;
}

/**
 * Container preference, best first.
 *
 * MP4/H.264 leads because it is the format that plays EVERYWHERE — iMessage,
 * WhatsApp, PowerPoint, a decade-old TV. Chrome only grew MediaRecorder MP4
 * support recently, so WebM remains the fallback rather than the default: it is
 * excellent and smaller, but handing someone a .webm still means occasionally
 * handing them a file they can't open.
 */
const MIME_PREFERENCE = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickExportMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of MIME_PREFERENCE) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* keep looking */ }
  }
  return null;
}

export function isExportSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && typeof HTMLMediaElement !== 'undefined'
    && 'captureStream' in HTMLMediaElement.prototype
    && pickExportMime() !== null;
}

export function extensionForMime(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** `My Holiday.MOV` + 4.2 + 11.8 → `My Holiday-clip-4s-12s.mp4` */
export function clipFileName(sourceName: string, start: number, end: number, ext: string): string {
  const base = (sourceName || 'video').replace(/\.[a-z0-9]+$/i, '').slice(0, 60).trim() || 'video';
  // Windows rejects \ / : * ? " < > | in filenames, and a stray one turns a
  // download into a silent failure rather than an error.
  const safe = base.replace(/[\\/:*?"<>|]+/g, '-');
  return `${safe}-clip-${Math.round(start)}s-${Math.round(end)}s.${ext}`;
}

/** Hand a File to the browser's downloader. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the download to have been handed off; revoking immediately
  // cancels it in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const once = (target: EventTarget, event: string, ms: number) =>
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

/**
 * Render [start, end] of `source` to a new video File.
 *
 * Runs in real time. `onProgress` fires per presented frame, so a caller can
 * show a bar that moves with the picture rather than with a timer.
 */
export function exportClipFile(
  source: File,
  start: number,
  end: number,
  sourceName: string,
  onProgress?: (p: ExportProgress) => void,
): ExportHandle {
  let cancelled = false;
  let stopRecorder: (() => void) | null = null;

  const promise = (async (): Promise<ExportResult> => {
    const mime = pickExportMime();
    if (!mime) {
      return { ok: false, error: "This browser can't record video files." };
    }

    const url = URL.createObjectURL(source);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'auto';
    video.playsInline = true;
    /* In the document, but 1×1 and invisible. NOT `display: none`: a display-none
       media element can have its decoding throttled or suspended, which stalls
       the capture. Size does not affect the output — `captureStream()` emits
       frames at the video's intrinsic resolution, not its CSS box. */
    video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(video);

    let audioCtx: AudioContext | null = null;
    const cleanup = () => {
      try { video.pause(); } catch { /* already stopped */ }
      video.removeAttribute('src');
      try { video.load(); } catch { /* fine */ }
      video.remove();
      URL.revokeObjectURL(url);
      if (audioCtx) void audioCtx.close().catch(() => { /* already closed */ });
    };

    try {
      if (!(await once(video, 'loadedmetadata', 15_000))) {
        return { ok: false, error: "This video couldn't be decoded for export." };
      }
      if (cancelled) return { ok: false, cancelled: true };

      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : end;
      const from = Math.max(0, Math.min(start, duration));
      const to = Math.max(from + 0.05, Math.min(end, duration));
      const span = to - from;

      // Seek to the in-point BEFORE recording starts, so the file does not open
      // on whatever frame the decoder happened to be sitting on.
      video.currentTime = from;
      await once(video, 'seeked', 8000);
      if (cancelled) return { ok: false, cancelled: true };

      /* Video from the element's own capture; audio from a Web Audio graph that
         has no route to the speakers. See the note at the top of this file for
         why the element's `muted` flag is not used for this. */
      const captured = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
      const mixed = new MediaStream();
      captured.getVideoTracks().forEach((track) => mixed.addTrack(track));

      try {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const src = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest); // …and pointedly not to audioCtx.destination
        dest.stream.getAudioTracks().forEach((track) => mixed.addTrack(track));
      } catch {
        /* No Web Audio route available. Fall back to whatever audio the element
           capture offers and silence the element directly — a possibly-silent
           export is a far better failure than a laptop that starts playing
           sound at full volume because someone pressed Save. */
        video.muted = true;
        captured.getAudioTracks().forEach((track) => mixed.addTrack(track));
      }

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(mixed, { mimeType: mime });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

      let stopped = false;
      stopRecorder = () => {
        if (stopped) return;
        stopped = true;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopping */ }
        try { video.pause(); } catch { /* already paused */ }
      };

      recorder.start(250); // periodic chunks, so a long clip isn't one giant buffer
      await video.play();

      /* Watch the PICTURE, not a clock.
         Stopping on `setTimeout(span * 1000)` looks equivalent and isn't: if the
         video stalls to buffer or the tab is throttled, wall-clock time keeps
         running while the frames do not, and the export ends early — cutting
         the clip short. Driving off presented frames means the recording ends
         when the content ends, however long that takes. */
      await new Promise<void>((resolve) => {
        const hasRVFC = 'requestVideoFrameCallback' in video;
        let lastTime = video.currentTime;
        let lastAdvance = performance.now();

        const check = () => {
          if (cancelled || stopped) { resolve(); return; }

          const now = video.currentTime;
          if (now > lastTime + 0.001) { lastTime = now; lastAdvance = performance.now(); }

          onProgress?.({
            ratio: Math.max(0, Math.min(1, (now - from) / span)),
            secondsDone: Math.max(0, now - from),
            secondsTotal: span,
          });

          if (now >= to - 0.01 || video.ended) { resolve(); return; }

          // Nothing has been presented for 10s — a stall we will not recover
          // from. Give up rather than hang on a progress bar forever.
          if (performance.now() - lastAdvance > 10_000) { resolve(); return; }

          if (hasRVFC) {
            (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number })
              .requestVideoFrameCallback(check);
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });

      stopRecorder();
      await finished;

      if (cancelled) return { ok: false, cancelled: true };
      if (!chunks.length) return { ok: false, error: 'Nothing was recorded — the video may be protected.' };

      const ext = extensionForMime(mime);
      const blob = new Blob(chunks, { type: mime });
      const file = new File([blob], clipFileName(sourceName, from, to, ext), { type: mime });
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Export failed.' };
    } finally {
      cleanup();
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      stopRecorder?.();
    },
  };
}
