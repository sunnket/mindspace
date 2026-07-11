import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Wikipedia summary lookup. Returns the introduction paragraph + thumbnail
 * for any topic, powered by Wikipedia's free REST API (no key required).
 *
 *   GET /api/wikipedia?q=<topic>  →  { title, extract, thumbnail, url, description }
 */

const UA = 'MindspaceCanvas/1.0 (wikipedia lookup)';
const TIMEOUT_MS = 8000;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  try {
    // Wikipedia REST API — free, no key, returns clean JSON summaries
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}`;
    let res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    // If the exact title didn't match, search for it
    if (res.status === 404) {
      const searchApi = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&format=json`;
      const searchRes = await fetch(searchApi, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const firstResult = searchData?.[1]?.[0];
        if (firstResult) {
          const retryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstResult.replace(/\s+/g, '_'))}`;
          res = await fetch(retryUrl, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            redirect: 'follow',
          });
        }
      }
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Wikipedia returned ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    }

    const data = await res.json();

    return NextResponse.json({
      title: data.title || '',
      extract: data.extract || '',
      description: data.description || '',
      thumbnail: data.thumbnail?.source || '',
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`,
    }, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
