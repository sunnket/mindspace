import { NextRequest, NextResponse } from 'next/server';

/**
 * A tiny, deliberately-narrow proxy for outgoing webhooks. Slack (and most
 * providers) block browser CORS, so the POST is relayed server-side. The user's
 * webhook URL comes from the request and is never stored; only a fixed allowlist
 * of known webhook providers is permitted, which keeps this from being an
 * open SSRF relay to arbitrary/internal hosts.
 */

// Host suffixes we'll relay to. Zapier + Make alone bridge to thousands of apps.
const ALLOWED = [
  'hooks.slack.com',
  'discord.com',
  'discordapp.com',
  'hooks.zapier.com',
  'make.com',
  'integromat.com',
  'maker.ifttt.com',
  'webhook.site',
];

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED.some((suffix) => h === suffix || h.endsWith('.' + suffix) || h.endsWith(suffix));
}

/** Shape the message body the way each provider expects. */
function payloadFor(host: string, text: string): string {
  if (host.endsWith('slack.com')) return JSON.stringify({ text });
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) return JSON.stringify({ content: text });
  // Zapier / Make / IFTTT / webhook.site accept arbitrary JSON.
  return JSON.stringify({ text, source: 'canvabrains' });
}

export async function POST(req: NextRequest) {
  let body: { url?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawUrl = (body.url || '').trim();
  const text = (body.text || '').toString().slice(0, 3000);
  if (!rawUrl || !text) return NextResponse.json({ error: 'Missing url or text' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 });
  }
  if (target.protocol !== 'https:') return NextResponse.json({ error: 'Webhook must be https' }, { status: 400 });
  if (!hostAllowed(target.hostname)) {
    return NextResponse.json({ error: `Only Slack, Discord, Zapier, Make, IFTTT & webhook.site URLs are allowed (got ${target.hostname})` }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadFor(target.hostname, text),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json({ error: `Webhook responded ${res.status}`, detail: detail.slice(0, 200) }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status: 502 });
  }
}
