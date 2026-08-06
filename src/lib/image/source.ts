import { loadPixelImage, PixelAccessError, type LoadedImage } from './pixels';

/**
 * Getting readable pixels, whatever the image happens to be.
 *
 * An image on this board is either a `data:` URL (dropped, pasted, generated,
 * grabbed from a video frame) or a plain https URL (placed from web search).
 * The first kind is readable; the second taints the canvas and makes every
 * pixel tool throw. This is the one place that difference is handled, so no
 * tool has to think about where its picture came from.
 *
 * The inlined copy is CACHED for the tab. Removing a background, reading a
 * palette and pulling three crops out of the same web image would otherwise be
 * five separate downloads of the same bytes through the proxy.
 */

const inlineCache = new Map<string, string>();

export async function inlineSource(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;

  const cached = inlineCache.get(src);
  if (cached) return cached;

  const res = await fetch('/api/image-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: src }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.dataUrl) {
    throw new Error(json?.error || 'That image could not be read.');
  }

  inlineCache.set(src, json.dataUrl as string);
  return json.dataUrl as string;
}

/**
 * Load an image for pixel work, going through the proxy only if it has to.
 *
 * The direct attempt comes first because a great many hosts DO send permissive
 * CORS headers, and when they do, reading them in the browser is instant and
 * costs no bandwidth. The proxy is the fallback for the rest, not the default
 * path — routing every image through the server would make the common case
 * (an image already inline on the object) needlessly slow.
 */
export async function loadForPixels(src: string): Promise<LoadedImage> {
  try {
    return await loadPixelImage(src);
  } catch (err) {
    if (!(err instanceof PixelAccessError) && !(err instanceof Error && /could not be loaded/i.test(err.message))) {
      throw err;
    }
    const inline = await inlineSource(src);
    return loadPixelImage(inline);
  }
}
