import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

/**
 * Web search for the canvas agent.
 *
 *   GET /api/web-search?q=<query> → { success, results: [{url,title,snippet}], abstract }
 *
 * ── WHY THIS WAS REWRITTEN ──────────────────────────────────────────────────
 * This endpoint had TWO independent faults, and together they meant the agent
 * had never once seen a web search result:
 *
 *  1. WRONG SHAPE. It returned { abstract, abstractSource, abstractURL,
 *     heading, answer, relatedTopics }. Its only caller (AgentOverlay) reads
 *     `json.success && json.results` — neither field existed, so searchContext
 *     was ALWAYS undefined. The lookup ran on a huge range of prompts, cost a
 *     round trip and a slice of the pre-pass deadline, and contributed nothing.
 *
 *  2. WRONG SOURCE. DuckDuckGo's Instant Answer API only covers encyclopedic
 *     entity lookups, not general search. Probed live: "best react state
 *     management libraries" and "python asyncio tutorial" BOTH returned
 *     completely empty payloads — abstract "", relatedTopics []. So even with
 *     the shape fixed there would have been nothing in it.
 *
 * Together that is why "go find me links" produced no links: the agent is
 * (correctly) forbidden from inventing URLs, and it was never handed real ones.
 *
 * DuckDuckGo's HTML endpoint DOES return general web results with no API key
 * (probed: 10 real titles + URLs for the same query), so that is the primary
 * source now, with the Instant Answer abstract kept as a bonus when present.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TIMEOUT_MS = 9000;

export interface WebResult {
  url: string;
  title: string;
  snippet: string;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * DuckDuckGo wraps every result in a redirect —
 * `//duckduckgo.com/l/?uddg=<percent-encoded real url>&rut=…`. That is useless
 * as a Link Card (it would never resolve to a real page preview), so unwrap it
 * back to the destination before handing it to the agent.
 */
function unwrapDdg(href: string): string {
  let u = decodeEntities(href).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  try {
    const parsed = new URL(u, 'https://duckduckgo.com');
    const target = parsed.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
    if (/^https?:$/.test(parsed.protocol) && !/(^|\.)duckduckgo\.com$/i.test(parsed.hostname)) {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

/** Pull result blocks out of DDG's HTML SERP. */
function parseDdgHtml(html: string, limit: number): WebResult[] {
  const out: WebResult[] = [];
  const seen = new Set<string>();

  const snippets: string[] = [];
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));

  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = linkRe.exec(html)) !== null && out.length < limit) {
    const url = unwrapDdg(m[1]);
    const title = stripTags(m[2]);
    idx++;
    if (!url || !title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title, snippet: snippets[idx - 1] || '' });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ success: false, error: 'Provide ?q=' }, { status: 400 });
  const limit = Math.min(10, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 6));

  /* Both sources race in parallel — the abstract is a nice-to-have and must
     never delay the links, which are the part the agent actually places. */
  const htmlSearch = (async (): Promise<WebResult[]> => {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return [];
      return parseDdgHtml(await res.text(), limit);
    } catch {
      return [];
    }
  })();

  const instantAnswer = (async (): Promise<{ abstract: string; url: string; source: string }> => {
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!res.ok) return { abstract: '', url: '', source: '' };
      const d = await res.json();
      return { abstract: d.Abstract || d.Answer || '', url: d.AbstractURL || '', source: d.AbstractSource || '' };
    } catch {
      return { abstract: '', url: '', source: '' };
    }
  })();

  const [results, ia] = await Promise.all([htmlSearch, instantAnswer]);

  /* A verified encyclopedic answer leads when it exists, but it goes in as a
     normal result so the caller only has one array to read. */
  const merged: WebResult[] = [...results];
  if (ia.abstract && ia.url && !merged.some((r) => r.url === ia.url)) {
    merged.unshift({ url: ia.url, title: ia.source || 'Overview', snippet: ia.abstract.slice(0, 400) });
  }

  return NextResponse.json(
    { success: merged.length > 0, query: q, results: merged.slice(0, limit), abstract: ia.abstract },
    { headers: { 'Cache-Control': 'public, max-age=1800' } },
  );
}
