import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Dictionary lookup via the Free Dictionary API (dictionaryapi.dev — free,
 * no key required). Returns definitions, phonetics, synonyms, and examples.
 *
 *   GET /api/dictionary?word=<word>  →  { word, phonetic, meanings[], sourceUrl }
 */

const TIMEOUT_MS = 8000;

interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: Array<{
    definition: string;
    example?: string;
    synonyms: string[];
    antonyms: string[];
  }>;
}

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get('word')?.trim().toLowerCase();
  if (!word) return NextResponse.json({ error: 'Provide ?word=' }, { status: 400 });

  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      return NextResponse.json({ error: `No definition found for "${word}"` }, { status: 404 });
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Dictionary API returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : data;

    const phonetic =
      entry.phonetic ||
      entry.phonetics?.find((p: { text?: string }) => p.text)?.text ||
      '';

    const meanings: DictionaryMeaning[] = (entry.meanings || []).map(
      (m: { partOfSpeech: string; definitions: Array<{ definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }> }) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions || []).slice(0, 4).map((d) => ({
          definition: d.definition,
          example: d.example || undefined,
          synonyms: (d.synonyms || []).slice(0, 5),
          antonyms: (d.antonyms || []).slice(0, 3),
        })),
      })
    );

    return NextResponse.json({
      word: entry.word || word,
      phonetic,
      meanings,
      sourceUrl: entry.sourceUrls?.[0] || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    }, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
