import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 12;
export const dynamic = 'force-dynamic';

/**
 * News search. Tries multiple free, no-key news sources in order:
 *  1. Wikimedia EventStreams / Wikipedia Current Events (always free)
 *  2. DuckDuckGo news (scrape-safe instant answers)
 *
 *   GET /api/news?q=<topic>  →  { articles: Article[] }
 */

const UA = 'MindspaceCanvas/1.0 (news lookup)';
const TIMEOUT_MS = 8000;

interface Article {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt?: string;
}

async function fromDuckDuckGoNews(q: string): Promise<Article[]> {
  // DDG's instant answer API can surface news-related topics
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q + ' news')}&format=json&no_html=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = await res.json();

  const articles: Article[] = [];

  // Abstract itself might be a news summary
  if (data.Abstract && data.AbstractURL) {
    articles.push({
      title: data.Heading || q,
      description: data.Abstract,
      url: data.AbstractURL,
      source: data.AbstractSource || 'DuckDuckGo',
    });
  }

  // Related topics often contain news-adjacent links
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics.slice(0, 8)) {
      if (topic.Text && topic.FirstURL) {
        articles.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 100),
          description: topic.Text,
          url: topic.FirstURL,
          source: 'DuckDuckGo',
        });
      }
    }
  }

  return articles;
}

async function fromWikipediaCurrentEvents(): Promise<Article[]> {
  // Wikipedia's current events portal — always up-to-date, always free
  const today = new Date();
  const dateStr = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}_${String(today.getDate()).padStart(2, '0')}`;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/Portal:Current_events/${dateStr}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!res.ok) {
      // Fall back to general current events portal
      const fallbackRes = await fetch(
        'https://en.wikipedia.org/api/rest_v1/page/summary/Portal:Current_events',
        {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        }
      );
      if (!fallbackRes.ok) return [];
      const data = await fallbackRes.json();
      return data.extract ? [{
        title: 'Current Events',
        description: data.extract.slice(0, 500),
        url: data.content_urls?.desktop?.page || 'https://en.wikipedia.org/wiki/Portal:Current_events',
        source: 'Wikipedia',
        publishedAt: today.toISOString(),
      }] : [];
    }

    const data = await res.json();
    return data.extract ? [{
      title: `Today's Events — ${dateStr.replace(/_/g, '/')}`,
      description: data.extract.slice(0, 500),
      url: data.content_urls?.desktop?.page || 'https://en.wikipedia.org/wiki/Portal:Current_events',
      source: 'Wikipedia',
      publishedAt: today.toISOString(),
    }] : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Provide ?q=' }, { status: 400 });

  try {
    // Try DDG news search + Wikipedia current events in parallel
    const [ddgArticles, wikiArticles] = await Promise.all([
      fromDuckDuckGoNews(q).catch(() => [] as Article[]),
      fromWikipediaCurrentEvents().catch(() => [] as Article[]),
    ]);

    // Combine and dedupe by URL
    const seen = new Set<string>();
    const articles: Article[] = [];
    for (const a of [...ddgArticles, ...wikiArticles]) {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        articles.push(a);
      }
    }

    return NextResponse.json({ articles: articles.slice(0, 10) }, {
      headers: { 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, articles: [] }, { status: 500 });
  }
}
