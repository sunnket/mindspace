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

/** A clean one-line gist of a block, or its type name when it holds no prose. */
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

interface Match { obj: CanvasObjectData; canvasKey: string; canvasName: string; }
interface Placed extends Match { x: number; y: number; angle: number; }
interface GroupCluster { key: string; name: string; items: Match[]; x: number; y: number; }

/* ---------------------------------------------------------- outer / gate
   The well only mounts while open, so every open starts fresh and closing it
   tears the state down for free — no reset effects, no stale query. */
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
  const [pulling, setPulling] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allObjects, setAllObjects] = useState<CanvasObjectData[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const currentKey = resolveParentId(canvasStack, urlCanvasId) ?? 'root';

  // ---- lifecycle: focus, load every canvas' objects, track viewport/Esc ----
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 260);
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
      } catch {
        /* offline / empty — current-canvas search still works from the store */
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [setOpen, workspaceTitle]);

  // ---- matching ----------------------------------------------------------
  const { current, groups, otherTotal } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { current: [] as Match[], groups: [] as Match[][], otherTotal: 0 };

    const words = q.split(/\s+/).filter(Boolean);
    const hit = (o: CanvasObjectData) => {
      const hay = searchText(o);
      return words.every((w) => hay.includes(w));
    };

    const cur: Match[] = objects
      .filter((o) => o.type !== 'drawing' && hit(o))
      .map((o) => ({ obj: o, canvasKey: currentKey, canvasName: titles[currentKey] || workspaceTitle || 'This canvas' }));

    const byCanvas = new Map<string, Match[]>();
    let otherCount = 0;
    for (const o of allObjects) {
      if (o.type === 'drawing') continue;
      const key = o.parentId ?? 'root';
      if (key === currentKey) continue;
      if (!hit(o)) continue;
      otherCount++;
      const arr = byCanvas.get(key) || [];
      if (arr.length < 4) arr.push({ obj: o, canvasKey: key, canvasName: titles[key] || 'Untitled canvas' });
      byCanvas.set(key, arr);
    }
    const grouped = [...byCanvas.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([, items]) => items);

    return { current: cur.slice(0, 16), groups: grouped, otherTotal: otherCount };
  }, [query, objects, allObjects, titles, currentKey, workspaceTitle]);

  // ---- radial layout -----------------------------------------------------
  const cx = vp.w / 2;
  const cy = vp.h / 2;

  const placedCurrent: Placed[] = useMemo(() => {
    const n = current.length;
    if (n === 0) return [];
    const rx = Math.min(vp.w * 0.32, 380);
    const ry = Math.min(vp.h * 0.30, 260);
    return current.map((m, i) => {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2 + (i % 2 ? 0.14 : -0.14);
      return { ...m, angle, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }, [current, cx, cy, vp.w, vp.h]);

  const clusters: GroupCluster[] = useMemo(() => {
    const n = groups.length;
    if (n === 0) return [];
    const rx = Math.min(vp.w * 0.40, 560);
    const ry = Math.min(vp.h * 0.40, 380);
    return groups.map((items, i) => {
      const angle = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
      return {
        key: items[0].canvasKey,
        name: items[0].canvasName,
        items,
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      };
    });
  }, [groups, cx, cy, vp.w, vp.h]);

  // ---- actions -----------------------------------------------------------
  const flyToCurrent = useCallback((o: CanvasObjectData) => {
    const zoom = 1;
    const tx = window.innerWidth / 2 - (o.x + o.width / 2) * zoom;
    const ty = window.innerHeight / 2 - (o.y + o.height / 2) * zoom;
    animateCamera({ x: tx, y: ty, zoom }, 750);
    setSelectedId(o.id);
    setTimeout(() => {
      const el = document.querySelector(`[data-object-id="${o.id}"]`);
      if (el) {
        el.classList.add('result-pulse');
        setTimeout(() => el.classList.remove('result-pulse'), 4500);
      }
    }, 780);
  }, [animateCamera, setSelectedId]);

  const goToMatch = useCallback((m: Match) => {
    if (m.canvasKey === currentKey) {
      setOpen(false);
      flyToCurrent(m.obj);
    } else {
      setPendingFocusId(m.obj.id);
      setOpen(false);
      router.push(`/canvas?id=${m.canvasKey}`);
    }
  }, [currentKey, flyToCurrent, router, setOpen, setPendingFocusId]);

  const copyMatch = useCallback((m: Match) => {
    const text = (m.obj.content || '').trim() || snippetOf(m.obj);
    try { navigator.clipboard?.writeText(text); } catch { /* denied */ }
    setCopiedId(m.obj.id);
    setTimeout(() => setCopiedId((id) => (id === m.obj.id ? null : id)), 1100);
  }, []);

  const onChipMouseDown = useCallback((e: React.MouseEvent, m: Match) => {
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); copyMatch(m); }
  }, [copyMatch]);

  const onChipDragStart = useCallback((e: React.DragEvent, m: Match) => {
    const payload = {
      type: m.obj.type, content: m.obj.content || '',
      width: m.obj.width, height: m.obj.height,
      style: m.obj.style || {}, rotation: m.obj.rotation,
    };
    e.dataTransfer.setData('application/x-mindspace-object', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', (m.obj.content || '').trim() || snippetOf(m.obj));
    e.dataTransfer.effectAllowed = 'copy';
    setPulling(true); // get out of the way so the CANVAS is the drop target
  }, []);

  const onChipDragEnd = useCallback((e: React.DragEvent) => {
    setPulling(false);
    if (e.dataTransfer.dropEffect && e.dataTransfer.dropEffect !== 'none') setOpen(false);
  }, [setOpen]);

  const statusLine = query.trim()
    ? `${current.length} here${otherTotal ? ` · ${otherTotal} across ${clusters.length}${groups.length === 6 ? '+' : ''} other canvas${clusters.length === 1 ? '' : 'es'}` : ''}`
    : 'Type to pull matching thoughts out of the void';

  return (
    <motion.div
      className="singularity-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: pulling ? 0.08 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{ pointerEvents: pulling ? 'none' : 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="singularity-stars" aria-hidden />

      {/* the core — accretion rings + event horizon */}
      <div className="singularity-core-wrap" style={{ left: cx, top: cy }} aria-hidden>
        <motion.div className="singularity-ring r1" animate={{ rotate: 360 }} transition={{ duration: 26, repeat: Infinity, ease: 'linear' }} />
        <motion.div className="singularity-ring r2" animate={{ rotate: -360 }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }} />
        <motion.div className="singularity-ring r3" animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: 'linear' }} />
        <div className="singularity-core" />
        <motion.div
          className="singularity-pulse"
          key={query}
          initial={{ scale: 0.2, opacity: 0.6 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </div>

      {/* search bar over the core */}
      <div className="singularity-search-wrap" style={{ left: cx, top: cy }} onMouseDown={(e) => e.stopPropagation()}>
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

      {/* cross-canvas clusters */}
      {clusters.map((g, gi) => (
        <motion.div
          key={g.key}
          className="singularity-cluster"
          style={{ left: g.x, top: g.y }}
          initial={{ opacity: 0, scale: 0.7, x: (g.x - cx) * 1.6, y: (g.y - cy) * 1.6 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.7 }}
          transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.05 + gi * 0.05 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="singularity-cluster-name" title={g.name}>
            <span className="singularity-cluster-dot" />
            {g.name}
          </div>
          <div className="singularity-cluster-items">
            {g.items.map((m) => (
              <Chip
                key={m.obj.id}
                m={m}
                faint
                copied={copiedId === m.obj.id}
                onGo={() => goToMatch(m)}
                onCopy={() => copyMatch(m)}
                onMouseDown={(e) => onChipMouseDown(e, m)}
                onDragStart={(e) => onChipDragStart(e, m)}
                onDragEnd={onChipDragEnd}
              />
            ))}
          </div>
        </motion.div>
      ))}

      {/* current-canvas matches orbiting the core */}
      {placedCurrent.map((m, i) => (
        <motion.div
          key={m.obj.id}
          className="singularity-orbit-chip"
          style={{ left: m.x, top: m.y }}
          initial={{ opacity: 0, scale: 0.5, x: Math.cos(m.angle) * 900, y: Math.sin(m.angle) * 900 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.4 }}
          transition={{ type: 'spring', stiffness: 140, damping: 16, delay: i * 0.03 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Chip
            m={m}
            copied={copiedId === m.obj.id}
            onGo={() => goToMatch(m)}
            onCopy={() => copyMatch(m)}
            onMouseDown={(e) => onChipMouseDown(e, m)}
            onDragStart={(e) => onChipDragStart(e, m)}
            onDragEnd={onChipDragEnd}
          />
        </motion.div>
      ))}

      {query.trim() && current.length === 0 && clusters.length === 0 && (
        <div className="singularity-empty">Nothing orbits “{query.trim()}” yet</div>
      )}

      <div className="singularity-hint">
        <b>Click</b> to fly there · <b>Drag</b> onto the board to copy it in · <b>Alt-click</b> or ⧉ to copy the text
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- one chip */
function Chip({
  m, faint, copied, onGo, onCopy, onMouseDown, onDragStart, onDragEnd,
}: {
  m: Match; faint?: boolean; copied: boolean;
  onGo: () => void; onCopy: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const text = snippetOf(m.obj);
  return (
    <div
      className={`singularity-chip${faint ? ' faint' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={onMouseDown}
      onClick={(e) => { if (!e.altKey) onGo(); }}
      title={text}
    >
      <span className="singularity-chip-glyph">{typeGlyph(m.obj.type)}</span>
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
  );
}
