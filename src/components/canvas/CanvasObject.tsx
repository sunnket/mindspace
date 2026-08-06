'use client';

import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useCollabStore } from '@/store/collabStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, isAutoCleanable } from '@/store/canvasStore';
import { useVoiceStore } from '@/store/voiceStore';
import { CanvasObjectData } from '@/lib/db';
import { getSnapPoints, randomStickyColor, dragState, endActiveDrag } from '@/lib/utils';
import { ensureReadableInk, readableInk, paperColor } from '@/lib/canvasTheme';
import { reportMeasuredHeight, forgetMeasuredHeight } from '@/lib/canvasLayout';
import { isUrl, newLinkCard } from '@/lib/linkPreview';
import VoiceNoteBlock from './VoiceNoteBlock';
import FileBlock from './FileBlock';
import ImageStudio from './ImageStudio';
import MapBlock from './MapBlock';
import WeatherBlock from './WeatherBlock';
import RichText from './RichText';
import InkText from './InkText';
import AnimatedText from './AnimatedText';
import TextPathBlock from './TextPathBlock';
import { useFlowStore } from '@/store/flowStore';
import { INK_FONT, intervalToIntensity, foldRhythm } from '@/lib/typingInk';
import QuoteBlock from './QuoteBlock';
import CalloutBlock from './CalloutBlock';
import EmbedBlock from './EmbedBlock';
import GitHubBlock from './GitHubBlock';
import TodoBlock from './TodoBlock';
import LinkPreviewBlock from './LinkPreviewBlock';
import { CountdownBlock, PollBlock, LiveMetricBlock, QuickDataBlock, FocusTimerBlock, DecisionBlock, ProgressBlock, ChartBlock, TimelineBlock, TableBlock } from './ExtensionBlocks';
import RoadmapBlock from './RoadmapBlock';
import WhiteboardBlock from './WhiteboardBlock';
import BinderBlock from './BinderBlock';
import MirrorBlock from './MirrorBlock';
import SemanticGist from './SemanticGist';
import { semanticView } from '@/lib/semanticZoom';
import { stackSlots, stackTargetAt, membersOf, isStackable } from '@/lib/stacks';
import { createPortal } from 'react-dom';
import { ImageShape, imageShapeStyle, nextImageShape, IMAGE_SHAPE_LABEL } from '@/lib/imageShapes';
import { adjustToFilter, type ImageAdjust } from '@/lib/image/pixels';
import { getFrameKind, frameColorOf, frameKindMeta, objectsInFrame, type FrameKind } from '@/lib/frames';
import { PIN_COLORS, pinShade, DEFAULT_PIN_COLOR } from '@/lib/brainstorm';

/* ------------------------------------------------------------------
   Three block types drag in a syntax-highlighter or a diagram engine, and
   every one of them was a plain top-level import — so `mermaid` (the single
   biggest dependency in the app) and `prismjs` were parsed and executed on
   every board, including the overwhelming majority that contain no diagram
   and no code. That was ~600KB of JavaScript standing between opening a
   canvas and seeing it.

   Loading them at the point of use costs nothing when they aren't used, and
   a few hundred milliseconds behind a skeleton when they are. `ssr: false`
   because all three touch the DOM on mount, which is also what they already
   did — they just did it after blocking everyone else's paint.
   ------------------------------------------------------------------ */
const BlockFallback = ({ label }: { label: string }) => (
  <div
    className="w-full h-full flex items-center justify-center text-[11px] font-semibold"
    style={{ color: 'var(--text-tertiary)' }}
  >
    {label}
  </div>
);

const MermaidBlock = dynamic(() => import('./MermaidBlock'), {
  ssr: false,
  loading: () => <BlockFallback label="Diagram…" />,
});
const CodeSandboxBlock = dynamic(() => import('./CodeSandboxBlock'), {
  ssr: false,
  loading: () => <BlockFallback label="Code…" />,
});
const RepoExplorerBlock = dynamic(() => import('./RepoExplorerBlock'), {
  ssr: false,
  loading: () => <BlockFallback label="Repository…" />,
});

/** The mark on a frame's title tab that says what kind of region it is. */
function FrameKindGlyph({ kind }: { kind: FrameKind }) {
  const common = {
    width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2.4,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true, className: 'shrink-0',
  };
  if (kind === 'delete') {
    return <svg {...common}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
  }
  if (kind === 'scene') {
    return <svg {...common}><rect x="2" y="4" width="20" height="16" rx="2" /><line x1="7" y1="4" x2="7" y2="20" /><line x1="17" y1="4" x2="17" y2="20" /></svg>;
  }
  if (kind === 'agent') {
    return <svg {...common}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4.5" /></svg>;
  }
  return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
}

/**
 * The DOM range at a viewport point. Two engines, two spellings: Firefox ships
 * the standard `caretPositionFromPoint`, WebKit/Blink the older
 * `caretRangeFromPoint`. Returns null when the point hits no text.
 */
function caretRangeFromPoint(clientX: number, clientY: number): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (!pos?.offsetNode) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
      return doc.caretRangeFromPoint(clientX, clientY);
    }
  } catch {
    /* offset out of range for the node under the cursor — fall back to end */
  }
  return null;
}

/**
 * A drag has to end even if something between the object and the window calls
 * stopPropagation on mouseup — listening in the capture phase runs us before
 * any of them, so an object can never get stuck to the cursor.
 */
const END_DRAG = { capture: true } as const;

/** The column a free text block wraps at. The box grows out to it as you type;
 *  it never starts there. Kept in sync with the width InfiniteCanvas seeds. */
const TEXT_WRAP_WIDTH = 900;
/** Matches .text-block-editable's min-width so an empty box still has a caret. */
const TEXT_MIN_WIDTH = 100;

function isDictationTarget(id: string): boolean {
  const voice = useVoiceStore.getState();
  return voice.isListening && voice.targetId === id;
}

// ---- Embedded browser helpers --------------------------------------------
interface BrowserTab {
  id: string;
  url: string;
  title?: string;
}

const BROWSER_DEFAULT_URL = 'https://www.wikipedia.org';

/** Normalise whatever the user typed into a navigable https URL or a search. */
function normalizeBrowserUrl(raw: string): string {
  const val = raw.trim();
  if (!val) return '';
  if (/^https?:\/\//i.test(val)) return val;
  if (!val.includes(' ') && /^[^\s.]+\.[^\s]+/.test(val)) return 'https://' + val;
  // Google and DuckDuckGo both block proxied/automated traffic (DDG shows an
  // "anomaly" page). Bing tolerates it and returns clean, clickable results.
  return 'https://www.bing.com/search?q=' + encodeURIComponent(val);
}

/** Read tabs from the object's style, falling back to a single tab from content. */
function readBrowserTabs(obj: CanvasObjectData): { tabs: BrowserTab[]; activeId: string } {
  const style = obj.style || {};
  const raw = style.tabs as BrowserTab[] | undefined;
  if (raw && raw.length) {
    const active = style.activeTab as string | undefined;
    const activeId = active && raw.some((t) => t.id === active) ? active : raw[0].id;
    return { tabs: raw, activeId };
  }
  const id = 't-' + obj.id;
  return { tabs: [{ id, url: obj.content || BROWSER_DEFAULT_URL, title: '' }], activeId: id };
}

function browserTabLabel(tab: BrowserTab): string {
  if (tab.title) return tab.title;
  if (!tab.url) return 'New Tab';
  try {
    return new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    return tab.url.slice(0, 30);
  }
}

interface BrowserExtract {
  images?: { src: string; w: number; h: number }[];
  texts?: string[];
}

/**
 * What the <iframe> should actually load. Some sites have a dedicated embed
 * surface that frames cleanly while their normal page refuses to — YouTube is
 * the one that matters, and a watch link is exactly what people paste.
 */
function frameSrc(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        if (id) return `https://www.youtube.com/embed/${id}`;
      }
      const short = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (short) return `https://www.youtube.com/embed/${short[1]}`;
    }
  } catch {
    /* not a parseable URL — hand it to the frame as-is */
  }
  return url;
}

interface BrowserViewProps {
  id: string;
  url: string;
  /** Bumped by the toolbar's reload button — remounts the frame. */
  reloadKey: number;
  onLoading: (tabId: string, loading: boolean) => void;
}

/**
 * A real <iframe>. The page runs in the user's own browser: scrolling, typing,
 * video and clicks are all native, so there is no round trip and nothing to
 * repaint. What we lose is what an iframe can never give us cross-origin — we
 * can't read the address as the user clicks around inside the page, so the
 * address bar tracks only the navigations WE make (see the per-tab history in
 * the block below).
 *
 * Sites that refuse to be framed (X-Frame-Options / CSP frame-ancestors) would
 * otherwise just render an eternally blank white box, so we ask the server up
 * front and say so plainly instead.
 */
function BrowserView({ id, url, reloadKey, onLoading }: BrowserViewProps) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const src = frameSrc(url);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setBlocked(null);
    onLoading(id, true);

    fetch(`/api/browser?action=check&url=${encodeURIComponent(src)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d && d.embeddable === false) {
          setBlocked(d.reason || 'This site refuses to be embedded.');
          onLoading(id, false);
        }
      })
      .catch(() => {
        /* Can't reach it from the server — still let the frame try. */
      });

    return () => { cancelled = true; };
  }, [src, url, id, reloadKey, onLoading]);

  if (blocked) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-50 px-8 text-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className="text-sm font-semibold text-neutral-700">This page won&apos;t open in a frame</span>
        <span className="text-[11px] text-neutral-500 max-w-[85%] leading-relaxed">{blocked}</span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => window.open(url, '_blank', 'noopener')}
          className="mt-1 px-3.5 py-1.5 rounded-full bg-white border border-neutral-200 text-xs font-semibold text-neutral-700 hover:border-blue-400 hover:text-blue-600 shadow-sm"
        >
          Open in a new tab ↗
        </button>
        <span className="text-[10px] text-neutral-400">
          You can still pull its images &amp; text onto the canvas with the extract button.
        </span>
      </div>
    );
  }

  return (
    <iframe
      key={`${src}#${reloadKey}`}
      src={src}
      title={id}
      className="absolute inset-0 w-full h-full border-none bg-white"
      referrerPolicy="no-referrer"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      onLoad={() => onLoading(id, false)}
    />
  );
}


/**
 * A sticky note pinned beside a block.
 *
 * The old one was a hand-drawn SVG speech balloon with `fill="white"` baked in
 * and its text painted in `--text-secondary` — which flips to near-white on a
 * dark canvas, so the comment you'd just typed disappeared into its own bubble.
 * The layout was Tailwind padding classes (`px-6 pb-5`), all of which are dead
 * under this app's unlayered `* { padding: 0 }` reset, so the text ran flush to
 * the balloon's edge and under its tail. And it hung over the board forever
 * whether you were looking at that block or not.
 *
 * It's a real card now: theme surface, theme ink, inline padding, and it shows
 * only while you're actually on the block (or writing in it).
 */
interface CommentBubbleProps {
  obj: CanvasObjectData;
  isEditing: boolean;
  /** The parent block is hovered/selected — otherwise the note stays out of sight. */
  visible: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
}

function CommentBubble({ obj, isEditing, visible, onStartEditing, onStopEditing }: CommentBubbleProps) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const camera = useCanvasStore((s) => s.camera);
  const offset = (obj.style?.commentOffset as { x: number; y: number }) || { x: 0, y: 0 };
  const width = (obj.style?.commentWidth as number) || 190;
  const height = (obj.style?.commentHeight as number) || 92;

  const [localComment, setLocalComment] = useState((obj.style?.comment as string) || '');
  /* Own hover, tracked separately: the note sits OUTSIDE the block's box, so
     reaching for it means leaving the block — without this it would vanish
     from under the cursor on the way over. */
  const [selfHover, setSelfHover] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const show = visible || selfHover || isEditing;

  // Sync local state when external comment changes (if not editing)
  useEffect(() => {
    if (!isEditing) {
      setLocalComment((obj.style?.comment as string) || '');
    }
  }, [obj.style?.comment, isEditing]);

  // Explicit focus management
  useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      requestAnimationFrame(() => {
        input.focus();
        // Move cursor to end
        const length = input.value.length;
        input.setSelectionRange(length, length);
      });
    }
  }, [isEditing]);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditing || (e.target as HTMLElement).tagName === 'INPUT') return;
    
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialOffset = { ...offset };

    let moved = false;
    const onMove = (moveE: MouseEvent) => {
      // No button held: the release happened out of sight. Same guard, same
      // reason as the block drag — otherwise this comment follows the cursor
      // around the board forever.
      if (moveE.buttons === 0) { onUp(); return; }
      const dx = (moveE.clientX - startX) / camera.zoom;
      const dy = (moveE.clientY - startY) / camera.zoom;

      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;

      updateObject(obj.id, {
        style: {
          ...obj.style,
          commentOffset: {
            x: initialOffset.x + dx,
            y: initialOffset.y + dy,
          }
        }
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [offset, camera.zoom, obj.id, obj.style, updateObject]);

  const handleResize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = width;
    const initialHeight = height;

    const onMove = (moveE: MouseEvent) => {
      if (moveE.buttons === 0) { onUp(); return; }
      const dx = (moveE.clientX - startX) / camera.zoom;
      const dy = (moveE.clientY - startY) / camera.zoom;
      updateObject(obj.id, {
        style: {
          ...obj.style,
          commentWidth: Math.max(140, initialWidth + dx),
          commentHeight: Math.max(70, initialHeight + dy),
        }
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width, height, camera.zoom, obj.id, obj.style, updateObject]);

  const handleSave = () => {
    updateObject(obj.id, { style: { ...obj.style, comment: localComment } });
    onStopEditing();
  };

  const body = (obj.style?.comment as string) || '';

  return (
    <motion.div
      className={`absolute select-auto group/comment ${isEditing ? 'z-[1000]' : 'z-[102]'}`}
      style={{
        left: offset.x,
        top: offset.y,
        width,
        transform: 'translate(-50%, -50%)',
        // Hidden means untouchable, or an invisible card would still swallow
        // clicks meant for the board behind it.
        pointerEvents: show ? 'auto' : 'none',
      }}
      initial={false}
      animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.94, y: show ? 0 : 4 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setSelfHover(true)}
      onMouseLeave={() => setSelfHover(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={handleDrag}
        className={`relative rounded-[14px] ${isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          minHeight: height,
          padding: '9px 11px 11px',
          background: 'var(--bg-secondary)',
          border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-strong)'}`,
          boxShadow: '0 10px 26px -12px rgba(0,0,0,0.45), 0 2px 6px -2px rgba(0,0,0,0.25)',
        }}
      >
        {/* Tail — two stacked triangles so the note reads as attached to the
            block rather than floating near it. The outer one is the border. */}
        <span
          aria-hidden
          className="absolute"
          style={{
            left: 18, bottom: -8, width: 0, height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: `8px solid ${isEditing ? 'var(--accent)' : 'var(--border-strong)'}`,
          }}
        />
        <span
          aria-hidden
          className="absolute"
          style={{
            left: 19, bottom: -6, width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '7px solid var(--bg-secondary)',
          }}
        />

        {/* Header: a quiet label, and the delete that only appears on hover. */}
        <div className="flex items-center justify-between gap-2" style={{ marginBottom: 5 }}>
          <span className="flex items-center gap-1 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-tertiary)] select-none">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Note
          </span>
          <button
            title="Delete this note"
            className="opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer shrink-0"
            style={{ width: 15, height: 15 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              updateObject(obj.id, { style: { ...obj.style, comment: null } });
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isEditing ? (
          <textarea
            ref={inputRef}
            value={localComment}
            onChange={(e) => setLocalComment(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') { e.preventDefault(); handleSave(); }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Type a note…  (Enter to save, Shift+Enter for a new line)"
            className="w-full bg-transparent border-none outline-none resize-none custom-scrollbar text-[12px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            style={{ minHeight: Math.max(34, height - 40), maxHeight: 260, lineHeight: 1.45 }}
          />
        ) : (
          <div
            className="text-[12px] font-medium whitespace-pre-wrap break-words cursor-text"
            style={{
              color: body ? 'var(--text-primary)' : 'var(--text-tertiary)',
              lineHeight: 1.45,
              maxHeight: 260,
              overflowY: 'auto',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onStartEditing();
            }}
          >
            {body || 'Add a note…'}
          </div>
        )}

        {/* Resizer */}
        {!isEditing && (
          <div
            onMouseDown={handleResize}
            title="Drag to resize"
            className="absolute opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-end justify-end cursor-nwse-resize"
            style={{ bottom: 3, right: 3, width: 11, height: 11 }}
          >
            <span
              style={{
                width: 6, height: 6,
                borderRight: '1.5px solid var(--text-tertiary)',
                borderBottom: '1.5px solid var(--text-tertiary)',
                borderBottomRightRadius: 2,
              }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}


/**
 * A dimmed, full-page preview of an image at its natural proportions. Opened by
 * the "full view" button on an image block and rendered through a portal to the
 * document body, so it sits above the whole app rather than inside the scaled
 * canvas. Closes on backdrop click, the ✕, or Esc.
 */
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
    >
      <button
        onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close full view"
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <motion.img
        src={src}
        alt="Full view"
        draggable={false}
        initial={{ scale: 0.94 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.94 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain' }}
        className="rounded-lg shadow-2xl cursor-default select-none"
      />
    </motion.div>
  );
}

interface CanvasObjectProps {
  obj: CanvasObjectData;
  isSelected: boolean;
  isFocused: boolean;
}

function CanvasObject({ obj, isSelected: isSelectedProp, isFocused }: CanvasObjectProps) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setFocusedId = useCanvasStore((s) => s.setFocusedId);
  const pushUndo = useCanvasStore((s) => s.pushUndo);
  const objects = useCanvasStore((s) => s.objects);
  const camera = useCanvasStore((s) => s.camera);
  const canvasBackground = useCanvasStore((s) => s.canvasBackground);
  const mode = useCanvasStore((s) => s.mode);
  const getNextZIndex = useCanvasStore((s) => s.getNextZIndex);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);

  const addObject = useCanvasStore((s) => s.addObject);
  const removeObject = useCanvasStore((s) => s.removeObject);
  const editingId = useCanvasStore((s) => s.editingId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const addToTrash = useCanvasStore((s) => s.addToTrash);
  const connections = useCanvasStore((s) => s.connections);
  const setSlashMenu = useCanvasStore((s) => s.setSlashMenu);
  const setAtMenu = useCanvasStore((s) => s.setAtMenu);
  const readOnly = useCanvasStore((s) => s.readOnly);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const spreadStackId = useCanvasStore((s) => s.spreadStackId);
  const setSpreadStack = useCanvasStore((s) => s.setSpreadStack);

  /** Where this card sits in its pile, if it's in one. See lib/stacks.ts. */
  const stackSlot = stackSlots(objects, spreadStackId).get(obj.id) ?? null;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHoveredRaw, setIsHovered] = useState(false);

  /* A tour presents CONTENT — every trace of editing UI on the objects
     themselves goes away for the duration.
     This is not cosmetic: a selected frame's eight resize handles are pinned to
     its bounds, which is exactly where a frame scene's mask cuts, so each one
     showed up as a half-circle notched into the edge of the slide. Neutralising
     selection and hover here (rather than hiding handles in CSS) also takes out
     the selection ring, the "tap to cycle shape" hint, the workflow-node hover
     controls and the arrow handles in one move — including any object the mouse
     happens to pass over mid-presentation. The real selection is untouched and
     comes straight back when the tour ends. */
  const isSelected = isSelectedProp && !isTouring;
  const isHovered = isHoveredRaw && !isTouring;
  /** Full-screen image preview ("full view" frame button). */
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /** True right after a real drag so the mouseup's click doesn't also cycle the
   *  image/mirror shape. Reset on the next tick after the drag ends. */
  const dragMovedRef = useRef(false);

  // ---- Embedded browser block state -------------------------------------
  const [browserUrlDraft, setBrowserUrlDraft] = useState('');
  const [browserDraftFocused, setBrowserDraftFocused] = useState(false);
  const [browserExtracting, setBrowserExtracting] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({});
  /** Bumping a tab's counter remounts its <iframe> — that IS a reload. */
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  /* Our own per-tab history. A cross-origin iframe won't let us read or drive
     its history, so back/forward walk the addresses WE navigated to. */
  const browserHistory = useRef<Record<string, { stack: string[]; idx: number }>>({});

  const setTabLoading = useCallback((tabId: string, loading: boolean) => {
    setLoadingTabs((m) => (m[tabId] === loading ? m : { ...m, [tabId]: loading }));
  }, []);

  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);
  const editingCommentId = useCanvasStore((s) => s.editingCommentId);
  const setEditingCommentId = useCanvasStore((s) => s.setEditingCommentId);
  const connectorSelectedIds = useCanvasStore((s) => s.connectorSelectedIds);
  const toggleConnectorSelection = useCanvasStore((s) => s.toggleConnectorSelection);

  // Brainstorm kit (pins / clips / threads). isPin means this object IS a
  // push-pin and renders with no card chrome.
  const isPin = obj.type === 'pin';
  const brainstormTool = useCanvasStore((s) => s.brainstormTool);
  const threadAnchorId = useCanvasStore((s) => s.threadAnchorId);
  const setThreadAnchorId = useCanvasStore((s) => s.setThreadAnchorId);
  const toggleClip = useCanvasStore((s) => s.toggleClip);
  const linkThread = useCanvasStore((s) => s.linkThread);
  const isThreadAnchor = threadAnchorId === obj.id;

  // Collaboration: mark objects authored by someone else with their colour dot.
  // Selectors return primitives, so frequent cursor updates never re-render this.
  const collabActive = useCollabStore((s) => s.status === 'connected' && Object.keys(s.peers).length > 0);
  const myPeerId = useCollabStore((s) => s.me?.id);
  const authorId = obj.style?.authorId as string | undefined;
  const authorColor = (obj.style?.authorColor as string | undefined) || '#E93D82';
  const showAuthorDot = collabActive && !!authorId && authorId !== myPeerId;
  
  const isEditing = editingId === obj.id && mode !== 'connector';

  /* Typing-as-ink. A block "is ink" once its energy is baked in (style.inkType,
     read back forever) OR while it's being typed with the Flow ink toggle on.
     Only free text / headings get it — the expressive, hand-written surfaces. */
  const inkFlowOn = useFlowStore((s) => s.enabled && s.prefs.typingInk);
  const inkEligible = obj.type === 'text' || obj.type === 'heading';
  const isInkBlock = inkEligible && (Boolean(obj.style?.inkType) || (isEditing && inkFlowOn));

  const dragStart = useRef({ x: 0, y: 0, objX: 0, objY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const latestContent = useRef(obj.content || '');
  /** Where the click that opened edit mode landed, so the caret goes THERE. */
  const caretPoint = useRef<{ x: number; y: number } | null>(null);

  /* Typing-as-ink capture state (only live while editing in ink mode): the
     per-char intensity array we're building, plus the text + timestamp of the
     previous keystroke so each new one's interval → intensity. */
  const inkRhythmRef = useRef<number[]>((obj.style?.inkRhythm as number[] | undefined) || []);
  const inkPrevTextRef = useRef<string>(obj.content || '');
  const inkPrevTsRef = useRef<number>(0);
  const inkActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (isEditing) {
      setIsHovered(false);
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    }
  }, [isEditing]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Public share viewer: look, don't touch. Let native events through (so
      // links/embeds/scroll still work) but never start a drag or select.
      // A tour takes the same deal: the presenter can still click a link or an
      // embed, but can't nudge a block out of place mid-slide.
      if (readOnly || isTouring) return;
      if (mode === 'draw') return;
      /* Editing splits the block into two surfaces, and this used to be one.
         Every press was swallowed while a block was being edited, which is the
         state a block is in for the entire time you are working on it — so the
         moment you had clicked into a card to write, you could no longer MOVE
         that card. Grabbing it did nothing at all; you had to click empty
         board to get out of edit mode first, then grab it. Measured: a cold
         drag moved a card exactly as asked, the same drag one click later
         moved it zero pixels.

         So: a press inside the words is still a caret gesture and stays
         entirely native — sweeping a selection across your own text must not
         pan the board or tear the block loose. A press anywhere else on the
         block (its padding, its border, the gutter around the text) is a grab,
         and falls through to the drag path below. That's the same division of
         labour every editor on a canvas uses, and it costs the text nothing. */
      if (isEditing) {
        const inWords = (e.target as HTMLElement).closest('[contenteditable="true"]');
        if (inWords) { e.stopPropagation(); return; }
      }

      // Clicks on embedded controls (poll options, settings inputs, checkpoint
      // name, todo checkboxes…) must keep their native behaviour — a
      // preventDefault here would block text-field focus entirely.
      const interactive = (e.target as HTMLElement).closest(
        'input, textarea, select, button, a, [contenteditable="true"]'
      );
      if (interactive) {
        e.stopPropagation();
        if (mode !== 'connector') setSelectedId(obj.id);
        return;
      }

      e.stopPropagation();
      e.preventDefault();

      // Whatever was being dragged before this press is over, whether or not
      // its mouseup ever arrived. Two live sessions must never overlap.
      endActiveDrag();

      // Alt+drag clones the object in place and drags the clone, leaving the
      // original untouched — a fast way to duplicate cards, shapes, and frames.
      let dragObj = obj;
      if (e.altKey && mode !== 'connector' && obj.type !== 'arrow') {
        dragObj = addObject({ ...obj, zIndex: getNextZIndex(), createdAt: Date.now(), updatedAt: Date.now() });
      }

      /* Taking hold of a card in an OPEN pile.
         A pile's fan is drawn, never stored — every member shares the pile's
         one x/y — so a spread card sits somewhere its own data says it isn't.
         Two consequences, and both matter:

         Nothing is detached HERE. Grabbing is not pulling: you have to be
         able to click a spread card to read or edit it, and detaching on
         mousedown would tear a card out of the pile every time you tried.
         The detach happens on the first real movement, below.

         And the drag has to start from where the card LOOKS like it is, or it
         jumps by the width of its own offset the moment it comes loose. */
      const grabbedSlot = stackSlots(objects, spreadStackId).get(dragObj.id);
      const spreadGrab = grabbedSlot?.spread && dragObj.id === obj.id ? grabbedSlot : null;

      // Only select if not in connector mode
      if (mode !== 'connector') {
        setSelectedId(dragObj.id);
      }

      /* Raising the clicked object to the top is right for everything EXCEPT a
         frame. A frame is a backdrop: promote it and it covers the very blocks
         it wraps, so the first click on a frame made all of its contents
         unclickable (addObject already guards the creation path — this was the
         same bug arriving through interaction instead). */
      if (dragObj.id === obj.id && dragObj.type !== 'frame') {
        updateObject(dragObj.id, { zIndex: getNextZIndex() });
      }

      /* Dragging a frame carries its contents ONLY when the frame has "Move
         contents" switched on (style.carryContents, toggled from the frame
         menu). It defaults OFF: when two frames overlap, grabbing one used to
         sweep up everything sitting inside the other — and even one block you
         tried to pull out — so the group move is now something you opt into per
         frame. When on, it carries every block whose centre is inside the frame
         right now (objectsInFrame, the same rule the canvas uses to group)
         UNION anything explicitly tagged to it. */
      const carryContents = dragObj.type === 'frame' && dragObj.style?.carryContents === true;
      const frameChildren = carryContents
        ? (() => {
            const seen = new Set<string>([dragObj.id]);
            const out: { id: string; x: number; y: number }[] = [];
            const add = (o: CanvasObjectData) => {
              if (seen.has(o.id)) return;
              // A frame never carries another frame — two group handles moving
              // each other is the exact confusion this toggle exists to end.
              if (o.type === 'frame') return;
              seen.add(o.id);
              out.push({ id: o.id, x: o.x, y: o.y });
            };
            objectsInFrame(objects, dragObj).forEach(add);
            objects.filter((o) => o.style?.frameParentId === dragObj.id).forEach(add);
            return out;
          })()
        : [];

      /* A CLOSED pile moves as one object, the way a real stack of paper does
         — you can't slide the top note off a pile without opening it first,
         and neither can you here. That asymmetry is the whole interaction:
         drag a closed pile to move it, open it to take one card out. */
      const carriedStack =
        grabbedSlot && !grabbedSlot.spread
          ? membersOf(objects, grabbedSlot.stackId)
              .filter((m) => m.id !== dragObj.id)
              .map((m) => ({ id: m.id, x: m.x, y: m.y }))
          : [];
      const carried = [...frameChildren, ...carriedStack];

      const before = { x: dragObj.x, y: dragObj.y, style: dragObj.style };
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        // Drawn position, not stored position — see spreadGrab above.
        objX: dragObj.x + (spreadGrab?.dx ?? 0),
        objY: dragObj.y + (spreadGrab?.dy ?? 0),
        // For arrows:
        objStartX: dragObj.style?.startX as number || 0,
        objStartY: dragObj.style?.startY as number || 0,
        objEndX: dragObj.style?.endX as number || 0,
        objEndY: dragObj.style?.endY as number || 0,
        objBendX: dragObj.style?.bendX as number | undefined,
        objBendY: dragObj.style?.bendY as number | undefined,
      } as any;

      setIsDragging(true);
      // Tell the board a block is in hand, so nothing else can move the world
      // while it is (see dragState in lib/utils).
      dragState.objectDrag = true;

      /* Drop targets that aren't the canvas: the Pocket rail on the left edge,
         and either chat panel if one is open. Tracked as plain closure
         variables (not React state) so the frequent mousemove never re-renders.

         There used to be two stacked left-edge zones — "minimize" above "warp
         to canvas" — which meant a 160px-tall target for one action sitting
         directly on top of a 164px target for a different, irreversible one.
         The Pocket is a single zone that does the job of both. */
      let overPocketZone = false;
      let overChatZone = false;
      let overAgentChatZone = false;
      let draggedFar = false;
      /* A DELIBERATE drag — moved well past the 8px that merely distinguishes a
         drag from a tap. The destructive drops (into the pocket, send to chat,
         file into a binder, pile onto another note) all wait for this, so a
         tiny shaky nudge on a block near the left edge or beside another note
         can no longer make it vanish. That was the "I touched it and it
         disappeared" bug. */
      let committedDrag = false;
      const COMMIT_DIST = 26;
      /** Set once a card has actually been pulled clear of an open pile. */
      let detached = false;
      /** Last state pushed to the Pocket rail, so we only notify on a change. */
      let pocketSignal = '';

      /* --- Edge auto-pan while dragging -----------------------------------
         The camera at grab time, the fixed zoom, and the latest cursor. When the
         cursor rides a screen edge, a rAF loop scrolls the viewport that way so
         you can shift a block (or a whole framed group) clear across the board
         without letting go. `positionAt` recomputes the block's world spot from
         the LIVE camera, so it stays glued under the cursor as the world scrolls
         beneath it — that camera-compensation term is zero whenever the camera
         isn't moving, so an ordinary drag behaves exactly as before. */
      /* Read the camera LIVE, never from the render closure.
         This is the bug that made blocks leap clear off the screen. This
         callback's dependency list carries `camera.zoom` but not `camera`, so
         panning the board — which changes x/y and leaves zoom alone — does not
         rebuild it. `camera.x/y` in scope here were therefore whatever they
         were the last time something else happened to rebuild the callback,
         and every pan since then silently widened the gap.

         Harmless until edge auto-pan arrived, because nothing read the camera
         at grab time. Now `positionAt` subtracts (liveCam − dragStartCam) to
         hold the block under the cursor while the viewport scrolls: feed that
         a stale origin and the term isn't zero at rest, it's your entire
         accumulated pan. The block jumped by exactly that on the first
         movement — hundreds or thousands of px, straight out of view. It
         behaved for a moment after load, then got worse the more you moved
         around the board, which is precisely how it was reported. */
      const camAtGrab = useCanvasStore.getState().camera;
      const dragStartCam = { x: camAtGrab.x, y: camAtGrab.y };
      const zoom = camAtGrab.zoom;
      let lastCursor = { x: e.clientX, y: e.clientY };
      let edgeRAF: number | null = null;
      let overAnyHotzone = false;
      /** False the instant this session is torn down, however that happens. */
      let alive = true;

      const positionAt = (cursorX: number, cursorY: number) => {
        /* A TAP MOVES NOTHING. Until the cursor has travelled past the 8px
           that separates a tap from a drag, this block stays exactly where it
           is — no snap, no nudge, no write to the store. Before, the first
           pixel of hand-shake ran the full drag path, and alignment snapping
           immediately yanked the block onto a neighbour's edge: touch a card
           to select it and it slid out from under you.

           Nothing jumps when the drag does start, because every position here
           is computed absolutely from the grab point rather than accumulated
           frame by frame — the block picks up exactly where the cursor is. */
        if (!draggedFar) return;

        const liveCam = useCanvasStore.getState().camera;
        const dx = (cursorX - dragStart.current.x) / zoom - (liveCam.x - dragStartCam.x) / zoom;
        const dy = (cursorY - dragStart.current.y) / zoom - (liveCam.y - dragStartCam.y) / zoom;

        let newX = dragStart.current.objX + dx;
        let newY = dragStart.current.objY + dy;

        /* A frame does NOT snap. Its edges/centre would try to align to every
           block it wraps (getSnapPoints scans all others and keeps the LAST
           match), so a big frame full of cards jumped erratically as you
           dragged it — the "frames scatter/go away randomly" bug. A frame is a
           loose backdrop; it goes exactly where you drag it. Other blocks still
           snap to each other as before. */
        if (mode !== 'connector' && dragObj.type !== 'frame') {
          const others = objects
            .filter((o) => o.id !== dragObj.id)
            .map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }));
          const snap = getSnapPoints(newX, newY, dragObj.width, dragObj.height, others);
          if (snap.x !== null) newX = snap.x;
          if (snap.y !== null) newY = snap.y;
        }

        // The moment a grab on a spread card becomes a real drag it leaves the
        // pile, at the exact spot it was drawn, so it comes away without a jump.
        if (spreadGrab && !detached) {
          detached = true;
          useCanvasStore.getState().unstackObject(dragObj.id, newX, newY);
        }

        if (dragObj.type === 'arrow') {
          const ds = dragStart.current as any;
          updateObject(dragObj.id, {
            x: newX,
            y: newY,
            style: {
              ...dragObj.style,
              startX: ds.objStartX + dx,
              startY: ds.objStartY + dy,
              endX: ds.objEndX + dx,
              endY: ds.objEndY + dy,
              ...(ds.objBendX !== undefined ? { bendX: ds.objBendX + dx, bendY: ds.objBendY + dy } : {}),
            },
          });
        } else {
          updateObject(dragObj.id, { x: newX, y: newY });
        }

        // Carried group moves by the frame's REAL (post-snap) displacement, so
        // it stays rigidly attached. One batched commit for the whole group —
        // not a store write per child — so carrying a 60-block frame stays
        // smooth instead of firing 60 renders per mousemove.
        if (carried.length > 0) {
          const effDx = newX - dragStart.current.objX;
          const effDy = newY - dragStart.current.objY;
          useCanvasStore.getState().translateObjects(
            carried.map((c) => ({ id: c.id, x: c.x + effDx, y: c.y + effDy }))
          );
        }
      };

      const EDGE = 72;       // px band along each edge that triggers a scroll
      const EDGE_SPEED = 17; // px/frame at the very edge, eased in across the band
      const tickEdge = () => {
        // Re-arm only while this session is genuinely still the live one. A
        // loop that outlives its drag is a viewport that scrolls away on its
        // own, forever, with nobody touching anything.
        if (!alive) { edgeRAF = null; return; }
        edgeRAF = requestAnimationFrame(tickEdge);
        // Only auto-pan a real drag, and never while poised over a dock hotzone
        // (those live on the same left edge and must win).
        if (!draggedFar || overAnyHotzone) return;
        const W = window.innerWidth, H = window.innerHeight;
        const { x: cx, y: cy } = lastCursor;
        let vx = 0, vy = 0;
        if (cx < EDGE) vx = (EDGE - cx) / EDGE;
        else if (cx > W - EDGE) vx = -(cx - (W - EDGE)) / EDGE;
        if (cy < EDGE) vy = (EDGE - cy) / EDGE;
        else if (cy > H - EDGE) vy = -(cy - (H - EDGE)) / EDGE;
        if (vx === 0 && vy === 0) return;
        const cam = useCanvasStore.getState().camera;
        useCanvasStore.getState().setCamera({ x: cam.x + vx * EDGE_SPEED, y: cam.y + vy * EDGE_SPEED, zoom: cam.zoom });
        positionAt(lastCursor.x, lastCursor.y); // keep the block glued under the cursor
      };
      edgeRAF = requestAnimationFrame(tickEdge);

      const handleMouseMove = (moveE: MouseEvent) => {
        /* A move with no button held proves the release already happened
           somewhere we never saw it — off the window's edge, in another app,
           behind a native menu. This is the guard that actually saves us,
           because it needs no event the browser might withhold: the very next
           twitch of the mouse ends the orphaned drag. Without it the block
           stayed welded to the cursor and the board scrolled away by itself. */
        if (moveE.buttons === 0) { endDrag(); return; }

        if (Math.abs(moveE.clientX - dragStart.current.x) > 8 || Math.abs(moveE.clientY - dragStart.current.y) > 8) {
          draggedFar = true;
          dragMovedRef.current = true;
        }
        if (Math.hypot(moveE.clientX - dragStart.current.x, moveE.clientY - dragStart.current.y) > COMMIT_DIST) {
          committedDrag = true;
        }
        /* Frames/arrows can't be pocketed or sent meaningfully — neither has a
           standalone snapshot that makes sense outside its canvas context. */
        const portable = dragObj.type !== 'frame' && dragObj.type !== 'arrow';
        /* Pocketing is additionally disabled for a guest inside someone else's
           live session: it broadcasts a remove op, which would delete the
           object from the HOST's real canvas — sending to chat doesn't touch
           canvas state at all, so that stays allowed here. */
        const canPocket = portable && !useCollabStore.getState().guestOriginView;

        /* Hit-test the rail's real rectangle rather than hard-coded pixel bands.
           The old zones were two fixed 160px strips at y 72–232 and 240–404, so
           they drifted out of alignment with the chrome they were supposed to
           represent the moment either moved. */
        const railEl = document.getElementById('pocket-hotzone');
        if (railEl && canPocket && committedDrag) {
          const r = railEl.getBoundingClientRect();
          const PAD = 26; // a forgiving target — you're aiming while dragging
          overPocketZone =
            moveE.clientX >= r.left - PAD && moveE.clientX <= r.right + PAD &&
            moveE.clientY >= r.top - PAD && moveE.clientY <= r.bottom + PAD;
        } else {
          overPocketZone = false;
        }

        /* Tell the rail to open up and light itself. Only on an actual change,
           so this is a handful of events per drag rather than one per mousemove. */
        const signal = `${committedDrag && canPocket}|${overPocketZone}`;
        if (signal !== pocketSignal) {
          pocketSignal = signal;
          window.dispatchEvent(new CustomEvent('pocket-drag-state', {
            detail: { active: committedDrag && canPocket, over: overPocketZone },
          }));
        }

        // Dropping a block onto the AI agent chat adds it as context there.
        const agentPanel = document.getElementById('agent-chat-panel');
        if (agentPanel && portable && committedDrag) {
          const rect = agentPanel.getBoundingClientRect();
          overAgentChatZone = moveE.clientX >= rect.left && moveE.clientX <= rect.right &&
                              moveE.clientY >= rect.top && moveE.clientY <= rect.bottom;
          agentPanel.style.boxShadow = overAgentChatZone ? '0 0 0 2px var(--accent)' : '';
        } else {
          overAgentChatZone = false;
        }

        const chatPanel = document.getElementById('chat-panel-container');
        if (chatPanel && portable && committedDrag) {
          const rect = chatPanel.getBoundingClientRect();
          overChatZone = moveE.clientX >= rect.left && moveE.clientX <= rect.right &&
                         moveE.clientY >= rect.top && moveE.clientY <= rect.bottom;
          chatPanel.style.transform = overChatZone ? 'scale(1.02)' : 'scale(1)';
        } else {
          overChatZone = false;
        }

        // Remember the cursor + whether a drop target owns it, then place the
        // block. The edge-pan loop reuses lastCursor to keep scrolling when the
        // cursor is held still against an edge.
        overAnyHotzone = overPocketZone || overChatZone || overAgentChatZone;
        lastCursor = { x: moveE.clientX, y: moveE.clientY };
        positionAt(moveE.clientX, moveE.clientY);
      };

      /* Release every resource this drag holds. Idempotent, and deliberately
         free of any drop behaviour: it is what runs when a gesture ends in a
         way we can't interpret (focus lost, pointer cancelled, a stray move
         with no button), where the only right answer is to stop cleanly and
         leave the block exactly where the user last saw it. */
      const teardown = () => {
        if (!alive) return false;
        alive = false;
        if (dragState.endActive === endDrag) dragState.endActive = null;
        dragState.objectDrag = false;
        setIsDragging(false);
        if (edgeRAF !== null) { cancelAnimationFrame(edgeRAF); edgeRAF = null; }
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp, END_DRAG);
        window.removeEventListener('pointercancel', endDrag, END_DRAG);
        window.removeEventListener('blur', endDrag);
        // Let the click that follows a real mouseup see that we dragged (so it
        // won't cycle the shape), then clear the flag for the next real tap.
        if (dragMovedRef.current) setTimeout(() => { dragMovedRef.current = false; }, 0);
        // Any hover chrome the drag lit up has to go out with it.
        for (const [id, reset] of [
          ['chat-panel-container', (el: HTMLElement) => { el.style.transform = 'scale(1)'; }],
          ['agent-chat-panel', (el: HTMLElement) => { el.style.boxShadow = ''; }],
        ] as [string, (el: HTMLElement) => void][]) {
          const el = document.getElementById(id);
          if (el) reset(el);
        }
        /* The Pocket rail styles itself from React state, so it needs telling
           the drag is over — otherwise it stays expanded and lit for good. */
        if (pocketSignal !== '') {
          pocketSignal = '';
          window.dispatchEvent(new CustomEvent('pocket-drag-state', { detail: { active: false, over: false } }));
        }
        return true;
      };

      /** Abnormal end: stop the drag, keep the block where it is, keep undo honest. */
      const endDrag = () => {
        if (!teardown()) return;
        if (!dragMovedRef.current) return;
        const settled = useCanvasStore.getState().objects.find((o) => o.id === dragObj.id);
        if (settled) pushUndo({ type: 'move', objectId: dragObj.id, before, after: { x: settled.x, y: settled.y } });
      };

      // The real release: teardown first (it also puts the dock chrome back),
      // then decide what the drop MEANT.
      const handleMouseUp = () => {
        if (!teardown()) return;

        // Into the Pocket: off this canvas, into the tray, ready to be carried
        // to any other board. This one gesture replaced both the old "minimize"
        // shelf and Warp's destination modal.
        if (overPocketZone) {
          useCanvasStore.getState().pocketObject(dragObj.id);
          return;
        }

        // Drop onto the AI agent chat → attach the block as context there.
        if (overAgentChatZone) {
          updateObject(dragObj.id, { x: before.x, y: before.y });
          const label = (dragObj.content || '').split('\n')[0].trim().slice(0, 60) || dragObj.type;
          window.dispatchEvent(new CustomEvent('agent-chat-add-block', {
            detail: {
              snapshot: { type: dragObj.type, content: dragObj.content, width: dragObj.width, height: dragObj.height, style: dragObj.style },
              label,
            },
          }));
          return;
        }

        // Send to chat: hand off to ChatLauncher, which either drops it
        // straight into whatever conversation is currently open, or opens
        // the panel and asks who to send it to. Snap back like Warp does.
        if (overChatZone) {
          updateObject(dragObj.id, { x: before.x, y: before.y });
          const label = (dragObj.content || '').split('\n')[0].trim().slice(0, 60) || dragObj.type;
          window.dispatchEvent(new CustomEvent('open-chat-send', {
            detail: {
              snapshot: { type: dragObj.type, content: dragObj.content, width: dragObj.width, height: dragObj.height, style: dragObj.style },
              label,
            },
          }));
          return;
        }

        // Dropping any object inside a binder's bounds files it into that binder.
        // A binder is just a nested board keyed by its own id, so we re-home the
        // dropped object there with teleportObject (the same primitive Warp uses)
        // and lay it out on a tidy 3-column grid inside the binder's canvas.
        // (This used to require dragObj.id !== obj.id — true only when Alt-cloning
        // — so a plain drag never actually bound anything.)
        // Gated on a committed drag: without it, a mere tap on a block that
        // happens to sit over a binder teleported it inside — content vanishing
        // on touch.
        if (committedDrag && dragObj.type !== 'arrow' && !dragObj.style?.isBinder) {
          const state = useCanvasStore.getState();
          const live = state.objects.find((o) => o.id === dragObj.id);
          if (live) {
            const cx = live.x + live.width / 2;
            const cy = live.y + live.height / 2;
            const binder = state.objects.find(
              (o) => o.style?.isBinder === true && o.id !== dragObj.id && cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height
            );
            if (binder) {
              const count = (binder.style?.binderCount as number) || 0;
              const col = count % 3;
              const row = Math.floor(count / 3);
              // Start clear of the sub-space header / breadcrumb at the top-left.
              state.updateObject(dragObj.id, { x: 160 + col * 340, y: 200 + row * 240 });
              state.updateObject(binder.id, { style: { ...binder.style, binderCount: count + 1 } });
              state.teleportObject(dragObj.id, binder.id);
              setSelectedId(null);
              return; // End drag early — the object now lives in the binder's board
            }
          }
        }

        /* Dropping a note onto another note piles them.
           Aimed by the dragged card's CENTRE, because that's what people
           watch while they drag. This sits after the binder and dock checks
           so those keep priority, and before frame grouping so a pile made
           inside a frame still joins the frame. */
        if (committedDrag && isStackable(dragObj)) {
          const state = useCanvasStore.getState();
          const live = state.objects.find((o) => o.id === dragObj.id);
          if (live) {
            const target = stackTargetAt(
              state.objects,
              live,
              { x: live.x + live.width / 2, y: live.y + live.height / 2 },
              // Aim at the cards as DRAWN — an open pile's members are all
              // stored at one spot but shown spread around it.
              stackSlots(state.objects, state.spreadStackId)
            );
            if (target) {
              state.stackObjects(live.id, target.id);
              state.setSpreadStack(null);
              /* `before` carries the pre-drop style, so one Ctrl+Z lifts this
                 card back off the pile and puts it where it came from. The
                 note it landed on keeps a stackId, which is inert: a pile is
                 only a pile at two members or more (lib/stacks.ts), so a
                 leftover id on a lone card is simply never a pile. */
              pushUndo({ type: 'edit', objectId: live.id, before, after: { x: live.x, y: live.y } });
              return;
            }
          }
        }

        // Dropping a non-frame object inside a frame's bounds groups it —
        // move the frame later and this comes along for the ride.
        if (dragObj.type !== 'frame' && dragObj.type !== 'arrow') {
          const state = useCanvasStore.getState();
          const live = state.objects.find((o) => o.id === dragObj.id);
          if (live) {
            const cx = live.x + live.width / 2;
            const cy = live.y + live.height / 2;
            const host = state.objects.find(
              (o) => o.type === 'frame' && cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height
            );
            const newFrameId = host?.id;
            if (live.style?.frameParentId !== newFrameId) {
              state.updateObject(dragObj.id, { style: { ...live.style, frameParentId: newFrameId } });
            }
          }
        }

        /* Nothing actually moved — a tap, or a drag that never crossed the
           threshold. Recording it would put a no-op on the undo stack, so
           Ctrl+Z would appear to do nothing at all. */
        if (!dragMovedRef.current) return;

        // Where it ENDED UP, read live: `dragObj` is the snapshot from
        // mousedown and still holds the pre-drag coordinates, so redoing a
        // move used to send the block back to where it started.
        const settled = useCanvasStore.getState().objects.find((o) => o.id === dragObj.id);
        if (!settled) return;
        pushUndo({
          type: 'move',
          objectId: dragObj.id,
          before,
          after: { x: settled.x, y: settled.y },
        });
      };

      /* Every way this gesture can end, wired to a teardown that survives all
         of them. `mouseup` is the normal one; `pointercancel` fires when the
         OS or the browser takes the pointer away (a touch turning into a
         scroll, a native drag starting); `blur` covers alt-tab and anything
         that steals focus mid-drag. The mousemove buttons check above catches
         whatever still slips through. */
      dragState.endActive = endDrag;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp, END_DRAG);
      window.addEventListener('pointercancel', endDrag, END_DRAG);
      window.addEventListener('blur', endDrag);
    },
    [mode, isEditing, obj, objects, setSelectedId, updateObject, pushUndo, getNextZIndex, addObject, readOnly, isTouring, spreadStackId]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      endActiveDrag();
      dragState.objectDrag = true;
      let alive = true;
      // Zoom read live at grab time, not from the render closure — see the
      // note on dragStartCam in handleMouseDown for what stale camera state
      // costs. A gesture's scale must be the scale on screen when it started.
      const zoom = useCanvasStore.getState().camera.zoom;

      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: obj.width,
        h: obj.height,
        // For arrows:
        objEndX: obj.style?.endX as number || 0,
        objEndY: obj.style?.endY as number || 0,
      } as any;

      const handleMouseMove = (moveE: MouseEvent) => {
        // No button held -> the release happened where we couldn't see it.
        if (moveE.buttons === 0) { handleMouseUp(); return; }
        const dx = (moveE.clientX - resizeStart.current.x) / zoom;
        const dy = (moveE.clientY - resizeStart.current.y) / zoom;
        
        if (obj.type === 'arrow') {
          const initialStyle = obj.style || {};
          const startX = initialStyle.startX as number || 0;
          const startY = initialStyle.startY as number || 0;
          const initialEndX = (resizeStart.current as any).objEndX || 0;
          const initialEndY = (resizeStart.current as any).objEndY || 0;
          const newEndX = initialEndX + dx;
          const newEndY = initialEndY + dy;

          const bx = initialStyle.bendX as number | undefined;
          const by = initialStyle.bendY as number | undefined;
          const allX = bx !== undefined ? [startX, newEndX, bx] : [startX, newEndX];
          const allY = by !== undefined ? [startY, newEndY, by] : [startY, newEndY];
          const minX = Math.min(...allX);
          const minY = Math.min(...allY);
          const maxX = Math.max(...allX);
          const maxY = Math.max(...allY);

          updateObject(obj.id, {
            x: minX,
            y: minY,
            width: Math.max(15, maxX - minX),
            height: Math.max(15, maxY - minY),
            style: {
              ...initialStyle,
              endX: newEndX,
              endY: newEndY,
            }
          });
        } else {
          const newW = Math.max(100, resizeStart.current.w + dx);
          const newH = Math.max(50, resizeStart.current.h + dy);
          updateObject(obj.id, { 
            width: newW, 
            height: newH,
            style: {
              ...obj.style,
              isResized: true
            }
          });
        }
      };

      const handleMouseUp = () => {
        if (!alive) return;
        alive = false;
        if (dragState.endActive === handleMouseUp) dragState.endActive = null;
        setIsResizing(false);
        dragState.objectDrag = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('pointercancel', handleMouseUp);
        window.removeEventListener('blur', handleMouseUp);
      };

      dragState.endActive = handleMouseUp;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('pointercancel', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [obj, updateObject]
  );

  // Drag an arrow's start / end / bend control point. The bend point turns a
  // straight arrow into a smooth curve — grab the middle dot and pull. The whole
  // bounding box is recomputed to enclose all three so hit-testing stays sane.
  const handleArrowPointDrag = useCallback(
    (e: React.MouseEvent, which: 'start' | 'end' | 'bend') => {
      e.stopPropagation();
      e.preventDefault();
      const s = obj.style || {};
      const sx = (s.startX as number) || 0, sy = (s.startY as number) || 0;
      const ex = (s.endX as number) || 0, ey = (s.endY as number) || 0;
      const hasBend = s.bendX !== undefined;
      const base =
        which === 'start' ? { x: sx, y: sy }
        : which === 'end' ? { x: ex, y: ey }
        : hasBend ? { x: s.bendX as number, y: s.bendY as number } : { x: (sx + ex) / 2, y: (sy + ey) / 2 };
      const origin = { x: e.clientX, y: e.clientY };
      const zoom = useCanvasStore.getState().camera.zoom;
      endActiveDrag();
      dragState.objectDrag = true;
      let alive = true;

      const move = (me: MouseEvent) => {
        if (me.buttons === 0) { up(); return; }
        const dx = (me.clientX - origin.x) / zoom;
        const dy = (me.clientY - origin.y) / zoom;
        const ns: Record<string, unknown> = { ...s };
        if (which === 'start') { ns.startX = base.x + dx; ns.startY = base.y + dy; }
        else if (which === 'end') { ns.endX = base.x + dx; ns.endY = base.y + dy; }
        else { ns.bendX = base.x + dx; ns.bendY = base.y + dy; }
        const xs = [ns.startX as number, ns.endX as number];
        const ys = [ns.startY as number, ns.endY as number];
        if (ns.bendX !== undefined) { xs.push(ns.bendX as number); ys.push(ns.bendY as number); }
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const maxX = Math.max(...xs), maxY = Math.max(...ys);
        updateObject(obj.id, {
          x: minX, y: minY,
          width: Math.max(15, maxX - minX), height: Math.max(15, maxY - minY),
          style: ns,
        });
      };
      const up = () => {
        if (!alive) return;
        alive = false;
        if (dragState.endActive === up) dragState.endActive = null;
        dragState.objectDrag = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('pointercancel', up);
        window.removeEventListener('blur', up);
      };
      dragState.endActive = up;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('blur', up);
    },
    [obj, updateObject]
  );

  // Frames resize from any corner or edge, not just the bottom-right —
  // sections need to grow leftward/upward to wrap content already placed there.
  const handleDotResizeStart = useCallback(
    (e: React.MouseEvent, dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      endActiveDrag();
      dragState.objectDrag = true;
      let alive = true;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const start = { x: obj.x, y: obj.y, w: obj.width, h: obj.height };
      const zoom = useCanvasStore.getState().camera.zoom;

      const handleMouseMove = (moveE: MouseEvent) => {
        if (moveE.buttons === 0) { handleMouseUp(); return; }
        const dx = (moveE.clientX - startClientX) / zoom;
        const dy = (moveE.clientY - startClientY) / zoom;

        let { x, y, w, h } = start;
        const MIN_W = 160;
        const MIN_H = 120;

        if (dir.includes('e')) w = Math.max(MIN_W, start.w + dx);
        if (dir.includes('s')) h = Math.max(MIN_H, start.h + dy);
        if (dir.includes('w')) {
          w = Math.max(MIN_W, start.w - dx);
          x = start.x + (start.w - w);
        }
        if (dir.includes('n')) {
          h = Math.max(MIN_H, start.h - dy);
          y = start.y + (start.h - h);
        }

        updateObject(obj.id, { x, y, width: w, height: h, style: { ...obj.style, isResized: true } });
      };

      const handleMouseUp = () => {
        if (!alive) return;
        alive = false;
        if (dragState.endActive === handleMouseUp) dragState.endActive = null;
        setIsResizing(false);
        dragState.objectDrag = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('pointercancel', handleMouseUp);
        window.removeEventListener('blur', handleMouseUp);
      };

      dragState.endActive = handleMouseUp;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('pointercancel', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [obj, updateObject]
  );

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const initialRotation = obj.rotation || 0;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      endActiveDrag();
      dragState.objectDrag = true;
      let alive = true;

      const handleMouseMove = (moveE: MouseEvent) => {
        if (moveE.buttons === 0) { handleMouseUp(); return; }
        const currentAngle = Math.atan2(moveE.clientY - centerY, moveE.clientX - centerX);
        const angleDiff = currentAngle - startAngle;
        let newRotation = initialRotation + (angleDiff * 180) / Math.PI;

        newRotation = (newRotation % 360 + 360) % 360;

        // Snap to 15-degree increments if Shift is held
        if (moveE.shiftKey) {
          newRotation = Math.round(newRotation / 15) * 15;
        }

        updateObject(obj.id, { rotation: newRotation });
      };

      const handleMouseUp = () => {
        if (!alive) return;
        alive = false;
        if (dragState.endActive === handleMouseUp) dragState.endActive = null;
        dragState.objectDrag = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('pointercancel', handleMouseUp);
        window.removeEventListener('blur', handleMouseUp);
      };

      dragState.endActive = handleMouseUp;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('pointercancel', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [obj, updateObject]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || isTouring) return;

      if (obj.type === 'heading') {
        // Navigate into nested canvas
        pushCanvas(obj.id);
        return;
      }

      if (obj.type === 'frame') {
        // Frames organize other content — dimming the whole canvas to
        // "focus" on a section doesn't help, so double-click renames instead.
        setEditingId(obj.id);
        return;
      }

      /* Double-click is how you get a caret. This is THE way in now — a single
         click selects and nothing more — which is what every other canvas tool
         does and what stops "why won't this card move": a block you clicked
         once is selected and draggable, not silently in edit mode.
         Deliberately without focus mode: dimming the whole board every time
         you go to write a word is not focus, it's a flash. */
      if (obj.type === 'text' || obj.type === 'sticky' || obj.type === 'card') {
        caretPoint.current = { x: e.clientX, y: e.clientY };
        setEditingId(obj.id);
        return;
      }

      /* Everything with nothing to type into — a picture, an embed, a drawing —
         keeps double-click as "show me only this". */
      setFocusedId(obj.id);
    },
    [obj, setFocusedId, pushCanvas, setEditingId, readOnly, isTouring]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isTouring) return;

      /* One tap opens a pile. Until it's open there is nothing useful to do
         with the card you clicked — it's the only one of several you can even
         see — so the tap belongs to the pile, not to the card. Selecting and
         editing come back the moment it's spread. A drag is not a tap.

         This sits ABOVE the read-only guard on purpose: opening a pile writes
         nothing to the board, and a viewer who can't open one can't read a
         single card underneath the top of it. */
      if (stackSlot && !stackSlot.spread && !dragMovedRef.current) {
        setSpreadStack(stackSlot.stackId);
        if (!readOnly) setSelectedId(null);
        return;
      }

      if (readOnly) return;
      if (mode === 'draw' || isEditing) return;

      if (mode === 'connector') {
        toggleConnectorSelection(obj.id);
        return;
      }

      /* Tapped from a long way out, where this block is a 20px smudge. Nobody
         aims at something that small to select it — they're asking to get to
         it. So fly in and frame it, and leave it selected once you land. The
         canvas owns the camera move (see `dive-to-object` in InfiniteCanvas);
         the threshold is low enough that ordinary work is untouched. */
      if (mode === 'select' && !dragMovedRef.current && useCanvasStore.getState().camera.zoom < 0.5) {
        window.dispatchEvent(new CustomEvent('dive-to-object', { detail: { id: obj.id } }));
        setSelectedId(obj.id);
        return;
      }

      /* Brainstorm kit routing. A tap in brainstorm mode means one of the three
         tools, never "edit this block":
           · clip   → fasten / unfasten a paper clip on this block
           · thread → tap this pin, then tap another, to run string between them
           · pin    → placing happens on empty canvas; a tap here just selects   */
      if (mode === 'brainstorm') {
        if (dragMovedRef.current) return;
        if (brainstormTool === 'clip') {
          toggleClip(obj.id);
          return;
        }
        if (brainstormTool === 'thread') {
          if (!threadAnchorId) {
            setThreadAnchorId(obj.id);
          } else if (threadAnchorId === obj.id) {
            setThreadAnchorId(null); // tapped the anchor again → let it go
          } else {
            linkThread(threadAnchorId, obj.id);
            setThreadAnchorId(null);
          }
          return;
        }
        // pin tool: just select what was tapped, don't type into it
        setSelectedId(obj.id);
        return;
      }

      // A push-pin never opens a text caret — it's named through its popover.
      if (isPin) {
        setSelectedId(obj.id);
        return;
      }

      /* Instagram-story "tap to cycle shapes" — now MIRRORS ONLY.
         An image used to do this too, and it was the only way to reach the
         masks at all: undiscoverable if you never tried it, and impossible to
         avoid once you had, since every click on a selected picture changed it.
         Images now have an explicit Shape button in the studio that shows all
         ten masks at once, so a click on the picture is free to mean what a
         click on a picture should mean — and a stray one no longer turns your
         screenshot into a heart. A camera mirror has no studio, so it keeps the
         tap. */
      if (obj.type === 'image' || obj.type === 'mirror') {
        if (dragMovedRef.current) return;
        if (obj.type === 'mirror' && isSelected) {
          const next = nextImageShape(obj.style?.mirrorShape as ImageShape | undefined);
          updateObject(obj.id, { style: { ...obj.style, mirrorShape: next } });
        }
        return;
      }

      // If it's a pure click (no drag) and already selected, enter edit mode.
      // Functional blocks (poll, timer, …) edit through their own inline
      // inputs, so the contentEditable edit mode never applies to them.
      const isFunctionalBlock =
        obj.type === 'card' &&
        Object.entries(obj.style || {}).some(([k, v]) => /^is[A-Z]/.test(k) && Boolean(v)) &&
        !obj.style?.isQuote && !obj.style?.isCallout;

      /* An EMPTY block goes straight into edit on the first click, and ONLY an
         empty one. A blank block that never gets typed into is auto-cleaned
         the moment you click away, so making it wait for a double-click means
         the actual experience of adding a card is: click it, click elsewhere,
         watch it vanish, never having been given a chance to write in it.
         There is nothing to select on an empty block anyway.

         A block with words in it is SELECTED by a click and edited by a
         double-click (see handleDoubleClick). One click used to open the caret
         on any selected block, which is why a card you had just written in
         couldn't be picked up — every press after that landed in a text field
         rather than on a block. */
      const isBlank = !(obj.content || '').trim();
      // image & mirror already returned above (they tap-to-cycle, never type).
      // A frame is typed into through its title tab, never its body — clicking
      // the empty middle of an unnamed frame must not open a rename.
      const canType = !isFunctionalBlock && obj.type !== 'frame';

      if (canType && isBlank) {
        caretPoint.current = { x: e.clientX, y: e.clientY };
        setEditingId(obj.id);
      }
    },
    [mode, isEditing, isSelected, obj, setEditingId, updateObject, toggleConnectorSelection, readOnly, isTouring, stackSlot, setSpreadStack, setSelectedId, isPin, brainstormTool, threadAnchorId, setThreadAnchorId, toggleClip, linkThread]
  );

  // Handle unified content saving. Compares against the LIVE stored content
  // (not a captured closure) so a repeat save — StrictMode remount, height
  // churn, blur + unmount both firing — is idempotent and can never write the
  // text on top of itself (the "typing gets doubled" bug).
  const saveContent = useCallback((finalContent: string) => {
    if (obj.style?.isCheckpoint) return;
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    if (!live) return;

    // Bake the typing rhythm into the block. This is the ONE write that can fire
    // even when the text itself is unchanged (e.g. re-opening an ink note and
    // stepping away) — but only when we actually captured something.
    let inkUpdate: Record<string, unknown> | null = null;
    if (inkActiveRef.current && inkRhythmRef.current.length > 0) {
      const rhythm = inkRhythmRef.current.slice(0, finalContent.length);
      inkUpdate = { ...live.style, inkType: true, inkRhythm: rhythm };
    }

    if (finalContent === live.content && !inkUpdate) return;

    const updates: any = { content: finalContent };
    if (inkUpdate) updates.style = inkUpdate;

    // Auto-adjust height for text elements
    if (obj.type === 'text' || obj.type === 'heading' || obj.type === 'workflow-node') {
      if (contentRef.current) {
        const padding = obj.type === 'workflow-node' ? 30 : 10;
        const minHeight = obj.type === 'workflow-node' ? 60 : 30;
        const calculatedHeight = contentRef.current.scrollHeight + padding;
        const baseHeight = obj.style?.isResized ? live.height : minHeight;
        updates.height = Math.max(baseHeight, calculatedHeight);
      }
    }

    updateObject(obj.id, updates);
  }, [obj.id, obj.type, updateObject, obj.style?.isCheckpoint, obj.style?.isResized]);

  /* ---- Truthful heights -------------------------------------------------
     text / heading / sticky blocks grow to fit whatever content they hold, so
     a stored `height` is only a floor — content set programmatically (the AI
     agent, a paste, an import) routinely renders far taller than the height it
     was created with. Left alone, the text spills out of its box and over
     whatever sits below, and every layout consumer (the agent's collision
     solver, the snapshot we hand the model) reasons from a height that was
     never true.

     So measure what actually rendered: publish it to the layout registry, and
     grow the stored height to match. Growth only — a block never shrinks under
     a user's chosen size. Not while editing (the editable element handles its
     own sizing, and the display node isn't mounted). */
  /* Text written on a curve is measured by its CURVE, not by its words — the
     block's box is the coordinate space the path is normalised against, so
     letting it grow to fit would move the line under the letters on every
     keystroke. Every auto-size path below stands down for it. */
  const isPathText = obj.type === 'text' && !!obj.style?.textPath;

  const growsToFit = !isPathText && (obj.type === 'text' || obj.type === 'heading' || obj.type === 'sticky');

  /* A free text block HUGS its text rather than being born at its full wrap
     width. It still wraps at exactly the same column it always did — wrapWidth
     is that column — the box simply doesn't claim all of it until the words
     reach it. Resizing the block by hand pins its width (isResized) and hands
     control back to the user. */
  const autoWidth = obj.type === 'text' && !isPathText && !obj.style?.isResized;
  const wrapWidth = (obj.style?.wrapWidth as number | undefined) ?? TEXT_WRAP_WIDTH;

  /** The block's box follows whatever the text element actually measures. */
  const syncWidth = useCallback(
    (node: HTMLElement | null) => {
      if (!autoWidth || !node) return;
      const inset = node.offsetLeft;
      const needed = Math.min(wrapWidth, Math.ceil(node.offsetWidth + inset * 2));
      if (needed < TEXT_MIN_WIDTH) return;
      const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      if (live && Math.abs(needed - live.width) > 2) {
        updateObject(obj.id, { width: needed });
      }
    },
    [autoWidth, wrapWidth, obj.id, updateObject]
  );

  useEffect(() => {
    const el = displayRef.current;
    // Stand down while the user is dragging the resize handle — otherwise we'd
    // grow the block back on every mousemove and fight their drag. The block
    // re-measures the moment they let go, so text still never ends up clipped.
    if (!growsToFit || isEditing || isResizing || !el || obj.style?.isCheckpoint) return;

    const measure = () => {
      const node = displayRef.current;
      if (!node) return;
      // offsetTop/offsetHeight are LAYOUT px — immune to the canvas's zoom
      // transform — and offsetTop already includes any wrapper padding (the
      // sticky's shell), so mirroring it gives symmetric bottom padding.
      const inset = node.offsetTop;
      const needed = Math.ceil(node.offsetHeight + inset * 2);
      if (needed <= 0) return;

      reportMeasuredHeight(obj.id, needed);

      const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      if (live && needed > live.height + 2) {
        updateObject(obj.id, { height: needed });
      }
      syncWidth(node);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // obj.height is a dependency on purpose: the stored height can be reset out
    // from under us (the IndexedDB load resolving after mount, a collab sync, an
    // undo). Re-measuring whenever it changes means a block ALWAYS ends up tall
    // enough for its text, no matter who last wrote the height.
  }, [growsToFit, isEditing, isResizing, obj.id, obj.content, obj.width, obj.height, obj.style?.fontSize, obj.style?.fontFamily, obj.style?.isCheckpoint, updateObject, syncWidth]);

  useEffect(() => () => forgetMeasuredHeight(obj.id), [obj.id]);

  /* If this block goes away mid-gesture — viewport culling, a collab sync, a
     canvas switch — the drag it was running has nothing left to drive it, but
     its window listeners and rAF loop would keep going. End it on unmount. */
  useEffect(() => () => { if (dragState.endActive) endActiveDrag(); }, []);

  /* ---- Semantic zoom ----------------------------------------------------
     Far enough out, this block stops printing its text and prints what it is
     ABOUT instead (lib/semanticZoom.ts owns that decision).

     The exclusions here are all the same exclusion: a block you are HOLDING is
     not a block you are surveying. Editing it, having it selected, dragging or
     resizing it, or wiring it up in connector mode all mean the real words are
     the point — you can be typing at 30% zoom, and the letters must not turn
     into a summary under the caret. Everything else on the board still
     collapses around it. */
  const isBusy = isEditing || isSelected || isDragging || isResizing || mode === 'connector';
  const semantic = useMemo(
    () => (isBusy ? null : semanticView(obj, camera.zoom)),
    [isBusy, obj, camera.zoom]
  );

  /* Whatever ink the block's own text is drawn in — the gist has to inherit
     it, or a summary goes invisible on exactly the notes whose colour was
     chosen deliberately. A sticky contrasts against its own pastel paper, not
     against the canvas. */
  const semanticInk = useMemo(() => {
    if (!semantic) return '';
    if (obj.type === 'sticky') {
      const bg = (obj.style?.color as string) || '#FEF3C7';
      return /^#/.test(bg)
        ? ensureReadableInk(obj.style?.textColor as string | undefined, bg)
        : readableInk('#FEF3C7');
    }
    if (obj.type === 'card') {
      return (obj.style?.textColor as string | undefined) || 'var(--text-primary)';
    }
    return ensureReadableInk(obj.style?.textColor as string | undefined, paperColor(canvasBackground));
  }, [semantic, obj.type, obj.style?.color, obj.style?.textColor, canvasBackground]);

  useEffect(() => {
    if (isEditing && contentRef.current) {
      const target = contentRef.current as any;
      if ('value' in target) {
        target.value = obj.content || '';
      } else {
        target.innerText = obj.content || '';
      }
      latestContent.current = obj.content || '';

      // Seed ink capture for this editing session. Capture is armed only if the
      // Flow ink toggle is on OR this block was already an ink note (so adding
      // to an old ink note keeps recording its energy).
      const flow = useFlowStore.getState();
      inkActiveRef.current = inkEligible && (flow.enabled && flow.prefs.typingInk || Boolean(obj.style?.inkType));
      inkRhythmRef.current = ((obj.style?.inkRhythm as number[] | undefined) || []).slice();
      inkPrevTextRef.current = obj.content || '';
      inkPrevTsRef.current = 0;

      contentRef.current.focus();

      // A real <input> (the frame's title tab) has no DOM range to aim at —
      // select what's there so a rename can be typed straight over, and bail
      // before the contentEditable caret machinery below.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        caretPoint.current = null;
        target.select();
        return;
      }

      // Put the caret WHERE THE USER CLICKED. Entering edit mode swaps the
      // rendered markup for a raw-text editable, which destroys the browser's
      // own caret placement — so we re-derive it from the click point against
      // the freshly-mounted text. Only when there's no click to honour (slash
      // command, programmatic focus) does the caret fall to the end.
      const sel = window.getSelection();
      const pt = caretPoint.current;
      caretPoint.current = null;

      let placed = false;
      if (pt && sel) {
        const range = caretRangeFromPoint(pt.x, pt.y);
        // Guard: only trust a hit that actually landed inside THIS block.
        if (range && contentRef.current.contains(range.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(range);
          placed = true;
        }
      }

      if (!placed && contentRef.current.childNodes.length > 0) {
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        range.collapse(false); // caret to end
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [isEditing]);

  /* Dictation used to be pushed into this element from here: watch the voice
     store, and whenever the transcript changed, replace the whole block's text
     and shove the caret to the end. It had to go.
     - It subscribed EVERY object on the board to every word spoken, so each
       syllable re-rendered the entire canvas.
     - Rewriting the element wholesale while someone might also be typing in it
       is a fight over the caret that dictation can only win by clobbering.
     Spoken phrases are now typed in at the caret like keystrokes
     (lib/voice/dictation), which the block's own input handler already knows how
     to grow, save and record ink for. Nothing to synchronise. */

  // Track native input for all editable text blocks to keep latestContent in sync and handle slash commands
  useEffect(() => {
    if (!isEditing) return;

    const handleNativeInput = () => {
      if (contentRef.current) {
        const target = contentRef.current as any;
        const text = 'value' in target ? target.value : target.innerText;

        // TYPING AS INK — fold this keystroke's rhythm into the per-char array
        // before latestContent moves on. The interval since the last keystroke
        // becomes the intensity of whatever characters were just added.
        if (inkActiveRef.current) {
          const now = performance.now();
          const dt = inkPrevTsRef.current ? now - inkPrevTsRef.current : 999;
          const intensity = intervalToIntensity(dt);
          inkRhythmRef.current = foldRhythm(inkRhythmRef.current, inkPrevTextRef.current, text, intensity);
          inkPrevTextRef.current = text;
          inkPrevTsRef.current = now;
        }

        latestContent.current = text;

        // A frame's title is a NAME, not prose — "Q1/Q2" or "@team roadmap"
        // must stay typeable without a command palette hijacking the keystroke.
        if (obj.type === 'frame') return;

        // Slash Command Detection: matches a forward slash optionally followed by search query, e.g. "/coun"
        const match = text.match(/(?:^|\s)\/([a-zA-Z]*)$/);
        if (match) {
          const query = match[1] || '';
          const rect = contentRef.current.getBoundingClientRect();
          setSlashMenu({
            objectId: obj.id,
            query: query,
            x: rect.left,
            y: rect.bottom + window.scrollY + 6
          });
        } else {
          // Hide slash menu if no match and it was open for this object
          const currentMenu = useCanvasStore.getState().slashMenu;
          if (currentMenu && currentMenu.objectId === obj.id) {
            setSlashMenu(null);
          }
        }

        // @-mention detection: "@" preceded by start/space, then a bare word
        // (no spaces) at the caret. Opens the block picker; a space cancels it,
        // so "meet @ 5pm" never triggers. Only opens when there's actually
        // another block to link to, so it never captures Enter for nothing.
        const atMatch = text.match(/(?:^|\s)@([\w-]*)$/);
        const hasLinkTarget = atMatch
          ? useCanvasStore.getState().objects.some(
              (o) => o.id !== obj.id && o.type !== 'arrow' && o.type !== 'drawing'
            )
          : false;
        if (atMatch && hasLinkTarget) {
          const rect = contentRef.current.getBoundingClientRect();
          setAtMenu({
            objectId: obj.id,
            query: atMatch[1] || '',
            x: rect.left,
            y: rect.bottom + window.scrollY + 6,
          });
        } else {
          const cur = useCanvasStore.getState().atMenu;
          if (cur && cur.objectId === obj.id) {
            setAtMenu(null);
          }
        }

        // Auto-adjust height during typing!
        if (obj.type === 'text' || obj.type === 'heading' || obj.type === 'workflow-node') {
          const padding = obj.type === 'workflow-node' ? 30 : 10;
          const minHeight = obj.type === 'workflow-node' ? 60 : 30;
          const calculatedHeight = contentRef.current.scrollHeight + padding;
          const baseHeight = obj.style?.isResized ? obj.height : minHeight;
          const newHeight = Math.max(baseHeight, calculatedHeight);
          if (newHeight !== obj.height) {
            updateObject(obj.id, { height: newHeight });
          }
        }
        // …and the width, so the box grows out with the words instead of
        // squatting at its full wrap width from the very first keystroke.
        syncWidth(contentRef.current);

        /* There used to be an 8-second timer here that deleted an empty block
           out from under the caret. It was meant as tidying and read as data
           loss: sit and think about a title, and the box you were about to type
           in disappears while you're looking at it. A blank block is still
           cleaned up — on blur, in the unmount path below — which is the moment
           it's genuinely abandoned rather than merely quiet. */
      }
    };

    // The slash menu's "AI Agent" item seeds "/agent " into this block so the
    // user types the task inline and Enter launches it — no modal.
    const handleSeedAgent = (e: Event) => {
      const detail = (e as CustomEvent<{ objectId: string }>).detail;
      if (detail?.objectId !== obj.id || !contentRef.current) return;
      // Swap the trailing "/query" for "/agent " but keep any text the user
      // already wrote — it becomes reference context when the agent runs.
      let base = contentRef.current.innerText.replace(/(^|\s)\/[a-zA-Z]*\s*$/, '$1');
      if (base && !/\s$/.test(base)) base += ' ';
      contentRef.current.innerText = base + '/agent ';
      latestContent.current = base + '/agent ';
      contentRef.current.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(contentRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    window.addEventListener('seed-agent-prompt', handleSeedAgent);

    // The @-mention menu picks a target block; we swap the trailing "@query" the
    // user typed for a chip token "@[Label](ref:id)" and keep them typing.
    const handleInsertMention = (e: Event) => {
      const detail = (e as CustomEvent<{ objectId: string; targetId: string; label: string }>).detail;
      if (detail?.objectId !== obj.id || !contentRef.current) return;
      const el = contentRef.current;
      const safeLabel = (detail.label || 'link').replace(/[\[\]()\n]/g, '').trim().slice(0, 60) || 'link';
      const token = `@[${safeLabel}](ref:${detail.targetId}) `;
      const cur = el.innerText;
      const replaced = cur.replace(/(^|\s)@[\w-]*$/, (_m, pre) => `${pre}${token}`);
      // If the trailing "@query" was somehow already gone, append rather than lose the link.
      el.innerText = replaced === cur ? (cur + (cur && !/\s$/.test(cur) ? ' ' : '') + token) : replaced;
      latestContent.current = el.innerText;
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      setAtMenu(null);
    };
    window.addEventListener('insert-mention', handleInsertMention);

    const handleNativeKeyDown = (e: KeyboardEvent) => {
      // Intercept Enter for inline /agent (or /ai) commands. The command may sit
      // mid-text: everything before it becomes reference context the agent works
      // on, and the block keeps that original text.
      if (e.key === 'Enter' && !e.shiftKey) {
        const text = latestContent.current;
        const match = text.match(/(^|\s)\/(?:agent|ai)\s+([\s\S]+)$/i);
        if (match && match[2].trim()) {
          e.preventDefault();
          e.stopPropagation();

          const prompt = match[2].trim();
          const before = text.slice(0, match.index ?? 0).trimEnd();

          // Strip the command, keep whatever the user was writing
          if (contentRef.current) {
            contentRef.current.innerText = before;
          }
          latestContent.current = before;
          setEditingId(null);

          // Dispatch custom window event to trigger background AI agent
          window.dispatchEvent(new CustomEvent('run-agent', {
            detail: {
              prompt,
              apiKeyIndex: 0, // Default to first Nvidia key
              x: obj.x,
              y: obj.y,
              context: before || undefined,
            }
          }));
          return;
        }

        // Notion-style list continuation: pressing Enter inside a bullet /
        // numbered / to-do / callout line starts the next item automatically;
        // pressing Enter on an EMPTY item exits the list. Applies when the caret
        // is at the end of the text (the normal list-typing flow).
        if (obj.type === 'text' || obj.type === 'card' || obj.type === 'sticky') {
          const el = contentRef.current;
          if (el) {
            const full = el.innerText;
            const sel = window.getSelection();
            const caretAtEnd = (() => {
              if (!sel || sel.rangeCount === 0) return true;
              const r = sel.getRangeAt(0);
              const tail = r.cloneRange();
              tail.selectNodeContents(el);
              try { tail.setStart(r.endContainer, r.endOffset); } catch { return true; }
              return tail.toString().trim() === '';
            })();
            const curLine = full.slice(full.lastIndexOf('\n') + 1);

            // Toggle header (▸ / >> ): Enter drops the caret into an indented
            // body line, so its collapsible detail is trivial to start typing.
            const tgl = curLine.match(/^([ \t]*)(?:▸|▾|>>)\s+(.*)$/);
            if (caretAtEnd && tgl) {
              e.preventDefault();
              e.stopPropagation();
              if (tgl[2].trim() === '') {
                // Empty toggle header → drop the marker and leave.
                for (let d = 0; d < curLine.length; d++) document.execCommand('delete', false);
              } else {
                document.execCommand('insertText', false, '\n' + tgl[1] + '  ');
              }
              latestContent.current = el.innerText;
              return;
            }

            const lm = curLine.match(/^(\s*)([-*•]|\d+\.|\[[ xX]?\]|>)\s(.*)$/);
            if (caretAtEnd && lm) {
              e.preventDefault();
              e.stopPropagation();
              const [, indent, marker, rest] = lm;
              if (rest.trim() === '') {
                // Empty item → drop the marker and leave the list.
                for (let d = 0; d < curLine.length; d++) document.execCommand('delete', false);
              } else {
                let next: string;
                if (/^\d+\.$/.test(marker)) next = `${parseInt(marker, 10) + 1}. `;
                else if (marker.startsWith('[')) next = '[] ';
                else if (marker === '>') next = '> ';
                else next = `${marker} `;
                document.execCommand('insertText', false, '\n' + indent + next);
              }
              latestContent.current = el.innerText;
              return;
            }

            // Plain but indented line (e.g. a toggle's body paragraph): keep the
            // indentation on Enter so the text stays inside its toggle instead of
            // dedenting out. An empty indented line falls through to a normal
            // newline — the natural "press Enter again to exit" gesture.
            const indentCont = curLine.match(/^([ \t]{2,})\S/);
            if (caretAtEnd && indentCont) {
              e.preventDefault();
              e.stopPropagation();
              document.execCommand('insertText', false, '\n' + indentCont[1]);
              latestContent.current = el.innerText;
              return;
            }
          }
        }

        // A bare URL typed into a text/heading block becomes a rich link
        // preview: blank this block (it auto-cleans) and drop a loading link
        // card in its place, which then hydrates its own thumbnail.
        if ((obj.type === 'text' || obj.type === 'heading') && isUrl(latestContent.current.trim())) {
          e.preventDefault();
          e.stopPropagation();
          const link = latestContent.current.trim();
          setSlashMenu(null);
          if (contentRef.current) contentRef.current.innerText = '';
          latestContent.current = '';
          setEditingId(null);
          useCanvasStore.getState().addObject(newLinkCard(link, obj.x, obj.y));
          return;
        }
      }

      // @-mention menu navigation (mirrors the slash menu). Handled first so its
      // Enter/arrows drive the picker instead of the block.
      const atMenuNow = useCanvasStore.getState().atMenu;
      if (atMenuNow && atMenuNow.objectId === obj.id) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          let ev = 'at-menu-down';
          if (e.key === 'ArrowUp') ev = 'at-menu-up';
          if (e.key === 'Enter') ev = 'at-menu-select';
          window.dispatchEvent(new CustomEvent(ev));
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setAtMenu(null);
          return;
        }
      }

      const currentMenu = useCanvasStore.getState().slashMenu;
      if (!currentMenu || currentMenu.objectId !== obj.id) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();

        let eventName = 'slash-menu-down';
        if (e.key === 'ArrowUp') eventName = 'slash-menu-up';
        if (e.key === 'Enter') eventName = 'slash-menu-select';

        window.dispatchEvent(new CustomEvent(eventName));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSlashMenu(null);
      }
    };

    const ref = contentRef.current;
    if (ref) {
      ref.addEventListener('input', handleNativeInput);
      ref.addEventListener('keydown', handleNativeKeyDown);
    }

    return () => {
      window.removeEventListener('seed-agent-prompt', handleSeedAgent);
      window.removeEventListener('insert-mention', handleInsertMention);
      if (ref) {
        ref.removeEventListener('input', handleNativeInput);
        ref.removeEventListener('keydown', handleNativeKeyDown);

        // Save the content on edit end / unmount!
        if (!obj.style?.isCheckpoint) {
          const finalContent = latestContent.current;
          saveContent(finalContent);

          // Auto-remove empty text/heading blocks when editing actually ends
          const state = useCanvasStore.getState();
          const isStillEditing = state.editingId === obj.id;
          const isStillSelected = state.selectedId === obj.id;
          if (!isStillEditing && !isStillSelected && !isDictationTarget(obj.id)) {
            const shouldDelete = finalContent.trim() === '' && isAutoCleanable(obj);
            if (shouldDelete) {
              removeObject(obj.id);
            }
          }
        }
      }
      // Cleanup the slash menu if it was opened by this object
      const currentMenu = useCanvasStore.getState().slashMenu;
      if (currentMenu && currentMenu.objectId === obj.id) {
        setSlashMenu(null);
      }
      // …and the @-mention menu.
      const currentAt = useCanvasStore.getState().atMenu;
      if (currentAt && currentAt.objectId === obj.id) {
        setAtMenu(null);
      }
    };
  }, [isEditing, obj.id, obj.type, removeObject, editingId, setEditingId, obj.height, updateObject, setSlashMenu, setAtMenu, saveContent, syncWidth]);

  const handleBlur = useCallback(() => {
    if (editingId === obj.id) {
      setEditingId(null);
    }
  }, [obj.id, editingId, setEditingId]);





  // Render content based on type
  const renderContent = () => {
    // The resolved canvas "paper" color — used to auto-contrast free text so it
    // never becomes invisible when the canvas background changes.
    const canvasPaper = paperColor(canvasBackground);
    const freeInk = ensureReadableInk(obj.style?.textColor as string | undefined, canvasPaper);
    switch (obj.type) {
      case 'pin': {
        // A push-pin: glossy dome head over a needle stuck into the board.
        const head = (obj.style?.pinColor as string) || DEFAULT_PIN_COLOR;
        const shade = pinShade(head);
        return (
          <div className="w-full h-full" style={{ pointerEvents: 'none' }}>
            <svg
              viewBox="0 0 40 40"
              width="100%"
              height="100%"
              style={{ overflow: 'visible', filter: 'drop-shadow(0 3px 2.5px rgba(45,42,38,0.32))' }}
            >
              {/* needle into the cork */}
              <path d="M20 21 L20 39" stroke="#8b9096" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M20 22 L20 36" stroke="#e6e9ec" strokeWidth="0.8" strokeLinecap="round" />
              {/* collar under the head */}
              <ellipse cx="20" cy="20.5" rx="4.8" ry="2.4" fill={shade} />
              {/* dome head */}
              <circle cx="20" cy="13" r="10.6" fill={head} />
              <circle cx="20" cy="13" r="10.6" fill="none" stroke={shade} strokeWidth="1.3" />
              {/* glossy highlight */}
              <ellipse cx="16" cy="9.4" rx="4.1" ry="2.9" fill="#ffffff" opacity="0.5" />
            </svg>
          </div>
        );
      }
      case 'arrow': {
        const startX = obj.style?.startX as number || 0;
        const startY = obj.style?.startY as number || 0;
        const endX = obj.style?.endX as number || 0;
        const endY = obj.style?.endY as number || 0;
        const hasBend = obj.style?.bendX !== undefined && obj.style?.bendY !== undefined;
        const bendWX = obj.style?.bendX as number;
        const bendWY = obj.style?.bendY as number;

        // Map every world point relative to the object's own origin so the curve,
        // the label and the drag handles all line up even when the bend pushes
        // the drawing outside the nominal bounding box (SVG is overflow-visible).
        const localX1 = startX - obj.x;
        const localY1 = startY - obj.y;
        const localX2 = endX - obj.x;
        const localY2 = endY - obj.y;
        const localBendX = hasBend ? bendWX - obj.x : (localX1 + localX2) / 2;
        const localBendY = hasBend ? bendWY - obj.y : (localY1 + localY2) / 2;

        const color = (obj.style?.color as string) || 'var(--accent)';
        const thickness = (obj.style?.thickness as number) || 3;
        const pointerType = (obj.style?.pointerType as string) || 'line';
        const arrowDash = obj.style?.dashStyle === 'dashed' ? '8,6' : obj.style?.dashStyle === 'dotted' ? '2,4' : undefined;
        const arrowMarker =
          pointerType === 'arrow' ? `url(#arrow-head-${obj.id})` :
          pointerType === 'dot' ? `url(#dot-head-${obj.id})` :
          pointerType === 'diamond' ? `url(#diamond-head-${obj.id})` : undefined;

        return (
          <div className="w-full h-full relative" style={{ overflow: 'visible', pointerEvents: 'none' }}>
            <svg className="w-full h-full overflow-visible pointer-events-none">
              <defs>
                <marker 
                  id={`arrow-head-${obj.id}`} 
                  markerWidth="8" 
                  markerHeight="8" 
                  refX="6" 
                  refY="4" 
                  orient="auto" 
                  markerUnits="strokeWidth"
                >
                  <path d="M0,1 L8,4 L0,7 Z" fill={color} />
                </marker>
                <marker 
                  id={`dot-head-${obj.id}`} 
                  markerWidth="8" 
                  markerHeight="8" 
                  refX="4" 
                  refY="4" 
                  orient="auto" 
                  markerUnits="strokeWidth"
                >
                  <circle cx="4" cy="4" r="3" fill={color} />
                </marker>
                <marker 
                  id={`diamond-head-${obj.id}`} 
                  markerWidth="8" 
                  markerHeight="8" 
                  refX="4" 
                  refY="4" 
                  orient="auto" 
                  markerUnits="strokeWidth"
                >
                  <polygon points="4,1 7,4 4,7 1,4" fill={color} />
                </marker>
              </defs>
              {hasBend ? (
                <path
                  d={`M ${localX1} ${localY1} Q ${localBendX} ${localBendY} ${localX2} ${localY2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={arrowDash}
                  markerEnd={arrowMarker}
                />
              ) : (
                <line
                  x1={localX1}
                  y1={localY1}
                  x2={localX2}
                  y2={localY2}
                  stroke={color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={arrowDash}
                  markerEnd={arrowMarker}
                />
              )}
            </svg>

            {/* Draggable control points (only while this arrow is selected). Drag
                the ends to re-aim; drag the middle dot to bend it into a curve. */}
            {isSelected && (
              <>
                {([
                  { key: 'start', lx: localX1, ly: localY1, bend: false },
                  { key: 'end', lx: localX2, ly: localY2, bend: false },
                  { key: 'bend', lx: localBendX, ly: localBendY, bend: true },
                ] as const).map((h) => (
                  <div
                    key={h.key}
                    onMouseDown={(e) => handleArrowPointDrag(e, h.key)}
                    onDoubleClick={(e) => { e.stopPropagation(); if (h.bend) updateObject(obj.id, { style: { ...obj.style, bendX: undefined, bendY: undefined } }); }}
                    title={h.bend ? (hasBend ? 'Drag to bend · double-click to straighten' : 'Drag to bend') : 'Drag endpoint'}
                    className="absolute z-30 rounded-full pointer-events-auto"
                    style={{
                      left: h.lx, top: h.ly,
                      width: h.bend ? 11 : 12, height: h.bend ? 11 : 12,
                      transform: 'translate(-50%, -50%)',
                      cursor: 'grab',
                      background: h.bend ? (hasBend ? 'var(--accent)' : 'transparent') : '#fff',
                      border: `2px solid var(--accent)`,
                      opacity: h.bend && !hasBend ? 0.55 : 1,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                    }}
                  />
                ))}
              </>
            )}

            {/* An arrow used to carry a label box pinned to its midpoint, and
                placing one dropped you straight into typing it. A connector
                says "this leads to that" — the meaning is in the two things it
                joins, and the box only ever sat on top of them. Gone; write a
                text block beside the line if the link needs a name. */}
          </div>
        );
      }

      case 'frame': {
        const kind = getFrameKind(obj);
        const frameColor = frameColorOf(obj);
        const meta = frameKindMeta(kind);
        const captured = kind === 'normal' ? 0 : objectsInFrame(objects, obj).length;

        /* During a tour, a tool frame is scaffolding, not content — a scene
           frame would otherwise present its own blue outline and a title tab
           duplicating the slide heading right on top of the slide. A plain
           grouping frame stays: that one is a deliberate visual, not a control. */
        if (isTouring && kind !== 'normal') return null;

        /* Each kind reads differently at a glance. A delete frame in particular
           must never be mistakable for a grouping frame, so it gets the
           heaviest treatment: solid red rule and a warning wash. */
        const borderStyle =
          kind === 'delete' ? `2.5px solid ${frameColor}AA`
          : kind === 'scene' ? `2px solid ${frameColor}80`
          : kind === 'agent' ? `2px dashed ${frameColor}99`
          : `2px dashed ${frameColor}66`;

        return (
          <div
            className="w-full h-full rounded-[22px] relative"
            style={{
              border: borderStyle,
              background: kind === 'delete' ? `${frameColor}14` : `${frameColor}0C`,
            }}
          >
            {/* Title tab. This is the rename affordance — it used to be an
                11px pill whose editable collapsed to zero width when the name
                was empty, so "double-click the frame to rename" put a caret
                nobody could see, on a frame that is mostly covered by its own
                contents anyway. Now it's a real, hit-testable control that
                says what it does. */}
            <div
              className="absolute -top-[15px] left-4 flex items-center gap-1.5 rounded-full shadow-sm max-w-[88%] group/frametab"
              style={{ background: frameColor, color: '#fff', padding: '3px 10px' }}
              title={isEditing ? undefined : `${meta.label} frame — click the name to rename`}
              onMouseDown={(e) => {
                // Never let a rename click start a frame drag.
                if (isEditing) e.stopPropagation();
              }}
              onDoubleClick={(e) => {
                if (readOnly) return;
                e.stopPropagation();
                setEditingId(obj.id);
              }}
              onClick={(e) => {
                if (readOnly || isEditing) return;
                // The tab doubles as the frame's drag handle, so a click that
                // actually moved the frame must not also open a rename.
                if (dragMovedRef.current) return;
                e.stopPropagation();
                setEditingId(obj.id);
              }}
            >
              <FrameKindGlyph kind={kind} />
              {isEditing ? (
                <input
                  ref={contentRef as unknown as React.Ref<HTMLInputElement>}
                  onBlur={handleBlur}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="Name this frame…"
                  className="bg-transparent outline-none border-none text-[11px] font-bold text-white placeholder:text-white/60"
                  style={{ minWidth: 130, width: `${Math.max(130, (obj.content || '').length * 7 + 24)}px` }}
                />
              ) : (
                <span className="whitespace-nowrap text-[11px] font-bold cursor-text">
                  {(obj.content || '').trim() || (
                    <span className="text-white/70">Name this frame…</span>
                  )}
                </span>
              )}
              {captured > 0 && !isEditing && (
                <span
                  className="rounded-full text-[9px] font-extrabold tabular-nums shrink-0"
                  style={{ background: 'rgba(255,255,255,0.24)', padding: '1px 6px' }}
                  title={`${captured} block${captured === 1 ? '' : 's'} inside this frame`}
                >
                  {captured}
                </span>
              )}
            </div>
          </div>
        );
      }

      case 'browser': {
        const { tabs, activeId } = readBrowserTabs(obj);
        const activeTab = tabs.find((t) => t.id === activeId) || tabs[0];
        const activeUrl = activeTab.url;
        const activeLoading = !!loadingTabs[activeId];

        const stop = (e: React.MouseEvent) => e.stopPropagation();

        const persistTabs = (nextTabs: BrowserTab[], nextActive: string) => {
          const activeUrlNext = nextTabs.find((t) => t.id === nextActive)?.url;
          updateObject(obj.id, {
            content: activeUrlNext || obj.content,
            style: { ...(obj.style || {}), tabs: nextTabs, activeTab: nextActive },
          });
        };

        /** Point the active tab at a URL, without touching its history. */
        const showUrl = (val: string) => {
          setTabLoading(activeId, true);
          persistTabs(tabs.map((t) => (t.id === activeId ? { ...t, url: val, title: '' } : t)), activeId);
        };

        const reload = () => {
          setTabLoading(activeId, true);
          setReloadKeys((m) => ({ ...m, [activeId]: (m[activeId] || 0) + 1 }));
        };

        const history = (browserHistory.current[activeId] ??= {
          stack: activeUrl ? [activeUrl] : [],
          idx: activeUrl ? 0 : -1,
        });

        const navigate = (raw: string) => {
          const val = normalizeBrowserUrl(raw);
          if (!val) return;
          setBrowserDraftFocused(false);
          if (val === activeTab.url) {
            reload();
            return;
          }
          // A new address truncates any forward history, exactly like a browser.
          history.stack = [...history.stack.slice(0, history.idx + 1), val];
          history.idx = history.stack.length - 1;
          showUrl(val);
        };

        const goBack = () => {
          if (history.idx <= 0) return;
          history.idx -= 1;
          showUrl(history.stack[history.idx]);
        };
        const goForward = () => {
          if (history.idx >= history.stack.length - 1) return;
          history.idx += 1;
          showUrl(history.stack[history.idx]);
        };

        const selectTab = (id: string) => {
          setBrowserDraftFocused(false);
          persistTabs(tabs, id);
        };
        const addTab = () => {
          const id = 't-' + Math.random().toString(36).slice(2, 9);
          setBrowserDraftFocused(false);
          persistTabs([...tabs, { id, url: '', title: 'New Tab' }], id);
        };
        const closeTab = (id: string) => {
          if (tabs.length <= 1) return;
          const idx = tabs.findIndex((t) => t.id === id);
          const nextTabs = tabs.filter((t) => t.id !== id);
          const nextActive = id === activeId ? nextTabs[Math.max(0, idx - 1)].id : activeId;
          persistTabs(nextTabs, nextActive);
        };

        // Pull the page's images and paragraphs onto the canvas as real objects.
        // A cross-origin iframe is opaque to us, so the server reads the page.
        const runExtract = async () => {
          if (!activeUrl || browserExtracting) return;
          setBrowserExtracting(true);
          try {
            const res = await fetch(`/api/browser?action=extract&url=${encodeURIComponent(activeUrl)}`);
            const data: BrowserExtract | null = res.ok ? await res.json() : null;
            const images = data?.images || [];
            const texts = data?.texts || [];
            let n = 0;
            const place = () => {
              const spot = {
                x: obj.x + obj.width + 48 + (n % 2) * 320,
                y: obj.y + Math.floor(n / 2) * 260,
              };
              n++;
              return spot;
            };
            images.slice(0, 6).forEach((img) => {
              const ratio = img.w && img.h ? img.h / img.w : 0.66;
              const { x, y } = place();
              addObject({
                type: 'image',
                x,
                y,
                width: 280,
                height: Math.max(80, Math.round(280 * ratio)),
                content: img.src,
              });
            });
            texts.slice(0, 4).forEach((text) => {
              const { x, y } = place();
              addObject({
                type: 'sticky',
                x,
                y,
                width: 240,
                height: 200,
                content: text,
                style: { color: randomStickyColor() },
              });
            });
          } finally {
            setBrowserExtracting(false);
          }
        };

        const btn =
          'w-7 h-7 flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/70 transition-colors disabled:opacity-30 disabled:pointer-events-none';
        const inputValue = browserDraftFocused ? browserUrlDraft : activeUrl;

        // Swallow page interaction while the block is being manipulated or is
        // not the active selection (first click selects, then you can surf).
        const interactionBlocked = isDragging || isResizing || !isSelected;

        const quickLinks = [
          { label: 'Bing', url: 'https://www.bing.com' },
          { label: 'Wikipedia', url: 'https://www.wikipedia.org' },
          { label: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
          { label: 'Hacker News', url: 'https://news.ycombinator.com' },
        ];

        return (
          <div className="w-full h-full flex flex-col rounded-xl overflow-hidden border border-[var(--border-strong)] bg-white shadow-xl">
            {/* Tab strip */}
            <div className="h-8 shrink-0 bg-neutral-200/70 flex items-stretch gap-1 px-1.5 pt-1 overflow-x-auto">
              {tabs.map((t) => {
                const active = t.id === activeId;
                return (
                  <div
                    key={t.id}
                    onMouseDown={(e) => { stop(e); selectTab(t.id); }}
                    title={t.url || 'New Tab'}
                    className={`group/tab flex items-center gap-1.5 pl-2.5 pr-1.5 max-w-[160px] min-w-[90px] rounded-t-lg text-[11px] cursor-pointer transition-colors ${
                      active ? 'bg-white text-neutral-800 shadow-sm' : 'bg-neutral-300/40 text-neutral-500 hover:bg-neutral-300/70'
                    }`}
                  >
                    {t.url ? (
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(t.url).hostname; } catch { return ''; } })()}&sz=32`}
                        alt=""
                        width={12}
                        height={12}
                        className="shrink-0 rounded-sm"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    ) : (
                      <svg className="shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                    )}
                    <span className="truncate flex-1 font-medium">{browserTabLabel(t)}</span>
                    {tabs.length > 1 && (
                      <button
                        onMouseDown={(e) => { stop(e); closeTab(t.id); }}
                        className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-neutral-400/40 opacity-60 group-hover/tab:opacity-100"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onMouseDown={(e) => { stop(e); addTab(); }}
                title="New tab"
                className="shrink-0 w-6 h-6 my-auto flex items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-300/60 hover:text-neutral-800"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            </div>

            {/* Chrome / toolbar — also the drag handle */}
            <div className="h-10 shrink-0 bg-neutral-100 flex items-center px-2 gap-1 border-b border-neutral-200">
              <button className={btn} title="Back" disabled={history.idx <= 0} onMouseDown={stop} onClick={goBack}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button className={btn} title="Forward" disabled={history.idx >= history.stack.length - 1} onMouseDown={stop} onClick={goForward}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
              <button className={btn} title="Reload" onMouseDown={stop} onClick={reload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              </button>

              <div className="flex-1 relative mx-1">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setBrowserUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      navigate(browserUrlDraft);
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setBrowserDraftFocused(false);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onMouseDown={stop}
                  onFocus={(e) => { setBrowserDraftFocused(true); setBrowserUrlDraft(activeUrl); e.currentTarget.select(); }}
                  onBlur={() => setBrowserDraftFocused(false)}
                  spellCheck={false}
                  placeholder="Search or enter address"
                  className="w-full bg-white border border-neutral-200 rounded-full pl-8 pr-3 py-1 text-xs text-neutral-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 font-medium truncate"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {activeLoading && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-neutral-300 border-t-blue-500 rounded-full animate-spin" />
                )}
              </div>

              <button
                className={`${btn} ${browserExtracting ? 'bg-blue-500 text-white hover:bg-blue-600 hover:text-white' : ''}`}
                title={!activeUrl ? 'Nothing to extract yet' : 'Pull this page\'s images & text onto the canvas'}
                disabled={!activeUrl || browserExtracting}
                onMouseDown={stop}
                onClick={runExtract}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
              </button>
              <button
                className={btn}
                title="Open in a real browser tab"
                onMouseDown={stop}
                onClick={() => activeUrl && window.open(activeUrl, '_blank', 'noopener')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              </button>
            </div>

            {/* Viewport — one iframe per tab, kept mounted so switching tabs
                doesn't throw away the page (or restart a video) you left behind. */}
            <div className="flex-1 relative bg-white overflow-hidden">
              {tabs.map((t) => {
                const active = t.id === activeId;
                if (!t.url) {
                  // Blank "new tab" start page.
                  return active ? (
                    <div key={t.id} className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-neutral-50 to-neutral-100 text-neutral-500">
                      <div className="text-2xl font-bold text-neutral-700 tracking-tight">Start surfing</div>
                      <div className="text-xs">Type a URL or search in the bar above, or jump to:</div>
                      <div className="flex flex-wrap gap-2 justify-center max-w-[80%]">
                        {quickLinks.map((q) => (
                          <button
                            key={q.url}
                            onMouseDown={(e) => { stop(e); navigate(q.url); }}
                            className="px-3 py-1.5 rounded-full bg-white border border-neutral-200 text-xs font-medium text-neutral-700 hover:border-blue-400 hover:text-blue-600 shadow-sm"
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                }
                return (
                  <div key={t.id} style={{ visibility: active ? 'visible' : 'hidden', zIndex: active ? 1 : 0 }} className="absolute inset-0 w-full h-full bg-white">
                    <BrowserView
                      id={t.id}
                      url={t.url}
                      reloadKey={reloadKeys[t.id] || 0}
                      onLoading={setTabLoading}
                    />
                  </div>
                );
              })}
              {browserExtracting && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-blue-500 text-white text-[11px] font-semibold shadow-lg pointer-events-none">
                  Pulling images & text onto the canvas…
                </div>
              )}
              {interactionBlocked && (
                // Transparent shield: swallows page events while dragging /
                // resizing, and lets a first click select the block.
                <div className="absolute inset-0 z-20" style={{ cursor: isSelected ? 'default' : 'pointer' }} />
              )}
            </div>
          </div>
        );
      }

      case 'text':
        /* Written on a curve: a different renderer entirely (its own SVG, its
           own caret, its own handles). It stays a `text` object so that drag,
           resize, delete, undo, collab and export need to know nothing about
           it — see lib/textPath.ts. */
        if (isPathText) {
          return <TextPathBlock obj={obj} isSelected={isSelected} isEditing={isEditing} />;
        }
        return isEditing ? (
          <div
            key="edit"
            ref={contentRef}
            className="text-block-editable animate-fade-in"
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={handleBlur}
            data-placeholder="Start typing..."
            style={{
              fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '15px',
              fontFamily: isInkBlock ? INK_FONT : (obj.style?.fontFamily as string) || "'Inter', sans-serif",
              fontWeight: (obj.style?.fontWeight as number | undefined) ?? undefined,
              textAlign: (obj.style?.textAlign as any) || undefined,
              color: freeInk,
              lineHeight: '1.7',
              // Hug the text, wrap at the wrap width. The BLOCK then follows this
              // element's measured size (see the width sync below), instead of
              // sitting at a fixed 900px from the moment it's created.
              ...(autoWidth ? { width: 'max-content', maxWidth: wrapWidth } : null),
            }}
          />
        ) : (
          <div
            key="display"
            ref={displayRef}
            className="text-block-display break-words select-none"
            style={{
              fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '15px',
              fontFamily: isInkBlock ? INK_FONT : (obj.style?.fontFamily as string) || "'Inter', sans-serif",
              fontWeight: (obj.style?.fontWeight as number | undefined) ?? undefined,
              textAlign: (obj.style?.textAlign as any) || undefined,
              color: freeInk,
              lineHeight: '1.7',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(autoWidth ? { width: 'max-content', maxWidth: wrapWidth } : null),
            }}
          >
            {isInkBlock ? (
              <InkText content={obj.content || ''} rhythm={obj.style?.inkRhythm as number[] | undefined} />
            ) : (
              <AnimatedText content={obj.content || ''} anim={obj.style?.textAnim}>
                <RichText
                  content={obj.content || ''}
                  persistedCollapsed={obj.style?.toggleCollapsed as Record<string, boolean> | undefined}
                  onCollapseChange={(next) => updateObject(obj.id, { style: { ...obj.style, toggleCollapsed: next } })}
                />
              </AnimatedText>
            )}
          </div>
        );

      case 'heading':
        return (
          <div className="relative group">
            {isEditing ? (
              <div
                key="edit"
                ref={contentRef}
                contentEditable={isEditing}
                suppressContentEditableWarning
                onBlur={handleBlur}
                className="text-block-editable"
                style={{
                  fontFamily: isInkBlock ? INK_FONT : (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '2.2rem',
                  fontWeight: (obj.style?.fontWeight as number | undefined) ?? 500,
                  textAlign: (obj.style?.textAlign as any) || undefined,
                  lineHeight: 1.2,
                  color: freeInk,
                }}
              />
            ) : (
              <div
                key="display"
                ref={displayRef}
                className="text-block-display select-none"
                style={{
                  fontFamily: isInkBlock ? INK_FONT : (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '2.2rem',
                  fontWeight: (obj.style?.fontWeight as number | undefined) ?? 500,
                  textAlign: (obj.style?.textAlign as any) || undefined,
                  lineHeight: 1.2,
                  color: freeInk,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {isInkBlock ? (
                  <InkText content={obj.content || ''} rhythm={obj.style?.inkRhythm as number[] | undefined} />
                ) : (
                  <AnimatedText content={obj.content || ''} anim={obj.style?.textAnim}>
                    <RichText content={obj.content || ''} />
                  </AnimatedText>
                )}
              </div>
            )}
            <div
              className="absolute -bottom-2 left-0 h-[2px] bg-gradient-to-r from-[var(--accent)] to-transparent opacity-30"
              style={{ width: '60%' }}
            />
            <div className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity text-xs text-[var(--text-tertiary)] cursor-pointer">
              ↵
            </div>
          </div>
        );

      case 'sticky': {
        // Sticky backgrounds are light pastels; its ink must contrast with the
        // STICKY, not the canvas theme (otherwise light text on a light note is
        // invisible when the canvas is dark).
        const stickyBg = (obj.style?.color as string) || '#FEF3C7';
        const stickyInk = /^#/.test(stickyBg)
          ? ensureReadableInk(obj.style?.textColor as string | undefined, stickyBg)
          : readableInk('#FEF3C7');
        return (
          <div
            className="sticky-note"
            style={{
              background: (obj.style?.color as string) || 'var(--sticky-yellow)',
              width: '100%',
              height: '100%',
              color: stickyInk,
            }}
          >
            {isEditing ? (
              <div
                key="edit"
                ref={contentRef}
                contentEditable={isEditing}
                suppressContentEditableWarning
                onBlur={handleBlur}
                className="text-block-editable"
                data-placeholder="Note..."
                style={{
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                  width: '100%',
                  height: '100%',
                  padding: '12px',
                  color: stickyInk,
                }}
              />
            ) : (
              <div
                key="display"
                ref={displayRef}
                className="text-block-display select-none"
                style={{
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  padding: '12px',
                  color: stickyInk,
                }}
              >
                <AnimatedText content={obj.content || ''} anim={obj.style?.textAnim}>
                  <RichText
                    content={obj.content || ''}
                    persistedCollapsed={obj.style?.toggleCollapsed as Record<string, boolean> | undefined}
                    onCollapseChange={(next) => updateObject(obj.id, { style: { ...obj.style, toggleCollapsed: next } })}
                  />
                </AnimatedText>
              </div>
            )}
          </div>
        );
      }

      case 'card':
        if (obj.style?.isBinder) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <BinderBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isWhiteboard) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <WhiteboardBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isVoiceNote) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <VoiceNoteBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isFile) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <FileBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isMap) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <MapBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isWeather) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <WeatherBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isMermaid) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <MermaidBlock obj={obj} isEditing={isEditing} onBlur={handleBlur} innerRef={contentRef as any} />
            </div>
          );
        }
        if (obj.style?.isCheckpoint) {
          return (
            <div className="flex items-center gap-2.5 w-full h-full px-3 py-1.5 bg-[var(--bg-glass)] backdrop-blur-xl rounded-full border border-white/20 shadow-sm pointer-events-auto transition-all hover:bg-white/30 hover:border-white/40">
              <div 
                className="flex items-center justify-center cursor-pointer hover:scale-115 transition-transform text-[var(--accent)]"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDragging) return;
                  const camX = window.innerWidth / 2 - (obj.x + obj.width/2) * camera.zoom;
                  const camY = window.innerHeight / 2 - (obj.y + obj.height/2) * camera.zoom;
                  useCanvasStore.getState().animateCamera({ x: camX, y: camY, zoom: camera.zoom });
                }}
                title="Bounce to Checkpoint"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                  <line x1="8" y1="2" x2="8" y2="18"></line>
                  <line x1="16" y1="6" x2="16" y2="22"></line>
                </svg>
              </div>
              <input
                type="text"
                value={obj.content || ''}
                onChange={(e) => {
                  latestContent.current = e.target.value;
                  updateObject(obj.id, { content: e.target.value });
                }}
                placeholder="Checkpoint name..."
                className="bg-transparent border-none outline-none text-xs font-semibold text-[var(--text-primary)] w-full placeholder:opacity-40"
                style={{ fontFamily: "'Outfit', sans-serif" }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
          );
        }
        if (obj.style?.isCountdown) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <CountdownBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isPoll) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <PollBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isLiveMetric) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <LiveMetricBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isChart) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <ChartBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isQuickData) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <QuickDataBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isRoadmap) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <RoadmapBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isTable) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <TableBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isTimeline) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <TimelineBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isTimer) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <FocusTimerBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isDecision) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <DecisionBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isProgress) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <ProgressBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isTodo) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <TodoBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isRepo) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <RepoExplorerBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isCode) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <CodeSandboxBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isLinkPreview) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <LinkPreviewBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isEmbed) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <EmbedBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isGithub) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <GitHubBlock obj={obj} />
            </div>
          );
        }
        if (obj.style?.isQuote) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <QuoteBlock
                obj={obj}
                isEditing={isEditing}
                onBlur={handleBlur}
                innerRef={contentRef}
              />
            </div>
          );
        }
        if (obj.style?.isCallout) {
          return (
            <div style={{ width: '100%', height: '100%' }}>
              <CalloutBlock
                obj={obj}
                isEditing={isEditing}
                onBlur={handleBlur}
                innerRef={contentRef}
              />
            </div>
          );
        }
        return (
          <div className="floating-card animate-fade-in" style={{ width: '100%', height: '100%', padding: '16px 18px' }}>
            {isEditing ? (
              <div
                key="edit"
                ref={contentRef}
                contentEditable={isEditing}
                suppressContentEditableWarning
                onBlur={handleBlur}
                className="text-block-editable"
                data-placeholder="Write something..."
                style={{
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                }}
              />
            ) : (
              <div
                key="display"
                className="text-block-display select-none"
                style={{
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <AnimatedText content={obj.content || ''} anim={obj.style?.textAnim}>
                  <RichText
                    content={obj.content || ''}
                    persistedCollapsed={obj.style?.toggleCollapsed as Record<string, boolean> | undefined}
                    onCollapseChange={(next) => updateObject(obj.id, { style: { ...obj.style, toggleCollapsed: next } })}
                  />
                </AnimatedText>
              </div>
            )}
          </div>
        );
      case 'shape':
        {
          const shapeType = (obj.style?.shapeType as string) || 'square';

          // Define shape color from style, otherwise use default themes
          const shapeBg = (obj.style?.color as string) || 'var(--bg-glass)';
          const shapeBorder = (obj.style?.borderColor as string) || 'var(--accent-light)';

          // Selection-panel controls: stroke width, stroke style (dash), edges.
          const strokeWidthKey = obj.style?.strokeWidth as string | undefined; // 'thin' | 'medium' | 'bold'
          const sloppiness = obj.style?.sloppiness as string | undefined; // 'architect' | 'artist' | 'cartoonist'
          const shapeStroke = strokeWidthKey === 'bold' ? 4 : strokeWidthKey === 'medium' ? 2.5 : strokeWidthKey === 'thin' ? 1 : 1.5;
          const strokeStyleKey = obj.style?.strokeStyle as string | undefined; // 'solid' | 'dashed' | 'dotted'
          const shapeDash: string =
            strokeStyleKey === 'dashed' ? `${(shapeStroke * 3).toFixed(1)},${(shapeStroke * 2.4).toFixed(1)}`
            : strokeStyleKey === 'dotted' ? `${shapeStroke.toFixed(1)},${(shapeStroke * 2).toFixed(1)}`
            : 'none';
          const cssBorderStyle = strokeStyleKey === 'dashed' ? 'dashed' : strokeStyleKey === 'dotted' ? 'dotted' : 'solid';
          const sharpEdges = obj.style?.edges === 'sharp';
          const shapeJoin = sharpEdges ? 'miter' : 'round';
          // Hand-drawn wobble level (applied as an SVG turbulence filter class).
          const roughClass = sloppiness === 'cartoonist' ? 'shape-rough-2' : sloppiness === 'artist' ? 'shape-rough-1' : '';

          return (
            <div
              className={`shape-container ${shapeType}`}
              style={{
                width: '100%', height: '100%', position: 'relative',
                // Universal stroke controls — the CSS rule reads these vars and
                // overrides every shape's SVG stroke at once.
                ['--shape-sw' as string]: String(shapeStroke),
                ['--shape-dash' as string]: shapeDash,
                ['--shape-join' as string]: shapeJoin,
              } as React.CSSProperties}
            >
              {/* Background Shape */}
              <div className={`absolute inset-0 pointer-events-none z-0 ${roughClass}`}>
                {shapeType === 'circle' && (
                  <div 
                    className="w-full h-full rounded-full transition-all duration-300"
                    style={{
                      backgroundColor: shapeBg,
                      border: `${shapeStroke}px ${cssBorderStyle} ${shapeBorder}`,
                      boxShadow: isSelected ? '0 0 15px rgba(var(--accent-rgb), 0.2)' : 'var(--shadow-sm)',
                      backdropFilter: 'blur(10px)',
                    }}
                  />
                )}
                {shapeType === 'square' && (
                  <div
                    className={`w-full h-full transition-all duration-300 ${sharpEdges ? 'rounded-none' : 'rounded-xl'}`}
                    style={{
                      backgroundColor: shapeBg,
                      border: `${shapeStroke}px ${cssBorderStyle} ${shapeBorder}`,
                      boxShadow: isSelected ? '0 0 15px rgba(var(--accent-rgb), 0.2)' : 'var(--shadow-sm)',
                      backdropFilter: 'blur(10px)',
                    }}
                  />
                )}
                {shapeType === 'triangle' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="50,2 98,96 2,96" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'diamond' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="50,2 98,50 50,98 2,50" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'pentagon' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="50,4 96,37 78,92 22,92 4,37" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'hexagon' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="50,2 94,27 94,73 50,98 6,73 6,27" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'star' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="50,2 63,35 98,35 70,57 81,91 50,70 19,91 30,57 2,35 37,35" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'heart' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M50,25 C35,5 5,5 5,42 C5,68 45,90 50,95 C55,90 95,68 95,42 C95,5 65,5 50,25 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'cloud' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M25,50 C25,35 40,25 55,25 C70,25 85,35 85,50 C92,50 98,56 98,63 C98,71 92,77 85,77 L25,77 C15,77 8,70 8,60 C8,51 16,45 25,50 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'database' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,25 C10,15 28,10 50,10 C72,10 90,15 90,25 L90,75 C90,85 72,90 50,90 C28,90 10,85 10,75 Z M10,25 C10,35 28,40 50,40 C72,40 90,35 90,25" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'document' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M15,10 L65,10 L85,30 L85,90 L15,90 Z M65,10 L65,30 L85,30" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'speech' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,15 C10,7 20,7 30,7 L80,7 C90,7 90,15 90,25 L90,65 C90,75 80,75 70,75 L45,75 L20,93 L25,75 C10,75 10,65 10,55 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'message' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,20 L90,20 L90,80 L10,80 Z M10,20 L50,55 L90,20" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'cross' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="35,10 65,10 65,35 90,35 90,65 65,65 65,90 35,90 35,65 10,65 10,35 35,35" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'lightning' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="60,2 15,55 48,55 35,98 85,42 50,42" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'shield' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M15,10 L50,5 L85,10 C85,45 75,75 50,95 C25,75 15,45 15,10 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'arrow-left' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="45,10 10,50 45,90 45,65 90,65 90,35 45,35" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'arrow-right' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="55,10 90,50 55,90 55,65 10,65 10,35 55,35" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'tag' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,25 L65,25 L90,50 L65,75 L10,75 Z M25,50 A5,5 0 1,1 25,49.9 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'banner' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="10,20 90,20 75,50 90,80 10,80 25,50" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'octagon' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="29,5 71,5 95,29 95,71 71,95 29,95 5,71 5,29" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth={shapeStroke}
                      strokeDasharray={shapeDash}
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'folder' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,15 L35,15 L45,28 L90,28 L90,85 L10,85 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'sun' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="22" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path 
                      d="M50,8 L50,18 M50,82 L50,92 M8,50 L18,50 M82,50 L92,50 M20,20 L27,27 M73,73 L80,80 M20,80 L27,73 M73,27 L80,20" 
                      stroke={shapeBorder} 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                    />
                  </svg>
                )}
                {shapeType === 'moon' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M75,15 C45,15 25,35 25,60 C25,75 35,90 55,95 C30,90 15,70 15,50 C15,25 35,10 65,10 C70,10 73,12 75,15 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}
                {shapeType === 'lightbulb' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M50,10 C28,10 25,35 32,50 C37,60 40,65 40,75 L60,75 C60,65 63,60 68,50 C75,35 72,10 50,10 Z M38,82 L62,82 M42,90 L58,90" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                  </svg>
                )}
                {shapeType === 'sticky' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M10,10 L70,10 L90,30 L90,90 L10,90 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                    <path 
                      d="M70,10 L70,30 L90,30 Z" 
                      fill={shapeBorder} 
                      opacity="0.25"
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                  </svg>
                )}
                {shapeType === 'target' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="14" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="4" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'funnel' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon 
                      points="10,10 90,10 60,45 60,85 40,95 40,45" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                  </svg>
                )}
                {shapeType === 'magnet' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M20,40 C20,15 80,15 80,40 L80,75 L62,75 L62,40 C62,28 38,28 38,40 L38,75 L20,75 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                    <rect x="20" y="70" width="18" height="10" fill={shapeBorder} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="62" y="70" width="18" height="10" fill={shapeBorder} stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'puzzle' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path 
                      d="M20,20 L40,20 C40,10 60,10 60,20 L80,20 L80,40 C90,40 90,60 80,60 L80,80 L60,80 C60,70 40,70 40,80 L20,80 L20,60 C30,60 30,40 20,40 Z" 
                      fill={shapeBg} 
                      stroke={shapeBorder} 
                      strokeWidth="1.5" 
                      strokeLinejoin="round" 
                    />
                  </svg>
                )}
                {shapeType === 'gear' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="22" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path 
                      d="M50,15 L50,5 M50,95 L50,85 M15,50 L5,50 M95,50 L85,50 M25,25 L18,18 M75,75 L82,82 M25,80 L18,82 M75,25 L82,18" 
                      stroke={shapeBorder} 
                      strokeWidth="3" 
                      strokeLinecap="round" 
                    />
                    <circle cx="50" cy="50" r="8" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'terminal' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="5" y="15" width="90" height="70" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="5" y1="35" x2="95" y2="35" stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="15" cy="25" r="3" fill={shapeBorder} />
                    <circle cx="25" cy="25" r="3" fill={shapeBorder} />
                    <circle cx="35" cy="25" r="3" fill={shapeBorder} />
                    <path d="M15,47 L25,55 L15,63 M30,63 L45,63" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'brackets' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="5" y="10" width="90" height="80" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M30,30 C20,30 20,40 20,50 C20,60 20,70 30,70 M70,30 C80,30 80,40 80,50 C80,60 80,70 70,70" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'api' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="35" width="80" height="30" rx="15" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="30" cy="50" r="6" fill={shapeBorder} />
                    <circle cx="50" cy="50" r="6" fill={shapeBorder} />
                    <circle cx="70" cy="50" r="6" fill={shapeBorder} />
                    <line x1="36" y1="50" x2="44" y2="50" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="56" y1="50" x2="64" y2="50" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'server' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="10" width="70" height="22" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="15" y="38" width="70" height="22" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="15" y="66" width="70" height="22" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="28" cy="21" r="2" fill={shapeBorder} />
                    <circle cx="28" cy="49" r="2" fill={shapeBorder} />
                    <circle cx="28" cy="77" r="2" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'cube' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,5 92,26 92,74 50,95 8,74 8,26" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="5" x2="50" y2="95" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="48" x2="92" y2="26" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="48" x2="8" y2="26" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'branch' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M30,85 L30,15 M30,50 Q60,50 70,30 L70,15" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                    <circle cx="30" cy="15" r="7" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="30" cy="85" r="7" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="70" cy="15" r="7" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'terminal-prompt' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,30 L45,50 L20,70 M50,70 L80,70" fill="none" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'cpu' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="20" y="20" width="60" height="60" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="35" y="35" width="30" height="30" rx="4" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M35,20 L35,10 M50,20 L50,10 M65,20 L65,10 M35,80 L35,90 M50,80 L50,90 M65,80 L65,90 M20,35 L10,35 M20,50 L10,50 M20,65 L10,65 M80,35 L90,35 M80,50 L90,50 M80,65 L90,65" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'globe' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <ellipse cx="50" cy="50" rx="20" ry="42" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <ellipse cx="50" cy="50" rx="42" ry="15" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="8" y1="50" x2="92" y2="50" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="8" x2="50" y2="92" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'key' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M35,50 A15,15 0 1,1 35,49.9 L75,50 L75,65 L85,65 L85,50 L90,50 L90,35 L35,35 Z M25,50 A4,4 0 1,0 25,49.9 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'smile' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="35" cy="40" r="5" fill={shapeBorder} />
                    <circle cx="65" cy="40" r="5" fill={shapeBorder} />
                    <path d="M30,60 C38,72 62,72 70,60" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'thumbs-up' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,50 L15,85 L28,85 L28,50 Z M28,85 L65,85 C72,85 75,80 75,70 L80,45 C80,38 75,35 68,35 L50,35 L53,15 C53,10 47,5 40,8 L28,30 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'thumbs-down' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,50 L15,15 L28,15 L28,50 Z M28,15 L65,15 C72,15 75,20 75,30 L80,55 C80,62 75,65 68,65 L50,65 L53,85 C53,90 47,95 40,92 L28,70 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'flower' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,28 C50,15 65,15 65,28 C65,40 50,40 50,28 Z M50,72 C50,85 35,85 35,72 C35,60 50,60 50,72 Z M28,50 C15,50 15,35 28,35 C40,35 40,50 28,50 Z M72,50 C85,50 85,65 72,65 C60,65 60,50 72,50 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="14" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'sparkles' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,10 Q50,40 80,40 Q50,40 50,70 Q50,40 20,40 Q50,40 50,10 Z M75,65 Q75,80 90,80 Q75,80 75,95 Q75,80 60,80 Q75,80 75,65 Z M25,70 Q25,80 35,80 Q25,80 25,90 Q25,80 15,80 Q25,80 25,70 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'trophy' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,15 L75,15 L70,55 C65,68 55,70 50,70 C45,70 35,68 30,55 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M25,25 C15,25 15,40 25,40 M75,25 C85,25 85,40 75,40" fill="none" stroke={shapeBorder} strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M50,70 L50,85 M35,85 L65,85" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'medal' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="35,5 50,35 65,5 45,5" fill={shapeBorder} opacity="0.3" stroke={shapeBorder} strokeWidth="1.5" />
                    <polygon points="50,35 30,5 38,5" fill={shapeBorder} opacity="0.5" stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="60" r="28" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="60" r="18" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'gift' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="30" width="70" height="60" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="10" y="20" width="80" height="15" rx="2" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="20" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2" />
                    <path d="M50,20 C40,5 30,15 50,20 C60,5 70,15 50,20" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'balloon' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,5 C25,5 25,45 50,65 C75,45 75,5 50,5 Z M47,65 L53,65 L50,70 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M50,70 Q45,80 52,90 T48,100" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'clapping' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M30,60 L20,45 C15,38 25,30 32,37 L40,47 M55,30 L65,15 C70,8 80,18 73,25 L60,40 M45,45 C50,38 60,45 55,55 L35,80 L20,70 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'coffee' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,30 L80,30 C80,65 65,80 45,80 L35,80 C20,80 20,65 20,30 Z M80,40 C90,40 90,55 80,55" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M35,10 Q35,20 40,20 M50,10 Q50,20 55,20 M65,10 Q65,20 70,20" fill="none" stroke={shapeBorder} strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="15" y1="88" x2="85" y2="88" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'check-circle' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M32,50 L44,62 L68,36" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'cross-circle' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M35,35 L65,65 M65,35 L35,65" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'arrow-up' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,10 90,45 65,45 65,90 35,90 35,45 10,45" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'arrow-down' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,90 90,55 65,55 65,10 35,10 35,55 10,55" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'user' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="30" r="18" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M15,85 C15,65 30,55 50,55 C70,55 85,65 85,85 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'clock' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M50,20 L50,50 L70,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'calendar' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="20" width="70" height="70" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="15" y1="40" x2="85" y2="40" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="30" y1="12" x2="30" y2="24" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="70" y1="12" x2="70" y2="24" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="30" cy="55" r="3" fill={shapeBorder} />
                    <circle cx="50" cy="55" r="3" fill={shapeBorder} />
                    <circle cx="70" cy="55" r="3" fill={shapeBorder} />
                    <circle cx="30" cy="75" r="3" fill={shapeBorder} />
                    <circle cx="50" cy="75" r="3" fill={shapeBorder} />
                    <circle cx="70" cy="75" r="3" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'card' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="20" width="80" height="60" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="10" y="32" width="80" height="15" fill={shapeBorder} />
                    <rect x="20" y="58" width="16" height="10" rx="2" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'chart' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="10" width="80" height="80" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <path d="M20,70 L35,50 L55,60 L75,30" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="75" cy="30" r="3.5" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'cart' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,15 L25,15 L40,60 L80,60 L90,28 L30,28" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="45" cy="78" r="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="75" cy="78" r="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'play' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="25,15 85,50 25,85" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'pause' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="22" y="15" width="16" height="70" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                    <rect x="62" y="15" width="16" height="70" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'stop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="15" width="70" height="70" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" />
                  </svg>
                )}
                {shapeType === 'infinity' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M28,32 C12,32 12,68 28,68 C38,68 45,56 50,50 C55,44 62,32 72,32 C88,32 88,68 72,68 C62,68 55,56 50,50 C45,44 38,32 28,32 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'beat' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 10,65 C 30,65 35,35 55,35 C 70,35 75,55 90,55" fill="none" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <circle cx="10" cy="65" r="4.5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="55" cy="35" r="5.5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="90" cy="55" r="4.5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'scene' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="80" height="70" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <path d="M 10,32 L 90,32" stroke={shapeBorder} strokeWidth="2" />
                    <path d="M 10,23 C 10,18 14,15 18,15 L 82,15 C 86,15 90,18 90,23 L 90,32 L 10,32 Z" fill={shapeBorder} opacity="0.12" />
                  </svg>
                )}
                {shapeType === 'arc' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 10,85 C 10,20 90,20 90,85 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <path d="M 10,85 C 10,20 90,20 90,85" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'twist' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="5" y="5" width="90" height="90" rx="10" fill={shapeBg} stroke="none" opacity="0.1" />
                    <path d="M 10,65 L 40,65 L 50,20 L 60,65 L 90,65" fill="none" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="50" cy="20" r="4.5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'stakes' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,10 90,50 65,50 65,85 35,85 35,50 10,50" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <line x1="15" y1="85" x2="85" y2="85" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'character' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="30" r="16" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <path d="M 20,80 C 20,62 32,58 50,58 C 68,58 80,62 80,80 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'whisper' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="5" y="5" width="90" height="90" rx="10" fill={shapeBg} stroke="none" opacity="0.1" />
                    <path d="M 15,30 C 35,15 45,85 65,70 C 75,60 80,40 90,30" fill="none" stroke={shapeBorder} strokeWidth="3" strokeDasharray="6,6" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'foreshadow' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="22" cy="50" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" strokeDasharray="3,3" opacity="0.6" />
                    <line x1="32" y1="50" x2="68" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="4,4" strokeLinecap="round" />
                    <circle cx="78" cy="50" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="78" cy="50" r="4" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'world' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="40" ry="16" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="16" ry="40" fill="none" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'voice' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 18,40 L 38,40 L 58,20 L 58,80 L 38,60 L 18,60 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <path d="M 70,32 C 76,40 76,60 70,68" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M 80,20 C 90,32 90,68 80,80" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'queue' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="38" width="80" height="24" rx="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="26" cy="50" r="5" fill={shapeBorder} />
                    <circle cx="42" cy="50" r="5" fill={shapeBorder} />
                    <circle cx="58" cy="50" r="5" fill={shapeBorder} />
                    <circle cx="74" cy="50" r="7" fill={shapeBg} stroke={shapeBorder} strokeWidth="3" />
                  </svg>
                )}
                {shapeType === 'webhook' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 25,20 C 25,60 75,25 75,60" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="4,4" />
                    <circle cx="25" cy="20" r="5" fill={shapeBorder} />
                    <circle cx="75" cy="65" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="75" cy="65" r="4" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'cache' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="20" width="70" height="15" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="15" y="42" width="70" height="15" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="15" y="65" width="70" height="15" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <line x1="25" y1="27.5" x2="35" y2="27.5" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="25" y1="49.5" x2="35" y2="49.5" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="25" y1="72.5" x2="35" y2="72.5" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'event' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,12 62,38 90,38 68,54 76,82 50,65 24,82 32,54 10,38 38,38" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'pipeline' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="20" y1="50" x2="80" y2="50" stroke={shapeBorder} strokeWidth="3" />
                    <rect x="12" y="38" width="18" height="24" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="41" y="38" width="18" height="24" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="70" y="38" width="18" height="24" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'auth' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 30,45 L 30,30 C 30,18 40,15 50,15 C 60,15 70,18 70,30 L 70,45" fill="none" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <rect x="22" y="42" width="56" height="42" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="50" cy="58" r="4.5" fill={shapeBorder} />
                    <line x1="50" y1="62" x2="50" y2="70" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'diff' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="80" height="70" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <line x1="50" y1="15" x2="50" y2="85" stroke={shapeBorder} strokeWidth="1.5" />
                    <line x1="20" y1="30" x2="40" y2="30" stroke={shapeBorder} strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />
                    <line x1="20" y1="45" x2="35" y2="45" stroke={shapeBorder} strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />
                    <line x1="60" y1="30" x2="80" y2="30" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="60" y1="55" x2="75" y2="55" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'hash' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="38" y1="12" x2="38" y2="88" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <line x1="62" y1="12" x2="62" y2="88" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <line x1="12" y1="38" x2="88" y2="38" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <line x1="12" y1="62" x2="88" y2="62" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'branch-merge' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="25" y1="80" x2="25" y2="20" stroke={shapeBorder} strokeWidth="3" />
                    <path d="M 25,65 Q 65,65 65,50 Q 65,35 25,35" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="25" cy="75" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="65" cy="50" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="25" cy="25" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'token' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="38" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke={shapeBorder} strokeWidth="1" strokeDasharray="3,3" />
                    <path d="M 40,42 L 50,36 L 60,42 L 60,52 C 60,60 50,65 50,65 C 50,65 40,60 40,52 Z" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'feedback' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 30,50 C 15,32 15,68 30,50 C 45,32 55,68 70,50 C 85,32 85,68 70,50 C 55,32 45,68 30,50 Z" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinejoin="round" />
                    <polygon points="34,42 36,49 29,48" fill={shapeBorder} />
                    <polygon points="66,58 64,51 71,52" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'bottleneck' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 15,20 L 85,20 L 58,55 L 58,80 L 42,80 L 42,55 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="50" y1="28" x2="50" y2="45" stroke={shapeBorder} strokeWidth="1.5" strokeDasharray="3,3" />
                    <line x1="50" y1="60" x2="50" y2="76" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'cascade' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 15,22 Q 40,25 45,50 T 85,78" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                    <circle cx="15" cy="22" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="45" cy="50" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="85" cy="78" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'threshold' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="1.5" strokeDasharray="4,4" />
                    <path d="M 15,80 C 35,80 40,20 85,20" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                    <circle cx="50" cy="50" r="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'trade-off' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="20" y1="80" x2="20" y2="15" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                    <line x1="20" y1="80" x2="85" y2="80" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                    <path d="M 14,24 L 20,15 L 26,24" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 76,74 L 85,80 L 76,86" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 25,75 L 75,25" fill="none" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                    <circle cx="50" cy="50" r="4.5" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'pareto' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="25" width="12" height="55" rx="2" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="35" y="45" width="12" height="35" rx="2" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="55" y="60" width="12" height="20" rx="2" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <rect x="75" y="70" width="12" height="10" rx="2" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <path d="M 21,25 Q 50,22 81,68" fill="none" stroke={shapeBorder} strokeWidth="1.5" strokeDasharray="2,2" />
                  </svg>
                )}
                {shapeType === 'pivot' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 20,75 L 50,40 L 80,75" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="50" cy="40" r="5" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <line x1="50" y1="28" x2="50" y2="22" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                    <line x1="38" y1="32" x2="32" y2="28" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                    <line x1="62" y1="32" x2="68" y2="28" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'lever' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,55 60,75 40,75" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <line x1="15" y1="70" x2="85" y2="40" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <circle cx="85" cy="40" r="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'compound' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M 15,80 C 45,80 60,65 85,15" fill="none" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <line x1="10" y1="80" x2="90" y2="80" stroke={shapeBorder} strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="15" y1="85" x2="15" y2="10" stroke={shapeBorder} strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="85" cy="15" r="4.5" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'risk' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,15 90,82 10,82" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <line x1="50" y1="42" x2="50" y2="60" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                    <circle cx="50" cy="71" r="3.5" fill={shapeBorder} />
                  </svg>
                )}

                {/* Brainstorm */}
                {shapeType === 'lightbulb-spark' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 C33,15 25,30 25,48 C25,60 36,68 40,76 L60,76 C64,68 75,60 75,48 C75,30 67,15 50,15 Z M42,88 L58,88 M45,76 L45,88 M55,76 L55,88" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="50" y1="5" x2="50" y2="10" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="20" y1="20" x2="25" y2="25" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="80" y1="20" x2="75" y2="25" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'compass' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <polygon points="50,20 62,50 50,80 38,50" fill={shapeBorder} stroke={shapeBorder} strokeWidth="1.5" />
                    <circle cx="50" cy="50" r="5" fill={shapeBg} />
                  </svg>
                )}
                {shapeType === 'rocket' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,10 C65,25 70,55 70,75 L30,75 C30,55 35,25 50,10 Z M30,50 L15,65 L30,70 M70,50 L85,65 L70,70 M42,75 L42,90 L50,83 L58,90 L58,75" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <circle cx="50" cy="40" r="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'radar' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="50" cy="50" r="14" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="50" y1="50" x2="80" y2="20" stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="68" cy="32" r="4" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'prism' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,12 90,82 10,82" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="10" y1="50" x2="30" y2="46" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="65" y1="53" x2="90" y2="40" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="68" y1="58" x2="90" y2="55" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="70" y1="63" x2="90" y2="70" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'light-beam' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,10 85,90 15,90" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'telescope' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,60 L75,25 L85,40 L30,75 Z M60,35 L40,75 M50,45 L50,85 M50,85 L30,95 M50,85 L70,95" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'magnifier' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="42" cy="42" r="30" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="64" y1="64" x2="90" y2="90" stroke={shapeBorder} strokeWidth="5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'atom-idea' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="50" rx="42" ry="16" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(60 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-60 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="50" cy="50" r="8" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'spark-cluster' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 L53,35 L73,38 L55,50 L60,70 L45,55 L25,65 L35,48 L18,38 L38,35 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'anchor' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="20" r="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="28" x2="50" y2="80" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="30" y1="38" x2="70" y2="38" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M20,55 C20,80 80,80 80,55 M20,55 L12,48 M80,55 L88,48" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'bridge' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,70 Q50,20 90,70 M10,70 L90,70 M30,55 L30,70 M50,45 L50,70 M70,55 L70,70" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}

                {/* Code (Tech) */}
                {shapeType === 'cpu-chip' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="25" y="25" width="50" height="50" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="38" y="38" width="24" height="24" rx="3" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="35" y1="10" x2="35" y2="25" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="10" x2="50" y2="25" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="65" y1="10" x2="65" y2="25" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="35" y1="75" x2="35" y2="90" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="75" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="65" y1="75" x2="65" y2="90" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="10" y1="35" x2="25" y2="35" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="10" y1="50" x2="25" y2="50" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="10" y1="65" x2="25" y2="65" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="75" y1="35" x2="90" y2="35" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="75" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="75" y1="65" x2="90" y2="65" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'cloud-download' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,55 C25,40 40,30 55,30 C70,30 85,40 85,55 C92,55 98,61 98,68 C98,76 92,82 85,82 L25,82 C15,82 8,75 8,65 C8,56 16,50 25,55 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M50,48 L50,72 M38,62 L50,74 L62,62" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'cloud-upload' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,55 C25,40 40,30 55,30 C70,30 85,40 85,55 C92,55 98,61 98,68 C98,76 92,82 85,82 L25,82 C15,82 8,75 8,65 C8,56 16,50 25,55 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M50,72 L50,48 M38,58 L50,46 L62,58" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'git-commit' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="18" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="10" y1="50" x2="32" y2="50" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="68" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'binary' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <text x="20" y="42" fontSize="28" fontWeight="bold" fill={shapeBorder}>10</text>
                    <text x="50" y="78" fontSize="28" fontWeight="bold" fill={shapeBorder}>01</text>
                  </svg>
                )}
                {shapeType === 'cube-stack' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,8 85,24 85,48 50,64 15,48 15,24" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="50" y1="8" x2="50" y2="64" stroke={shapeBorder} strokeWidth="2" />
                    <polygon points="50,40 85,56 85,80 50,96 15,80 15,56" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="50" y1="40" x2="50" y2="96" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'stack' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,15 90,32 50,49 10,32" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <path d="M10,48 L50,65 L90,48 M10,64 L50,81 L90,64" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'network' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="20" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="20" cy="75" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="80" cy="75" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="30" x2="20" y2="65" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="50" y1="30" x2="80" y2="65" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="30" y1="75" x2="70" y2="75" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'data-flow' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="20" width="22" height="60" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="68" y="20" width="22" height="60" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M32,35 C50,35 50,65 68,65" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'bug' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="55" rx="22" ry="28" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="22" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="22" x2="50" y2="83" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="15" y1="45" x2="30" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="85" y1="45" x2="70" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="12" y1="65" x2="30" y2="65" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="88" y1="65" x2="70" y2="65" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'terminal-box' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="80" height="70" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <polyline points="25,35 40,48 25,61" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <line x1="48" y1="61" x2="70" y2="61" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'fingerprint' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 A35,35 0 0,1 85,50 M15,50 A35,35 0 0,1 50,15 M50,30 A20,20 0 0,1 70,50 M30,50 A20,20 0 0,1 50,30 M50,45 A5,5 0 0,1 55,50 M45,50 A5,5 0 0,1 50,45" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'wifi' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,30 A50,50 0 0,1 85,30 M28,45 A32,32 0 0,1 72,45 M40,60 A16,16 0 0,1 60,60" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="50" cy="75" r="6" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'database-stack' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="20" rx="35" ry="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M15,20 L15,45 C15,51 30,55 50,55 C70,55 85,51 85,45 L85,20" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M15,45 L15,70 C15,76 30,80 50,80 C70,80 85,76 85,70 L85,45" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'ai-spark' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,10 L58,38 L86,46 L58,54 L50,82 L42,54 L14,46 L42,38 Z M78,14 L82,28 L96,32 L82,36 L78,50 L74,36 L60,32 L74,28 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}

                {/* Love (Expressive) */}
                {shapeType === 'fire' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,10 C50,10 65,30 65,50 C65,60 60,70 50,90 C40,70 35,60 35,50 C35,30 50,10 50,10 Z M50,45 C50,45 58,55 58,68 C58,74 54,80 50,85 C46,80 42,74 42,68 C42,55 50,45 50,45 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'star-burst' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,5 61,35 95,35 67,55 78,90 50,68 22,90 33,55 5,35 39,35" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'heart-pulse' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,30 C35,10 10,10 10,40 C10,65 45,85 50,90 C55,85 90,65 90,40 C90,10 65,10 50,30 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M20,45 L38,45 L45,30 L55,60 L62,40 L70,45 L80,45" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'crown' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="12,75 18,30 38,50 50,15 62,50 82,30 88,75" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <rect x="12" y="75" width="76" height="12" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'gem' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="30,15 70,15 90,40 50,90 10,40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="30" y1="15" x2="50" y2="40" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="70" y1="15" x2="50" y2="40" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="50" y1="40" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="10" y1="40" x2="90" y2="40" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
                {shapeType === 'ribbon-award' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="40" r="28" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="40" r="20" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <polygon points="36,62 30,92 50,80 70,92 64,62" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'peace' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="8" x2="50" y2="92" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="50" x2="20" y2="80" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="50" x2="80" y2="80" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'coffee-cup' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="20" y="35" width="50" height="50" rx="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M70,42 C82,42 85,60 70,65" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M30,22 Q35,12 40,22 M50,22 Q55,12 60,22" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'music-note' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="30" cy="72" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="70" cy="58" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M42,72 L42,20 L82,10 L82,58" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'sunburst' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="20" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="10" x2="50" y2="22" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="50" y1="78" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="10" y1="50" x2="22" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="78" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="22" y1="22" x2="30" y2="30" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="70" y1="70" x2="78" y2="78" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="22" y1="78" x2="30" y2="70" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="70" y1="30" x2="78" y2="22" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'hand-shake' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,50 L30,35 L50,50 L70,35 L90,50 M30,50 L45,65 M45,50 L60,65 M60,50 L75,65" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'party-popper' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="15,85 30,40 60,70" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <path d="M50,35 Q65,15 85,25 M65,45 Q80,40 90,55" fill="none" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                    <circle cx="70" cy="20" r="3" fill={shapeBorder} />
                    <circle cx="85" cy="40" r="4" fill={shapeBorder} />
                  </svg>
                )}

                {/* Usecase (Actions) */}
                {shapeType === 'arrow-up-right' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="20" y1="80" x2="80" y2="20" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" />
                    <polyline points="40,20 80,20 80,60" fill="none" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'arrow-down-left' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="80" y1="20" x2="20" y2="80" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" />
                    <polyline points="60,80 20,80 20,40" fill="none" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'rotate-cw' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 A35,35 0 1,1 18,40" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="18,20 18,45 40,40" fill={shapeBorder} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'rotate-ccw' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 A35,35 0 1,0 82,40" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="82,20 82,45 60,40" fill={shapeBorder} stroke={shapeBorder} strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'split' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="50" y1="85" x2="50" y2="55" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M50,55 Q50,30 20,20 M50,55 Q50,30 80,20" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="15,30 20,15 32,22" fill={shapeBorder} />
                    <polygon points="85,30 80,15 68,22" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'merge' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,80 Q50,70 50,45 M80,80 Q50,70 50,45" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="50" y1="45" x2="50" y2="15" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="38,25 50,10 62,25" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'filter-list' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="15" y1="25" x2="85" y2="25" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="28" y1="45" x2="72" y2="45" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="40" y1="65" x2="60" y2="65" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'sort' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="25" y1="20" x2="25" y2="80" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="15,32 25,18 35,32" fill={shapeBorder} />
                    <line x1="75" y1="20" x2="75" y2="80" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="65,68 75,82 85,68" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'download' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="75" width="70" height="12" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="15" x2="50" y2="55" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" />
                    <polygon points="32,45 50,65 68,45" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'upload' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="75" width="70" height="12" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="50" y1="65" x2="50" y2="25" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" />
                    <polygon points="32,35 50,15 68,35" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'lock' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="22" y="45" width="56" height="42" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M32,45 L32,30 A18,18 0 0,1 68,30 L68,45" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="50" cy="62" r="5" fill={shapeBorder} />
                    <line x1="50" y1="67" x2="50" y2="76" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'unlock' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="22" y="45" width="56" height="42" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M32,45 L32,30 A18,18 0 0,1 68,30" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="50" cy="62" r="5" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'eye' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,50 C25,25 75,25 90,50 C75,75 25,75 10,50 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <circle cx="50" cy="50" r="14" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="50" cy="50" r="6" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'eye-off' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,50 C25,25 75,25 90,50 C75,75 25,75 10,50 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="15" y1="15" x2="85" y2="85" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'layers' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,15 90,32 50,49 10,32" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <path d="M10,48 L50,65 L90,48 M10,64 L50,81 L90,64" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}

                {/* Story */}
                {shapeType === 'hero-cape' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M30,25 L50,15 L70,25 L85,85 L50,70 L15,85 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <circle cx="50" cy="15" r="6" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'villain-mask' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,35 Q50,15 85,35 L75,75 Q50,90 25,75 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <polygon points="28,45 42,42 38,55" fill={shapeBorder} />
                    <polygon points="72,45 58,42 62,55" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'climax-peak' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,80 L40,40 L55,55 L75,15 L90,80 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="75" y1="15" x2="75" y2="80" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'resolution' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,50 C35,20 65,80 85,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="85" cy="50" r="7" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'sub-plot' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,50 L40,50 C50,50 55,25 68,25 L85,25" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="40" y1="50" x2="85" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'theme-core' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="38" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="22" fill="none" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                    <circle cx="50" cy="50" r="8" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'flashback' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 A35,35 0 1,0 85,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="4,4" />
                    <polygon points="50,5 50,25 32,15" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'prop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="25" y="25" width="50" height="50" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M25,25 L50,50 L75,25 M50,50 L50,75" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'dialogue-bubble' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M15,20 L85,20 Q95,20 95,30 L95,60 Q95,70 85,70 L45,70 L25,88 L30,70 L15,70 Q5,70 5,60 L5,30 Q5,20 15,20 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'scroll-manuscript' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,15 C15,15 15,30 25,30 L75,30 L75,85 C85,85 85,70 75,70 L25,70 L25,15 Z M25,15 L75,15 L75,30" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'hourglass' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,15 L75,15 L55,50 L75,85 L25,85 L45,50 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="20" y1="15" x2="80" y2="15" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                    <line x1="20" y1="85" x2="80" y2="85" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'keyhole' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="42" r="10" fill={shapeBorder} />
                    <polygon points="44,48 56,48 60,70 40,70" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'map-location' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 C32,15 20,30 20,48 C20,70 50,90 50,90 C50,90 80,70 80,48 C80,30 68,15 50,15 Z M50,42 A8,8 0 1,1 50,41.9 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'sword-shield' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,20 L50,12 L75,20 C75,50 65,75 50,90 C35,75 25,50 25,20 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="20" y1="20" x2="80" y2="80" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="80" y1="20" x2="20" y2="80" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'portal' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="50" rx="38" ry="42" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="5,4" />
                    <ellipse cx="50" cy="50" rx="24" ry="28" fill="none" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                    <circle cx="50" cy="50" r="8" fill={shapeBorder} />
                  </svg>
                )}

                {/* System */}
                {shapeType === 'feedback-loop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 A35,35 0 1,1 20,40" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="12,42 28,42 20,25" fill={shapeBorder} />
                    <path d="M50,85 A35,35 0 1,1 80,60" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="88,58 72,58 80,75" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'balancing-loop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="38" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <text x="50" y="60" fontSize="32" textAnchor="middle" fontWeight="bold" fill={shapeBorder}>B</text>
                  </svg>
                )}
                {shapeType === 'reinforcing-loop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="38" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <text x="50" y="60" fontSize="32" textAnchor="middle" fontWeight="bold" fill={shapeBorder}>R</text>
                  </svg>
                )}
                {shapeType === 'tipping-point' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="20,80 50,30 80,80" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <rect x="15" y="25" width="70" height="10" rx="2" transform="rotate(15 50 30)" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'domino' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="10" width="30" height="80" rx="4" transform="rotate(-15 30 50)" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="55" y="10" width="30" height="80" rx="4" transform="rotate(25 70 50)" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'equilibrium' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="15" y1="50" x2="85" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="50,50 62,80 38,80" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <circle cx="25" cy="38" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="75" cy="38" r="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'entropy' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="25" cy="30" r="5" fill={shapeBorder} />
                    <circle cx="70" cy="20" r="7" fill={shapeBorder} />
                    <circle cx="45" cy="60" r="6" fill={shapeBorder} />
                    <circle cx="80" cy="75" r="4" fill={shapeBorder} />
                    <circle cx="20" cy="80" r="8" fill={shapeBorder} />
                    <path d="M25,30 L45,60 M45,60 L70,20 M45,60 L80,75" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'synergy' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="38" cy="42" r="28" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="62" cy="42" r="28" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="66" r="28" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'black-box' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="15" y="15" width="70" height="70" rx="10" fill={shapeBorder} opacity="0.85" />
                    <line x1="5" y1="50" x2="15" y2="50" stroke={shapeBorder} strokeWidth="3.5" />
                    <line x1="85" y1="50" x2="95" y2="50" stroke={shapeBorder} strokeWidth="3.5" />
                  </svg>
                )}
                {shapeType === 'flywheel' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="15" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M50,10 L50,35 M50,65 L50,90 M10,50 L35,50 M65,50 L90,50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'funnel-filter' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="10,15 90,15 65,55 65,85 35,85 35,55" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="25" y1="35" x2="75" y2="35" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'friction' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polyline points="15,40 25,60 35,40 45,60 55,40 65,60 75,40 85,60" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'oscillation' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,50 Q30,15 50,50 T90,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'bottleneck-pipe' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,30 L40,30 L40,42 L60,42 L60,30 L90,30 M10,70 L40,70 L40,58 L60,58 L60,70 L90,70" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'attractor' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,50 Q85,15 85,50 T50,50 T15,50 T50,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="50" cy="50" r="6" fill={shapeBorder} />
                  </svg>
                )}

                {/* Science */}
                {shapeType === 'dna' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,15 C50,35 50,65 20,85 M80,15 C50,35 50,65 80,85" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="30" y1="28" x2="70" y2="28" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="42" y1="50" x2="58" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="30" y1="72" x2="70" y2="72" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'atom-core' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="50" rx="42" ry="16" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(60 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-60 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <circle cx="50" cy="50" r="8" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'flask' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M40,15 L60,15 M46,15 L46,38 L80,80 Q85,88 75,88 L25,88 Q15,88 20,80 L54,38 L54,15" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                    <line x1="30" y1="70" x2="70" y2="70" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'molecule' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="25" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="25" cy="70" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="75" cy="70" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="42" y1="34" x2="31" y2="60" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="58" y1="34" x2="69" y2="60" stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="37" y1="70" x2="63" y2="70" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'infinity-loop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M30,30 C10,30 10,70 30,70 C45,70 55,30 70,30 C90,30 90,70 70,70 C55,70 45,30 30,30 Z" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'pi' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="15" y1="25" x2="85" y2="25" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" />
                    <path d="M35,25 L35,80 M65,25 L65,75 Q65,85 75,85" fill="none" stroke={shapeBorder} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'wave-sine' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,50 Q30,15 50,50 T90,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2" strokeDasharray="3,3" />
                  </svg>
                )}
                {shapeType === 'delta' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="50,15 90,82 10,82" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'scale-balance' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="15" y1="30" x2="85" y2="30" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="50" y1="15" x2="50" y2="85" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points="40,85 60,85 50,75" fill={shapeBorder} />
                    <path d="M15,30 L25,58 L35,58 Z M65,58 L75,58 L85,30 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'magnet-field' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M25,35 Q50,10 75,35 M20,50 Q50,20 80,50 M25,65 Q50,90 75,65" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeDasharray="3,3" />
                    <rect x="42" y="30" width="16" height="40" rx="3" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'orbit' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <ellipse cx="50" cy="50" rx="42" ry="20" transform="rotate(-25 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="50" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="82" cy="35" r="5" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'sigma' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M80,20 L25,20 L50,50 L25,80 L80,80" fill="none" stroke={shapeBorder} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}

                {/* Nature */}
                {shapeType === 'leaf' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M20,80 C20,80 20,30 65,15 C65,15 85,50 45,75 Z M20,80 L45,45 M35,55 L55,50 M30,65 L42,65" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'tree' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,15 C30,15 20,35 30,50 C20,60 30,75 50,75 C70,75 80,60 70,50 C80,35 70,15 50,15 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <rect x="44" y="75" width="12" height="18" rx="2" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'mountain' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="35,30 75,85 5,85" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <polygon points="65,15 95,85 35,85" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <polyline points="23,48 35,55 45,46" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'water-drop' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,12 C50,12 82,50 82,68 C82,84 68,92 50,92 C32,92 18,84 18,68 C18,50 50,12 50,12 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'sun-rays' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="22" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M50,8 L50,20 M50,80 L50,92 M8,50 L20,50 M80,50 L92,50 M21,21 L30,30 M70,70 L79,79 M21,79 L30,70 M70,30 L79,21" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'snowflake' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="50" y1="10" x2="50" y2="90" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="22" y1="22" x2="78" y2="78" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="22" y1="78" x2="78" y2="22" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M42,22 L50,30 L58,22 M42,78 L50,70 L58,78 M22,42 L30,50 L22,58 M78,42 L70,50 L78,58" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'planet-ring' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="25" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <ellipse cx="50" cy="50" rx="46" ry="14" transform="rotate(-20 50 50)" fill="none" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'galaxy' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,50 Q85,15 85,50 Q85,85 50,50 Q15,85 15,50 Q15,15 50,50" fill="none" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="50" cy="50" r="7" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'comet' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="75" cy="25" r="14" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <path d="M65,33 L15,75 M70,38 L25,85 M60,23 L10,65" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'volcano' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <polygon points="25,35 75,35 90,85 10,85" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <path d="M35,35 Q50,50 65,35" stroke={shapeBorder} strokeWidth="2" fill="none" />
                    <path d="M40,25 Q35,10 30,5 M50,25 Q50,10 50,2 M60,25 Q65,10 70,5" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" fill="none" />
                  </svg>
                )}
                {shapeType === 'sprout' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M50,90 L50,45 M50,45 C50,25 25,20 20,35 C20,50 45,45 50,45 Z M50,45 C50,25 75,20 80,35 C80,50 55,45 50,45 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'feather' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M85,15 C50,30 25,60 15,90 M85,15 C60,40 50,70 15,90" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                    <line x1="85" y1="15" x2="10" y2="95" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}

                {/* UI & Layout */}
                {shapeType === 'layout-grid' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="12" y="12" width="34" height="34" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="54" y="12" width="34" height="34" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="12" y="54" width="34" height="34" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="54" y="54" width="34" height="34" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'layout-columns' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="22" height="70" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="39" y="15" width="22" height="70" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="68" y="15" width="22" height="70" rx="4" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'layout-sidebar' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="80" height="70" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="35" y1="15" x2="35" y2="85" stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'modal-box' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="10" width="80" height="80" rx="8" fill="none" stroke={shapeBorder} strokeWidth="2" opacity="0.4" />
                    <rect x="25" y="25" width="50" height="50" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="60" y1="35" x2="68" y2="35" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'card-view' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="12" y="15" width="76" height="70" rx="8" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <rect x="22" y="25" width="56" height="28" rx="4" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="22" y1="63" x2="60" y2="63" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="22" y1="73" x2="45" y2="73" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'button-primary' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="12" y="30" width="76" height="40" rx="10" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <line x1="35" y1="50" x2="65" y2="50" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'toggle-switch' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="12" y="30" width="76" height="40" rx="20" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="68" cy="50" r="14" fill={shapeBorder} />
                  </svg>
                )}
                {shapeType === 'slider-control' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <line x1="15" y1="50" x2="85" y2="50" stroke={shapeBorder} strokeWidth="3.5" strokeLinecap="round" />
                    <circle cx="60" cy="50" r="12" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                  </svg>
                )}
                {shapeType === 'tab-bar' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <path d="M10,25 L35,25 L42,40 L90,40 L90,85 L10,85 Z" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" strokeLinejoin="round" />
                  </svg>
                )}
                {shapeType === 'search-bar' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="30" width="80" height="40" rx="20" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="32" cy="50" r="8" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <line x1="38" y1="56" x2="45" y2="63" stroke={shapeBorder} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'avatar-circle' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <circle cx="50" cy="50" r="40" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <circle cx="50" cy="38" r="12" fill="none" stroke={shapeBorder} strokeWidth="2" />
                    <path d="M26,75 C26,60 36,56 50,56 C64,56 74,60 74,75" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {shapeType === 'image-placeholder' && (
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-md">
                    <rect x="10" y="15" width="80" height="70" rx="6" fill={shapeBg} stroke={shapeBorder} strokeWidth="2.5" />
                    <polygon points="20,72 40,45 60,72" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <polygon points="50,72 68,52 82,72" fill="none" stroke={shapeBorder} strokeWidth="2" strokeLinejoin="round" />
                    <circle cx="70" cy="32" r="6" fill="none" stroke={shapeBorder} strokeWidth="2" />
                  </svg>
                )}
              </div>
              
              {/* A shape is a shape. Dropping one used to open a caret inside
                  it, so every star, gear and lightning bolt arrived wearing an
                  empty "Type inside…" box that fought the artwork it sat on and
                  clipped anything longer than a word. Shapes are pure marks
                  now — put words in a text block on top if you want them. */}
            </div>
          );
        }

      case 'workflow-node': {
        const nodeShape = (obj.style?.nodeShape as string) || 'pill';
        const shapeBg = (obj.style?.color as string) || '#FAF6F1';
        const shapeBorder = (obj.style?.borderColor as string) || '#C97B4B';
        const textColor = (obj.style?.textColor as string) || '#2D2A26';
        const fontSize = (obj.style?.fontSize as number) || 14;
        const fontFamily = (obj.style?.fontFamily as string) || "'Inter', sans-serif";

        const pad = nodeShape === 'diamond' ? { left: '20%', right: '20%', top: '20%', bottom: '20%' } :
                    nodeShape === 'circle' ? { left: '15%', right: '15%', top: '15%', bottom: '15%' } :
                    { left: '12px', right: '12px', top: '8px', bottom: '8px' };

        return (
          <div className={`workflow-node-container ${nodeShape}`} style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Background shape */}
            <div className="absolute inset-0 pointer-events-none z-0">
              {(nodeShape === 'pill' || nodeShape === 'circle' || nodeShape === 'square') && (
                <div 
                  className={`w-full h-full transition-all duration-300 ${
                    nodeShape === 'pill' || nodeShape === 'circle' ? 'rounded-full' : 'rounded-xl'
                  }`} 
                  style={{ 
                    backgroundColor: shapeBg, 
                    border: `1.5px solid ${shapeBorder}`, 
                    boxShadow: isSelected ? '0 0 12px rgba(var(--accent-rgb), 0.2)' : 'var(--shadow-sm)' 
                  }} 
                />
              )}
              {nodeShape === 'diamond' && (
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible filter drop-shadow-sm absolute inset-0">
                  <polygon points="50,2 98,50 50,98 2,50" fill={shapeBg} stroke={shapeBorder} strokeWidth="1.5" className="transition-all duration-300" />
                </svg>
              )}
            </div>

            {/* Inner Content Area */}
            <div 
              className="absolute flex items-center justify-center text-center z-10"
              style={{
                left: pad.left,
                right: pad.right,
                top: pad.top,
                bottom: pad.bottom,
                overflow: 'hidden',
              }}
            >
              {isEditing ? (
                <div
                  key="edit"
                  ref={contentRef}
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  onBlur={handleBlur}
                  className="text-block-editable w-full max-h-full overflow-y-auto text-center custom-scrollbar"
                  data-placeholder="Type..."
                  style={{
                    fontSize: `${fontSize}px`,
                    fontFamily: fontFamily,
                    lineHeight: '1.3',
                    color: textColor,
                    display: 'inline-block',
                    verticalAlign: 'middle',
                    outline: 'none'
                  }}
                />
              ) : (
                <div
                  key="display"
                  className="text-block-display select-none w-full max-h-full overflow-hidden text-ellipsis text-center font-medium"
                  style={{
                    fontSize: `${fontSize}px`,
                    fontFamily: fontFamily,
                    lineHeight: '1.3',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: textColor,
                    alignSelf: 'center',
                  }}
                  onClick={(e) => {
                    if (isSelected) {
                      e.stopPropagation();
                      setEditingId(obj.id);
                    }
                  }}
                >
                  {obj.content || ''}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'image': {
        // Tap-to-cycle shape (heart, star, …). `original` keeps the rounded
        // frame + contain fit; any real shape switches to a cover-fill clip with
        // a shape-following shadow, so overflow must stay visible for that shadow.
        const imageShape = (obj.style?.imageShape as ImageShape) || 'original';
        const shaped = imageShape !== 'original';

        /* A CUT-OUT IMAGE IS NOT A CARD.
           `.image-block` gives every picture a rounded frame and a rectangular
           drop shadow, which is right for a photograph and completely wrong for
           a subject whose background has just been removed: the transparent
           area let the canvas through, but the card's shadow and corners still
           drew a box around it, so the cut-out never actually looked cut out.
           A checkerboard was drawn behind it too, which made "transparent" read
           as a pattern rather than as the board.

           So a cutout drops the card entirely. The only thing it keeps is a
           soft shadow — and because `drop-shadow` works off the ALPHA rather
           than the element's box, that shadow hugs the subject's real silhouette
           and makes it sit ON the canvas instead of floating above a rectangle
           of nothing. */
        const isCutout = typeof obj.style?.imageOriginal === 'string';
        const bare = shaped || isCutout;

        /* The look, as a CSS filter. Adjustments are stored as five numbers and
           resolved at paint time, so they cost nothing, change nothing, and can
           be reverted with one click — the stored pixels are never touched.
           Composed with (not replacing) the shape and cutout shadows, since
           `filter` is a single property and the last one written would
           otherwise silently drop the others. */
        const look = adjustToFilter(obj.style?.imageAdjust as Partial<ImageAdjust> | undefined);
        const shadow = shaped
          ? 'drop-shadow(0 6px 14px rgba(0,0,0,0.28))'
          : isCutout ? 'drop-shadow(0 4px 12px rgba(0,0,0,0.28))' : '';
        const imageFilter = [look, shadow].filter(Boolean).join(' ') || undefined;
        return (
          /* The wrapper exists so ImageStudio is a SIBLING of `.image-block`
             rather than a child of it: that class sets `overflow: hidden`, which
             would clip the studio's rail and every panel that opens above it. */
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div
              className={bare ? 'w-full h-full' : 'image-block'}
              style={{ width: '100%', height: '100%', overflow: bare ? 'visible' : undefined, position: 'relative' }}
            >
              {obj.content ? (
                <img
                  src={obj.content}
                  alt="Canvas image"
                  draggable={false}
                  style={{
                    ...(shaped ? { width: '100%', height: '100%', ...imageShapeStyle(imageShape) } : {}),
                    ...(isCutout && !shaped
                      // `.image-block img` supplied these; without the class they
                      // have to be stated. `contain` matches the unmasked case so
                      // a cutout doesn't suddenly reframe itself.
                      ? { width: '100%', height: '100%', objectFit: 'contain' as const }
                      : {}),
                    // Written last so it wins over the shape helper's own filter,
                    // which it has already absorbed.
                    ...(imageFilter ? { filter: imageFilter } : {}),
                    position: 'relative',
                    transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
                  }}
                />
              ) : (
                <div className="flex items-center justify-center w-full h-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm">
                  Drop image here
                </div>
              )}
            </div>

            {/* Mounted only while selected — that unmount is what resets the
                tools, so a picture is never left holding an armed wand. */}
            {obj.content && isSelected && <ImageStudio obj={obj} />}
          </div>
        );
      }

      case 'mirror':
        return <MirrorBlock obj={obj} />;

      default:
        return null;
    }
  };

  const getButtonsPosition = () => {
    if (obj.type !== 'text' && obj.type !== 'heading') {
      return { right: 0 };
    }
    const fontSize = obj.style?.fontSize ? Number(obj.style.fontSize) : (obj.type === 'heading' ? 32 : 15);
    const text = obj.content || '';
    if (!text) {
      return { left: 10 };
    }
    const firstLine = text.split('\n')[0] || '';
    const charWidth = fontSize * 0.52; // highly precise character width for Inter font family
    const padding = 12;
    const estimatedWidth = firstLine.length * charWidth + padding;
    const maxLeft = Math.max(80, obj.width - 100);
    const leftPos = Math.min(maxLeft, Math.max(10, estimatedWidth));
    return { left: leftPos };
  };

  return (
    <motion.div
      ref={containerRef}
      data-object-id={obj.id}
      /* Drives the fade of the real text beneath the gist (globals.css). */
      data-semantic={semantic ? 'on' : undefined}
      className={`canvas-object absolute group ${(isEditing || editingCommentId === obj.id) ? '' : 'select-none'} ${obj.type === 'arrow' ? '' : (isDragging ? 'dragging' : '')} ${(obj.type === 'arrow' || isPin) ? '' : (isSelected ? 'selected' : '')} ${connectorSelectedIds.includes(obj.id) ? 'connector-selected' : ''}`}
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        /* `obj.zIndex || 1` promoted a backdrop's honest 0 to a 1 — and selecting
           a frame lifted it to 100, straight over the cards it wraps, so its own
           contents became unclickable the moment you touched it. A frame stays
           where it belongs: behind. */
        zIndex: obj.type === 'frame'
          ? (obj.zIndex ?? 0)
          : isDragging ? 1000
          /* A pile orders its own members, and an open one floats over the
             board — otherwise cards bloom out underneath their neighbours. */
          : stackSlot ? stackSlot.z
          : isSelected ? 100 : (obj.zIndex ?? 1),
        cursor: mode === 'connector' ? 'grab' : isEditing ? 'text' : isDragging ? 'grabbing' : 'pointer',
        // Per-object opacity + custom text color set from the selection panel.
        opacity: (obj.style?.opacity as number | undefined) ?? undefined,
        color: (obj.type === 'text' || obj.type === 'heading' || obj.type === 'card' || obj.type === 'sticky')
          ? ((obj.style?.textColor as string | undefined) ?? undefined)
          : undefined,
        background: isPin
          ? 'rgba(0,0,0,0)'
          : (mode === 'connector' || connectorSelectedIds.includes(obj.id))
          ? (obj.type === 'sticky' ? 'none' : 'var(--bg-card)')
          : ((obj.type === 'text' || obj.type === 'heading' || obj.type === 'card')
              ? ((obj.style?.bgColor as string | undefined) ?? 'rgba(0,0,0,0)')
              : 'rgba(0,0,0,0)'),
        boxShadow: (obj.type === 'arrow' || isPin) ? 'none' : ((connectorSelectedIds.includes(obj.id) || mode === 'connector')
          ? (connectorSelectedIds.includes(obj.id)
            ? '0 0 50px rgba(var(--accent-rgb), 0.4), 0 8px 32px rgba(0,0,0,0.15)'
            : '0 0 40px rgba(var(--accent-rgb), 0.25), 0 8px 32px rgba(0,0,0,0.1)')
          : 'none'),
        border: (obj.type === 'arrow' || isPin) ? 'none' : (connectorSelectedIds.includes(obj.id)
          ? '3px solid rgba(var(--accent-rgb), 0.8)'
          : mode === 'connector'
          ? '2px solid rgba(var(--accent-rgb), 0.5)'
          : 'none'),
        pointerEvents: (mode === 'draw' || mode === 'arrow') ? 'none' : 'auto',
        willChange: 'transform, left, top',
        rotate: obj.rotation || 0,
      }}
      animate={mode === 'connector' ? {
        y: [0, -10, 0, 10, 0],
        rotate: [obj.rotation || 0, (obj.rotation || 0) + 0.5, obj.rotation || 0, (obj.rotation || 0) - 0.5, obj.rotation || 0],
      } : {
        /* The pile's whole layout lives here, as a transform on top of the
           shared x/y every member stores. Spreading and gathering are then
           just a change of target, which framer-motion tweens for free — and
           since nothing was written down, nothing has to be put back. */
        x: stackSlot ? stackSlot.dx : 0,
        y: stackSlot ? stackSlot.dy : 0,
        rotate: (obj.rotation || 0) + (stackSlot ? stackSlot.rotate : 0),
      }}
      transition={mode === 'connector' ? {
        y: {
          duration: 3 + (obj.x % 500) / 100,
          repeat: Infinity,
          ease: "easeInOut"
        },
        rotate: {
          duration: 4 + (obj.y % 400) / 100,
          repeat: Infinity,
          ease: "easeInOut"
        }
      } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        hoverTimeout.current = setTimeout(() => {
          setIsHovered(false);
        }, 600);
      }}
    >
      {renderContent()}

      {/* A paper clip fastened to this block (or the top of a pile). Decoration
          only — pointer-events off so it never eats a click on the note. */}
      {!isPin && obj.type !== 'arrow' && obj.type !== 'frame' && obj.style?.clip ? (
        <div
          className="absolute z-[15] pointer-events-none"
          style={{ top: -13, left: '50%', transform: 'translateX(-50%) rotate(-7deg)' }}
        >
          <svg width="24" height="34" viewBox="0 0 26 36" style={{ filter: 'drop-shadow(0 2px 2px rgba(45,42,38,0.35))' }}>
            <path
              d="M8 32 V11 a5 5 0 0 1 10 0 v17 a3.2 3.2 0 0 1 -6.4 0 V13"
              fill="none"
              stroke={(obj.style.clip as { color?: string }).color || '#8C93A0'}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 32 V11 a5 5 0 0 1 10 0 v17 a3.2 3.2 0 0 1 -6.4 0 V13"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.4"
              strokeWidth="0.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}

      {/* The pin the thread tool is currently anchored to — a soft pulsing ring
          telling you "tap another to tie the string here". */}
      {isThreadAnchor && (
        <motion.div
          className="absolute pointer-events-none rounded-full"
          style={{ inset: isPin ? -6 : -8, border: '2px dashed var(--accent)' }}
          animate={{ opacity: [0.9, 0.35, 0.9], scale: [1, 1.06, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Pin name — shown on hover (and while dragging), a quiet pill above the
          head. Only pins that have been named show it. */}
      {isPin && !isSelected && (obj.content || '').trim() && (isHovered || isDragging) && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[102] pointer-events-none whitespace-nowrap px-2.5 py-1 rounded-full bg-[var(--bg-secondary)]/95 backdrop-blur-sm border border-[var(--border)] text-[11px] font-semibold text-[var(--text-primary)] shadow-md"
          style={{ top: -14, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {(obj.content || '').trim()}
        </div>
      )}

      {/* Pin popover — name it, recolour its head, or pull it out. Appears while
          the pin is selected. Stops propagation so clicks here don't deselect. */}
      {isPin && isSelected && !isDragging && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-1/2 -translate-x-1/2 z-[103] glass-panel"
          style={{ bottom: 'calc(100% + 10px)', padding: 10, width: 208 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            type="text"
            value={obj.content || ''}
            onChange={(e) => updateObject(obj.id, { content: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
                setSelectedId(null);
              }
            }}
            placeholder="Name this pin…"
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg outline-none text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            style={{ padding: '6px 9px' }}
          />
          <div className="flex items-center justify-between" style={{ marginTop: 9 }}>
            <div className="flex items-center gap-1.5">
              {PIN_COLORS.map((p) => {
                const active = ((obj.style?.pinColor as string) || DEFAULT_PIN_COLOR).toLowerCase() === p.head.toLowerCase();
                return (
                  <button
                    key={p.head}
                    onClick={() => updateObject(obj.id, { style: { ...obj.style, pinColor: p.head } })}
                    title={p.name}
                    className="rounded-full transition-transform hover:scale-115 cursor-pointer"
                    style={{
                      width: 16,
                      height: 16,
                      background: p.head,
                      boxShadow: active ? `0 0 0 2px var(--bg-secondary), 0 0 0 3.5px ${p.head}` : `inset 0 0 0 1px ${p.shade}`,
                    }}
                  />
                );
              })}
            </div>
            <button
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect();
                addToTrash({
                  id: obj.id,
                  label: (obj.content || 'Pin').slice(0, 24),
                  originX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
                  originY: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
                  objectData: obj,
                  connectionsData: connections.filter((c) => c.fromId === obj.id || c.toId === obj.id),
                });
                removeObject(obj.id);
              }}
              title="Remove pin"
              className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}

      {/* How deep the pile goes. Only the top card says it — the ones below
          are edges, and an edge with a badge on it reads as a separate note. */}
      {stackSlot && !stackSlot.spread && stackSlot.isTop && (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="absolute -top-2 -right-2 z-[30] rounded-full bg-[var(--accent)] text-white font-semibold tabular-nums pointer-events-none flex items-center justify-center"
          style={{
            // Inline: the global reset kills padding utilities, and a badge
            // with dead padding clips its own number at the corners.
            minWidth: 22,
            height: 22,
            padding: '0 6px',
            fontSize: 11,
            boxShadow: '0 2px 8px rgba(45,42,38,0.28)',
          }}
          title={`${stackSlot.count} notes — click to spread`}
        >
          {stackSlot.count}
        </motion.div>
      )}

      {/* What this block is about, once its words are too small to read. */}
      {semantic && (
        <SemanticGist
          view={semantic}
          zoom={camera.zoom}
          ink={semanticInk}
          align={(obj.style?.textAlign as 'left' | 'center' | 'right' | undefined) || 'left'}
          fontFamily={obj.style?.fontFamily as string | undefined}
        />
      )}

      {/* Collaborator attribution dot — only shows during a joined session */}
      {showAuthorDot && (
        <span
          className="absolute -top-1.5 -right-1.5 z-[20] w-3 h-3 rounded-full ring-2 ring-white pointer-events-none shadow-sm"
          style={{ background: authorColor }}
          title="Added by a collaborator"
        />
      )}

      {/* Connector Selection Marker */}
      <AnimatePresence>
        {mode === 'connector' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute inset-0 z-[10] flex items-center justify-center pointer-events-none"
          >
            {connectorSelectedIds.includes(obj.id) ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-12 h-12 rounded-full bg-[var(--accent)] text-white shadow-2xl flex items-center justify-center"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </motion.div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border-2 border-white/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Explicit Connector Button */}
      {mode === 'connector' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleConnectorSelection(obj.id);
          }}
          className={`absolute -bottom-10 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
            connectorSelectedIds.includes(obj.id)
              ? 'bg-[var(--accent)] text-white shadow-lg'
              : 'bg-white/80 dark:bg-white/10 backdrop-blur-md text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--accent)] hover:text-white'
          }`}
        >
          {connectorSelectedIds.includes(obj.id) ? 'Selected' : 'Link Card'}
        </button>
      )}

      {/* Workflow Custom Floating Contextual Hover Buttons */}
      {obj.type === 'workflow-node' && !isDragging && isHovered && !isEditing && (
        <div 
          className="absolute -top-10 left-1/2 -translate-x-1/2 flex gap-2 z-[101] bg-white/95 dark:bg-[var(--bg-secondary)] backdrop-blur-md px-2.5 py-1 rounded-full border border-[#C97B4B]/30 dark:border-white/10 shadow-lg pointer-events-auto items-center animate-fade-in"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Plus Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const defaultStyle = {
                workflowId: obj.style?.workflowId,
                isWorkflowNode: true,
                nodeShape: obj.style?.nodeShape || 'pill',
                color: obj.style?.color || '#FAF6F1',
                borderColor: obj.style?.borderColor || '#C97B4B',
                textColor: obj.style?.textColor || '#2D2A26',
                branchColor: obj.style?.branchColor || '#C97B4B',
                fontSize: 14,
                fontFamily: "'Inter', sans-serif"
              };
              
              // Spawn child node to the right
              const newChild = useCanvasStore.getState().addObject({
                type: 'workflow-node',
                x: obj.x + 240,
                y: obj.y,
                width: 160,
                height: 60,
                content: 'New Step',
                style: defaultStyle
              });

              // Connect parent to child
              useCanvasStore.getState().addConnection(obj.id, newChild.id, {
                isWorkflowConnection: true,
                workflowId: obj.style?.workflowId,
                color: defaultStyle.branchColor
              });

              setSelectedId(newChild.id);
              setEditingId(newChild.id);
            }}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white text-xs font-bold transition-all hover:scale-110 shadow-sm cursor-pointer border-none"
            title="Extend Node (+)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Delete (Cross) Button with Smart Reconnections */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const connections = useCanvasStore.getState().connections;
              const parents = connections.filter(c => c.toId === obj.id);
              const children = connections.filter(c => c.fromId === obj.id);

              parents.forEach(p => {
                children.forEach(ch => {
                  useCanvasStore.getState().addConnection(p.fromId, ch.toId, {
                    isWorkflowConnection: true,
                    workflowId: obj.style?.workflowId,
                    color: obj.style?.branchColor || '#C97B4B'
                  });
                });
              });

              removeObject(obj.id);
              if (editingId === obj.id) setEditingId(null);
            }}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-bold transition-all hover:scale-110 shadow-sm cursor-pointer border-none"
            title="Delete & Reconnect (×)"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mini Action Buttons */}
      {!isDragging && obj.type !== 'workflow-node' && !isPin && (
        <div 
          className={`absolute -top-8 flex gap-1.5 z-[101] pb-2 px-2 transition-all duration-200 ${
            (isHovered && !isEditing) 
              ? 'opacity-100 pointer-events-auto translate-y-0' 
              : 'opacity-0 pointer-events-none translate-y-1'
          }`}
          style={getButtonsPosition()}
        >
          {/* Full-view button — opens the whole, uncropped image in a lightbox.
              Sits alongside the shape-tap so you can always see the original. */}
          {obj.type === 'image' && obj.content && (
            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-8 h-8 rounded-full bg-white dark:bg-white/10 border border-[var(--border)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-all shadow-md"
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setLightboxOpen(true);
              }}
              title="View full image"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </svg>
            </motion.button>
          )}

          {/* Heart Button */}
          {!readOnly && !obj.style?.isCheckpoint && obj.type !== 'shape' && obj.type !== 'arrow' && obj.type !== 'mirror' && (
            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`w-8 h-8 rounded-full bg-white dark:bg-white/10 border border-[var(--border)] flex items-center justify-center transition-all shadow-md ${
                obj.style?.isFavorite ? 'text-red-500 border-red-200 bg-red-50 dark:bg-red-500/20 dark:border-red-500/40' : 'text-[var(--text-tertiary)] hover:text-red-500'
              }`}
              onMouseDown={(e) => {
                e.stopPropagation();
                updateObject(obj.id, { 
                  style: { ...obj.style, isFavorite: !obj.style?.isFavorite } 
                });
              }}
              title="Favorite"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={obj.style?.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </motion.button>
          )}

          {/* Comment Button */}
          {!readOnly && !obj.style?.isCheckpoint && obj.type !== 'shape' && obj.type !== 'arrow' && obj.type !== 'mirror' && (
            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className={`w-8 h-8 rounded-full bg-white dark:bg-white/10 border border-[var(--border)] flex items-center justify-center transition-all shadow-md ${
                obj.style?.comment ? 'text-[var(--accent)] border-[var(--accent-light)]' : 'text-[var(--text-tertiary)] hover:text-[var(--accent)]'
              }`}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (obj.style?.comment !== undefined && obj.style?.comment !== null) {
                  // Second press puts the note away again rather than
                  // re-opening the caret on a note you're already looking at.
                  setEditingCommentId(editingCommentId === obj.id ? null : obj.id);
                } else {
                  /* A new note lands just off the block's top-right corner and
                     ABOVE it — the old default (`y: -20` from the block's own
                     origin, then centred on itself) parked the card straight
                     over the first line of whatever it was commenting on. */
                  updateObject(obj.id, {
                    style: {
                      ...obj.style,
                      comment: '',
                      commentOffset: { x: obj.width + 105, y: -70 },
                    }
                  });
                  setEditingCommentId(obj.id);
                }
              }}
              title={obj.style?.comment ? 'Edit note' : 'Add a note'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </motion.button>
          )}

          {/* Delete Button */}
          <motion.button
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="w-8 h-8 rounded-full bg-white dark:bg-white/10 border border-[var(--border)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-500 hover:border-red-500 transition-all shadow-md"
            onMouseDown={(e) => {
              e.stopPropagation();
              // Get card center in screen space for trash animation origin
              const rect = containerRef.current?.getBoundingClientRect();
              const originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
              const originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
              const label = (obj.content || obj.type || 'Card').slice(0, 24);
              const relatedConns = connections.filter(c => c.fromId === obj.id || c.toId === obj.id);
              addToTrash({ 
                id: obj.id, 
                label, 
                color: obj.style?.color as string | undefined, 
                originX, 
                originY,
                objectData: obj,
                connectionsData: relatedConns,
              });
              removeObject(obj.id);
              if (editingId === obj.id) setEditingId(null);
            }}
            title="Delete"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </motion.button>
        </div>
      )}

      {/* Comment note (attached, movable, resizable). It fades in with the
          block's own hover chrome instead of hanging over the board forever —
          a note is an aside about this block, not part of the canvas.
          Hover-only, deliberately NOT tied to selection: a block stays
          "selected" long after you've moved on to something else, and a note
          that rode along with selection would just be the old always-on bug
          wearing a new condition. (Actively editing the note, or hovering the
          note card itself, still keeps it open — see CommentBubble's `show`.) */}
      {obj.type !== 'shape' && obj.type !== 'arrow' && (obj.style?.comment !== undefined && obj.style?.comment !== null) && (
        <CommentBubble
          obj={obj}
          isEditing={editingCommentId === obj.id}
          visible={isHovered && !isDragging}
          onStartEditing={() => setEditingCommentId(obj.id)}
          onStopEditing={() => setEditingCommentId(null)}
        />
      )}

      {/* Tap-to-cycle hint — MIRRORS ONLY now. An image says what it can do
          through the studio rail sitting on it, and a second floating label
          underneath repeating a gesture that no longer exists would be worse
          than nothing. */}
      {obj.type === 'mirror' && isSelected && !isDragging && !isResizing && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 z-[101] pointer-events-none whitespace-nowrap px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-[9px] font-bold uppercase tracking-widest text-white/90 shadow-md flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11.5a2.5 2.5 0 1 1 5 0V13" /><path d="M12 2v2M2 12h2m16 0h2M5 5l1.5 1.5M19 5l-1.5 1.5" />
          </svg>
          Tap to cycle shape · {IMAGE_SHAPE_LABEL[((obj.type === 'mirror' ? obj.style?.mirrorShape : obj.style?.imageShape) as ImageShape) || 'original']}
        </div>
      )}

      {/* Full-view lightbox — the whole, uncropped image over a dimmed page.
          Rendered through a portal so the canvas transform never scales or
          clips it. Click anywhere (or Esc) to close. */}
      {lightboxOpen && obj.type === 'image' && obj.content && typeof document !== 'undefined' &&
        createPortal(
          <ImageLightbox src={obj.content} onClose={() => setLightboxOpen(false)} />,
          document.body
        )}



      {/* Resize handle(s) */}
      {isSelected && (obj.type === 'frame' || obj.type === 'sticky') ? (
        <>
          {([
            ['nw', { top: -5, left: -5, cursor: 'nwse-resize' }],
            ['n', { top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' }],
            ['ne', { top: -5, right: -5, cursor: 'nesw-resize' }],
            ['e', { top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' }],
            ['se', { bottom: -5, right: -5, cursor: 'nwse-resize' }],
            ['s', { bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' }],
            ['sw', { bottom: -5, left: -5, cursor: 'nesw-resize' }],
            ['w', { top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' }],
          ] as const).map(([dir, pos]) => (
            <div
              key={dir}
              className="resize-handle"
              style={{ ...pos, opacity: 1 }}
              onMouseDown={(e) => handleDotResizeStart(e, dir)}
            />
          ))}
        </>
      ) : (
        isSelected && !isPin && (
          <div
            className="resize-handle"
            style={{ bottom: -5, right: -5, opacity: 1 }}
            onMouseDown={handleResizeStart}
          />
        )
      )}
    </motion.div>
  );
}

// Memoized so that updating one object (drag, resize, typing) does not re-render
// every other object on the canvas.
export default React.memo(CanvasObject);
