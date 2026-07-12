'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { paperColor, isDarkColor, readableInk } from '@/lib/canvasTheme';

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

  // The diagram is baked into an SVG at render time, so it can't inherit the
  // theme through CSS like every other block — it has to be RE-RENDERED whenever
  // the canvas background changes. Without this the diagram kept whatever colors
  // it was first drawn with: black-on-white nodes sitting invisibly on dark paper.
  const canvasBackground = useCanvasStore((s) => s.canvasBackground);
  const paper = paperColor(canvasBackground);
  const dark = isDarkColor(paper);

  // Render diagram when not editing, and again on every theme change.
  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      if (!obj.content || obj.content.trim() === '') {
        setSvgContent('');
        setError(null);
        return;
      }

      try {
        const ink = readableInk(paper);
        // Node surfaces are lifted off the paper rather than a fixed white/grey,
        // so the diagram reads as part of whatever canvas it's sitting on.
        const surface = dark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.92)';
        const line = dark ? 'rgba(244,239,232,0.45)' : 'rgba(45,42,38,0.35)';
        const accent = canvasBackground.accent || '#C97B4B';

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          darkMode: dark,
          themeVariables: {
            fontFamily: "'Inter', sans-serif",
            background: 'transparent',
            // Nodes
            primaryColor: surface,
            primaryTextColor: ink,
            primaryBorderColor: accent,
            secondaryColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            secondaryTextColor: ink,
            tertiaryColor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            tertiaryTextColor: ink,
            // Edges, arrows and their labels
            lineColor: line,
            textColor: ink,
            mainBkg: surface,
            nodeBorder: accent,
            nodeTextColor: ink,
            edgeLabelBackground: dark ? '#221F1C' : '#FFFDFA',
            // Clusters / subgraphs
            clusterBkg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            clusterBorder: line,
            titleColor: ink,
          },
        });

        // Re-key the SVG per theme so mermaid can't hand back a cached render.
        const id = `mermaid-${obj.id.replace(/[^a-zA-Z0-9]/g, '')}-${dark ? 'd' : 'l'}`;
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

    return () => { isMounted = false; };
  }, [obj.content, obj.id, isEditing, paper, dark, canvasBackground.accent]);

  return (
    <div className="w-full h-full flex flex-col relative rounded-[20px] bg-[var(--bg-glass)] backdrop-blur-xl border border-[var(--border-strong)] shadow-xl overflow-hidden group">
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
