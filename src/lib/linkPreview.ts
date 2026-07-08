import type { CanvasObjectData } from '@/lib/db';

/**
 * Shared helpers for the canvas link-preview system. Any surface that wants to
 * turn a URL into a rich preview card (paste, typed text, slash command, the AI
 * agent) funnels through here so the behaviour is identical everywhere.
 *
 * The flow is: create a `card` with `style.isLinkPreview` + `style.linkUrl` and
 * `style.linkLoading = true`. `LinkPreviewBlock` then self-hydrates by calling
 * `/api/link-preview` and filling in the title/description/image/embed fields.
 */

// Matches a bare or full URL: optional scheme, a dotted host, optional path.
// Deliberately strict enough that ordinary prose isn't mistaken for a link.
const URL_RE =
  /^(https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;

/** True when the ENTIRE trimmed string is a single URL (no surrounding words). */
export function isUrl(text: string): boolean {
  const s = (text || '').trim();
  if (!s || /\s/.test(s)) return false;
  // Reject things that merely contain a dot but aren't hosts, e.g. "3.14" or "e.g".
  if (/^\d+(\.\d+)+$/.test(s)) return false;
  if (!URL_RE.test(s)) return false;
  // Must have a plausible TLD or an explicit scheme.
  return /^https?:\/\//i.test(s) || /\.[a-z]{2,}(?:[:/?#]|$)/i.test(s);
}

/** Pull the first URL out of a larger blob of pasted/typed text, if any. */
export function extractUrl(text: string): string | null {
  const s = (text || '').trim();
  if (!s) return null;
  if (isUrl(s)) return normalizeUrl(s);
  const m = s.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? normalizeUrl(m[0]) : null;
}

/** Ensure a scheme is present so the value is a valid href / fetch target. */
export function normalizeUrl(raw: string): string {
  let s = (raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

/** Best-effort domain for the initial (pre-fetch) loading card. */
export function domainOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Style payload for a fresh link-preview card. `linkLoading` drives the shimmer
 * skeleton until `LinkPreviewBlock` hydrates it. `linkResolved` stays false so
 * the block knows it still needs to fetch metadata.
 */
export function linkPreviewStyle(url: string): Record<string, unknown> {
  const normalized = normalizeUrl(url);
  return {
    isLinkPreview: true,
    linkUrl: normalized,
    linkDomain: domainOf(normalized),
    linkLoading: true,
    linkResolved: false,
    linkError: false,
  };
}

/** Default footprint for a link-preview card on the canvas. */
export const LINK_CARD_SIZE = { width: 300, height: 260 };

/** Convenience partial for `addObject` — a loading link card at (x, y). */
export function newLinkCard(url: string, x: number, y: number): Partial<CanvasObjectData> {
  return {
    type: 'card',
    x,
    y,
    width: LINK_CARD_SIZE.width,
    height: LINK_CARD_SIZE.height,
    content: '',
    style: linkPreviewStyle(url),
  };
}
