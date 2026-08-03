import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';

export const runtime = 'nodejs';
export const maxDuration = 25;
export const dynamic = 'force-dynamic';

/**
 * Fetch a remote image and hand it back as a `data:` URL.
 *
 * WHY THIS EXISTS. Drawing a cross-origin image onto a canvas taints it, and a
 * tainted canvas throws on `getImageData` and `toDataURL`. Every tool in the
 * image studio — pulling out a crop, removing a background, reading a palette —
 * is pixel work, so on an image placed from web search (a plain https URL)
 * every one of them would fail. Many image hosts send no CORS headers at all,
 * so `crossOrigin="anonymous"` cannot rescue it from the browser side. The
 * server has no same-origin policy; it fetches the bytes and returns them
 * inline, and the pixels become ordinary local pixels.
 *
 * WHY THIS IS NOT AN OPEN SSRF RELAY. Unlike the webhook proxy next door, an
 * allowlist is not available — the whole point is arbitrary image URLs from
 * search results. So it is fenced by behaviour instead:
 *
 *   · https/http only (no file:, gopher:, data:, blob:)
 *   · the resolved IP is checked against every private, loopback, link-local
 *     and carrier-grade-NAT range BEFORE the request goes out — this is the
 *     control that stops `http://169.254.169.254/` cloud metadata and
 *     `http://127.0.0.1:6379/` internal services
 *   · redirects are followed MANUALLY, re-validating the host each hop, because
 *     a public URL that 302s to 127.0.0.1 defeats a single up-front check
 *   · the response must actually be an image, and is size-capped
 *   · only the bytes come back — no headers, no status, no body on failure —
 *     so this cannot be used to probe what exists behind the firewall
 */

/** Data URLs are ~33% larger than the bytes; keep the response sane. */
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                        // "this network"
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;// private
  if (a === 192 && b === 168) return true;         // private
  if (a === 192 && b === 0) return true;           // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true;                       // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::' || v === '::1') return true;      // unspecified / loopback
  if (v.startsWith('fe80')) return true;           // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  // IPv4-mapped (::ffff:127.0.0.1) — judge it on the embedded address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** Resolve the host and refuse anything that points inside the perimeter. */
async function hostIsPublic(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return false;
  }
  try {
    // `all: true` matters: a host with several A records is only safe if EVERY
    // one of them is public, otherwise the fetch may pick the private one.
    const records = await lookup(host, { all: true });
    if (!records.length) return false;
    return records.every(({ address, family }) =>
      family === 6 ? !isPrivateIPv6(address) : !isPrivateIPv4(address));
  } catch {
    return false;
  }
}

async function validatedFetch(rawUrl: string): Promise<Response> {
  let url = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error('Only http(s) image URLs are supported.');
    }
    if (!(await hostIsPublic(target.hostname))) {
      throw new Error('That host is not publicly reachable.');
    }

    const res = await fetch(target.toString(), {
      // Manual, so each hop is re-validated instead of trusting the first.
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CanvabrainsImage/1.0)',
        Accept: 'image/*,*/*;q=0.8',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('The image host sent a redirect with no destination.');
      url = new URL(location, target).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawUrl = (body.url || '').trim();
  if (!rawUrl) return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  if (rawUrl.startsWith('data:')) {
    // Already inline — nothing to do, and echoing it back would double a
    // potentially huge payload through the server for no reason.
    return NextResponse.json({ dataUrl: rawUrl });
  }

  try {
    const res = await validatedFetch(rawUrl);
    if (!res.ok) {
      return NextResponse.json({ error: `The image host returned ${res.status}.` }, { status: 502 });
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'That URL is not an image.' }, { status: 415 });
    }

    // Trust the header when it is present, but still measure the body — a wrong
    // or absent content-length is exactly how a size cap gets bypassed.
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is too large to work with.' }, { status: 413 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is too large to work with.' }, { status: 413 });
    }

    return NextResponse.json({
      dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
      bytes: buf.byteLength,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
