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
 * Smart alignment snapping
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
  const guides: Array<{ axis: 'h' | 'v'; pos: number }> = [];

  const dragCenterX = dragX + dragW / 2;
  const dragCenterY = dragY + dragH / 2;
  const dragRight = dragX + dragW;
  const dragBottom = dragY + dragH;

  for (const other of others) {
    const otherCenterX = other.x + other.width / 2;
    const otherCenterY = other.y + other.height / 2;
    const otherRight = other.x + other.width;
    const otherBottom = other.y + other.height;

    // Horizontal alignment
    if (Math.abs(dragX - other.x) < threshold) {
      snapX = other.x;
      guides.push({ axis: 'v', pos: other.x });
    } else if (Math.abs(dragRight - otherRight) < threshold) {
      snapX = otherRight - dragW;
      guides.push({ axis: 'v', pos: otherRight });
    } else if (Math.abs(dragCenterX - otherCenterX) < threshold) {
      snapX = otherCenterX - dragW / 2;
      guides.push({ axis: 'v', pos: otherCenterX });
    }

    // Vertical alignment
    if (Math.abs(dragY - other.y) < threshold) {
      snapY = other.y;
      guides.push({ axis: 'h', pos: other.y });
    } else if (Math.abs(dragBottom - otherBottom) < threshold) {
      snapY = otherBottom - dragH;
      guides.push({ axis: 'h', pos: otherBottom });
    } else if (Math.abs(dragCenterY - otherCenterY) < threshold) {
      snapY = otherCenterY - dragH / 2;
      guides.push({ axis: 'h', pos: otherCenterY });
    }
  }

  return { x: snapX, y: snapY, guides };
}
