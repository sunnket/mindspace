import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

/**
 * YouTube search that returns links which actually PLAY.
 *
 * Two things used to go wrong and both are fixed here:
 *
 * 1. Rubbish results. The caller stripped "stop words" out of the query before
 *    sending it, so "bring me good youtube music links" arrived as "bring good
 *    links" and YouTube dutifully returned videos about a bookmarking app. The
 *    query now comes through intact; cleaning happens (carefully) on this side.
 *
 * 2. Dead / unplayable links. Results were scraped straight out of the search
 *    page — including ids lifted by a regex from unrelated markup — and handed
 *    to the model with no check that the video existed, let alone that it could
 *    be embedded. Every candidate is now verified against YouTube's own oEmbed
 *    endpoint (proves it exists and isn't private/deleted) AND its watch page
 *    (proves `playableInEmbed`, which is what the canvas's Link Card needs).
 *
 *   GET /api/youtube-search?q=…  →  { success, results: [{ url, embedUrl, title, author }] }
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Turn the user's instruction into something you'd actually type into YouTube.
 *
 * This matters more than it sounds. "bring me good youtube music links" is an
 * instruction addressed to the AGENT — search YouTube for it verbatim and you
 * get videos ABOUT YouTube Music the product, which is exactly the pile of
 * nonsense the user was looking at. The words "bring me", "youtube" and "links"
 * describe the errand, not the thing they want to watch.
 *
 * A tiny, fast model strips the errand and leaves the subject. If it's
 * unavailable we fall back to the caller's text, which is no worse than before.
 */
async function distillQuery(intent: string): Promise<string | null> {
  const apiKey =
    process.env.NVIDIA_API_KEY ||
    process.env.NVIDIA_API_KEY_2 ||
    process.env.NVIDIA_API_KEY_3;
  if (!apiKey) return null;

  try {
    const res = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          {
            role: 'system',
            content:
              'You turn a user\'s request into a YouTube search query. Output ONLY the query — no quotes, no explanation, no preamble.\n' +
              'Drop every word that is about the errand rather than the content: "find me", "bring", "add", "link", "links", "video", "videos", "youtube", "on my canvas". Keep every word that describes what they want to WATCH or LISTEN TO (genre, artist, mood, topic, era, language).\n' +
              'If the request is vague about genre, pick a sensible, specific query a human would actually type.\n' +
              'Examples:\n' +
              'Request: bring me good youtube music links -> best songs playlist\n' +
              'Request: add some lofi to study to -> lofi hip hop study mix\n' +
              'Request: find videos explaining transformers in ML -> transformer neural network explained\n' +
              'Request: drop 4 arijit singh songs -> arijit singh best songs',
          },
          { role: 'user', content: `Request: ${intent.slice(0, 400)} ->` },
        ],
        temperature: 0.2,
        max_tokens: 40,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const raw: string = json?.choices?.[0]?.message?.content || '';
    const q = raw.split('\n')[0].replace(/^["'\s]+|["'\s.]+$/g, '').trim();
    // A model that decided to chat instead of answering is not a search query.
    if (!q || q.length > 90) return null;
    return q;
  } catch {
    return null;
  }
}

interface Candidate {
  id: string;
  title: string;
  author: string;
}

export interface YouTubeHit {
  url: string;
  embedUrl: string;
  title: string;
  author: string;
}

/** Scrape the search page for real video renderers (not stray ids in the HTML). */
async function searchYouTube(q: string): Promise<Candidate[]> {
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`, // sp = "Videos" filter
    { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(9000) }
  );
  if (!res.ok) throw new Error(`YouTube returned ${res.status}`);

  const html = await res.text();
  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match) return [];

  let data: any;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

  const out: Candidate[] = [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item?.videoRenderer;
      if (!v?.videoId) continue;
      // A live stream or an unaired premiere is not something you can drop on a
      // board and press play on.
      const badges: string[] = (v.badges || []).map((b: any) => b?.metadataBadgeRenderer?.label).filter(Boolean);
      if (badges.some((b) => /live/i.test(b))) continue;
      if (v.upcomingEventData) continue;

      out.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
        author: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

/**
 * Does this video exist, and will it play inside an iframe? oEmbed answers the
 * first (private/deleted/nonexistent all fail it). `playableInEmbed` on the
 * watch page answers the second — plenty of music videos exist perfectly well
 * and still refuse to be embedded, which is exactly the "broken link" the user
 * ends up staring at.
 */
async function verify(c: Candidate): Promise<YouTubeHit | null> {
  const url = `https://www.youtube.com/watch?v=${c.id}`;

  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) }
    );
    if (!oembed.ok) return null; // 401/403 = private, 404 = gone
    const meta = await oembed.json();
    const title: string = meta?.title || c.title;
    if (/deleted video|private video|unavailable/i.test(title)) return null;

    const watch = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    if (!watch.ok) return null;
    const html = await watch.text();
    if (/"playableInEmbed"\s*:\s*false/.test(html)) return null;
    if (/"status"\s*:\s*"(?:ERROR|UNPLAYABLE|LOGIN_REQUIRED)"/.test(html)) return null;

    return {
      url,
      embedUrl: `https://www.youtube.com/embed/${c.id}`,
      title,
      author: meta?.author_name || c.author,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  const want = Math.min(8, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 4));
  // `intent=1` says q is the user's raw instruction, not a search query.
  const isIntent = req.nextUrl.searchParams.get('intent') === '1';

  try {
    const query = (isIntent ? await distillQuery(q) : null) || q;

    const candidates = await searchYouTube(query);
    if (candidates.length === 0) {
      return NextResponse.json({ success: true, query, results: [] });
    }

    /* Verify in small waves. Checking all 12 at once hammers YouTube and usually
       wastes most of the work — we only need the first few that pass. */
    const results: YouTubeHit[] = [];
    for (let i = 0; i < candidates.length && results.length < want; i += 4) {
      const wave = await Promise.all(candidates.slice(i, i + 4).map(verify));
      for (const hit of wave) {
        if (hit && results.length < want) results.push(hit);
      }
    }

    return NextResponse.json(
      { success: true, query, results },
      { headers: { 'Cache-Control': 'public, max-age=1800' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, results: [] }, { status: 200 });
  }
}
