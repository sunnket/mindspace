'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { CanvasObjectData } from '@/lib/db';

export default function MermaidBlock({
  obj,
  isEditing,
  onBlur,
  innerRef
}: {
  obj: CanvasObjectData;
  isEditing?: boolean;
  onBlur?: () => void;
  innerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize mermaid exactly once
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        fontFamily: "'Inter', sans-serif",
      },
    });
  }, []);

  // Render diagram when not editing
  useEffect(() => {
    let isMounted = true;
    
    const renderDiagram = async () => {
      if (!obj.content || obj.content.trim() === '') {
        setSvgContent('');
        setError(null);
        return;
      }
      
      try {
        // Use a unique but deterministic ID for the SVG
        const id = `mermaid-${obj.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        // Render the mermaid syntax
        const { svg } = await mermaid.render(id, obj.content);
        
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          // Keep previous SVG if it exists, but show error
          setError(err.message || 'Syntax error in Mermaid diagram');
        }
      }
    };
    
    if (!isEditing) {
      renderDiagram();
    }
  }, [obj.content, obj.id, isEditing]);

  return (
    <div className="w-full h-full flex flex-col relative rounded-[20px] bg-[var(--bg-glass)] backdrop-blur-xl border border-white/20 shadow-xl overflow-hidden group">
      {isEditing ? (
        <textarea
          ref={innerRef as any}
          className="w-full h-full resize-none outline-none bg-transparent text-[var(--text-primary)] font-mono text-[13px] p-5 custom-scrollbar"
          defaultValue={obj.content || ''}
          onBlur={onBlur}
          placeholder="graph TD;&#10;  A-->B;"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' }}
        />
      ) : (
        <div 
          ref={containerRef}
          className="w-full h-full flex items-center justify-center overflow-auto custom-scrollbar p-6"
        >
          {error ? (
            <div className="text-red-500 p-4 text-xs font-mono bg-red-500/10 rounded-md border border-red-500/20 max-w-full overflow-auto text-left w-full">
              <span className="font-bold mb-1 block">Mermaid Syntax Error:</span>
              <pre className="whitespace-pre-wrap">{error}</pre>
            </div>
          ) : svgContent ? (
            <div 
              dangerouslySetInnerHTML={{ __html: svgContent }} 
              className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full transition-opacity duration-300 animate-fade-in" 
            />
          ) : (
            <div className="text-[var(--text-tertiary)] text-sm font-medium select-none">
              Double click to add Mermaid code
            </div>
          )}
        </div>
      )}
    </div>
  );
}
