import type { CanvasObjectData } from '@/lib/db';

/**
 * Client-side embed registry — the heart of the "connect to hundreds of tools"
 * plugin. Given a pasted URL it returns a live iframe `embedUrl`, fully in the
 * browser, with no API keys, OAuth, or server round-trip. One small function
 * here is what lets the canvas embed YouTube, Figma, Spotify, CodePen, Google
 * Docs and more — the oEmbed/iframe trick that whiteboard tools use to claim
 * "250 integrations".
 */

export interface EmbedResult {
  provider: string; // machine id, e.g. 'youtube'
  label: string; // display name, e.g. 'YouTube'
  embedUrl: string; // the iframe src
  aspect?: number; // width / height, when the provider has a natural ratio
}

/** A provider shown in the Plugins panel — for discovery + example placeholders. */
export interface EmbedProviderInfo {
  id: string;
  label: string;
  hint: string; // example URL shape
}

export const EMBED_PROVIDERS: EmbedProviderInfo[] = [
  { id: 'youtube', label: 'YouTube', hint: 'youtube.com/watch?v=…' },
  { id: 'vimeo', label: 'Vimeo', hint: 'vimeo.com/…' },
  { id: 'loom', label: 'Loom', hint: 'loom.com/share/…' },
  { id: 'spotify', label: 'Spotify', hint: 'open.spotify.com/…' },
  { id: 'soundcloud', label: 'SoundCloud', hint: 'soundcloud.com/…' },
  { id: 'figma', label: 'Figma', hint: 'figma.com/(file|design)/…' },
  { id: 'codepen', label: 'CodePen', hint: 'codepen.io/…/pen/…' },
  { id: 'codesandbox', label: 'CodeSandbox', hint: 'codesandbox.io/s/…' },
  { id: 'gmaps', label: 'Google Maps', hint: 'google.com/maps/…' },
  { id: 'gdocs', label: 'Google Docs', hint: 'docs.google.com/…' },
  { id: 'canva', label: 'Canva', hint: 'canva.com/design/…' },
  { id: 'desmos', label: 'Desmos', hint: 'desmos.com/calculator/…' },
  { id: 'website', label: 'Any website', hint: 'https://… (if it allows embedding)' },
];

function normalize(raw: string): string | null {
  let s = (raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    // Validate + normalize via the URL parser.
    return new URL(s).toString();
  } catch {
    return null;
  }
}

/**
 * Turn a pasted URL into an embeddable iframe source. Returns null only when the
 * input isn't a usable URL at all; an unrecognized-but-valid https URL falls
 * back to a generic `website` embed (which loads unless the site sends
 * X-Frame-Options/CSP that forbid framing).
 */
export function resolveEmbed(rawUrl: string): EmbedResult | null {
  const normalized = normalize(rawUrl);
  if (!normalized) return null;

  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  const path = u.pathname;

  // --- YouTube ---
  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    if (id) return { provider: 'youtube', label: 'YouTube', embedUrl: `https://www.youtube.com/embed/${id}`, aspect: 16 / 9 };
  }
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = u.searchParams.get('v');
    const m = path.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{6,})/);
    const id = v || (m ? m[1] : '');
    if (id) return { provider: 'youtube', label: 'YouTube', embedUrl: `https://www.youtube.com/embed/${id}`, aspect: 16 / 9 };
  }

  // --- Vimeo ---
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const m = path.match(/\/(?:video\/)?(\d+)/);
    if (m) return { provider: 'vimeo', label: 'Vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}`, aspect: 16 / 9 };
  }

  // --- Loom ---
  if (host === 'loom.com') {
    const m = path.match(/\/(?:share|embed)\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'loom', label: 'Loom', embedUrl: `https://www.loom.com/embed/${m[1]}`, aspect: 16 / 9 };
  }

  // --- Spotify ---
  if (host === 'open.spotify.com') {
    const m = path.match(/\/(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'spotify', label: 'Spotify', embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  }

  // --- SoundCloud (no API needed: the widget accepts the plain track URL) ---
  if (host === 'soundcloud.com') {
    return {
      provider: 'soundcloud',
      label: 'SoundCloud',
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(normalized)}&color=%23c97b4b&auto_play=false&show_comments=false`,
    };
  }

  // --- Figma ---
  if (host === 'figma.com') {
    if (/^\/(file|proto|design|board|slides)\//.test(path)) {
      return { provider: 'figma', label: 'Figma', embedUrl: `https://www.figma.com/embed?embed_host=canvabrains&url=${encodeURIComponent(normalized)}`, aspect: 4 / 3 };
    }
  }

  // --- CodePen ---
  if (host === 'codepen.io') {
    const m = path.match(/^\/([^/]+)\/(?:pen|full|details)\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'codepen', label: 'CodePen', embedUrl: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, aspect: 4 / 3 };
  }

  // --- CodeSandbox ---
  if (host === 'codesandbox.io') {
    const m = path.match(/^\/(?:s|p\/sandbox|embed)\/([A-Za-z0-9-]+)/);
    if (m) return { provider: 'codesandbox', label: 'CodeSandbox', embedUrl: `https://codesandbox.io/embed/${m[1]}`, aspect: 4 / 3 };
  }

  // --- Google Maps (best-effort, no API key) ---
  if ((host === 'google.com' || host.endsWith('.google.com')) && /\/maps/.test(path)) {
    const at = normalized.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const place = path.match(/\/place\/([^/]+)/);
    const q = at ? `${at[1]},${at[2]}` : place ? decodeURIComponent(place[1]) : '';
    if (q) return { provider: 'gmaps', label: 'Google Maps', embedUrl: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, aspect: 4 / 3 };
  }

  // --- Google Docs / Sheets / Slides (must be shared "anyone with link") ---
  if (host === 'docs.google.com') {
    const m = path.match(/^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      const kind = m[1];
      const id = m[2];
      const embedUrl =
        kind === 'presentation'
          ? `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false`
          : `https://docs.google.com/${kind}/d/${id}/preview`;
      return { provider: 'gdocs', label: 'Google Docs', embedUrl, aspect: kind === 'presentation' ? 16 / 9 : 3 / 4 };
    }
  }

  // --- Canva ---
  if (host === 'canva.com') {
    const m = path.match(/^\/design\/([A-Za-z0-9_-]+)\//);
    if (m) return { provider: 'canva', label: 'Canva', embedUrl: `https://www.canva.com/design/${m[1]}/view?embed`, aspect: 4 / 3 };
  }

  // --- Desmos ---
  if (host === 'desmos.com') {
    const m = path.match(/^\/calculator\/([A-Za-z0-9]+)/);
    if (m) return { provider: 'desmos', label: 'Desmos', embedUrl: `https://www.desmos.com/calculator/${m[1]}?embed`, aspect: 4 / 3 };
  }

  // --- Generic fallback: any valid https page (loads unless it forbids framing) ---
  return { provider: 'website', label: host, embedUrl: normalized };
}

/** Default footprint for a fresh embed block. */
export function embedCardSize(aspect?: number): { width: number; height: number } {
  const width = 480;
  if (!aspect) return { width, height: 320 };
  return { width, height: Math.round(width / aspect) + 40 /* header */ };
}

/** A fresh, empty embed block (prompts for a URL). */
export function newEmbedCard(x: number, y: number): Partial<CanvasObjectData> {
  return {
    type: 'card',
    x,
    y,
    width: 480,
    height: 320,
    content: '',
    style: { isEmbed: true },
  };
}
