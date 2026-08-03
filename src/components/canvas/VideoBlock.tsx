'use client';

import React from 'react';
import type { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { toast } from '@/store/toastStore';
import { playSnap } from '@/lib/relaxAudio';
import {
  isVideoClip, clipRange, resolveVideoFile, formatTimecode, formatDuration,
  buildFilmstrip, grabFrameDataUrl, createClipObject, countClipsOf, forceDuration, panIntoView,
} from '@/lib/video/clips';
import {
  exportClipFile, isExportSupported, downloadFile, type ExportProgress,
} from '@/lib/video/export';

/* Padding and margins are inline throughout, for the reason given at the top of
   FileBlock: the app's unlayered global reset (`* { margin:0; padding:0 }`)
   overrides Tailwind's spacing utilities, so `p-*` / `m-*` silently do nothing. */

/**
 * The video surface — player, trimmer, and clip.
 *
 * A dropped video used to be a generic file card with a "VID" chip on it, and
 * opening it gave you `<video controls>` in a black box. You could watch it.
 * That was the entire relationship you were allowed to have with a video on a
 * canvas built for thinking with material.
 *
 * The point of a video on THIS board is almost never the whole video — it is
 * the eleven seconds worth keeping. So the verb here is CLIP, which this app
 * already uses for exactly this idea: in a text file, selecting a passage
 * spawns it as its own block (FileBlock's clip mode). Selecting a span of a
 * video does the same thing. The gesture and the vocabulary carry over.
 *
 * WHAT MAKES THE TRIMMER FEEL RIGHT — and these are the details, not decoration:
 *
 *  · Dragging a handle SCRUBS the picture to that exact frame. Choosing a cut
 *    point by watching a number change is guesswork; you pick a cut by seeing
 *    the frame you are cutting on. This single behaviour is most of the
 *    difference between a trimmer and a pair of sliders.
 *  · The playhead is driven by requestAnimationFrame, not `timeupdate`. That
 *    event fires roughly four times a second, which reads as a stuttering
 *    playhead on an otherwise smooth picture.
 *  · Handle hit areas are far wider than the handles look, so a 3px line is
 *    not a 3px target.
 *  · Preview plays the SELECTION and loops it, so you judge the clip as a clip.
 *  · The filmstrip fills in left-to-right as frames decode rather than
 *    appearing at once, so the wait is legible instead of blank.
 */

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Guards a control from the canvas: mousedown starts a block drag, and
 *  pointerdown starts the marquee, so an interactive element must eat both. */
const guard = {
  onMouseDown: stop,
  onPointerDown: stop,
  onClick: stop,
};

const Icon = {
  play: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>,
  pause: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.4" /><rect x="13.5" y="4" width="4.5" height="16" rx="1.4" /></svg>,
  scissors: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>,
  camera: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4Z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  volume: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>,
  muted: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><line x1="16" y1="9" x2="21" y2="15" /><line x1="21" y1="9" x2="16" y2="15" /></svg>,
  check: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>,
  close: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  source: (s = 12) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>,
  save: (s = 12) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
};

/** Minimum a clip is allowed to be. Shorter than this and it reads as a glitch
 *  rather than a clip, and the two handles start fighting for the same pixel. */
const MIN_CLIP_SECONDS = 0.3;

type DragKind = 'in' | 'out' | 'window' | 'seek';
type Drag = null | { kind: DragKind; grabOffset: number; span: number };

export default function VideoBlock({ obj, open, embedded }: {
  obj: CanvasObjectData;
  open: boolean;
  /** Rendered inside FileBlock's reader, which already draws the card surface
   *  and the filename toolbar — so this instance must not draw its own. */
  embedded?: boolean;
}) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);

  const isClip = isVideoClip(obj);
  const name = (obj.style?.fileName as string) || 'video';
  const sourceName = (obj.style?.clipSourceName as string) || name;

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);

  const [failed, setFailed] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [chromeVisible, setChromeVisible] = React.useState(true);

  // Trim state. `inPt`/`outPt` are the LIVE handle positions while editing; the
  // committed range only ever comes from obj.style.
  const [trimming, setTrimming] = React.useState(false);
  const [inPt, setInPt] = React.useState(0);
  const [outPt, setOutPt] = React.useState(0);
  /* The filmstrip carries the KEY of the video it was captured from, so frames
     left over from a previous source (or a previous strip width) are discarded
     on sight instead of being drawn under the new video's handles. */
  const [strip, setStrip] = React.useState<{ key: string; frames: string[] }>({ key: '', frames: [] });
  const dragRef = React.useRef<Drag>(null);

  // Real-file export (lib/video/export.ts). Null when idle.
  const [exporting, setExporting] = React.useState<ExportProgress | null>(null);
  const exportRef = React.useRef<{ cancel: () => void } | null>(null);

  /* An export is real-time, so it is entirely possible to start one and then
     delete the block, navigate away, or close the reader. Cancelling on unmount
     stops a detached <video> playing to a recorder nobody is waiting for. */
  React.useEffect(() => () => exportRef.current?.cancel(), []);

  const committed = React.useMemo(() => clipRange(obj, duration), [obj, duration]);

  /* ---------------------------------------------------------------- bytes --
     DERIVED, not synchronised. The obvious shape for this is an effect that
     resolves the file and calls setState, but the source of truth here is a
     Map lookup that is already available during render — so mirroring it into
     state just buys an extra render pass and a frame where the block knows the
     video exists but hasn't got a URL for it yet.

     Memoised on the block identity and its source, NOT on the whole object:
     re-running on every style patch would tear down and rebuild the object URL
     while a trim handle was being dragged, and the picture would flash black
     on every mouse move.                                                       */
  const file = React.useMemo(
    () => resolveVideoFile(obj),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obj.id, obj.style?.clipSourceId],
  );
  const url = React.useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  const noBytes = !file;

  // Hand the URL back when this block stops using it. Keyed on the URL itself
  // so a source swap revokes the old handle rather than only the last one.
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  /* ------------------------------------------------------- playhead (rAF) -- */
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* ------------------------------------------------- range-bounded playback -
     A clip must never play past its out-point, and while trimming the preview
     must stay inside the handles. Enforced on `timeupdate` (which fires often
     enough for a loop boundary) rather than in the rAF loop, so a paused block
     isn't burning frames to check a bound that cannot move.                    */
  const lowerBound = trimming ? inPt : committed.start;
  const upperBound = trimming ? outPt : committed.end;
  const boundsActive = trimming || isClip;

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) setTime(v.currentTime);
    if (!boundsActive) return;
    if (v.currentTime >= upperBound - 0.02) {
      // Loop rather than stop. A three-second clip that halts on its last frame
      // has to be manually rewound to be watched twice, which is absurd for
      // something this short — and looping is how a clip reads as a clip.
      v.currentTime = lowerBound;
      if (!playing) v.pause();
    } else if (v.currentTime < lowerBound - 0.05) {
      v.currentTime = lowerBound;
    }
  };

  /* ------------------------------------------------------------- filmstrip -- */
  const stripCount = React.useMemo(() => {
    const w = obj.width || 620;
    return Math.max(6, Math.min(18, Math.round((w - 40) / 54)));
  }, [obj.width]);

  const stripKey = `${obj.id}:${stripCount}:${Math.round(duration)}`;

  React.useEffect(() => {
    if (!trimming || !duration || !file) return;
    /* Every state write happens inside the per-frame callback, never in the
       effect body. Resetting the array up-front would be a synchronous setState
       during an effect — a cascading render for information the render pass can
       simply derive, which is what the `key` check below does instead. */
    const handle = buildFilmstrip(file, stripCount, 0, duration, (i, dataUrl) => {
      setStrip((prev) => {
        const base = prev.key === stripKey ? prev.frames.slice() : [];
        base[i] = dataUrl;
        return { key: stripKey, frames: base };
      });
    });
    return () => handle.cancel();
  }, [trimming, duration, stripCount, file, stripKey]);

  const frames = React.useMemo(() => {
    const captured = strip.key === stripKey ? strip.frames : [];
    return Array.from({ length: stripCount }, (_, i) => captured[i] || '');
  }, [strip, stripKey, stripCount]);
  const stripLoading = trimming && frames.some((f) => !f);

  /* ----------------------------------------------------------- transport --- */
  const seekTo = React.useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(t, duration || t));
    v.currentTime = clamped;
    setTime(clamped);
  }, [duration]);

  const togglePlay = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Starting playback from at-or-past the out-point should replay the
      // selection, not sit at the end doing nothing.
      if (boundsActive && (v.currentTime < lowerBound || v.currentTime >= upperBound - 0.02)) {
        v.currentTime = lowerBound;
      }
      void v.play().catch(() => { /* autoplay policy — the user can press again */ });
    } else {
      v.pause();
    }
  }, [boundsActive, lowerBound, upperBound]);

  /* ------------------------------------------------------- trim lifecycle ---
     The sheet is added BELOW the picture rather than floated over it, so the
     block grows to make room. Squeezing a filmstrip into the existing footprint
     would take the height out of the video — and the video is what you are
     looking at to decide where to cut. The pre-trim height is stashed so
     leaving restores the block exactly, including a height the user had
     resized to themselves.                                                     */
  /** `dur` is passed explicitly by the auto-trim path, which fires from
   *  `loadedmetadata` — at that instant the duration is on the element but has
   *  not yet reached React state, and a trimmer opened with a duration of 0 has
   *  a zero-width timeline. */
  const enterTrim = (dur?: number) => {
    const v = videoRef.current;
    v?.pause();
    const total = dur ?? duration;

    const sheetH = isClip && !open ? 96 : 108;
    updateObject(obj.id, {
      height: obj.height + sheetH,
      style: { ...obj.style, preTrimHeight: obj.height, autoTrim: false },
    });

    const start = isClip ? committed.start : 0;
    const end = isClip ? committed.end : total;
    // Opening on the WHOLE video with no selection would make the first act of
    // trimming "find something to trim". A source video opens with a sensible
    // proposal already selected — the middle-weighted first stretch — which is
    // a starting point to adjust rather than a blank to fill.
    if (isClip) {
      setInPt(start); setOutPt(end);
    } else {
      // `total`, never the `duration` STATE. On the auto-trim path this runs
      // inside the metadata callback, where setDuration has been called but not
      // yet flushed — reading state here opened the trimmer with a zero-length
      // selection and a "Create clip · 0s" button that refused to do anything.
      const suggested = Math.min(total, Math.max(MIN_CLIP_SECONDS, total * 0.25));
      setInPt(0); setOutPt(suggested || total);
    }
    setTrimming(true);
    // Same reason: seekTo clamps against `duration`, which is still stale here.
    const v2 = videoRef.current;
    if (v2) { v2.currentTime = Math.max(0, Math.min(start, total)); setTime(start); }
    // Focus so the keyboard shortcuts below have somewhere to land.
    requestAnimationFrame(() => rootRef.current?.focus());
  };

  const exitTrim = () => {
    setTrimming(false);
    videoRef.current?.pause();
    const prev = obj.style?.preTrimHeight as number | undefined;
    if (prev) {
      const next = { ...obj.style } as Record<string, unknown>;
      delete next.preTrimHeight;
      updateObject(obj.id, { height: prev, style: next });
    }
  };

  const posterAt = (t: number): string => {
    const v = videoRef.current;
    if (!v) return '';
    const was = v.currentTime;
    // Only safe to grab if the element is already showing the frame we want;
    // seeking is async, so a poster is taken opportunistically and its absence
    // is never fatal — the clip block falls back to rendering its own frame.
    if (Math.abs(was - t) > 0.35) return '';
    return grabFrameDataUrl(v, 560);
  };

  const commitClip = () => {
    const span = outPt - inPt;
    if (span < MIN_CLIP_SECONDS) return;

    const store = useCanvasStore.getState();
    const sourceId = (obj.style?.clipSourceId as string) || obj.id;
    const source = store.objects.find((o) => o.id === sourceId) || obj;
    const v = videoRef.current;
    const aspect = v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;

    const created = createClipObject({
      source,
      start: inPt,
      end: outPt,
      poster: posterAt(inPt) || (obj.style?.clipPoster as string) || undefined,
      aspect,
      siblingIndex: countClipsOf(sourceId),
    });

    try { playSnap(); } catch { /* audio is optional */ }
    exitTrim();
    setSelectedId(created.id);

    /* A clip is placed beside its source in WORLD space, which on a panned or
       zoomed board can put it completely off-screen — and a result you are told
       about but cannot see is not a result. `panIntoView` moves the minimum
       needed and returns false if it was already visible, so the camera never
       twitches for nothing. */
    panIntoView(created.id);

    toast.success(`Clip created — ${formatDuration(span)}`, {
      detail: 'It plays just that stretch. Drag its handles any time to change your mind.',
    });
  };

  /** Re-trim in place: a clip editing its OWN range keeps one block instead of
   *  breeding a new one every time the range is nudged. */
  const commitRetrim = () => {
    const span = outPt - inPt;
    if (span < MIN_CLIP_SECONDS) return;
    updateObject(obj.id, {
      style: { ...obj.style, clipStart: inPt, clipEnd: outPt, clipPoster: posterAt(inPt) || obj.style?.clipPoster },
    });
    try { playSnap(); } catch { /* audio is optional */ }
    exitTrim();
    toast.success(`Range updated — ${formatDuration(span)}`);
  };

  /**
   * Render this clip's range out as a real, standalone video file.
   *
   * The one thing a range-based clip cannot do on its own is leave the app, so
   * this is the bridge: it plays the span into a MediaRecorder and hands the
   * result to the browser's downloader. It costs real time — the tooltip and
   * the progress readout both say so up front, because a twelve-second wait you
   * were warned about is patience and the same wait unannounced is a bug.
   */
  const runExport = () => {
    if (exporting) return;
    const src = resolveVideoFile(obj);
    if (!src) {
      toast.error("The video's bytes aren't loaded", { detail: 'Re-drop the source file, then export.' });
      return;
    }
    if (!isExportSupported()) {
      toast.error("This browser can't render video files", {
        detail: 'Chrome, Edge and Firefox can. The clip itself still works everywhere.',
      });
      return;
    }

    videoRef.current?.pause();
    const { start, end } = committed;
    setExporting({ ratio: 0, secondsDone: 0, secondsTotal: end - start });

    const handle = exportClipFile(src, start, end, sourceName, (p) => setExporting(p));
    exportRef.current = handle;

    void handle.promise.then((res) => {
      exportRef.current = null;
      setExporting(null);
      if ('ok' in res && res.ok) {
        downloadFile(res.file);
        try { playSnap(); } catch { /* audio is optional */ }
        toast.success(`Saved ${res.file.name}`, {
          detail: `${formatDuration(end - start)} · ${(res.file.size / 1048576).toFixed(1)} MB`,
        });
      } else if ('cancelled' in res) {
        toast.info('Export cancelled');
      } else {
        toast.error("Couldn't render that clip", { detail: res.error });
      }
    });
  };

  const grabStill = () => {
    const v = videoRef.current;
    if (!v) return;
    const dataUrl = grabFrameDataUrl(v, 1280);
    if (!dataUrl) {
      toast.error("Couldn't grab that frame", { detail: 'The video hasn’t decoded a frame yet.' });
      return;
    }
    const w = 300;
    const aspect = v.videoWidth / v.videoHeight || 16 / 9;
    useCanvasStore.getState().addObject({
      type: 'image',
      x: obj.x + obj.width + 56,
      y: obj.y,
      width: w,
      height: Math.round(w / aspect),
      content: dataUrl,
    });
    try { playSnap(); } catch { /* audio is optional */ }
    // A still is a real, standalone PNG — unlike a clip, it owns its pixels and
    // outlives the source completely. Worth saying, because it is the reason to
    // reach for it.
    toast.success(`Frame saved at ${formatTimecode(v.currentTime)}`, {
      detail: 'A real image on your board — it no longer needs the video.',
    });
  };

  /* --------------------------------------------------- timeline pointering -- */
  const timeAtClientX = (clientX: number): number => {
    const el = stripRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const onStripPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!duration) return;
    const t = timeAtClientX(e.clientX);
    const px = (s: number) => (s / duration) * (stripRef.current?.getBoundingClientRect().width || 1);
    // A pixel tolerance, not a time tolerance: on a ten-minute video a 0.2s
    // window would be a sub-pixel target, and on a five-second one it would
    // swallow the whole strip.
    const near = 14;
    const x = px(t);
    let kind: DragKind;
    if (Math.abs(x - px(inPt)) <= near) kind = 'in';
    else if (Math.abs(x - px(outPt)) <= near) kind = 'out';
    else if (t > inPt && t < outPt) kind = 'window';
    else kind = 'seek';

    dragRef.current = { kind, grabOffset: t - inPt, span: outPt - inPt };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (kind === 'seek') {
      // Clicking outside the selection is a SEEK, not a re-selection. Dragging
      // the near edge is how you extend — an accidental click shouldn't wipe a
      // range that took care to set.
      seekTo(t);
    } else if (kind === 'in') seekTo(inPt);
    else if (kind === 'out') seekTo(outPt);
  };

  const onStripPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !duration) return;
    e.stopPropagation();
    const t = timeAtClientX(e.clientX);

    if (drag.kind === 'in') {
      const next = Math.max(0, Math.min(t, outPt - MIN_CLIP_SECONDS));
      setInPt(next);
      seekTo(next); // live preview: you see the frame you are cutting on
    } else if (drag.kind === 'out') {
      const next = Math.min(duration, Math.max(t, inPt + MIN_CLIP_SECONDS));
      setOutPt(next);
      seekTo(next);
    } else if (drag.kind === 'window') {
      // Slide the whole selection, preserving its length and stopping at both
      // ends rather than squashing when it reaches them.
      let start = t - drag.grabOffset;
      start = Math.max(0, Math.min(start, duration - drag.span));
      setInPt(start);
      setOutPt(start + drag.span);
      seekTo(start);
    } else {
      seekTo(t);
    }
  };

  const onStripPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  /* ------------------------------------------------------------- keyboard --- */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!trimming) return;
    const nudge = e.shiftKey ? 1 : 1 / 24; // a frame at 24fps, or a second with shift
    let handled = true;
    switch (e.key) {
      case ' ': togglePlay(); break;
      case 'i': case 'I': setInPt(Math.min(time, outPt - MIN_CLIP_SECONDS)); break;
      case 'o': case 'O': setOutPt(Math.max(time, inPt + MIN_CLIP_SECONDS)); break;
      case 'ArrowLeft': seekTo(time - nudge); break;
      case 'ArrowRight': seekTo(time + nudge); break;
      case 'Enter': if (isClip) commitRetrim(); else commitClip(); break;
      case 'Escape': exitTrim(); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      // The board owns Delete, Escape, arrows and space too. Without this the
      // same keypress would nudge a handle AND pan the canvas.
      e.stopPropagation();
    }
  };

  /* =============================================================== render === */

  if (noBytes) {
    return (
      <Shell embedded={embedded}>
        <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2" style={{ padding: 18 }}>
          <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed" style={{ maxWidth: 240 }}>
            {isClip
              ? `The source video (“${sourceName}”) is no longer loaded.`
              : 'The video bytes are no longer in memory.'}
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)]">Re-drop the file to play it again.</div>
        </div>
      </Shell>
    );
  }

  const span = trimming ? outPt - inPt : committed.end - committed.start;
  // Progress is measured WITHIN the playable window, so a clip's bar fills
  // across the clip rather than crawling through a sliver of the whole film.
  const progressPct = (() => {
    const lo = boundsActive ? lowerBound : 0;
    const hi = boundsActive ? upperBound : duration;
    if (hi <= lo) return 0;
    return Math.max(0, Math.min(100, ((time - lo) / (hi - lo)) * 100));
  })();

  const video = (
    <video
      ref={videoRef}
      src={url}
      playsInline
      muted={muted}
      className="w-full h-full object-contain"
      style={{ background: '#000', display: 'block' }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        setFailed(false);
        // `forceDuration` resolves immediately for a normal file and does the
        // seek-to-the-end dance for a streamed one (see its note in clips.ts) —
        // so everything downstream can just await a number it can trust.
        void forceDuration(v).then((total) => {
          setDuration(total);
          // A clip opens ON its in-point rather than at zero — the first frame
          // of the source is not this block's first frame.
          if (isClip) {
            const start = Number(obj.style?.clipStart) || 0;
            v.currentTime = start;
            setTime(start);
          }
          /* One click from the card straight into trimming. FileBlock's "Clip"
             button opens the reader and leaves this flag behind, because
             entering trim needs a duration — which does not exist at the moment
             that button is pressed. */
          if (obj.style?.autoTrim && total && !trimming) enterTrim(total);
        });
      }}
      onError={() => setFailed(true)}
      onTimeUpdate={onTimeUpdate}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onClick={(e) => { stop(e); togglePlay(); }}
      onMouseDown={stop}
    />
  );

  if (failed) {
    return (
      <Shell embedded={embedded}>
        <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2" style={{ padding: 18 }}>
          <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed" style={{ maxWidth: 250 }}>
            This browser can’t decode <b>{name}</b>.
          </div>
          {/* Naming the likely culprit beats a generic failure: .mov and .mkv
              are containers browsers only half-support, and the user's fix is
              to convert, which they can only do if they know that. */}
          <div className="text-[11px] text-[var(--text-tertiary)] leading-relaxed" style={{ maxWidth: 250 }}>
            MP4 (H.264) and WebM play everywhere. MOV and MKV often don’t.
          </div>
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------ CLIP BLOCK -- */
  if (isClip && !open) {
    return (
      <Shell embedded={embedded}>
        <div
          ref={rootRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="w-full h-full flex flex-col outline-none"
          onMouseEnter={() => setChromeVisible(true)}
        >
          <div className="relative flex-1 min-h-0" style={{ background: '#000' }}>
            {video}

            {/* Centre play affordance — only while paused, so a playing clip is
                just picture. */}
            {!playing && (
              <button
                {...guard}
                onClick={(e) => { stop(e); togglePlay(); }}
                aria-label="Play clip"
                className="absolute inset-0 flex items-center justify-center cursor-pointer"
                style={{ background: 'rgba(0,0,0,0.18)' }}
              >
                <span
                  className="flex items-center justify-center rounded-full shadow-lg"
                  style={{ width: 42, height: 42, background: 'rgba(255,253,250,0.92)', color: '#1A1613', paddingLeft: 3 }}
                >
                  {Icon.play(16)}
                </span>
              </button>
            )}

            {/* Progress hairline across the clip's own span. */}
            <div className="absolute left-0 right-0 bottom-0" style={{ height: 3, background: 'rgba(255,255,255,0.16)' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>

            {exporting && <ExportOverlay progress={exporting} onCancel={() => exportRef.current?.cancel()} />}
          </div>

          {/* Label strip: what this is, and where it came from. */}
          <div className="shrink-0 flex items-center gap-1.5" style={{ padding: '7px 9px' }}>
            <span
              className="shrink-0 flex items-center gap-1 rounded-full text-[9px] font-black uppercase tracking-wider"
              style={{ padding: '3px 7px', color: 'var(--accent)', background: 'var(--accent-subtle)' }}
            >
              {Icon.scissors(9)} Clip
            </span>
            <span className="text-[10.5px] font-bold text-[var(--text-primary)] tabular-nums shrink-0">
              {formatDuration(committed.end - committed.start)}
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)] truncate min-w-0 flex-1" title={`${formatTimecode(committed.start)} – ${formatTimecode(committed.end)} of ${sourceName}`}>
              {formatTimecode(committed.start)}–{formatTimecode(committed.end)} · {sourceName}
            </span>

            <button
              {...guard}
              onClick={(e) => { stop(e); enterTrim(); }}
              title="Adjust this clip's range"
              className="shrink-0 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              style={{ width: 24, height: 22, background: 'var(--well)' }}
            >
              {Icon.scissors(11)}
            </button>
            <button
              {...guard}
              onClick={(e) => { stop(e); runExport(); }}
              disabled={!!exporting}
              /* The wait is quoted BEFORE the click, not discovered after it.
                 Real-time rendering is a fine trade when it's expected. */
              title={`Save as a video file — renders in real time (about ${formatDuration(committed.end - committed.start)})`}
              className="shrink-0 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-wait"
              style={{ width: 24, height: 22, background: 'var(--well)' }}
            >
              {Icon.save(11)}
            </button>
            <button
              {...guard}
              onClick={(e) => {
                stop(e);
                const sid = obj.style?.clipSourceId as string;
                const store = useCanvasStore.getState();
                if (store.objects.some((o) => o.id === sid)) {
                  setSelectedId(sid);
                  panIntoView(sid);
                } else {
                  toast.info('That source video is no longer on this board.', {
                    detail: 'The clip still plays — it kept the footage it needs.',
                  });
                }
              }}
              title="Fly to the source video"
              className="shrink-0 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              style={{ width: 24, height: 22, background: 'var(--well)' }}
            >
              {Icon.source(10)}
            </button>
          </div>

          {trimming && (
            <TrimSheet
              inPt={inPt} outPt={outPt} duration={duration} time={time} frames={frames}
              loading={stripLoading} stripRef={stripRef} playing={playing}
              onPointerDown={onStripPointerDown} onPointerMove={onStripPointerMove} onPointerUp={onStripPointerUp}
              onTogglePlay={togglePlay} onCancel={exitTrim} onCommit={commitRetrim}
              commitLabel="Update range" compact
            />
          )}
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------- FULL PLAYER ------ */
  return (
    <Shell embedded={embedded}>
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full h-full flex flex-col outline-none"
        onMouseEnter={() => setChromeVisible(true)}
        onMouseLeave={() => setChromeVisible(!playing)}
      >
        <div className="relative flex-1 min-h-0" style={{ background: '#000' }}>
          {video}

          {!playing && (
            <button
              {...guard}
              onClick={(e) => { stop(e); togglePlay(); }}
              aria-label="Play"
              className="absolute inset-0 flex items-center justify-center cursor-pointer"
              style={{ background: 'rgba(0,0,0,0.16)' }}
            >
              <span
                className="flex items-center justify-center rounded-full shadow-xl"
                style={{ width: 54, height: 54, background: 'rgba(255,253,250,0.94)', color: '#1A1613', paddingLeft: 4 }}
              >
                {Icon.play(20)}
              </span>
            </button>
          )}

          {/* Transport. Fades out while playing so the picture is the picture —
              and comes straight back on any pointer movement over the frame. */}
          <div
            className="absolute left-0 right-0 bottom-0 flex flex-col gap-1.5 transition-opacity duration-200"
            style={{
              padding: '20px 12px 10px',
              opacity: chromeVisible || !playing ? 1 : 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
              pointerEvents: chromeVisible || !playing ? 'auto' : 'none',
            }}
            onMouseMove={() => setChromeVisible(true)}
          >
            <Scrubber
              duration={duration}
              time={time}
              lower={boundsActive ? lowerBound : 0}
              upper={boundsActive ? upperBound : duration}
              onSeek={seekTo}
            />
            <div className="flex items-center gap-2">
              <button {...guard} onClick={(e) => { stop(e); togglePlay(); }} aria-label={playing ? 'Pause' : 'Play'}
                className="flex items-center justify-center rounded-full cursor-pointer text-white/90 hover:text-white transition-colors"
                style={{ width: 26, height: 26 }}>
                {playing ? Icon.pause(15) : Icon.play(15)}
              </button>
              <button {...guard} onClick={(e) => { stop(e); setMuted((m) => !m); }} aria-label={muted ? 'Unmute' : 'Mute'}
                className="flex items-center justify-center rounded-full cursor-pointer text-white/80 hover:text-white transition-colors"
                style={{ width: 24, height: 24 }}>
                {muted ? Icon.muted(13) : Icon.volume(13)}
              </button>
              <span className="text-[11px] font-semibold text-white/85 tabular-nums" style={{ letterSpacing: '0.01em' }}>
                {formatTimecode(time)} <span className="text-white/40">/ {formatTimecode(boundsActive ? upperBound : duration)}</span>
              </span>

              <div className="flex items-center gap-1.5" style={{ marginLeft: 'auto' }}>
                <button {...guard} onClick={(e) => { stop(e); grabStill(); }} title="Save this frame as an image on the board"
                  className="flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wider cursor-pointer text-white/85 hover:text-white transition-colors"
                  style={{ padding: '5px 9px', background: 'rgba(255,255,255,0.14)' }}>
                  {Icon.camera(11)} Frame
                </button>
                <button {...guard} onClick={(e) => { stop(e); if (trimming) exitTrim(); else enterTrim(); }}
                  title="Choose a stretch of this video and put it on the board as its own block"
                  className="flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors"
                  style={{
                    padding: '5px 10px',
                    background: trimming ? 'var(--accent)' : 'rgba(255,255,255,0.14)',
                    color: trimming ? '#fff' : 'rgba(255,255,255,0.9)',
                  }}>
                  {Icon.scissors(11)} Clip
                </button>
              </div>
            </div>
          </div>
        </div>

        {trimming && (
          <TrimSheet
            inPt={inPt} outPt={outPt} duration={duration} time={time} frames={frames}
            loading={stripLoading} stripRef={stripRef} playing={playing}
            onPointerDown={onStripPointerDown} onPointerMove={onStripPointerMove} onPointerUp={onStripPointerUp}
            onTogglePlay={togglePlay} onCancel={exitTrim} onCommit={isClip ? commitRetrim : commitClip}
            commitLabel={isClip ? 'Update range' : `Create clip · ${formatDuration(span)}`}
            disabled={span < MIN_CLIP_SECONDS}
          />
        )}
      </div>
    </Shell>
  );
}

/* =========================================================== sub-components = */

/**
 * What a real-time render looks like while it happens.
 *
 * It reports SECONDS, not just a percentage, because the number people actually
 * want here is "how much longer" — and for a real-time export that number is
 * exactly the clip's remaining length, which is the one honest thing this can
 * say. The bar is driven off presented frames, so if decoding stalls the bar
 * stalls with it instead of sliding on and then hanging at 100%.
 */
function ExportOverlay({ progress, onCancel }: { progress: ExportProgress; onCancel: () => void }) {
  const remaining = Math.max(0, progress.secondsTotal - progress.secondsDone);
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2.5"
      style={{ background: 'rgba(8,7,6,0.82)', backdropFilter: 'blur(2px)', padding: 16 }}
      onMouseDown={stop}
      onPointerDown={stop}
    >
      <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
        Rendering clip
      </span>

      <div className="rounded-full overflow-hidden" style={{ width: '72%', maxWidth: 220, height: 4, background: 'rgba(255,255,255,0.18)' }}>
        <div style={{ width: `${Math.round(progress.ratio * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 120ms linear' }} />
      </div>

      <span className="text-[10.5px] tabular-nums text-white/60">
        {remaining > 0.6 ? `about ${formatDuration(remaining)} left` : 'finishing…'}
      </span>

      <button
        {...guard}
        onClick={(e) => { stop(e); onCancel(); }}
        className="rounded-full text-[10px] font-bold uppercase tracking-wider cursor-pointer text-white/75 hover:text-white transition-colors"
        style={{ padding: '4px 11px', background: 'rgba(255,255,255,0.12)' }}
      >
        Cancel
      </button>
    </div>
  );
}

/** The card surface — skipped when embedded, because FileBlock's reader has
 *  already drawn one and two stacked cards read as a bug. */
function Shell({ children, embedded }: { children: React.ReactNode; embedded?: boolean }) {
  if (embedded) {
    return <div className="w-full h-full flex flex-col select-none pointer-events-auto" style={{ fontFamily: "'Outfit', sans-serif" }}>{children}</div>;
  }
  return (
    <div
      className="w-full h-full rounded-2xl overflow-hidden border border-white/40 dark:border-white/10 shadow-lg flex flex-col select-none pointer-events-auto"
      style={{ background: 'rgba(24,22,20,0.92)', fontFamily: "'Outfit', sans-serif" }}
    >
      {children}
    </div>
  );
}

/**
 * The player's scrub bar.
 *
 * Its track spans the PLAYABLE WINDOW rather than the whole file, so on a clip
 * the bar is the clip. A bar that represented the source would leave a clip's
 * playhead creeping across a hair's width of a long film, which tells the
 * viewer nothing about the thing they are actually watching.
 */
function Scrubber({ duration, time, lower, upper, onSeek }: {
  duration: number; time: number; lower: number; upper: number; onSeek: (t: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const span = Math.max(0.001, upper - lower);
  const pct = Math.max(0, Math.min(100, ((time - lower) / span) * 100));

  const seekFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(lower + ratio * span);
  };

  if (!duration) return <div style={{ height: 14 }} />;

  return (
    <div
      ref={ref}
      className="relative cursor-pointer group/scrub"
      style={{ height: 14, display: 'flex', alignItems: 'center' }}
      onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; seekFromEvent(e.clientX); }}
      onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (dragging.current) { e.stopPropagation(); seekFromEvent(e.clientX); } }}
      onPointerUp={(e) => { dragging.current = false; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* fine */ } }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full rounded-full" style={{ height: 4, background: 'rgba(255,255,255,0.26)' }}>
        <div className="rounded-full relative" style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}>
          {/* The knob grows on hover of the whole bar, not just of itself —
              a 4px-tall target is not something to ask anyone to hit. */}
          <span
            className="absolute rounded-full shadow transition-transform group-hover/scrub:scale-100 scale-0"
            style={{ width: 11, height: 11, background: '#FFFDFA', right: -5, top: '50%', marginTop: -5.5 }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The trim sheet: filmstrip, brackets, and the commit row.
 *
 * Everything outside the selection is dimmed rather than hidden, because the
 * material you are NOT keeping is what tells you where you are in the video —
 * cropping the strip to the selection would remove every landmark you use to
 * judge the cut.
 */
function TrimSheet({
  inPt, outPt, duration, time, frames, loading, stripRef, playing,
  onPointerDown, onPointerMove, onPointerUp, onTogglePlay, onCancel, onCommit,
  commitLabel, disabled, compact,
}: {
  inPt: number; outPt: number; duration: number; time: number;
  frames: string[]; loading: boolean; playing: boolean;
  stripRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onTogglePlay: () => void; onCancel: () => void; onCommit: () => void;
  commitLabel: string; disabled?: boolean; compact?: boolean;
}) {
  const pct = (t: number) => (duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);
  const inPct = pct(inPt);
  const outPct = pct(outPt);
  const span = outPt - inPt;

  return (
    <div
      className="shrink-0 border-t border-white/10"
      style={{ background: 'rgba(16,15,14,0.96)', padding: compact ? '8px 9px 9px' : '10px 12px 11px' }}
      onMouseDown={stop}
      onPointerDown={stop}
    >
      {/* Filmstrip + brackets */}
      <div
        ref={stripRef}
        className="relative rounded-lg overflow-hidden"
        style={{ height: compact ? 44 : 56, cursor: 'ew-resize', touchAction: 'none', background: '#000' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 flex">
          {frames.map((f, i) => (
            <div key={i} className="flex-1 min-w-0" style={{ background: '#0C0B0A' }}>
              {f
                ? <img src={f} alt="" draggable={false} className="w-full h-full object-cover" style={{ opacity: 0.95 }} />
                : <div className="w-full h-full" style={{ background: 'rgba(255,255,255,0.05)' }} />}
            </div>
          ))}
          {frames.length === 0 && <div className="w-full h-full" style={{ background: 'rgba(255,255,255,0.05)' }} />}
        </div>

        {/* Dim outside the selection */}
        <div className="absolute top-0 bottom-0 left-0" style={{ width: `${inPct}%`, background: 'rgba(8,7,6,0.72)' }} />
        <div className="absolute top-0 bottom-0 right-0" style={{ width: `${100 - outPct}%`, background: 'rgba(8,7,6,0.72)' }} />

        {/* Selection frame */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${inPct}%`,
            width: `${Math.max(0, outPct - inPct)}%`,
            border: '2px solid var(--accent)',
            borderRadius: 6,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          }}
        />

        {/* Handles. The visible grip is 10px; the pointer test in
            onStripPointerDown accepts 14px either side of it, so the target is
            wider than the drawing — hitting a trim handle should never be a
            test of aim. */}
        {[{ p: inPct, side: 'in' }, { p: outPct, side: 'out' }].map(({ p, side }) => (
          <div
            key={side}
            className="absolute top-0 bottom-0 flex items-center justify-center pointer-events-none"
            style={{ left: `${p}%`, width: 10, marginLeft: side === 'in' ? -10 : 0, background: 'var(--accent)', borderRadius: side === 'in' ? '6px 0 0 6px' : '0 6px 6px 0' }}
          >
            <span style={{ width: 2, height: 14, borderRadius: 2, background: 'rgba(0,0,0,0.42)' }} />
          </div>
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${pct(time)}%`, width: 2, marginLeft: -1, background: '#FFFDFA', boxShadow: '0 0 6px rgba(0,0,0,0.7)' }}
        />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/55">Reading frames…</span>
          </div>
        )}
      </div>

      {/* Readout + actions */}
      <div className="flex items-center gap-1.5" style={{ marginTop: 8 }}>
        <button
          {...guard}
          onClick={(e) => { stop(e); onTogglePlay(); }}
          title="Preview the selection (Space)"
          className="shrink-0 flex items-center justify-center rounded-full cursor-pointer text-white/90 hover:text-white transition-colors"
          style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.13)' }}
        >
          {playing ? Icon.pause(12) : Icon.play(12)}
        </button>

        <div className="flex items-center gap-1 text-[10.5px] tabular-nums shrink-0">
          <span className="font-bold" style={{ color: 'var(--accent)' }}>{formatTimecode(inPt, true)}</span>
          <span className="text-white/30">→</span>
          <span className="font-bold" style={{ color: 'var(--accent)' }}>{formatTimecode(outPt, true)}</span>
        </div>
        <span className="text-[10.5px] font-black text-white/90 tabular-nums shrink-0" style={{ marginLeft: 2 }}>
          {formatDuration(span)}
        </span>

        {/* The shortcut legend is the cheapest way to turn a good trimmer into
            one someone becomes fast at. Hidden on a narrow block, where it
            would push the commit button off the edge. */}
        {!compact && (
          <span className="text-[9.5px] text-white/35 truncate min-w-0" style={{ marginLeft: 6 }}>
            I / O set · ← → nudge · space preview
          </span>
        )}

        <button
          {...guard}
          onClick={(e) => { stop(e); onCancel(); }}
          title="Cancel (Esc)"
          className="shrink-0 flex items-center justify-center rounded-full cursor-pointer text-white/60 hover:text-white transition-colors"
          style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.09)', marginLeft: 'auto' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <button
          {...guard}
          onClick={(e) => { stop(e); onCommit(); }}
          disabled={disabled}
          title="Enter"
          className="shrink-0 flex items-center gap-1 rounded-full text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ padding: '6px 12px', background: 'var(--accent)', color: '#fff' }}
        >
          {Icon.check(11)} {commitLabel}
        </button>
      </div>
    </div>
  );
}
