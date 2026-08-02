'use client';

import React from 'react';
import { unstable_catchError, type ErrorInfo } from 'next/error';

/**
 * One broken block must not take the board with it.
 *
 * There are roughly forty block types on this canvas — charts, PDFs, maps,
 * repo trees, mermaid diagrams, embeds, webcam mirrors — and most of them
 * render data that came from somewhere the app does not control: a pasted URL,
 * an imported file, a JSON payload written by an older version of this app, an
 * AI response. Any one of them can throw during render for reasons that have
 * nothing to do with the other ninety-nine blocks on the board.
 *
 * Until this existed, that throw propagated all the way to the root and React
 * unmounted the entire tree — the whole board went white. On an infinite canvas
 * that is a genuinely frightening failure: the work is still safe in IndexedDB,
 * but nothing on screen says so, and the natural reaction to a white page is to
 * assume it is gone.
 *
 * Now the blast radius is one block. It renders a card at exactly the footprint
 * the block occupied — so nothing else on the board shifts — and everything
 * around it stays live and editable.
 *
 * WHY `unstable_catchError` AND NOT A HAND-ROLLED CLASS COMPONENT:
 * Next 16.2 ships this specifically so a boundary cooperates with the framework
 * rather than fighting it. A classic `componentDidCatch` boundary swallows the
 * control-flow errors that `redirect()` and `notFound()` throw internally, and
 * it has no way to re-run a Server Component. This one lets those through
 * untouched, clears itself on client navigation, and its `unstable_retry()`
 * genuinely re-renders the subtree instead of just flipping a `hasError` flag.
 */

interface BlockFallbackProps {
  /** Footprint of the block that failed, so the card stands exactly in its place. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shown so the user can say WHICH block broke when reporting it. */
  label?: string;
}

function BlockFallback(
  { x, y, width, height, label }: BlockFallbackProps,
  { error, unstable_retry }: ErrorInfo,
) {
  return (
    <div
      className="canvas-object absolute"
      style={{
        left: x,
        top: y,
        width,
        // A collapsed block would let its neighbours reflow around a hole, so
        // the card claims the same room the real one did — but a block can be
        // 20px tall, which is not enough to say anything in, hence the floor.
        height: Math.max(height, 96),
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
        padding: 14,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)',
        border: '1px dashed rgba(196, 85, 61, 0.45)',
        backdropFilter: 'blur(6px)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#C4553D' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" />
        </svg>
        {/* One template literal, not `This {label} couldn't render` as JSX
            children. The production build collapsed the space between the
            expression and the text that followed it, so the card shipped
            reading "This cardcouldn't render". Interpolating in JS puts the
            whole sentence in a single text node, where no transform can
            reflow it. */}
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {`This ${label || 'block'} couldn’t render`}
        </span>
      </div>

      {/* The reassurance is the most important line in this card. Everything
          else is diagnostics; THIS is what stops someone panicking about a
          board they think they just lost. */}
      <p style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
        The rest of your board is fine and still saved.
      </p>

      {error?.message && (
        <code
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-tertiary)',
            overflowWrap: 'anywhere',
            // Two lines of a stack message is orientation; twenty is a wall.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {error.message}
        </code>
      )}

      <button
        type="button"
        onClick={() => unstable_retry()}
        style={{
          alignSelf: 'flex-start',
          padding: '5px 11px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          color: 'var(--accent)',
          background: 'var(--accent-subtle)',
          border: '1px solid rgba(var(--accent-rgb), 0.22)',
        }}
      >
        Try again
      </button>
    </div>
  );
}

export default unstable_catchError(BlockFallback);
