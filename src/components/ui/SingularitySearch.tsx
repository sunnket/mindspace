'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCanvasStore, resolveParentId } from '@/store/canvasStore';
import { CanvasObjectData, getAbsoluteAllObjects, getAllCanvasStates } from '@/lib/db';

/* ------------------------------------------------------------------ helpers */

const TYPE_LABEL: Record<string, string> = {
  text: 'Text', heading: 'Heading', sticky: 'Sticky note', card: 'Card',
  image: 'Image', shape: 'Shape', arrow: 'Arrow', frame: 'Frame',
  mirror: 'Camera', 'workflow-node': 'Node', browser: 'Web', pin: 'Pin', drawing: 'Sketch',
};
const TYPE_GLYPH: Record<string, string> = {
  text: 'T', heading: 'H', sticky: '▤', card: '▭', image: '❖', shape: '◆',
  arrow: '↗', frame: '▢', mirror: '◉', 'workflow-node': '⬡', browser: '◍', pin: '📍', drawing: '✎',
};
function typeLabel(t: string) { return TYPE_LABEL[t] || 'Block'; }
function typeGlyph(t: string) { return TYPE_GLYPH[t] || '•'; }

function snippetOf(o: CanvasObjectData): string {
  const raw = (o.content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw || typeLabel(o.type);
}
function searchText(o: CanvasObjectData): string {
  return `${o.content || ''} ${o.type} ${typeLabel(o.type)}`.toLowerCase();
}

interface Item { obj: CanvasObjectData; canvasKey: string; canvasName: string; isCross: boolean; }
interface PlacedItem extends Item { x: number; y: number; }

/* Non-overlapping radial packing. Chips spiral outward from just past the core,
   skipping the central search box and anything already placed — so the cluster
   stays compact and nothing ever stacks on top of another note. */
const CHIP = { cur: { w: 150, h: 34 }, cross: { w: 156, h: 50 } };
function packItems(items: Item[], cx: number, cy: number, vw: number, vh: number) {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: PlacedItem[] = [];
  let overflow = 0;
  const GAP = 10;
  const searchBox = { x: cx - 176, y: cy - 42, w: 352, h: 84 };
  const hit = (a: typeof searchBox, b: typeof searchBox) =>
    a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
  const inView = (b: typeof searchBox) => b.x >= 14 && b.y >= 70 && b.x + b.w <= vw - 14 && b.y + b.h <= vh - 82;

  for (const it of items) {
    const size = it.isCross ? CHIP.cross : CHIP.cur;
    let done = false;
    for (let ring = 0; ring < 60 && !done; ring++) {
      const r = 118 + ring * 30;
      const steps = Math.max(10, Math.round((2 * Math.PI * r) / (size.w * 0.55 + GAP)));
      const rot = ring * 0.6 + (it.isCross ? 0.3 : 0);
      for (let s = 0; s < steps; s++) {
        const a = -Math.PI / 2 + (s / steps) * Math.PI * 2 + rot;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.72;
        const box = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
        if (!inView(box) || hit(box, searchBox) || placed.some((p) => hit(box, p))) continue;
        placed.push(box);
        out.push({ ...it, x, y });
        done = true;
        break;
      }
    }
    if (!done) overflow++;
  }
  return { placed: out, overflow };
}

/* ---------------------------------------------------------- outer / gate */
export default function SingularitySearch() {
  const open = useCanvasStore((s) => s.singularityOpen);
  return (
    <AnimatePresence>
      {open && <SingularityWell key="singularity-well" />}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------- well */
function SingularityWell() {
  const setOpen = useCanvasStore((s) => s.setSingularityOpen);
  const objects = useCanvasStore((s) => s.objects);
  const urlCanvasId = useCanvasStore((s) => s.urlCanvasId);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const workspaceTitle = useCanvasStore((s) => s.workspaceTitle);
  const animateCamera = useCanvasStore((s) => s.animateCamera);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setPendingFocusId = useCanvasStore((s) => s.setPendingFocusId);

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [vp, setVp] = useState(() =>
    typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 1440, h: 900 }
  );
  const [dragging, setDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allObjects, setAllObjects] = useState<CanvasObjectData[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const currentKey = resolveParentId(canvasStack, urlCanvasId) ?? 'root';

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);

    let cancelled = false;
    (async () => {
      try {
        const [objs, states] = await Promise.all([getAbsoluteAllObjects(), getAllCanvasStates()]);
        if (cancelled) return;
        const map: Record<string, string> = { root: workspaceTitle || 'Home' };
        states.forEach((s) => { map[s.id] = s.title || 'Untitled canvas'; });
        setAllObjects(objs);
        setTitles(map);
      } catch { /* offline / empty — current-canvas search still works */ }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [setOpen, workspaceTitle]);

  // ---- matching (current first, then cross grouped-adjacent by canvas) ----
  const { items, otherTotal } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { items: [] as Item[], otherTotal: 0 };
    const words = q.split(/\s+/).filter(Boolean);
    const hit = (o: CanvasObjectData) => { const hay = searchText(o); return words.every((w) => hay.includes(w)); };
    const curName = titles[currentKey] || workspaceTitle || 'This canvas';

    const current: Item[] = objects
      .filter((o) => o.type !== 'drawing' && hit(o))
      .slice(0, 14)
      .map((o) => ({ obj: o, canvasKey: currentKey, canvasName: curName, isCross: false }));

    const byCanvas = new Map<string, Item[]>();
    let otherCount = 0;
    for (const o of allObjects) {
      if (o.type === 'drawing') continue;
      const key = o.parentId ?? 'root';
      if (key === currentKey) continue;
      if (!hit(o)) continue;
      otherCount++;
      const arr = byCanvas.get(key) || [];
      if (arr.length < 5) arr.push({ obj: o, canvasKey: key, canvasName: titles[key] || 'Untitled canvas', isCross: true });
      byCanvas.set(key, arr);
    }
    // Busiest canvases first; flatten so same-canvas chips pack next to each other.
    const cross: Item[] = [...byCanvas.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .flatMap(([, v]) => v)
      .slice(0, 16);

    return { items: [...current, ...cross], otherTotal: otherCount };
  }, [query, objects, allObjects, titles, currentKey, workspaceTitle]);

  const cx = vp.w / 2;
  const cy = vp.h / 2;
  const { placed, overflow } = useMemo(
    () => packItems(items, cx, cy, vp.w, vp.h),
    [items, cx, cy, vp.w, vp.h]
  );

  const currentShown = placed.filter((p) => !p.isCross).length;

  // ---- actions -----------------------------------------------------------
  const flyToCurrent = useCallback((o: CanvasObjectData) => {
    const zoom = 1;
    const tx = window.innerWidth / 2 - (o.x + o.width / 2) * zoom;
    const ty = window.innerHeight / 2 - (o.y + o.height / 2) * zoom;
    animateCamera({ x: tx, y: ty, zoom }, 750);
    setSelectedId(o.id);
    setTimeout(() => {
      const el = document.querySelector(`[data-object-id="${o.id}"]`);
      if (el) { el.classList.add('result-pulse'); setTimeout(() => el.classList.remove('result-pulse'), 4500); }
    }, 780);
  }, [animateCamera, setSelectedId]);

  const goToMatch = useCallback((m: Item) => {
    if (m.canvasKey === currentKey) {
      setOpen(false);
      flyToCurrent(m.obj);
    } else {
      setPendingFocusId(m.obj.id);
      setOpen(false);
      router.push(`/canvas?id=${m.canvasKey}`);
    }
  }, [currentKey, flyToCurrent, router, setOpen, setPendingFocusId]);

  const copyMatch = useCallback((m: Item) => {
    const text = (m.obj.content || '').trim() || snippetOf(m.obj);
    try { navigator.clipboard?.writeText(text); } catch { /* denied */ }
    setCopiedId(m.obj.id);
    setTimeout(() => setCopiedId((id) => (id === m.obj.id ? null : id)), 1100);
  }, []);

  const onChipMouseDown = useCallback((e: React.MouseEvent, m: Item) => {
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); copyMatch(m); }
  }, [copyMatch]);

  const onChipDragStart = useCallback((e: React.DragEvent, m: Item) => {
    const payload = {
      type: m.obj.type, content: m.obj.content || '',
      width: m.obj.width, height: m.obj.height,
      style: m.obj.style || {}, rotation: m.obj.rotation,
    };
    e.dataTransfer.setData('application/x-mindspace-object', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', (m.obj.content || '').trim() || snippetOf(m.obj));
    e.dataTransfer.effectAllowed = 'copy';
    setDragging(true);
  }, []);

  const onChipDragEnd = useCallback((e: React.DragEvent) => {
    setDragging(false);
    if (e.dataTransfer.dropEffect && e.dataTransfer.dropEffect !== 'none') setOpen(false);
  }, [setOpen]);

  const statusLine = query.trim()
    ? `${currentShown} here${otherTotal ? ` · ${otherTotal} on other canvases` : ''}`
    : 'Search across every canvas — the board stays live behind';

  return (
    <motion.div
      className={`singularity-overlay${dragging ? ' dragging' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: dragging ? 0.35 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="singularity-stars" aria-hidden />

      <div className="singularity-core-wrap" style={{ left: cx, top: cy }} aria-hidden>
        <motion.div className="singularity-ring r1" animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }} />
        <motion.div className="singularity-ring r2" animate={{ rotate: -360 }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }} />
        <motion.div className="singularity-ring r3" animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: 'linear' }} />
        <div className="singularity-core" />
        <motion.div
          className="singularity-pulse"
          key={query}
          initial={{ scale: 0.3, opacity: 0.5 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </div>

      <div className="singularity-search-wrap" style={{ left: cx, top: cy }}>
        <div className="singularity-search">
          <span className="singularity-search-icon">◍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across every canvas…"
            spellCheck={false}
            className="singularity-input"
          />
          <button className="singularity-close" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
        </div>
        <div className="singularity-status">{statusLine}</div>
      </div>

      {placed.map((m, i) => (
        <motion.div
          key={`${m.obj.id}-${m.isCross ? 'x' : 'c'}`}
          className="singularity-chip-wrap"
          style={{ left: m.x, top: m.y }}
          initial={{ opacity: 0, scale: 0.5, x: (m.x - cx) * 1.7, y: (m.y - cy) * 1.7 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.4 }}
          transition={{ type: 'spring', stiffness: 150, damping: 17, delay: Math.min(i * 0.022, 0.5) }}
        >
          <Chip
            item={m}
            copied={copiedId === m.obj.id}
            onGo={() => goToMatch(m)}
            onCopy={() => copyMatch(m)}
            onMouseDown={(e) => onChipMouseDown(e, m)}
            onDragStart={(e) => onChipDragStart(e, m)}
            onDragEnd={onChipDragEnd}
          />
        </motion.div>
      ))}

      {overflow > 0 && (
        <div className="singularity-more" style={{ left: cx, top: Math.min(cy + 300, vp.h - 60) }}>
          +{overflow} more — refine your search
        </div>
      )}

      {query.trim() && placed.length === 0 && (
        <div className="singularity-empty">Nothing orbits “{query.trim()}” yet</div>
      )}

      <div className="singularity-hint">
        <b>Click</b> to fly there · <b>Drag</b> onto the board to drop a copy · <b>Alt-click</b> or ⧉ to copy the text · <b>Esc</b> to close
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- one chip */
function Chip({
  item, copied, onGo, onCopy, onMouseDown, onDragStart, onDragEnd,
}: {
  item: Item; copied: boolean;
  onGo: () => void; onCopy: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const text = snippetOf(item.obj);
  return (
    <div
      className={`singularity-chip${item.isCross ? ' cross' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={onMouseDown}
      onClick={(e) => { if (!e.altKey) onGo(); }}
      title={item.isCross ? `${item.canvasName} — ${text}` : text}
    >
      {item.isCross && (
        <div className="sg-canvas" title={item.canvasName}><span className="dot" />{item.canvasName}</div>
      )}
      <div className="sg-row">
        <span className="singularity-chip-glyph">{typeGlyph(item.obj.type)}</span>
        <span className="singularity-chip-text">{text}</span>
        <button
          className="singularity-chip-copy"
          title="Copy text"
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
    </div>
  );
}
