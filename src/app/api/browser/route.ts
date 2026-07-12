import { NextRequest, NextResponse } from 'next/server';
import puppeteer, { Browser, Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs'; // Required for Puppeteer

interface Session {
  page: Page;
  lastActive: number;
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
    const browser = await existing;
    if (browser.connected) return browser;
  }
  const launched = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  globalAny.browserInstance = launched;
  return launched;
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
  const browser = await getBrowser();
  const page = await browser.newPage();

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

// One frame of the live page.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return new NextResponse('Missing sessionId', { status: 400 });

  const session = touch(sessionId);
  if (!session) return new NextResponse('Session not found', { status: 404 });

  try {
    const screenshot = await session.page.screenshot({
      type: 'jpeg',
      quality: 60,
      optimizeForSpeed: true,
    });
    return new NextResponse(Buffer.from(screenshot), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    return new NextResponse('Screenshot failed', { status: 500 });
  }
}
