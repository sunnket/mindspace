import { NextRequest, NextResponse } from 'next/server';
import puppeteer, { Browser, Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs'; // Required for Puppeteer

// Store sessions globally to persist across API calls
const globalAny = globalThis as any;
if (!globalAny.browserSessions) {
  globalAny.browserSessions = new Map<string, { browser: Browser; page: Page; lastActive: number }>();
}
const sessions: Map<string, { browser: Browser; page: Page; lastActive: number }> = globalAny.browserSessions;

// Clean up idle sessions (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > 10 * 60 * 1000) {
      session.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60000);

export async function POST(req: NextRequest) {
  try {
    const { action, sessionId, url, width, height, event } = await req.json();

    // 1. START SESSION
    if (action === 'start') {
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      
      await page.setViewport({
        width: width || 800,
        height: height || 600,
        deviceScaleFactor: 1,
      });

      // Default user agent to prevent some blocking
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const id = uuidv4();
      sessions.set(id, { browser, page, lastActive: Date.now() });

      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.error('Goto error:', e));
      }

      return NextResponse.json({ success: true, sessionId: id });
    }

    // 2. NAVIGATE
    if (action === 'goto') {
      const session = sessions.get(sessionId);
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      session.lastActive = Date.now();
      
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.error('Goto error:', e));
      return NextResponse.json({ success: true });
    }

    // 3. INTERACT
    if (action === 'interact') {
      const session = sessions.get(sessionId);
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      session.lastActive = Date.now();

      const { type, x, y, deltaY, key } = event;
      
      try {
        if (type === 'click') {
          await session.page.mouse.click(x, y);
        } else if (type === 'wheel') {
          await session.page.mouse.wheel({ deltaY });
        } else if (type === 'keydown') {
          await session.page.keyboard.press(key);
        } else if (type === 'mousemove') {
           await session.page.mouse.move(x, y);
        }
      } catch (err) {
        console.error('Interaction error:', err);
      }

      return NextResponse.json({ success: true });
    }
    
    // 4. RESIZE
    if (action === 'resize') {
       const session = sessions.get(sessionId);
       if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
       session.lastActive = Date.now();
       await session.page.setViewport({ width, height });
       return NextResponse.json({ success: true });
    }

    // 5. STOP
    if (action === 'stop') {
      const session = sessions.get(sessionId);
      if (session) {
        await session.browser.close().catch(() => {});
        sessions.delete(sessionId);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Browser API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Fetch the screenshot for a given session
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return new NextResponse('Missing sessionId', { status: 400 });

  const session = sessions.get(sessionId);
  if (!session) {
    // Return a 1x1 transparent pixel so the img src doesn't break if session expired
    const emptyPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    return new NextResponse(emptyPixel, {
      headers: { 'Content-Type': 'image/png' },
      status: 404,
    });
  }

  session.lastActive = Date.now();

  try {
    const screenshot = await session.page.screenshot({ type: 'jpeg', quality: 50 });
    return new NextResponse(Buffer.from(screenshot), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    return new NextResponse('Screenshot failed', { status: 500 });
  }
}
