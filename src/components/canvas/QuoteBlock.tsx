'use client';

import React, { useEffect } from 'react';
import { CanvasObjectData } from '@/lib/db';

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

  return (
    // Tailwind padding utilities are dead in this app (unlayered global reset) — inline padding
    <div className="w-full h-full flex flex-col items-center justify-center text-center" style={{ padding: 28 }}>
      <div className="relative max-w-full">
        <span className="absolute -top-8 -left-6 text-6xl text-[var(--accent)] opacity-20 font-serif leading-none select-none">“</span>
        <div
          ref={innerRef}
          contentEditable={isEditing}
          suppressContentEditableWarning
          onBlur={onBlur}
          className="text-2xl font-light italic leading-relaxed text-[var(--text-primary)] outline-none min-w-[20px]"
          style={{
            fontFamily: (obj.style?.fontFamily as string) || "'Lora', serif",
            fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '24px',
            padding: '0 8px',
          }}
          data-placeholder="Your wisdom here..."
        />
        <span className="absolute -bottom-10 -right-6 text-6xl text-[var(--accent)] opacity-20 font-serif leading-none select-none">”</span>
      </div>
    </div>
  );
}
