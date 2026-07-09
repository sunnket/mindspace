import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Free place search + reverse lookup for the Map block. Proxies OpenStreetMap's
 * Nominatim geocoder (no API key) from the server so we can send the required
 * User-Agent and dodge browser CORS.
 *
 *   GET /api/geocode?q=<place>&limit=<n>   → { results: Place[] }   (search / type-ahead)
 *   GET /api/geocode?lat=<n>&lng=<n>       → { results: Place[] }   (reverse — "locate me")
 *
 * Place = { lat, lng, name, label, kind, bbox }
 */

interface Place {
  lat: number;
  lng: number;
  name: string;   // short, human label ("Eiffel Tower")
  label: string;  // full display name
  kind: string;   // nominatim "type" (e.g. attraction, city, restaurant)
  bbox: { south: number; north: number; west: number; east: number } | null;
}

const UA = 'MindspaceCanvas/1.0 (canvas map block)';

function toPlace(hit: {
  lat: string; lon: string; display_name: string; name?: string;
  type?: string; addresstype?: string; boundingbox?: string[];
}): Place {
  const bb = hit.boundingbox?.map(Number);
  const bbox = bb && bb.length === 4 && bb.every((n) => Number.isFinite(n))
    ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] }
    : null;
  const short = (hit.name && hit.name.trim()) || hit.display_name.split(',')[0].trim();
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    name: short,
    label: hit.display_name,
    kind: hit.addresstype || hit.type || 'place',
    bbox,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim();
  const lat = sp.get('lat');
  const lng = sp.get('lng');

  try {
    let url: string;
    let reverse = false;

    if (lat && lng) {
      reverse = true;
      url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=jsonv2&addressdetails=0`;
    } else if (q) {
      const limit = Math.min(8, Math.max(1, Number(sp.get('limit')) || 1));
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=${limit}&addressdetails=0`;
    } else {
      return NextResponse.json({ error: 'Provide ?q= or ?lat=&lng=' }, { status: 400 });
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return NextResponse.json({ error: `Geocoder error ${res.status}` }, { status: 502 });

    const data = await res.json();
    const hits = reverse ? (data && data.lat ? [data] : []) : (Array.isArray(data) ? data : []);
    const results = hits.map(toPlace).filter((p: Place) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (results.length === 0) return NextResponse.json({ results: [], error: 'No place found' }, { status: reverse ? 404 : 200 });
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
