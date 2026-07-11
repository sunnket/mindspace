import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 12;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `YouTube returned ${res.status}` }, { status: 502 });
    }

    const html = await res.text();
    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
    let results: string[] = [];
    
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const items = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
        
        for (const item of items) {
          const video = item.videoRenderer;
          // Ensure we don't pick up upcoming premieres or live streams unless wanted, but basic check is videoId
          if (video && video.videoId) {
            results.push(`https://www.youtube.com/watch?v=${video.videoId}`);
          }
          if (results.length >= 5) break;
        }
      } catch (e) {
        // Fallback to regex if parsing fails
        const match = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/g);
        if (match) {
          const uniqueIds = [...new Set(match.map(m => m.replace('watch?v=', '')))].slice(0, 5);
          results = uniqueIds.map(id => `https://www.youtube.com/watch?v=${id}`);
        }
      }
    } else {
      // Fallback
      const match = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/g);
      if (match) {
        const uniqueIds = [...new Set(match.map(m => m.replace('watch?v=', '')))].slice(0, 5);
        results = uniqueIds.map(id => `https://www.youtube.com/watch?v=${id}`);
      }
    }

    return NextResponse.json({
      success: true,
      results
    }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
