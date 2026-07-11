import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ success: false, error: 'Provide ?q=country_name' }, { status: 400 });

  try {
    const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fields=name,capital,population,region,subregion,languages,currencies,flags,area,timezones`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `REST Countries API returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const results = (Array.isArray(data) ? data : [data]).slice(0, 3).map((c: Record<string, unknown>) => {
      const name = (c.name as Record<string, unknown>)?.common as string || q;
      const official = (c.name as Record<string, unknown>)?.official as string || name;
      const capital = (c.capital as string[])?.join(', ') || 'N/A';
      const population = c.population as number || 0;
      const region = c.region as string || '';
      const subregion = c.subregion as string || '';
      const languages = Object.values((c.languages as Record<string, string>) || {}).join(', ');
      const currencyEntries = Object.values((c.currencies as Record<string, Record<string, string>>) || {});
      const currencies = currencyEntries.map((cur) => `${cur.name} (${cur.symbol || ''})`).join(', ');
      const flag = (c.flags as Record<string, string>)?.svg || (c.flags as Record<string, string>)?.png || '';
      const area = c.area as number || 0;
      const timezones = (c.timezones as string[])?.join(', ') || '';

      return {
        name,
        official,
        capital,
        population: population.toLocaleString(),
        region,
        subregion,
        languages,
        currencies,
        flag,
        area: `${area.toLocaleString()} km²`,
        timezones,
      };
    });

    return NextResponse.json({ success: true, results }, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
