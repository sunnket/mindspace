import { NextRequest, NextResponse } from 'next/server';
import type { Browser, Page } from 'puppeteer-core';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs'; // Required for Puppeteer
// Launching Chromium cold, then loading a page, comfortably outruns the default
// serverless limit.
export const maxDuration = 60;

/**
 * On Lambda (which is what a Vercel function is) there is no Chrome: Puppeteer's
 * download lives in ~/.cache on the *build* machine and never ships in the
 * bundle, so `puppeteer.launch()` fails with "Could not find Chrome". There we
 * launch @sparticuz/chromium, a Chromium built to run inside the function.
 * Everywhere else — your machine, a plain Node server — we use the real
 * Puppeteer and the Chrome it downloaded.
 */
const IS_LAMBDA =
  !!process.env.AWS_LAMBDA_FUNCTION_NAME || (!!process.env.VERCEL && process.platform === 'linux');

async function launchBrowser(): Promise<Browser> {
  if (IS_LAMBDA) {
    const [{ default: chromium }, { default: core }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    return core.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { default: puppeteer } = await import('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }) as unknown as Browser;
}

interface Session {
  page: Page;
  lastActive: number;
  /** Last frame we managed to capture, replayed if a screenshot blips. */
  lastFrame?: Buffer;
}

// One Chrome for the whole server, one Page per browser block. Sessions live on
// globalThis so they survive the dev server's module reloads — otherwise every
// edit orphans a Chrome process.
const globalAny = globalThis as unknown as {
  browserSessions?: Map<string, Session>;
  browserInstance?: Promise<Browser> | null;
  browserSweeper?: NodeJS.Timeout;
};

const sessions: Map<string, Session> = (globalAny.browserSessions ??= new Map());

const IDLE_MS = 10 * 60 * 1000;

async function getBrowser(): Promise<Browser> {
  const existing = globalAny.browserInstance;
  if (existing) {
    try {
      const browser = await existing;
      if (browser.connected) return browser;
    } catch {
      // A failed launch must never be cached — otherwise one bad launch poisons
      // every browser block until the server restarts.
    }
    globalAny.browserInstance = null;
  }

  const launched = launchBrowser().catch((e: unknown) => {
    globalAny.browserInstance = null;
    throw e;
  });

  globalAny.browserInstance = launched;
  const browser = await launched;

  // If Chrome dies (crash, machine sleep, someone kills it), drop the handle and
  // the pages that pointed into it so the next request launches a fresh one.
  browser.once('disconnected', () => {
    globalAny.browserInstance = null;
    sessions.clear();
  });

  return browser;
}

// Reap idle pages. The Chrome instance itself is kept warm — relaunching it on
// every new block is what made opening a browser block feel broken.
if (!globalAny.browserSweeper) {
  globalAny.browserSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActive > IDLE_MS) {
        session.page.close().catch(() => {});
        sessions.delete(id);
      }
    }
  }, 60000);
}

function touch(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.lastActive = Date.now();
  return session;
}

/** URL + title, so the client's address bar and tab strip track the real page. */
async function pageState(page: Page) {
  try {
    return { url: page.url(), title: await page.title() };
  } catch {
    return { url: page.url(), title: '' };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Give an in-flight navigation a moment to commit, but never block the UI. */
async function settle(page: Page, ms = 600) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: ms }).catch(() => {}),
    sleep(ms),
  ]);
}

async function newSession(url: string, width: number, height: number) {
  let page: Page;
  try {
    page = await (await getBrowser()).newPage();
  } catch {
    // The cached Chrome was dead (or died mid-call). getBrowser has dropped it
    // by now, so one more try gets a freshly launched one.
    globalAny.browserInstance = null;
    page = await (await getBrowser()).newPage();
  }

  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // A headless popup is invisible to the user — fold target=_blank navigations
  // back into the page they're actually looking at.
  page.on('popup', async (popup) => {
    if (!popup) return;
    const target = popup.url();
    await popup.close().catch(() => {});
    if (target && target !== 'about:blank') {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  });
  // Nothing can answer an alert()/beforeunload prompt in here, and an open
  // dialog freezes screenshots.
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  const id = uuidv4();
  sessions.set(id, { page, lastActive: Date.now() });

  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
      console.error('Goto error:', e.message);
    });
  }

  return { id, page };
}

export async function POST(req: NextRequest) {
  try {
    const { action, sessionId, url, width, height, event } = await req.json();

    if (action === 'start') {
      const { id, page } = await newSession(url, width || 800, height || 600);
      return NextResponse.json({ success: true, sessionId: id, ...(await pageState(page)) });
    }

    // Every other action needs a live session. A dev-server reload or the idle
    // sweeper can drop one out from under the client, so say so explicitly and
    // let the client start a fresh session rather than silently going blank.
    const session = sessionId ? touch(sessionId) : null;
    if (!session) {
      return NextResponse.json({ error: 'Session not found', expired: true }, { status: 404 });
    }
    const { page } = session;

    if (action === 'goto') {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
        console.error('Goto error:', e.message);
      });
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'interact') {
      const { type, x, y, deltaY, key, text } = event || {};
      try {
        if (type === 'click') {
          await page.mouse.click(x, y);
          await settle(page, 500); // a click may be a link — let it navigate
        } else if (type === 'wheel') {
          await page.mouse.wheel({ deltaY });
        } else if (type === 'move') {
          await page.mouse.move(x, y);
        } else if (type === 'text' && text) {
          await page.keyboard.type(text, { delay: 0 });
        } else if (type === 'key' && key) {
          await page.keyboard.press(key);
          if (key === 'Enter') await settle(page, 500); // submitting a form
        }
      } catch (err) {
        console.error('Interaction error:', err);
      }
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'resize') {
      await page.setViewport({ width: Math.max(200, width), height: Math.max(200, height) });
      return NextResponse.json({ success: true });
    }

    // Pull the page's images and visible text out so they can be dropped onto
    // the canvas as real objects.
    if (action === 'extract') {
      const data = await page.evaluate(() => {
        const abs = (src: string) => {
          try {
            return new URL(src, document.baseURI).href;
          } catch {
            return src;
          }
        };
        const images = Array.from(document.querySelectorAll('img'))
          .filter((img) => img.naturalWidth > 120 && img.naturalHeight > 120 && img.src)
          .slice(0, 8)
          .map((img) => ({ src: abs(img.src), w: img.naturalWidth, h: img.naturalHeight }));

        const texts = Array.from(document.querySelectorAll('h1, h2, h3, p, li'))
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 60)
          .slice(0, 6);

        return { images, texts, title: document.title, url: location.href };
      });
      return NextResponse.json({ success: true, ...data });
    }

    if (action === 'state' || action === 'ping') {
      return NextResponse.json({ success: true, ...(await pageState(page)) });
    }

    if (action === 'stop') {
      await page.close().catch(() => {});
      sessions.delete(sessionId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser error';
    console.error('Browser API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// One frame of the live page. A 404 here is the client's signal that the page is
// gone for good and the tab should rebuild its session, so it is reserved for
// exactly that: a screenshot that merely blipped (mid-navigation, mid-paint) is
// retried, and failing that we hold the last frame rather than cry session-death.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return new NextResponse('Missing sessionId', { status: 400 });

  const session = touch(sessionId);
  if (!session) return new NextResponse('Session not found', { status: 404 });

  const shoot = () =>
    session.page.screenshot({ type: 'jpeg', quality: 60, optimizeForSpeed: true });

  let frame: Buffer | null = null;
  try {
    frame = Buffer.from(await shoot());
  } catch {
    await sleep(150);
    try {
      frame = Buffer.from(await shoot());
    } catch (error) {
      // A closed page can never come back — that IS session death.
      if (session.page.isClosed()) {
        sessions.delete(sessionId);
        return new NextResponse('Session not found', { status: 404 });
      }
      console.error('Screenshot error:', error instanceof Error ? error.message : error);
    }
  }

  // Replay the previous frame rather than serve nothing: an empty response would
  // trip the client's <img> error path and it would rebuild a perfectly live page.
  const body = frame ?? session.lastFrame;
  if (!body) return new NextResponse(null, { status: 204 });
  if (frame) session.lastFrame = frame;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
