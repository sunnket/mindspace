'use client';

import React, { useState, useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism-tomorrow.css';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

// NOTE: Tailwind p-*/m-* utilities are dead in this app (unlayered global
// reset) — paddings here are inline on purpose.

const LANGS: { id: string; label: string; ext: string }[] = [
  { id: 'javascript', label: 'JavaScript', ext: 'js' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts' },
  { id: 'jsx', label: 'JSX', ext: 'jsx' },
  { id: 'tsx', label: 'TSX', ext: 'tsx' },
  { id: 'python', label: 'Python', ext: 'py' },
  { id: 'markup', label: 'HTML', ext: 'html' },
  { id: 'css', label: 'CSS', ext: 'css' },
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'bash', label: 'Bash', ext: 'sh' },
  { id: 'sql', label: 'SQL', ext: 'sql' },
];

export default function CodeSandboxBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [code, setCode] = useState(obj.content || '');
  const [copied, setCopied] = useState(false);

  const lang = (obj.style?.codeLang as string) || 'javascript';
  const filename = (obj.style?.codeFilename as string) || '';

  useEffect(() => {
    setCode(obj.content || '');
  }, [obj.content]);

  const handleChange = (newCode: string) => {
    setCode(newCode);
    updateObject(obj.id, { content: newCode });
  };

  const patchStyle = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  const grammar = Prism.languages[lang] || Prism.languages.javascript;
  const lines = code === '' ? 0 : code.split('\n').length;
  const langMeta = LANGS.find((l) => l.id === lang);

  return (
    <div className="w-full h-full bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col border border-white/10 shadow-2xl">
      <div className="flex items-center gap-2 bg-white/5 border-b border-white/5 shrink-0" style={{ padding: '7px 12px' }}>
        <div className="flex gap-1.5 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
        </div>

        <input
          type="text"
          value={filename}
          placeholder={`untitled.${langMeta?.ext || 'js'}`}
          onChange={(e) => patchStyle({ codeFilename: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="flex-1 min-w-0 bg-transparent outline-none text-[11px] font-mono text-white/70 placeholder:text-white/25 cursor-text"
          style={{ marginLeft: 6 }}
        />

        <select
          value={lang}
          onChange={(e) => patchStyle({ codeLang: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title="Language"
          className="shrink-0 bg-white/10 hover:bg-white/15 rounded-md text-[9.5px] font-bold uppercase tracking-wider text-white/60 outline-none cursor-pointer border-0"
          style={{ padding: '3px 6px' }}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id} className="bg-[#1e1e1e] text-white">{l.label}</option>
          ))}
        </select>

        <button
          onClick={(e) => { e.stopPropagation(); copy(); }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          title={copied ? 'Copied!' : 'Copy code'}
          aria-label="Copy code"
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#27c93f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar" style={{ padding: 8 }}>
        <Editor
          value={code}
          onValueChange={handleChange}
          highlight={(c) => Prism.highlight(c, grammar, lang)}
          padding={10}
          style={{
            fontFamily: '"Fira Code", "JetBrains Mono", monospace',
            fontSize: 13,
            minHeight: '100%',
            backgroundColor: 'transparent',
          }}
          className="outline-none text-white"
        />
      </div>

      <div className="flex items-center justify-between bg-white/5 border-t border-white/5 shrink-0" style={{ padding: '4px 12px' }}>
        <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider">{langMeta?.label || lang}</span>
        <span className="text-[9px] font-mono text-white/30 tabular-nums">{lines} {lines === 1 ? 'line' : 'lines'}</span>
      </div>
    </div>
  );
}
