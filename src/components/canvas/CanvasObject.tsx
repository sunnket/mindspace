'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useCollabStore } from '@/store/collabStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, isAutoCleanable } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { getSnapPoints, randomStickyColor } from '@/lib/utils';
import { ensureReadableInk, readableInk, paperColor } from '@/lib/canvasTheme';
import { reportMeasuredHeight, forgetMeasuredHeight } from '@/lib/canvasLayout';
import { isUrl, newLinkCard } from '@/lib/linkPreview';
import VoiceNoteBlock from './VoiceNoteBlock';
import FileBlock from './FileBlock';
import MapBlock from './MapBlock';
import WeatherBlock from './WeatherBlock';
import RichText from './RichText';
import CodeSandboxBlock from './CodeSandboxBlock';
import QuoteBlock from './QuoteBlock';
import MermaidBlock from './MermaidBlock';
import TodoBlock from './TodoBlock';
import LinkPreviewBlock from './LinkPreviewBlock';
import { CountdownBlock, PollBlock, LiveMetricBlock, QuickDataBlock, FocusTimerBlock, DecisionBlock, ProgressBlock, ChartBlock, TimelineBlock } from './ExtensionBlocks';

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


interface CommentBubbleProps {
  obj: CanvasObjectData;
  isEditing: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
}

function CommentBubble({ obj, isEditing, onStartEditing, onStopEditing }: CommentBubbleProps) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const camera = useCanvasStore((s) => s.camera);
  const offset = (obj.style?.commentOffset as { x: number; y: number }) || { x: 0, y: 0 };
  const width = (obj.style?.commentWidth as number) || 180;
  const height = (obj.style?.commentHeight as number) || 80;
  
  const [localComment, setLocalComment] = useState((obj.style?.comment as string) || '');
  const inputRef = useRef<HTMLInputElement>(null);

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
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = width;
    const initialHeight = height;

    const onMove = (moveE: MouseEvent) => {
      const dx = (moveE.clientX - startX) / camera.zoom;
      const dy = (moveE.clientY - startY) / camera.zoom;
      updateObject(obj.id, {
        style: {
          ...obj.style,
          commentWidth: Math.max(120, initialWidth + dx),
          commentHeight: Math.max(60, initialHeight + dy),
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

  return (
    <div 
      className={`absolute select-auto ${isEditing ? 'z-[1000]' : 'z-[102]'}`}
      style={{
        left: offset.x,
        top: offset.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="relative group/comment">
        {/* Speech Bubble SVG Container */}
        <motion.div
          onMouseDown={handleDrag}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={`relative flex items-center justify-center ${isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'}`}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          {/* Speech Bubble SVG - Dynamic Sizing */}
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="drop-shadow-xl filter pointer-events-none">
            <path 
              d={`M10,10 Q10,0 20,0 L${width-20},0 Q${width-10},0 ${width-10},10 L${width-10},${height-30} Q${width-10},${height-20} ${width-20},${height-20} L40,${height-20} L10,${height-5} L10,${height-20} Q0,${height-20} 0,${height-30} L0,10 Q0,0 10,0`} 
              fill="white" 
              stroke="var(--accent-light)" 
              strokeWidth="1.5"
              transform="translate(5, 5) scale(0.95)"
            />
          </svg>

          {/* Content inside bubble */}
          <div 
            className="absolute inset-0 flex flex-col justify-center px-6 pb-5 pointer-events-auto"
            onClick={() => isEditing && inputRef.current?.focus()}
          >
            <div className="flex items-center gap-2 w-full pt-1">
              {isEditing ? (
                <textarea
                  ref={inputRef as any}
                  value={localComment}
                  onChange={(e) => {
                    setLocalComment(e.target.value);
                    // Auto-resize height
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onBlur={handleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-[12px] w-full resize-none overflow-hidden text-[var(--text-primary)] font-medium leading-tight"
                  placeholder="Type a comment..."
                  rows={1}
                />
              ) : (
                <div 
                  className="text-[12px] text-[var(--text-secondary)] font-medium whitespace-pre-wrap break-words w-full cursor-text"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEditing();
                  }}
                >
                  {(obj.style?.comment as string) || 'Add a comment...'}
                </div>
              )}
              
              {!isEditing && (
                <button 
                  className="opacity-0 group-hover/comment:opacity-100 transition-opacity text-[10px] text-red-400 hover:text-red-600 p-1"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    updateObject(obj.id, { style: { ...obj.style, comment: null } });
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Resizer Handle */}
          {!isEditing && (
            <div
              onMouseDown={handleResize}
              className="absolute bottom-2 right-2 w-3 h-3 cursor-nwse-resize opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-center justify-center"
            >
              <div className="w-1.5 h-1.5 border-r border-b border-[var(--text-muted)]" />
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}


interface CanvasObjectProps {
  obj: CanvasObjectData;
  isSelected: boolean;
  isFocused: boolean;
}

function CanvasObject({ obj, isSelected, isFocused }: CanvasObjectProps) {
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

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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

  // Collaboration: mark objects authored by someone else with their colour dot.
  // Selectors return primitives, so frequent cursor updates never re-render this.
  const collabActive = useCollabStore((s) => s.status === 'connected' && Object.keys(s.peers).length > 0);
  const myPeerId = useCollabStore((s) => s.me?.id);
  const authorId = obj.style?.authorId as string | undefined;
  const authorColor = (obj.style?.authorColor as string | undefined) || '#E93D82';
  const showAuthorDot = collabActive && !!authorId && authorId !== myPeerId;
  
  const isEditing = editingId === obj.id && mode !== 'connector';
  const dragStart = useRef({ x: 0, y: 0, objX: 0, objY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const latestContent = useRef(obj.content || '');
  /** Where the click that opened edit mode landed, so the caret goes THERE. */
  const caretPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (isEditing) {
      setIsHovered(false);
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    }
  }, [isEditing]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (mode === 'draw' || isEditing) return;

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

      // Alt+drag clones the object in place and drags the clone, leaving the
      // original untouched — a fast way to duplicate cards, shapes, and frames.
      let dragObj = obj;
      if (e.altKey && mode !== 'connector' && obj.type !== 'arrow') {
        dragObj = addObject({ ...obj, zIndex: getNextZIndex(), createdAt: Date.now(), updatedAt: Date.now() });
      }

      // Only select if not in connector mode
      if (mode !== 'connector') {
        setSelectedId(dragObj.id);
      }

      if (dragObj.id === obj.id) {
        updateObject(dragObj.id, { zIndex: getNextZIndex() });
      }

      // Dragging a frame carries along whatever was grouped into it.
      const frameChildren = dragObj.type === 'frame'
        ? objects.filter((o) => o.style?.frameParentId === dragObj.id).map((o) => ({ id: o.id, x: o.x, y: o.y }))
        : [];

      const before = { x: dragObj.x, y: dragObj.y };
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        objX: dragObj.x,
        objY: dragObj.y,
        // For arrows:
        objStartX: dragObj.style?.startX as number || 0,
        objStartY: dragObj.style?.startY as number || 0,
        objEndX: dragObj.style?.endX as number || 0,
        objEndY: dragObj.style?.endY as number || 0,
        objBendX: dragObj.style?.bendX as number | undefined,
        objBendY: dragObj.style?.bendY as number | undefined,
      } as any;

      setIsDragging(true);

      // Top-left drop dock: the upper zone MINIMIZES the object into the shelf;
      // the zone below that WARPS it to another canvas; the zone below THAT
      // sends it to an open chat. Tracked as plain closure variables (not
      // React state) so the frequent mousemove never re-renders.
      let overMinimizeZone = false;
      let overWarpZone = false;
      let overChatZone = false;
      let draggedFar = false;
      const HOTZONE_W = 210;

      const handleMouseMove = (moveE: MouseEvent) => {
        if (Math.abs(moveE.clientX - dragStart.current.x) > 8 || Math.abs(moveE.clientY - dragStart.current.y) > 8) {
          draggedFar = true;
        }
        const inLeftCol = draggedFar && moveE.clientX < HOTZONE_W;
        // Frames/arrows can't be warped/sent meaningfully — neither has a
        // standalone snapshot that makes sense outside its canvas context.
        const warpable = dragObj.type !== 'frame' && dragObj.type !== 'arrow';
        // Warping is additionally disabled for a guest inside someone else's
        // live session: teleportObject broadcasts a remove op, which would
        // delete the object from the HOST's real canvas — sending to chat
        // doesn't touch canvas state at all, so it stays allowed here.
        const canWarp = warpable && !useCollabStore.getState().guestOriginView;
        overMinimizeZone = inLeftCol && moveE.clientY >= 72 && moveE.clientY < 232;
        overWarpZone = canWarp && inLeftCol && moveE.clientY >= 240 && moveE.clientY < 404;

        const chatPanel = document.getElementById('chat-panel-container');
        if (chatPanel && warpable && draggedFar) {
          const rect = chatPanel.getBoundingClientRect();
          overChatZone = moveE.clientX >= rect.left && moveE.clientX <= rect.right &&
                         moveE.clientY >= rect.top && moveE.clientY <= rect.bottom;
          chatPanel.style.transform = overChatZone ? 'scale(1.02)' : 'scale(1)';
        } else {
          overChatZone = false;
        }

        const zone = document.getElementById('minimize-hotzone');
        const label = document.getElementById('minimize-hotzone-label');
        if (zone) {
          zone.style.borderColor = overMinimizeZone ? 'var(--accent)' : 'transparent';
          zone.style.background = overMinimizeZone ? 'rgba(201,123,75,0.08)' : 'transparent';
        }
        if (label) label.style.opacity = overMinimizeZone ? '1' : '0';

        const wzone = document.getElementById('warp-hotzone');
        const wlabel = document.getElementById('warp-hotzone-label');
        if (wzone) {
          wzone.style.opacity = draggedFar && canWarp ? '1' : '0';
          wzone.style.borderColor = overWarpZone ? 'var(--accent)' : 'rgba(201,123,75,0.28)';
          wzone.style.background = overWarpZone ? 'rgba(201,123,75,0.12)' : 'transparent';
        }
        if (wlabel) wlabel.style.opacity = overWarpZone ? '1' : '0.55';

        const dx = (moveE.clientX - dragStart.current.x) / camera.zoom;
        const dy = (moveE.clientY - dragStart.current.y) / camera.zoom;

        let newX = dragStart.current.objX + dx;
        let newY = dragStart.current.objY + dy;

        // Skip snapping in connector mode for a more fluid feel
        if (mode !== 'connector') {
          const others = objects
            .filter((o) => o.id !== dragObj.id)
            .map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }));

          const snap = getSnapPoints(newX, newY, dragObj.width, dragObj.height, others);
          if (snap.x !== null) newX = snap.x;
          if (snap.y !== null) newY = snap.y;
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
            }
          });
        } else {
          updateObject(dragObj.id, { x: newX, y: newY });
        }

        if (frameChildren.length > 0) {
          frameChildren.forEach((c) => {
            useCanvasStore.getState().updateObject(c.id, { x: c.x + dx, y: c.y + dy });
          });
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp, END_DRAG);

        const zone = document.getElementById('minimize-hotzone');
        const label = document.getElementById('minimize-hotzone-label');
        if (zone) { zone.style.borderColor = 'transparent'; zone.style.background = 'transparent'; }
        if (label) label.style.opacity = '0';
        const wzone = document.getElementById('warp-hotzone');
        const wlabel = document.getElementById('warp-hotzone-label');
        if (wzone) { wzone.style.opacity = '0'; wzone.style.borderColor = 'rgba(201,123,75,0.28)'; wzone.style.background = 'transparent'; }
        if (wlabel) wlabel.style.opacity = '0.55';
        
        const chatPanel = document.getElementById('chat-panel-container');
        if (chatPanel) chatPanel.style.transform = 'scale(1)';

        if (overMinimizeZone) {
          useCanvasStore.getState().minimizeObject(dragObj.id);
          return;
        }

        // Warp: hand off to the portal picker to teleport this object to
        // another canvas. Snap it back to where the drag started first so it
        // doesn't linger over the dock if the user cancels.
        if (overWarpZone) {
          updateObject(dragObj.id, { x: before.x, y: before.y });
          window.dispatchEvent(new CustomEvent('open-warp', { detail: { objectId: dragObj.id } }));
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

        pushUndo({
          type: 'move',
          objectId: dragObj.id,
          before,
          after: { x: dragObj.x, y: dragObj.y },
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp, END_DRAG);
    },
    [mode, isEditing, obj, camera.zoom, objects, setSelectedId, updateObject, pushUndo, getNextZIndex, addObject]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);

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
        const dx = (moveE.clientX - resizeStart.current.x) / camera.zoom;
        const dy = (moveE.clientY - resizeStart.current.y) / camera.zoom;
        
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
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [obj, camera.zoom, updateObject]
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

      const move = (me: MouseEvent) => {
        const dx = (me.clientX - origin.x) / camera.zoom;
        const dy = (me.clientY - origin.y) / camera.zoom;
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
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [obj, camera.zoom, updateObject]
  );

  // Frames resize from any corner or edge, not just the bottom-right —
  // sections need to grow leftward/upward to wrap content already placed there.
  const handleDotResizeStart = useCallback(
    (e: React.MouseEvent, dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const start = { x: obj.x, y: obj.y, w: obj.width, h: obj.height };

      const handleMouseMove = (moveE: MouseEvent) => {
        const dx = (moveE.clientX - startClientX) / camera.zoom;
        const dy = (moveE.clientY - startClientY) / camera.zoom;

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
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [obj, camera.zoom, updateObject]
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

      const handleMouseMove = (moveE: MouseEvent) => {
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
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [obj, updateObject]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

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

      // Enter focus mode
      setFocusedId(obj.id);

      if (obj.type === 'text' || obj.type === 'sticky' || obj.type === 'card' || obj.type === 'shape') {
        caretPoint.current = { x: e.clientX, y: e.clientY };
        setEditingId(obj.id);
      }
    },
    [obj, setFocusedId, pushCanvas, setEditingId]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (mode === 'draw' || isEditing) return;

      if (mode === 'connector') {
        toggleConnectorSelection(obj.id);
        return;
      }

      // If it's a pure click (no drag) and already selected, enter edit mode.
      // Functional blocks (poll, timer, …) edit through their own inline
      // inputs, so the contentEditable edit mode never applies to them.
      const isFunctionalBlock =
        obj.type === 'card' &&
        Object.entries(obj.style || {}).some(([k, v]) => /^is[A-Z]/.test(k) && Boolean(v)) &&
        !obj.style?.isQuote;
      if (isSelected && obj.type !== 'image' && !isFunctionalBlock) {
        caretPoint.current = { x: e.clientX, y: e.clientY };
        setEditingId(obj.id);
      }
    },
    [mode, isEditing, isSelected, obj, setEditingId]
  );

  // Handle unified content saving. Compares against the LIVE stored content
  // (not a captured closure) so a repeat save — StrictMode remount, height
  // churn, blur + unmount both firing — is idempotent and can never write the
  // text on top of itself (the "typing gets doubled" bug).
  const saveContent = useCallback((finalContent: string) => {
    if (obj.style?.isCheckpoint) return;
    const live = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    if (!live || finalContent === live.content) return;

    const updates: any = { content: finalContent };

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
  const growsToFit = obj.type === 'text' || obj.type === 'heading' || obj.type === 'sticky';

  /* A free text block HUGS its text rather than being born at its full wrap
     width. It still wraps at exactly the same column it always did — wrapWidth
     is that column — the box simply doesn't claim all of it until the words
     reach it. Resizing the block by hand pins its width (isResized) and hands
     control back to the user. */
  const autoWidth = obj.type === 'text' && !obj.style?.isResized;
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

  useEffect(() => {
    if (isEditing && contentRef.current) {
      const target = contentRef.current as any;
      if ('value' in target) {
        target.value = obj.content || '';
      } else {
        target.innerText = obj.content || '';
      }
      latestContent.current = obj.content || '';
      contentRef.current.focus();

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

  // Track native input for all editable text blocks to keep latestContent in sync and handle slash commands
  useEffect(() => {
    if (!isEditing) return;
    
    let timeoutId: NodeJS.Timeout;
    
    const handleNativeInput = () => {
      if (contentRef.current) {
        const target = contentRef.current as any;
        const text = 'value' in target ? target.value : target.innerText;
        latestContent.current = text;
        
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

        // Auto-remove empty text blocks after 8 seconds of inactivity
        if (obj.type === 'text' || obj.type === 'heading') {
          clearTimeout(timeoutId);
          if (latestContent.current.trim() === '') {
            timeoutId = setTimeout(() => {
              if (latestContent.current.trim() === '') {
                removeObject(obj.id);
                if (editingId === obj.id) setEditingId(null);
              }
            }, 8000);
          }
        }
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
      
      // Start the timeout initially if it's an empty text/heading block
      if ((obj.type === 'text' || obj.type === 'heading') && latestContent.current.trim() === '') {
        timeoutId = setTimeout(() => {
          if (latestContent.current.trim() === '') {
            removeObject(obj.id);
            if (editingId === obj.id) setEditingId(null);
          }
        }, 8000);
      }
    }

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('seed-agent-prompt', handleSeedAgent);
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
          if (!isStillEditing && !isStillSelected) {
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
    };
  }, [isEditing, obj.id, obj.type, removeObject, editingId, setEditingId, obj.height, updateObject, setSlashMenu, saveContent, syncWidth]);

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

        // Label sits on the line (or on the curve at t=0.5 for a quadratic).
        const midX = hasBend ? (localX1 + 2 * localBendX + localX2) / 4 : (localX1 + localX2) / 2;
        const midY = hasBend ? (localY1 + 2 * localBendY + localY2) / 4 : (localY1 + localY2) / 2;

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

            {/* Label in the middle */}
            {(isEditing || obj.content) && (
              <div 
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 glass-panel p-1.5 rounded-lg shadow-sm border border-[var(--border)] min-w-[80px] pointer-events-auto"
                style={{
                  left: `${midX}px`,
                  top: `${midY}px`,
                  background: 'var(--bg-glass)',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {isEditing ? (
                  <div
                    ref={contentRef}
                    contentEditable={isEditing}
                    suppressContentEditableWarning
                    onBlur={handleBlur}
                    className="text-block-editable text-xs font-semibold px-1 py-0.5 text-[var(--text-primary)]"
                    style={{ outline: 'none', textAlign: 'center', minWidth: '70px' }}
                  />
                ) : (
                  <div className="text-xs font-semibold px-1 py-0.5 text-[var(--text-primary)] whitespace-nowrap text-center">
                    {obj.content}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'frame': {
        const frameColor = (obj.style?.frameColor as string) || '#C97B4B';
        return (
          <div
            className="w-full h-full rounded-[22px] relative"
            style={{
              border: `2px dashed ${frameColor}66`,
              background: `${frameColor}0C`,
            }}
          >
            <div
              className="absolute -top-[13px] left-4 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm max-w-[85%]"
              style={{ background: frameColor, color: '#fff' }}
            >
              {isEditing ? (
                <div
                  ref={contentRef}
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  onBlur={handleBlur}
                  className="outline-none whitespace-nowrap"
                />
              ) : (
                <span className="whitespace-nowrap">{obj.content || 'Frame'}</span>
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
              fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
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
              fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
              fontWeight: (obj.style?.fontWeight as number | undefined) ?? undefined,
              textAlign: (obj.style?.textAlign as any) || undefined,
              color: freeInk,
              lineHeight: '1.7',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(autoWidth ? { width: 'max-content', maxWidth: wrapWidth } : null),
            }}
          >
            <RichText content={obj.content || ''} />
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
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
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
                  fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                  fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '2.2rem',
                  fontWeight: (obj.style?.fontWeight as number | undefined) ?? 500,
                  textAlign: (obj.style?.textAlign as any) || undefined,
                  lineHeight: 1.2,
                  color: freeInk,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <RichText content={obj.content || ''} />
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
                <RichText content={obj.content || ''} />
              </div>
            )}
          </div>
        );
      }

      case 'card':
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
                <RichText content={obj.content || ''} />
              </div>
            )}
          </div>
        );
      case 'shape':
        {
          const shapeType = (obj.style?.shapeType as string) || 'square';
          const isShapeEditing = isEditing;
          
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

          const getShapePadding = (shape: string) => {
            switch (shape) {
              case 'triangle': return { left: '20%', right: '20%', top: '35%', bottom: '15%' };
              case 'diamond': return { left: '22%', right: '22%', top: '22%', bottom: '22%' };
              case 'star': return { left: '25%', right: '25%', top: '30%', bottom: '25%' };
              case 'heart': return { left: '20%', right: '20%', top: '25%', bottom: '30%' };
              case 'cloud': return { left: '20%', right: '20%', top: '35%', bottom: '20%' };
              case 'database': return { left: '18%', right: '18%', top: '25%', bottom: '18%' };
              case 'document': return { left: '15%', right: '15%', top: '20%', bottom: '20%' };
              case 'speech': return { left: '18%', right: '18%', top: '20%', bottom: '25%' };
              case 'message': return { left: '15%', right: '15%', top: '20%', bottom: '20%' };
              case 'cross': return { left: '30%', right: '30%', top: '30%', bottom: '30%' };
              case 'lightning': return { left: '30%', right: '30%', top: '35%', bottom: '20%' };
              case 'shield': return { left: '18%', right: '18%', top: '20%', bottom: '20%' };
              case 'arrow-left': return { left: '35%', right: '15%', top: '20%', bottom: '20%' };
              case 'arrow-right': return { left: '15%', right: '35%', top: '20%', bottom: '20%' };
              case 'arrow-up': return { left: '35%', right: '35%', top: '15%', bottom: '45%' };
              case 'arrow-down': return { left: '35%', right: '35%', top: '45%', bottom: '15%' };
              case 'tag': return { left: '15%', right: '22%', top: '20%', bottom: '20%' };
              case 'banner': return { left: '20%', right: '20%', top: '25%', bottom: '25%' };
              case 'octagon': return { left: '15%', right: '15%', top: '15%', bottom: '15%' };
              case 'folder': return { left: '15%', right: '15%', top: '30%', bottom: '20%' };
              case 'sun': return { left: '30%', right: '30%', top: '30%', bottom: '30%' };
              case 'moon': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              
              case 'lightbulb': return { left: '25%', right: '25%', top: '20%', bottom: '30%' };
              case 'sticky': return { left: '15%', right: '15%', top: '15%', bottom: '15%' };
              case 'target': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'funnel': return { left: '25%', right: '25%', top: '15%', bottom: '50%' };
              case 'magnet': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              case 'puzzle': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'gear': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              
              case 'terminal': return { left: '15%', right: '15%', top: '35%', bottom: '15%' };
              case 'brackets': return { left: '20%', right: '20%', top: '15%', bottom: '15%' };
              case 'api': return { left: '15%', right: '15%', top: '20%', bottom: '20%' };
              case 'server': return { left: '20%', right: '20%', top: '15%', bottom: '15%' };
              case 'cube': return { left: '20%', right: '20%', top: '30%', bottom: '25%' };
              case 'branch': return { left: '35%', right: '15%', top: '20%', bottom: '20%' };
              case 'terminal-prompt': return { left: '35%', right: '15%', top: '20%', bottom: '20%' };
              case 'cpu': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              case 'globe': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'key': return { left: '35%', right: '15%', top: '20%', bottom: '20%' };
              
              case 'smile': return { left: '20%', right: '20%', top: '20%', bottom: '35%' };
              case 'thumbs-up': return { left: '30%', right: '15%', top: '35%', bottom: '20%' };
              case 'thumbs-down': return { left: '30%', right: '15%', top: '20%', bottom: '35%' };
              case 'flower': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              case 'sparkles': return { left: '30%', right: '30%', top: '30%', bottom: '30%' };
              case 'trophy': return { left: '25%', right: '25%', top: '20%', bottom: '35%' };
              case 'medal': return { left: '20%', right: '20%', top: '40%', bottom: '20%' };
              case 'gift': return { left: '20%', right: '20%', top: '35%', bottom: '20%' };
              case 'balloon': return { left: '20%', right: '20%', top: '15%', bottom: '35%' };
              case 'clapping': return { left: '25%', right: '25%', top: '40%', bottom: '20%' };
              case 'coffee': return { left: '25%', right: '25%', top: '35%', bottom: '25%' };
              case 'check-circle': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'cross-circle': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              
              case 'user': return { left: '20%', right: '20%', top: '50%', bottom: '20%' };
              case 'clock': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'calendar': return { left: '15%', right: '15%', top: '35%', bottom: '15%' };
              case 'card': return { left: '15%', right: '15%', top: '40%', bottom: '20%' };
              case 'chart': return { left: '15%', right: '15%', top: '15%', bottom: '15%' };
              case 'cart': return { left: '20%', right: '20%', top: '30%', bottom: '35%' };
              case 'play': return { left: '30%', right: '20%', top: '20%', bottom: '20%' };
              case 'pause': return { left: '30%', right: '30%', top: '20%', bottom: '20%' };
              case 'stop': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'infinity': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              
              // Story shapes
              case 'beat': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'scene': return { left: '15%', right: '15%', top: '35%', bottom: '15%' };
              case 'arc': return { left: '20%', right: '20%', top: '40%', bottom: '20%' };
              case 'twist': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'stakes': return { left: '25%', right: '25%', top: '20%', bottom: '45%' };
              case 'character': return { left: '20%', right: '20%', top: '45%', bottom: '20%' };
              case 'whisper': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'foreshadow': return { left: '15%', right: '15%', top: '20%', bottom: '20%' };
              case 'world': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'voice': return { left: '30%', right: '15%', top: '20%', bottom: '20%' };
              
              // Extended Tech shapes
              case 'queue': return { left: '15%', right: '15%', top: '35%', bottom: '35%' };
              case 'webhook': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'cache': return { left: '15%', right: '15%', top: '25%', bottom: '25%' };
              case 'event': return { left: '25%', right: '25%', top: '25%', bottom: '25%' };
              case 'pipeline': return { left: '15%', right: '15%', top: '35%', bottom: '35%' };
              case 'auth': return { left: '20%', right: '20%', top: '40%', bottom: '20%' };
              case 'diff': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'hash': return { left: '22%', right: '22%', top: '22%', bottom: '22%' };
              case 'branch-merge': return { left: '25%', right: '25%', top: '20%', bottom: '20%' };
              case 'token': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };

              // System shapes
              case 'feedback': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'bottleneck': return { left: '25%', right: '25%', top: '20%', bottom: '45%' };
              case 'cascade': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'threshold': return { left: '20%', right: '20%', top: '20%', bottom: '20%' };
              case 'trade-off': return { left: '25%', right: '15%', top: '15%', bottom: '25%' };
              case 'pareto': return { left: '15%', right: '15%', top: '20%', bottom: '35%' };
              case 'pivot': return { left: '20%', right: '20%', top: '35%', bottom: '20%' };
              case 'lever': return { left: '20%', right: '20%', top: '20%', bottom: '35%' };
              case 'compound': return { left: '25%', right: '15%', top: '40%', bottom: '20%' };
              case 'risk': return { left: '25%', right: '25%', top: '40%', bottom: '15%' };
              
              default: return { left: '10%', right: '10%', top: '10%', bottom: '10%' };
            }
          };

          const pad = getShapePadding(shapeType);
          
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
                      boxShadow: isSelected ? '0 0 15px rgba(201, 123, 75, 0.2)' : 'var(--shadow-sm)',
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
                      boxShadow: isSelected ? '0 0 15px rgba(201, 123, 75, 0.2)' : 'var(--shadow-sm)',
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
                {isShapeEditing ? (
                  <div
                    key="edit"
                    ref={contentRef}
                    contentEditable={isShapeEditing}
                    suppressContentEditableWarning
                    onBlur={handleBlur}
                    className="text-block-editable w-full max-h-full overflow-y-auto text-center custom-scrollbar"
                    data-placeholder="Type inside..."
                    style={{
                      fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                      fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                      lineHeight: '1.4',
                      color: 'var(--text-primary)',
                      display: 'inline-block',
                      verticalAlign: 'middle',
                    }}
                  />
                ) : (
                  <div
                    key="display"
                    className="text-block-display select-none w-full max-h-full overflow-hidden text-ellipsis text-center"
                    style={{
                      fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
                      fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
                      lineHeight: '1.4',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: 'var(--text-primary)',
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
                    boxShadow: isSelected ? '0 0 12px rgba(201, 123, 75, 0.2)' : 'var(--shadow-sm)' 
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

      case 'image':
        return (
          <div className="image-block" style={{ width: '100%', height: '100%' }}>
            {obj.content ? (
              <img
                src={obj.content}
                alt="Canvas image"
                draggable={false}
                style={{
                  transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
                }}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm">
                Drop image here
              </div>
            )}
          </div>
        );

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
      className={`canvas-object absolute group ${(isEditing || editingCommentId === obj.id) ? '' : 'select-none'} ${obj.type === 'arrow' ? '' : (isDragging ? 'dragging' : '')} ${obj.type === 'arrow' ? '' : (isSelected ? 'selected' : '')} ${connectorSelectedIds.includes(obj.id) ? 'connector-selected' : ''}`}
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        zIndex: isDragging ? 1000 : isSelected ? 100 : obj.zIndex || 1,
        cursor: mode === 'connector' ? 'grab' : isEditing ? 'text' : isDragging ? 'grabbing' : 'pointer',
        // Per-object opacity + custom text color set from the selection panel.
        opacity: (obj.style?.opacity as number | undefined) ?? undefined,
        color: (obj.type === 'text' || obj.type === 'heading' || obj.type === 'card' || obj.type === 'sticky')
          ? ((obj.style?.textColor as string | undefined) ?? undefined)
          : undefined,
        background: (mode === 'connector' || connectorSelectedIds.includes(obj.id))
          ? (obj.type === 'sticky' ? 'none' : 'var(--bg-card)')
          : ((obj.type === 'text' || obj.type === 'heading' || obj.type === 'card')
              ? ((obj.style?.bgColor as string | undefined) ?? 'rgba(0,0,0,0)')
              : 'rgba(0,0,0,0)'),
        boxShadow: obj.type === 'arrow' ? 'none' : ((connectorSelectedIds.includes(obj.id) || mode === 'connector')
          ? (connectorSelectedIds.includes(obj.id)
            ? '0 0 50px rgba(201, 123, 75, 0.4), 0 8px 32px rgba(0,0,0,0.15)'
            : '0 0 40px rgba(201, 123, 75, 0.25), 0 8px 32px rgba(0,0,0,0.1)')
          : 'none'),
        border: obj.type === 'arrow' ? 'none' : (connectorSelectedIds.includes(obj.id)
          ? '3px solid rgba(201, 123, 75, 0.8)'
          : mode === 'connector' 
          ? '2px solid rgba(201, 123, 75, 0.5)'
          : 'none'),
        pointerEvents: (mode === 'draw' || mode === 'arrow') ? 'none' : 'auto',
        willChange: 'transform, left, top',
        rotate: obj.rotation || 0,
      }}
      animate={mode === 'connector' ? {
        y: [0, -10, 0, 10, 0],
        rotate: [obj.rotation || 0, (obj.rotation || 0) + 0.5, obj.rotation || 0, (obj.rotation || 0) - 0.5, obj.rotation || 0],
      } : { y: 0, rotate: obj.rotation || 0 }}
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
      {!isDragging && obj.type !== 'workflow-node' && (
        <div 
          className={`absolute -top-8 flex gap-1.5 z-[101] pb-2 px-2 transition-all duration-200 ${
            (isHovered && !isEditing) 
              ? 'opacity-100 pointer-events-auto translate-y-0' 
              : 'opacity-0 pointer-events-none translate-y-1'
          }`}
          style={getButtonsPosition()}
        >
          {/* Heart Button */}
          {!obj.style?.isCheckpoint && obj.type !== 'shape' && obj.type !== 'arrow' && (
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
          {!obj.style?.isCheckpoint && obj.type !== 'shape' && obj.type !== 'arrow' && (
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
                  setEditingCommentId(obj.id);
                } else {
                  // Initialize a new empty comment
                  updateObject(obj.id, { 
                    style: { 
                      ...obj.style, 
                      comment: '',
                      commentOffset: { x: obj.width + 20, y: -20 }
                    } 
                  });
                  setEditingCommentId(obj.id);
                }
              }}
              title="Add Comment"
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

      {/* Comment Bubble (Attached & Movable) */}
      {obj.type !== 'shape' && obj.type !== 'arrow' && (obj.style?.comment !== undefined && obj.style?.comment !== null) && (
        <CommentBubble 
          obj={obj} 
          isEditing={editingCommentId === obj.id}
          onStartEditing={() => setEditingCommentId(obj.id)}
          onStopEditing={() => setEditingCommentId(null)}
        />
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
        isSelected && (
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
