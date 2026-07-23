'use client';

import React, { useMemo } from 'react';
import { inkCharStyle, INK_NEUTRAL } from '@/lib/typingInk';

/**
 * Renders text with its typing-rhythm baked in — each character carries the
 * weight and jitter of the speed it was written at (see lib/typingInk). Words
 * stay whole (per-char inline-blocks inside a nowrap word span) so lines still
 * wrap naturally at spaces; only the letters themselves tilt and bounce.
 *
 * Deliberately NOT markdown — an ink note is raw, expressive handwriting-energy,
 * so it renders the literal characters. The block already sets the ink font,
 * color and size; this only adds per-character weight + transform.
 */
function InkTextImpl({ content, rhythm }: { content: string; rhythm?: number[] }) {
  const lines = useMemo(() => content.split('\n'), [content]);

  // Running character index across the whole block so the rhythm array and the
  // stable per-index jitter line up with the actual characters.
  let ci = 0;

  return (
    <span className="ink-text" style={{ display: 'inline' }}>
      {lines.map((line, li) => {
        // Split into runs of non-space and space so we can keep words unbroken
        // while still letting the line wrap at the spaces between them.
        const tokens = line.match(/\s+|\S+/g) || [];
        const lineNodes = tokens.map((tok, ti) => {
          if (/^\s+$/.test(tok)) {
            ci += tok.length;
            // Preserve the spaces' width; no transform needed on whitespace.
            return <span key={`s${li}-${ti}`} style={{ whiteSpace: 'pre' }}>{tok}</span>;
          }
          const chars = Array.from(tok);
          const word = (
            <span key={`w${li}-${ti}`} style={{ whiteSpace: 'nowrap' }}>
              {chars.map((ch, k) => {
                const idx = ci + k;
                const intensity = rhythm && idx < rhythm.length ? rhythm[idx] : INK_NEUTRAL;
                const s = inkCharStyle(intensity, idx);
                return (
                  <span
                    key={k}
                    style={{
                      display: 'inline-block',
                      fontWeight: s.fontWeight,
                      transform: `translateY(${s.dy}px) rotate(${s.rotate}deg)`,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          );
          ci += chars.length;
          return word;
        });
        ci += 1; // the '\n' that split() removed
        return (
          <React.Fragment key={`l${li}`}>
            {lineNodes}
            {li < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </span>
  );
}

const InkText = React.memo(InkTextImpl);
export default InkText;
