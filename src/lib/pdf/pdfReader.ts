/**
 * Client-side PDF engine for the immersive reader.
 *
 * The rest of the app only ever reads a PDF's *text* (server-side, via
 * /api/file-extract). This module is different: it renders the real pages in the
 * browser with pdf.js so we can build a proper reading experience on top —
 * page canvases, a text layer for selection, per-page reflow text, thumbnails.
 *
 * pdf.js is heavy and browser-only, so it's pulled in with a dynamic import the
 * first time a PDF is opened (keeps it out of the main bundle and off the
 * server). The worker is served as a static asset from /public so we never fight
 * the bundler over its resolution — see public/pdf.worker.min.mjs (kept in sync
 * with the pinned pdfjs-dist version in package.json).
 */

// Loose structural types — pdfjs-dist's shipped types don't survive a dynamic
// import cleanly, and we only touch a small, stable slice of the API.
export interface PdfPageText {
  /** One line of text (pdf.js text items grouped by their y position). */
  lines: string[];
  /** The whole page as a single reflowable string. */
  text: string;
}

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  width: number;   // CSS pixels (logical)
  height: number;
}

/** A positioned, selectable text run for the invisible selection layer. */
export interface TextSpan { x: number; y: number; h: number; w: number; text: string }
export interface PageTextLayer { spans: TextSpan[]; width: number; height: number }

interface PdfViewport {
  width: number;
  height: number;
  transform: number[];
}
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void>; cancel?: () => void };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup?: () => void;
}
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?: () => Promise<void>;
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array } | { url: string }): { promise: Promise<PdfDoc> };
  version?: string;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = (await import('pdfjs-dist')) as unknown as PdfjsModule;
      // Static worker path — bulletproof vs. Turbopack's virtualized resolution.
      mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return mod;
    })();
  }
  return pdfjsPromise;
}

/**
 * A live PDF document handle plus everything the reader caches for it: rendered
 * page canvases (by a "page@scale" key), thumbnails, and per-page text. One of
 * these is kept per open reader session and torn down on close.
 */
export class PdfSession {
  readonly doc: PdfDoc;
  readonly numPages: number;
  private pageCache = new Map<number, Promise<PdfPage>>();
  private textCache = new Map<number, Promise<PdfPageText>>();
  private thumbCache = new Map<number, Promise<string>>();
  /* Rasterised pages, keyed page@width@dpr, most-recently-used last.
     The flipbook is the reason this exists: a turn needs four pages on screen
     at once (two under the leaf, two on its faces) and rasterising any of them
     mid-animation shows a white sheet. Bounded, because a page at 2× dpr is a
     few megabytes of bitmap. */
  private raster = new Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>();
  private rasterJobs = new Map<string, Promise<{ canvas: HTMLCanvasElement; width: number; height: number }>>();
  private static RASTER_MAX = 10;

  private constructor(doc: PdfDoc) {
    this.doc = doc;
    this.numPages = doc.numPages;
  }

  static async open(bytes: Uint8Array): Promise<PdfSession> {
    const pdfjs = await getPdfjs();
    // pdf.js transfers the buffer to its worker, so hand it a private copy —
    // the caller's bytes (often the shared file cache) must stay intact.
    const copy = bytes.slice();
    const doc = await pdfjs.getDocument({ data: copy }).promise;
    return new PdfSession(doc);
  }

  private page(n: number): Promise<PdfPage> {
    let p = this.pageCache.get(n);
    if (!p) { p = this.doc.getPage(n); this.pageCache.set(n, p); }
    return p;
  }

  /** Native page aspect ratio (height / width) at scale 1. */
  async aspect(n: number): Promise<number> {
    const page = await this.page(n);
    const vp = page.getViewport({ scale: 1 });
    return vp.height / vp.width;
  }

  private rasterKey(n: number, targetWidth: number, dpr: number) {
    return `${n}@${Math.round(targetWidth)}@${dpr}`;
  }

  /** Rasterise once, for real. Everything else hands out copies of this. */
  private async rasterise(n: number, targetWidth: number, dpr: number) {
    const page = await this.page(n);
    const base = page.getViewport({ scale: 1 });
    const cssScale = targetWidth / base.width;
    const viewport = page.getViewport({ scale: cssScale * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, width: targetWidth, height: base.height * cssScale };
  }

  /** Is this page already rasterised at this size? (No await, no work.) */
  isRendered(n: number, targetWidth: number, dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1): boolean {
    return this.raster.has(this.rasterKey(n, targetWidth, Math.min(2, dpr)));
  }

  /**
   * Render page `n` into a canvas sized to fit `targetWidth` CSS px.
   *
   * A canvas element can only live in one place in the DOM, and the flipbook
   * genuinely needs the same page in two places at once (on the leaf's face and
   * under it), so the cached bitmap is the master and every caller gets a copy
   * of it. The copy is one GPU blit; the rasterise is tens of milliseconds of
   * main-thread work, and it now happens once per page per size.
   */
  async renderPage(n: number, targetWidth: number, dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1): Promise<RenderedPage> {
    const d = Math.min(2, dpr);
    const key = this.rasterKey(n, targetWidth, d);

    let master = this.raster.get(key);
    if (!master) {
      let job = this.rasterJobs.get(key);
      if (!job) {
        job = this.rasterise(n, targetWidth, d);
        this.rasterJobs.set(key, job);
        job.catch(() => { /* surfaced to the caller */ }).finally(() => this.rasterJobs.delete(key));
      }
      master = await job;
      this.raster.set(key, master);
      // Oldest out first. Map preserves insertion order, and a re-read below
      // re-inserts, so this is a plain LRU.
      while (this.raster.size > PdfSession.RASTER_MAX) {
        const oldest = this.raster.keys().next().value;
        if (oldest === undefined) break;
        this.raster.delete(oldest);
      }
    } else {
      this.raster.delete(key);
      this.raster.set(key, master);
    }

    const copy = document.createElement('canvas');
    copy.width = master.canvas.width;
    copy.height = master.canvas.height;
    copy.getContext('2d', { alpha: false })?.drawImage(master.canvas, 0, 0);
    return { canvas: copy, width: master.width, height: master.height };
  }

  /**
   * Get these pages rasterised and cached, quietly, before they're needed.
   * The flipbook calls this for the pages either side of the spread, which is
   * what makes a turn start on the frame you click rather than after a render.
   */
  async warm(pages: number[], targetWidth: number, dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1): Promise<void> {
    const d = Math.min(2, dpr);
    const want = [...new Set(pages)].filter((n) => n >= 1 && n <= this.numPages);
    await Promise.all(want.map(async (n) => {
      const key = this.rasterKey(n, targetWidth, d);
      if (this.raster.has(key)) return;
      let job = this.rasterJobs.get(key);
      if (!job) {
        job = this.rasterise(n, targetWidth, d);
        this.rasterJobs.set(key, job);
        job.catch(() => {}).finally(() => this.rasterJobs.delete(key));
      }
      try {
        const m = await job;
        if (!this.raster.has(key)) {
          this.raster.set(key, m);
          while (this.raster.size > PdfSession.RASTER_MAX) {
            const oldest = this.raster.keys().next().value;
            if (oldest === undefined) break;
            this.raster.delete(oldest);
          }
        }
      } catch { /* a page that won't render shouldn't break a turn */ }
    }));
  }

  /**
   * Build an invisible, selectable text layer aligned to a page shown at
   * `cssWidth` px. Positions come from pdf.js item transforms combined with the
   * viewport transform — good enough that a drag-select over what you *see*
   * yields the right text (the spans themselves are transparent).
   */
  async textLayer(n: number, cssWidth: number): Promise<PageTextLayer> {
    const page = await this.page(n);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const vp = page.getViewport({ scale });
    const { items } = await page.getTextContent();
    const spans: TextSpan[] = [];
    for (const it of items) {
      if (!it.str) continue;
      const tx = mulMatrix(vp.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]);
      if (h < 1) continue;
      spans.push({ x: tx[4], y: tx[5] - h, h, w: it.width * scale, text: it.str });
    }
    return { spans, width: cssWidth, height: base.height * scale };
  }

  /** A small JPEG data-URL thumbnail for the filmstrip / book spine. Cached. */
  thumbnail(n: number, width = 132): Promise<string> {
    let t = this.thumbCache.get(n);
    if (!t) {
      t = (async () => {
        const { canvas } = await this.renderPage(n, width, 1);
        return canvas.toDataURL('image/jpeg', 0.72);
      })();
      this.thumbCache.set(n, t);
    }
    return t;
  }

  /** Extract a page's text, grouped into visual lines (for reflow + selection). */
  pageText(n: number): Promise<PdfPageText> {
    let t = this.textCache.get(n);
    if (!t) {
      t = (async () => {
        const page = await this.page(n);
        const content = await page.getTextContent();
        return groupLines(content.items);
      })();
      this.textCache.set(n, t);
    }
    return t;
  }

  destroy() {
    this.pageCache.clear();
    this.textCache.clear();
    this.thumbCache.clear();
    // Zero the bitmaps out before dropping them: a few megabytes each, and the
    // GC is in no hurry about detached canvases.
    for (const { canvas } of this.raster.values()) { canvas.width = 0; canvas.height = 0; }
    this.raster.clear();
    this.rasterJobs.clear();
    void this.doc.destroy?.();
  }
}

/**
 * Turn pdf.js text items back into human lines and paragraphs. pdf.js emits one
 * item per drawn run with a transform matrix; items on (roughly) the same
 * baseline belong to the same line, and a `hasEOL` item or a big vertical gap
 * ends it. This is what makes the reflow ("Typeset") view read like prose
 * instead of a wall of fragments.
 */
function groupLines(items: PdfTextItem[]): PdfPageText {
  const rows: { y: number; parts: string[] }[] = [];
  let cur: { y: number; parts: string[] } | null = null;

  for (const it of items) {
    const s = it.str;
    const y = it.transform[5];
    if (!cur || Math.abs(y - cur.y) > (it.height || 8) * 0.6) {
      cur = { y, parts: [] };
      rows.push(cur);
    }
    cur.parts.push(s);
    if (it.hasEOL) cur = null;
  }

  const lines = rows
    .map((r) => r.parts.join('').replace(/[ \t]+/g, ' ').trimEnd())
    .filter((l, i, a) => !(l === '' && a[i - 1] === '')); // collapse blank runs

  return { lines, text: lines.join('\n') };
}

/** 2D affine matrix product, pdf.js `Util.transform(m1, m2)` order. */
function mulMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
