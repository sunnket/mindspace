import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Real image resolver for the canvas agent. Given a query it returns a genuine,
 * hotlink-safe image URL so the agent can drop actual pictures from the web
 * onto the board.
 *
 *   GET /api/image-search?q=<query>  →  { url, source, title }
 *
 * Sources are tried in order and the first hit wins; a deterministic Picsum
 * seed is the final fallback so an image ALWAYS comes back (never a broken tile).
 */

const UA = 'MindspaceCanvas/1.0 (canvas image block)';

/** Wikimedia Commons — huge, free, no key, great for concrete subjects. */
async function fromWikimedia(q: string): Promise<{ url: string; title: string } | null> {
  const api =
    'https://commons.wikimedia.org/w/api.php' +
    '?action=query&format=json&generator=search&gsrnamespace=6' +
    `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5` +
    '&prop=imageinfo&iiprop=url|mime&iiurlwidth=1024';
  const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const pages: Record<string, any> = data?.query?.pages || {};
  const hits = Object.values(pages)
    .map((p) => p?.imageinfo?.[0])
    .filter((info) => info && typeof info.thumburl === 'string' && /^image\/(jpeg|png|webp|gif)/.test(info.mime || 'image/jpeg'));
  if (hits.length === 0) return null;
  const best = hits[0];
  return { url: best.thumburl as string, title: q };
}

/** Openverse — Creative-Commons photo search, thumbnails are CORS-friendly. */
async function fromOpenverse(q: string): Promise<{ url: string; title: string } | null> {
  const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=5&mature=false`;
  const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data?.results || []).find((r: any) => r?.thumbnail || r?.url);
  if (!first) return null;
  return { url: (first.thumbnail || first.url) as string, title: first.title || q };
}

// Photographer's qualifiers the agent loves to append — drop them to find the
// actual SUBJECT of the shot when the verbose phrase doesn't match.
const STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'for', 'to', 'by', 'from',
  'high', 'resolution', 'res', 'hd', '4k', '8k', 'ultra', 'photo', 'photograph', 'picture',
  'image', 'closeup', 'close-up', 'macro', 'shot', 'view', 'style', 'background', 'wallpaper',
  'national', 'geographic', 'cinematic', 'detailed', 'vivid', 'beautiful', 'stunning', 'aesthetic',
]);

/** Full phrase → progressively simpler queries (drop qualifiers, keep the subject). */
function queryVariants(q: string): string[] {
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

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });
  }

  for (const variant of queryVariants(q)) {
    for (const resolver of [fromWikimedia, fromOpenverse]) {
      try {
        const hit = await resolver(variant);
        if (hit?.url) {
          return NextResponse.json(
            { url: hit.url, title: hit.title, source: resolver === fromWikimedia ? 'wikimedia' : 'openverse' },
            { headers: { 'Cache-Control': 'public, max-age=86400' } },
          );
        }
      } catch {
        /* try the next source / variant */
      }
    }
  }

  // Guaranteed fallback — a stable, seeded photo so something always renders.
  const seed = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-').slice(0, 40));
  return NextResponse.json(
    { url: `https://picsum.photos/seed/${seed}/800/600`, title: q, source: 'fallback' },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
