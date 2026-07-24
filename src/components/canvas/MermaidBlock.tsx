'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { paperColor, isDarkColor, readableInk } from '@/lib/canvasTheme';

// NOTE: Tailwind p-*/m-* utilities are dead in this app (unlayered global
// reset), so every padding here is inline on purpose.

const TEMPLATES: { id: string; label: string; code: string }[] = [
  { id: 'flow', label: 'Flowchart', code: 'graph TD;\n  A[Idea] --> B{Worth doing?};\n  B -- Yes --> C[Build it];\n  B -- No --> D[Park it];\n  C --> E[Ship it];' },
  { id: 'sequence', label: 'Sequence', code: 'sequenceDiagram\n  participant U as User\n  participant A as App\n  participant S as Server\n  U->>A: Click save\n  A->>S: POST /save\n  S-->>A: 200 OK\n  A-->>U: Saved' },
  { id: 'state', label: 'State machine', code: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> Draft : changes\n  Review --> Published : approve\n  Published --> [*]' },
  { id: 'class', label: 'Class diagram', code: 'classDiagram\n  class Animal {\n    +String name\n    +makeSound()\n  }\n  class Dog {\n    +fetch()\n  }\n  Animal <|-- Dog' },
  { id: 'er', label: 'ER model', code: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  USER {\n    string name\n    string email\n  }' },
  { id: 'gantt', label: 'Gantt', code: 'gantt\n  title Launch plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design    :a1, 2026-07-22, 5d\n  Develop   :a2, after a1, 10d\n  section Ship\n  QA        :a3, after a2, 4d' },
  { id: 'pie', label: 'Pie', code: 'pie title Where the time goes\n  "Building" : 45\n  "Meetings" : 25\n  "Reviews" : 18\n  "Coffee" : 12' },
  { id: 'mindmap', label: 'Mind map', code: 'mindmap\n  root((the plan))\n    Ideas\n      Wild ones\n      Keepers\n    Next steps\n      This week\n      Someday' },
];

function TinyBtn({ onClick, title, children, disabled }: { onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--well)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
    >
      {children}
    </button>
  );
}

function Ic({ children, size = 12 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

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
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  // While editing, the live preview follows the draft, not the saved content.
  const [draft, setDraft] = useState(obj.content || '');
  const containerRef = useRef<HTMLDivElement>(null);

  // The diagram is baked into an SVG at render time, so it can't inherit the
  // theme through CSS like every other block — it has to be RE-RENDERED whenever
  // the canvas background changes. Without this the diagram kept whatever colors
  // it was first drawn with: black-on-white nodes sitting invisibly on dark paper.
  const canvasBackground = useCanvasStore((s) => s.canvasBackground);
  const paper = paperColor(canvasBackground);
  const dark = isDarkColor(paper);

  // Entering edit mode seeds the draft from the saved code.
  useEffect(() => {
    if (isEditing) setDraft(obj.content || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const source = isEditing ? draft : (obj.content || '');

  // Render the diagram — debounced while typing so the preview keeps up
  // without re-parsing on every keystroke.
  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      if (!source || source.trim() === '') {
        if (isMounted) { setSvgContent(''); setError(null); }
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
        const { svg } = await mermaid.render(id, source);

        if (isMounted) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          // Keep previous SVG if it exists, but show the error
          setError(err instanceof Error ? err.message : 'Syntax error in Mermaid diagram');
        }
      }
    };

    const t = setTimeout(renderDiagram, isEditing ? 350 : 0);
    return () => { isMounted = false; clearTimeout(t); };
  }, [source, obj.id, isEditing, paper, dark, canvasBackground.accent]);

  const updateObject = useCanvasStore.getState().updateObject;

  /** Swap in a template. In edit mode it must go through the DOM textarea +
   *  a native input event, because CanvasObject tracks the draft that way. */
  const applyTemplate = (code: string) => {
    if (isEditing && innerRef?.current) {
      const ta = innerRef.current;
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      setDraft(code);
      ta.focus();
    } else {
      updateObject(obj.id, { content: code });
    }
  };

  const startEditing = () => {
    useCanvasStore.getState().setSelectedId(obj.id);
    useCanvasStore.getState().setEditingId(obj.id);
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  const downloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const zoomIn = () => setZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));

  const templatePicker = (
    <select
      value=""
      onChange={(e) => {
        const tpl = TEMPLATES.find((t) => t.id === e.target.value);
        if (tpl) applyTemplate(tpl.code);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      title="Insert a template"
      className="h-6 rounded-md bg-[var(--well)] text-[10px] font-bold text-[var(--text-secondary)] outline-none cursor-pointer border border-transparent hover:border-[var(--border-strong)] shrink-0"
      style={{ padding: '0 6px', fontFamily: "'Outfit', sans-serif" }}
    >
      <option value="" disabled>Templates…</option>
      {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );

  /* ---------- EDIT MODE: split code editor + live preview ---------- */
  if (isEditing) {
    return (
      <div className="w-full h-full flex flex-col relative rounded-[20px] bg-[var(--bg-glass)] backdrop-blur-xl border border-[var(--border-strong)] shadow-xl overflow-hidden">
        <div
          className="flex items-center justify-between gap-2 border-b border-[var(--border)] shrink-0"
          style={{ padding: '7px 10px' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)] shrink-0">mermaid · editing</span>
            {templatePicker}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onBlur?.(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-6 rounded-full text-[10.5px] font-bold text-white flex items-center gap-1 transition-all active:scale-95 cursor-pointer shrink-0"
            style={{ background: 'var(--accent)', padding: '0 12px' }}
          >
            <Ic size={10}><polyline points="20 6 9 17 4 12" /></Ic>
            Done
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <textarea
            ref={innerRef}
            className="w-1/2 h-full resize-none outline-none bg-transparent text-[var(--text-primary)] font-mono text-[12px] custom-scrollbar border-r border-[var(--border)]"
            defaultValue={obj.content || ''}
            onChange={(e) => setDraft(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={'graph TD;\n  A-->B;'}
            spellCheck={false}
            style={{ whiteSpace: 'pre', lineHeight: '1.6', padding: 14 }}
          />
          <div className="w-1/2 h-full overflow-auto custom-scrollbar flex items-center justify-center" style={{ padding: 12 }}>
            {svgContent ? (
              <div
                dangerouslySetInnerHTML={{ __html: svgContent }}
                className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
                style={{ opacity: error ? 0.35 : 1, transition: 'opacity 0.2s' }}
              />
            ) : (
              <span className="text-[11px] text-[var(--text-muted)] text-center select-none">live preview appears here</span>
            )}
          </div>
        </div>

        {error && (
          <div
            className="shrink-0 text-[10px] font-mono text-red-500 bg-red-500/10 border-t border-red-500/20 overflow-x-auto whitespace-nowrap"
            style={{ padding: '5px 10px' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {error.split('\n')[0]}
          </div>
        )}
      </div>
    );
  }

  /* ---------- VIEW MODE: rendered diagram + hover toolbar ---------- */
  return (
    <div className="w-full h-full flex flex-col relative rounded-[20px] bg-[var(--bg-glass)] backdrop-blur-xl border border-[var(--border-strong)] shadow-xl overflow-hidden group">
      {/* Floating toolbar — shows on hover so the diagram stays clean */}
      <div
        className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-md"
          style={{ padding: 3 }}
        >
          {templatePicker}
          <TinyBtn onClick={startEditing} title="Edit code (or double-click)">
            <Ic><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></Ic>
          </TinyBtn>
        </div>

        <div
          className="flex items-center gap-0.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-md"
          style={{ padding: 3 }}
        >
          <TinyBtn onClick={zoomOut} title="Zoom out" disabled={zoom <= 0.5}>
            <Ic><circle cx="11" cy="11" r="7" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></Ic>
          </TinyBtn>
          <button
            onClick={(e) => { e.stopPropagation(); setZoom(1); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Reset zoom"
            className="text-[9.5px] font-extrabold tabular-nums text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            style={{ minWidth: 34, textAlign: 'center' }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <TinyBtn onClick={zoomIn} title="Zoom in" disabled={zoom >= 2.5}>
            <Ic><circle cx="11" cy="11" r="7" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></Ic>
          </TinyBtn>
          <span className="w-px h-4 bg-[var(--border)] shrink-0" style={{ margin: '0 2px' }} />
          <TinyBtn onClick={copyCode} title={copied ? 'Copied!' : 'Copy mermaid code'}>
            {copied
              ? <Ic><polyline points="20 6 9 17 4 12" /></Ic>
              : <Ic><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Ic>}
          </TinyBtn>
          <TinyBtn onClick={downloadSvg} title="Download SVG" disabled={!svgContent}>
            <Ic><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Ic>
          </TinyBtn>
        </div>
      </div>

      <div
        ref={containerRef}
        className="w-full h-full overflow-auto custom-scrollbar"
        style={{ padding: 24 }}
        onWheel={(e) => { if (zoom !== 1) e.stopPropagation(); }}
      >
        {error && !svgContent ? (
          <div className="text-red-500 text-xs font-mono bg-red-500/10 rounded-md border border-red-500/20 max-w-full overflow-auto text-left w-full" style={{ padding: 14 }}>
            <span className="font-bold block" style={{ marginBottom: 4 }}>Mermaid Syntax Error:</span>
            <pre className="whitespace-pre-wrap">{error}</pre>
          </div>
        ) : svgContent ? (
          <div
            dangerouslySetInnerHTML={{ __html: svgContent }}
            className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full transition-opacity duration-300 animate-fade-in"
            style={{ zoom }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 select-none text-center">
            <span className="text-[var(--text-tertiary)]"><Ic size={26}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Ic></span>
            <span className="text-[var(--text-tertiary)] text-sm font-medium">Double-click to write a diagram</span>
            <span className="text-[var(--text-muted)] text-[11px]">or hover and pick a template</span>
          </div>
        )}
      </div>
    </div>
  );
}
