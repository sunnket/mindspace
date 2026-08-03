'use client';

import React from 'react';
import type { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { toast } from '@/store/toastStore';
import { playSnap } from '@/lib/relaxAudio';
import { screenToCanvas } from '@/lib/utils';
import {
  cropRegion, removeBackground, extractPalette, fitPulledBox, estimateTolerance,
  cropLasso, pullRegion, trimTransparent, shatter, bakeFilter,
  adjustToFilter, isNeutralAdjust, IMAGE_LOOKS, NEUTRAL_ADJUST,
  type LoadedImage, type Region, type Swatch, type Point, type ImageAdjust,
} from '@/lib/image/pixels';
import { loadForPixels } from '@/lib/image/source';
import { grabText, detectObjects, type DetectedObject } from '@/lib/image/extract';
import { IMAGE_SHAPE_CYCLE, IMAGE_SHAPE_LABEL, imageShapeStyle, type ImageShape } from '@/lib/imageShapes';

/* Padding/margins are inline throughout — the app's unlayered global reset
   (`* { margin:0; padding:0 }`) beats Tailwind's spacing utilities. */

/**
 * The image studio — an image stops being a flat picture and becomes a SOURCE
 * you can take things out of.
 *
 * A picture on a thinking board is rarely wanted whole. It is on the board
 * because of the chart inside it, the paragraph someone screenshotted, the
 * product with the background it came with, the one object worth keeping. Every
 * one of those used to require leaving for another app and coming back.
 *
 * FIVE TOOLS, and the ordering principle is that the RELIABLE ones lead:
 *
 *  · Pull — drag a box over any part of the picture and drag it off onto the
 *    board. Pure geometry, works on every image, never wrong. This is the
 *    backbone; everything else is a way of proposing a box for you.
 *  · Cut out — make the background transparent. Deterministic flood fill from
 *    the edges, not a model (see pixels.ts) — so it is instant, offline, and
 *    predictable, and it excels at exactly the images boards are full of:
 *    screenshots, logos, diagrams, product shots.
 *  · Text — transcribe what the picture says, into a real text block.
 *  · Objects — ask the vision model what is in here and outline it. Presented
 *    as SUGGESTIONS, because a language model's boxes are approximate; each one
 *    is a proposal you pull, and the manual box is always there.
 *  · Shape — the mask picker. Previously this was only reachable by tapping an
 *    already-selected image, which was both undiscoverable and easy to trigger
 *    by accident; it now has a button and shows every shape at once.
 */

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const guard = { onMouseDown: stop, onPointerDown: stop };

type Tool = null | 'pull' | 'cutout' | 'adjust' | 'objects' | 'shape' | 'palette';

/**
 * How a piece is chosen.
 *
 *  · box    — a rectangle. Honest, precise, and the wrong shape for almost
 *             anything worth keeping out of a photograph.
 *  · lasso  — draw around it freehand. The piece arrives shaped like the thing
 *             rather than like a box around the thing.
 *  · magic  — click it. Flood fills outward from the point to find the whole
 *             connected region of that colour, which on flat material (a logo,
 *             a chart segment, an icon) grabs the exact object in one tap.
 */
type PullMode = 'box' | 'lasso' | 'magic';

const Icon = {
  pull: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /></svg>,
  cutout: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 1 0 20" /><path d="M12 2a10 10 0 0 0 0 20" strokeDasharray="2 3" /><path d="M12 7a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" /></svg>,
  text: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></svg>,
  objects: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /><path d="M13 5h8M17 3v4M5 13v8M3 17h4" /></svg>,
  shape: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5 21 20H3z" /></svg>,
  palette: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="9" cy="9" r="1.3" fill="currentColor" /><circle cx="15" cy="9" r="1.3" fill="currentColor" /><circle cx="8" cy="14" r="1.3" fill="currentColor" /><circle cx="14.5" cy="14.5" r="1.3" fill="currentColor" /></svg>,
  restore: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></svg>,
  wand: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="m4 20 11-11" /><path d="m14 6 4 4" /><path d="M17 3v3M20.5 4.5 18.5 6.5M21 9h-3" /></svg>,
  adjust: (s = 13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="21" x2="5" y2="13" /><line x1="5" y1="9" x2="5" y2="3" /><line x1="12" y1="21" x2="12" y2="15" /><line x1="12" y1="11" x2="12" y2="3" /><line x1="19" y1="21" x2="19" y2="17" /><line x1="19" y1="13" x2="19" y2="3" /><circle cx="5" cy="11" r="2" /><circle cx="12" cy="13" r="2" /><circle cx="19" cy="15" r="2" /></svg>,
};

/**
 * Where the picture actually IS inside its block.
 *
 * This is the difference between a crop tool that works and one that quietly
 * cuts the wrong thing. An image block is a box the user can resize freely, and
 * the picture inside it is fitted, not stretched — `object-fit: contain` for an
 * unmasked image (see globals.css, where contain was chosen so pasted
 * screenshots aren't silently cropped) and `cover` once a shape mask is on.
 * Either way the rendered picture is letterboxed or overflowing, so a point
 * halfway across the BLOCK is not a point halfway across the IMAGE.
 *
 * Every region in this file is stored in image space, so the marquee surface is
 * laid over exactly the rendered picture and the two spaces coincide.
 */
function displayRect(blockAspect: number, imageAspect: number, mode: 'contain' | 'cover') {
  const widthLeads = mode === 'contain' ? imageAspect > blockAspect : imageAspect < blockAspect;
  // Fractions of the block, so this can be written straight into CSS percentages
  // and stays correct while the block is being resized.
  const w = widthLeads ? 1 : (blockAspect / imageAspect);
  const h = widthLeads ? (imageAspect / blockAspect) : 1;
  return { left: (1 - w) / 2, top: (1 - h) / 2, width: w, height: h };
}

/**
 * Mounted ONLY while its image is selected (see the call site in CanvasObject).
 * That is what resets the tools: a picture you come back to must never still be
 * holding an armed wand from last time, and unmounting is a more reliable way
 * to guarantee that than remembering to clear six pieces of state. It also
 * keeps the aspect-ratio probe below off every unselected image on the board.
 */
export default function ImageStudio({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const [tool, setTool] = React.useState<Tool>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Pull
  const [pullMode, setPullMode] = React.useState<PullMode>('box');
  const [region, setRegion] = React.useState<Region | null>(null);
  const [lasso, setLasso] = React.useState<Point[] | null>(null);
  const drawRef = React.useRef<{ x0: number; y0: number } | null>(null);
  const lassoRef = React.useRef<Point[] | null>(null);
  /* Mirrors `drawRef` for the RENDER pass. The ref is what the pointer handlers
     read (it must be up to date within a single gesture, before any re-render),
     but reading a ref while rendering is not allowed — React can't know the
     output depends on it, so the label below would go stale. */
  const [drawing, setDrawing] = React.useState(false);
  const [dragOut, setDragOut] = React.useState<{ x: number; y: number } | null>(null);

  // Cut out
  const [tolerance, setTolerance] = React.useState(0.16);
  const [wand, setWand] = React.useState(false);

  // Objects & palette
  const [objects, setObjects] = React.useState<DetectedObject[] | null>(null);
  const [palette, setPalette] = React.useState<Swatch[] | null>(null);

  // Shatter
  const [grid, setGrid] = React.useState({ cols: 3, rows: 3 });

  const shape = (obj.style?.imageShape as ImageShape) || 'original';
  const hasOriginal = typeof obj.style?.imageOriginal === 'string';

  /* The look, as live state. Adjustments are a CSS filter on the block, so
     dragging a slider repaints instantly and touches no pixels — the store is
     only written on release, which keeps a drag from queueing sixty undo
     entries and sixty collaborator broadcasts. */
  const savedAdjust = (obj.style?.imageAdjust as Partial<ImageAdjust> | undefined) || NEUTRAL_ADJUST;
  const [adjust, setAdjust] = React.useState<ImageAdjust>({ ...NEUTRAL_ADJUST, ...savedAdjust });
  const commitAdjust = (next: ImageAdjust) => {
    setAdjust(next);
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { style: { ...(live?.style || obj.style), imageAdjust: next } });
  };
  const filterCss = adjustToFilter(adjust);

  /* The picture's true aspect ratio, needed to know where it is being drawn
     inside the block. Read off a detached <img>, which the browser serves from
     its decoded cache — the same bytes are already on screen. */
  const [imageAspect, setImageAspect] = React.useState(0);
  React.useEffect(() => {
    if (!obj.content) return;
    let alive = true;
    const el = new Image();
    el.onload = () => {
      if (alive && el.naturalWidth && el.naturalHeight) {
        setImageAspect(el.naturalWidth / el.naturalHeight);
      }
    };
    el.src = obj.content;
    return () => { alive = false; };
  }, [obj.content]);

  const blockAspect = obj.width / (obj.height || 1);
  const fit = React.useMemo(
    () => (imageAspect > 0
      ? displayRect(blockAspect, imageAspect, shape === 'original' ? 'contain' : 'cover')
      : { left: 0, top: 0, width: 1, height: 1 }),
    [blockAspect, imageAspect, shape],
  );

  /**
   * Load the pixels, routing through the proxy for cross-origin images.
   *
   * `from` picks WHICH picture. This is not a detail: cutting the background
   * used to re-read `obj.content`, which after the first cut is the ALREADY-CUT
   * image — so every nudge of the tolerance slider ran the removal again on the
   * result of the last one and ate further into the subject each time. Nothing
   * in the interface said so; it just looked like the tool was too aggressive.
   * A tolerance change is a re-decision, so it must always start from the
   * untouched original. The wand is the deliberate exception — clicking a
   * second colour is meant to accumulate.
   */
  const withPixels = async <T,>(
    label: string,
    fn: (img: LoadedImage) => T | Promise<T>,
    from: 'original' | 'current' = 'current',
  ): Promise<T | null> => {
    setBusy(label);
    try {
      const src = from === 'original'
        ? ((obj.style?.imageOriginal as string) || obj.content)
        : obj.content;
      const img = await loadForPixels(src);
      return await fn(img);
    } catch (err) {
      toast.error("Couldn't read this image", {
        detail: err instanceof Error ? err.message : 'The pixels are unavailable.',
      });
      return null;
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------------ pull -- */

  const regionFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const onSurfaceDown = (e: React.PointerEvent) => {
    if (tool !== 'pull' && !wand) return;
    e.stopPropagation();
    e.preventDefault();
    const p = regionFromEvent(e);
    if (!p) return;

    if (wand) { void eraseAt(p); return; }
    if (pullMode === 'magic') { void pullMagic(p); return; }

    if (pullMode === 'lasso') {
      lassoRef.current = [p];
      setLasso([p]);
      setRegion(null);
      setDrawing(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // Pressing INSIDE an existing selection starts the drag-out, not a new box.
    if (region && p.x >= region.x && p.x <= region.x + region.w && p.y >= region.y && p.y <= region.y + region.h) {
      setDragOut({ x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    drawRef.current = { x0: p.x, y0: p.y };
    setDrawing(true);
    setRegion({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onSurfaceMove = (e: React.PointerEvent) => {
    if (dragOut) { e.stopPropagation(); setDragOut({ x: e.clientX, y: e.clientY }); return; }

    if (lassoRef.current) {
      e.stopPropagation();
      const p = regionFromEvent(e);
      if (!p) return;
      const pts = lassoRef.current;
      const last = pts[pts.length - 1];
      // Thin the stream: a pointer emits far more samples than the curve needs,
      // and keeping all of them makes the path heavy to draw and to clip with
      // for no visible gain.
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return;
      pts.push(p);
      setLasso([...pts]);
      return;
    }

    const start = drawRef.current;
    if (!start) return;
    e.stopPropagation();
    const p = regionFromEvent(e);
    if (!p) return;
    setRegion({
      x: Math.min(start.x0, p.x),
      y: Math.min(start.y0, p.y),
      w: Math.abs(p.x - start.x0),
      h: Math.abs(p.y - start.y0),
    });
  };

  const onSurfaceUp = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }

    if (dragOut) {
      e.stopPropagation();
      const drop = { ...dragOut };
      setDragOut(null);
      void pullOut(drop);
      return;
    }
    if (lassoRef.current) {
      e.stopPropagation();
      const pts = lassoRef.current;
      lassoRef.current = null;
      setDrawing(false);
      // A tap, or a scribble too small to enclose anything.
      if (pts.length < 6) { setLasso(null); return; }
      void pullLasso(pts);
      return;
    }

    if (!drawRef.current) return;
    e.stopPropagation();
    drawRef.current = null;
    setDrawing(false);
    // A stray click rather than a drag: clear, don't leave a 0×0 selection that
    // looks like a bug.
    setRegion((r) => (r && (r.w < 0.012 || r.h < 0.012) ? null : r));
  };

  /** Where a pulled piece should land: under the cursor if it was dragged out,
   *  otherwise beside its source, stepping down so repeated pulls stack
   *  readably instead of burying each other. */
  const placeFor = (w: number, h: number, at?: { x: number; y: number }) => {
    if (at) {
      const world = screenToCanvas(at.x, at.y, useCanvasStore.getState().camera);
      return { x: world.x - w / 2, y: world.y - h / 2 };
    }
    const siblings = useCanvasStore.getState().objects
      .filter((o) => o.style?.pulledFrom === obj.id).length;
    return { x: obj.x + obj.width + 48, y: obj.y + siblings * 26 };
  };

  const spawnPiece = (dataUrl: string, width: number, height: number, at?: { x: number; y: number }) => {
    const box = fitPulledBox(width, height);
    const { x, y } = placeFor(box.width, box.height, at);
    const created = addObject({
      type: 'image', x, y, width: box.width, height: box.height, content: dataUrl,
      // Remembered so repeated pulls from one picture fan out rather than pile.
      style: { pulledFrom: obj.id },
    });
    setSelectedId(created.id);
    try { playSnap(); } catch { /* audio is optional */ }
    return created;
  };

  /** Turn the selected region into its own block. `at` = drop point in screen
   *  coords when it was dragged out; otherwise it lands beside the source. */
  const pullOut = async (at?: { x: number; y: number }) => {
    if (!region || region.w < 0.012 || region.h < 0.012) return;
    const r = region;

    await withPixels('Cutting', (raw) => {
      // Baked, so the piece keeps the look of the picture it came from.
      const img = bakeFilter(raw, filterCss);
      const { dataUrl, width, height } = cropRegion(img, r);
      spawnPiece(dataUrl, width, height, at);
      toast.success(`Pulled out ${width}×${height}`, { detail: 'A real image block — it stands on its own now.' });
      setRegion(null);
      return null;
    });
  };

  const pullLasso = async (pts: Point[]) => {
    await withPixels('Cutting', (raw) => {
      const img = bakeFilter(raw, filterCss);
      const cut = cropLasso(img, pts);
      setLasso(null);
      if (!cut) {
        toast.info('That loop was too small to cut');
        return null;
      }
      spawnPiece(cut.dataUrl, cut.width, cut.height);
      toast.success('Pulled out along your line', {
        detail: 'Everything outside the loop came away transparent.',
      });
      return null;
    });
  };

  const pullMagic = async (p: Point) => {
    await withPixels('Selecting', (raw) => {
      const img = bakeFilter(raw, filterCss);
      const cut = pullRegion(img, p, tolerance);
      if (!cut) {
        toast.info('Nothing solid enough there', {
          detail: 'Magic pull works on areas of one colour. Try the lasso for a photo.',
        });
        return null;
      }
      spawnPiece(cut.dataUrl, cut.width, cut.height);
      toast.success(`Pulled that region — ${cut.width}×${cut.height}`);
      return null;
    });
  };

  /* ---------------------------------------------------------------- cutout -- */

  /** Write a new picture onto the block, stashing the untouched one ONCE so
   *  Restore always goes back to the true original rather than to the previous
   *  cut — three refinement clicks should not need three undos. */
  const applyPixels = (dataUrl: string) => {
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    const style = { ...(live?.style || obj.style) } as Record<string, unknown>;
    if (typeof style.imageOriginal !== 'string') style.imageOriginal = obj.content;
    updateObject(obj.id, { content: dataUrl, style });
  };

  /** `tol` omitted → measure a starting tolerance from the picture itself. */
  const runCutout = async (tol?: number) => {
    await withPixels('Cutting out', (img) => {
      const chosen = tol ?? estimateTolerance(img);
      if (tol === undefined) setTolerance(chosen);

      const res = removeBackground(img, { tolerance: chosen });
      if (res.removedRatio < 0.005) {
        toast.info('Nothing looked like a background', {
          detail: 'Raise the tolerance, or use the wand to click the colour you want gone.',
        });
        return null;
      }
      /* Above ~92% there is essentially nothing left, which means the tolerance
         swallowed the subject too. Saying so — and leaving the picture alone —
         is far better than handing back an empty frame and letting the user
         work out that Restore is what they need. */
      if (res.removedRatio > 0.92) {
        toast.error('That took the whole picture', {
          detail: 'The subject is too close in colour to its background. Try a lower tolerance.',
        });
        return null;
      }
      applyPixels(res.dataUrl);
      try { playSnap(); } catch { /* audio is optional */ }
      toast.success(`Background removed — ${Math.round(res.removedRatio * 100)}% of the picture`, {
        detail: 'Drag the slider to take more or less; Restore puts it back.',
      });
      return null;
    }, 'original');
  };

  /** Wand: erase the region connected to the pixel that was clicked. Runs
   *  against the CURRENT content, so successive clicks accumulate. */
  const eraseAt = async (p: { x: number; y: number }) => {
    await withPixels('Erasing', (img) => {
      const res = removeBackground(img, { tolerance, seeds: [p] });
      if (res.removedRatio < 0.0005) {
        toast.info('That spot had nothing connected to erase');
        return null;
      }
      applyPixels(res.dataUrl);
      return null;
    });
  };

  /**
   * The inverse of cutting: take the SUBJECT out and leave the picture alone.
   *
   * Cut out edits the block in place, which is right when you wanted this
   * picture without its background. Often what you actually want is the thing
   * ON its own, next to the original — so this runs the same removal, trims the
   * empty margin the removal leaves behind, and hands back a block that is the
   * size and shape of the subject.
   */
  const pullSubject = async () => {
    await withPixels('Lifting subject', (raw) => {
      const img = bakeFilter(raw, filterCss);
      const cut = removeBackground(img, { tolerance });
      if (cut.removedRatio < 0.02 || cut.removedRatio > 0.97) {
        toast.info("Couldn't tell subject from background", {
          detail: 'Adjust the tolerance, or draw round it with the lasso.',
        });
        return null;
      }
      return cut.dataUrl;
    }, 'original').then(async (cutUrl) => {
      if (!cutUrl) return;
      // Second pass on the RESULT to trim the transparent margin — the subject
      // is somewhere inside a frame the size of the whole photograph.
      const img = await loadForPixels(cutUrl);
      const trimmed = trimTransparent(img) || { dataUrl: cutUrl, width: img.width, height: img.height };
      spawnPiece(trimmed.dataUrl, trimmed.width, trimmed.height);
      toast.success('Subject lifted out', { detail: 'Trimmed to its own edges, on its own block.' });
    });
  };

  /** Crop away the transparent margin left behind by a cut. */
  const trimEdges = async () => {
    await withPixels('Trimming', (img) => {
      const trimmed = trimTransparent(img);
      if (!trimmed) {
        toast.info('Nothing to trim — no empty margin');
        return null;
      }
      applyPixels(trimmed.dataUrl);
      // The block keeps its width and follows the new proportions, so the
      // picture doesn't stretch the moment it's trimmed.
      updateObject(obj.id, { height: Math.round(obj.width * (trimmed.height / trimmed.width)) });
      toast.success(`Trimmed to ${trimmed.width}×${trimmed.height}`);
      return null;
    });
  };

  /**
   * Break the picture into a grid of independent blocks.
   *
   * The most literal reading of "make it breakable": afterwards there is no
   * picture, there are pieces, and each is a block you can move, sort, annotate
   * or throw away on its own. Laid out in their original arrangement with a
   * small gap, so the grid still reads as the picture until you disturb it.
   */
  const runShatter = async () => {
    await withPixels('Shattering', (raw) => {
      const img = bakeFilter(raw, filterCss);
      const tiles = shatter(img, grid.cols, grid.rows);
      if (!tiles.length) {
        toast.info('This picture is too small to break up');
        return null;
      }
      const GAP = 10;
      const tileW = Math.round((obj.width - GAP * (grid.cols - 1)) / grid.cols);
      const tileH = Math.round((obj.height - GAP * (grid.rows - 1)) / grid.rows);
      const originX = obj.x + obj.width + 56;

      for (const t of tiles) {
        addObject({
          type: 'image',
          x: originX + t.col * (tileW + GAP),
          y: obj.y + t.row * (tileH + GAP),
          width: tileW,
          height: tileH,
          content: t.dataUrl,
          style: { pulledFrom: obj.id },
        });
      }
      try { playSnap(); } catch { /* audio is optional */ }
      toast.success(`Broken into ${tiles.length} pieces`, {
        detail: 'Each one is its own block now — move them anywhere.',
      });
      return null;
    });
  };

  const restore = () => {
    const original = obj.style?.imageOriginal as string | undefined;
    if (!original) return;
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    const style = { ...(live?.style || obj.style) } as Record<string, unknown>;
    delete style.imageOriginal;
    updateObject(obj.id, { content: original, style });
    toast.success('Original restored');
  };

  /* ------------------------------------------------------------ text/objects */

  /**
   * Grab the words AND the way they were set.
   *
   * Transcribing into a default 15px Inter paragraph loses the thing that made
   * the text worth grabbing: a pull-quote in a serif display face, a code
   * snippet, a handwritten note, a centred title. The block is born wearing the
   * closest match this app has for the lettering it came from — face, weight,
   * size and alignment — so it reads on the board the way it read in the
   * picture, and every one of those is an ordinary property you can change
   * afterwards.
   *
   * The COLOUR is measured off the pixels rather than taken from the model (see
   * measureInkColor); a hex a model invents is worse than none at all.
   */
  const runText = async () => {
    setBusy('Reading');
    try {
      /* The block is born the same width as the picture, and the type is sized
         against that width — so lettering that filled a third of the picture
         fills a third of the block, and the transcription lands looking like
         what it was lifted from rather than like a default paragraph. */
      const width = Math.max(240, Math.min(680, Math.round(obj.width)));
      const { text, empty, style } = await grabText(obj.content, width);
      if (empty) {
        toast.info('No readable text in this image');
        return;
      }

      const lines = text.split('\n').length;
      const created = addObject({
        type: 'text',
        x: obj.x + obj.width + 48,
        y: obj.y,
        width,
        height: Math.max(90, Math.min(640, lines * style.fontSize * 1.7 + 44)),
        content: text,
        style: {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textAlign: style.textAlign,
          ...(style.textColor ? { textColor: style.textColor } : {}),
        },
      });
      setSelectedId(created.id);
      try { playSnap(); } catch { /* audio is optional */ }

      const face = /Lora/.test(style.fontFamily) ? 'serif'
        : /JetBrains/.test(style.fontFamily) ? 'monospace'
        : /Caveat/.test(style.fontFamily) ? 'handwritten'
        : /Bebas/.test(style.fontFamily) ? 'display'
        : 'sans';
      toast.success(`Text grabbed — ${text.trim().split(/\s+/).length} words`, {
        detail: `Set in ${face}, ${style.fontWeight >= 600 ? 'bold' : 'regular'}, ${style.fontSize}px — matching the picture.`,
      });
    } catch (err) {
      toast.error("Couldn't read the text", { detail: err instanceof Error ? err.message : '' });
    } finally {
      setBusy(null);
    }
  };

  const runObjects = async () => {
    setBusy('Looking');
    setTool('objects');
    try {
      const found = await detectObjects(obj.content);
      setObjects(found);
      if (!found.length) toast.info('Nothing distinct enough to pull out', { detail: 'Draw a box by hand with Pull.' });
    } catch (err) {
      setObjects([]);
      toast.error("Couldn't look at this image", { detail: err instanceof Error ? err.message : '' });
    } finally {
      setBusy(null);
    }
  };

  const runPalette = async () => {
    setTool('palette');
    await withPixels('Reading colours', (img) => { setPalette(extractPalette(img, 6)); return null; });
  };

  /* =============================================================== render === */

  const pulling = tool === 'pull';
  const interactive = pulling || wand;

  return (
    <>
      {/* The picture surface: marquee + object outlines live here. It only
          takes pointer events while a tool that needs them is armed, so a
          selected image still drags around the board normally. */}
      <div
        ref={surfaceRef}
        className="absolute"
        style={{
          /* Laid over the RENDERED PICTURE, not the block — see displayRect.
             Because the two coincide, a fraction measured on this element is
             the same fraction of the image, and a crop lands where it looked
             like it would. */
          left: `${fit.left * 100}%`,
          top: `${fit.top * 100}%`,
          width: `${fit.width * 100}%`,
          height: `${fit.height * 100}%`,
          pointerEvents: interactive ? 'auto' : 'none',
          cursor: interactive ? 'crosshair' : undefined,
          zIndex: 6,
        }}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceUp}
      >
        {region && (region.w > 0.004 || region.h > 0.004) && (
          <>
            {/* Everything outside the box dims, so the crop reads as a crop. */}
            <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
              <div className="absolute" style={{ left: 0, top: 0, right: 0, height: `${region.y * 100}%`, background: 'rgba(8,7,6,0.5)' }} />
              <div className="absolute" style={{ left: 0, top: `${(region.y + region.h) * 100}%`, right: 0, bottom: 0, background: 'rgba(8,7,6,0.5)' }} />
              <div className="absolute" style={{ left: 0, top: `${region.y * 100}%`, width: `${region.x * 100}%`, height: `${region.h * 100}%`, background: 'rgba(8,7,6,0.5)' }} />
              <div className="absolute" style={{ left: `${(region.x + region.w) * 100}%`, top: `${region.y * 100}%`, right: 0, height: `${region.h * 100}%`, background: 'rgba(8,7,6,0.5)' }} />
            </div>
            <div
              className="absolute"
              style={{
                left: `${region.x * 100}%`, top: `${region.y * 100}%`,
                width: `${region.w * 100}%`, height: `${region.h * 100}%`,
                border: '2px solid var(--accent)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
                cursor: 'grab',
              }}
            >
              {/* Corner ticks — the universal "this is a crop" signal. */}
              {[['-2px', '-2px', '0'], ['-2px', 'auto', '0'], ['auto', '-2px', '0'], ['auto', 'auto', '0']].map((_, i) => (
                <span key={i} className="absolute" style={{
                  width: 9, height: 9, background: 'var(--accent)',
                  left: i % 2 === 0 ? -3 : undefined, right: i % 2 === 1 ? -3 : undefined,
                  top: i < 2 ? -3 : undefined, bottom: i >= 2 ? -3 : undefined,
                }} />
              ))}
              {!drawing && (
                <span
                  className="absolute whitespace-nowrap rounded-full text-[9.5px] font-bold uppercase tracking-wider text-white"
                  style={{ left: '50%', transform: 'translateX(-50%)', bottom: -24, padding: '3px 8px', background: 'var(--accent)' }}
                >
                  Drag onto the board
                </span>
              )}
            </div>
          </>
        )}

        {/* The lasso, drawn live. Two strokes: a dark one underneath so the
            line stays visible over a pale picture, the accent on top. */}
        {lasso && lasso.length > 1 && (
          <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {(() => {
              const d = `M ${lasso.map((p) => `${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(' L ')}${drawing ? '' : ' Z'}`;
              return (
                <>
                  {/* vectorEffect keeps the line one pixel wide however the
                      block is scaled — without it the 0–100 viewBox stretches
                      the stroke into a smear on a wide image. */}
                  <path d={d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                  <path d={d} fill="rgba(201,123,75,0.18)" stroke="var(--accent)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 4" />
                </>
              );
            })()}
          </svg>
        )}

        {/* Detected objects — proposals, each with its own pull button. */}
        {tool === 'objects' && objects?.map((o, i) => (
          <div
            key={i}
            className="absolute group/obj"
            style={{
              left: `${o.region.x * 100}%`, top: `${o.region.y * 100}%`,
              width: `${o.region.w * 100}%`, height: `${o.region.h * 100}%`,
              border: '1.5px dashed rgba(255,255,255,0.85)',
              borderRadius: 4,
              pointerEvents: 'auto',
              background: 'rgba(255,255,255,0.06)',
            }}
          >
            <button
              {...guard}
              onClick={(e) => { stop(e); setTool('pull'); setRegion(o.region); }}
              title={`Pull out “${o.label}”`}
              className="absolute whitespace-nowrap rounded-full text-[9.5px] font-bold cursor-pointer text-white transition-colors"
              style={{ left: 3, top: 3, padding: '3px 7px', background: 'rgba(8,7,6,0.78)' }}
            >
              {o.label} →
            </button>
          </div>
        ))}
      </div>

      {/* Ghost that follows the cursor while a selection is dragged off. */}
      {dragOut && (
        <div
          className="fixed rounded-lg pointer-events-none"
          style={{
            left: dragOut.x - 26, top: dragOut.y - 26, width: 52, height: 52, zIndex: 999999,
            border: '2px solid var(--accent)', background: 'rgba(201,123,75,0.22)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        />
      )}

      {/* ============================== TOOL RAIL ==============================
          BELOW the block, not on it. The first build floated the rail inside the
          picture's bottom edge and opened its panels upward over the image —
          which meant the tolerance slider sat on top of the very background you
          were judging, and on a small picture the controls covered nearly all of
          it. Everything that is chrome now lives outside the frame, and the only
          things drawn ON the image are the things that describe the image: the
          crop box and the detected regions.

          The rail comes first and panels stack DOWNWARD beneath it, so opening
          one never pushes the rail out from under the cursor that just hit it. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
        style={{ top: 'calc(100% + 10px)', zIndex: 8, pointerEvents: 'none' }}
      >
        {/* The rail itself */}
        <div
          className="flex items-center gap-0.5 rounded-full"
          style={{
            padding: 3, pointerEvents: 'auto',
            background: 'rgba(16,15,14,0.86)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 24px -10px rgba(0,0,0,0.7)',
          }}
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={stop}
        >
          <Tab active={pulling} onClick={() => { setTool(pulling ? null : 'pull'); setWand(false); }} label="Pull">{Icon.pull()}</Tab>
          <Tab active={tool === 'cutout'} onClick={() => {
            if (tool === 'cutout') { setTool(null); setWand(false); return; }
            setTool('cutout');
            if (!hasOriginal) void runCutout();
          }} label="Cut out">{Icon.cutout()}</Tab>
          <Tab active={tool === 'adjust'} onClick={() => setTool(tool === 'adjust' ? null : 'adjust')} label="Adjust">{Icon.adjust()}</Tab>
          <Tab onClick={() => void runText()} label="Text">{Icon.text()}</Tab>
          <Tab active={tool === 'objects'} onClick={() => { if (tool === 'objects') { setTool(null); return; } void runObjects(); }} label="Objects">{Icon.objects()}</Tab>
          <Tab active={tool === 'palette'} onClick={() => { if (tool === 'palette') { setTool(null); return; } void runPalette(); }} label="Colours">{Icon.palette()}</Tab>
          <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.14)', margin: '0 2px' }} />
          <Tab active={tool === 'shape'} onClick={() => setTool(tool === 'shape' ? null : 'shape')} label="Shape">{Icon.shape()}</Tab>

          {busy && (
            <span className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-white/70" style={{ padding: '0 8px 0 4px' }}>
              <span className="rounded-full border-2 border-white/70 border-t-transparent animate-spin" style={{ width: 10, height: 10 }} />
              {busy}
            </span>
          )}
        </div>

        {tool === 'shape' && (
          <Panel>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {IMAGE_SHAPE_CYCLE.map((s) => (
                <button
                  key={s}
                  {...guard}
                  onClick={(e) => { stop(e); updateObject(obj.id, { style: { ...obj.style, imageShape: s } }); }}
                  title={IMAGE_SHAPE_LABEL[s]}
                  className="flex items-center justify-center rounded-md cursor-pointer transition-colors"
                  style={{
                    width: 30, height: 30,
                    background: shape === s ? 'var(--accent)' : 'rgba(255,255,255,0.10)',
                  }}
                >
                  {/* Each swatch wears the very mask it applies, so the picker
                      is a preview rather than a list of words. */}
                  <span style={{
                    width: 17, height: 17, display: 'block',
                    background: shape === s ? '#fff' : 'rgba(255,255,255,0.85)',
                    ...(s === 'original' ? { borderRadius: 3 } : imageShapeStyle(s)),
                  }} />
                </button>
              ))}
            </div>
          </Panel>
        )}

        {tool === 'cutout' && (
          <Panel>
            <div className="flex items-center gap-2" style={{ minWidth: 216 }}>
              <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/55 shrink-0">Tolerance</span>
              <input
                type="range" min={3} max={45} value={Math.round(tolerance * 100)}
                onChange={(e) => setTolerance(Number(e.target.value) / 100)}
                onPointerUp={() => void runCutout(tolerance)}
                onMouseDown={stop} onPointerDown={stop}
                className="flex-1 min-w-0" style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-[10px] tabular-nums text-white/70 shrink-0" style={{ width: 24 }}>{Math.round(tolerance * 100)}</span>
            </div>
            <div className="flex items-center gap-1.5" style={{ marginTop: 7, flexWrap: 'wrap' }}>
              <RailBtn active={wand} onClick={() => setWand((v) => !v)} title="Click a colour on the picture to erase it">
                {Icon.wand(11)} Wand
              </RailBtn>
              <RailBtn onClick={() => void pullSubject()} title="Lift the subject out onto its own block, leaving this picture as it was" primary>
                Lift subject
              </RailBtn>
              <RailBtn onClick={() => void trimEdges()} title="Crop away the empty margin left behind">
                Trim edges
              </RailBtn>
              <RailBtn onClick={() => void runCutout(tolerance)} title="Remove the background again at this tolerance">
                Re-run
              </RailBtn>
              {hasOriginal && (
                <RailBtn onClick={restore} title="Put the untouched image back">
                  {Icon.restore(11)} Restore
                </RailBtn>
              )}
            </div>
          </Panel>
        )}

        {tool === 'palette' && palette && (
          <Panel>
            <div className="flex items-center gap-1.5">
              {palette.map((s) => (
                <button
                  key={s.hex}
                  {...guard}
                  onClick={(e) => {
                    stop(e);
                    void navigator.clipboard.writeText(s.hex).then(
                      () => toast.success(`Copied ${s.hex}`),
                      () => toast.error("Couldn't copy that colour"),
                    );
                  }}
                  title={`${s.hex} — click to copy`}
                  className="rounded-md cursor-pointer shrink-0"
                  style={{ width: 30, height: 30, background: s.hex, border: '1px solid rgba(255,255,255,0.35)' }}
                />
              ))}
            </div>
          </Panel>
        )}

        {tool === 'pull' && (
          <Panel>
            <div className="flex items-center gap-1.5">
              {([
                ['box', 'Box', 'Drag a rectangle'],
                ['lasso', 'Lasso', 'Draw freehand around anything'],
                ['magic', 'Magic', 'Click an area of one colour to lift it'],
              ] as const).map(([m, label, title]) => (
                <RailBtn key={m} active={pullMode === m} onClick={() => { setPullMode(m); setRegion(null); setLasso(null); }} title={title}>
                  {label}
                </RailBtn>
              ))}
              <span style={{ width: 1, height: 15, background: 'rgba(255,255,255,0.16)', margin: '0 3px' }} />
              <RailBtn onClick={() => void runShatter()} title={`Break the picture into ${grid.cols}×${grid.rows} separate blocks`}>
                Shatter {grid.cols}×{grid.rows}
              </RailBtn>
              <select
                value={`${grid.cols}x${grid.rows}`}
                onChange={(e) => { const [c, r] = e.target.value.split('x').map(Number); setGrid({ cols: c, rows: r }); }}
                onMouseDown={stop} onPointerDown={stop} onClick={stop}
                className="rounded-full text-[9.5px] font-bold uppercase tracking-wider cursor-pointer outline-none"
                style={{ padding: '4px 6px', background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none' }}
              >
                {['2x2', '3x3', '4x4', '3x1', '1x3', '4x2'].map((g) => (
                  <option key={g} value={g} style={{ background: '#1a1918' }}>{g}</option>
                ))}
              </select>
            </div>

            <div className="text-[10px] text-white/60" style={{ marginTop: 7 }}>
              {pullMode === 'box' && (region
                ? 'Drag the box onto the board, or press Pull out.'
                : 'Drag a rectangle over anything — then drag it onto the board.')}
              {pullMode === 'lasso' && 'Draw a loop around anything. It comes away in that exact shape.'}
              {pullMode === 'magic' && 'Click any area of flat colour to lift the whole of it out.'}
            </div>

            {region && pullMode === 'box' && (
              <div className="flex items-center gap-1.5" style={{ marginTop: 7 }}>
                <RailBtn onClick={() => void pullOut()} title="Place it beside this image" primary>Pull out</RailBtn>
                <RailBtn onClick={() => setRegion(null)} title="Clear the box">Clear</RailBtn>
              </div>
            )}
          </Panel>
        )}

        {tool === 'adjust' && (
          <Panel>
            <div className="flex items-center gap-1" style={{ marginBottom: 8 }}>
              {IMAGE_LOOKS.map((look) => (
                <button
                  key={look.id}
                  {...guard}
                  onClick={(e) => { stop(e); commitAdjust({ ...look.adjust }); }}
                  title={look.label}
                  className="rounded-full text-[9.5px] font-bold uppercase tracking-wider cursor-pointer transition-colors"
                  style={{
                    padding: '5px 9px',
                    background: JSON.stringify({ ...NEUTRAL_ADJUST, ...adjust }) === JSON.stringify({ ...NEUTRAL_ADJUST, ...look.adjust })
                      ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                    color: '#fff',
                  }}
                >
                  {look.label}
                </button>
              ))}
            </div>

            {([
              ['exposure', 'Light', -100, 100],
              ['contrast', 'Contrast', -100, 100],
              ['saturation', 'Colour', -100, 100],
              ['warmth', 'Warmth', -100, 100],
              ['blur', 'Blur', 0, 20],
            ] as const).map(([key, label, min, max]) => (
              <div key={key} className="flex items-center gap-2" style={{ minWidth: 250, marginTop: 3 }}>
                <span className="text-[9.5px] font-bold uppercase tracking-widest text-white/55 shrink-0" style={{ width: 56 }}>{label}</span>
                <input
                  type="range" min={min} max={max} value={adjust[key]}
                  // Repaint on every frame of the drag (cheap — it is a CSS
                  // filter), but only WRITE to the store on release.
                  onChange={(e) => setAdjust((a) => ({ ...a, [key]: Number(e.target.value) }))}
                  onPointerUp={() => commitAdjust(adjust)}
                  onMouseDown={stop} onPointerDown={stop}
                  className="flex-1 min-w-0" style={{ accentColor: 'var(--accent)' }}
                />
                <span className="text-[10px] tabular-nums text-white/60 shrink-0" style={{ width: 28 }}>{adjust[key]}</span>
              </div>
            ))}

            {!isNeutralAdjust(adjust) && (
              <div style={{ marginTop: 8 }}>
                <RailBtn onClick={() => commitAdjust({ ...NEUTRAL_ADJUST })} title="Back to the untouched look">
                  {Icon.restore(11)} Reset look
                </RailBtn>
              </div>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ bits --- */

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl"
      style={{
        pointerEvents: 'auto',
        padding: '8px 10px',
        background: 'rgba(16,15,14,0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 10px 30px -12px rgba(0,0,0,0.75)',
      }}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
    >
      {children}
    </div>
  );
}

function Tab({ children, label, active, onClick }: {
  children: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      className="flex items-center gap-1 rounded-full cursor-pointer transition-colors"
      style={{
        padding: '5px 9px',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.82)',
      }}
    >
      {children}
      <span className="text-[9.5px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function RailBtn({ children, onClick, title, active, primary }: {
  children: React.ReactNode; onClick: () => void; title: string; active?: boolean; primary?: boolean;
}) {
  return (
    <button
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="flex items-center gap-1 rounded-full text-[9.5px] font-bold uppercase tracking-wider cursor-pointer transition-colors"
      style={{
        padding: '5px 10px',
        background: primary ? 'var(--accent)' : active ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
        color: '#fff',
      }}
    >
      {children}
    </button>
  );
}
