'use client';

import React, { useEffect } from 'react';
import { CanvasObjectData } from '@/lib/db';
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

  // The Animate button in the SelectionPanel already wrote a config to
  // style.textAnim for quotes — but this block rendered its text raw, so the
  // effect never played. When not editing and a preset is set, route the text
  // through the same AnimatedText engine every other text block uses.
  const anim = obj.style?.textAnim;
  const animated = !isEditing && !!resolveAnim(anim)?.preset;

  const textStyle: React.CSSProperties = {
    fontFamily: (obj.style?.fontFamily as string) || "'Lora', serif",
    fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '24px',
    padding: '0 8px',
  };

  return (
    // Tailwind padding utilities are dead in this app (unlayered global reset) — inline padding
    <div className="w-full h-full flex flex-col items-center justify-center text-center" style={{ padding: 28 }}>
      <div className="relative max-w-full">
        <span className="absolute -top-8 -left-6 text-6xl text-[var(--accent)] opacity-20 font-serif leading-none select-none">“</span>
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
        <span className="absolute -bottom-10 -right-6 text-6xl text-[var(--accent)] opacity-20 font-serif leading-none select-none">”</span>
      </div>
    </div>
  );
}
