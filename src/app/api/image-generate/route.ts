import { NextRequest, NextResponse } from 'next/server';
import { resolveImageUrl } from '@/lib/imageSources';

export const runtime = 'nodejs';
export const maxDuration = 45;
export const dynamic = 'force-dynamic';

/**
 * AI image generator, specialised for LINE ART so the result can be re-inked on
 * the canvas as real pen strokes. Generates a clean black-on-white line drawing
 * for a prompt and returns the raw image bytes SAME-ORIGIN, so the client can
 * read its pixels (getImageData) without a CORS taint to vectorize it.
 *
 *   GET /api/image-generate?q=<prompt>[&sketch=0]
 *
 * Primary: Pollinations (free, no key). Fallback: a Wikimedia/Openverse line
 * drawing via our own image-search. Always tries to return an image.
 */

const UA = 'MindspaceCanvas/1.0 (sketch generator)';

function sketchPrompt(q: string): string {
  return `${q}, black and white line art, clean thin single-weight ink outline drawing, minimal continuous lines, coloring book style, no shading, no hatching, no grayscale fill, pure white background`;
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
  const asSketch = req.nextUrl.searchParams.get('sketch') !== '0';
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  const prompt = asSketch ? sketchPrompt(q) : q;
  const seed = Math.abs([...q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 100000;

  // 1. Pollinations generative model (free).
  try {
    const gen = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=640&height=640&nologo=true&model=flux&seed=${seed}`;
    const hit = await fetchBytes(gen, 40_000);
    if (hit && hit.buf.byteLength > 800) {
      return new NextResponse(hit.buf, {
        headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400', 'X-Sketch-Source': 'pollinations' },
      });
    }
  } catch { /* fall through */ }

  // 2. Fallback — a real line drawing / coloring page from Wikimedia/Openverse,
  //    which vectorizes into pen strokes just as well. (Pollinations is often
  //    geo/Cloudflare-blocked, so this keeps the feature working everywhere.)
  try {
    const hit = await resolveImageUrl(q, { lineArt: asSketch });
    if (hit?.url) {
      const bytes = await fetchBytes(hit.url, 12_000);
      if (bytes) {
        return new NextResponse(bytes.buf, {
          headers: { 'Content-Type': bytes.type, 'Cache-Control': 'public, max-age=86400', 'X-Sketch-Source': hit.source },
        });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'Could not generate an image' }, { status: 502 });
}
