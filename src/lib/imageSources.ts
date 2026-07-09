/* ------------------------------------------------------------------
   Shared free image resolvers (server-side). Used by /api/image-search
   and /api/image-generate. Wikimedia Commons + Openverse, no API keys,
   with progressive query simplification so verbose agent phrases still
   land a real photo.
   ------------------------------------------------------------------ */

const UA = 'MindspaceCanvas/1.0 (canvas image resolver)';

// Photographer qualifiers to drop when the verbose phrase doesn't match.
const STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'for', 'to', 'by', 'from',
  'high', 'resolution', 'res', 'hd', '4k', '8k', 'ultra', 'photo', 'photograph', 'picture',
  'image', 'closeup', 'close-up', 'macro', 'shot', 'view', 'style', 'background', 'wallpaper',
  'national', 'geographic', 'cinematic', 'detailed', 'vivid', 'beautiful', 'stunning', 'aesthetic',
]);

export function queryVariants(q: string): string[] {
  const full = q.trim();
  const out: string[] = [full];
  const firstClause = full.split(/[,;:—\-|]/)[0].trim();
  const words = firstClause.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  for (const n of [5, 3, 2]) {
    const core = words.slice(0, n).join(' ').trim();
    if (core && !out.includes(core)) out.push(core);
  }
  return out;
}

export interface ImageHit { url: string; title: string; source: string; }

/** Wikimedia Commons — huge, free, no key, great for concrete subjects. */
export async function fromWikimedia(q: string): Promise<ImageHit | null> {
  const api =
    'https://commons.wikimedia.org/w/api.php' +
    '?action=query&format=json&generator=search&gsrnamespace=6' +
    `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5` +
    '&prop=imageinfo&iiprop=url|mime&iiurlwidth=1024';
  const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const pages: Record<string, any> = data?.query?.pages || {};
  const hit = Object.values(pages)
    .map((p) => p?.imageinfo?.[0])
    .find((info) => info && typeof info.thumburl === 'string' && /^image\/(jpeg|png|webp|gif)/.test(info.mime || 'image/jpeg'));
  return hit ? { url: hit.thumburl as string, title: q, source: 'wikimedia' } : null;
}

/** Openverse — Creative-Commons photo search, CORS-friendly thumbnails. */
export async function fromOpenverse(q: string): Promise<ImageHit | null> {
  const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=5&mature=false`;
  const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data?.results || []).find((r: any) => r?.thumbnail || r?.url);
  return first ? { url: (first.thumbnail || first.url) as string, title: first.title || q, source: 'openverse' } : null;
}

/**
 * Resolve a query to a real image URL. With `lineArt`, biases the search toward
 * clean line drawings / coloring pages (which vectorize into pen strokes well).
 */
export async function resolveImageUrl(q: string, opts?: { lineArt?: boolean }): Promise<ImageHit | null> {
  const variants = opts?.lineArt
    ? [`${q} line drawing`, `${q} line art`, `${q} coloring page`, `${q} outline drawing`, `${q} sketch`, ...queryVariants(q)]
    : queryVariants(q);
  for (const v of variants) {
    for (const fn of [fromWikimedia, fromOpenverse]) {
      try {
        const hit = await fn(v);
        if (hit?.url) return hit;
      } catch { /* next */ }
    }
  }
  return null;
}
