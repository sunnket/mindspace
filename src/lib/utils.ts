/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The canvas box an image should occupy: its OWN aspect ratio, scaled to fit
 * within a sane maximum. Every path that puts a picture on the canvas (paste,
 * file drop, drag-in) goes through this — they each used to hardcode 300x200,
 * which squashed anything that wasn't 3:2.
 *
 * Never rejects: an image the browser can't decode still gets a usable box.
 */
export function fitImageBox(
  src: string,
  maxW = 420,
  maxH = 420,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const fallback = { width: 300, height: 200 };
    if (typeof window === 'undefined' || !src) return resolve(fallback);

    const probe = new window.Image();
    probe.onload = () => {
      const nw = probe.naturalWidth;
      const nh = probe.naturalHeight;
      if (!nw || !nh) return resolve(fallback);
      const scale = Math.min(1, maxW / nw, maxH / nh);
      resolve({
        width: Math.max(40, Math.round(nw * scale)),
        height: Math.max(40, Math.round(nh * scale)),
      });
    };
    probe.onerror = () => resolve(fallback);
    probe.src = src;
  });
}

/**
 * Convert screen coordinates to canvas (world) coordinates
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  camera: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

/**
 * Convert canvas coordinates to screen coordinates
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  camera: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  return {
    x: canvasX * camera.zoom + camera.x,
    y: canvasY * camera.zoom + camera.y,
  };
}

type Camera = { x: number; y: number; zoom: number };

/**
 * The world point sitting at the centre of MY viewport, given my camera.
 * This is the unit of "where someone is looking" that survives being sent to a
 * peer with a differently-sized window — unlike a raw camera offset, which
 * frames a different region on a different screen.
 */
export function viewportCenterWorld(camera: Camera): { x: number; y: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  return screenToCanvas(w / 2, h / 2, camera);
}

/**
 * The camera that puts a given world point dead-centre in MY viewport at a
 * given zoom. The inverse of {@link viewportCenterWorld} — the receiving half
 * of "follow" and "present", so both people frame the same content regardless
 * of window size.
 */
export function cameraForWorldCenter(cx: number, cy: number, zoom: number): Camera {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  return { x: w / 2 - cx * zoom, y: h / 2 - cy * zoom, zoom };
}

/**
 * A camera that frames an axis-aligned world bounding box inside the current
 * viewport with a little breathing room. Used to drop a joining collaborator
 * straight onto the shared content instead of wherever they happened to be.
 */
export function cameraToFitBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  opts?: { padding?: number; maxZoom?: number; minZoom?: number }
): Camera {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  const padding = opts?.padding ?? 140;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min(
    opts?.maxZoom ?? 1,
    Math.max(opts?.minZoom ?? 0.15, Math.min((w - padding) / bw, (h - padding) / bh))
  );
  return cameraForWorldCenter((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, zoom);
}

/**
 * Smooth interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Distance between two points
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= limit) {
      lastTime = now;
      fn(...args);
    }
  };
}

/**
 * Generate a random pastel color
 */
export function randomStickyColor(): string {
  const colors = [
    'var(--sticky-yellow)',
    'var(--sticky-pink)',
    'var(--sticky-blue)',
    'var(--sticky-green)',
    'var(--sticky-purple)',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Check if point is inside rect
 */
export function isPointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * The one drag gesture currently in flight, anywhere on the board.
 *
 * Module-level on purpose: `objectDrag` flips many times a second and must
 * never cause a render. The canvas reads it to make sure a block drag and a
 * viewport pan can never run at the same time — when they did, the camera
 * scrolled under a block that was glued to the cursor and the block ended up
 * flung to a completely different part of the board.
 *
 * `endActive` is the safety net that matters more. A drag holds real
 * resources — window listeners, a requestAnimationFrame loop, these flags —
 * and every one of them used to be released by a single `mouseup`. The
 * browser does not promise to deliver that event: release the button outside
 * the window, alt-tab mid-drag, let the OS take the pointer, and it simply
 * never arrives. The drag then never ended. Its move handler kept dragging
 * the block around with no button held, and its rAF loop kept auto-panning
 * the viewport — a board that scrolled away by itself and blocks that fled
 * the cursor. Nothing recovered, because nothing was left to notice.
 *
 * So a session publishes its own teardown here, and anything that learns the
 * gesture is over can end it: the next mousedown, a pointercancel, the window
 * losing focus, or simply a mousemove that arrives with no buttons pressed.
 */
export const dragState: {
  objectDrag: boolean;
  endActive: (() => void) | null;
} = { objectDrag: false, endActive: null };

/** End whatever drag is in flight. Idempotent, and safe to call from anywhere. */
export function endActiveDrag(): void {
  const end = dragState.endActive;
  dragState.endActive = null;
  dragState.objectDrag = false;
  if (end) end();
}

/**
 * Smart alignment snapping.
 *
 * Picks the CLOSEST alignment on each axis. It used to keep whichever match it
 * happened to test LAST, so on a dense board (a template, a tidy column of
 * cards) a block would flick between two far-apart neighbours as you dragged —
 * the "it jumps somewhere else" bug. Nearest-wins is stable: the guide you can
 * see is the one it snaps to.
 */
export function getSnapPoints(
  dragX: number,
  dragY: number,
  dragW: number,
  dragH: number,
  others: Array<{ x: number; y: number; width: number; height: number }>,
  threshold: number = 8
): { x: number | null; y: number | null; guides: Array<{ axis: 'h' | 'v'; pos: number }> } {
  let snapX: number | null = null;
  let snapY: number | null = null;
  let bestX = threshold;
  let bestY = threshold;
  const guides: Array<{ axis: 'h' | 'v'; pos: number }> = [];

  const dragCenterX = dragX + dragW / 2;
  const dragCenterY = dragY + dragH / 2;
  const dragRight = dragX + dragW;
  const dragBottom = dragY + dragH;

  /** Keep this candidate only if it's tighter than anything seen so far. */
  const considerX = (dist: number, snapped: number, guide: number) => {
    if (dist >= bestX) return;
    bestX = dist;
    snapX = snapped;
    guides.push({ axis: 'v', pos: guide });
  };
  const considerY = (dist: number, snapped: number, guide: number) => {
    if (dist >= bestY) return;
    bestY = dist;
    snapY = snapped;
    guides.push({ axis: 'h', pos: guide });
  };

  for (const other of others) {
    const otherCenterX = other.x + other.width / 2;
    const otherCenterY = other.y + other.height / 2;
    const otherRight = other.x + other.width;
    const otherBottom = other.y + other.height;

    // Horizontal alignment — left edges, right edges, centres.
    considerX(Math.abs(dragX - other.x), other.x, other.x);
    considerX(Math.abs(dragRight - otherRight), otherRight - dragW, otherRight);
    considerX(Math.abs(dragCenterX - otherCenterX), otherCenterX - dragW / 2, otherCenterX);

    // Vertical alignment — top edges, bottom edges, centres.
    considerY(Math.abs(dragY - other.y), other.y, other.y);
    considerY(Math.abs(dragBottom - otherBottom), otherBottom - dragH, otherBottom);
    considerY(Math.abs(dragCenterY - otherCenterY), otherCenterY - dragH / 2, otherCenterY);
  }

  return { x: snapX, y: snapY, guides };
}
