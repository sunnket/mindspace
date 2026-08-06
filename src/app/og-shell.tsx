import React from 'react';

/**
 * The shared furniture behind every generated social card.
 *
 * Both cards — the landing one and the per-board share one — have to look like
 * the same product, so the paper, the mark and the wordmark live here once
 * rather than being retyped (and drifting) in two files.
 *
 * These render through Satori, NOT a browser, and Satori implements a deliberate
 * subset of CSS. Two rules govern everything below:
 *   · Flexbox only. No grid, no float, and any element with more than one child
 *     must declare `display: flex` explicitly — Satori has no block layout to
 *     fall back on, and silently mis-stacks children if you forget.
 *   · No external assets. Every colour is a literal and the mark is inline SVG,
 *     because there is no stylesheet, no custom property and no font link in
 *     scope when this runs.
 */

export const OG_SIZE = { width: 1200, height: 630 };

const ACCENT = '#C97B4B';
const PAPER = '#0A0908';
const INK = '#FFFDFA';

/* Grid density. Spaced by `justify-content: space-between` rather than by fixed
   pitch, so the dots stay evenly distributed edge-to-edge without any arithmetic
   against the 1200×630 frame. ~26px apart at this count. */
const DOT_COLS = 46;
const DOT_ROWS = 24;

/** The "c" mark, drawn as an arc so it needs no font — same geometry as the
 *  installed app icon in public/icon-512.png. */
export function Mark({ size = 76 }: { size?: number }) {
  const stroke = size * 0.125;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: ACCENT,
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 100 100">
        <path
          d="M 87 26 A 40 40 0 1 0 87 74"
          fill="none"
          stroke={INK}
          strokeWidth={(stroke / size) * 100 * 1.6}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/**
 * The card's background: near-black paper, one warm bloom in the upper left to
 * keep it from reading as flat, and the faint dot grid that IS the product's
 * visual signature — this is a canvas app, and the grid says so before a single
 * word is read.
 */
export function OgShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: PAPER,
        position: 'relative',
      }}
    >
      {/* The dot grid — the product's visual signature, since this is a canvas
          app and the grid says so before a word is read.

          Built from real elements, which looks wasteful and isn't. The obvious
          version is one div with a tiled `radial-gradient` background, the way
          the app's own canvas does it — but Satori does not implement
          background TILING, so `backgroundSize` on a gradient renders a single
          stretched blob or nothing at all. (It renders nothing, which is how
          this was caught: the first card came out with no grid.) Rows of flex
          children are primitives Satori is guaranteed to lay out correctly.

          Note the EXPLICIT width/height rather than `inset: 0` — Satori does
          not resolve the inset shorthand on an absolutely-positioned box to its
          parent's bounds, and sized this to its content instead, which packed
          the whole grid into a small cluster in the top-left corner. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {Array.from({ length: DOT_ROWS }).map((_, row) => (
          <div key={row} style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
            {Array.from({ length: DOT_COLS }).map((__, col) => (
              <div
                key={col}
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 3,
                  background: 'rgba(255,253,250,0.13)',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Warm bloom, top-left, where the mark sits. */}
      <div
        style={{
          position: 'absolute',
          top: -240,
          left: -180,
          width: 820,
          height: 620,
          backgroundImage: 'radial-gradient(circle, rgba(201,123,75,0.30) 0%, rgba(201,123,75,0) 70%)',
        }}
      />
      {children}
    </div>
  );
}

/** Wordmark row — the mark plus the name, used as the card's header. */
export function OgHeader({ caption }: { caption?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <Mark size={76} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>
          canvabrains
        </span>
        {caption && (
          <span style={{ fontSize: 21, color: 'rgba(255,253,250,0.46)', letterSpacing: '-0.01em' }}>
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}

export const OG_COLORS = { ACCENT, PAPER, INK };
