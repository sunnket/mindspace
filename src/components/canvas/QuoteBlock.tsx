'use client';

import React, { useEffect } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import AnimatedText from './AnimatedText';
import { resolveAnim } from '@/lib/textAnim';

export default function QuoteBlock({ obj, isEditing, onBlur, innerRef }: {
  obj: CanvasObjectData;
  isEditing: boolean;
  onBlur: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (innerRef.current && !isEditing) {
      innerRef.current.innerText = obj.content || '';
    }
  }, [obj.content, isEditing, innerRef]);

  // The Animate button in the properties rail already wrote a config to
  // style.textAnim for quotes — but this block rendered its text raw, so the
  // effect never played. When not editing and a preset is set, route the text
  // through the same AnimatedText engine every other text block uses.
  const anim = obj.style?.textAnim;
  const animated = !isEditing && !!resolveAnim(anim)?.preset;

  const updateObject = useCanvasStore((s) => s.updateObject);
  const author = (obj.style?.quoteAuthor as string | undefined) || '';

  const textStyle: React.CSSProperties = {
    fontFamily: (obj.style?.fontFamily as string) || "'Lora', serif",
    fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '24px',
    padding: '0 8px',
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center" style={{ padding: 28 }}>
      <div className="relative max-w-full">
        {/* The marks were `--accent` at 20% — a mid brown at a fifth
            strength, which on the dark board came out as two faint
            thumbprints and on paper as almost nothing. They are ornament,
            so they should stay quiet, but ornament you cannot see is just
            an alignment bug. They also sat at -top-8 against -bottom-10,
            which is why the closing mark looked like it had come loose. */}
        <span className="absolute -top-8 -left-6 text-6xl text-[var(--text-tertiary)] opacity-55 font-serif leading-none select-none" aria-hidden="true">“</span>
        {animated ? (
          <div
            className="text-2xl font-light italic leading-relaxed text-[var(--text-primary)] min-w-[20px] whitespace-pre-wrap break-words"
            style={textStyle}
          >
            <AnimatedText content={obj.content || ''} anim={anim}>
              {obj.content || ''}
            </AnimatedText>
          </div>
        ) : (
          <div
            ref={innerRef}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={onBlur}
            className="text-2xl font-light italic leading-relaxed text-[var(--text-primary)] outline-none min-w-[20px]"
            style={textStyle}
            data-placeholder="Your wisdom here..."
          />
        )}
        <span className="absolute -bottom-8 -right-6 text-6xl text-[var(--text-tertiary)] opacity-55 font-serif leading-none select-none" aria-hidden="true">”</span>
      </div>

      {/* Who said it.

          The insert menu has always described this block as "Set a line
          apart, with attribution" and there was nowhere to put a name —
          the block rendered the sentence and stopped. An em-dash and a
          small-caps line is the convention, and it stays out of the way
          until someone clicks it. */}
      <div
        contentEditable
        suppressContentEditableWarning
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const next = e.currentTarget.innerText.replace(/^\s*—\s*/, '').trim();
          if (next !== author) updateObject(obj.id, { style: { ...obj.style, quoteAuthor: next } });
        }}
        data-placeholder="Attribute this"
        aria-label="Attribution"
        className="quote-attribution outline-none text-[13px] font-medium tracking-wide text-[var(--text-tertiary)] cursor-text"
        style={{ marginTop: 18 }}
        suppressHydrationWarning
      >
        {author ? `— ${author}` : ''}
      </div>
    </div>
  );
}
