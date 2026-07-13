/* ------------------------------------------------------------------
   Canvas theming — turn a single background choice (color + opacity)
   into a COHESIVE full palette so the whole workspace (canvas paper,
   grid, cards, sticky text, glass toolbar, menus, text) reads as one
   system in light OR dark. The chosen color is the "paper"; every
   surrounding surface, border and text tone is derived from it so
   nothing ever becomes unreadable — light paper gets ink text, dark
   paper gets light text, automatically.
   ------------------------------------------------------------------ */

export interface CanvasBackground {
  /** id of a preset, or 'custom' for a hand-picked color. */
  presetId: string;
  /** base "paper" color (hex). */
  color: string;
  /** 0..1 tint strength — how vividly the color takes over the paper. */
  opacity: number;
  /** force dark surface treatment; when omitted it's inferred from luminance. */
  dark?: boolean;
  /** optional accent override (hex). Falls back to the app's terracotta. */
  accent?: string;
  /** friendly name for UI. */
  name?: string;
}

export interface CanvasThemePreset extends CanvasBackground {
  id: string;
  name: string;
  /** two-stop gradient for the swatch chip in the picker. */
  swatch: [string, string];
}

const DEFAULT_ACCENT = '#C97B4B';

/** Dark graphite default — matches the landing page's dark aesthetic. */
export const DEFAULT_BACKGROUND: CanvasBackground = {
  presetId: 'graphite',
  color: '#1C1A17',
  opacity: 1,
  dark: true,
  accent: '#E8A97B',
  name: 'Graphite',
};

/* ---------------------------- color math ---------------------------- */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  if (Number.isNaN(int) || h.length !== 6) return { r: 250, g: 246, b: 241 };
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Linear blend between two hex colors. t=0 → a, t=1 → b. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex(
    ca.r + (cb.r - ca.r) * k,
    ca.g + (cb.g - ca.g) * k,
    ca.b + (cb.b - ca.b) * k,
  );
}

const lighten = (hex: string, amt: number) => mixHex(hex, '#FFFFFF', amt);
const darken = (hex: string, amt: number) => mixHex(hex, '#000000', amt);

/** Perceptual (sRGB) relative luminance, 0 (black) .. 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Is this hex a "dark" surface that needs light text? */
export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.42;
}

/** WCAG contrast ratio between two hex colors (1 = identical … 21 = black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------------- hue math (for the accent) ---------------------- */

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbToHex(channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255);
}

/**
 * An accent that belongs to the chosen paper.
 *
 * Presets ship their own accent, but a hand-picked colour didn't — it fell
 * through to the app's terracotta, so choosing a green canvas left the whole
 * toolbar, the selected-tool pills and every highlight glowing orange. The
 * accent is now DERIVED whenever one isn't given: same hue as the paper, pushed
 * to a vivid, legible tone against it. A grey or near-white paper has no hue to
 * borrow, so those keep the warm default.
 */
export function deriveAccent(color: string, darkPaper: boolean): string {
  const { h, s } = hexToHsl(color);
  if (s < 0.09) return darkPaper ? '#E8A97B' : DEFAULT_ACCENT;
  const sat = Math.min(0.82, Math.max(0.58, s * 1.15));
  // On dark paper the accent has to out-light the background; on light paper it
  // has to out-dark it. Either way it lands well clear of the paper's own tone.
  return hslToHex(h, sat, darkPaper ? 0.66 : 0.46);
}

/** Legible ink (near-black or warm off-white) for a given background hex. */
export function readableInk(bgHex: string): string {
  return isDarkColor(bgHex) ? '#F4EFE8' : '#2D2A26';
}

/**
 * Pick a text color that is guaranteed readable on `bgHex`. Honors a desired
 * color only when it clears a sensible contrast bar; otherwise falls back to
 * an auto-contrasting ink. `desired` may be undefined or a non-hex CSS value
 * (which we can't measure, so we replace it).
 */
export function ensureReadableInk(desired: string | undefined, bgHex: string): string {
  if (desired && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(desired.trim())) {
    if (contrastRatio(desired.trim(), bgHex) >= 3.2) return desired.trim();
  }
  return readableInk(bgHex);
}

/** The resolved "paper" hex for a background choice (same math as --bg-primary). */
export function paperColor(bg: CanvasBackground): string {
  const neutral = (bg.dark ?? isDarkColor(bg.color)) ? '#0D0C0B' : '#FAF6F1';
  return mixHex(neutral, bg.color, clamp01(bg.opacity));
}

/* --------------------------- presets --------------------------- */

export const CANVAS_PRESETS: CanvasThemePreset[] = [
  { id: 'cream', presetId: 'cream', name: 'Cream', color: '#FAF6F1', opacity: 1, dark: false, accent: DEFAULT_ACCENT, swatch: ['#FDFBF7', '#F1E8DA'] },
  { id: 'linen', presetId: 'linen', name: 'Linen', color: '#F1EADB', opacity: 1, dark: false, accent: '#B98A5E', swatch: ['#F6F0E4', '#E7D9C2'] },
  { id: 'rose', presetId: 'rose', name: 'Rose', color: '#F8E9EC', opacity: 1, dark: false, accent: '#E0567F', swatch: ['#FCEFF2', '#F2D3DC'] },
  { id: 'mint', presetId: 'mint', name: 'Mint', color: '#E6F2EA', opacity: 1, dark: false, accent: '#2F9E6E', swatch: ['#EFF8F1', '#D2E9DA'] },
  { id: 'sky', presetId: 'sky', name: 'Sky', color: '#E7F0FB', opacity: 1, dark: false, accent: '#3E63DD', swatch: ['#F0F6FE', '#D3E4F7'] },
  { id: 'lavender', presetId: 'lavender', name: 'Lilac', color: '#EEEAFA', opacity: 1, dark: false, accent: '#7C5CD6', swatch: ['#F4F1FD', '#DFD6F4'] },
  { id: 'graphite', presetId: 'graphite', name: 'Graphite', color: '#1C1A17', opacity: 1, dark: true, accent: '#E8A97B', swatch: ['#2A2723', '#131210'] },
  { id: 'midnight', presetId: 'midnight', name: 'Midnight', color: '#0F1524', opacity: 1, dark: true, accent: '#5B8DEF', swatch: ['#1B2740', '#0A0E1A'] },
  { id: 'forest', presetId: 'forest', name: 'Forest', color: '#0F2019', opacity: 1, dark: true, accent: '#46C286', swatch: ['#193528', '#0A1710'] },
  { id: 'plum', presetId: 'plum', name: 'Plum', color: '#1B1224', opacity: 1, dark: true, accent: '#C08AE6', swatch: ['#2C1D3B', '#120B18'] },
  { id: 'obsidian', presetId: 'obsidian', name: 'Obsidian', color: '#0C0C0F', opacity: 1, dark: true, accent: '#C97B4B', swatch: ['#1A1A20', '#050506'] },
];

/** Curated custom-color swatches for the picker (mix of pops + deep tones). */
export const CUSTOM_SWATCHES: string[] = [
  '#C97B4B', '#E0567F', '#7C5CD6', '#3E63DD', '#2F9E6E', '#E6A817',
  '#0F1524', '#0F2019', '#1B1224', '#1C1A17', '#243B53', '#3A2A1E',
];

export function presetById(id: string): CanvasThemePreset | undefined {
  return CANVAS_PRESETS.find((p) => p.id === id);
}

/* ----------------------- theme derivation ----------------------- */

/**
 * Full CSS custom-property map derived from a background choice. Applied to
 * :root so every `var(--…)` consumer (cards, text, grid, glass chrome) adopts
 * the theme at once.
 */
export function deriveThemeVars(bg: CanvasBackground): Record<string, string> {
  const neutralLight = '#FAF6F1';
  const neutralDark = '#0D0C0B';
  const inferredDark = bg.dark ?? isDarkColor(bg.color);
  const neutral = inferredDark ? neutralDark : neutralLight;

  // The paper: neutral faded toward the chosen color by the opacity/intensity.
  const primary = mixHex(neutral, bg.color, clamp01(bg.opacity));
  const dark = isDarkColor(primary);

  // No accent given (any hand-picked colour) → take one from the paper's own hue,
  // so the whole UI re-tunes to the background instead of staying terracotta.
  const accent = bg.accent || deriveAccent(bg.color, dark);

  const accentRgb = hexToRgb(accent);
  const accentRgbStr = `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`;

  if (dark) {
    // Elevated surfaces are the paper stepped a touch lighter; text is warm off-white.
    const secondary = lighten(primary, 0.05);
    const tertiary = lighten(primary, 0.11);
    return {
      '--bg-primary': primary,
      '--bg-secondary': secondary,
      '--bg-tertiary': tertiary,
      '--bg-card': 'rgba(255, 255, 255, 0.055)',
      '--bg-glass': 'rgba(255, 255, 255, 0.045)',
      '--text-primary': '#F4EFE8',
      '--text-secondary': 'rgba(244, 239, 232, 0.72)',
      '--text-tertiary': 'rgba(244, 239, 232, 0.50)',
      '--text-muted': 'rgba(244, 239, 232, 0.28)',
      '--border': 'rgba(255, 255, 255, 0.10)',
      '--border-strong': 'rgba(255, 255, 255, 0.20)',
      '--accent': accent,
      '--accent-rgb': accentRgbStr,
      '--accent-light': lighten(accent, 0.18),
      '--accent-subtle': `rgba(${accentRgbStr}, 0.20)`,
      '--shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.45)',
      '--shadow-md': '0 4px 14px rgba(0, 0, 0, 0.42), 0 2px 5px rgba(0, 0, 0, 0.4)',
      '--shadow-lg': '0 14px 44px rgba(0, 0, 0, 0.5), 0 5px 14px rgba(0, 0, 0, 0.4)',
      '--shadow-xl': '0 24px 66px rgba(0, 0, 0, 0.6), 0 10px 24px rgba(0, 0, 0, 0.45)',
    };
  }

  // Light paper: surrounding surfaces are the paper stepped a touch darker.
  const secondary = darken(primary, 0.035);
  const tertiary = darken(primary, 0.075);
  return {
    '--bg-primary': primary,
    '--bg-secondary': secondary,
    '--bg-tertiary': tertiary,
    '--bg-card': 'rgba(255, 253, 250, 0.85)',
    '--bg-glass': 'rgba(255, 253, 250, 0.62)',
    '--text-primary': '#2D2A26',
    '--text-secondary': '#6B6560',
    '--text-tertiary': '#9E9790',
    '--text-muted': '#B7AFA4',
    '--border': 'rgba(45, 42, 38, 0.08)',
    '--border-strong': 'rgba(45, 42, 38, 0.15)',
    '--accent': accent,
    '--accent-rgb': accentRgbStr,
    '--accent-light': lighten(accent, 0.24),
    '--accent-subtle': `rgba(${accentRgbStr}, 0.12)`,
    '--shadow-sm': '0 1px 3px rgba(45, 42, 38, 0.04), 0 1px 2px rgba(45, 42, 38, 0.06)',
    '--shadow-md': '0 4px 12px rgba(45, 42, 38, 0.06), 0 2px 4px rgba(45, 42, 38, 0.04)',
    '--shadow-lg': '0 12px 40px rgba(45, 42, 38, 0.08), 0 4px 12px rgba(45, 42, 38, 0.04)',
    '--shadow-xl': '0 20px 60px rgba(45, 42, 38, 0.1), 0 8px 20px rgba(45, 42, 38, 0.06)',
  };
}

/** The variable names deriveThemeVars manages — used to clean up on reset. */
const MANAGED_VARS = Object.keys(deriveThemeVars(DEFAULT_BACKGROUND));

/** Apply a background's derived palette to the document root. */
export function applyCanvasTheme(bg: CanvasBackground): void {
  if (typeof document === 'undefined') return;
  const vars = deriveThemeVars(bg);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.canvasTheme = isDarkColor(mixHex(
    (bg.dark ?? isDarkColor(bg.color)) ? '#0D0C0B' : '#FAF6F1',
    bg.color,
    clamp01(bg.opacity),
  )) ? 'dark' : 'light';
}

/** Remove all managed vars so globals.css defaults take back over. */
export function resetCanvasTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const k of MANAGED_VARS) root.style.removeProperty(k);
  delete root.dataset.canvasTheme;
}
