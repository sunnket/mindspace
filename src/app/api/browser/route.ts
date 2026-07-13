import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

/**
 * Browser-block support endpoint.
 *
 * This used to drive a headless Chromium (puppeteer) and stream the page back
 * as a JPEG every 700ms. It worked, but every click was a network round trip
 * and every frame was a full screenshot, so the block always felt a beat behind
 * the cursor. The block now renders a real <iframe> instead — native scrolling,
 * native input, zero latency — and all this route does is the two things an
 * iframe genuinely cannot do from the client:
 *
 *   GET ?action=check&url=…    → can this page be framed at all?
 *   GET ?action=extract&url=…  → pull its images + readable text onto the canvas
 *
 * Both are plain HTML fetches. No browser is launched.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 1_500_000;

function normalize(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Reject localhost / private ranges — this endpoint fetches whatever it's given. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * Whether the page permits being framed by us. Two headers decide it:
 * X-Frame-Options (the old way) and CSP frame-ancestors (the current one).
 * A frame-ancestors directive that isn't a wildcard won't name our origin, so
 * treat it as a refusal rather than trying to guess the deployment's host.
 */
function framePolicy(headers: Headers): { embeddable: boolean; reason: string } {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase().trim();
  if (xfo.includes('deny')) return { embeddable: false, reason: 'This site refuses to be embedded (X-Frame-Options: DENY).' };
  if (xfo.includes('sameorigin')) return { embeddable: false, reason: 'This site only allows embedding on its own domain.' };

  const csp = (headers.get('content-security-policy') || '').toLowerCase();
  const m = /frame-ancestors([^;]*)/.exec(csp);
  if (m) {
    const value = m[1].trim();
    if (!value.includes('*')) {
      return { embeddable: false, reason: 'This site blocks embedding (Content-Security-Policy: frame-ancestors).' };
    }
  }
  return { embeddable: true, reason: '' };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

function titleOf(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).trim() : '';
}

/** Absolute, http(s), non-tracking-pixel image URLs found in the markup. */
function imagesOf(html: string, base: string): { src: string; w: number; h: number }[] {
  const out: { src: string; w: number; h: number }[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    if (!raw || out.length >= 8) return;
    let abs: string;
    try {
      abs = new URL(decodeEntities(raw.trim()), base).href;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(abs)) return;
    if (/\.svg(\?|#|$)/i.test(abs)) return; // usually an icon, not content
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ src: abs, w: 0, h: 0 });
  };

  // og:image first — it's the page's own pick of its best picture.
  const og = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]) push(og[1]);

  const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) && out.length < 8) {
    const tag = m[0];
    // Skip obvious spacers/pixels declared inline.
    const w = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1] || 0);
    const h = Number(/\bheight=["']?(\d+)/i.exec(tag)?.[1] || 0);
    if ((w && w < 120) || (h && h < 120)) continue;
    push(m[1]);
  }
  return out;
}

/** Substantial paragraphs / headings, in document order. */
function textsOf(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  const out: string[] = [];
  const re = /<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && out.length < 6) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text.length > 60) out.push(text);
  }
  return out;
}

async function fetchPage(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  return res;
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return '';
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
  return html;
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') || 'check';
  const normalized = normalize(req.nextUrl.searchParams.get('url') || '');

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
    const res = await fetchPage(normalized);

    if (action === 'check') {
      const policy = framePolicy(res.headers);
      // Don't hold the connection open for a body we aren't going to read.
      res.body?.cancel().catch(() => {});
      return NextResponse.json({
        url: res.url || normalized,
        status: res.status,
        ...policy,
      });
    }

    if (action === 'extract') {
      const html = await readBody(res);
      const finalUrl = res.url || normalized;
      return NextResponse.json({
        success: true,
        url: finalUrl,
        title: titleOf(html),
        images: imagesOf(html, finalUrl),
        texts: textsOf(html),
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    // A page we can't even reach from the server may still load fine in the
    // user's own browser (geo-blocks, bot filters), so a failed check is never
    // a reason to refuse to try framing it.
    if (action === 'check') {
      return NextResponse.json({ url: normalized, embeddable: true, reason: '', unreachable: message });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
