'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
// Language grammars. Order matters — Prism grammars extend earlier ones.
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-json5';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-objectivec';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-solidity';
import 'prismjs/components/prism-hcl';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-apacheconf';
import 'prismjs/components/prism-http';
import 'prismjs/components/prism-properties';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-regex';
import 'prismjs/themes/prism-tomorrow.css';

import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import {
  RepoFile,
  RepoPayload,
  parseRepoPayload,
  ingestFolderPickerIntoBlock,
  ingestZipIntoBlock,
  ingestFsEntriesIntoBlock,
  collectDropEntries,
  hasDirectoryEntry,
  extOf,
} from '@/lib/repoIngest';

/* Padding/margins are inline throughout: the app's unlayered global reset
   (`* { padding:0; margin:0 }`) beats Tailwind's spacing utilities here. */

/* ------------------------------------------------------------------ *
 *  Language mapping (extension → Prism grammar + display + icon tint)
 * ------------------------------------------------------------------ */

interface LangInfo { grammar: string; label: string; tint: string }

const LANGS: Record<string, LangInfo> = {
  js: { grammar: 'javascript', label: 'JavaScript', tint: '#e8c14e' },
  mjs: { grammar: 'javascript', label: 'JavaScript', tint: '#e8c14e' },
  cjs: { grammar: 'javascript', label: 'JavaScript', tint: '#e8c14e' },
  jsx: { grammar: 'jsx', label: 'JSX', tint: '#5ccfe6' },
  ts: { grammar: 'typescript', label: 'TypeScript', tint: '#4a9fe8' },
  mts: { grammar: 'typescript', label: 'TypeScript', tint: '#4a9fe8' },
  cts: { grammar: 'typescript', label: 'TypeScript', tint: '#4a9fe8' },
  tsx: { grammar: 'tsx', label: 'TSX', tint: '#4a9fe8' },
  json: { grammar: 'json', label: 'JSON', tint: '#c99b57' },
  json5: { grammar: 'json5', label: 'JSON5', tint: '#c99b57' },
  jsonc: { grammar: 'json', label: 'JSON', tint: '#c99b57' },
  html: { grammar: 'markup', label: 'HTML', tint: '#e8734a' },
  htm: { grammar: 'markup', label: 'HTML', tint: '#e8734a' },
  xml: { grammar: 'markup', label: 'XML', tint: '#8bb36b' },
  svg: { grammar: 'markup', label: 'SVG', tint: '#e8b04a' },
  vue: { grammar: 'markup', label: 'Vue', tint: '#5fbf7f' },
  svelte: { grammar: 'markup', label: 'Svelte', tint: '#e8734a' },
  astro: { grammar: 'markup', label: 'Astro', tint: '#e8734a' },
  css: { grammar: 'css', label: 'CSS', tint: '#6b8fe8' },
  scss: { grammar: 'scss', label: 'SCSS', tint: '#cf6d97' },
  sass: { grammar: 'scss', label: 'Sass', tint: '#cf6d97' },
  less: { grammar: 'css', label: 'Less', tint: '#6b8fe8' },
  yaml: { grammar: 'yaml', label: 'YAML', tint: '#d97b7b' },
  yml: { grammar: 'yaml', label: 'YAML', tint: '#d97b7b' },
  md: { grammar: 'markdown', label: 'Markdown', tint: '#9aa4b2' },
  markdown: { grammar: 'markdown', label: 'Markdown', tint: '#9aa4b2' },
  mdx: { grammar: 'markdown', label: 'MDX', tint: '#9aa4b2' },
  py: { grammar: 'python', label: 'Python', tint: '#5fa9dd' },
  pyw: { grammar: 'python', label: 'Python', tint: '#5fa9dd' },
  java: { grammar: 'java', label: 'Java', tint: '#e07a4a' },
  c: { grammar: 'c', label: 'C', tint: '#7f9cc9' },
  h: { grammar: 'c', label: 'C Header', tint: '#7f9cc9' },
  cpp: { grammar: 'cpp', label: 'C++', tint: '#6b8fe8' },
  cc: { grammar: 'cpp', label: 'C++', tint: '#6b8fe8' },
  cxx: { grammar: 'cpp', label: 'C++', tint: '#6b8fe8' },
  hpp: { grammar: 'cpp', label: 'C++ Header', tint: '#6b8fe8' },
  m: { grammar: 'objectivec', label: 'Obj-C', tint: '#6b8fe8' },
  mm: { grammar: 'objectivec', label: 'Obj-C++', tint: '#6b8fe8' },
  cs: { grammar: 'csharp', label: 'C#', tint: '#6f9e5f' },
  go: { grammar: 'go', label: 'Go', tint: '#5ccfe6' },
  rs: { grammar: 'rust', label: 'Rust', tint: '#d99a6c' },
  rb: { grammar: 'ruby', label: 'Ruby', tint: '#d9584a' },
  php: { grammar: 'php', label: 'PHP', tint: '#8b8fd9' },
  sh: { grammar: 'bash', label: 'Shell', tint: '#8bbf6b' },
  bash: { grammar: 'bash', label: 'Bash', tint: '#8bbf6b' },
  zsh: { grammar: 'bash', label: 'Zsh', tint: '#8bbf6b' },
  fish: { grammar: 'bash', label: 'Fish', tint: '#8bbf6b' },
  sql: { grammar: 'sql', label: 'SQL', tint: '#c99b57' },
  kt: { grammar: 'kotlin', label: 'Kotlin', tint: '#b07fd9' },
  kts: { grammar: 'kotlin', label: 'Kotlin', tint: '#b07fd9' },
  swift: { grammar: 'swift', label: 'Swift', tint: '#e8734a' },
  dart: { grammar: 'dart', label: 'Dart', tint: '#5ccfe6' },
  graphql: { grammar: 'graphql', label: 'GraphQL', tint: '#d95f97' },
  gql: { grammar: 'graphql', label: 'GraphQL', tint: '#d95f97' },
  toml: { grammar: 'toml', label: 'TOML', tint: '#c99b57' },
  ini: { grammar: 'ini', label: 'INI', tint: '#9aa4b2' },
  cfg: { grammar: 'ini', label: 'Config', tint: '#9aa4b2' },
  conf: { grammar: 'ini', label: 'Config', tint: '#9aa4b2' },
  lua: { grammar: 'lua', label: 'Lua', tint: '#6b8fe8' },
  r: { grammar: 'r', label: 'R', tint: '#6b8fe8' },
  pl: { grammar: 'perl', label: 'Perl', tint: '#6b8fe8' },
  pm: { grammar: 'perl', label: 'Perl', tint: '#6b8fe8' },
  ps1: { grammar: 'powershell', label: 'PowerShell', tint: '#5ccfe6' },
  psm1: { grammar: 'powershell', label: 'PowerShell', tint: '#5ccfe6' },
  proto: { grammar: 'protobuf', label: 'Protobuf', tint: '#9aa4b2' },
  sol: { grammar: 'solidity', label: 'Solidity', tint: '#9aa4b2' },
  tf: { grammar: 'hcl', label: 'Terraform', tint: '#b07fd9' },
  hcl: { grammar: 'hcl', label: 'HCL', tint: '#b07fd9' },
  groovy: { grammar: 'groovy', label: 'Groovy', tint: '#5fbf9f' },
  gradle: { grammar: 'groovy', label: 'Gradle', tint: '#5fbf9f' },
  diff: { grammar: 'diff', label: 'Diff', tint: '#8bbf6b' },
  patch: { grammar: 'diff', label: 'Patch', tint: '#8bbf6b' },
  env: { grammar: 'bash', label: 'Env', tint: '#e8c14e' },
};

/** Special filenames without a useful extension. */
const FILENAME_LANG: Record<string, LangInfo> = {
  dockerfile: { grammar: 'docker', label: 'Dockerfile', tint: '#5ccfe6' },
  makefile: { grammar: 'makefile', label: 'Makefile', tint: '#d99a6c' },
  'cmakelists.txt': { grammar: 'clike', label: 'CMake', tint: '#9aa4b2' },
  '.gitignore': { grammar: 'bash', label: 'gitignore', tint: '#9aa4b2' },
  '.env': { grammar: 'bash', label: 'Env', tint: '#e8c14e' },
  '.npmrc': { grammar: 'ini', label: 'npmrc', tint: '#9aa4b2' },
  'nginx.conf': { grammar: 'nginx', label: 'Nginx', tint: '#5fbf7f' },
};

function langFor(path: string): LangInfo {
  const base = (path.split('/').pop() || '').toLowerCase();
  if (FILENAME_LANG[base]) return FILENAME_LANG[base];
  if (base.startsWith('.env')) return { grammar: 'bash', label: 'Env', tint: '#e8c14e' };
  const ext = extOf(path);
  return LANGS[ext] || { grammar: '', label: ext ? ext.toUpperCase() : 'Text', tint: '#9aa4b2' };
}

/* ------------------------------------------------------------------ *
 *  Tree model
 * ------------------------------------------------------------------ */

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
  file?: RepoFile;
}

function buildTree(files: RepoFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  const dirMap = new Map<string, TreeNode>([['', root]]);

  for (const f of files) {
    const parts = f.path.split('/');
    let curPath = '';
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLast = i === parts.length - 1;
      curPath = curPath ? `${curPath}/${seg}` : seg;
      if (isLast) {
        parent.children.push({ name: seg, path: curPath, dir: false, children: [], file: f });
      } else {
        let node = dirMap.get(curPath);
        if (!node) {
          node = { name: seg, path: curPath, dir: true, children: [] };
          dirMap.set(curPath, node);
          parent.children.push(node);
        }
        parent = node;
      }
    }
  }

  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function allDirPaths(node: TreeNode, out: string[] = []): string[] {
  for (const c of node.children) {
    if (c.dir) {
      out.push(c.path);
      allDirPaths(c, out);
    }
  }
  return out;
}

/** Ancestor folder paths of a file path (for auto-expanding to the selection). */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    out.push(cur);
  }
  return out;
}

/** A sensible file to open first: README → common entrypoints → first text file. */
function pickDefaultFile(files: RepoFile[]): string | null {
  const text = files.filter((f) => !f.binary && f.text != null);
  if (text.length === 0) return files[0]?.path ?? null;
  const byName = (re: RegExp) => text.find((f) => re.test(f.path));
  return (
    byName(/(^|\/)readme\.(md|markdown|txt)$/i) ||
    byName(/(^|\/)src\/(index|main|app)\.[a-z]+$/i) ||
    byName(/(^|\/)(index|main|app)\.[a-z]+$/i) ||
    byName(/(^|\/)package\.json$/i)
  )?.path ?? text[0].path;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function fmtBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ *
 *  Icons
 * ------------------------------------------------------------------ */

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c9a86b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {open
      ? <path d="M6 20 3.5 9.5A1 1 0 0 1 4.5 8.2H19a1 1 0 0 1 1 1.2L18 20a1 1 0 0 1-1 .8H7a1 1 0 0 1-1-.8Z M4 8V6a2 2 0 0 1 2-2h3l2 2h6a2 2 0 0 1 2 2v1" />
      : <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />}
  </svg>
);
const Dot = ({ c }: { c: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
  </svg>
);

/* ------------------------------------------------------------------ *
 *  Tree rows (recursive) — rows are <button>s so the canvas treats them
 *  as interactive (selects the card) instead of starting a drag.
 * ------------------------------------------------------------------ */

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function TreeRows({ node, depth, expanded, selected, onToggle, onSelect }: RowProps) {
  return (
    <>
      {node.children.map((child) => {
        if (child.dir) {
          const isOpen = expanded.has(child.path);
          return (
            <div key={child.path}>
              <button
                onClick={() => onToggle(child.path)}
                className="w-full flex items-center gap-1 text-left transition-colors"
                style={{ padding: '3px 8px', paddingLeft: 8 + depth * 12, color: '#c4c9d4' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: '#7c8494', display: 'flex', width: 10 }}><Chevron open={isOpen} /></span>
                <FolderIcon open={isOpen} />
                <span className="truncate" style={{ fontSize: 12.5 }}>{child.name}</span>
              </button>
              {isOpen && (
                <TreeRows node={child} depth={depth + 1} expanded={expanded} selected={selected} onToggle={onToggle} onSelect={onSelect} />
              )}
            </div>
          );
        }
        const info = langFor(child.path);
        const isSel = selected === child.path;
        return (
          <button
            key={child.path}
            onClick={() => onSelect(child.path)}
            className="w-full flex items-center gap-1.5 text-left transition-colors"
            style={{
              padding: '3px 8px',
              paddingLeft: 8 + depth * 12 + 14,
              background: isSel ? 'rgba(90,140,230,0.20)' : 'transparent',
              color: isSel ? '#eef2f8' : '#aeb4c0',
              boxShadow: isSel ? 'inset 2px 0 0 var(--accent, #5a8ce6)' : 'none',
            }}
            onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
            title={child.path}
          >
            <Dot c={child.file?.binary ? '#6b7180' : info.tint} />
            <span className="truncate" style={{ fontSize: 12.5 }}>{child.name}</span>
          </button>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Main block
 * ------------------------------------------------------------------ */

export default function RepoExplorerBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const rootRef = useRef<HTMLDivElement>(null);

  const style = obj.style || {};
  const status = (style.repoStatus as string) || (obj.content ? 'ready' : 'empty');
  const payload: RepoPayload | null = useMemo(() => parseRepoPayload(obj.content || ''), [obj.content]);

  // Stop wheel events from reaching the canvas' native (preventDefault) zoom
  // listener, so scrolling the tree / code scrolls the block instead of zooming.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop, { passive: true });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const patch = useCallback((kv: Record<string, unknown>) => {
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { style: { ...(live?.style || obj.style), ...kv } });
  }, [obj.id, obj.style, updateObject]);

  /* ---- folder / zip pickers ------------------------------------- */
  const openFolderPicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length) void ingestFolderPickerIntoBlock(obj.id, files);
    };
    input.click();
  }, [obj.id]);

  const openZipPicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void ingestZipIntoBlock(obj.id, file);
    };
    input.click();
  }, [obj.id]);

  /* ---- drop onto the block itself ------------------------------- */
  const [dragOver, setDragOver] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer;
    const entries = collectDropEntries(dt);
    if (hasDirectoryEntry(entries)) { void ingestFsEntriesIntoBlock(obj.id, entries); return; }
    const zip = Array.from(dt.files).find((f) => /\.zip$/i.test(f.name));
    if (zip) { void ingestZipIntoBlock(obj.id, zip); return; }
    if (dt.files.length > 0) { void ingestFolderPickerIntoBlock(obj.id, dt.files); }
  }, [obj.id]);

  /* ---- selection + expansion state ------------------------------ */
  const fullTree = useMemo(() => (payload ? buildTree(payload.files) : null), [payload]);

  const [selected, setSelected] = useState<string>((style.repoSelected as string) || '');
  const [expanded, setExpanded] = useState<Set<string>>(new Set((style.repoExpanded as string[]) || []));
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(Boolean(style.repoSidebarCollapsed));
  const initedRef = useRef<string>('');

  // First open of a freshly-loaded repo: choose a default file + expand to it.
  useEffect(() => {
    if (!payload || !fullTree) return;
    const key = `${obj.id}:${payload.meta.loadedAt}:${payload.files.length}`;
    if (initedRef.current === key) return;
    initedRef.current = key;

    const stored = (style.repoSelected as string) || '';
    const stillExists = stored && payload.files.some((f) => f.path === stored);
    const initial = stillExists ? stored : (pickDefaultFile(payload.files) || '');

    const exp = new Set<string>((style.repoExpanded as string[]) || []);
    ancestorsOf(initial).forEach((p) => exp.add(p));
    // Also open the top level so the repo doesn't look empty on first glance.
    fullTree.children.filter((c) => c.dir).slice(0, 8).forEach((c) => exp.add(c.path));

    setSelected(initial);
    setExpanded(exp);
    patch({ repoSelected: initial, repoExpanded: Array.from(exp) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, fullTree, obj.id]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      patch({ repoExpanded: Array.from(next) });
      return next;
    });
  }, [patch]);

  const selectFile = useCallback((path: string) => {
    setSelected(path);
    setCopied(false);
    patch({ repoSelected: path });
  }, [patch]);

  /* ---- search: filter tree by path, auto-expand matches --------- */
  const displayTree = useMemo(() => {
    if (!payload) return null;
    const q = query.trim().toLowerCase();
    if (!q) return fullTree;
    const matched = payload.files.filter((f) => f.path.toLowerCase().includes(q));
    return buildTree(matched);
  }, [payload, fullTree, query]);

  const displayExpanded = useMemo(() => {
    if (query.trim() && displayTree) return new Set(allDirPaths(displayTree));
    return expanded;
  }, [query, displayTree, expanded]);

  /* ---- selected file + highlighted html ------------------------- */
  const selFile = useMemo(
    () => payload?.files.find((f) => f.path === selected) || null,
    [payload, selected],
  );

  const info = selFile ? langFor(selFile.path) : null;

  const highlighted = useMemo(() => {
    if (!selFile || selFile.text == null) return '';
    const code = selFile.text;
    // Very large files: skip tokenizing to stay responsive.
    if (code.length > 120_000) return escapeHtml(code);
    const grammar = info && info.grammar && Prism.languages[info.grammar];
    if (!grammar) return escapeHtml(code);
    try {
      return Prism.highlight(code, grammar, info!.grammar);
    } catch {
      return escapeHtml(code);
    }
  }, [selFile, info]);

  const lineCount = useMemo(
    () => (selFile?.text ? selFile.text.split('\n').length : 0),
    [selFile],
  );

  const copyFile = useCallback(() => {
    if (!selFile?.text) return;
    navigator.clipboard?.writeText(selFile.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard blocked — ignore */ });
  }, [selFile]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const shell: React.CSSProperties = {
    fontFamily: "'Outfit', sans-serif",
    background: '#1b1e24',
    border: '1px solid rgba(255,255,255,0.10)',
  };

  /* ================================================================
     EMPTY / LOADING / ERROR states
     ================================================================ */
  if (status !== 'ready' || !payload) {
    const loading = status === 'loading';
    const errored = status === 'error';
    return (
      <div
        ref={rootRef}
        className="w-full h-full rounded-xl overflow-hidden flex flex-col items-center justify-center select-none pointer-events-auto shadow-2xl"
        style={{ ...shell, padding: 24, outline: dragOver ? '2px dashed var(--accent, #5a8ce6)' : 'none', outlineOffset: -6 }}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="rounded-full border-2 border-white/70 border-t-transparent animate-spin" style={{ width: 26, height: 26 }} />
            <div style={{ color: '#c4c9d4', fontSize: 13, fontWeight: 600 }}>Reading {(style.repoLoadingName as string) || 'files'}…</div>
            <div style={{ color: '#6b7180', fontSize: 11 }}>Indexing the tree and source</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center" style={{ maxWidth: 340 }}>
            <div className="flex items-center justify-center rounded-2xl" style={{ width: 54, height: 54, background: 'rgba(90,140,230,0.14)', border: '1px solid rgba(90,140,230,0.3)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7fa8ee" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /><path d="M8 13h8M8 16h5" /></svg>
            </div>
            <div>
              <div style={{ color: '#eef2f8', fontSize: 15, fontWeight: 700 }}>Code Repo</div>
              <div style={{ color: '#8b93a3', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
                Drop a project folder or a <b style={{ color: '#c4c9d4' }}>.zip</b> here to browse it like a code editor — file tree, syntax highlighting, search.
              </div>
              {errored && (
                <div style={{ color: '#e08b8b', fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>{(style.repoError as string) || 'Something went wrong.'}</div>
              )}
            </div>
            <div className="flex items-center gap-2" onMouseDown={stop}>
              <button onClick={openFolderPicker} className="flex items-center gap-1.5 rounded-lg cursor-pointer active:scale-95 transition-transform" style={{ padding: '9px 14px', background: 'var(--accent, #5a8ce6)', color: '#fff', fontSize: 12.5, fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /></svg>
                Open Folder
              </button>
              <button onClick={openZipPicker} className="flex items-center gap-1.5 rounded-lg cursor-pointer active:scale-95 transition-transform" style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.08)', color: '#c4c9d4', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12.5, fontWeight: 700 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></svg>
                Open .zip
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================
     READY — the explorer
     ================================================================ */
  const m = payload.meta;
  const notices: string[] = [];
  if (selFile?.truncated) notices.push('Truncated at 400 KB');
  if (selFile?.binary) notices.push('Binary file — not shown');
  if (selFile?.skipped) notices.push('Skipped (repo size cap reached)');

  return (
    <div
      ref={rootRef}
      className="w-full h-full rounded-xl overflow-hidden flex flex-col select-none pointer-events-auto shadow-2xl"
      style={shell}
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
    >
      {/* ---- Title bar (doubles as the card drag handle) ---- */}
      <div className="flex items-center gap-2 shrink-0" style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#16181d' }}>
        <div className="flex gap-1.5" style={{ marginRight: 2 }}>
          <div style={{ width: 9, height: 9, borderRadius: 99, background: '#ff5f56' }} />
          <div style={{ width: 9, height: 9, borderRadius: 99, background: '#ffbd2e' }} />
          <div style={{ width: 9, height: 9, borderRadius: 99, background: '#27c93f' }} />
        </div>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c9a86b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /></svg>
        <span className="truncate" style={{ color: '#eef2f8', fontSize: 12.5, fontWeight: 700 }} title={payload.name}>{payload.name}</span>
        <span style={{ color: '#6b7180', fontSize: 10.5 }}>{m.fileCount} files</span>
        <div className="flex items-center gap-1" style={{ marginLeft: 'auto' }} onMouseDown={stop}>
          <button onClick={() => { const v = !sidebarCollapsed; setSidebarCollapsed(v); patch({ repoSidebarCollapsed: v }); }} title={sidebarCollapsed ? 'Show file tree' : 'Hide file tree'} className="flex items-center justify-center rounded-md cursor-pointer transition-colors" style={{ width: 26, height: 24, color: '#8b93a3', background: 'rgba(255,255,255,0.04)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /></svg>
          </button>
          <button onClick={openFolderPicker} title="Load a different folder" className="flex items-center justify-center rounded-md cursor-pointer transition-colors" style={{ width: 26, height: 24, color: '#8b93a3', background: 'rgba(255,255,255,0.04)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" /></svg>
          </button>
        </div>
      </div>

      {/* ---- Body: sidebar + viewer ---- */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <div className="flex flex-col shrink-0" style={{ width: 210, borderRight: '1px solid rgba(255,255,255,0.08)', background: '#15171c' }} onMouseDown={stop}>
            <div style={{ padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.05)', padding: '5px 8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7180" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search files"
                  className="flex-1 min-w-0 bg-transparent outline-none"
                  style={{ color: '#c4c9d4', fontSize: 12 }}
                />
                {query && (
                  <button onClick={() => setQuery('')} className="cursor-pointer" style={{ color: '#6b7180' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar" style={{ padding: '4px 0' }}>
              {displayTree && displayTree.children.length > 0 ? (
                <TreeRows node={displayTree} depth={0} expanded={displayExpanded} selected={selected} onToggle={toggleDir} onSelect={selectFile} />
              ) : (
                <div style={{ color: '#6b7180', fontSize: 11.5, padding: '10px 12px' }}>No files match “{query}”.</div>
              )}
            </div>
          </div>
        )}

        {/* Viewer */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#1e2127' }} onMouseDown={stop}>
          {/* Breadcrumb + actions */}
          <div className="flex items-center gap-2 shrink-0" style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="flex-1 min-w-0 truncate" style={{ color: '#8b93a3', fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }} title={selected}>
              {selected ? selected.split('/').map((seg, i, arr) => (
                <span key={i}>
                  <span style={{ color: i === arr.length - 1 ? '#dfe4ec' : '#8b93a3' }}>{seg}</span>
                  {i < arr.length - 1 && <span style={{ color: '#565c68' }}> / </span>}
                </span>
              )) : 'Select a file'}
            </span>
            {info && <span className="shrink-0" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: info.tint, background: `${info.tint}1e`, border: `1px solid ${info.tint}33`, borderRadius: 5, padding: '2px 6px' }}>{info.label}</span>}
            {selFile?.text != null && (
              <button onClick={copyFile} title="Copy file contents" className="shrink-0 flex items-center gap-1 rounded-md cursor-pointer transition-colors" style={{ padding: '3px 8px', color: copied ? '#7fdca0' : '#8b93a3', background: 'rgba(255,255,255,0.05)', fontSize: 10.5, fontWeight: 700 }}>
                {copied
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {notices.length > 0 && (
            <div className="shrink-0" style={{ padding: '4px 12px', background: 'rgba(230,180,90,0.08)', color: '#d8b56a', fontSize: 10.5, borderBottom: '1px solid rgba(230,180,90,0.15)' }}>
              {notices.join(' · ')}
              {selFile?.binary && selFile.size ? ` · ${fmtBytes(selFile.size)}` : ''}
            </div>
          )}

          {/* Code */}
          <div className="flex-1 min-h-0 overflow-auto custom-scrollbar" style={{ background: '#1e2127' }}>
            {selFile && selFile.text != null ? (
              <div className="flex" style={{ minWidth: 'max-content', fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 12.5, lineHeight: '1.55' }}>
                <div
                  aria-hidden
                  style={{
                    position: 'sticky', left: 0, zIndex: 1, textAlign: 'right', userSelect: 'none',
                    padding: '10px 8px 10px 12px', color: '#565c68', background: '#1a1d22',
                    borderRight: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'pre',
                  }}
                >
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
                </div>
                <pre className="select-text" style={{ margin: 0, padding: '10px 16px', whiteSpace: 'pre', color: '#e6e9ef' }}>
                  <code
                    className={info?.grammar ? `language-${info.grammar}` : ''}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                </pre>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center" style={{ padding: 24 }}>
                {selFile?.binary ? (
                  <>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#565c68" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20" /></svg>
                    <div style={{ color: '#8b93a3', fontSize: 12.5 }}>Binary file — {fmtBytes(selFile.size) || 'not shown'}</div>
                  </>
                ) : (
                  <div style={{ color: '#6b7180', fontSize: 12.5 }}>{selected ? 'No preview available for this file.' : 'Pick a file from the tree to view it.'}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
