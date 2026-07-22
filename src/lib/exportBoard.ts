import { toPng } from 'html-to-image';
import { useCanvasStore } from '@/store/canvasStore';

/**
 * Export the current board as a full-resolution PNG or PDF.
 *
 * Rather than screenshotting the viewport (which would crop to whatever's on
 * screen and bake in the current zoom), we capture the `.canvas-world` layer
 * itself with its camera transform overridden to a neutral 1:1 translate — so
 * the whole board renders at true size regardless of how it's currently panned.
 *
 * Cross-origin iframes (embeds/browser blocks) can't be rasterized by the
 * browser and are skipped; everything else — text, cards, shapes, connections,
 * charts, images — comes through crisply.
 */

interface Bounds { minX: number; minY: number; width: number; height: number; }

function boardBounds(pad = 80): Bounds | null {
  const objs = useCanvasStore.getState().objects;
  if (!objs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + (o.width || 0));
    maxY = Math.max(maxY, o.y + (o.height || 0));
  }
  if (!isFinite(minX)) return null;
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function paperColor(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
    return v || '#FAF6F1';
  } catch {
    return '#FAF6F1';
  }
}

async function captureBoard(scale = 2): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const world = document.querySelector('.canvas-world') as HTMLElement | null;
  if (!world) return null;
  const bounds = boardBounds();
  if (!bounds) return null;

  // Cap the pixel size so a huge board doesn't blow past canvas limits (~16k px).
  const MAX_PX = 12000;
  const px = Math.min(scale, MAX_PX / bounds.width, MAX_PX / bounds.height);

  /* Semantic zoom is a VIEWING aid, and an export is the board as written.
     The two collide here: we neutralize the camera for the capture, but the
     React tree still reflects the camera the user actually left it at — so
     exporting from a zoomed-out view would raster every text block as its
     one-line gist, blown up to full size, with the real prose faded to
     nothing underneath. `exporting` suspends it for the duration. */
  world.classList.add('exporting');
  try {
    const dataUrl = await toPng(world, {
      width: bounds.width,
      height: bounds.height,
      pixelRatio: Math.max(1, px),
      backgroundColor: paperColor(),
      cacheBust: true,
      // Neutralize the camera; place the board's top-left at the origin.
      style: {
        transform: `translate(${-bounds.minX}px, ${-bounds.minY}px)`,
        transformOrigin: '0 0',
      },
      // Skip iframes — they can't be captured and would throw.
      filter: (node) => !(node instanceof HTMLIFrameElement),
    });

    return { dataUrl, width: bounds.width, height: bounds.height };
  } finally {
    world.classList.remove('exporting');
  }
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function slug(title: string): string {
  return (title || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'board';
}

export async function exportBoardPNG(title: string): Promise<void> {
  const cap = await captureBoard();
  if (!cap) throw new Error('Nothing to export');
  download(cap.dataUrl, `${slug(title)}.png`);
}

export async function exportBoardPDF(title: string): Promise<void> {
  const cap = await captureBoard();
  if (!cap) throw new Error('Nothing to export');
  const { jsPDF } = await import('jspdf');
  const orientation = cap.width >= cap.height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'px', format: [cap.width, cap.height], compress: true });
  pdf.addImage(cap.dataUrl, 'PNG', 0, 0, cap.width, cap.height);
  pdf.save(`${slug(title)}.pdf`);
}
