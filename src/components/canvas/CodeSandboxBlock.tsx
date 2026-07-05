'use client';

import React, { useState, useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/themes/prism-tomorrow.css';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';

export default function CodeSandboxBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [code, setCode] = useState(obj.content || '');

  useEffect(() => {
    setCode(obj.content || '');
  }, [obj.content]);

  const handleChange = (newCode: string) => {
    setCode(newCode);
    updateObject(obj.id, { content: newCode });
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
        </div>
        <div className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
          Sandbox
        </div>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar p-2">
        <Editor
          value={code}
          onValueChange={handleChange}
          highlight={(code) => Prism.highlight(code, Prism.languages.javascript, 'javascript')}
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
    </div>
  );
}
