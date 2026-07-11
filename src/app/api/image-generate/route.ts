import { NextRequest, NextResponse } from 'next/server';
import { resolveImageUrl } from '@/lib/imageSources';

export const runtime = 'nodejs';
export const maxDuration = 45;
export const dynamic = 'force-dynamic';

/**
 * REAL AI image generator. Given a prompt it generates a genuine, high-quality
 * picture (not line art) with a strong diffusion model and returns the raw image
 * bytes SAME-ORIGIN, so the client can drop it straight onto the canvas as a
 * real image.
 *
 *   GET /api/image-generate?q=<prompt>[&w=1024&h=1024&style=photo|art|3d|anime]
 *
 * Primary: Pollinations `flux` (free, no key) — a strong text-to-image model.
 * Fallback: a real matching photo from Wikimedia/Openverse, so an image ALWAYS
 * comes back even where Pollinations is geo/Cloudflare-blocked.
 */

const UA = 'MindspaceCanvas/1.0 (image generator)';

// Give the strong model a rich, quality-biased prompt so results look finished.
function enrich(q: string, style: string): string {
  const flavor =
    style === 'art' ? 'digital art, painterly, rich color, artstation trending, masterpiece'
    : style === '3d' ? '3d render, octane, soft studio lighting, high detail, physically based'
    : style === 'anime' ? 'anime illustration, clean line, vibrant, cel shaded, studio quality'
    : style === 'logo' ? 'minimal vector logo, flat, clean geometry, centered, solid background'
    : 'photorealistic, ultra detailed, sharp focus, natural lighting, professional photography, 4k';
  return `${q}, ${flavor}`;
}

async function fetchBytes(url: string, timeoutMs: number): Promise<{ buf: ArrayBuffer; type: string } | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//i.test(type)) return null;
  return { buf: await res.arrayBuffer(), type };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  const style = (req.nextUrl.searchParams.get('style') || 'photo').toLowerCase();
  const w = Math.max(256, Math.min(1280, Number(req.nextUrl.searchParams.get('w')) || 1024));
  const h = Math.max(256, Math.min(1280, Number(req.nextUrl.searchParams.get('h')) || 1024));
  const prompt = enrich(q, style);
  const seed = Math.abs([...q].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 7)) % 100000;

  // 1. Strong generative model (Pollinations flux, then turbo). Each gets its own
  //    deadline so a slow/blocked endpoint fails over quickly to a real photo.
  for (const model of ['flux', 'turbo']) {
    try {
      const gen = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&model=${model}&seed=${seed}`;
      const hit = await fetchBytes(gen, 18_000);
      if (hit && hit.buf.byteLength > 1200) {
        return new NextResponse(hit.buf, {
          headers: {
            'Content-Type': hit.type,
            'Cache-Control': 'public, max-age=86400',
            'X-Image-Source': `pollinations-${model}`,
          },
        });
      }
    } catch { /* try next model / fall through */ }
  }

  // 2. Fallback — a real matching photo from the free image sources, so the
  //    feature keeps working everywhere Pollinations is blocked.
  try {
    const hit = await resolveImageUrl(q);
    if (hit?.url) {
      const bytes = await fetchBytes(hit.url, 12_000);
      if (bytes) {
        return new NextResponse(bytes.buf, {
          headers: { 'Content-Type': bytes.type, 'Cache-Control': 'public, max-age=86400', 'X-Image-Source': hit.source },
        });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'Could not generate an image' }, { status: 502 });
}
