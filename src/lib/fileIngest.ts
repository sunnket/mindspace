import { useCanvasStore } from '@/store/canvasStore';
import { fitImageBox } from '@/lib/utils';

/**
 * Drops any file onto the canvas and makes it readable by the agent.
 *
 * - Images stay as rich image objects (the agent already "sees" those via the
 *   vision route).
 * - Everything else becomes a File block: it appears instantly in a "reading…"
 *   state, then hydrates with the full extracted text, link list and structure
 *   pulled from /api/file-extract. The agent reads that text to answer questions
 *   about the file.
 */

// Embed the raw bytes (for download / preview) only when the file is small
// enough; above this we still keep the extracted text, just without a download.
const MAX_EMBED_BYTES = 6 * 1024 * 1024;

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

export async function ingestFile(file: File, x: number, y: number): Promise<void> {
  const store = useCanvasStore.getState();

  // Images keep their existing rich-image treatment.
  if (file.type.startsWith('image/')) {
    try {
      const dataUrl = await readAsDataURL(file);
      // Box it at the picture's own aspect ratio — a flat 300x200 distorted
      // every portrait and screenshot that landed here.
      const { width, height } = await fitImageBox(dataUrl);
      store.addObject({ type: 'image', x, y, width, height, content: dataUrl });
    } catch {
      /* ignore unreadable image */
    }
    return;
  }

  const baseStyle = {
    isFile: true,
    fileName: file.name || 'file',
    fileType: file.type || '',
    fileExt: extOf(file.name),
    fileSize: file.size,
    fileStatus: 'loading' as const,
  };

  const block = store.addObject({
    type: 'card',
    x,
    y,
    width: 300,
    height: 132,
    content: '',
    style: { ...baseStyle },
  });

  // Raw bytes for download, when the file is small enough to embed sensibly.
  let dataUrl = '';
  if (file.size <= MAX_EMBED_BYTES) {
    try { dataUrl = await readAsDataURL(file); } catch { /* download optional */ }
  }

  const update = (patch: Record<string, unknown>, content?: string) => {
    const live = useCanvasStore.getState().objects.find((o) => o.id === block.id);
    if (!live) return; // block was deleted while we were reading
    useCanvasStore.getState().updateObject(block.id, {
      ...(content !== undefined ? { content } : {}),
      style: { ...live.style, ...patch },
    });
  };

  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/file-extract', { method: 'POST', body: form });

    if (res.ok) {
      const data = await res.json();
      update(
        {
          fileStatus: 'ready',
          fileText: data.text || '',
          fileChars: data.chars || 0,
          fileTruncated: !!data.truncated,
          fileLinks: Array.isArray(data.links) ? data.links : [],
          fileMeta: data.meta || {},
        },
        dataUrl,
      );
    } else {
      const err = await res.json().catch(() => ({}));
      update({ fileStatus: 'error', fileError: err.error || `Couldn't read this file` }, dataUrl);
    }
  } catch {
    update({ fileStatus: 'error', fileError: 'Extraction failed — check your connection' }, dataUrl);
  }
}
