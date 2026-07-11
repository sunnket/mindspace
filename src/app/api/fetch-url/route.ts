import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

/**
 * Web reader for the canvas agent. Fetches ANY public URL the user points at and
 * returns its readable, de-chromed text so the agent can actually answer from /
 * build from a real page — "read this article", "summarize this docs page",
 * "pull the pricing from this link", etc.
 *
 *   GET /api/fetch-url?url=<page>  →  { url, title, text, truncated }
 *
 * SSRF-guarded (no localhost / private ranges), size- and time-capped.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // read up to 2 MB of the page
const MAX_TEXT_CHARS = 18_000;

function normalizeUrl(raw: string): string {
  let s = (raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

/** Reject localhost / private-network hosts to avoid SSRF against the server. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, hh) => { try { return String.fromCodePoint(parseInt(hh, 16)); } catch { return ' '; } });
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).trim() : '';
}

/** Strip a full HTML doc down to readable text, preserving rough structure. */
function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  s = s
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|tr|ul|ol|li|header|main|blockquote|pre)>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n');

  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

async function readPage(url: string): Promise<{ html: string; finalUrl: string; ctype: string } | null> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok || !res.body) return null;
  const ctype = res.headers.get('content-type') || '';
  if (ctype && !/text\/html|application\/xhtml|text\/plain|application\/xml|application\/json/i.test(ctype)) {
    return null; // binary (pdf/image/etc.) — not handled here
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
  }
  reader.cancel().catch(() => {});
  return { html, finalUrl: res.url || url, ctype };
}

export async function GET(req: NextRequest) {
  const normalized = normalizeUrl(req.nextUrl.searchParams.get('url') || '');
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return NextResponse.json({ error: 'Unsupported protocol' }, { status: 400 });
  }
  if (isBlockedHost(u.hostname)) {
    return NextResponse.json({ error: 'Blocked host' }, { status: 400 });
  }

  try {
    const page = await readPage(normalized);
    if (!page) {
      return NextResponse.json({ url: normalized, title: '', text: '', error: 'Could not read page' }, { status: 200 });
    }
    const isJson = /application\/json/i.test(page.ctype);
    const title = isJson ? u.hostname : extractTitle(page.html);
    const full = isJson ? page.html : htmlToText(page.html);
    const text = full.slice(0, MAX_TEXT_CHARS);
    return NextResponse.json(
      { url: page.finalUrl, title, text, truncated: full.length > MAX_TEXT_CHARS },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ url: normalized, title: '', text: '', error: message }, { status: 200 });
  }
}
