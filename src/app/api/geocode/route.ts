import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Free place search for the Map block. Proxies OpenStreetMap's Nominatim
 * geocoder (no API key) from the server so we can send the required User-Agent
 * and dodge browser CORS. GET /api/geocode?q=<place> → { lat, lng, label, bbox }.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'A ?q= place is required' }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires a descriptive User-Agent.
        'User-Agent': 'MindspaceCanvas/1.0 (canvas map block)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return NextResponse.json({ error: `Geocoder error ${res.status}` }, { status: 502 });

    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; boundingbox?: string[] }>;
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: 'No place found' }, { status: 404 });
    }
    const hit = data[0];
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    // boundingbox = [south, north, west, east]
    const bb = hit.boundingbox?.map(Number);
    const bbox = bb && bb.length === 4 ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null;

    return NextResponse.json({ lat, lng, label: hit.display_name, bbox });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
