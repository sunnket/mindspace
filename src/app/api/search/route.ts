import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side search. Search engines block a *browser* session behind a proxy
 * (CAPTCHA / "anomaly" pages), but a single server-side fetch gets clean HTML.
 * So we fetch results here, parse them, and render our OWN results page whose
 * links open through /api/proxy. The user's browser never talks to the engine,
 * so there's no challenge.
 */

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BLOCK_MARKERS = [
  'bots use',
  'complete the following challenge',
  'made by a human',
  'select all squares',
  'unusual traffic',
  'one last step',
  'are you a robot',
  'please solve the challenge',
  'detected unusual',
  'verify you are human',
];

function looksBlocked(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  return BLOCK_MARKERS.some((m) => head.includes(m));
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    // 202/429/403 etc. are anti-bot challenges, not results — skip them so we
    // fall through to the next source.
    if (res.status !== 200) return null;
    const text = await res.text();
    if (looksBlocked(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function parseBing(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const liRe = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) && out.length < 16) {
    const block = m[1];
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    if (!/^https?:\/\//i.test(url) || /bing\.com/i.test(url)) continue;
    const title = stripTags(a[2]);
    const pm = block.match(/<p[^>]*class="[^"]*b_[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = pm ? stripTags(pm[1]) : '';
    if (title) out.push({ url, title, snippet });
  }
  return out;
}

function parseDdgLite(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  // Real markup: <a rel="nofollow" href="//duckduckgo.com/l/?uddg=ENC&amp;rut=…" class='result-link'>Title</a>
  const re = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)(?:&amp;[^"]*)?"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snips = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html)) && out.length < 16) {
    let url: string;
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      url = m[1];
    }
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripTags(m[2]);
    if (title) out.push({ url, title, snippet: snips[i] || '' });
    i++;
  }
  return out;
}

async function braveApi(q: string): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results || [])
      .filter((r) => r.url && r.title)
      .map((r) => ({ url: r.url!, title: stripTags(r.title!), snippet: stripTags(r.description || '') }));
  } catch {
    return [];
  }
}

/** DuckDuckGo Instant Answer API (api.duckduckgo.com) — a different host that
 *  rarely rate-limits. Great for informational queries (Wikipedia-backed), weak
 *  for commercial ones, so it's the last-resort fallback. */
async function ddgInstantAnswer(q: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return [];
    const d = (await res.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: { FirstURL?: string; Text?: string; Topics?: { FirstURL?: string; Text?: string }[] }[];
    };
    const out: SearchResult[] = [];
    if (d.AbstractURL && d.Heading) {
      out.push({ url: d.AbstractURL, title: d.Heading, snippet: d.AbstractText || '' });
    }
    const topics = (d.RelatedTopics || []).flatMap((t) => (t.Topics ? t.Topics : [t]));
    for (const t of topics) {
      if (out.length >= 12) break;
      if (t.FirstURL && t.Text) {
        out.push({ url: t.FirstURL, title: t.Text.split(/ - | — /)[0].slice(0, 90), snippet: t.Text });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function getResults(q: string): Promise<{ results: SearchResult[]; engine: string }> {
  const enc = encodeURIComponent(q);

  // 1) Brave Search API — bulletproof if the user set BRAVE_SEARCH_API_KEY.
  const brave = await braveApi(q);
  if (brave.length) return { results: brave, engine: 'Brave' };

  // 2) DuckDuckGo Lite — the most scraper-tolerant keyless source.
  const ddg = await fetchText(`https://lite.duckduckgo.com/lite/?q=${enc}`);
  if (ddg) {
    const r = parseDdgLite(ddg);
    if (r.length) return { results: r, engine: 'DuckDuckGo' };
  }

  // 3) Bing — higher quality when it isn't throttling us.
  const bing = await fetchText(`https://www.bing.com/search?q=${enc}&count=20&setlang=en`);
  if (bing) {
    const r = parseBing(bing);
    if (r.length) return { results: r, engine: 'Bing' };
  }

  // 4) DDG Instant Answer API — always-available fallback (informational).
  const ia = await ddgInstantAnswer(q);
  if (ia.length) return { results: ia, engine: 'DuckDuckGo' };

  return { results: [], engine: '' };
}

function renderPage(q: string, results: SearchResult[], engine: string, allowRetry: boolean): string {
  const rows = results
    .map((r) => {
      let host = '';
      try {
        host = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        host = r.url;
      }
      const proxied = `/api/proxy?url=${encodeURIComponent(r.url)}`;
      const fav = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
      return `
      <div class="r">
        <a class="u" href="${esc(proxied)}"><img src="${esc(fav)}" width="16" height="16" onerror="this.style.visibility='hidden'"/> ${esc(host)}</a>
        <a class="t" href="${esc(proxied)}">${esc(r.title)}</a>
        ${r.snippet ? `<div class="s">${esc(r.snippet)}</div>` : ''}
      </div>`;
    })
    .join('');

  const body = results.length
    ? `<div class="results">${rows}</div>`
    : `<div class="empty">
         <div class="big">Search is throttled right now</div>
         <p>Free search engines rate-limit automated requests. This usually clears in a few seconds — retrying…</p>
         <a class="fallback" href="/api/search?q=${encodeURIComponent(q)}">Try again</a>
       </div>`;

  // One-time auto-retry (throttles are usually brief); allowRetry stops a loop.
  const autoRetry =
    !results.length && q && allowRetry
      ? `<meta http-equiv="refresh" content="2;url=/api/search?q=${encodeURIComponent(q)}&r=1">`
      : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${autoRetry}
<title>${esc(q)} — Search</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#fff; color:#202124; }
  .top { position:sticky; top:0; background:#fff; border-bottom:1px solid #ebebeb; padding:16px 28px; display:flex; align-items:center; gap:14px; z-index:10; }
  .logo { font-weight:800; font-size:20px; letter-spacing:-0.02em; background:linear-gradient(90deg,#4f8cff,#8b5cf6); -webkit-background-clip:text; background-clip:text; color:transparent; white-space:nowrap; }
  form { flex:1; max-width:640px; }
  .box { display:flex; align-items:center; gap:8px; border:1px solid #dfe1e5; border-radius:24px; padding:8px 16px; }
  .box:focus-within { box-shadow:0 1px 8px rgba(64,60,67,.16); border-color:transparent; }
  .box input { flex:1; border:0; outline:0; font-size:15px; background:transparent; }
  .box svg { color:#9aa0a6; }
  .meta { color:#70757a; font-size:12px; padding:12px 28px 4px; }
  .results { padding:8px 28px 40px; max-width:680px; }
  .r { padding:14px 0; }
  .u { display:flex; align-items:center; gap:7px; color:#202124; font-size:12px; text-decoration:none; margin-bottom:3px; }
  .u img { border-radius:3px; }
  .t { display:block; color:#1a0dab; font-size:18px; line-height:1.3; text-decoration:none; margin-bottom:3px; }
  .t:hover { text-decoration:underline; }
  .s { color:#4d5156; font-size:13px; line-height:1.5; }
  .empty { padding:60px 28px; text-align:center; color:#70757a; }
  .empty .big { font-size:22px; color:#202124; font-weight:700; margin-bottom:8px; }
  .fallback { display:inline-block; margin-top:14px; padding:9px 18px; border-radius:20px; background:#4f8cff; color:#fff; text-decoration:none; font-weight:600; font-size:13px; }
</style></head>
<body>
  <div class="top">
    <span class="logo">Search</span>
    <form action="/api/search" method="get" class="box">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input name="q" value="${esc(q)}" autocomplete="off" autofocus>
    </form>
  </div>
  ${results.length ? `<div class="meta">${results.length} results${engine ? ' · via ' + esc(engine) : ''}</div>` : ''}
  ${body}
  <script>
    try {
      var Q = ${JSON.stringify(q)};
      parent.postMessage({ __ms: 1, type: 'nav', url: 'https://www.bing.com/search?q=' + encodeURIComponent(Q), title: Q ? (Q + ' — Search') : 'Search' }, '*');
    } catch (e) {}
  </script>
</body></html>`;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  if (!q) {
    return new NextResponse(renderPage('', [], '', false), { headers });
  }
  const alreadyRetried = req.nextUrl.searchParams.get('r') === '1';
  const { results, engine } = await getResults(q);
  return new NextResponse(renderPage(q, results, engine, !alreadyRetried), { headers });
}
