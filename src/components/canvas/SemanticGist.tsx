'use client';

import React from 'react';
import { GIST_INSET_CSS, type SemanticView } from '@/lib/semanticZoom';

/**
 * The gist a text block prints when it is too small to read — see
 * `lib/semanticZoom.ts` for when that happens and why.
 *
 * This layer sits OVER the block rather than replacing its contents, and the
 * real text underneath only fades (see `[data-semantic]` in globals.css). That
 * matters more than it looks: text/heading/sticky blocks grow to fit their
 * text, and the ResizeObserver doing the growing measures the display node. If
 * the gist swapped that node out, every block on screen would resize itself to
 * the size of its own summary the moment you zoomed out — and stay that size
 * when you zoomed back in. Fading keeps the measured height truthful.
 */
export default function SemanticGist({
  view,
  zoom,
  ink,
  align = 'left',
  fontFamily,
}: {
  view: SemanticView;
  zoom: number;
  ink: string;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
}) {
  // Everything here is authored in SCREEN px and divided by the zoom, so the
  // canvas transform lands it back at the size written down.
  const px = (screen: number) => screen / zoom;

  const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

  const shell: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: justify,
    /* A percentage, not a counter-scaled constant: the fitter budgets the gist
       against exactly this fraction of the block, and the two only agree at
       every block width if the inset scales with the block. */
    padding: GIST_INSET_CSS,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 2,
  };

  if (view.kind === 'ghost') {
    // Not even one word fits. Two rules say "prose lives here" without
    // pretending to be legible — an honest answer beats a clipped fragment.
    const bar = px(2);
    return (
      <div className="semantic-gist" style={{ ...shell, alignItems: 'center' }} aria-hidden>
        <div style={{ display: 'flex', flexDirection: 'column', gap: bar * 1.8, width: '100%' }}>
          <span style={{ height: bar, width: '72%', borderRadius: bar, background: ink, opacity: 0.22 }} />
          <span style={{ height: bar, width: '46%', borderRadius: bar, background: ink, opacity: 0.22 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="semantic-gist" style={shell} aria-hidden>
      <span
        style={{
          fontFamily: fontFamily || "'Inter', sans-serif",
          fontSize: `${view.fontPx}px`,
          fontWeight: view.weight,
          lineHeight: 1.25,
          letterSpacing: '-0.011em',
          color: ink,
          opacity: view.role === 'display' ? 0.95 : 0.82,
          textAlign: align,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: view.lines,
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {view.text}
        {view.hidden > 0 && (
          // How much was left behind. Without it a gist reads as the whole
          // block, and you'd zoom past something long thinking you'd seen it.
          <span style={{ fontSize: '0.68em', fontWeight: 500, opacity: 0.5, whiteSpace: 'nowrap' }}>
            {' +'}
            {view.hidden}
          </span>
        )}
      </span>
    </div>
  );
}
