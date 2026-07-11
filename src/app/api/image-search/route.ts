import { NextRequest, NextResponse } from 'next/server';
import { resolveImageUrl } from '@/lib/imageSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Real image resolver for the canvas agent. Given a query it returns a genuine,
 * hotlink-safe image URL so the agent can drop actual pictures from the web
 * onto the board. A deterministic Picsum seed is the final fallback so an image
 * ALWAYS comes back (never a broken tile).
 *
 *   GET /api/image-search?q=<query>  →  { url, source, title }
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });
  }

  const hit = await resolveImageUrl(q);
  if (hit?.url) {
    return NextResponse.json(hit, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  }

  const seed = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-').slice(0, 40));
  return NextResponse.json(
    { url: `https://picsum.photos/seed/${seed}/800/600`, title: q, source: 'fallback' },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
