import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

/**
 * Link preview resolver. Given any URL it returns rich metadata the canvas
 * renders as a thumbnail card:
 *   { url, domain, platform, title, description, image, favicon, embedUrl }
 *
 * Strategy, in order of reliability:
 *  1. Known platforms (YouTube, Spotify, Vimeo, SoundCloud) → their oEmbed
 *     endpoints, which return clean JSON + a real thumbnail + an embeddable
 *     player URL. No HTML scraping, so these are fast and never break.
 *  2. Direct media URLs (…​.png/.jpg/.mp4) → the URL is its own thumbnail.
 *  3. Everything else → fetch the page and parse OpenGraph / Twitter-card /
 *     <title> / favicon out of the <head>.
 *
 * It ALWAYS resolves to something usable — even when a site blocks us or has no
 * metadata we fall back to its domain + a favicon so the card is never blank.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024; // only need the <head>, cap the download

interface Preview {
  url: string;
  domain: string;
  platform?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  embedUrl?: string;
}

/* -------------------------------------------------------------------------- */
/*  URL helpers                                                               */
/* -------------------------------------------------------------------------- */

function normalizeUrl(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return '';
  // Strip surrounding angle brackets / quotes people sometimes paste.
  s = s.replace(/^[<"']+|[>"']+$/g, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

/** Reject localhost / private-network hosts to avoid SSRF against the server. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function googleFavicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function rootDomain(hostname: string): string {
  return hostname.replace(/^www\./i, '');
}

function prettyPlatform(hostname: string): string {
  const root = rootDomain(hostname).split('.');
  const name = root.length >= 2 ? root[root.length - 2] : root[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : hostname;
}

function absolutize(maybeRelative: string | undefined, base: string): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*  HTML entity + meta-tag parsing                                            */
/* -------------------------------------------------------------------------- */

function decodeEntities(input: string): string {
  if (!input) return input;
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read a meta tag's content by property/name, tolerant of attribute order. */
function getMeta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const k = escapeRe(key);
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*?content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name|itemprop)=["']${k}["']`, 'i'),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1] && m[1].trim()) return decodeEntities(m[1]);
    }
  }
  return undefined;
}

function getTitleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]) : undefined;
}

function getFavicon(html: string, baseUrl: string): string | undefined {
  const patterns = [
    /<link[^>]+rel=["'][^"']*(?:apple-touch-icon)[^"']*["'][^>]*?href=["']([^"']+)["']/i,
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*?href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]*?rel=["'][^"']*icon[^"']*["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) {
      const abs = absolutize(decodeEntities(m[1]), baseUrl);
      if (abs) return abs;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Fetch HTML, but stop reading after MAX_HTML_BYTES (the head is all we need). */
async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok || !res.body) return null;
    const ctype = res.headers.get('content-type') || '';
    if (ctype && !/text\/html|application\/xhtml|text\/plain|application\/xml/i.test(ctype)) {
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      // The metadata lives in <head>; once we've seen </head> we can stop.
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Platform-specific resolvers                                               */
/* -------------------------------------------------------------------------- */

function parseYouTubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
  }
  return null;
}

async function resolveKnownPlatform(u: URL, url: string): Promise<Preview | null> {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  // --- YouTube ---
  const ytId = parseYouTubeId(u);
  if (ytId) {
    const oembed = await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    const author = (oembed?.author_name as string) || '';
    return {
      url,
      domain: 'youtube.com',
      platform: 'YouTube',
      title: (oembed?.title as string) || 'YouTube video',
      description: author ? `Video by ${author}` : 'Watch on YouTube',
      image: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      favicon: 'https://www.youtube.com/s/desktop/favicon.ico',
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
    };
  }

  // --- Spotify ---
  if (host === 'open.spotify.com') {
    const oembed = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    const m = u.pathname.match(/\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    return {
      url,
      domain: 'open.spotify.com',
      platform: 'Spotify',
      title: (oembed?.title as string) || 'Spotify',
      description: (oembed?.provider_name as string) || 'Listen on Spotify',
      image: (oembed?.thumbnail_url as string) || '',
      favicon: googleFavicon('spotify.com'),
      embedUrl: m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : undefined,
    };
  }

  // --- Vimeo ---
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const oembed = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
    const idm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (oembed || idm) {
      return {
        url,
        domain: 'vimeo.com',
        platform: 'Vimeo',
        title: (oembed?.title as string) || 'Vimeo video',
        description: (oembed?.author_name as string) ? `by ${oembed!.author_name}` : 'Watch on Vimeo',
        image: (oembed?.thumbnail_url as string) || '',
        favicon: googleFavicon('vimeo.com'),
        embedUrl: idm ? `https://player.vimeo.com/video/${idm[1]}` : undefined,
      };
    }
  }

  // --- SoundCloud ---
  if (host === 'soundcloud.com') {
    const oembed = await fetchJson(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
    );
    if (oembed) {
      const htmlEmbed = (oembed.html as string) || '';
      const src = htmlEmbed.match(/src=["']([^"']+)["']/i);
      return {
        url,
        domain: 'soundcloud.com',
        platform: 'SoundCloud',
        title: (oembed.title as string) || 'SoundCloud',
        description: (oembed.author_name as string) ? `by ${oembed.author_name}` : 'Listen on SoundCloud',
        image: (oembed.thumbnail_url as string) || '',
        favicon: googleFavicon('soundcloud.com'),
        embedUrl: src ? decodeEntities(src[1]) : undefined,
      };
    }
  }

  return null;
}

/** A URL that points straight at an image is its own thumbnail. */
function resolveDirectMedia(u: URL, url: string): Preview | null {
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i.test(u.pathname)) {
    const domain = rootDomain(u.hostname);
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'Image');
    return {
      url,
      domain,
      platform: 'Image',
      title: name,
      description: '',
      image: url,
      favicon: googleFavicon(domain),
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Handler                                                                   */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || '';
  const normalized = normalizeUrl(raw);

  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return NextResponse.json({ error: 'Invalid URL', url: raw }, { status: 400 });
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return NextResponse.json({ error: 'Unsupported protocol', url: normalized }, { status: 400 });
  }
  if (isBlockedHost(u.hostname)) {
    return NextResponse.json({ error: 'Blocked host', url: normalized }, { status: 400 });
  }

  const domain = rootDomain(u.hostname);
  const noCache = { 'Cache-Control': 'public, max-age=86400' };

  try {
    // 1. Known platforms (best data).
    const known = await resolveKnownPlatform(u, normalized);
    if (known) return NextResponse.json(known, { headers: noCache });

    // 2. Direct image URL.
    const media = resolveDirectMedia(u, normalized);
    if (media) return NextResponse.json(media, { headers: noCache });

    // 3. Generic OpenGraph / Twitter-card scrape.
    const page = await fetchHtml(normalized);
    if (page) {
      const { html, finalUrl } = page;
      const siteName = getMeta(html, ['og:site_name']);
      const preview: Preview = {
        url: normalized,
        domain,
        platform: siteName || prettyPlatform(u.hostname),
        title:
          getMeta(html, ['og:title', 'twitter:title']) ||
          getTitleTag(html) ||
          domain,
        description:
          getMeta(html, ['og:description', 'twitter:description', 'description']) || '',
        image: absolutize(
          getMeta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']),
          finalUrl
        ),
        favicon: getFavicon(html, finalUrl) || googleFavicon(domain),
      };
      return NextResponse.json(preview, { headers: noCache });
    }

    // 4. Everything failed (blocked, offline, non-HTML) — still return a
    //    presentable card built from the domain alone. Never an error state.
    const fallback: Preview = {
      url: normalized,
      domain,
      platform: prettyPlatform(u.hostname),
      title: domain,
      description: '',
      image: '',
      favicon: googleFavicon(domain),
    };
    return NextResponse.json(fallback, { headers: noCache });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('link-preview error:', message);
    // Graceful minimal card even on unexpected failure.
    return NextResponse.json({
      url: normalized,
      domain,
      platform: prettyPlatform(u.hostname),
      title: domain,
      favicon: googleFavicon(domain),
    });
  }
}
