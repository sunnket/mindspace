import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROXY_PATH = '/api/proxy';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Response headers that must never be forwarded: framing/security blockers, and
// encoding/length headers that lie after fetch() has already decoded the body.
const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'clear-site-data',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'permissions-policy',
  'report-to',
  'nel',
  'strict-transport-security',
]);

/** Light SSRF guard: only allow http(s) to public hosts. */
function isBlockedTarget(u: URL): boolean {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  // Private / link-local IPv4 ranges.
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function corsHeaders(h: Headers) {
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', '*');
}

/** Head content injected into every proxied HTML document. */
function buildInjection(finalUrl: string): string {
  const cfg = JSON.stringify({ base: finalUrl, proxyPath: PROXY_PATH });
  return (
    `<base href="${finalUrl.replace(/"/g, '&quot;')}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<script>window.__MS_CFG=${cfg};</script>` +
    `<script src="/proxy-shim.js"></script>`
  );
}

function injectIntoHtml(html: string, finalUrl: string): string {
  const injection = buildInjection(finalUrl);
  // Remove any existing <base> so ours is authoritative.
  let out = html.replace(/<base\b[^>]*>/gi, '');
  // Neutralise integrity checks on subresources we might touch indirectly.
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/(<head[^>]*>)/i, `$1${injection}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/(<html[^>]*>)/i, `$1<head>${injection}</head>`);
  } else {
    out = injection + out;
  }
  return out;
}

async function handle(req: NextRequest, method: 'GET' | 'POST'): Promise<NextResponse> {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return new NextResponse('Missing "url" parameter', { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }
  if (isBlockedTarget(target)) {
    return new NextResponse('Blocked target', { status: 403 });
  }

  // Build upstream request.
  const upstreamHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    Referer: target.origin + '/',
  };
  if (method === 'POST') {
    const ct = req.headers.get('content-type');
    if (ct) upstreamHeaders['Content-Type'] = ct;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.href, {
      method,
      headers: upstreamHeaders,
      body: method === 'POST' ? await req.arrayBuffer() : undefined,
      redirect: 'follow',
      // @ts-expect-error - undici option, not in lib.dom types
      duplex: method === 'POST' ? 'half' : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return new NextResponse(`Proxy fetch failed: ${msg}`, { status: 502 });
  }

  // The URL we actually landed on after redirects — used for <base> and
  // relative-URL resolution inside the page.
  const finalUrl = upstream.url || target.href;

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  corsHeaders(headers);

  const contentType = upstream.headers.get('content-type') || '';
  const isHtml =
    contentType.includes('text/html') || contentType.includes('application/xhtml+xml');

  // Non-HTML (images, css, js, fonts, json, …): stream straight through.
  if (!isHtml) {
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, { status: upstream.status, headers });
  }

  // HTML: rewrite and inject our runtime.
  const original = await upstream.text();
  const rewritten = injectIntoHtml(original, finalUrl);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new NextResponse(rewritten, { status: upstream.status, headers });
}

export async function GET(req: NextRequest) {
  return handle(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handle(req, 'POST');
}

export async function OPTIONS() {
  const headers = new Headers();
  corsHeaders(headers);
  return new NextResponse(null, { status: 204, headers });
}
