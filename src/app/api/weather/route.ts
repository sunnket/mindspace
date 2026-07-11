import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 12;
export const dynamic = 'force-dynamic';

/**
 * Live weather data via Open-Meteo (free, no API key required). Supports
 * geocoding by place name or direct lat/lng coordinates.
 *
 *   GET /api/weather?q=<place>        →  { location, current, daily[] }
 *   GET /api/weather?lat=..&lng=..    →  { location, current, daily[] }
 */

const UA = 'MindspaceCanvas/1.0 (weather)';
const TIMEOUT_MS = 8000;

// WMO weather codes → human-readable + emoji
const WMO_CODES: Record<number, { text: string; icon: string }> = {
  0: { text: 'Clear sky', icon: '☀️' },
  1: { text: 'Mainly clear', icon: '🌤️' },
  2: { text: 'Partly cloudy', icon: '⛅' },
  3: { text: 'Overcast', icon: '☁️' },
  45: { text: 'Foggy', icon: '🌫️' },
  48: { text: 'Depositing rime fog', icon: '🌫️' },
  51: { text: 'Light drizzle', icon: '🌦️' },
  53: { text: 'Moderate drizzle', icon: '🌦️' },
  55: { text: 'Dense drizzle', icon: '🌧️' },
  61: { text: 'Slight rain', icon: '🌦️' },
  63: { text: 'Moderate rain', icon: '🌧️' },
  65: { text: 'Heavy rain', icon: '🌧️' },
  71: { text: 'Slight snow', icon: '🌨️' },
  73: { text: 'Moderate snow', icon: '❄️' },
  75: { text: 'Heavy snow', icon: '❄️' },
  77: { text: 'Snow grains', icon: '🌨️' },
  80: { text: 'Slight rain showers', icon: '🌦️' },
  81: { text: 'Moderate rain showers', icon: '🌧️' },
  82: { text: 'Violent rain showers', icon: '⛈️' },
  85: { text: 'Slight snow showers', icon: '🌨️' },
  86: { text: 'Heavy snow showers', icon: '❄️' },
  95: { text: 'Thunderstorm', icon: '⛈️' },
  96: { text: 'Thunderstorm with hail', icon: '⛈️' },
  99: { text: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

function decodeWmo(code: number): { text: string; icon: string } {
  return WMO_CODES[code] || { text: 'Unknown', icon: '🌡️' };
}

interface GeoResult { lat: number; lng: number; name: string; country: string; }

async function geocodePlace(q: string): Promise<GeoResult | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.results?.[0];
  if (!r) return null;
  return { lat: r.latitude, lng: r.longitude, name: r.name, country: r.country || '' };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim();
  let lat = sp.get('lat') ? Number(sp.get('lat')) : NaN;
  let lng = sp.get('lng') ? Number(sp.get('lng')) : NaN;
  let locationName = '';
  let country = '';

  if (q) {
    const geo = await geocodePlace(q);
    if (!geo) return NextResponse.json({ error: `Could not find "${q}"` }, { status: 404 });
    lat = geo.lat;
    lng = geo.lng;
    locationName = geo.name;
    country = geo.country;
  }

  if (!isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json({ error: 'Provide ?q=<place> or ?lat=&lng=' }, { status: 400 });
  }

  try {
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' +
      '&timezone=auto&forecast_days=7';

    const res = await fetch(weatherUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Open-Meteo returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const c = data.current;
    const wmo = decodeWmo(c?.weather_code ?? 0);

    const daily: Array<{
      date: string; high: number; low: number; condition: string;
      icon: string; precipitation: number;
    }> = [];
    if (data.daily) {
      const d = data.daily;
      for (let i = 0; i < (d.time?.length || 0) && i < 7; i++) {
        const dWmo = decodeWmo(d.weather_code?.[i] ?? 0);
        daily.push({
          date: d.time[i],
          high: d.temperature_2m_max?.[i] ?? 0,
          low: d.temperature_2m_min?.[i] ?? 0,
          condition: dWmo.text,
          icon: dWmo.icon,
          precipitation: d.precipitation_sum?.[i] ?? 0,
        });
      }
    }

    return NextResponse.json({
      location: {
        name: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
        country,
        lat,
        lng,
        timezone: data.timezone || '',
      },
      current: {
        temperature: c?.temperature_2m ?? 0,
        feelsLike: c?.apparent_temperature ?? 0,
        humidity: c?.relative_humidity_2m ?? 0,
        windSpeed: c?.wind_speed_10m ?? 0,
        condition: wmo.text,
        icon: wmo.icon,
        isDay: c?.is_day ?? 1,
      },
      daily,
      units: {
        temperature: data.current_units?.temperature_2m || '°C',
        windSpeed: data.current_units?.wind_speed_10m || 'km/h',
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=1800' }, // cache 30 min
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
