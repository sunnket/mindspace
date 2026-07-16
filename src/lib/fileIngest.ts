import { useCanvasStore } from '@/store/canvasStore';
import { fitImageBox } from '@/lib/utils';

/**
 * Drop any file onto the canvas.
 *
 * Two decoupled jobs:
 *  1. OPEN — the moment a file lands it becomes an openable block: we embed its
 *     bytes so it can be previewed natively (PDF viewer, image, video/audio
 *     player, text/code, …) regardless of type. No network, no parsing.
 *  2. READ — the agent only reads a file's text when the user hits "Ask AI".
 *     That's when we lazily POST the bytes to /api/file-extract and cache the
 *     extracted text on the block. (Office docs also extract on open, to show a
 *     text preview the browser can't render natively.)
 *
 * Images keep their rich image-object treatment (the vision route "sees" those).
 */

// Embed the raw bytes in the object (for native preview + download) up to this
// size. Above it we keep the original File in the session cache instead, so the
// file is still openable this session — it just won't survive a reload.
const MAX_EMBED_BYTES = 25 * 1024 * 1024;

/**
 * Session cache of the original File objects, keyed by block id. Files can't be
 * serialized into the store/IndexedDB, so this holds the real bytes for the life
 * of the tab — used for previews and for lazy text extraction without re-encoding.
 */
export const fileBlobCache = new Map<string, File>();

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/** Rebuild a File from a stored `data:` URL (used after a reload, when the
 *  session cache is empty but the bytes were embedded on the object). */
export function dataUrlToFile(dataUrl: string, name: string, type: string): File | null {
  try {
    if (!dataUrl.startsWith('data:')) return null;
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, comma);
    const isBase64 = /;base64/i.test(header);
    const dataPart = dataUrl.slice(comma + 1);
    const mime = header.split(';')[0] || type || 'application/octet-stream';
    let bytes: Uint8Array;
    if (isBase64) {
      const bin = atob(dataPart);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(dataPart));
    }
    return new File([bytes as unknown as BlobPart], name || 'file', { type: mime });
  } catch {
    return null;
  }
}

/** The best available File bytes for a block: session cache first, else rebuilt
 *  from the embedded data URL. Null when neither is available (large file after reload). */
export function getFileForBlock(objId: string): File | null {
  const cached = fileBlobCache.get(objId);
  if (cached) return cached;
  const obj = useCanvasStore.getState().objects.find((o) => o.id === objId);
  if (!obj || !obj.content?.startsWith('data:')) return null;
  const name = (obj.style?.fileName as string) || 'file';
  const type = (obj.style?.fileType as string) || '';
  const file = dataUrlToFile(obj.content, name, type);
  if (file) fileBlobCache.set(objId, file);
  return file;
}

function patchStyle(objId: string, patch: Record<string, unknown>, content?: string) {
  const store = useCanvasStore.getState();
  const live = store.objects.find((o) => o.id === objId);
  if (!live) return;
  store.updateObject(objId, {
    ...(content !== undefined ? { content } : {}),
    style: { ...live.style, ...patch },
  });
}

export async function ingestFile(file: File, x: number, y: number): Promise<void> {
  const store = useCanvasStore.getState();

  // Images keep their existing rich-image treatment.
  if (file.type.startsWith('image/')) {
    try {
      const dataUrl = await readAsDataURL(file);
      const { width, height } = await fitImageBox(dataUrl);
      store.addObject({ type: 'image', x, y, width, height, content: dataUrl });
    } catch {
      /* ignore unreadable image */
    }
    return;
  }

  const block = store.addObject({
    type: 'card',
    x,
    y,
    width: 288,
    height: 128,
    content: '',
    style: {
      isFile: true,
      fileName: file.name || 'file',
      fileType: file.type || '',
      fileExt: extOf(file.name),
      fileSize: file.size,
      // The file is immediately openable; text extraction is deferred to Ask AI.
      fileStatus: 'ready' as const,
    },
  });

  // Keep the real bytes for this session (previews + lazy extraction).
  fileBlobCache.set(block.id, file);

  // Embed the bytes on the object so native previews + download survive a reload
  // (skipped for very large files — those stay openable this session via the cache).
  if (file.size <= MAX_EMBED_BYTES) {
    try {
      const dataUrl = await readAsDataURL(file);
      patchStyle(block.id, {}, dataUrl);
    } catch {
      /* embedding is best-effort */
    }
  }
}

/**
 * Lazily pull the file's text via /api/file-extract and cache it on the block.
 * Idempotent: returns immediately if already extracted. Drives `fileTextStatus`
 * ('reading' | 'ready' | 'error') so the UI can show progress. Returns the text
 * ('' on failure).
 */
export async function extractTextForBlock(objId: string): Promise<string> {
  const store = useCanvasStore.getState();
  const obj = store.objects.find((o) => o.id === objId);
  if (!obj) return '';

  const existing = (obj.style?.fileText as string) || '';
  if (existing && obj.style?.fileTextStatus === 'ready') return existing;

  const file = getFileForBlock(objId);
  if (!file) {
    patchStyle(objId, {
      fileTextStatus: 'error',
      fileError: 'The file bytes are no longer in memory — re-drop the file to read it.',
    });
    return '';
  }

  patchStyle(objId, { fileTextStatus: 'reading', fileError: '' });

  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/file-extract', { method: 'POST', body: form });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      patchStyle(objId, { fileTextStatus: 'error', fileError: err.error || "Couldn't read this file." });
      return '';
    }

    const data = await res.json();
    if (data.meta?.parseError || (!data.text && data.meta?.binary)) {
      patchStyle(objId, {
        fileTextStatus: 'error',
        fileError: data.meta?.parseError
          ? 'This file has no readable text layer.'
          : 'No readable text found in this file.',
        fileMeta: data.meta || {},
      });
      return '';
    }

    patchStyle(objId, {
      fileTextStatus: 'ready',
      fileText: data.text || '',
      fileChars: data.chars || 0,
      fileTruncated: !!data.truncated,
      fileLinks: Array.isArray(data.links) ? data.links : [],
      fileMeta: data.meta || {},
    });
    return data.text || '';
  } catch {
    patchStyle(objId, { fileTextStatus: 'error', fileError: 'Extraction failed — check your connection.' });
    return '';
  }
}
