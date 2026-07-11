import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const tag = req.nextUrl.searchParams.get('tag')?.trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 5), 10);

  try {
    let url = 'https://api.quotable.io/quotes/random';
    const params = new URLSearchParams({ limit: String(limit) });
    if (tag) params.set('tags', tag);

    const res = await fetch(`${url}?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Quotable API returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const quotes = (Array.isArray(data) ? data : [data]).map((q: { content: string; author: string; tags: string[] }) => ({
      text: q.content,
      author: q.author,
      tags: q.tags,
    }));

    // If the user asked for a specific topic, try to filter
    const filtered = q
      ? quotes.filter((quote: { text: string; author: string }) =>
          quote.text.toLowerCase().includes(q.toLowerCase()) ||
          quote.author.toLowerCase().includes(q.toLowerCase())
        )
      : quotes;

    return NextResponse.json({
      success: true,
      results: filtered.length > 0 ? filtered : quotes,
    }, {
      headers: { 'Cache-Control': 'public, max-age=600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
