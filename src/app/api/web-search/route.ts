import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 12;
export const dynamic = 'force-dynamic';

/**
 * Web search via DuckDuckGo Instant Answers API (free, no key required).
 * Returns structured search results the agent can use to answer factual
 * questions with real, up-to-date information.
 *
 *   GET /api/web-search?q=<query>  →  { abstract, source, url, relatedTopics[] }
 */

const UA = 'MindspaceCanvas/1.0 (web search)';
const TIMEOUT_MS = 8000;

interface SearchResult {
  abstract: string;
  abstractSource: string;
  abstractURL: string;
  heading: string;
  answer: string;
  relatedTopics: Array<{ text: string; url: string }>;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  try {
    // DuckDuckGo Instant Answer API — free, no key, structured knowledge
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `DuckDuckGo returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();

    const relatedTopics: Array<{ text: string; url: string }> = [];
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 8)) {
        if (topic.Text && topic.FirstURL) {
          relatedTopics.push({ text: topic.Text, url: topic.FirstURL });
        }
        // Handle sub-groups (DDG nests topics in groups sometimes)
        if (Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics.slice(0, 3)) {
            if (sub.Text && sub.FirstURL) {
              relatedTopics.push({ text: sub.Text, url: sub.FirstURL });
            }
          }
        }
      }
    }

    const result: SearchResult = {
      abstract: data.Abstract || '',
      abstractSource: data.AbstractSource || '',
      abstractURL: data.AbstractURL || '',
      heading: data.Heading || '',
      answer: data.Answer || '',
      relatedTopics,
    };

    // If DDG gave us an abstract, great. If it gave us an answer (calculations,
    // conversions), that's also great. If neither, we still return the related
    // topics which often contain useful snippets.
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
