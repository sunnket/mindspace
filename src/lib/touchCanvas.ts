/**
 * ------------------------------------------------------------------
 * THE FINGER LAYER — what makes this board usable on a phone.
 *
 * Every gesture in this app was written for a mouse: `onMouseDown` on the
 * container to pan, `onMouseDown` on a block to drag it, `window` mousemove
 * loops for resize, connectors, arrow endpoints, the lot. On a touchscreen
 * NONE of that runs. A browser only emits the compatibility mouse events
 * (mousedown/mouseup/click) for a *tap*; the moment a finger travels, the
 * sequence is treated as a scroll and no mousemove is ever dispatched. That is
 * the whole reason the board could not be dragged, and why the wheel-based zoom
 * had no counterpart at all.
 *
 * There were two ways to fix it. Rewrite forty mouse handlers across twenty
 * files as pointer handlers — a large diff through the most delicate code in
 * the app, every line of it a chance to break the desktop that already works.
 * Or translate at the boundary: read the touches here, and speak mouse to
 * everything behind us. This file is the second choice, and it is the reason
 * dragging a card, resizing it, pulling an arrow endpoint and moving a frame
 * all started working on a phone without a single one of those files changing.
 *
 * The rules it implements:
 *
 *   · One finger on the board pans it. Always — a phone screen is mostly
 *     covered by blocks, so "drag empty space" is not a real gesture there.
 *   · One finger on a SELECTED block moves that block. Tap to pick it up,
 *     then drag: the same two-step every touch canvas uses, and the reason you
 *     can't shove a card across the board while trying to scroll past it.
 *   · Two fingers pinch to zoom and pan together, anywhere, over anything —
 *     including mid-stroke while drawing.
 *   · A finger inside something scrollable (a long checklist, a repo tree, a
 *     table) scrolls that, not the board. Same rule the wheel already follows.
 *   · A tap is left completely alone, so every `onClick` in the app — and
 *     tap-empty-board-to-write — keeps working exactly as it does with a mouse.
 *
 * Nothing here runs on a desktop: touch events are simply never dispatched by
 * a mouse. That is the safety property the whole design rests on.
 * ------------------------------------------------------------------
 */

export type Camera = { x: number; y: number; zoom: number };

export interface TouchCanvasHooks {
  /** Live camera read — never a closed-over copy. */
  getCamera(): Camera;
  /** Write the camera. Called at most once per animation frame. */
  setCamera(cam: Camera): void;
  minZoom: number;
  maxZoom: number;
  /** Ignore everything (tour playback owns the camera). */
  isSuspended(): boolean;
  /** The drawing layer owns single-finger input; two fingers still zoom. */
  isDrawing(): boolean;
  /** Is this element part of something the user may drag right now? */
  isDraggable(el: HTMLElement): boolean;
  /** A multi-finger gesture just took over — abandon any stroke in progress. */
  onMultiTouch?(): void;
}

/** Travel that still counts as a tap rather than a drag. */
const SLOP = 8;
/** Below this speed at lift-off, no momentum — it was a placement, not a flick. */
const FLING_MIN = 0.08;
/** Per-frame decay of a flick. 0.92 ≈ half a second of glide. */
const FLING_DECAY = 0.92;

type Mode = 'none' | 'undecided' | 'pan' | 'drag' | 'scroll' | 'pinch' | 'native';

interface Pt { x: number; y: number }

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Speak mouse on behalf of a finger.
 *
 * `buttons: 1` is load-bearing: the board's own pan handler treats
 * `e.buttons === 0` as proof that no gesture is live and bails, which is the
 * guard that stops a dead press from panning forever. A synthetic move that
 * forgot to say a button is down would be discarded by it every time.
 */
function fireMouse(target: EventTarget, type: string, p: Pt, opts: { buttons?: number } = {}) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    button: 0,
    buttons: opts.buttons ?? (type === 'mouseup' ? 0 : 1),
    clientX: p.x,
    clientY: p.y,
    screenX: p.x,
    screenY: p.y,
  });
  target.dispatchEvent(ev);
}

/** The nearest ancestor that can genuinely scroll along `axis`. */
function findScrollable(from: Element | null, root: Element, axis: 'x' | 'y'): HTMLElement | null {
  let node: Element | null = from;
  while (node && node !== root) {
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      const cs = getComputedStyle(el);
      const overflow = axis === 'y' ? cs.overflowY : cs.overflowX;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
        const can = axis === 'y'
          ? el.scrollHeight > el.clientHeight + 1
          : el.scrollWidth > el.clientWidth + 1;
        if (can) return el;
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** Caret placement and text selection stay entirely native. */
function isTextSurface(el: Element | null) {
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

export function attachTouchCanvas(container: HTMLElement, hooks: TouchCanvasHooks): () => void {
  let mode: Mode = 'none';
  /** The finger this gesture belongs to. A second one starting a pinch, a
      third landing on the screen, or the palm of a hand must not redirect it. */
  let touchId = -1;

  let start: Pt = { x: 0, y: 0 };
  let last: Pt = { x: 0, y: 0 };
  let startCam: Camera = { x: 0, y: 0, zoom: 1 };
  let dragTarget: EventTarget | null = null;

  let scrollEl: HTMLElement | null = null;
  let scrollAxis: 'x' | 'y' = 'y';
  /** Blocks live inside the scaled world, so a finger's screen pixels are worth
      1/zoom of the block's own scroll. Without this a table scrolled at half
      speed when zoomed out and bolted when zoomed in. */
  let scrollScale = 1;

  let pinchDist = 0;
  let pinchCam: Camera = { x: 0, y: 0, zoom: 1 };
  let pinchMid: Pt = { x: 0, y: 0 };

  // Velocity, for the flick that keeps going after your finger leaves.
  let vx = 0;
  let vy = 0;
  let lastT = 0;

  let pending: Camera | null = null;
  let raf: number | null = null;
  let flingRaf: number | null = null;

  const flush = () => {
    raf = null;
    if (pending) {
      hooks.setCamera(pending);
      pending = null;
    }
  };
  /* One camera write per frame, whatever the touch sampling rate. Phones report
     touches at up to 240Hz; without this the store (and every subscriber of it)
     would run four times per painted frame for no visible gain. */
  const queueCamera = (cam: Camera) => {
    pending = cam;
    if (raf == null) raf = requestAnimationFrame(flush);
  };

  const stopFling = () => {
    if (flingRaf != null) cancelAnimationFrame(flingRaf);
    flingRaf = null;
  };

  const startFling = () => {
    if (Math.hypot(vx, vy) < FLING_MIN) return;
    const step = () => {
      vx *= FLING_DECAY;
      vy *= FLING_DECAY;
      if (Math.hypot(vx, vy) < FLING_MIN) { flingRaf = null; return; }
      const cam = hooks.getCamera();
      hooks.setCamera({ ...cam, x: cam.x + vx * 16, y: cam.y + vy * 16 });
      flingRaf = requestAnimationFrame(step);
    };
    flingRaf = requestAnimationFrame(step);
  };

  const pointOf = (t: Touch): Pt => ({ x: t.clientX, y: t.clientY });

  const findTouch = (list: TouchList, id: number): Touch | null => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  };

  /** Whatever was in flight is over — used by pinch takeover and by cancel. */
  const endDragIfAny = (at: Pt) => {
    if (mode === 'drag' && dragTarget) fireMouse(dragTarget, 'mouseup', at, { buttons: 0 });
    dragTarget = null;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (hooks.isSuspended()) return;
    stopFling();

    if (e.touches.length >= 2) {
      /* Two fingers outrank everything. A drag or a stroke already running is
         closed out cleanly first, so nothing is left believing it's still live
         while the board scales underneath it. */
      const a = pointOf(e.touches[0]);
      const b = pointOf(e.touches[1]);
      endDragIfAny(mid(a, b));
      hooks.onMultiTouch?.();
      mode = 'pinch';
      touchId = -1;
      pinchDist = Math.max(1, dist(a, b));
      pinchMid = mid(a, b);
      pinchCam = { ...hooks.getCamera() };
      e.preventDefault();
      return;
    }

    if (e.touches.length !== 1) return;

    const t = e.touches[0];
    touchId = t.identifier;
    start = last = pointOf(t);
    startCam = { ...hooks.getCamera() };
    vx = vy = 0;
    lastT = e.timeStamp;

    const target = t.target as HTMLElement | null;

    // The drawing layer owns one finger while the brush is out.
    if (hooks.isDrawing()) { mode = 'native'; return; }

    /* Order matters here, and getting it wrong is what made a selected card
       refuse to move: a text block's words ARE a contenteditable surface, so
       asking "is this text?" first handed every drag that started on a card's
       own writing to the browser — which is most of the card. Asking "may this
       be dragged?" first puts the question the right way round. `isDraggable`
       is what knows the difference between a block you have picked up and a
       block you are typing into; caret dragging is preserved by that, not by
       the check below. */
    if (!(target && hooks.isDraggable(target)) && isTextSurface(target)) {
      mode = 'native';
      return;
    }

    dragTarget = target;
    mode = 'undecided';
  };

  const onTouchMove = (e: TouchEvent) => {
    if (mode === 'none' || mode === 'native') return;

    if (mode === 'pinch') {
      if (e.touches.length < 2) return;
      const a = pointOf(e.touches[0]);
      const b = pointOf(e.touches[1]);
      const d = Math.max(1, dist(a, b));
      const m = mid(a, b);

      const zoom = clamp(pinchCam.zoom * (d / pinchDist), hooks.minZoom, hooks.maxZoom);
      /* Two things move at once and both have to stay true: the world point
         that was under the midpoint stays under the midpoint (that's the scale
         anchor), and the midpoint itself is free to travel (that's the pan).
         Solving them together is what makes a pinch feel like the board is
         under your fingers instead of being remote-controlled by them. */
      const k = zoom / pinchCam.zoom;
      queueCamera({
        zoom,
        x: m.x - (pinchMid.x - pinchCam.x) * k,
        y: m.y - (pinchMid.y - pinchCam.y) * k,
      });
      e.preventDefault();
      return;
    }

    const t = findTouch(e.touches, touchId);
    if (!t) return;
    const p = pointOf(t);

    if (mode === 'undecided') {
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.hypot(dx, dy) < SLOP) return;   // still a tap; decide nothing yet

      const axis: 'x' | 'y' = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
      const el = dragTarget as HTMLElement | null;
      const scroller = el ? findScrollable(el, container, axis) : null;

      if (el && hooks.isDraggable(el)) {
        mode = 'drag';
        /* The press the rest of the app never saw. It is sent at the point the
           finger STARTED from, not where it is now, so every handler downstream
           records the same origin a mouse would have given it and the move
           below lands as an ordinary 8px drag rather than a jump. */
        fireMouse(el, 'mousedown', start);
      } else if (scroller) {
        /* A drag beats an inner scroll, which is why this branch is second.
           Selecting a block is an explicit "I want to move this"; if a long
           checklist could still hijack that, a selected list would be a card
           you can never reposition. Tap the board to let it go and the list
           scrolls again — one rule, and you can always get to both. */
        mode = 'scroll';
        scrollEl = scroller;
        scrollAxis = axis;
        /* The world layer is CSS-scaled, so anything inside it scrolls in its
           own coordinates, not the screen's. Chrome would have handled this for
           us — but `touch-action: none` on the board (which is what stops the
           PAGE from moving) switches native touch scrolling off for every
           descendant too, so the scroll has to be driven by hand from here. */
        scrollScale = el?.closest('.canvas-world') ? 1 / Math.max(0.05, hooks.getCamera().zoom) : 1;
      } else {
        mode = 'pan';
      }
    }

    const now = e.timeStamp;
    const dt = Math.max(1, now - lastT);

    if (mode === 'scroll' && scrollEl) {
      const delta = (scrollAxis === 'y' ? last.y - p.y : last.x - p.x) * scrollScale;
      if (scrollAxis === 'y') scrollEl.scrollTop += delta;
      else scrollEl.scrollLeft += delta;
      last = p;
      lastT = now;
      e.preventDefault();
      return;
    }

    if (mode === 'drag' && dragTarget) {
      fireMouse(dragTarget, 'mousemove', p);
      last = p;
      lastT = now;
      e.preventDefault();
      return;
    }

    if (mode === 'pan') {
      // Absolute, measured from where the gesture began: a frame that swallows
      // three touchmoves lands on the newest one instead of summing all three.
      queueCamera({
        zoom: startCam.zoom,
        x: startCam.x + (p.x - start.x),
        y: startCam.y + (p.y - start.y),
      });
      vx = (p.x - last.x) / dt;
      vy = (p.y - last.y) / dt;
      last = p;
      lastT = now;
      e.preventDefault();
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (mode === 'pinch') {
      // Fingers can leave one at a time. Stay in pinch until the screen is
      // clear, otherwise the survivor instantly becomes a one-finger pan and
      // the board lurches at the end of every zoom.
      if (e.touches.length === 0) { mode = 'none'; touchId = -1; }
      e.preventDefault();
      return;
    }

    if (mode === 'drag' && dragTarget) {
      fireMouse(dragTarget, 'mouseup', last, { buttons: 0 });
      e.preventDefault();
    } else if (mode === 'pan') {
      startFling();
      e.preventDefault();
    }
    // 'undecided' means the finger never travelled: this was a tap, and the
    // browser's own compatibility mouse events are about to deliver it. Doing
    // nothing here is what keeps every onClick in the app working.

    dragTarget = null;
    scrollEl = null;
    mode = 'none';
    touchId = -1;
  };

  const onTouchCancel = () => {
    endDragIfAny(last);
    scrollEl = null;
    mode = 'none';
    touchId = -1;
  };

  // `passive: false` throughout — every one of these may need preventDefault.
  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: false });
  container.addEventListener('touchcancel', onTouchCancel, { passive: false });

  return () => {
    stopFling();
    if (raf != null) cancelAnimationFrame(raf);
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', onTouchCancel);
  };
}
