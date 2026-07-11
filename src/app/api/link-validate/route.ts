import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

/**
 * Link validator. Checks whether a URL is actually alive and reachable. For
 * platform-specific URLs (YouTube, Spotify) it validates via their oEmbed
 * endpoints so we can catch deleted/private/unavailable content BEFORE the
 * agent places a dead link on the canvas.
 *
 *   GET /api/link-validate?url=<url>  →  { valid, status, reason, title? }
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TIMEOUT_MS = 8000;

function parseYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

function parseSpotifyId(urlStr: string): { type: string; id: string } | null {
  try {
    const u = new URL(urlStr);
    if (u.hostname.replace(/^www\./, '') !== 'open.spotify.com') return null;
    const m = u.pathname.match(/\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    return m ? { type: m[1], id: m[2] } : null;
  } catch { return null; }
}

async function validateYouTube(url: string, videoId: string): Promise<{ valid: boolean; reason: string; title?: string }> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembed, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'Video is private or restricted' };
    }
    if (res.status === 404) {
      return { valid: false, reason: 'Video not found or deleted' };
    }
    if (!res.ok) {
      return { valid: false, reason: `YouTube returned ${res.status}` };
    }
    const data = await res.json();
    const title = data?.title || '';
    // Some "removed" videos still return 200 but with generic titles
    if (/deleted video|private video|unavailable/i.test(title)) {
      return { valid: false, reason: 'Video is deleted or unavailable' };
    }
    return { valid: true, reason: 'OK', title };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : 'Validation failed' };
  }
}

async function validateSpotify(url: string): Promise<{ valid: boolean; reason: string; title?: string }> {
  try {
    const oembed = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembed, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { valid: false, reason: `Spotify returned ${res.status}` };
    }
    const data = await res.json();
    return { valid: true, reason: 'OK', title: data?.title };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : 'Validation failed' };
  }
}

async function validateGeneric(url: string): Promise<{ valid: boolean; reason: string }> {
  try {
    // HEAD first (fast), fall back to GET if the server doesn't support HEAD
    for (const method of ['HEAD', 'GET'] as const) {
      try {
        const res = await fetch(url, {
          method,
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(method === 'HEAD' ? 5000 : TIMEOUT_MS),
          redirect: 'follow',
        });
        if (res.status === 404 || res.status === 410 || res.status === 451) {
          return { valid: false, reason: `Page returned ${res.status}` };
        }
        if (res.ok || res.status === 301 || res.status === 302 || res.status === 308) {
          return { valid: true, reason: 'OK' };
        }
        // If HEAD failed with a weird status, try GET
        if (method === 'HEAD') continue;
        return { valid: false, reason: `Page returned ${res.status}` };
      } catch (err) {
        if (method === 'HEAD') continue;
        throw err;
      }
    }
    return { valid: false, reason: 'Could not reach URL' };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : 'Validation failed' };
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim();
  if (!url) return NextResponse.json({ error: 'Provide ?url=' }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return NextResponse.json({ valid: false, reason: 'Invalid URL' });
  }

  // Platform-specific validation
  const ytId = parseYouTubeId(parsed.href);
  if (ytId) {
    const result = await validateYouTube(parsed.href, ytId);
    return NextResponse.json({ ...result, platform: 'youtube' });
  }

  const spotifyId = parseSpotifyId(parsed.href);
  if (spotifyId) {
    const result = await validateSpotify(parsed.href);
    return NextResponse.json({ ...result, platform: 'spotify' });
  }

  // Generic URL check
  const result = await validateGeneric(parsed.href);
  return NextResponse.json({ ...result, platform: 'generic' });
}
